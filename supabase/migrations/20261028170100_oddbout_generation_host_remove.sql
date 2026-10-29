-- 내 PC 지우기 (2026-10-28): a host takes himself off from the site's My agents page (사용자: "My Agent 메뉴 … 등록, 관리, 해제, 삭제" →
-- "내 PC를 My agents로 옮긴다"). Design: game repo docs/kaito-web/ai-fighter-creator.md "내 에이전트".
-- 해제 is the keys switched off (`af_generation_host_revoke`, as before). 삭제 is this: the host is gone from every list and claim, his keys
-- are off, his join codes are deleted. Requests keep naming the host they were made for (`requested_host`, `assigned_host` — the credit of
-- who made a fighter), so the row stays and is marked `removed_at`. While a request for him is not over he cannot remove himself: its files
-- are on his PC. Applying again brings the same host back, terms accepted anew and not approved.
-- Every function that reads a host to act for it (claim, request, key, join code, join) holds the host row with `for key share` until it
-- commits, and removal takes it `for update`: a removal waits for a claim or request under way and then sees its job (refusing), and a claim,
-- request, key or code that comes after it finds the host removed. The host row is always locked before a job, key or code row.
alter table public.af_generation_hosts add column removed_at timestamptz;

-- On now: switched on, a heartbeat within three minutes, a healthy last check, not removed.
create or replace function public.af_generation_host_live(p_host public.af_generation_hosts) returns boolean language sql stable set search_path = '' as $$
  select p_host.removed_at is null and p_host.enabled and p_host.worker_seen_at > now() - interval '3 minutes'
    and coalesce((p_host.worker_health->>'ok')::boolean, false);
$$;

-- A creator applies to host (or changes his name or billing): accepted terms, not approved until the operator approves him. A removed host
-- comes back switched on, not approved, with nothing of his old worker's last report.
create or replace function public.af_generation_host_apply(p_owner uuid, p_name text, p_billing text, p_terms boolean) returns public.af_generation_hosts
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_hosts;
begin
  perform public.af_authorize(p_owner);
  if not coalesce(p_terms, false) then raise exception 'host-terms-required'; end if;
  if p_billing not in ('subscription', 'api-key') or char_length(btrim(coalesce(p_name, ''))) not between 2 and 40 then raise exception 'invalid-host'; end if;
  insert into public.af_generation_hosts(owner_id, name, billing, terms_accepted_at) values (p_owner, btrim(p_name), p_billing, now())
    on conflict (owner_id) do update set name = excluded.name, billing = excluded.billing, terms_accepted_at = now(), updated_at = now(),
      enabled = af_generation_hosts.enabled or af_generation_hosts.removed_at is not null,
      approved = af_generation_hosts.approved and af_generation_hosts.removed_at is null,
      worker_seen_at = case when af_generation_hosts.removed_at is null then af_generation_hosts.worker_seen_at end,
      worker_health = case when af_generation_hosts.removed_at is null then af_generation_hosts.worker_health else '{}'::jsonb end,
      removed_at = null
    returning * into row;
  return row;
end $$;

-- A host's own switches: on or paused, open requests or only his own, his daily limit. A removed host has none.
create or replace function public.af_generation_host_update(p_owner uuid, p_enabled boolean, p_accepts_any boolean, p_daily_limit integer)
returns public.af_generation_hosts language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_hosts;
begin
  perform public.af_authorize(p_owner);
  if p_daily_limit is not null and p_daily_limit not between 0 and 50 then raise exception 'invalid-host'; end if;
  update public.af_generation_hosts set enabled = coalesce(p_enabled, enabled), accepts_any = coalesce(p_accepts_any, accepts_any),
    daily_limit = coalesce(p_daily_limit, daily_limit), updated_at = now() where owner_id = p_owner and removed_at is null returning * into row;
  if not found then raise exception 'not-found'; end if;
  return row;
end $$;

