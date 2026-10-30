-- 선수 삭제를 사이트에서 (2026-10-30 사용자: "삭제하기는 별도로 버튼이 있고, 확실히 처리를 해야할 것 같거든"): the creator site's delete
-- button runs the cloud MCP's two steps (20261024104406), through the Edge (api/fighter-deletion.mjs). A site sign-in has no OAuth client,
-- so the Edge passes the nil UUID as the client; its session must then be a live first-party session of the same user. A sign-out
-- deletes that row, so a token kept after it can neither prepare nor delete. A connector session still needs its live, unrevoked grant.
-- Both functions are restated whole from 20261024104406 with only the session check changed.
create function public.af_owner_session_active(p_owner uuid,p_session uuid,p_client uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when p_client='00000000-0000-0000-0000-000000000000'::uuid
    then exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_owner and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>now()))
    else public.af_mcp_session_active(p_owner,p_session,p_client) end;
$$;
revoke all on function public.af_owner_session_active(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.af_owner_session_active(uuid,uuid,uuid) to service_role;

create or replace function public.af_prepare_fighter_deletion(p_owner uuid,p_fighter uuid,p_session uuid,p_client uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; d public.af_fighter_deletions; current_snapshot jsonb; display_name text;
begin
  if not public.af_owner_session_active(p_owner,p_session,p_client) then raise exception 'authentication-required'; end if;
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
