-- Revisions do not consume the five initial-submission attempts. Profile-only
-- revisions reference immutable validated assets instead of reserving/uploading copies.
alter table public.af_submissions add column asset_source_submission uuid references public.af_submissions(id);
alter table public.af_submissions add constraint af_asset_source_revision check
  (asset_source_submission is null or (asset_source_submission<>id and replaces_fighter is not null));
create index af_submissions_asset_source on public.af_submissions(asset_source_submission) where asset_source_submission is not null;

create or replace function public.af_immutable_submission() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.owner_id,new.idempotency_key,new.manifest_text,new.manifest,new.manifest_sha,new.asset_bytes,new.replaces_fighter,new.asset_source_submission)
     is distinct from row(old.owner_id,old.idempotency_key,old.manifest_text,old.manifest,old.manifest_sha,old.asset_bytes,old.replaces_fighter,old.asset_source_submission)
    then raise exception 'immutable-submission'; end if;
  return new;
end $$;

-- Change only these two guards: preserve any deployment-specific fighter-slot
-- policy and every existing authorization, upload and reservation check.
do $$
declare definition text; quota text := 'if (select count(*) from public.af_submissions where owner_id=p_owner) >= 5';
  reserved text := 'select coalesce(sum(asset_bytes),0) from public.af_submissions';
begin
  definition := pg_get_functiondef('public.af_create_submission(uuid,uuid,text,text,bigint,uuid)'::regprocedure);
  if strpos(definition,quota)=0 or strpos(definition,reserved)=0 then raise exception 'unknown-submission-guards'; end if;
  definition := replace(definition,quota,'if p_fighter is null and (select count(*) from public.af_submissions where owner_id=p_owner and replaces_fighter is null) >= 5');
  definition := replace(definition,reserved,reserved||' where asset_source_submission is null');
  execute definition;
end $$;

-- Only the API may call this, after validating the complete reconstructed manifest.
-- p_base is the version the editor read; retries reconstruct from that same immutable
-- version. Serialize with uploads and moderation, then atomically save the new version.
create function public.af_update_fighter_profile(p_owner uuid,p_key uuid,p_fighter uuid,p_base uuid,p_text text,p_sha text)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; b public.af_submissions; f public.af_fighters; settings public.af_settings;
  manifest jsonb := p_text::jsonb; source_id uuid; editable text[] := array['name','description','language','concept','moves'];
begin
  perform public.af_authorize(p_owner);
  select * into settings from public.af_settings where singleton for update;
  select * into b from public.af_submissions where id=p_base and owner_id=p_owner and fighter_id=p_fighter and status='registered';
  if not found then raise exception 'fighter-not-found'; end if;
  source_id := coalesce(b.asset_source_submission,b.id);
  select * into s from public.af_submissions where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if s.manifest_sha<>p_sha or s.manifest_text<>p_text or s.replaces_fighter is distinct from p_fighter
      or s.asset_source_submission is distinct from source_id or s.validation->>'profileBaseSubmission' is distinct from p_base::text
      then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if settings.paused then raise exception 'submissions-paused'; end if;
  select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner for update;
  if not found then raise exception 'fighter-not-found'; end if;
  if f.review_state='rejected' then raise exception 'fighter-removed'; end if;
  if f.submission_id<>p_base or f.manifest_sha<>b.manifest_sha then raise exception 'fighter-changed'; end if;
  if f.review_state<>'approved' or not f.runtime_approved or not f.duel_approved
    or f.runtime_manifest_sha is distinct from b.manifest_sha or f.duel_manifest_sha is distinct from b.manifest_sha
    then raise exception 'profile-not-editable'; end if;
  if manifest - 'profile' is distinct from b.manifest - 'profile'
    or (manifest->'profile') - editable is distinct from (b.manifest->'profile') - editable
    or jsonb_typeof(manifest->'profile') is distinct from 'object'
    then raise exception 'profile-only-required'; end if;
  if manifest=b.manifest then raise exception 'fighter-unchanged'; end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,replaces_fighter,
    asset_source_submission,status,fighter_id,validation)
    values(p_owner,p_key,p_text,manifest,p_sha,b.asset_bytes,p_fighter,source_id,'registered',p_fighter,
      b.validation||jsonb_build_object('profileBaseSubmission',b.id,'assetSourceSubmission',source_id)) returning * into s;
  update public.af_fighters set submission_id=s.id,manifest_sha=s.manifest_sha,profile=s.manifest->'profile',
    runtime_manifest_sha=s.manifest_sha,duel_manifest_sha=s.manifest_sha,updated_at=now(),
    review_evidence=coalesce(f.review_evidence,'{}'::jsonb)||jsonb_build_object('profileUpdate',jsonb_build_object('baseSubmission',b.id,'assetSourceSubmission',source_id))
    where id=f.id;
  return s;
end $$;
revoke all on function public.af_update_fighter_profile(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.af_update_fighter_profile(uuid,uuid,uuid,uuid,text,text) to service_role;
