-- 내 선수는 내 PC로, 붙이기 코드 (커뮤니티 호스트, 2026-10-28). Design: game repo docs/Plan/2026-10-28-community-generation-hosts.
-- The first real host took three browser sign-ins, five commands and an operator's SQL before his PC made anything (사용자: "UX적으로 개선할
-- 수 없을까?" → "진행해줘"). Two changes:
--   1. A host who accepted the terms makes his own requests on his own PC without the operator's approval. His words and pictures do not
--      leave him, and his subscription pays, so there is nothing to approve. Approval is needed only to take other people's requests.
--   2. The site gives a signed-in host a one-time join code; his PC trades it for a worker key (`npm run host -- join <code>`), so the PC
--      needs no ODDBOUT sign-in at all and keeps a host key only, never the account's session.
-- The brief stays on the official host for every request.

-- On now: switched on, a heartbeat within three minutes, a healthy last check. Whether he takes other people's requests is `approved` too.
create function public.af_generation_host_live(p_host public.af_generation_hosts) returns boolean language sql stable set search_path = '' as $$
  select p_host.enabled and p_host.worker_seen_at > now() - interval '3 minutes' and coalesce((p_host.worker_health->>'ok')::boolean, false);
$$;
create or replace function public.af_generation_host_online(p_host public.af_generation_hosts) returns boolean language sql stable set search_path = '' as $$
  select p_host.approved and public.af_generation_host_live(p_host);
$$;

-- One stage of one job for one host (no host: the official one). The brief only on the official host. After it, a job its host already
-- took; or a new one: a request to ODDBOUT (official), one that named this host, or an open one he accepts within his daily limit. The
-- official host leaves open jobs to the other hosts for three minutes while one of them could take them. A host not approved takes only
-- the requests he made himself and named himself for.
create or replace function public.af_generation_claim_for(p_host uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; h public.af_generation_hosts; others boolean;
begin
  select * into h from public.af_generation_hosts where id = coalesce(p_host, public.af_generation_official());
  if not found or not h.enabled or not (h.approved or h.terms_accepted_at is not null) then return null; end if;
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
    select * into named from public.af_generation_hosts where id = p_host;
    if not found or named.official then raise exception 'invalid-host'; end if;
    own := named.owner_id = p_owner;
    if not (own or named.approved) then raise exception 'invalid-host'; end if;
  end if;
  if choice <> 'oddbout' and not own and not coalesce(p_host_consent, false) then raise exception 'host-consent-required'; end if;
  if exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and not public.af_generation_freed(j))
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

-- A worker key for a host who accepted the terms (the API keeps only its hash), two live keys at most, ninety days each. Not approved, the key
-- takes his own requests only (`af_generation_claim_for`).
create or replace function public.af_generation_host_key(p_owner uuid, p_hash text, p_label text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts; expires timestamptz := now() + interval '90 days';
begin
  perform public.af_authorize(p_owner);
  select * into h from public.af_generation_hosts where owner_id = p_owner;
  if not found or h.terms_accepted_at is null then raise exception 'host-not-found'; end if;
  if (select count(*) from public.af_workers w where w.host_id = h.id and w.enabled and w.expires_at > now()) >= 2 then raise exception 'host-key-limit'; end if;
  insert into public.af_workers(token_hash, label, scope, host_id, expires_at) values (p_hash, left(coalesce(p_label, 'host'), 60), 'generation', h.id, expires);
  return jsonb_build_object('host', h.id, 'expiresAt', expires);
end $$;

-- Join codes: the site makes one for a signed-in host; his PC trades it, once, within thirty minutes, for a worker key. Only hashes are kept.
create table public.af_generation_host_joins (
  code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
  host_id uuid not null references public.af_generation_hosts(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index af_generation_host_joins_host on public.af_generation_host_joins(host_id, created_at);
alter table public.af_generation_host_joins enable row level security;
revoke all on table public.af_generation_host_joins from public, anon, authenticated;
grant select, insert, update, delete on table public.af_generation_host_joins to service_role;

create function public.af_generation_host_join_code(p_owner uuid, p_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts; expires timestamptz := now() + interval '30 minutes';
begin
  perform public.af_authorize(p_owner);
  select * into h from public.af_generation_hosts where owner_id = p_owner;
  if not found or h.terms_accepted_at is null then raise exception 'host-not-found'; end if;
  delete from public.af_generation_host_joins where host_id = h.id and (used_at is not null or expires_at < now());
  if (select count(*) from public.af_generation_host_joins where host_id = h.id and created_at > now() - interval '1 hour') >= 5 then raise exception 'rate-limit'; end if;
  insert into public.af_generation_host_joins(code_hash, host_id, expires_at) values (p_hash, h.id, expires);
  return jsonb_build_object('host', h.id, 'expiresAt', expires);
end $$;

-- A PC trades a join code for a worker key. A third live key retires the oldest: joining a new PC is the owner's own act on the site.
create function public.af_generation_host_join(p_code_hash text, p_key_hash text, p_label text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_host_joins; h public.af_generation_hosts; expires timestamptz := now() + interval '90 days';
begin
  update public.af_generation_host_joins set used_at = now() where code_hash = p_code_hash and used_at is null and expires_at > now() returning * into j;
  if not found then raise exception 'join-code-invalid'; end if;
  select * into h from public.af_generation_hosts where id = j.host_id;
  if not exists(select 1 from public.af_creators c where c.owner_id = h.owner_id and c.enabled) then raise exception 'account-disabled'; end if;
  -- Host keys all live ninety days, so the latest to expire is the newest.
  update public.af_workers set enabled = false where token_hash in (select w.token_hash from public.af_workers w
    where w.host_id = h.id and w.enabled and w.expires_at > now() order by w.expires_at desc offset 1);
  insert into public.af_workers(token_hash, label, scope, host_id, expires_at) values (p_key_hash, left(coalesce(p_label, 'host-join'), 60), 'generation', h.id, expires);
  return jsonb_build_object('host', h.id, 'name', h.name, 'approved', h.approved, 'expiresAt', expires);
end $$;

revoke all on function public.af_generation_host_live(public.af_generation_hosts), public.af_generation_host_join_code(uuid, text),
  public.af_generation_host_join(text, text, text) from public, anon, authenticated;
grant execute on function public.af_generation_host_live(public.af_generation_hosts), public.af_generation_host_join_code(uuid, text),
  public.af_generation_host_join(text, text, text) to service_role;
