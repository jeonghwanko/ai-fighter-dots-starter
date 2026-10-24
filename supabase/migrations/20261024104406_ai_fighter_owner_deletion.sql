-- Owner deletion removes discovery/admission while preserving immutable packages and duel history.
-- No user/OAuth role can invoke these RPCs directly. The Edge binds all identity arguments to verified claims.
alter table public.af_fighters add column deleted_at timestamptz;
alter table public.af_fighters alter column account_slot drop not null;
alter table public.af_fighters add constraint af_fighters_deletion_state check (
  (deleted_at is null and account_slot is not null) or
  (deleted_at is not null and account_slot is null and review_state='rejected' and not runtime_approved and not duel_approved));
alter policy af_fighters_read_own on public.af_fighters using ((select auth.uid())=owner_id and deleted_at is null);

create function public.af_guard_deleted_fighter() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.deleted_at is not null and new is distinct from old then raise exception 'fighter-deleted'; end if;
  return new;
end $$;
revoke all on function public.af_guard_deleted_fighter() from public,anon,authenticated;
grant execute on function public.af_guard_deleted_fighter() to service_role;
create trigger af_guard_deleted_fighter before update on public.af_fighters for each row execute function public.af_guard_deleted_fighter();

-- Keep the current submission, revision and storage rules, changing only the active-fighter count.
do $$ declare definition text; changed text; begin
  definition:=pg_get_functiondef('public.af_create_submission(uuid,uuid,text,text,bigint,uuid)'::regprocedure);
  changed:=replace(definition,'from public.af_fighters where owner_id=p_owner) >= 3','from public.af_fighters where owner_id=p_owner and deleted_at is null) >= 3');
  if changed=definition then raise exception 'review-current-fighter-quota-function'; end if;
  execute changed;
end $$;

create table public.af_fighter_deletions (
  token uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  fighter_id uuid not null references public.af_fighters(id),
  session_id uuid not null,
  client_id uuid not null,
  snapshot jsonb not null,
  confirm_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  completed_at timestamptz,
  result jsonb,
  unique(owner_id,fighter_id,session_id,client_id)
);
alter table public.af_fighter_deletions enable row level security;
revoke all on public.af_fighter_deletions from public,anon,authenticated;
grant select,insert,update on public.af_fighter_deletions to service_role;
create policy af_fighter_deletions_service on public.af_fighter_deletions to service_role using (true) with check (true);
create index af_fighter_deletions_fighter on public.af_fighter_deletions(fighter_id);

create function public.af_prepare_fighter_deletion(p_owner uuid,p_fighter uuid,p_session uuid,p_client uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; d public.af_fighter_deletions; current_snapshot jsonb; display_name text;
begin
  if not public.af_mcp_session_active(p_owner,p_session,p_client) then raise exception 'authentication-required'; end if;
  -- Same creator lock as slot allocation; ownership and the snapshot are checked under the fighter lock.
  perform 1 from public.af_creators where owner_id=p_owner for update;
  select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner for update;
  if not found then raise exception 'not-found'; end if;
  if f.deleted_at is not null then return jsonb_build_object('ok',true,'stage','deleted','fighterId',f.id,'deletedAt',f.deleted_at); end if;
  current_snapshot:=jsonb_build_object('submission',f.submission_id,'manifest',f.manifest_sha,'profile',f.profile,'version',f.moderation_version);
  display_name:=coalesce(nullif(f.profile->'names'->>'ko',''),f.profile->>'name');
  select * into d from public.af_fighter_deletions where owner_id=p_owner and fighter_id=f.id and session_id=p_session and client_id=p_client for update;
  if not found then
    insert into public.af_fighter_deletions(owner_id,fighter_id,session_id,client_id,snapshot,confirm_name)
      values(p_owner,f.id,p_session,p_client,current_snapshot,display_name) returning * into d;
  elsif d.expires_at<=now() or d.snapshot is distinct from current_snapshot then
    update public.af_fighter_deletions set token=gen_random_uuid(),snapshot=current_snapshot,confirm_name=display_name,
      created_at=now(),expires_at=now()+interval '10 minutes',completed_at=null,result=null where token=d.token returning * into d;
  end if;
  return jsonb_build_object('ok',true,'stage','confirmation-required','fighterId',f.id,'ownerId',p_owner,
    'name',display_name,'registeredName',f.profile->>'name','manifestSha256',f.manifest_sha,
    'confirmationToken',d.token,'confirmName',d.confirm_name,'expiresAt',d.expires_at,
    'deletionMode','soft-delete','effects',jsonb_build_object('removeFromMyFighters',true,'removeFromPublicRoster',true,
      'disableNewMatches',true,'releaseFighterSlot',true,'retainPrivatePackageAndHistory',true,
      'previouslyIssuedAssetLinksExpireWithinSeconds',600));
end $$;

create function public.af_delete_owned_fighter(p_owner uuid,p_fighter uuid,p_session uuid,p_client uuid,p_token uuid,p_confirm_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; d public.af_fighter_deletions; current_snapshot jsonb; answer jsonb;
begin
  if not public.af_mcp_session_active(p_owner,p_session,p_client) then raise exception 'authentication-required'; end if;
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
    runtime_scope=null,runtime_manifest_sha=null,duel_approved=false,duel_manifest_sha=null,
    moderation_reason='Deleted by owner',moderation_version=moderation_version+1,moderated_at=now()
    where id=f.id and owner_id=p_owner returning * into f;
  answer:=jsonb_build_object('ok',true,'stage','deleted','fighterId',f.id,'ownerId',p_owner,'name',d.confirm_name,
    'deletedAt',f.deleted_at,'deletionMode','soft-delete','privatePackageAndHistoryRetained',true,'fighterSlotReleased',true);
  update public.af_fighter_deletions set completed_at=now(),result=answer where token=d.token;
  return answer;
end $$;
revoke all on function public.af_prepare_fighter_deletion(uuid,uuid,uuid,uuid),public.af_delete_owned_fighter(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.af_prepare_fighter_deletion(uuid,uuid,uuid,uuid),public.af_delete_owned_fighter(uuid,uuid,uuid,uuid,uuid,text) to service_role;
