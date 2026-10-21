-- Open participation: authentication and byte/schema checks remain; manual invitations and admission end.
-- Legacy approval columns now express technical availability, not human review.
create or replace function public.af_authorize(p_owner uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c public.af_creators;
begin
  insert into public.af_creators(owner_id) values(p_owner) on conflict(owner_id) do nothing;
  select * into c from public.af_creators where owner_id=p_owner for update;
  if not c.enabled then raise exception 'account-disabled'; end if;
  if c.request_window < now()-interval '1 minute' then
    update public.af_creators set request_window=now(),request_count=1 where owner_id=p_owner;
  elsif c.request_count >= 120 then raise exception 'rate-limit';
  else update public.af_creators set request_count=request_count+1 where owner_id=p_owner; end if;
  return true;
end $$;

create or replace function public.af_account(p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('invited',coalesce(c.enabled,true),'canSubmit',coalesce(c.enabled,true),
    'accessMode','open','expiresAt',null,'request',null)
  from (select p_owner as id) me left join public.af_creators c on c.owner_id=me.id;
$$;
-- Retire the old invitation endpoints without erasing their audit records.
create or replace function public.af_request_access(p_owner uuid,p_note text default '') returns jsonb
language sql security invoker set search_path='' as $$ select public.af_account(p_owner); $$;
create or replace function public.af_admin_review(p_actor uuid,p_owner uuid,p_version timestamptz,p_decision text,p_reason text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  raise exception 'registration-open';
end $$;

create or replace function public.af_create_submission(p_owner uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; settings public.af_settings; declared numeric;
begin
  perform public.af_authorize(p_owner);
  select * into settings from public.af_settings where singleton for update;
  select * into s from public.af_submissions where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if s.manifest_sha<>p_sha or s.manifest_text<>p_text then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if settings.paused then raise exception 'submissions-paused'; end if;
  if exists(select 1 from public.af_fighters where owner_id=p_owner) then raise exception 'fighter-quota'; end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  if (select count(*) from public.af_submissions where owner_id=p_owner) >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::numeric) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Reservations count even expired/rejected records until an operator removes their objects and records together.
  if (select coalesce(sum(asset_bytes),0) from public.af_submissions)+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes) returning * into s;
  return s;
end $$;


create or replace function public.af_finish(p_id uuid,p_lease uuid,p_sha text,p_passed boolean,p_result jsonb)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; f public.af_fighters; allowed text[];
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
    insert into public.af_fighters(submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,runtime_manifest_sha,duel_approved,duel_manifest_sha,review_evidence)
      values(s.id,s.owner_id,s.manifest_sha,s.manifest->'profile','approved',true,'arena-player-v1',s.manifest_sha,true,s.manifest_sha,
        jsonb_build_object('authorization','open-registration','validation',p_result,'duelValidation','validated-v1-package','policy','post-publication-moderation'))
      on conflict(submission_id) do nothing;
    select * into f from public.af_fighters where submission_id=s.id;
    update public.af_submissions set status='registered',fighter_id=f.id,validation=p_result where id=s.id returning * into s;
  else
    update public.af_submissions set status='rejected',validation=p_result where id=s.id returning * into s;
  end if;
  return s;
end $$;


alter table public.af_fighters add column moderation_version bigint not null default 0;
alter table public.af_fighters add column moderation_reason text not null default '' check(length(moderation_reason)<=500);
alter table public.af_fighters add column moderated_at timestamptz;

-- Existing validated registrations become usable. Prior explicit takedowns remain removed.
update public.af_fighters f set review_state='approved',runtime_approved=true,runtime_scope='arena-player-v1',
  runtime_manifest_sha=f.manifest_sha,duel_approved=true,duel_manifest_sha=f.manifest_sha,
  review_evidence=coalesce(f.review_evidence,'{}'::jsonb)||jsonb_build_object('authorization','open-registration',
    'validation',s.validation,'duelValidation','validated-v1-package','policy','post-publication-moderation')
from public.af_submissions s where s.id=f.submission_id and s.status='registered' and s.manifest_sha=f.manifest_sha
  and s.validation->>'stage'='bytes-hashes-and-full-decode' and f.review_state<>'rejected';

create table public.af_moderation_events (
  id bigint generated always as identity primary key,
  fighter_id uuid not null references public.af_fighters(id),
  actor uuid not null references auth.users(id),
  action text not null check(action in ('remove','restore')),
  reason text not null check(length(trim(reason)) between 1 and 500),
  version bigint not null,
  created_at timestamptz not null default now(),
  unique(fighter_id,version)
);
alter table public.af_moderation_events enable row level security;
revoke all on public.af_moderation_events from public,anon,authenticated;
grant all on public.af_moderation_events to service_role;
grant usage,select on sequence public.af_moderation_events_id_seq to service_role;
create policy af_moderation_service on public.af_moderation_events for all to service_role using(true) with check(true);

create function public.af_admin_fighters(p_actor uuid,p_status text default 'active',p_search text default '',p_page integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_status is null or p_status not in ('active','removed','all') or p_page is null or p_page<0 or p_page>10000
    or p_search is null or length(p_search)>200 then raise exception 'invalid-query'; end if;
  with rows as (
    select f.*,u.email from public.af_fighters f join auth.users u on u.id=f.owner_id
    where (p_status='all' or (p_status='active' and f.runtime_approved) or (p_status='removed' and f.review_state='rejected'))
      and (p_search='' or strpos(lower(f.profile->>'name'),lower(p_search))>0 or strpos(lower(coalesce(u.email,'')),lower(p_search))>0)
  ), page as (select * from rows order by created_at desc,id limit 20 offset p_page*20)
  select jsonb_build_object('total',(select count(*) from rows),'fighters',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'ownerId',owner_id,'email',email,'name',profile->>'name','description',profile->>'description',
    'state',case when review_state='rejected' then 'removed' else 'active' end,'version',moderation_version,
    'reason',moderation_reason,'createdAt',created_at,'moderatedAt',moderated_at) order by created_at desc,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.af_moderate_fighter(p_actor uuid,p_fighter uuid,p_version bigint,p_action text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; s public.af_submissions; next_version bigint;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_action is null or p_action not in ('remove','restore') or p_version is null or p_version<0
    or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'invalid-review'; end if;
  select * into f from public.af_fighters where id=p_fighter for update;
  if not found then raise exception 'not-found'; end if;
  if f.moderation_version<>p_version then raise exception 'review-conflict'; end if;
  if (p_action='remove' and f.review_state='rejected') or (p_action='restore' and f.runtime_approved) then raise exception 'review-conflict'; end if;
  select * into s from public.af_submissions where id=f.submission_id;
  if p_action='restore' and (s.status<>'registered' or s.manifest_sha<>f.manifest_sha
    or s.validation->>'stage' is distinct from 'bytes-hashes-and-full-decode') then raise exception 'validation-incomplete'; end if;
  next_version:=f.moderation_version+1;
  update public.af_fighters set review_state=case when p_action='remove' then 'rejected' else 'approved' end,
    runtime_approved=p_action='restore',duel_approved=p_action='restore',
    runtime_scope=case when p_action='restore' then 'arena-player-v1' else null end,
    runtime_manifest_sha=case when p_action='restore' then manifest_sha else null end,
    duel_manifest_sha=case when p_action='restore' then manifest_sha else null end,
    review_evidence=coalesce(review_evidence,'{}'::jsonb)||jsonb_build_object('authorization','open-registration','validation',s.validation,'duelValidation','validated-v1-package','policy','post-publication-moderation'),
    moderation_version=next_version,moderation_reason=trim(p_reason),moderated_at=now()
    where id=f.id;
  insert into public.af_moderation_events(fighter_id,actor,action,reason,version) values(f.id,p_actor,p_action,trim(p_reason),next_version);
  return jsonb_build_object('fighterId',f.id,'state',case when p_action='remove' then 'removed' else 'active' end,'version',next_version);
end $$;
revoke all on function public.af_admin_fighters(uuid,text,text,integer),public.af_moderate_fighter(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.af_admin_fighters(uuid,text,text,integer),public.af_moderate_fighter(uuid,uuid,bigint,text,text) to service_role;
