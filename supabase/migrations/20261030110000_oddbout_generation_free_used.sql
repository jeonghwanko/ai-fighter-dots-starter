-- API 점검 (2026-10-29): GET generations told the page whether the creator's one free hosted fighter was used from his newest five jobs,
-- while the request check reads all of them. Past five fighters made on his own PC the free one fell out of view: the page offered the
-- request form again and the request was refused with generation-quota. af_generation_free_used is that rule, for the check and the page.
-- af_generation_check is restated whole from 20261030090000 with only that clause changed.

create function public.af_generation_free_used(p_owner uuid) returns boolean language sql stable security invoker set search_path = '' as $$
  -- A job on ODDBOUT's or another person's subscription that is not over, or is over with a fighter; fighters made on his own PC
  -- (his own subscription) do not use it.
  select exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and not public.af_generation_freed(j)
    and not (j.host_choice = 'host' and j.requested_host in (select o.id from public.af_generation_hosts o where o.owner_id = p_owner)))
$$;

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
  if choice = 'oddbout' and (caps->>'today')::integer >= (caps->>'dailyLimit')::integer then raise exception 'generation-capacity'; end if;
  if choice = 'host' then
    if not public.af_generation_host_live(named) then raise exception 'host-offline'; end if;
    if public.af_generation_host_today(named.id) >= named.daily_limit then raise exception 'host-capacity'; end if;
  end if;
  if choice = 'any' and not exists(select 1 from public.af_generation_hosts h where h.accepts_any and public.af_generation_host_online(h)
      and public.af_generation_host_today(h.id) < h.daily_limit) then raise exception 'generation-capacity'; end if;
  return own;
end $$;

revoke all on function public.af_generation_free_used(uuid) from public, anon, authenticated;
grant execute on function public.af_generation_free_used(uuid) to service_role;
