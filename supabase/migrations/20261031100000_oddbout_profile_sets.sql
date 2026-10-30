-- 선수 프로필 세트 (2026-10-31 사용자: "Fighter를 만든 사람이 홈페이지에 예쁘게 보이게 구독으로 수정해서 올리게 하자", "2차가 완성되어야
-- 홈페이지에 올라가게"): a registered fighter's front painting and its face square, outside his duel package. The package hash, the engine
-- name and the duel record do not change when the painting does. The owner uploads the set to his registered fighter; the validator decodes
-- it and makes two derived files (a 600-px card and a 192-px face); an operator approves it; the approved derived files are copied to the
-- public bucket `af-profile-sets` and the roster names them. Plan: crashbang-heroes docs/Plan/2026-10-31-oddbout-profile-set/README.md.

-- The entry gate's switch: a fighter registered at or after this time needs a validated set to enter. Null (the default) turns it off.
alter table public.af_settings add column profile_set_required_after timestamptz;

create table public.af_profile_sets (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.af_fighters(id),
  owner_id uuid not null references public.af_creators(owner_id),
  idempotency_key uuid not null,
  status text not null default 'uploading'
    -- withdrawn: his fighter was deleted or removed by an operator while the set was open or approved.
    check (status in ('uploading', 'queued', 'validating', 'review', 'approved', 'rejected', 'superseded', 'withdrawn')),
  manifest_text text not null check (octet_length(manifest_text) <= 4000),
  manifest_sha text not null check (manifest_sha ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null,
  -- The validator's derived files: { card: { sha256, bytes, width, height, face: { x, y, side } }, face: { sha256, bytes, size } }.
  derived jsonb,
  validation jsonb,
  reason text check (reason is null or char_length(reason) <= 500),
  lease_token uuid, lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  infra_failures integer not null default 0 check (infra_failures >= 0),
  expires_at timestamptz not null default now() + interval '1 day',
  created_at timestamptz not null default now(),
  submitted_at timestamptz, validated_at timestamptz,
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz, approved_at timestamptz,
  -- When the API removed the public copies of a set that was approved and no longer is (af_profile_set_stale_public).
  unpublished_at timestamptz,
  unique (owner_id, idempotency_key),
  check (status <> 'approved' or derived is not null)
);
create index af_profile_sets_queue on public.af_profile_sets(created_at) where status in ('queued', 'validating');
create index af_profile_sets_fighter on public.af_profile_sets(fighter_id, created_at desc);
create index af_profile_sets_review on public.af_profile_sets(validated_at) where status = 'review';

alter table public.af_profile_sets enable row level security;
revoke all on public.af_profile_sets from public, anon, authenticated;
grant all on public.af_profile_sets to service_role;
grant select on public.af_profile_sets to authenticated;
create policy af_profile_sets_read_own on public.af_profile_sets for select to authenticated using ((select auth.uid()) = owner_id);

-- His current approved set. The approve and reject functions write it; deletion and an operator's removal clear it.
alter table public.af_fighters add column profile_set_id uuid references public.af_profile_sets(id);

-- What happened to a set outside its own row: approvals, rejections, withdrawals and a public copy the API could not remove (it retries at
-- the next cleanup). Service role only.
create table public.af_profile_set_events (
  id bigint generated always as identity primary key,
  fighter_id uuid not null references public.af_fighters(id),
  profile_set_id uuid references public.af_profile_sets(id),
  actor uuid references auth.users(id),
  kind text not null check (kind in ('approve', 'reject', 'withdraw', 'public-cleanup-failed')),
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) <= 4000),
  created_at timestamptz not null default now()
);
create index af_profile_set_events_fighter on public.af_profile_set_events(fighter_id, created_at desc);
alter table public.af_profile_set_events enable row level security;
revoke all on public.af_profile_set_events from public, anon, authenticated;
grant all on public.af_profile_set_events to service_role;

