-- In-place update (2026-10-23): an owner replaces the package of their one fighter — new concept, move names, duel grades or art.
-- The fighter keeps its ID, creation date and duel record; each saved duel keeps the hashes it was played with, so old results stay
-- history. A duel reserved on the old package and run after the update fails closed (af_complete_duel: duel-not-approved).
-- An update never changes moderation: a removed fighter cannot be updated, and one removed while its update validates stays removed.
-- Updates count toward the same five-submission quota and storage budget as first registrations.
alter table public.af_submissions add column replaces_fighter uuid references public.af_fighters(id);
-- When the fighter's package was last replaced; null until its first update.
alter table public.af_fighters add column updated_at timestamptz;

create or replace function public.af_immutable_submission() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.owner_id,new.idempotency_key,new.manifest_text,new.manifest,new.manifest_sha,new.asset_bytes,new.replaces_fighter)
     is distinct from row(old.owner_id,old.idempotency_key,old.manifest_text,old.manifest,old.manifest_sha,old.asset_bytes,old.replaces_fighter)
    then raise exception 'immutable-submission'; end if;
  return new;
end $$;

drop function public.af_create_submission(uuid,uuid,text,text,bigint);
create function public.af_create_submission(p_owner uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint,p_fighter uuid default null)
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
    if exists(select 1 from public.af_fighters where owner_id=p_owner) then raise exception 'fighter-quota'; end if;
  else
    select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner;
    if not found then raise exception 'fighter-not-found'; end if;
    if f.review_state='rejected' then raise exception 'fighter-removed'; end if;
    if f.manifest_sha=p_sha then raise exception 'fighter-unchanged'; end if;
  end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  if (select count(*) from public.af_submissions where owner_id=p_owner) >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::numeric) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Reservations count even expired/rejected records until an operator removes their objects and records together.
  if (select coalesce(sum(asset_bytes),0) from public.af_submissions)+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,replaces_fighter)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes,p_fighter) returning * into s;
  return s;
end $$;
revoke all on function public.af_create_submission(uuid,uuid,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.af_create_submission(uuid,uuid,text,text,bigint,uuid) to service_role;

create or replace function public.af_finish(p_id uuid,p_lease uuid,p_sha text,p_passed boolean,p_result jsonb)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; f public.af_fighters; allowed text[]; evidence jsonb;
begin
  select validator_versions into allowed from public.af_settings where singleton;
  select * into s from public.af_submissions where id=p_id for update;
  if not found then raise exception 'not-found'; end if;
  if s.lease_token is distinct from p_lease or s.manifest_sha<>p_sha then raise exception 'stale-validation'; end if;
  if s.status in ('registered','rejected') then return s; end if;
  if s.status<>'validating' or s.lease_until<=now() then raise exception 'stale-validation'; end if;
  if p_result->>'validatorVersion' is null or not (p_result->>'validatorVersion' = any(allowed))
    then raise exception 'validator-version'; end if;
  if octet_length(p_result::text)>16000 then raise exception 'validation-result-limit'; end if;
  if p_passed then
    if p_result->>'stage'<>'bytes-hashes-and-full-decode' or p_result->>'stage' is null then raise exception 'validation-incomplete'; end if;
    evidence := jsonb_build_object('authorization','open-registration','validation',p_result,'duelValidation','validated-v1-package','policy','post-publication-moderation');
    if s.replaces_fighter is null then
      insert into public.af_fighters(submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,runtime_manifest_sha,duel_approved,duel_manifest_sha,review_evidence)
        values(s.id,s.owner_id,s.manifest_sha,s.manifest->'profile','approved',true,'arena-player-v1',s.manifest_sha,true,s.manifest_sha,evidence)
        on conflict(submission_id) do nothing;
      select * into f from public.af_fighters where submission_id=s.id;
    else
      select * into f from public.af_fighters where id=s.replaces_fighter and owner_id=s.owner_id for update;
      if not found or f.review_state='rejected' then
        update public.af_submissions set status='rejected',validation=p_result||'{"code":"fighter-removed"}'::jsonb where id=s.id returning * into s;
        return s;
      end if;
      -- Same row, new package: the ID, created_at and moderation fields stay; the duel record follows the ID.
      update public.af_fighters set submission_id=s.id,manifest_sha=s.manifest_sha,profile=s.manifest->'profile',review_state='approved',
        runtime_approved=true,runtime_scope='arena-player-v1',runtime_manifest_sha=s.manifest_sha,duel_approved=true,duel_manifest_sha=s.manifest_sha,
        review_evidence=coalesce(f.review_evidence,'{}'::jsonb)||evidence,updated_at=now()
        where id=f.id returning * into f;
    end if;
    update public.af_submissions set status='registered',fighter_id=f.id,validation=p_result where id=s.id returning * into s;
  else
    update public.af_submissions set status='rejected',validation=p_result where id=s.id returning * into s;
  end if;
  return s;
end $$;
