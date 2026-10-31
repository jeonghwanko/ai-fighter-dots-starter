-- 보유 토큰 (2026-10-31, 사용자: "oddbout에서 내가 보유한 토큰을 보여주고, (회원가입하면) 50만 토큰을 보여주고, 차감 보유 토큰을 보여줘").
-- Design: game repo docs/Plan/2026-10-26-hosted-fighter-generation (보유 토큰). 사용자 결정:
--   1. The first free fighter (one per account) becomes a token balance: an account may ask ODDBOUT while its balance is above zero.
--   2. Every token the official host spends on his jobs is taken off, whatever the outcome (a safety refusal and our side's failure too).
--   3. Every account, old and new, starts at 500,000. Spending is counted from af_generation_usage, which exists from today.
-- A job under way goes on when the balance goes below zero; the next request is refused (`generation-quota`, the free fighter's code, so
-- a page from before reads it as before). An operator (`af_admins`) is never refused. The operator raises an account's grant:
-- `update public.af_creators set token_grant = …`.
-- Review (2026-10-31): his balance pays for his requests to ODDBOUT only (af_generation_charged). The brief the official host writes for a
-- request to his own PC or another person's host (its safety check, about 20,000 tokens) is not taken off him; the day's budget counts it
-- as before. A stage whose lease was lost (the job cancelled under it) or whose finish was refused still spent its tokens: the worker
-- reports them without the lease (af_generation_record_usage_after), one row per lease whichever route reports it.

alter table public.af_creators add column token_grant bigint not null default 500000 check (token_grant >= 0);
-- The free fighters an operator gave beyond one become tokens at the same rate (one fighter: 500,000).
update public.af_creators set token_grant = 500000 * hosted_credits where hosted_credits > 1;
-- The claim a stage ran under (its lease token): one row per lease, however the worker reports it. Rows before have none.
alter table public.af_generation_usage add column lease uuid;
create unique index af_generation_usage_lease on public.af_generation_usage(job_id, lease) where lease is not null;
create index af_generation_usage_job on public.af_generation_usage(job_id);

-- Whether a usage row is taken off the job's creator: the official host's tokens on a request to ODDBOUT (its brief too), or on a request
-- to any host that the official host took. Never an operator's (`admin`), never the brief of a request another host makes.
create function public.af_generation_charged(p_usage public.af_generation_usage, p_job public.af_generation_jobs) returns boolean
language sql stable set search_path = '' as $$
  select p_usage.host_id = public.af_generation_official() and not p_usage.admin
    and (p_job.host_choice = 'oddbout' or p_job.assigned_host is not distinct from p_usage.host_id);
$$;

-- His tokens: the grant (an account not made yet has the default), what his jobs took (af_generation_charged), and what is left (below
-- zero when a job outran it).
create function public.af_generation_balance(p_owner uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  with granted as (select coalesce((select c.token_grant from public.af_creators c where c.owner_id = p_owner), 500000)::bigint as n),
  spent as (select coalesce(sum(u.tokens), 0)::bigint as n from public.af_generation_usage u join public.af_generation_jobs j on j.id = u.job_id
    where j.owner_id = p_owner and public.af_generation_charged(u, j))
  select jsonb_build_object('granted', g.n, 'spent', s.n, 'balance', g.n - s.n) from granted g, spent s;
$$;

-- What each of these jobs took from its creator so far, by job id (a job that took nothing is left out): one query for a list.
create function public.af_generation_job_tokens(p_jobs uuid[]) returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.job_id, t.n), '{}'::jsonb) from (
    select u.job_id, sum(u.tokens)::bigint as n from public.af_generation_usage u join public.af_generation_jobs j on j.id = u.job_id
    where u.job_id = any(p_jobs) and public.af_generation_charged(u, j) group by u.job_id) t;
$$;

-- Restated whole from 20261030150000 with only its rule changed: no tokens left (`af_generation_balance`), never for an operator.
-- af_generation_check (restated below) calls it for a request that is not on his own PC.
create or replace function public.af_generation_free_used(p_owner uuid) returns boolean language sql stable security invoker set search_path = '' as $$
  select not public.af_generation_is_admin(p_owner) and (public.af_generation_balance(p_owner)->>'balance')::bigint <= 0;
$$;