-- Public: the roster's derived files, at content-hash paths (`<fighter>/<sha256>.webp`). No client Storage policies: anyone reads a
-- public object by its address, nobody lists the bucket, and only the API writes it (on approval) and removes it (when the set is no longer
-- his approved one: superseded, rejected, or withdrawn with his fighter).
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('af-profile-sets', 'af-profile-sets', true, 4000000, array['image/webp']);

-- A new set for his own registered fighter. The API has checked the set file (api/profile-sets.mjs parseProfileSet); the same key for the
-- same bytes answers the same row. One open set per fighter, ten a day per account.
create function public.af_profile_set_create(p_owner uuid, p_fighter uuid, p_key uuid, p_text text, p_sha text, p_bytes bigint)
returns public.af_profile_sets language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; f public.af_fighters; paused boolean;
begin
  perform 1 from public.af_creators where owner_id = p_owner for update;
  select * into p from public.af_profile_sets where owner_id = p_owner and idempotency_key = p_key;
  if found then
    if p.manifest_sha <> p_sha or p.fighter_id <> p_fighter then raise exception 'idempotency-conflict'; end if;
    return p;
  end if;
  select s.paused into paused from public.af_settings s where s.singleton;
  if paused then raise exception 'submissions-paused'; end if;
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner;
  if not found or f.deleted_at is not null or f.status <> 'registered' or f.review_state = 'rejected' then raise exception 'fighter-not-found'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 4000000 then raise exception 'byte-budget-mismatch'; end if;
  if exists(select 1 from public.af_profile_sets where fighter_id = p_fighter
      and (status in ('queued', 'validating') or (status = 'uploading' and expires_at > now()))) then
    raise exception 'open-profile-set-exists';
  end if;
  if (select count(*) from public.af_profile_sets where owner_id = p_owner and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'profile-set-quota';
  end if;
  insert into public.af_profile_sets(fighter_id, owner_id, idempotency_key, manifest_text, manifest_sha, manifest)
    values (p_fighter, p_owner, p_key, p_text, p_sha, p_text::jsonb) returning * into p;
  return p;
end $$;

-- The upload is complete when the front painting's object has the set file's size.
create function public.af_profile_set_submit(p_owner uuid, p_id uuid) returns public.af_profile_sets
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; key text;
begin
  select * into p from public.af_profile_sets where id = p_id and owner_id = p_owner for update;
  if not found then raise exception 'not-found'; end if;
  if p.status <> 'uploading' then return p; end if;
  if p.expires_at <= now() then raise exception 'upload-expired'; end if;
  key := p.owner_id::text || '/profile-sets/' || p.id::text || '/front.webp';
  if not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta' and o.name = key
      and (o.metadata->>'size')::bigint = (p.manifest->'front'->>'bytes')::bigint) then
    raise exception 'assets-incomplete';
  end if;
  update public.af_profile_sets set status = 'queued', submitted_at = now() where id = p.id returning * into p;
  return p;
end $$;

-- The validator's queue, as af_claim: a five-minute lease, three attempts.
create function public.af_profile_set_claim(p_id uuid default null) returns public.af_profile_sets
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets;
begin
  update public.af_profile_sets set status = 'rejected', lease_token = null, lease_until = null,
    validation = '{"code":"worker-attempt-limit"}'::jsonb, reason = 'worker-attempt-limit'
    where status = 'validating' and lease_until < now() and attempts >= 3;
  select * into p from public.af_profile_sets
    where (p_id is null or id = p_id) and (status = 'queued' or (status = 'validating' and lease_until < now())) and attempts < 3
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.af_profile_sets set status = 'validating', lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes',
    attempts = attempts + 1 where id = p.id returning * into p;
  return p;
end $$;

