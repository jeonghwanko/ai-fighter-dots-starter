-- 첫 선수 무료 (2026-10-30, 사용자: "첫 가입하고 1회는 우리 구독으로 캐릭터를 생성하게 하려고 하는데"). Design: game repo
-- docs/Plan/2026-10-26-hosted-fighter-generation (첫 선수 무료). 사용자 결정:
--   1. The free fighter is used once its looks are painted (`charged_at`): a cancel or an expiry after that keeps it used. Our side's ends
--      give it back: a failed job, a package that failed its check, a cancel while an operator was to look (`needs_review`, `refunded_at`),
--      a refusal at the safety check (before any picture). Before, every cancel and expiry freed it again, so a creator could paint, cancel
--      and paint again three times a day on ODDBOUT's subscription.
--   2. A full day takes the request and queues it. The official host's daily limit counts the jobs it started (`started_at`: its first
--      look stage) in the last day, and it starts no new one past it; the brief (the safety check) and the stages of a started job do not
--      wait. A request is refused (`generation-capacity`) only past `queue_limit` waiting requests.
--   3. Revisions stay as they were (looks twice, motions three times).
--   4. A request is one line (사용자: "입력창이 너무 많아서 거부감"): from four characters ("고양이 복서"), not ten.
-- A creator's free fighters: `af_creators.hosted_credits` (none: one). The operator raises it for an account
-- (`update public.af_creators set hosted_credits = 2 where owner_id = '<id>';`); a paid extra would fill the same column later.
-- Jobs before this release have no `charged_at`: their cancels and expiries stay as free as they were.

alter table public.af_generation_jobs add column charged_at timestamptz, add column refunded_at timestamptz, add column started_at timestamptz;
alter table public.af_creators add column hosted_credits smallint check (hosted_credits between 0 and 20);
alter table public.af_generation_settings add column queue_limit integer not null default 30 check (queue_limit between 0 and 1000);
alter table public.af_generation_jobs drop constraint af_generation_jobs_description_check,
  add constraint af_generation_jobs_description_check check (char_length(btrim(description)) between 4 and 600);
create index af_generation_jobs_waiting on public.af_generation_jobs(updated_at) where host_choice = 'oddbout' and started_at is null;

-- The jobs a host already took past their brief started when it first claimed their looks.
update public.af_generation_jobs j set started_at = coalesce((select min(e.at) from public.af_generation_events e
    where e.job_id = j.id and e.kind = 'claimed' and e.data->>'status' <> 'queued'), j.created_at)
  where j.assigned_host is not null and j.started_at is null;
-- Open jobs whose looks are already painted are used from now on, as a new job would be.
update public.af_generation_jobs set charged_at = updated_at
  where status in ('appearance', 'appearance_ready', 'motions', 'motion_ready', 'submitting', 'needs_review') and jsonb_array_length(candidates) > 0
    and charged_at is null;

-- A job that uses one of its owner's free fighters: not one of our side's ends (refused, failed, a package that failed its check, given
-- back), and either not over, submitted, or over after its looks were painted.
create function public.af_generation_spends(p_job public.af_generation_jobs) returns boolean language sql stable set search_path = '' as $$
  select p_job.refunded_at is null and p_job.status not in ('rejected', 'failed')
    and not (p_job.status = 'submitted' and exists(select 1 from public.af_submissions s where s.id = p_job.submission_id and s.status = 'rejected'))
    and (p_job.charged_at is not null or p_job.status not in ('cancelled', 'expired'));
$$;

-- His free fighters: granted, used and left. Fighters made on his own PC (his own subscription) do not use them.
create function public.af_generation_credits(p_owner uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  with granted as (select coalesce((select c.hosted_credits from public.af_creators c where c.owner_id = p_owner), 1)::integer as n),
  spent as (select count(*)::integer as n from public.af_generation_jobs j where j.owner_id = p_owner and public.af_generation_spends(j)
    and not (j.host_choice = 'host' and j.requested_host in (select o.id from public.af_generation_hosts o where o.owner_id = p_owner)))
  select jsonb_build_object('granted', g.n, 'used', s.n, 'left', greatest(g.n - s.n, 0)) from granted g, spent s;
$$;

-- Restated whole from 20261030110000 with only its rule changed: no free fighter left (`af_generation_credits`).
create or replace function public.af_generation_free_used(p_owner uuid) returns boolean language sql stable security invoker set search_path = '' as $$
  select (public.af_generation_credits(p_owner)->>'left')::integer = 0;
$$;

-- Restated whole from 20261028130000 with only the official host's count changed: the jobs it started in the last day (a queued request
-- waits for it and costs nothing yet). Other hosts count as before: the requests that named them and the jobs they took.
create or replace function public.af_generation_host_today(p_host uuid) returns integer language sql stable set search_path = '' as $$
  select coalesce((select case when h.official
      then (select count(*)::integer from public.af_generation_jobs j where j.assigned_host = h.id and j.started_at > now() - interval '1 day')
      else (select count(*)::integer from public.af_generation_jobs j where j.created_at > now() - interval '1 day'
        and public.af_generation_counted(j.status, j.brief) and (j.assigned_host = h.id or j.requested_host = h.id)) end
    from public.af_generation_hosts h where h.id = p_host), 0);
