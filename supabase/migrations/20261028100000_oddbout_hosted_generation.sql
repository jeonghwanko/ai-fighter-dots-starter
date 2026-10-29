-- 호스팅 생성 (2026-10-27): a creator describes a fighter (and may add one or two reference pictures); our generation worker makes it with
-- the service's GPT and Grok subscriptions, the creator picks the look and checks the motions, and the package goes through the existing
-- submission and validation path under the creator's own account. Design: game repo docs/Plan/2026-10-26-hosted-fighter-generation.
--
-- One hosted fighter per account, free (사용자 결정 2026-10-27, "계정당 1명만 무료"): a request that is rejected, fails, is cancelled or
-- expires frees it again; three requests a day per account; a service-wide daily limit while the subscriptions' real limits are unknown.
-- Reference pictures from the start (사용자 결정, "처음부터 그림 1~2장"): uploaded first, kept private, the creator confirms his rights.
-- Written only through the API (service role, `p_owner` checked here); the worker has its own key (`af_workers.scope = 'generation'`).

alter table public.af_workers add column scope text not null default 'validation' check (scope in ('validation', 'generation'));

create table public.af_generation_settings (
  singleton boolean primary key default true check (singleton),
  -- Off until the operator turns it on; the worker's heartbeat and health keep it honest while on.
  enabled boolean not null default false,
  daily_limit integer not null default 3 check (daily_limit between 0 and 1000),
  worker_seen_at timestamptz,
  worker_health jsonb not null default '{}'::jsonb check (jsonb_typeof(worker_health) = 'object' and octet_length(worker_health::text) <= 2000)
);
insert into public.af_generation_settings(singleton) values (true);

-- queued: the brief (and the safety check of the words and pictures) waits for the worker; appearance: two candidate looks are being made;
-- appearance_ready: the creator picks one or asks a change; motions: the eleven motions are being made from the chosen look; motion_ready:
-- the creator checks them, asks one clip again or registers; submitting: the worker packs and submits the package; submitted: the existing
-- validation worker registers it. rejected (the safety check), failed, needs_review (an operator looks), cancelled, expired (a creator who
-- did not answer in seven days) end it.
create table public.af_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.af_creators(owner_id),
  idempotency_key uuid not null,
  status text not null default 'queued' check (status in ('queued', 'appearance', 'appearance_ready', 'motions', 'motion_ready', 'submitting',
    'submitted', 'rejected', 'failed', 'needs_review', 'cancelled', 'expired')),
  description text not null check (char_length(btrim(description)) between 10 and 600),
  language text not null check (language in ('ko', 'en')),
  refs_rights boolean not null default false,
  brief jsonb check (brief is null or jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 12000),
  -- Artifact names in the bucket (`jobs/<id>/<name>.webp`): the two candidates of the latest appearance round, the motion previews.
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) <= 2),
  choice text check (choice in ('a', 'b')),
  appearance_note text check (char_length(appearance_note) <= 200),
  appearance_revisions smallint not null default 0 check (appearance_revisions between 0 and 2),
  motion_note jsonb check (motion_note is null or jsonb_typeof(motion_note) = 'object' and char_length(motion_note->>'note') <= 200
    and octet_length(motion_note::text) <= 1200),
  motion_revisions smallint not null default 0 check (motion_revisions between 0 and 3),
  preview jsonb not null default '[]'::jsonb check (jsonb_typeof(preview) = 'array' and jsonb_array_length(preview) <= 20),
  profile jsonb check (profile is null or jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 8000),
  submission_id uuid references public.af_submissions(id),
  progress smallint not null default 0 check (progress between 0 and 100),
  error_code text check (char_length(error_code) <= 64),
  lease_token uuid,
  lease_expires_at timestamptz,
  -- Leases of the current stage: a stage that lost its worker three times is failed, never claimed forever.
  stage_leases smallint not null default 0,
  waiting_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);