-- A verdict under the caller's live lease. A passed set waits for the operator (review) with its derived files, whose objects must exist.
-- The lease token stays on the finished set, as af_finish keeps it: the same receipt repeated answers the same.
create function public.af_profile_set_finish(p_id uuid, p_lease uuid, p_sha text, p_passed boolean, p_result jsonb, p_derived jsonb)
returns public.af_profile_sets language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; base text; card jsonb; face jsonb;
begin
  select * into p from public.af_profile_sets where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  if p.lease_token is distinct from p_lease or p.manifest_sha <> p_sha then raise exception 'stale-validation'; end if;
  if p.status in ('review', 'approved', 'rejected', 'superseded', 'withdrawn') then return p; end if;
  if p.status <> 'validating' or p.lease_until <= now() then raise exception 'stale-validation'; end if;
  if p_result->>'validatorVersion' is distinct from 'oddbout-profile-set-validator-0.1.0' then raise exception 'validator-version'; end if;
  if octet_length(p_result::text) > 16000 then raise exception 'validation-result-limit'; end if;
  if not p_passed then
    update public.af_profile_sets set status = 'rejected', validation = p_result,
      reason = left(coalesce(p_result->'errors'->0->>'code', 'validation'), 100), lease_until = null,
      validated_at = now() where id = p.id returning * into p;
    return p;
  end if;
  if p_result->>'stage' is distinct from 'profile-set-full-decode' then raise exception 'validation-incomplete'; end if;
  card := p_derived->'card'; face := p_derived->'face';
  if jsonb_typeof(card) is distinct from 'object' or jsonb_typeof(face) is distinct from 'object'
    or coalesce(card->>'sha256', '') !~ '^[a-f0-9]{64}$' or coalesce(face->>'sha256', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(card->'bytes') is distinct from 'number' or jsonb_typeof(face->'bytes') is distinct from 'number'
    or jsonb_typeof(card->'width') is distinct from 'number' or not (card->'width' >= '1'::jsonb and card->'width' <= '600'::jsonb)
    or card->'height' is distinct from '600'::jsonb
    or face->'size' is distinct from '192'::jsonb or jsonb_typeof(card->'face') is distinct from 'object'
    or octet_length(p_derived::text) > 2000 then
    raise exception 'validation-incomplete';
  end if;
  base := p.owner_id::text || '/profile-sets/' || p.id::text || '/';
  if not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta' and o.name = base || 'card.webp'
      and (o.metadata->>'size')::numeric = (card->>'bytes')::numeric)
    or not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta' and o.name = base || 'face.webp'
      and (o.metadata->>'size')::numeric = (face->>'bytes')::numeric) then
    raise exception 'validation-incomplete';
  end if;
  update public.af_profile_sets set status = 'review', validation = p_result,
    derived = jsonb_build_object('card', card, 'face', face), lease_until = null, validated_at = now()
    where id = p.id returning * into p;
  return p;
end $$;

-- An infrastructure failure under the caller's own lease, as af_release: requeue without spending an attempt; ten in a row reject it.
create function public.af_profile_set_release(p_id uuid, p_lease uuid, p_code text) returns public.af_profile_sets
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets;
begin
  if p_code is null or p_code !~ '^[a-z0-9-]{1,64}$' then raise exception 'invalid-release-code'; end if;
  select * into p from public.af_profile_sets where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  if p.status <> 'validating' or p.lease_token is distinct from p_lease then raise exception 'stale-validation'; end if;
  if p.infra_failures + 1 >= 10 then
    update public.af_profile_sets set status = 'rejected', lease_token = null, lease_until = null, infra_failures = infra_failures + 1,
      validation = jsonb_build_object('code', 'worker-infrastructure-limit', 'lastFailure', p_code), reason = 'worker-infrastructure-limit'
      where id = p.id returning * into p;
  else
    update public.af_profile_sets set status = 'queued', lease_token = null, lease_until = null,
      attempts = greatest(attempts - 1, 0), infra_failures = infra_failures + 1
      where id = p.id returning * into p;
  end if;
  return p;
end $$;

