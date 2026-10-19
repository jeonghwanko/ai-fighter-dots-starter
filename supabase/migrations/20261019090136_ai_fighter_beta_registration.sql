-- Additive, invite-only beta. Existing game auth, tables and storage policies are untouched.
create table public.af_settings (
  singleton boolean primary key default true check (singleton),
  paused boolean not null default false,
  max_reserved_bytes bigint not null default 100000000 check (max_reserved_bytes between 1 and 400000000)
);
insert into public.af_settings(singleton) values (true);

create table public.af_creators (
  owner_id uuid primary key references auth.users(id),
  enabled boolean not null default true,
  expires_at timestamptz not null default now() + interval '30 days',
  request_window timestamptz not null default now(), request_count integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.af_workers (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  label text not null, enabled boolean not null default true,
  expires_at timestamptz not null default now() + interval '30 days'
);
create table public.af_submissions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.af_creators(owner_id),
  idempotency_key uuid not null, manifest_text text not null check (octet_length(manifest_text) <= 262144),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  manifest_sha text not null check (manifest_sha ~ '^[a-f0-9]{64}$'),
  asset_bytes bigint not null check (asset_bytes between 1 and 10000000),
  status text not null default 'uploading' check (status in ('uploading','queued','validating','registered','rejected')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '24 hours',
  lease_token uuid, lease_until timestamptz, attempts integer not null default 0,
  validation jsonb, fighter_id uuid,
  unique(owner_id, idempotency_key)
);
create index af_submissions_queue on public.af_submissions(status,created_at) where status in ('queued','validating');
create function public.af_immutable_submission() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.owner_id,new.idempotency_key,new.manifest_text,new.manifest,new.manifest_sha,new.asset_bytes)
     is distinct from row(old.owner_id,old.idempotency_key,old.manifest_text,old.manifest,old.manifest_sha,old.asset_bytes)
    then raise exception 'immutable-submission'; end if;
  return new;
end $$;
revoke all on function public.af_immutable_submission() from public,anon,authenticated;
grant execute on function public.af_immutable_submission() to service_role;
create trigger af_submission_immutable before update on public.af_submissions for each row execute function public.af_immutable_submission();
create table public.af_fighters (
  id uuid primary key default gen_random_uuid(), submission_id uuid not null unique references public.af_submissions(id),
  owner_id uuid not null unique references public.af_creators(owner_id),
  manifest_sha text not null, profile jsonb not null,
  status text not null default 'registered' check (status = 'registered'),
  review_state text not null default 'pending' check (review_state = 'pending'),
  runtime_approved boolean not null default false check (not runtime_approved),
  created_at timestamptz not null default now()
);

alter table public.af_settings enable row level security;
alter table public.af_creators enable row level security;
alter table public.af_workers enable row level security;
alter table public.af_submissions enable row level security;
alter table public.af_fighters enable row level security;
revoke all on public.af_settings,public.af_creators,public.af_workers,public.af_submissions,public.af_fighters from public,anon,authenticated;
grant all on public.af_settings,public.af_creators,public.af_workers,public.af_submissions,public.af_fighters to service_role;
grant select on public.af_submissions,public.af_fighters to authenticated;
create policy af_submissions_read_own on public.af_submissions for select to authenticated using ((select auth.uid()) = owner_id);
create policy af_fighters_read_own on public.af_fighters for select to authenticated using ((select auth.uid()) = owner_id);
create policy af_settings_service on public.af_settings for all to service_role using (true) with check (true);
create policy af_creators_service on public.af_creators for all to service_role using (true) with check (true);
create policy af_workers_service on public.af_workers for all to service_role using (true) with check (true);

-- No client Storage policies: only the authenticated Edge API and the server worker can access this bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('ai-fighter-beta','ai-fighter-beta',false,4000000,array['image/webp']);

create function public.af_authorize(p_owner uuid) returns boolean language plpgsql security invoker set search_path = '' as $$
declare c public.af_creators;
begin
  select * into c from public.af_creators where owner_id=p_owner for update;
  if not found or not c.enabled or c.expires_at <= now() then raise exception 'invite-required'; end if;
  if c.request_window < now()-interval '1 minute' then
    update public.af_creators set request_window=now(),request_count=1 where owner_id=p_owner;
  elsif c.request_count >= 120 then raise exception 'rate-limit';
  else update public.af_creators set request_count=request_count+1 where owner_id=p_owner; end if;
  return true;
end $$;

