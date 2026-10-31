-- 토큰 예산으로 시작 (2026-10-31, 사용자: "지금 한도 방식은 문제가 있네. 제대로 flow를 경험하기 힘들거든. 대안을 마련해줘" →
-- "token 소모량으로 처리할 수는 없을까?" → 토큰량으로 계량해 한도를 건다; 운영자 신청은 "상한 제외·맨 앞"). Plan: crashbang-heroes
-- ~/.claude/plans/hidden-knitting-newell.md, game repo docs/Plan/2026-10-26-hosted-fighter-generation (용량과 쿼터).
--   Before, the official host started at most three requests in any 24 hours, whatever became of them (refused, cancelled and given-back
--   jobs counted too): a few test requests and the next creator waited a day. The worker takes one stage at a time, so it already sets
--   the pace; what has to be guarded is the subscription's spend. The worker now meters each stage's codex tokens (host/codex-usage.mjs:
--   the final totals of the codex sessions written while the stage ran) and reports them with the stage's result; they are kept here per
--   stage (`af_generation_usage`). A new request to ODDBOUT starts while the official host's tokens since midnight in Korea are under
--   `af_generation_settings.daily_token_budget` (500,000 — a registered fighter took about 120,000–220,000 tokens, a brief refusal about 20,000; the weekly subscription is estimated at about 3.4 million, about 480,000 a day; null = no budget, the worker's stop when a provider runs out only). An
--   operator's request (af_admins) is not held back, goes first, and its tokens are kept but not counted in the day. A daily limit of 0
--   on the official row still pauses ODDBOUT's requests (af_generation_check refuses them); its count no longer holds the official host.
--   Community hosts count as before. The heartbeat may carry the subscription's rate-limit reading for the operator (`usage`): kept, not used.
create table public.af_generation_usage (
  id bigint generated always as identity primary key,
  host_id uuid not null references public.af_generation_hosts(id) on delete cascade,
  job_id uuid references public.af_generation_jobs(id) on delete set null,
  at timestamptz not null default now(),
  stage text not null check (length(stage) between 1 and 40),
  admin boolean not null default false,
  tokens bigint not null check (tokens >= 0),
  input bigint not null default 0 check (input >= 0), cached_input bigint not null default 0 check (cached_input >= 0),
  output bigint not null default 0 check (output >= 0), reasoning bigint not null default 0 check (reasoning >= 0)
);
create index af_generation_usage_day on public.af_generation_usage(host_id, at) where not admin;
alter table public.af_generation_usage enable row level security;
alter table public.af_generation_settings add column daily_token_budget bigint default 500000 check (daily_token_budget is null or daily_token_budget >= 0);
alter table public.af_generation_hosts add column usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'), add column usage_at timestamptz;

-- An operator's account: his requests are tests, taken first and never held back by the day.
create function public.af_generation_is_admin(p_owner uuid) returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.af_admins a where a.owner_id = p_owner and a.enabled);
$$;

-- Midnight in Korea, when the day's budget starts again.
create function public.af_generation_day_start() returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;

-- One stage's tokens, from the worker that holds its lease (af_generation_held): kept against the job's host (the brief's: the official),
-- marked when the job is an operator's. `p_tokens` = { total, input, cachedInput, output, reasoning }, whole non-negative numbers.
create function public.af_generation_record_usage(p_id uuid, p_token uuid, p_tokens jsonb) returns void language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token); n jsonb := coalesce(p_tokens, '{}'::jsonb);
begin
  if jsonb_typeof(n) <> 'object' or jsonb_typeof(n->'total') <> 'number' then raise exception 'invalid-tokens'; end if;
  insert into public.af_generation_usage(host_id, job_id, stage, admin, tokens, input, cached_input, output, reasoning)
  values (coalesce(row.assigned_host, public.af_generation_official()), row.id, row.status, public.af_generation_is_admin(row.owner_id),
    (n->>'total')::bigint, coalesce((n->>'input')::bigint, 0), coalesce((n->>'cachedInput')::bigint, 0),
    coalesce((n->>'output')::bigint, 0), coalesce((n->>'reasoning')::bigint, 0));
end $$;

-- The official host's tokens since midnight in Korea, an operator's tests not counted.
create function public.af_generation_tokens_today() returns bigint language sql stable set search_path = '' as $$
  select coalesce(sum(u.tokens), 0)::bigint from public.af_generation_usage u
  where u.host_id = public.af_generation_official() and not u.admin and u.at >= public.af_generation_day_start();
$$;

-- The worker's reading of its subscription's rate-limit window (for the operator; it holds nothing back), checked: a percent 0–100,
-- a window in minutes, the reset as a time. A malformed one is refused.
create function public.af_generation_host_usage(p_host uuid, p_usage jsonb) returns void language plpgsql security invoker set search_path = '' as $$
declare used numeric; minutes integer; resets timestamptz;
begin
  if p_usage is null or jsonb_typeof(p_usage) <> 'object' then raise exception 'invalid-usage'; end if;
  begin
    used := (p_usage->>'usedPercent')::numeric;
    minutes := (p_usage->>'windowMinutes')::integer;
    resets := (p_usage->>'resetsAt')::timestamptz;
  exception when others then raise exception 'invalid-usage';
  end;
  if used is null or used < 0 or used > 100 or (minutes is not null and (minutes < 1 or minutes > 100000)) then raise exception 'invalid-usage'; end if;
  update public.af_generation_hosts set usage = jsonb_strip_nulls(jsonb_build_object('usedPercent', round(used, 1), 'windowMinutes', minutes,
      'resetsAt', resets)), usage_at = now()
    where id = coalesce(p_host, public.af_generation_official());
end $$;