-- The operator's queue: sets waiting for review (or the recently decided), newest validation first.
create function public.af_admin_profile_sets(p_actor uuid, p_status text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_status is null or p_status not in ('review', 'approved', 'rejected') then raise exception 'invalid-query'; end if;
  -- `previewKey` is his current package's idle sheet (the side view the operator compares the painting with), as api/submissions.mjs
  -- objectKey names it.
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'ownerId', p.owner_id,
      'name', f.profile->>'name', 'email', u.email, 'status', p.status, 'manifest', p.manifest, 'derived', p.derived, 'reason', p.reason,
      'current', f.profile_set_id is not distinct from p.id, 'entered', f.entered_at is not null,
      'previewKey', case when s.manifest->'clips'->'idle'->>'assetId' ~ '^[a-zA-Z0-9_-]{1,80}$' then s.owner_id::text || '/'
        || coalesce(s.asset_source_submission, s.id)::text || '/' || (s.manifest->'clips'->'idle'->>'assetId') || '.webp' end,
      'createdAt', p.created_at, 'submittedAt', p.submitted_at, 'validatedAt', p.validated_at, 'reviewedAt', p.reviewed_at)
      order by coalesce(p.reviewed_at, p.validated_at) desc)
    from (select * from public.af_profile_sets p0 where p0.status = p_status
          order by coalesce(p0.reviewed_at, p0.validated_at) desc nulls last limit 50) p
    join public.af_fighters f on f.id = p.fighter_id
    left join public.af_submissions s on s.id = f.submission_id
    left join auth.users u on u.id = p.owner_id), '[]'::jsonb);
end $$;

-- One set as the approve route reads it before copying its derived files to the public bucket.
create function public.af_admin_profile_set(p_actor uuid, p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p public.af_profile_sets;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  select * into p from public.af_profile_sets where id = p_id;
  if not found then raise exception 'not-found'; end if;
  return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'ownerId', p.owner_id, 'status', p.status, 'derived', p.derived);
end $$;

-- Approve a set in review: it becomes his current set and the one it replaces is superseded. Approving the current set again answers the same.
-- Approve, reject, deletion and an operator's removal all lock the fighter first, then his sets: two of them never wait on each other.
create function public.af_admin_profile_set_approve(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; f public.af_fighters; fighter uuid;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  select fighter_id into fighter from public.af_profile_sets where id = p_id;
  if not found then raise exception 'not-found'; end if;
  select * into f from public.af_fighters where id = fighter for update;
  select * into p from public.af_profile_sets where id = p_id for update;
  if p.status = 'approved' and f.profile_set_id is not distinct from p.id then
    return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'status', p.status, 'derived', p.derived);
  end if;
  if p.status <> 'review' or f.deleted_at is not null or f.review_state = 'rejected' then raise exception 'review-conflict'; end if;
  update public.af_profile_sets set status = 'superseded' where fighter_id = p.fighter_id and status = 'approved' and id <> p.id;
  update public.af_profile_sets set status = 'approved', reviewed_by = p_actor, reviewed_at = now(), approved_at = now(), reason = null
    where id = p.id returning * into p;
  update public.af_fighters set profile_set_id = p.id where id = p.fighter_id;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, actor, kind) values (p.fighter_id, p.id, p_actor, 'approve');
  return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'status', p.status, 'derived', p.derived);
end $$;

-- Send a set back with a reason (style, likeness, content). Rejecting his current set takes it off the roster. A deleted fighter's sets are
-- withdrawn with him, so they are not in review; his row is left alone (af_guard_deleted_fighter refuses every change to it).
create function public.af_admin_profile_set_reject(p_actor uuid, p_id uuid, p_reason text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; was text; fighter uuid;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 or char_length(btrim(p_reason)) > 300 then raise exception 'invalid-review'; end if;
  select fighter_id into fighter from public.af_profile_sets where id = p_id;
  if not found then raise exception 'not-found'; end if;
  perform 1 from public.af_fighters where id = fighter for update;
  select * into p from public.af_profile_sets where id = p_id for update;
  if p.status not in ('review', 'approved') then raise exception 'review-conflict'; end if;
  was := p.status;
  update public.af_profile_sets set status = 'rejected', reason = btrim(p_reason), reviewed_by = p_actor, reviewed_at = now()
    where id = p.id returning * into p;
  update public.af_fighters set profile_set_id = null where id = p.fighter_id and profile_set_id = p.id and deleted_at is null;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, actor, kind, data)
    values (p.fighter_id, p.id, p_actor, 'reject', jsonb_build_object('reason', p.reason, 'previous', was));
  return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'status', p.status, 'previous', was, 'derived', p.derived);