create index af_generation_jobs_work on public.af_generation_jobs(updated_at) where status in ('queued', 'appearance', 'motions', 'submitting');
create index af_generation_jobs_owner on public.af_generation_jobs(owner_id, created_at desc);
create index af_generation_jobs_day on public.af_generation_jobs(created_at);

-- A reference picture uploaded before its request (the API checked its kind, size and dimensions and stored it privately).
create table public.af_generation_uploads (
  id uuid primary key,
  owner_id uuid not null references public.af_creators(owner_id),
  path text not null unique check (path ~ '^refs/[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|webp)$'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes integer not null check (bytes between 1 and 4000000),
  width integer not null check (width between 64 and 4096),
  height integer not null check (height between 64 and 4096),
  job_id uuid references public.af_generation_jobs(id) on delete set null,
  created_at timestamptz not null default now()
);
create index af_generation_uploads_owner on public.af_generation_uploads(owner_id, created_at desc);

-- What happened to a job, for the operator and the measurements: stages, provider calls, failures. No prompt, description or picture.
create table public.af_generation_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.af_generation_jobs(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (char_length(kind) between 1 and 40),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 2000)
);
create index af_generation_events_job on public.af_generation_events(job_id, at);

alter table public.af_generation_settings enable row level security;
alter table public.af_generation_jobs enable row level security;
alter table public.af_generation_uploads enable row level security;
alter table public.af_generation_events enable row level security;
revoke all on table public.af_generation_settings, public.af_generation_jobs, public.af_generation_uploads, public.af_generation_events
  from public, anon, authenticated;
grant select, insert, update, delete on table public.af_generation_settings, public.af_generation_jobs, public.af_generation_uploads,
  public.af_generation_events to service_role;

-- No client Storage policies: the API and the generation worker (through the API) are the only readers and writers.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('af-generation', 'af-generation', false, 8000000, array['image/png', 'image/jpeg', 'image/webp']);

-- The states the worker works in, and those that wait for the creator.
create function public.af_generation_working(p_status text) returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('queued', 'appearance', 'motions', 'submitting');
$$;

-- A job toward the service's daily limit: one the worker spent anything on (a refusal at the safety check, or a cancel before the
-- brief, costs the subscriptions nothing worth a slot).
create function public.af_generation_counted(p_status text, p_brief jsonb) returns boolean language sql immutable set search_path = '' as $$
  select p_status <> 'rejected' and not (p_status = 'cancelled' and p_brief is null);
$$;

-- A job that no longer holds its account's one hosted fighter: refused, failed, cancelled, expired, or submitted with a package that
-- failed its check.
create function public.af_generation_freed(p_job public.af_generation_jobs) returns boolean language sql stable set search_path = '' as $$
  select p_job.status in ('rejected', 'failed', 'cancelled', 'expired')
    or p_job.status = 'submitted' and exists(select 1 from public.af_submissions s where s.id = p_job.submission_id and s.status = 'rejected');
$$;

-- Whether a request can be made now (`hosted`), and why not: the switch, the worker's heartbeat (three minutes) and its last health check.
create function public.af_generation_capabilities() returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'hosted', s.enabled and s.worker_seen_at > now() - interval '3 minutes' and coalesce((s.worker_health->>'ok')::boolean, false),
    'reason', case when not s.enabled then 'disabled' when s.worker_seen_at is null or s.worker_seen_at <= now() - interval '3 minutes' then 'worker-offline'
      when not coalesce((s.worker_health->>'ok')::boolean, false) then 'provider-unavailable' end,
    'queue', (select count(*) from public.af_generation_jobs j where public.af_generation_working(j.status)),
    'dailyLimit', s.daily_limit,
    'today', (select count(*) from public.af_generation_jobs j where j.created_at > now() - interval '1 day' and public.af_generation_counted(j.status, j.brief)))
  from public.af_generation_settings s;
$$;

