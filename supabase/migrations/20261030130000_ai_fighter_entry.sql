-- 출전 (2026-10-30 사용자: "제작완료된 캐릭터를 '출전'해서 다른 사람들이 제작된 캐릭터로 토너먼트 플레이할 수 있도록 단계를 나눠야 돼"): a validated
-- package no longer goes out to other people on its own. A registered fighter is 제작 중 (in production) until his owner, having watched
-- each required motion on the creator site, enters him (출전, `entered_at`). Only an entered fighter is in the roster's list, ranked duels
-- and their ranking; the arena relay holds cups and spar to the same column. His own address (`roster/<id>`), his previews and arena
-- practice stay as they were. A new package returns him to 제작 중 (its motions were not watched); a profile or style edit keeps the art
-- and the entry. Registered fighters that already fought stay entered; the rest start in production.

alter table public.af_fighters add column entered_at timestamptz;
alter table public.af_fighters add constraint af_fighters_entry_registered
  check (entered_at is null or (status = 'registered' and deleted_at is null));

-- 사용자 결정 (2026-10-30, "전적 있는 선수만 출전"): a fighter with a completed duel or a cup bout keeps meeting people. The cup totals
-- belong to the arena relay's migrations, which a database without the relay (the kit's tests) lacks.
-- Each keeps the entry's evidence as an owner's entry does, naming this backfill instead of his ticks.
update public.af_fighters f set entered_at = f.created_at, review_evidence = coalesce(f.review_evidence, '{}'::jsonb)
    || jsonb_build_object('entry', jsonb_build_object('backfill', '20261030130000', 'reason', 'completed-duel', 'at', now()))
  where f.status = 'registered' and f.deleted_at is null
    and exists(select 1 from public.af_duels d where d.completed_at is not null and f.id in (d.a, d.b));
do $$ begin
  if to_regclass('public.af_arena_fighter_totals') is not null then
    execute $backfill$update public.af_fighters f set entered_at = f.created_at, review_evidence = coalesce(f.review_evidence, '{}'::jsonb)
        || jsonb_build_object('entry', jsonb_build_object('backfill', '20261030130000', 'reason', 'cup-bout', 'at', now()))
      where f.status = 'registered' and f.deleted_at is null and f.entered_at is null
        and exists(select 1 from public.af_arena_fighter_totals t where t.id = f.id::text and t.won + t.lost > 0)$backfill$;
  end if;
end $$;