$$;

-- Requests to ODDBOUT that wait for their looks to start (their brief may still be running).
create function public.af_generation_waiting() returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.af_generation_jobs where host_choice = 'oddbout' and started_at is null and status in ('queued', 'appearance');
$$;

-- Where a waiting request to ODDBOUT stands: its place in the order the official host takes them (the oldest finished brief first; one
-- whose brief runs comes after those, in the order they were asked), the host's daily limit and the jobs it started in the last day. None
-- for any other job.
create function public.af_generation_queue(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when j.host_choice = 'oddbout' and j.started_at is null and j.status in ('queued', 'appearance') then jsonb_build_object(
      'position', 1 + (select count(*)::integer from public.af_generation_jobs w where w.host_choice = 'oddbout' and w.started_at is null
        and w.id <> j.id and (
          (w.status = 'appearance' and (j.status = 'queued' or (w.updated_at, w.id) < (j.updated_at, j.id)))
          or (w.status = 'queued' and j.status = 'queued' and (w.created_at, w.id) < (j.created_at, j.id)))),
      'dailyLimit', o.daily_limit, 'startedToday', public.af_generation_host_today(o.id)) end
  from public.af_generation_jobs j, public.af_generation_hosts o where j.id = p_id and o.official;
$$;

-- Restated whole from 20261028130000 with the waiting requests and their limit added; `today` is the official host's started jobs.
create or replace function public.af_generation_capabilities() returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'hosted', s.enabled and public.af_generation_host_online(o),
    'reason', case when not s.enabled then 'disabled' when o.worker_seen_at is null or o.worker_seen_at <= now() - interval '3 minutes' then 'worker-offline'
      when not coalesce((o.worker_health->>'ok')::boolean, false) then 'provider-unavailable' end,
    'queue', (select count(*) from public.af_generation_jobs j where public.af_generation_working(j.status)),
    'dailyLimit', o.daily_limit,
    'today', public.af_generation_host_today(o.id),
    'waiting', public.af_generation_waiting(),
    'queueLimit', s.queue_limit,
    'hosts', (select count(*) from public.af_generation_hosts h where not h.official and public.af_generation_host_online(h)))
  from public.af_generation_settings s, public.af_generation_hosts o where s.singleton and o.official;
$$;