-- Jobs a creator left unanswered for seven days end (`expired`): their hosted fighter is free again.
create function public.af_generation_expire() returns integer language sql security invoker set search_path = '' as $$
  with gone as (update public.af_generation_jobs set status = 'expired', waiting_since = null, lease_token = null, lease_expires_at = null,
      updated_at = now()
    where status in ('appearance_ready', 'motion_ready') and waiting_since < now() - interval '7 days' returning id)
  select count(*)::integer from gone;
$$;

-- A reference picture the API stored (`p_id` names the object).
create function public.af_generation_upload(p_owner uuid, p_id uuid, p_path text, p_type text, p_bytes integer, p_width integer, p_height integer)
returns public.af_generation_uploads language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_uploads;
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280501));
  if (select count(*) from public.af_generation_uploads where owner_id = p_owner and created_at > now() - interval '1 day') >= 12
    then raise exception 'rate-limit'; end if;
  insert into public.af_generation_uploads(id, owner_id, path, content_type, bytes, width, height)
    values (p_id, p_owner, p_path, p_type, p_bytes, p_width, p_height) returning * into row;
  return row;
end $$;

-- A request: the description, its language, up to two of the creator's own unused uploads (with his confirmation of rights). Sent again
-- with its key it is the same request. One live hosted fighter per account; three requests a day per account; the service's daily limit.
create function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; caps jsonb; refs uuid[] := coalesce(p_refs, '{}');
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  select * into row from public.af_generation_jobs where owner_id = p_owner and idempotency_key = p_key;
  if found then return row; end if;
  caps := public.af_generation_capabilities();
  if not (caps->>'hosted')::boolean then raise exception 'generation-unavailable'; end if;
  if exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and not public.af_generation_freed(j))
    then raise exception 'generation-quota'; end if;
  if (select count(*) from public.af_generation_jobs where owner_id = p_owner and created_at > now() - interval '1 day') >= 3
    then raise exception 'rate-limit'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= 3 then raise exception 'fighter-quota'; end if;
  perform pg_advisory_xact_lock(74280503);
  if (select count(*) from public.af_generation_jobs where created_at > now() - interval '1 day' and public.af_generation_counted(status, brief))
      >= (caps->>'dailyLimit')::integer then raise exception 'generation-capacity'; end if;
  if cardinality(refs) > 2 or cardinality(refs) <> (select count(distinct x) from unnest(refs) x) then raise exception 'invalid-refs'; end if;
  if cardinality(refs) > 0 and not coalesce(p_rights, false) then raise exception 'rights-required'; end if;
  if (select count(*) from public.af_generation_uploads where id = any(refs) and owner_id = p_owner and job_id is null
      and created_at > now() - interval '1 day') <> cardinality(refs) then raise exception 'invalid-refs'; end if;
  insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, refs_rights)
    values (p_owner, p_key, btrim(p_description), p_language, cardinality(refs) > 0) returning * into row;
  update public.af_generation_uploads set job_id = row.id where id = any(refs);
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'created', jsonb_build_object('refs', cardinality(refs)));
  return row;
end $$;

-- The creator's own job, locked for his answer.
create function public.af_generation_own(p_owner uuid, p_id uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs;
begin
  perform public.af_authorize(p_owner);
  select * into row from public.af_generation_jobs where id = p_id and owner_id = p_owner for update;
  if not found then raise exception 'not-found'; end if;
  return row;
end $$;

-- His answer to the two looks: pick one (the motions start from it) or ask a change (two changes at most; a new pair is made).
create function public.af_generation_appearance(p_owner uuid, p_id uuid, p_choice text, p_note text)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_own(p_owner, p_id);
begin
  if row.status <> 'appearance_ready' then raise exception 'generation-state'; end if;
  if p_choice in ('a', 'b') and p_note is null then
    update public.af_generation_jobs set choice = p_choice, status = 'motions', waiting_since = null, progress = 0, stage_leases = 0, updated_at = now()
      where id = p_id returning * into row;
  elsif p_choice is null and char_length(btrim(coalesce(p_note, ''))) between 2 and 200 then
    if row.appearance_revisions >= 2 then raise exception 'revision-limit'; end if;
    update public.af_generation_jobs set appearance_note = btrim(p_note), appearance_revisions = appearance_revisions + 1, status = 'appearance',
      waiting_since = null, progress = 0, stage_leases = 0, updated_at = now() where id = p_id returning * into row;
  else raise exception 'invalid-answer'; end if;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'appearance-answer', jsonb_build_object('choice', p_choice, 'revise', p_note is not null));
  return row;