create function public.af_create_submission(p_owner uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; settings public.af_settings; declared bigint;
begin
  select * into settings from public.af_settings where singleton for update;
  select * into s from public.af_submissions where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if s.manifest_sha<>p_sha or s.manifest_text<>p_text then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if settings.paused then raise exception 'submissions-paused'; end if;
  if not exists(select 1 from public.af_creators where owner_id=p_owner and enabled and expires_at>now()) then raise exception 'invite-required'; end if;
  if (select count(*) from public.af_creators where enabled and expires_at>now()) > 20 then raise exception 'beta-capacity'; end if;
  if exists(select 1 from public.af_fighters where owner_id=p_owner) then raise exception 'fighter-quota'; end if;
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  if (select count(*) from public.af_submissions where owner_id=p_owner) >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::bigint) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Reservations count even expired/rejected records until an operator removes their objects and records together.
  if (select coalesce(sum(asset_bytes),0) from public.af_submissions)+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes) returning * into s;
  return s;
end $$;

create function public.af_submit(p_owner uuid,p_id uuid) returns public.af_submissions
language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; a jsonb; key text;
begin
  select * into s from public.af_submissions where id=p_id and owner_id=p_owner for update;
  if not found then raise exception 'not-found'; end if;
  if s.status<>'uploading' then return s; end if;
  if s.expires_at<=now() then raise exception 'upload-expired'; end if;
  for a in select * from jsonb_array_elements(s.manifest->'assets') loop
    key := s.owner_id::text||'/'||s.id::text||'/'||(a->>'id')||'.webp';
    if not exists(select 1 from storage.objects o where o.bucket_id='ai-fighter-beta' and o.name=key and (o.metadata->>'size')::bigint=(a->>'bytes')::bigint)
      then raise exception 'assets-incomplete'; end if;
  end loop;
  update public.af_submissions set status='queued' where id=s.id returning * into s;
  return s;
end $$;

create function public.af_claim(p_id uuid default null) returns public.af_submissions
language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions;
begin
  -- A dead worker cannot leave a job in a permanently unclaimable state.
  update public.af_submissions set status='rejected',validation='{"code":"worker-attempt-limit"}'::jsonb
    where status='validating' and lease_until<now() and attempts>=3;
  select * into s from public.af_submissions
    where (p_id is null or id=p_id) and (status='queued' or (status='validating' and lease_until<now())) and attempts<3
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.af_submissions set status='validating',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
    where id=s.id returning * into s;
  return s;
end $$;

create function public.af_finish(p_id uuid,p_lease uuid,p_sha text,p_passed boolean,p_result jsonb)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; f public.af_fighters;
begin
  select * into s from public.af_submissions where id=p_id for update;
  if not found then raise exception 'not-found'; end if;
  if s.lease_token is distinct from p_lease or s.manifest_sha<>p_sha then raise exception 'stale-validation'; end if;
  if s.status in ('registered','rejected') then return s; end if;
  if s.status<>'validating' or s.lease_until<=now() then raise exception 'stale-validation'; end if;
  if p_result->>'validatorVersion' <> 'ai-fighter-validator-0.2.0' or p_result->>'validatorVersion' is null then raise exception 'validator-version'; end if;
  if octet_length(p_result::text)>16000 then raise exception 'validation-result-limit'; end if;
  if p_passed then
    if p_result->>'stage'<>'bytes-hashes-and-full-decode' or p_result->>'stage' is null then raise exception 'validation-incomplete'; end if;
    insert into public.af_fighters(submission_id,owner_id,manifest_sha,profile) values(s.id,s.owner_id,s.manifest_sha,s.manifest->'profile')
      on conflict(submission_id) do nothing;
    select * into f from public.af_fighters where submission_id=s.id;
    update public.af_submissions set status='registered',fighter_id=f.id,validation=p_result where id=s.id returning * into s;
  else
    update public.af_submissions set status='rejected',validation=p_result where id=s.id returning * into s;
  end if;
  return s;
end $$;

-- Authenticated clients cannot call privileged state transitions or choose an owner ID.
revoke all on function public.af_authorize(uuid),public.af_create_submission(uuid,uuid,text,text,bigint),public.af_submit(uuid,uuid),public.af_claim(uuid),public.af_finish(uuid,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.af_authorize(uuid),public.af_create_submission(uuid,uuid,text,text,bigint),public.af_submit(uuid,uuid),public.af_claim(uuid),public.af_finish(uuid,uuid,text,boolean,jsonb) to service_role;
