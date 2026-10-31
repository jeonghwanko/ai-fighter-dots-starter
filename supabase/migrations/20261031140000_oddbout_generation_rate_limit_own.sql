-- 하루 세 건 (2026-10-31): the three requests a day counted every request, so a person whose requests failed on our side (a stage's
-- bug, an operator's stop he then cancelled) was refused for a day with his tokens untouched. Now they are his own requests only:
-- a request that failed on our side (`failed`) or that he cancelled while it waited for an operator (`cancelled` with `refunded_at`)
-- is left out; a refused request (safety) still counts, since each takes a brief on the official host. An operator is never held.
-- Restated whole from 20261031130000 with only that rule changed.

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
  -- Three requests a day, his own: not one ODDBOUT stopped — failed on our side (`failed`), or cancelled while it waited for an operator
  -- (`refunded_at`, the cancel of a needs_review job) — and never for an operator. A refused request (safety) counts: each takes a brief.
  if not public.af_generation_is_admin(p_owner) and (select count(*) from public.af_generation_jobs where owner_id = p_owner
      and created_at > now() - interval '1 day' and status <> 'failed' and not (status = 'cancelled' and refunded_at is not null)) >= 3
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

