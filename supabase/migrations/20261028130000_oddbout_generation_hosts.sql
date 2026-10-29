-- 커뮤니티 호스트 (2026-10-28): a creator who is willing to spend his own GPT and Grok subscription (or API keys) runs the generation worker
-- on his own PC and makes fighters other people ask for. ODDBOUT's office PC becomes one host among them, the official one.
-- Design: game repo docs/Plan/2026-10-28-community-generation-hosts. 사용자 결정(추천안):
--   1. A host chooses subscription or API key; the providers' terms are the host's to keep (he accepts this when he applies).
--   2. The brief — the safety check of the request — stays on ODDBOUT's own worker: only the official host claims a queued job.
--   3. Only hosts the operator approved take work. A request names ODDBOUT (the default), one host, or any host; naming a host or any host
--      needs the requester's consent that his words and pictures go to that host's PC.
--   4. Rewards are credit and gold, not money (later stages).
-- A job a host took stays with him to the end: its files are on his PC. Hosts are written only through the API (service role).

create table public.af_generation_hosts (
  id uuid primary key default gen_random_uuid(),
  -- The official host (ODDBOUT's office PC) has no owner; every other host is one creator's.
  owner_id uuid unique references public.af_creators(owner_id),
  official boolean not null default false,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  -- The operator's approval; the host's own switch; whether he takes requests that name no host.
  approved boolean not null default false,
  enabled boolean not null default true,
  accepts_any boolean not null default true,
  billing text not null check (billing in ('subscription', 'api-key')),
  -- Jobs a day: the requests that named him and the open ones he took.
  daily_limit integer not null default 5 check (daily_limit between 0 and 50),
  terms_accepted_at timestamptz,
  worker_seen_at timestamptz,
  worker_health jsonb not null default '{}'::jsonb check (jsonb_typeof(worker_health) = 'object' and octet_length(worker_health::text) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (official = (owner_id is null))
);
create unique index af_generation_hosts_official on public.af_generation_hosts(official) where official;
-- The office PC, with the heartbeat and the daily limit it had. `af_generation_settings` keeps the service switch (`enabled`) only.
insert into public.af_generation_hosts(official, name, approved, billing, daily_limit, terms_accepted_at, worker_seen_at, worker_health)
  select true, 'ODDBOUT', true, 'subscription', least(s.daily_limit, 50), now(), s.worker_seen_at, s.worker_health
  from public.af_generation_settings s where s.singleton;

-- A generation key belongs to a host; one without (the office PC's, issued before hosts) is the official host's.
alter table public.af_workers add column host_id uuid references public.af_generation_hosts(id) on delete cascade;
alter table public.af_workers add constraint af_workers_host_scope check (host_id is null or scope = 'generation');

-- Where a request goes (`host_choice`), the host it named, the host that took it (after the brief), and the requester's consent.
alter table public.af_generation_jobs
  add column host_choice text not null default 'oddbout' check (host_choice in ('oddbout', 'any', 'host')),
  add column requested_host uuid references public.af_generation_hosts(id),
  add column assigned_host uuid references public.af_generation_hosts(id),
  add column host_consent boolean not null default false,
  add constraint af_generation_jobs_host_named check ((host_choice = 'host') = (requested_host is not null));
-- Jobs past their brief ran on the office PC.
update public.af_generation_jobs set assigned_host = (select id from public.af_generation_hosts where official)
  where status <> 'queued' and brief is not null;

alter table public.af_generation_hosts enable row level security;
revoke all on table public.af_generation_hosts from public, anon, authenticated;
grant select, insert, update, delete on table public.af_generation_hosts to service_role;

create function public.af_generation_official() returns uuid language sql stable set search_path = '' as $$
  select id from public.af_generation_hosts where official;
$$;

-- Approved, switched on, a heartbeat within three minutes and a healthy last check.
create function public.af_generation_host_online(p_host public.af_generation_hosts) returns boolean language sql stable set search_path = '' as $$
  select p_host.approved and p_host.enabled and p_host.worker_seen_at > now() - interval '3 minutes'
    and coalesce((p_host.worker_health->>'ok')::boolean, false);
$$;

-- A host's jobs of the last day toward his daily limit: the requests that named him and the jobs he took (the official host: the
-- requests to ODDBOUT, as the service's daily limit counted them before hosts).
create function public.af_generation_host_today(p_host uuid) returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.af_generation_jobs j, public.af_generation_hosts h
  where h.id = p_host and j.created_at > now() - interval '1 day' and public.af_generation_counted(j.status, j.brief)
    and (j.assigned_host = p_host or j.requested_host = p_host or (h.official and j.host_choice = 'oddbout'));
$$;

-- Whether a request to ODDBOUT can be made now, as before (the official host's heartbeat and limit), and how many other hosts are on.
-- Every request needs the official host: the brief runs there.
create or replace function public.af_generation_capabilities() returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'hosted', s.enabled and public.af_generation_host_online(o),
    'reason', case when not s.enabled then 'disabled' when o.worker_seen_at is null or o.worker_seen_at <= now() - interval '3 minutes' then 'worker-offline'
      when not coalesce((o.worker_health->>'ok')::boolean, false) then 'provider-unavailable' end,
    'queue', (select count(*) from public.af_generation_jobs j where public.af_generation_working(j.status)),
    'dailyLimit', o.daily_limit,
    'today', public.af_generation_host_today(o.id),
    'hosts', (select count(*) from public.af_generation_hosts h where not h.official and public.af_generation_host_online(h)))
  from public.af_generation_settings s, public.af_generation_hosts o where s.singleton and o.official;
$$;

-- The approved hosts a requester may name, for the site and the agents. Nothing about billing or health beyond on/off.
create function public.af_generation_hosts_public() returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'official', h.official, 'online', public.af_generation_host_online(h),
      'acceptsAny', h.accepts_any, 'todayLeft', greatest(h.daily_limit - public.af_generation_host_today(h.id), 0)) order by h.official desc, h.name), '[]'::jsonb)
  from public.af_generation_hosts h where h.approved and h.enabled;