-- His owner enters him on the package he watched (`p_sha`). Entering an entered fighter answers the same; the clips he ticked are kept
-- with the hash as the entry's evidence (the API checks that they are every required motion).
create function public.af_enter_fighter(p_owner uuid, p_fighter uuid, p_sha text, p_clips text[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters;
begin
  if p_clips is null or cardinality(p_clips) = 0 then raise exception 'invalid-entry'; end if;
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner for update;
  if not found or f.deleted_at is not null then raise exception 'not-found'; end if;
  if f.status <> 'registered' or not coalesce(f.runtime_approved and f.duel_approved and f.review_state = 'approved'
    and f.duel_manifest_sha = f.manifest_sha, false) then raise exception 'fighter-not-ready'; end if;
  if f.manifest_sha is distinct from p_sha then raise exception 'fighter-changed'; end if;
  if f.entered_at is null then
    update public.af_fighters set entered_at = now(), review_evidence = coalesce(review_evidence, '{}'::jsonb)
      || jsonb_build_object('entry', jsonb_build_object('manifestSha', p_sha, 'clips', to_jsonb(p_clips), 'at', now()))
      where id = f.id returning * into f;
  end if;
  return jsonb_build_object('ok', true, 'stage', 'entered', 'fighterId', f.id, 'enteredAt', f.entered_at);
end $$;

-- Back to 제작 중: other people stop meeting him; his record stays.
create function public.af_withdraw_fighter(p_owner uuid, p_fighter uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters;
begin
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner for update;
  if not found or f.deleted_at is not null then raise exception 'not-found'; end if;
  if f.entered_at is not null then update public.af_fighters set entered_at = null where id = f.id returning * into f; end if;
  return jsonb_build_object('ok', true, 'stage', 'in-production', 'fighterId', f.id, 'enteredAt', null);
end $$;
revoke all on function public.af_enter_fighter(uuid, uuid, text, text[]), public.af_withdraw_fighter(uuid, uuid) from public, anon, authenticated;
grant execute on function public.af_enter_fighter(uuid, uuid, text, text[]), public.af_withdraw_fighter(uuid, uuid) to service_role;

-- As 20261030100000, and entered: a ranked duel is meeting other people.
create or replace function public.af_duel_admitted(f public.af_fighters) returns boolean language sql stable security invoker set search_path='' as $$
  select f.id is not null and coalesce(f.runtime_approved and f.duel_approved and f.review_state='approved' and f.runtime_scope='arena-player-v1'
    and f.duel_manifest_sha is not distinct from f.manifest_sha and f.entered_at is not null, false)
$$;

-- As 20261020090000, and entered: a fighter in production keeps his record but holds no place in the ranking.
create or replace function public.af_duel_statistics()
returns table(id uuid, owner_id uuid, name text, appearances bigint, won bigint, lost bigint, points bigint, rank bigint)
language sql stable security invoker set search_path='' as $$
  with results as (
    select a as id, winner=a as won from public.af_duels where completed_at is not null
    union all select b as id, winner=b as won from public.af_duels where completed_at is not null
  ), totals as (
    select f.id, f.owner_id, f.profile->>'name' as name,
      f.duel_approved and f.runtime_approved and f.review_state='approved'
        and f.duel_manifest_sha=f.manifest_sha and f.entered_at is not null as ranked,
      count(*) filter(where r.won) as won, count(*) filter(where not r.won) as lost
    from public.af_fighters f left join results r on r.id=f.id
    group by f.id
  ), positions as (
    select t.id, dense_rank() over(order by t.won desc,t.lost asc) as rank
    from totals t where t.ranked
  )
  select t.id,t.owner_id,t.name,t.won+t.lost,t.won,t.lost,t.won*3,p.rank
  from totals t left join positions p on p.id=t.id;
$$;

-- As 20261029124500, and `entered_at` last (a view gains columns only at its end).
create or replace view public.af_roster_entries with (security_invoker = true) as
  select f.id, f.created_at, f.submission_id, f.manifest_sha, f.profile, f.runtime_approved, f.runtime_scope, f.runtime_manifest_sha,
    f.duel_approved, f.duel_manifest_sha, f.review_state, f.listed, a.client_name as made_with, f.entered_at
  from public.af_fighters f left join public.af_fighter_agents a on a.fighter_id = f.id;

-- As 20261023124255, and a new package for the same fighter clears his entry: its motions were not watched.
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
      -- Same row, new package: the ID, created_at and moderation fields stay; the duel record follows the ID. The entry does not.
      update public.af_fighters set status='registered',submission_id=s.id,manifest_sha=s.manifest_sha,profile=s.manifest->'profile',review_state='approved',
        runtime_approved=true,runtime_scope='arena-player-v1',runtime_manifest_sha=s.manifest_sha,duel_approved=true,duel_manifest_sha=s.manifest_sha,
        review_evidence=coalesce(f.review_evidence,'{}'::jsonb)||evidence,entered_at=null,updated_at=now()
        where id=f.id returning * into f;
    end if;
    update public.af_submissions set status='registered',fighter_id=f.id,validation=p_result where id=s.id returning * into s;
  else
    update public.af_submissions set status='rejected',validation=p_result where id=s.id returning * into s;
  end if;
  return s;
end $$;

-- As 20261030120000, and the deleted fighter leaves his entry (the constraint above holds a deleted fighter out of it).
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
    runtime_scope=null,runtime_manifest_sha=null,duel_approved=false,duel_manifest_sha=null,entered_at=null,
    moderation_reason='Deleted by owner',moderation_version=moderation_version+1,moderated_at=now()
    where id=f.id and owner_id=p_owner returning * into f;
  answer:=jsonb_build_object('ok',true,'stage','deleted','fighterId',f.id,'ownerId',p_owner,'name',d.confirm_name,
    'deletedAt',f.deleted_at,'deletionMode','soft-delete','privatePackageAndHistoryRetained',true,'fighterSlotReleased',true);
  update public.af_fighter_deletions set completed_at=now(),result=answer where token=d.token;
  return answer;
end $$;
