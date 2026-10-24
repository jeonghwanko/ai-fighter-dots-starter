-- Profile publication does not imply validated combat assets. Both states use the same three account slots.
alter table public.af_fighters alter column submission_id drop not null;
alter table public.af_fighters alter column manifest_sha drop not null;
alter table public.af_fighters drop constraint af_fighters_status_check;
alter table public.af_fighters add constraint af_fighters_status_check check(status in ('profile','registered'));
alter table public.af_fighters add column profile_key uuid;
alter table public.af_fighters add constraint af_fighters_profile_key unique(owner_id,profile_key);
alter table public.af_fighters add constraint af_fighters_package_state check(
  (status='profile' and submission_id is null and manifest_sha is null and not runtime_approved and not duel_approved)
  or (status='registered' and submission_id is not null and manifest_sha is not null));

-- Public visitors receive only the published profile fields, never owner IDs or package records.
grant select(id,profile,status,review_state,created_at) on public.af_fighters to anon;
create policy af_profiles_public on public.af_fighters for select to anon using(status='profile' and review_state='approved');
create view public.af_public_character_profiles with (security_invoker=true) as
  select id,profile,created_at from public.af_fighters where status='profile' and review_state='approved';
revoke all on public.af_public_character_profiles from public,authenticated;
grant select on public.af_public_character_profiles to anon,service_role;
create index af_fighters_profile_catalog on public.af_fighters(created_at desc,id) where status='profile' and review_state='approved';

-- This registration entry point is service-only, like package finalization. It never approves combat.
create function public.af_register_character_profile(p_owner uuid,p_key uuid,p_profile jsonb,p_world text default null)
returns public.af_fighters language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters;
begin
  perform public.af_authorize(p_owner);
  if p_key is null or p_profile is null or jsonb_typeof(p_profile)<>'object'
    or octet_length(p_profile::text)>8000
    or coalesce(jsonb_typeof(p_profile->'name'),'')<>'string' or char_length(trim(p_profile->>'name')) not between 1 and 40
    or coalesce(jsonb_typeof(p_profile->'description'),'')<>'string' or char_length(p_profile->>'description')>600
    or coalesce(p_profile->>'portrait','') !~ '^/art/character-profiles/[a-z0-9_-]+[.]webp$'
    or coalesce(p_profile->>'color','#cdd6c7') !~ '^#[a-fA-F0-9]{6}$'
    then raise exception 'invalid-profile'; end if;
  select * into f from public.af_fighters where owner_id=p_owner and profile_key=p_key;
  if found then
    if f.profile<>p_profile or (select world_id from public.af_world_fighters where fighter_id=f.id) is distinct from p_world
      then raise exception 'idempotency-conflict'; end if;
    return f;
  end if;
  if (select paused from public.af_settings where singleton) then raise exception 'submissions-paused'; end if;
  if p_world is not null and not exists(select 1 from public.af_worlds where id=p_world and published) then raise exception 'world-not-found'; end if;
  -- Reserve an uploading package's slot until it expires, succeeds or fails.
  if exists(select 1 from public.af_submissions where owner_id=p_owner and
    (status in ('queued','validating') or (status='uploading' and expires_at>now()))) then raise exception 'open-submission-exists'; end if;
  insert into public.af_fighters(owner_id,profile_key,profile,status,review_state,review_evidence)
    values(p_owner,p_key,p_profile,'profile','approved','{"authorization":"profile-registration"}') returning * into f;
  if p_world is not null then
    insert into public.af_world_fighters(fighter_id,world_id,name,portrait_path) values(f.id,p_world,p_profile->>'name',p_profile->>'portrait');
  end if;
  return f;
end $$;
revoke all on function public.af_register_character_profile(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.af_register_character_profile(uuid,uuid,jsonb,text) to service_role;

create or replace function public.af_queue_registration_analytics() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status='profile' then return new; end if;
 insert into public.af_analytics_outbox(submission_id,owner_id,client_id,session_id)
 select new.submission_id,new.owner_id,c.client_id,
   case when c.updated_at > now()-interval '24 hours' then c.session_id else null end
 from public.af_analytics_context c
 where c.owner_id=new.owner_id and c.updated_at > now()-interval '30 days'
 on conflict (submission_id) do nothing;
 return new;
end $$;

-- A successful full package promotes the same ID and slot; world memberships and links survive.
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
      update public.af_fighters set status='registered',submission_id=s.id,manifest_sha=s.manifest_sha,profile=s.manifest->'profile',review_state='approved',
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

-- Public profiles remain removable/restorable, without granting combat approval.
create or replace function public.af_admin_fighters(p_actor uuid,p_status text default 'active',p_search text default '',p_page integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_status is null or p_status not in ('active','removed','all') or p_page is null or p_page<0 or p_page>10000
    or p_search is null or length(p_search)>200 then raise exception 'invalid-query'; end if;
  with rows as (
    select f.*,u.email from public.af_fighters f join auth.users u on u.id=f.owner_id
    where (p_status='all' or (p_status='active' and f.review_state<>'rejected' and (f.runtime_approved or f.status='profile')) or (p_status='removed' and f.review_state='rejected'))
      and (p_search='' or strpos(lower(f.profile->>'name'),lower(p_search))>0 or strpos(lower(coalesce(u.email,'')),lower(p_search))>0)
  ), page as (select * from rows order by created_at desc,id limit 20 offset p_page*20)
  select jsonb_build_object('total',(select count(*) from rows),'fighters',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'ownerId',owner_id,'email',email,'name',profile->>'name','description',profile->>'description',
    'state',case when review_state='rejected' then 'removed' else 'active' end,'version',moderation_version,
    'reason',moderation_reason,'createdAt',created_at,'moderatedAt',moderated_at) order by created_at desc,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;

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
    review_evidence=coalesce(review_evidence,'{}'::jsonb)||case when f.status='profile' then '{"authorization":"profile-registration"}'::jsonb else jsonb_build_object('authorization','open-registration','validation',s.validation,'duelValidation','validated-v1-package','policy','post-publication-moderation') end,
    moderation_version=next_version,moderation_reason=trim(p_reason),moderated_at=now()
    where id=f.id;
  insert into public.af_moderation_events(fighter_id,actor,action,reason,version) values(f.id,p_actor,p_action,trim(p_reason),next_version);
  return jsonb_build_object('fighterId',f.id,'state',case when p_action='remove' then 'removed' else 'active' end,'version',next_version);
end $$;
revoke all on function public.af_admin_fighters(uuid,text,text,integer),public.af_moderate_fighter(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.af_admin_fighters(uuid,text,text,integer),public.af_moderate_fighter(uuid,uuid,bigint,text,text) to service_role;