-- A worker key for a host who accepted the terms (the API keeps only its hash), two live keys at most, ninety days each. Not approved, the key
-- takes his own requests only (`af_generation_claim_for`). None for a removed host.
create or replace function public.af_generation_host_key(p_owner uuid, p_hash text, p_label text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts; expires timestamptz := now() + interval '90 days';
begin
  perform public.af_authorize(p_owner);
  select * into h from public.af_generation_hosts where owner_id = p_owner and removed_at is null for key share;
  if not found or h.terms_accepted_at is null then raise exception 'host-not-found'; end if;
  if (select count(*) from public.af_workers w where w.host_id = h.id and w.enabled and w.expires_at > now()) >= 2 then raise exception 'host-key-limit'; end if;
  insert into public.af_workers(token_hash, label, scope, host_id, expires_at) values (p_hash, left(coalesce(p_label, 'host'), 60), 'generation', h.id, expires);
  return jsonb_build_object('host', h.id, 'expiresAt', expires);
end $$;

-- Join codes: the site makes one for a signed-in host; his PC trades it, once, within thirty minutes, for a worker key. None for a removed host.
create or replace function public.af_generation_host_join_code(p_owner uuid, p_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts; expires timestamptz := now() + interval '30 minutes';
begin
  perform public.af_authorize(p_owner);
  select * into h from public.af_generation_hosts where owner_id = p_owner and removed_at is null for key share;
  if not found or h.terms_accepted_at is null then raise exception 'host-not-found'; end if;
  delete from public.af_generation_host_joins where host_id = h.id and (used_at is not null or expires_at < now());
  if (select count(*) from public.af_generation_host_joins where host_id = h.id and created_at > now() - interval '1 hour') >= 5 then raise exception 'rate-limit'; end if;
  insert into public.af_generation_host_joins(code_hash, host_id, expires_at) values (p_hash, h.id, expires);
  return jsonb_build_object('host', h.id, 'expiresAt', expires);
end $$;

-- A PC trades a join code for a worker key. A third live key retires the oldest: joining a new PC is the owner's own act on the site.
-- The host is held first (removal locks it before the codes): a code redeemed while its host is removed waits, then finds it gone.
create or replace function public.af_generation_host_join(p_code_hash text, p_key_hash text, p_label text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_host_joins; h public.af_generation_hosts; expires timestamptz := now() + interval '90 days';
begin
  select * into j from public.af_generation_host_joins where code_hash = p_code_hash and used_at is null and expires_at > now();
  if not found then raise exception 'join-code-invalid'; end if;
  select * into h from public.af_generation_hosts where id = j.host_id for key share;
  if not found or h.removed_at is not null then raise exception 'join-code-invalid'; end if;
  update public.af_generation_host_joins set used_at = now() where code_hash = p_code_hash and used_at is null and expires_at > now() returning * into j;
  if not found then raise exception 'join-code-invalid'; end if;
  if not exists(select 1 from public.af_creators c where c.owner_id = h.owner_id and c.enabled) then raise exception 'account-disabled'; end if;
  -- Host keys all live ninety days, so the latest to expire is the newest.
  update public.af_workers set enabled = false where token_hash in (select w.token_hash from public.af_workers w
    where w.host_id = h.id and w.enabled and w.expires_at > now() order by w.expires_at desc offset 1);
  insert into public.af_workers(token_hash, label, scope, host_id, expires_at) values (p_key_hash, left(coalesce(p_label, 'host-join'), 60), 'generation', h.id, expires);
  return jsonb_build_object('host', h.id, 'name', h.name, 'approved', h.approved, 'expiresAt', expires);
end $$;

-- One stage of one job for one host (no host: the official one). The brief only on the official host. After it, a job its host already
-- took; or a new one: a request to ODDBOUT (official), one that named this host, or an open one he accepts within his daily limit. The
-- official host leaves open jobs to the other hosts for three minutes while one of them could take them. A host not approved takes only
-- the requests he made himself and named himself for.
create or replace function public.af_generation_claim_for(p_host uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; h public.af_generation_hosts; others boolean;
begin
  -- The host row is held (key share) until this claim commits: a removal waits for it and then sees the job it took.
  select * into h from public.af_generation_hosts where id = coalesce(p_host, public.af_generation_official()) for key share;
  if not found or h.removed_at is not null or not h.enabled or not (h.approved or h.terms_accepted_at is not null) then return null; end if;
  perform public.af_generation_expire();
  update public.af_generation_jobs set status = 'failed', error_code = 'stage-attempts', lease_token = null, lease_expires_at = null, updated_at = now()
    where public.af_generation_working(status) and stage_leases >= 3 and coalesce(lease_expires_at, '-infinity') < now();
  others := exists(select 1 from public.af_generation_hosts o where not o.official and o.accepts_any and public.af_generation_host_online(o)
    and public.af_generation_host_today(o.id) < o.daily_limit);
  select j.* into row from public.af_generation_jobs j
    where public.af_generation_working(j.status) and (j.lease_expires_at is null or j.lease_expires_at < now())
      and ((j.status = 'queued' and h.official)
        or (j.status <> 'queued' and (h.approved or (j.owner_id = h.owner_id and j.host_choice = 'host' and j.requested_host = h.id))
          and (j.assigned_host = h.id
            or (j.assigned_host is null and ((j.host_choice = 'oddbout' and h.official)
              or (j.host_choice = 'host' and j.requested_host = h.id)
              or (j.host_choice = 'any' and h.accepts_any and public.af_generation_host_today(h.id) < h.daily_limit
                and (not h.official or not others or j.updated_at < now() - interval '3 minutes')))))))
    order by j.updated_at, j.id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.af_generation_jobs set lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', stage_leases = stage_leases + 1,
    assigned_host = case when status = 'queued' then assigned_host else coalesce(assigned_host, h.id) end
    where id = row.id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'claimed',
    jsonb_build_object('status', row.status, 'lease', row.stage_leases, 'host', h.id));
  return row;
end $$;

-- A request names where it goes: ODDBOUT (the default), one host on now, or any host. Naming another person's host needs that host approved
-- and the requester's consent (his words and pictures go to that host's PC); naming his own host needs neither.
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
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= 3 then raise exception 'fighter-quota'; end if;
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

-- 삭제: off every list and claim, keys off, join codes deleted. Refused while a request for him is not over (its files are on his PC).
create function public.af_generation_host_remove(p_owner uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts; revoked integer;
begin
  perform public.af_authorize(p_owner);
  select * into h from public.af_generation_hosts where owner_id = p_owner and removed_at is null for update;
  if not found then raise exception 'host-not-found'; end if;
  if exists(select 1 from public.af_generation_jobs j where (j.requested_host = h.id or j.assigned_host = h.id)
      and j.status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired')) then raise exception 'host-busy'; end if;
  update public.af_generation_hosts set removed_at = now(), enabled = false, approved = false, updated_at = now() where id = h.id;
  with gone as (update public.af_workers w set enabled = false where w.host_id = h.id and w.enabled returning 1)
    select count(*)::integer into revoked from gone;
  delete from public.af_generation_host_joins where host_id = h.id;
  return jsonb_build_object('host', h.id, 'revoked', revoked);
end $$;

-- The operator's list leaves removed hosts out, and approval does not bring one back.
create or replace function public.af_admin_generation_hosts(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'official', h.official, 'approved', h.approved,
      'enabled', h.enabled, 'acceptsAny', h.accepts_any, 'billing', h.billing, 'dailyLimit', h.daily_limit, 'today', public.af_generation_host_today(h.id),
      'live', public.af_generation_host_live(h), 'lastSeenAt', h.worker_seen_at, 'createdAt', h.created_at, 'email', u.email,
      'keys', (select count(*) from public.af_workers w where w.host_id = h.id and w.enabled and w.expires_at > now()))
      order by h.official desc, h.approved, h.created_at desc)
    from public.af_generation_hosts h left join auth.users u on u.id = h.owner_id where h.removed_at is null), '[]'::jsonb);
end $$;

create or replace function public.af_admin_generation_host_approval(p_actor uuid, p_host uuid, p_approved boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_approved is null then raise exception 'invalid-review'; end if;
  update public.af_generation_hosts set approved = p_approved, updated_at = now() where id = p_host and not official and removed_at is null returning * into h;
  if not found then raise exception 'not-found'; end if;
  return jsonb_build_object('id', h.id, 'approved', h.approved);
end $$;

revoke all on function public.af_generation_host_remove(uuid) from public, anon, authenticated;
grant execute on function public.af_generation_host_remove(uuid) to service_role;