$$;

-- A host's worker reports in (no host: the official one).
create function public.af_generation_host_heartbeat(p_host uuid, p_health jsonb) returns jsonb language sql security invoker set search_path = '' as $$
  update public.af_generation_hosts set worker_seen_at = now(), worker_health = coalesce(p_health, '{}'::jsonb)
    where id = coalesce(p_host, public.af_generation_official());
  select public.af_generation_capabilities();
$$;
create or replace function public.af_generation_heartbeat(p_health jsonb) returns jsonb language sql security invoker set search_path = '' as $$
  select public.af_generation_host_heartbeat(null, p_health);
$$;

-- Progress is also the heartbeat of the host holding the stage.
create or replace function public.af_generation_progress(p_id uuid, p_token uuid, p_progress integer, p_event jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token);
begin
  update public.af_generation_jobs set lease_expires_at = now() + interval '5 minutes', progress = least(greatest(coalesce(p_progress, progress), 0), 100),
    updated_at = now() where id = p_id returning * into row;
  update public.af_generation_hosts set worker_seen_at = now() where id = coalesce(row.assigned_host, public.af_generation_official());
  if p_event is not null then insert into public.af_generation_events(job_id, kind, data) values (p_id, left(coalesce(p_event->>'kind', 'progress'), 40), p_event); end if;
  return row;
end $$;

-- One stage of one job for one host (no host: the official one). The brief only on the official host. After it, a job its host already
-- took; or a new one: a request to ODDBOUT (official), one that named this host, or an open one he accepts within his daily limit. The
-- official host leaves open jobs to the other hosts for three minutes while one of them could take them.
create function public.af_generation_claim_for(p_host uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; h public.af_generation_hosts; others boolean;
begin
  select * into h from public.af_generation_hosts where id = coalesce(p_host, public.af_generation_official());
  if not found or not h.approved or not h.enabled then return null; end if;
  perform public.af_generation_expire();
  update public.af_generation_jobs set status = 'failed', error_code = 'stage-attempts', lease_token = null, lease_expires_at = null, updated_at = now()
    where public.af_generation_working(status) and stage_leases >= 3 and coalesce(lease_expires_at, '-infinity') < now();
  others := exists(select 1 from public.af_generation_hosts o where not o.official and o.accepts_any and public.af_generation_host_online(o)
    and public.af_generation_host_today(o.id) < o.daily_limit);
  select j.* into row from public.af_generation_jobs j
    where public.af_generation_working(j.status) and (j.lease_expires_at is null or j.lease_expires_at < now())
      and ((j.status = 'queued' and h.official)
        or (j.status <> 'queued' and (j.assigned_host = h.id
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
create or replace function public.af_generation_claim() returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs;
begin
  select * into row from public.af_generation_claim_for(null);
  return row;
end $$;

-- A request names where it goes: ODDBOUT (the default and the only choice before hosts), one approved host on now, or any host. The two
-- last need the requester's consent (his words and pictures go to that host's PC) and a host with room today.
drop function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean);
create function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean,
  p_delegate boolean default false, p_host_choice text default 'oddbout', p_host uuid default null, p_host_consent boolean default false)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; caps jsonb; refs uuid[] := coalesce(p_refs, '{}'); choice text := coalesce(p_host_choice, 'oddbout');
  named public.af_generation_hosts;
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  select * into row from public.af_generation_jobs where owner_id = p_owner and idempotency_key = p_key;
  if found then return row; end if;
  caps := public.af_generation_capabilities();
  if not (caps->>'hosted')::boolean then raise exception 'generation-unavailable'; end if;
  if choice not in ('oddbout', 'any', 'host') or (choice = 'host') <> (p_host is not null) then raise exception 'invalid-host'; end if;
  if choice <> 'oddbout' and not coalesce(p_host_consent, false) then raise exception 'host-consent-required'; end if;
  if exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and not public.af_generation_freed(j))
    then raise exception 'generation-quota'; end if;
  if (select count(*) from public.af_generation_jobs where owner_id = p_owner and created_at > now() - interval '1 day') >= 3
    then raise exception 'rate-limit'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= 3 then raise exception 'fighter-quota'; end if;
  perform pg_advisory_xact_lock(74280503);
  if choice = 'oddbout' and (caps->>'today')::integer >= (caps->>'dailyLimit')::integer then raise exception 'generation-capacity'; end if;
  if choice = 'host' then
    select * into named from public.af_generation_hosts where id = p_host;
    if not found or named.official then raise exception 'invalid-host'; end if;
    if not public.af_generation_host_online(named) then raise exception 'host-offline'; end if;
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
    jsonb_build_object('refs', cardinality(refs), 'delegate', coalesce(p_delegate, false), 'host', choice));
  return row;