-- Restated whole from 20261031120000 with only the lease kept: a second report of the same lease is ignored.
create or replace function public.af_generation_record_usage(p_id uuid, p_token uuid, p_tokens jsonb) returns void language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token); n jsonb := coalesce(p_tokens, '{}'::jsonb);
begin
  if jsonb_typeof(n) <> 'object' or jsonb_typeof(n->'total') <> 'number' then raise exception 'invalid-tokens'; end if;
  insert into public.af_generation_usage(host_id, job_id, lease, stage, admin, tokens, input, cached_input, output, reasoning)
  values (coalesce(row.assigned_host, public.af_generation_official()), row.id, p_token, row.status, public.af_generation_is_admin(row.owner_id),
    (n->>'total')::bigint, coalesce((n->>'input')::bigint, 0), coalesce((n->>'cachedInput')::bigint, 0),
    coalesce((n->>'output')::bigint, 0), coalesce((n->>'reasoning')::bigint, 0))
  on conflict (job_id, lease) where lease is not null do nothing;
end $$;

-- One stage's tokens from a worker that no longer holds its lease (the job cancelled under it, or its finish refused): spent all the same.
-- The worker names the lease it ran under and the stage. Its host must be the job's, or the official host for a brief (`queued`, before
-- any host took the job). One row per lease, whichever route reports it. Returns whether it was kept (false: reported before).
create function public.af_generation_record_usage_after(p_host uuid, p_id uuid, p_lease uuid, p_stage text, p_tokens jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; h uuid := coalesce(p_host, public.af_generation_official()); n jsonb := coalesce(p_tokens, '{}'::jsonb); kept integer;
begin
  if jsonb_typeof(n) <> 'object' or jsonb_typeof(n->'total') <> 'number' or p_lease is null or not public.af_generation_working(p_stage)
    then raise exception 'invalid-result'; end if;
  select * into row from public.af_generation_jobs where id = p_id;
  if not found or not (row.assigned_host is not distinct from h or (p_stage = 'queued' and h = public.af_generation_official()))
    then raise exception 'not-found'; end if;
  insert into public.af_generation_usage(host_id, job_id, lease, stage, admin, tokens, input, cached_input, output, reasoning)
  values (h, row.id, p_lease, p_stage, public.af_generation_is_admin(row.owner_id),
    (n->>'total')::bigint, coalesce((n->>'input')::bigint, 0), coalesce((n->>'cachedInput')::bigint, 0),
    coalesce((n->>'output')::bigint, 0), coalesce((n->>'reasoning')::bigint, 0))
  on conflict (job_id, lease) where lease is not null do nothing;
  get diagnostics kept = row_count;
  return kept > 0;
end $$;

-- Restated whole from 20261030170000 with only its comment on the account's limit brought up to the tokens.
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
  -- One request at a time; and a request that is not on his own PC only while his tokens last (보유 토큰 2026-10-31: his balance above
  -- zero, never held for an operator). Only what ODDBOUT's subscription makes for him takes tokens off (af_generation_charged); a request
  -- another person's host makes is held by that host's daily limit and by three requests a day.
  if exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and j.status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired'))
    then raise exception 'generation-quota'; end if;
  if not own and public.af_generation_free_used(p_owner) then raise exception 'generation-quota'; end if;
  if (select count(*) from public.af_generation_jobs where owner_id = p_owner and created_at > now() - interval '1 day') >= 3
    then raise exception 'rate-limit'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= public.af_fighter_limit(p_owner) then raise exception 'fighter-quota'; end if;
  perform pg_advisory_xact_lock(74280503);
  -- Counted under the lock (two requests at once must not both take the last place in line); a daily limit of 0 starts nothing, so it
  -- takes no request either (it would wait forever).
  if choice = 'oddbout' and ((caps->>'dailyLimit')::integer = 0
      or public.af_generation_waiting() >= (select s.queue_limit from public.af_generation_settings s where s.singleton))
    then raise exception 'generation-capacity'; end if;
  if choice = 'host' then
    if not public.af_generation_host_live(named) then raise exception 'host-offline'; end if;
    if public.af_generation_host_today(named.id) >= named.daily_limit then raise exception 'host-capacity'; end if;
  end if;
  if choice = 'any' and not exists(select 1 from public.af_generation_hosts h where h.accepts_any and public.af_generation_host_online(h)
      and public.af_generation_host_today(h.id) < h.daily_limit) then raise exception 'generation-capacity'; end if;
  return own;
end $$;

revoke all on function public.af_generation_charged(public.af_generation_usage, public.af_generation_jobs), public.af_generation_balance(uuid),
  public.af_generation_job_tokens(uuid[]), public.af_generation_record_usage_after(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.af_generation_charged(public.af_generation_usage, public.af_generation_jobs), public.af_generation_balance(uuid),
  public.af_generation_job_tokens(uuid[]), public.af_generation_record_usage_after(uuid, uuid, uuid, text, jsonb) to service_role;
