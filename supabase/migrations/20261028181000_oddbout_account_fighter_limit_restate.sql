-- The account answer (GET me) carries the account's own fighter limit, so the creator page draws that many slots.
-- 20261028180000 changed the fighter bound inside three functions by patching their live definitions, which the
-- migration rules forbid (the result cannot be read from the repository). They are restated here whole, exactly as
-- production runs them after that migration (read from the live database on 2026-10-28), so nothing changes in them.
-- af_create_submission's earlier string patches (deleted fighters, in-place updates, shared assets) are in this body.
create or replace function public.af_account(p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('invited',coalesce(c.enabled,true),'canSubmit',coalesce(c.enabled,true),
    'accessMode','open','expiresAt',null,'request',null,'fighterLimit',public.af_fighter_limit(p_owner))
  from (select p_owner as id) me left join public.af_creators c on c.owner_id=me.id;
$$;

create or replace function public.af_create_submission(p_owner uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint,p_fighter uuid default null)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; settings public.af_settings; declared numeric; f public.af_fighters;
begin
  perform public.af_authorize(p_owner);
  select * into settings from public.af_settings where singleton for update;
  select * into s from public.af_submissions where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if s.manifest_sha<>p_sha or s.manifest_text<>p_text or s.replaces_fighter is distinct from p_fighter then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if settings.paused then raise exception 'submissions-paused'; end if;
  if p_fighter is null then
    if (select count(*) from public.af_fighters where owner_id=p_owner and deleted_at is null) >= public.af_fighter_limit(p_owner) then raise exception 'fighter-quota'; end if;
  else
    select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner;
    if not found then raise exception 'fighter-not-found'; end if;
    if f.review_state='rejected' then raise exception 'fighter-removed'; end if;
    if f.manifest_sha=p_sha then raise exception 'fighter-unchanged'; end if;
  end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  if p_fighter is null and (select count(*) from public.af_submissions where owner_id=p_owner and replaces_fighter is null) >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::numeric) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Reservations count even expired/rejected records until an operator removes their objects and records together.
  if (select coalesce(sum(asset_bytes),0) from public.af_submissions where asset_source_submission is null)+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,replaces_fighter)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes,p_fighter) returning * into s;
  return s;
end $$;

create or replace function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean,
  p_delegate boolean default false, p_host_choice text default 'oddbout', p_host uuid default null, p_host_consent boolean default false)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; caps jsonb; refs uuid[] := coalesce(p_refs, '{}'); choice text := coalesce(p_host_choice, 'oddbout');
  named public.af_generation_hosts; own boolean := false;
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  select * into row from public.af_generation_jobs where owner_id = p_owner and idempotency_key = p_key;
  if found then return row; end if;
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
  if not own and exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and not public.af_generation_freed(j)
      and not (j.host_choice = 'host' and j.requested_host in (select o.id from public.af_generation_hosts o where o.owner_id = p_owner)))
    then raise exception 'generation-quota'; end if;
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
  if cardinality(refs) > 2 or cardinality(refs) <> (select count(distinct x) from unnest(refs) x) then raise exception 'invalid-refs'; end if;
  if cardinality(refs) > 0 and not coalesce(p_rights, false) then raise exception 'rights-required'; end if;
  if (select count(*) from public.af_generation_uploads where id = any(refs) and owner_id = p_owner and job_id is null
      and created_at > now() - interval '1 day') <> cardinality(refs) then raise exception 'invalid-refs'; end if;
  insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, refs_rights, delegate, host_choice, requested_host, host_consent)
    values (p_owner, p_key, btrim(p_description), p_language, cardinality(refs) > 0, coalesce(p_delegate, false), choice,
      case when choice = 'host' then p_host end, choice <> 'oddbout') returning * into row;
  update public.af_generation_uploads set job_id = row.id where id = any(refs);
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'created',
    jsonb_build_object('refs', cardinality(refs), 'delegate', coalesce(p_delegate, false), 'host', choice, 'own', own));
  return row;
end $$;

create or replace function public.af_generation_register(p_owner uuid, p_id uuid, p_profile jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_own(p_owner, p_id);
begin
  if row.status <> 'motion_ready' then raise exception 'generation-state'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= public.af_fighter_limit(p_owner) then raise exception 'fighter-quota'; end if;
  update public.af_generation_jobs set profile = p_profile, status = 'submitting', waiting_since = null, progress = 0, stage_leases = 0, updated_at = now()
    where id = p_id returning * into row;
  insert into public.af_generation_events(job_id, kind) values (p_id, 'register');
  return row;
end $$;