end $$;

-- A creator applies to host (or changes his name or billing): accepted terms, not approved until the operator approves him.
create function public.af_generation_host_apply(p_owner uuid, p_name text, p_billing text, p_terms boolean) returns public.af_generation_hosts
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_hosts;
begin
  perform public.af_authorize(p_owner);
  if not coalesce(p_terms, false) then raise exception 'host-terms-required'; end if;
  if p_billing not in ('subscription', 'api-key') or char_length(btrim(coalesce(p_name, ''))) not between 2 and 40 then raise exception 'invalid-host'; end if;
  insert into public.af_generation_hosts(owner_id, name, billing, terms_accepted_at) values (p_owner, btrim(p_name), p_billing, now())
    on conflict (owner_id) do update set name = excluded.name, billing = excluded.billing, terms_accepted_at = now(), updated_at = now()
    returning * into row;
  return row;
end $$;

-- A host's own switches: on or paused, open requests or only his own, his daily limit.
create function public.af_generation_host_update(p_owner uuid, p_enabled boolean, p_accepts_any boolean, p_daily_limit integer)
returns public.af_generation_hosts language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_hosts;
begin
  perform public.af_authorize(p_owner);
  if p_daily_limit is not null and p_daily_limit not between 0 and 50 then raise exception 'invalid-host'; end if;
  update public.af_generation_hosts set enabled = coalesce(p_enabled, enabled), accepts_any = coalesce(p_accepts_any, accepts_any),
    daily_limit = coalesce(p_daily_limit, daily_limit), updated_at = now() where owner_id = p_owner returning * into row;
  if not found then raise exception 'not-found'; end if;
  return row;
end $$;

-- A worker key for an approved host (the API keeps only its hash); two live keys at most, ninety days each.
create function public.af_generation_host_key(p_owner uuid, p_hash text, p_label text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts; expires timestamptz := now() + interval '90 days';
begin
  perform public.af_authorize(p_owner);
  select * into h from public.af_generation_hosts where owner_id = p_owner;
  if not found or not h.approved then raise exception 'host-not-approved'; end if;
  if (select count(*) from public.af_workers w where w.host_id = h.id and w.enabled and w.expires_at > now()) >= 2 then raise exception 'host-key-limit'; end if;
  insert into public.af_workers(token_hash, label, scope, host_id, expires_at) values (p_hash, left(coalesce(p_label, 'host'), 60), 'generation', h.id, expires);
  return jsonb_build_object('host', h.id, 'expiresAt', expires);
end $$;

-- Every key of the host switched off at once (a lost PC, a leaked key).
create function public.af_generation_host_revoke(p_owner uuid) returns integer language sql security invoker set search_path = '' as $$
  with gone as (update public.af_workers w set enabled = false
    where w.host_id = (select id from public.af_generation_hosts where owner_id = p_owner) and w.enabled returning 1)
  select count(*)::integer from gone;
$$;

revoke all on function public.af_generation_official(), public.af_generation_host_online(public.af_generation_hosts), public.af_generation_host_today(uuid),
  public.af_generation_hosts_public(), public.af_generation_host_heartbeat(uuid, jsonb), public.af_generation_claim_for(uuid),
  public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean),
  public.af_generation_host_apply(uuid, text, text, boolean), public.af_generation_host_update(uuid, boolean, boolean, integer),
  public.af_generation_host_key(uuid, text, text), public.af_generation_host_revoke(uuid) from public, anon, authenticated;
grant execute on function public.af_generation_official(), public.af_generation_host_online(public.af_generation_hosts), public.af_generation_host_today(uuid),
  public.af_generation_hosts_public(), public.af_generation_host_heartbeat(uuid, jsonb), public.af_generation_claim_for(uuid),
  public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean),
  public.af_generation_host_apply(uuid, text, text, boolean), public.af_generation_host_update(uuid, boolean, boolean, integer),
  public.af_generation_host_key(uuid, text, text), public.af_generation_host_revoke(uuid) to service_role;