end $$;

-- Withdraw a fighter's open and approved sets (his deletion, an operator's removal). The caller holds his row's lock.
create function public.af_profile_sets_withdraw(p_fighter uuid, p_actor uuid, p_reason text) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  update public.af_profile_sets set status = 'withdrawn', reason = p_reason, lease_until = null
    where fighter_id = p_fighter and status in ('uploading', 'queued', 'validating', 'review', 'approved');
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.af_profile_set_events(fighter_id, actor, kind, data) values (p_fighter, p_actor, 'withdraw', jsonb_build_object('reason', p_reason, 'sets', n));
  end if;
  return n;
end $$;

-- Sets once approved and no longer his approved one whose public copies the API has not removed yet: each with the hashes to remove. A hash
-- his current approved set also uses is left out (the same painting approved again keeps its address).
create function public.af_profile_set_stale_public(p_fighter uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'shas', (
      select coalesce(jsonb_agg(sha), '[]'::jsonb) from (select p.derived->'card'->>'sha256' as sha union select p.derived->'face'->>'sha256') h
      where h.sha ~ '^[a-f0-9]{64}$' and not exists(select 1 from public.af_profile_sets c where c.fighter_id = p.fighter_id and c.status = 'approved'
        and h.sha in (c.derived->'card'->>'sha256', c.derived->'face'->>'sha256'))))), '[]'::jsonb)
  from public.af_profile_sets p
  where p.fighter_id = p_fighter and p.status <> 'approved' and p.approved_at is not null and p.unpublished_at is null;
$$;
-- The API removed those copies.
create function public.af_profile_set_unpublished(p_fighter uuid, p_ids uuid[]) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  update public.af_profile_sets set unpublished_at = now() where fighter_id = p_fighter and id = any(p_ids) and status <> 'approved' and unpublished_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
-- The API could not remove them (Storage answered an error twice). The next cleanup of this fighter tries again.
create function public.af_profile_set_cleanup_failed(p_fighter uuid, p_paths text[], p_error text) returns void
language sql security invoker set search_path = '' as $$
  insert into public.af_profile_set_events(fighter_id, kind, data)
    values (p_fighter, 'public-cleanup-failed', jsonb_build_object('paths', to_jsonb(p_paths[1:20]), 'error', left(coalesce(p_error, ''), 200)));
$$;