end $$;

-- His change to one motion (three changes in all): that clip is made again from the same look.
create function public.af_generation_motion(p_owner uuid, p_id uuid, p_clip text, p_note text)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_own(p_owner, p_id);
begin
  if row.status <> 'motion_ready' then raise exception 'generation-state'; end if;
  if p_clip !~ '^[a-zA-Z]{1,16}$' or char_length(btrim(coalesce(p_note, ''))) not between 2 and 200 then raise exception 'invalid-answer'; end if;
  if row.motion_revisions >= 3 then raise exception 'revision-limit'; end if;
  update public.af_generation_jobs set motion_note = jsonb_build_object('clip', p_clip, 'note', btrim(p_note)), motion_revisions = motion_revisions + 1,
    status = 'motions', waiting_since = null, progress = 0, stage_leases = 0, updated_at = now() where id = p_id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'motion-answer', jsonb_build_object('clip', p_clip));
  return row;
end $$;

-- He registers it: the profile he confirmed (the API checked it) goes into the package the worker submits under his account.
create function public.af_generation_register(p_owner uuid, p_id uuid, p_profile jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_own(p_owner, p_id);
begin
  if row.status <> 'motion_ready' then raise exception 'generation-state'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= 3 then raise exception 'fighter-quota'; end if;
  update public.af_generation_jobs set profile = p_profile, status = 'submitting', waiting_since = null, progress = 0, stage_leases = 0, updated_at = now()
    where id = p_id returning * into row;
  insert into public.af_generation_events(job_id, kind) values (p_id, 'register');
  return row;
end $$;

-- He stops it. Work under way ends at the worker's next report (its lease no longer matches a working state).
create function public.af_generation_cancel(p_owner uuid, p_id uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_own(p_owner, p_id);
begin
  if row.status in ('submitting', 'submitted', 'rejected', 'failed', 'cancelled', 'expired') then raise exception 'generation-state'; end if;
  update public.af_generation_jobs set status = 'cancelled', waiting_since = null, lease_token = null, lease_expires_at = null, updated_at = now()
    where id = p_id returning * into row;
  insert into public.af_generation_events(job_id, kind) values (p_id, 'cancelled');
  return row;
end $$;

-- The worker: alive, and what its last real provider calls said (`ok`, per provider).
create function public.af_generation_heartbeat(p_health jsonb) returns jsonb language sql security invoker set search_path = '' as $$
  update public.af_generation_settings set worker_seen_at = now(), worker_health = coalesce(p_health, '{}'::jsonb);
  select public.af_generation_capabilities();
$$;

-- One stage of one job, leased for five minutes (`af_generation_progress` extends it). The oldest waiting work first. A stage leased three
-- times (lost leases and handed-back retries alike) is failed rather than claimed again.
create function public.af_generation_claim() returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs;
begin
  perform public.af_generation_expire();
  update public.af_generation_jobs set status = 'failed', error_code = 'stage-attempts', lease_token = null, lease_expires_at = null, updated_at = now()
    where public.af_generation_working(status) and stage_leases >= 3 and coalesce(lease_expires_at, '-infinity') < now();
  select * into row from public.af_generation_jobs where public.af_generation_working(status) and (lease_expires_at is null or lease_expires_at < now())
    order by updated_at, id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.af_generation_jobs set lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', stage_leases = stage_leases + 1
    where id = row.id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'claimed', jsonb_build_object('status', row.status, 'lease', row.stage_leases));
  return row;
end $$;

-- The job the worker holds, locked; refused when his lease is gone or the job left the stage (cancelled meanwhile).
create function public.af_generation_held(p_id uuid, p_token uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs;
begin
  select * into row from public.af_generation_jobs where id = p_id for update;
  if not found or row.lease_token is distinct from p_token or not public.af_generation_working(row.status) then raise exception 'lease-lost'; end if;
  return row;
end $$;

-- Still working: the lease runs five more minutes; the progress (0-100) and a stage note (no prompt text) are kept. It also counts as the
-- worker's heartbeat (a stage may run longer than the three minutes `hosted` allows between heartbeats).
create function public.af_generation_progress(p_id uuid, p_token uuid, p_progress integer, p_event jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token);
begin
  update public.af_generation_jobs set lease_expires_at = now() + interval '5 minutes', progress = least(greatest(coalesce(p_progress, progress), 0), 100),
    updated_at = now() where id = p_id returning * into row;
  update public.af_generation_settings set worker_seen_at = now();
  if p_event is not null then insert into public.af_generation_events(job_id, kind, data) values (p_id, left(coalesce(p_event->>'kind', 'progress'), 40), p_event); end if;
  return row;
end $$;

-- A stage ends. `p_outcome`: ok (with the stage's result), rejected (the brief's safety check), review (an operator looks), failed, or
-- retry (the lease is handed back; the stage is claimed again after two minutes, and counts toward its three leases).
create function public.af_generation_finish(p_id uuid, p_token uuid, p_outcome text, p_result jsonb)
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
    update public.af_generation_jobs set candidates = result->'candidates', choice = null, appearance_note = null, status = 'appearance_ready',
      waiting_since = now(), progress = 100, stage_leases = 0, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
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
    jsonb_build_object('outcome', p_outcome, 'status', row.status, 'code', result->>'code', 'calls', result->'calls'));
  return row;
end $$;

revoke all on function public.af_generation_counted(text, jsonb), public.af_generation_freed(public.af_generation_jobs) from public, anon, authenticated;
grant execute on function public.af_generation_counted(text, jsonb), public.af_generation_freed(public.af_generation_jobs) to service_role;
revoke all on function public.af_generation_working(text), public.af_generation_capabilities(), public.af_generation_expire(),
  public.af_generation_upload(uuid, uuid, text, text, integer, integer, integer), public.af_generation_create(uuid, uuid, text, text, uuid[], boolean),
  public.af_generation_own(uuid, uuid), public.af_generation_appearance(uuid, uuid, text, text), public.af_generation_motion(uuid, uuid, text, text),
  public.af_generation_register(uuid, uuid, jsonb), public.af_generation_cancel(uuid, uuid), public.af_generation_heartbeat(jsonb),
  public.af_generation_claim(), public.af_generation_held(uuid, uuid), public.af_generation_progress(uuid, uuid, integer, jsonb),
  public.af_generation_finish(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.af_generation_working(text), public.af_generation_capabilities(), public.af_generation_expire(),
  public.af_generation_upload(uuid, uuid, text, text, integer, integer, integer), public.af_generation_create(uuid, uuid, text, text, uuid[], boolean),
  public.af_generation_own(uuid, uuid), public.af_generation_appearance(uuid, uuid, text, text), public.af_generation_motion(uuid, uuid, text, text),
  public.af_generation_register(uuid, uuid, jsonb), public.af_generation_cancel(uuid, uuid), public.af_generation_heartbeat(jsonb),
  public.af_generation_claim(), public.af_generation_held(uuid, uuid), public.af_generation_progress(uuid, uuid, integer, jsonb),
  public.af_generation_finish(uuid, uuid, text, jsonb) to service_role;