-- Why the official host would not start a new request to ODDBOUT now, or null when it would: `paused` (a daily limit of 0 on its row),
-- `usage` (the day's tokens at or past the budget, until the next midnight in Korea).
create function public.af_generation_official_wait() returns jsonb language sql stable set search_path = '' as $$
  select case
    when o.daily_limit <= 0 then jsonb_build_object('reason', 'paused')
    when s.daily_token_budget is not null and public.af_generation_tokens_today() >= s.daily_token_budget
      then jsonb_build_object('reason', 'usage', 'resetsAt', to_jsonb(public.af_generation_day_start() + interval '1 day'))
  end
  from public.af_generation_settings s, public.af_generation_hosts o where s.singleton and o.official;
$$;

-- Restated whole from 20261030150000 with the reason added and an operator's requests first: where a waiting request to ODDBOUT stands
-- in the order the official host takes them, and why it waits — `turn` (only for the worker to come to it), `usage` (the day's tokens
-- are spent; `resetsAt` = the next midnight in Korea), `paused` (ODDBOUT's making is off or its limit is 0). `dailyLimit` and
-- `startedToday` are for the pages published before (their room is dailyLimit − startedToday): full only while the tokens wait.
create or replace function public.af_generation_queue(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when j.host_choice = 'oddbout' and j.started_at is null and j.status in ('queued', 'appearance') then jsonb_build_object(
      'position', 1 + (select count(*)::integer from public.af_generation_jobs w where w.host_choice = 'oddbout' and w.started_at is null
        and w.id <> j.id and (
          (public.af_generation_is_admin(w.owner_id) and not mine.admin)
          or (public.af_generation_is_admin(w.owner_id) = mine.admin and (
            (w.status = 'appearance' and (j.status = 'queued' or (w.updated_at, w.id) < (j.updated_at, j.id)))
            or (w.status = 'queued' and j.status = 'queued' and (w.created_at, w.id) < (j.created_at, j.id)))))),
      'reason', why.reason, 'dailyLimit', greatest(o.daily_limit, 1),
      'startedToday', case when why.reason = 'usage' then greatest(o.daily_limit, 1) else 0 end)
    || case when why.reason = 'usage' then jsonb_build_object('resetsAt', held.wait->'resetsAt') else '{}'::jsonb end end
  from public.af_generation_jobs j, public.af_generation_hosts o,
    lateral (select public.af_generation_is_admin(j.owner_id) as admin) mine,
    lateral (select public.af_generation_official_wait() as wait) held,
    lateral (select case when not (public.af_generation_capabilities()->>'hosted')::boolean then 'paused'
      when mine.admin then 'turn' else coalesce(held.wait->>'reason', 'turn') end as reason) why
  where j.id = p_id and o.official;
$$;

-- Restated whole from 20261030150000 with only the day's tokens added (`usage`: tokensToday, dailyTokenBudget — null without one — and
-- resetsAt, the next midnight in Korea).
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
    'usage', jsonb_build_object('tokensToday', public.af_generation_tokens_today(), 'dailyTokenBudget', s.daily_token_budget,
      'resetsAt', public.af_generation_day_start() + interval '1 day'),
    'hosts', (select count(*) from public.af_generation_hosts h where not h.official and public.af_generation_host_online(h)))
  from public.af_generation_settings s, public.af_generation_hosts o where s.singleton and o.official;
$$;

-- Restated whole from 20261030150000 with only the official host's room changed and an operator's requests first: a new request to ODDBOUT
-- (or an open one it takes) starts while the day's tokens are under the budget (af_generation_official_wait); an operator's (af_admins)
-- starts regardless, and every operator's job is taken before others'. The worker's stop when a provider runs out stays as it is.
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
  room := not h.official or public.af_generation_official_wait() is null;
  select j.* into row from public.af_generation_jobs j
    where public.af_generation_working(j.status) and (j.lease_expires_at is null or j.lease_expires_at < now())
      and ((j.status = 'queued' and h.official)
        or (j.status <> 'queued' and (h.approved or (j.owner_id = h.owner_id and j.host_choice = 'host' and j.requested_host = h.id))
          and (j.assigned_host = h.id
            or (j.assigned_host is null and ((j.host_choice = 'oddbout' and h.official and (room or public.af_generation_is_admin(j.owner_id)))
              or (j.host_choice = 'host' and j.requested_host = h.id)
              or (j.host_choice = 'any' and h.accepts_any and (case when h.official then room else public.af_generation_host_today(h.id) < h.daily_limit end)
                and (not h.official or not others or j.updated_at < now() - interval '3 minutes')))))))
    order by public.af_generation_is_admin(j.owner_id) desc, j.updated_at, j.id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.af_generation_jobs set lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', stage_leases = stage_leases + 1,
    assigned_host = case when status = 'queued' then assigned_host else coalesce(assigned_host, h.id) end,
    started_at = case when status = 'queued' then started_at else coalesce(started_at, now()) end
    where id = row.id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'claimed',
    jsonb_build_object('status', row.status, 'lease', row.stage_leases, 'host', h.id));
  return row;
end $$;

revoke all on table public.af_generation_usage from public, anon, authenticated;
grant select, insert on table public.af_generation_usage to service_role;
revoke all on function public.af_generation_is_admin(uuid), public.af_generation_day_start(), public.af_generation_record_usage(uuid, uuid, jsonb),
  public.af_generation_tokens_today(), public.af_generation_host_usage(uuid, jsonb), public.af_generation_official_wait() from public, anon, authenticated;
grant execute on function public.af_generation_is_admin(uuid), public.af_generation_day_start(), public.af_generation_record_usage(uuid, uuid, jsonb),
  public.af_generation_tokens_today(), public.af_generation_host_usage(uuid, jsonb), public.af_generation_official_wait() to service_role;