-- Restated whole from 20261030110000 with only the day's clause changed: a request to ODDBOUT on a full day waits (the claim holds its
-- looks back); it is refused only past the waiting requests' limit.
create or replace function public.af_generation_check(p_owner uuid, p_host_choice text default 'oddbout', p_host uuid default null, p_host_consent boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare caps jsonb; choice text := coalesce(p_host_choice, 'oddbout'); named public.af_generation_hosts; own boolean := false;
begin
  perform public.af_authorize(p_owner);
  caps := public.af_generation_capabilities();
  if not (caps->>'hosted')::boolean then raise exception 'generation-unavailable'; end if;
  if choice not in ('oddbout', 'any', 'host') or (choice = 'host') <> (p_host is not null) then raise exception 'invalid-host'; end if;
  if choice = 'host' then
    -- Held until the request is made, so a removal of that host waits and then sees it; a removed host takes no request.
    select * into named from public.af_generation_hosts where id = p_host for key share;
    if not found or named.official or named.removed_at is not null then raise exception 'invalid-host'; end if;
    own := named.owner_id = p_owner;
    if not (own or named.approved) then raise exception 'invalid-host'; end if;
  end if;
  if choice <> 'oddbout' and not own and not coalesce(p_host_consent, false) then raise exception 'host-consent-required'; end if;
  -- One request at a time; and one free hosted fighter on ODDBOUT's or another person's subscription. Fighters made on his own PC (his
  -- own subscription) do not use it up.
  if exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and j.status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired'))
    then raise exception 'generation-quota'; end if;
  if not own and public.af_generation_free_used(p_owner) then raise exception 'generation-quota'; end if;
  if (select count(*) from public.af_generation_jobs where owner_id = p_owner and created_at > now() - interval '1 day') >= 3
    then raise exception 'rate-limit'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= public.af_fighter_limit(p_owner) then raise exception 'fighter-quota'; end if;
  perform pg_advisory_xact_lock(74280503);
  if choice = 'oddbout' and (caps->>'waiting')::integer >= (caps->>'queueLimit')::integer then raise exception 'generation-capacity'; end if;
  if choice = 'host' then
    if not public.af_generation_host_live(named) then raise exception 'host-offline'; end if;
    if public.af_generation_host_today(named.id) >= named.daily_limit then raise exception 'host-capacity'; end if;
  end if;
  if choice = 'any' and not exists(select 1 from public.af_generation_hosts h where h.accepts_any and public.af_generation_host_online(h)
      and public.af_generation_host_today(h.id) < h.daily_limit) then raise exception 'generation-capacity'; end if;
  return own;
end $$;

-- Restated whole from 20261028170100 with the official host's day added: past its daily limit it starts no new request to ODDBOUT (the
-- looks of one it has not started); the brief and a started job's stages go on. A job's first stage past the brief marks it started. The
-- official host's claims hold a lock of their own while they count the day.
create or replace function public.af_generation_claim_for(p_host uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; h public.af_generation_hosts; others boolean; room boolean;
begin
  -- The host row is held (key share) until this claim commits: a removal waits for it and then sees the job it took.
  select * into h from public.af_generation_hosts where id = coalesce(p_host, public.af_generation_official()) for key share;
  if not found or h.removed_at is not null or not h.enabled or not (h.approved or h.terms_accepted_at is not null) then return null; end if;
  perform public.af_generation_expire();
  update public.af_generation_jobs set status = 'failed', error_code = 'stage-attempts', lease_token = null, lease_expires_at = null, updated_at = now()
    where public.af_generation_working(status) and stage_leases >= 3 and coalesce(lease_expires_at, '-infinity') < now();
  others := exists(select 1 from public.af_generation_hosts o where not o.official and o.accepts_any and public.af_generation_host_online(o)
    and public.af_generation_host_today(o.id) < o.daily_limit);
  -- The official host's claims go one at a time: two workers must not both take the day's last start.
  if h.official then perform pg_advisory_xact_lock(74280504); end if;
  room := not h.official or public.af_generation_host_today(h.id) < h.daily_limit;
  select j.* into row from public.af_generation_jobs j
    where public.af_generation_working(j.status) and (j.lease_expires_at is null or j.lease_expires_at < now())
      and ((j.status = 'queued' and h.official)
        or (j.status <> 'queued' and (h.approved or (j.owner_id = h.owner_id and j.host_choice = 'host' and j.requested_host = h.id))
          and (j.assigned_host = h.id
            or (j.assigned_host is null and ((j.host_choice = 'oddbout' and h.official and room)
              or (j.host_choice = 'host' and j.requested_host = h.id)
              or (j.host_choice = 'any' and h.accepts_any and public.af_generation_host_today(h.id) < h.daily_limit
                and (not h.official or not others or j.updated_at < now() - interval '3 minutes')))))))
    order by j.updated_at, j.id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.af_generation_jobs set lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', stage_leases = stage_leases + 1,
    assigned_host = case when status = 'queued' then assigned_host else coalesce(assigned_host, h.id) end,
    started_at = case when status = 'queued' then started_at else coalesce(started_at, now()) end
    where id = row.id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'claimed',
    jsonb_build_object('status', row.status, 'lease', row.stage_leases, 'host', h.id));
  return row;
end $$;

