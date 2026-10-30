-- 첫 선수 무료, review (2026-10-30, 사용자: "이 세션에서 작업한 것을 적대적으로 리뷰하고 개선해줘"):
--   - A request to ODDBOUT is counted against the waiting limit under the lock it already takes, so two at once cannot both take the last
--     place; a daily limit of 0 refuses again (with nothing ever starting, a queued request would wait forever).
--   - A cancel gives the free fighter back when our side stalled: the host holding the job (the official one before any took it) is not
--     online. A creator who gives up while the worker is down does not lose it.
-- The API also refuses a change to idle now (the look itself: the worker sent it to the operator, whose cancel gave the fighter back).

-- Restated whole from 20261030150000 with only the waiting clause changed.
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

-- Restated whole from 20261030150000 with only the give-back widened to a host that is not online.
create or replace function public.af_generation_cancel(p_owner uuid, p_id uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_own(p_owner, p_id); h public.af_generation_hosts; ours boolean;
begin
  if row.status in ('submitting', 'submitted', 'rejected', 'failed', 'cancelled', 'expired') then raise exception 'generation-state'; end if;
  -- Our side: an operator was to look, or the host holding the job (the official one before any took it) is not online now.
  select * into h from public.af_generation_hosts where id = coalesce(row.assigned_host, public.af_generation_official());
  ours := row.status = 'needs_review' or not coalesce(public.af_generation_host_online(h), false);
  update public.af_generation_jobs set status = 'cancelled', waiting_since = null, lease_token = null, lease_expires_at = null,
    refunded_at = case when ours then now() else refunded_at end, updated_at = now()
    where id = p_id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'cancelled', jsonb_build_object('charged', public.af_generation_spends(row)));
  return row;
end $$;