revoke all on function public.af_profile_set_create(uuid, uuid, uuid, text, text, bigint), public.af_profile_set_submit(uuid, uuid),
  public.af_profile_set_claim(uuid), public.af_profile_set_finish(uuid, uuid, text, boolean, jsonb, jsonb),
  public.af_profile_set_release(uuid, uuid, text), public.af_admin_profile_sets(uuid, text), public.af_admin_profile_set(uuid, uuid),
  public.af_admin_profile_set_approve(uuid, uuid), public.af_admin_profile_set_reject(uuid, uuid, text), public.af_profile_set_stale_public(uuid),
  public.af_profile_set_unpublished(uuid, uuid[]), public.af_profile_set_cleanup_failed(uuid, text[], text), public.af_profile_sets_withdraw(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.af_profile_set_create(uuid, uuid, uuid, text, text, bigint), public.af_profile_set_submit(uuid, uuid),
  public.af_profile_set_claim(uuid), public.af_profile_set_finish(uuid, uuid, text, boolean, jsonb, jsonb),
  public.af_profile_set_release(uuid, uuid, text), public.af_admin_profile_sets(uuid, text), public.af_admin_profile_set(uuid, uuid),
  public.af_admin_profile_set_approve(uuid, uuid), public.af_admin_profile_set_reject(uuid, uuid, text), public.af_profile_set_stale_public(uuid),
  public.af_profile_set_unpublished(uuid, uuid[]), public.af_profile_set_cleanup_failed(uuid, text[], text), public.af_profile_sets_withdraw(uuid, uuid, text)
  to service_role;

-- As 20261030130000, and his approved set last (a view gains columns only at its end): its id and derived files.
create or replace view public.af_roster_entries with (security_invoker = true) as
  select f.id, f.created_at, f.submission_id, f.manifest_sha, f.profile, f.runtime_approved, f.runtime_scope, f.runtime_manifest_sha,
    f.duel_approved, f.duel_manifest_sha, f.review_state, f.listed, a.client_name as made_with, f.entered_at,
    (select jsonb_build_object('id', p.id, 'derived', p.derived) from public.af_profile_sets p
      where p.id = f.profile_set_id and p.status = 'approved') as profile_set
  from public.af_fighters f left join public.af_fighter_agents a on a.fighter_id = f.id;

-- As 20261030130000, and the profile-set gate: when `profile_set_required_after` is set, a fighter registered at or after it enters only
-- with a set the validator passed (in review or approved). Entering an entered fighter still answers the same.
create or replace function public.af_enter_fighter(p_owner uuid, p_fighter uuid, p_sha text, p_clips text[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters; required timestamptz;
begin
  if p_clips is null or cardinality(p_clips) = 0 then raise exception 'invalid-entry'; end if;
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner for update;
  if not found or f.deleted_at is not null then raise exception 'not-found'; end if;
  if f.status <> 'registered' or not coalesce(f.runtime_approved and f.duel_approved and f.review_state = 'approved'
    and f.duel_manifest_sha = f.manifest_sha, false) then raise exception 'fighter-not-ready'; end if;
  if f.manifest_sha is distinct from p_sha then raise exception 'fighter-changed'; end if;
  if f.entered_at is null then
    select s.profile_set_required_after into required from public.af_settings s where s.singleton;
    if required is not null and f.created_at >= required and not exists(select 1 from public.af_profile_sets p
        where p.fighter_id = f.id and p.status in ('review', 'approved')) then
      raise exception 'profile-set-required';
    end if;
    update public.af_fighters set entered_at = now(), review_evidence = coalesce(review_evidence, '{}'::jsonb)
      || jsonb_build_object('entry', jsonb_build_object('manifestSha', p_sha, 'clips', to_jsonb(p_clips), 'at', now()))
      where id = f.id returning * into f;
  end if;
  return jsonb_build_object('ok', true, 'stage', 'entered', 'fighterId', f.id, 'enteredAt', f.entered_at);
end $$;

-- As 20261030130000, and his profile sets go with him: open and approved sets are withdrawn and his current set cleared in the same update
-- that deletes him (af_guard_deleted_fighter refuses any later change to his row). The API removes the public copies after this commits.
create or replace function public.af_delete_owned_fighter(p_owner uuid,p_fighter uuid,p_session uuid,p_client uuid,p_token uuid,p_confirm_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; d public.af_fighter_deletions; current_snapshot jsonb; answer jsonb;
begin
  if not public.af_owner_session_active(p_owner,p_session,p_client) then raise exception 'authentication-required'; end if;
  perform 1 from public.af_creators where owner_id=p_owner for update;
  select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner for update;
  if not found then raise exception 'not-found'; end if;
  select * into d from public.af_fighter_deletions where token=p_token and owner_id=p_owner and fighter_id=p_fighter
    and session_id=p_session and client_id=p_client for update;
  if not found then raise exception 'invalid-deletion-confirmation'; end if;
  if p_confirm_name is distinct from d.confirm_name then raise exception 'deletion-name-mismatch'; end if;
  -- A lost successful response is safe to retry with exactly the same confirmation.
  if d.completed_at is not null then return d.result; end if;
  if d.expires_at<=now() then raise exception 'deletion-confirmation-expired'; end if;
  if f.deleted_at is not null then raise exception 'fighter-deleted'; end if;
  current_snapshot:=jsonb_build_object('submission',f.submission_id,'manifest',f.manifest_sha,'profile',f.profile,'version',f.moderation_version);
  if d.snapshot is distinct from current_snapshot then raise exception 'fighter-changed'; end if;
  -- World character cards are a separate public surface. Preserve their previous value in the private audit.
  update public.af_fighter_deletions set snapshot=snapshot||jsonb_build_object('worldMembership',
    (select to_jsonb(w) from public.af_world_fighters w where w.fighter_id=f.id)) where token=d.token;
  delete from public.af_world_fighters where fighter_id=f.id;
  update public.af_fighters set deleted_at=now(),account_slot=null,review_state='rejected',runtime_approved=false,
    runtime_scope=null,runtime_manifest_sha=null,duel_approved=false,duel_manifest_sha=null,entered_at=null,profile_set_id=null,
    moderation_reason='Deleted by owner',moderation_version=moderation_version+1,moderated_at=now()
    where id=f.id and owner_id=p_owner returning * into f;
  perform public.af_profile_sets_withdraw(f.id,p_owner,'fighter-deleted');
  answer:=jsonb_build_object('ok',true,'stage','deleted','fighterId',f.id,'ownerId',p_owner,'name',d.confirm_name,
    'deletedAt',f.deleted_at,'deletionMode','soft-delete','privatePackageAndHistoryRetained',true,'fighterSlotReleased',true);
  update public.af_fighter_deletions set completed_at=now(),result=answer where token=d.token;
  return answer;
end $$;

-- As 20261023124255, and an operator's removal withdraws his profile sets and clears his current one (a restore does not bring them back:
-- his owner submits a set again). The API removes the public copies after this commits.
create or replace function public.af_moderate_fighter(p_actor uuid,p_fighter uuid,p_version bigint,p_action text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; s public.af_submissions; next_version bigint;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_action is null or p_action not in ('remove','restore') or p_version is null or p_version<0
    or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'invalid-review'; end if;
  select * into f from public.af_fighters where id=p_fighter for update;
  if not found then raise exception 'not-found'; end if;
  if f.moderation_version<>p_version then raise exception 'review-conflict'; end if;
  if (p_action='remove' and f.review_state='rejected') or (p_action='restore' and (f.runtime_approved or (f.status='profile' and f.review_state='approved'))) then raise exception 'review-conflict'; end if;
  select * into s from public.af_submissions where id=f.submission_id;
  if p_action='restore' and f.status<>'profile' and (s.status<>'registered' or s.manifest_sha<>f.manifest_sha
    or s.validation->>'stage' is distinct from 'bytes-hashes-and-full-decode') then raise exception 'validation-incomplete'; end if;
  next_version:=f.moderation_version+1;
  update public.af_fighters set review_state=case when p_action='remove' then 'rejected' else 'approved' end,
    runtime_approved=p_action='restore' and f.status='registered',duel_approved=p_action='restore' and f.status='registered',
    runtime_scope=case when p_action='restore' and f.status='registered' then 'arena-player-v1' else null end,
    runtime_manifest_sha=case when p_action='restore' and f.status='registered' then manifest_sha else null end,
    duel_manifest_sha=case when p_action='restore' and f.status='registered' then manifest_sha else null end,
    profile_set_id=case when p_action='remove' then null else profile_set_id end,
    review_evidence=coalesce(review_evidence,'{}'::jsonb)||case when f.status='profile' then '{"authorization":"profile-registration"}'::jsonb else jsonb_build_object('authorization','open-registration','validation',s.validation,'duelValidation','validated-v1-package','policy','post-publication-moderation') end,
    moderation_version=next_version,moderation_reason=trim(p_reason),moderated_at=now()
    where id=f.id;
  if p_action='remove' then perform public.af_profile_sets_withdraw(f.id,p_actor,'fighter-removed'); end if;
  insert into public.af_moderation_events(fighter_id,actor,action,reason,version) values(f.id,p_actor,p_action,trim(p_reason),next_version);
  return jsonb_build_object('fighterId',f.id,'state',case when p_action='remove' then 'removed' else 'active' end,'version',next_version);
end $$;
revoke all on function public.af_moderate_fighter(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.af_moderate_fighter(uuid,uuid,bigint,text,text) to service_role;