-- Restated whole from 20261028120000 with only `charged_at` added: the first painted looks use the job's free fighter.
create or replace function public.af_generation_finish(p_id uuid, p_token uuid, p_outcome text, p_result jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token); result jsonb := coalesce(p_result, '{}'::jsonb);
begin
  if p_outcome = 'retry' then
    update public.af_generation_jobs set lease_token = null, lease_expires_at = now() + interval '2 minutes', updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'queued' then
    if jsonb_typeof(result->'brief') <> 'object' then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set brief = result->'brief', status = 'appearance', progress = 0, stage_leases = 0, lease_token = null,
      lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'appearance' then
    if jsonb_typeof(result->'candidates') <> 'array' or jsonb_array_length(result->'candidates') <> 2 then raise exception 'invalid-result'; end if;
    -- A pick only for a job its creator left to us; then the motions start without waiting for him.
    if result ? 'choice' and not (row.delegate and coalesce(result->>'choice', '') in ('a', 'b')) then raise exception 'invalid-result'; end if;
    if result ? 'choice' then
      update public.af_generation_jobs set candidates = result->'candidates', choice = result->>'choice', appearance_note = null, status = 'motions',
        waiting_since = null, progress = 0, stage_leases = 0, lease_token = null, lease_expires_at = null, charged_at = coalesce(charged_at, now()),
        updated_at = now() where id = p_id returning * into row;
    else
      update public.af_generation_jobs set candidates = result->'candidates', choice = null, appearance_note = null, status = 'appearance_ready',
        waiting_since = now(), progress = 100, stage_leases = 0, lease_token = null, lease_expires_at = null, charged_at = coalesce(charged_at, now()),
        updated_at = now() where id = p_id returning * into row;
    end if;
  elsif p_outcome = 'ok' and row.status = 'motions' then
    if jsonb_typeof(result->'preview') <> 'array' or jsonb_array_length(result->'preview') < 1 then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set preview = result->'preview', motion_note = null, status = 'motion_ready', waiting_since = now(), progress = 100,
      stage_leases = 0, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'submitting' then
    if not exists(select 1 from public.af_submissions where id = (result->>'submissionId')::uuid and owner_id = row.owner_id) then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set submission_id = (result->>'submissionId')::uuid, status = 'submitted', progress = 100, stage_leases = 0,
      lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'rejected' and row.status = 'queued' then
    update public.af_generation_jobs set status = 'rejected', error_code = left(coalesce(result->>'code', 'unsafe'), 64), lease_token = null,
      lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome in ('failed', 'review') then
    update public.af_generation_jobs set status = case when p_outcome = 'failed' then 'failed' else 'needs_review' end,
      error_code = left(coalesce(result->>'code', p_outcome), 64), lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  else raise exception 'invalid-result'; end if;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'finished',
    jsonb_build_object('outcome', p_outcome, 'status', row.status, 'code', result->>'code', 'calls', result->'calls', 'choice', result->>'choice'));
  return row;
end $$;

-- Restated whole from 20261028100000 with the give-back added: a creator who stops waiting for the operator (`needs_review`) gets his
-- free fighter back. The event says whether the cancel kept it used.
create or replace function public.af_generation_cancel(p_owner uuid, p_id uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_own(p_owner, p_id);
begin
  if row.status in ('submitting', 'submitted', 'rejected', 'failed', 'cancelled', 'expired') then raise exception 'generation-state'; end if;
  update public.af_generation_jobs set status = 'cancelled', waiting_since = null, lease_token = null, lease_expires_at = null,
    refunded_at = case when status = 'needs_review' then now() else refunded_at end, updated_at = now()
    where id = p_id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'cancelled', jsonb_build_object('charged', public.af_generation_spends(row)));
  return row;
end $$;

-- Restated whole from 20261028160000 with the give-back added: an operator's cancel is ours, so the creator's free fighter comes back.
create or replace function public.af_admin_generation_cancel(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_jobs;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  update public.af_generation_jobs set status = 'cancelled', waiting_since = null, lease_token = null, lease_expires_at = null, refunded_at = now(),
    updated_at = now()
    where id = p_id and status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired') returning * into j;
  if not found then raise exception 'review-conflict'; end if;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'operator', jsonb_build_object('action', 'cancel', 'actor', p_actor));
  return jsonb_build_object('id', j.id, 'status', j.status);
end $$;

revoke all on function public.af_generation_spends(public.af_generation_jobs), public.af_generation_credits(uuid), public.af_generation_waiting(),
  public.af_generation_queue(uuid) from public, anon, authenticated;
grant execute on function public.af_generation_spends(public.af_generation_jobs), public.af_generation_credits(uuid), public.af_generation_waiting(),
  public.af_generation_queue(uuid) to service_role;
