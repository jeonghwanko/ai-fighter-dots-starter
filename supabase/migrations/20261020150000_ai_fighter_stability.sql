-- Stability fixes. Signatures, grants, RLS and the immutable-submission trigger are unchanged.

-- 1. Allowed validator versions are data. Before, af_finish compared a literal: a worker with a new
--    validator failed every finish, and queued submissions ended as worker-attempt-limit rejections.
--    Add the new version here before deploying the new worker; remove the old one after.
alter table public.af_settings add column validator_versions text[] not null default array['ai-fighter-validator-0.2.0']
  check (cardinality(validator_versions) between 1 and 8);

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
    insert into public.af_fighters(submission_id,owner_id,manifest_sha,profile) values(s.id,s.owner_id,s.manifest_sha,s.manifest->'profile')
      on conflict(submission_id) do nothing;
    select * into f from public.af_fighters where submission_id=s.id;
    update public.af_submissions set status='registered',fighter_id=f.id,validation=p_result where id=s.id returning * into s;
  else
    update public.af_submissions set status='rejected',validation=p_result where id=s.id returning * into s;
  end if;
  return s;
end $$;

-- 2. A failed match no longer spends the match budgets. Before, every reservation counted, finished or not:
--    a broken engine drained the daily budget (100, 20 per pair) and no match could complete that day.
--    Failed runs count toward their own brake instead: 20 failed runs a day stop new runs and retries.
alter table public.af_duels add column failed_at timestamptz;
alter table public.af_duels add column failures integer not null default 0 check (failures >= 0);
alter table public.af_duels add column failure text check (failure is null or failure ~ '^[a-z0-9-]{1,40}$');
alter table public.af_duels add constraint af_duels_failed_unfinished check (failed_at is null or result is null);
create index af_duels_failed on public.af_duels(failed_at) where failed_at is not null;

create or replace function public.af_reserve_duel(p_key uuid,p_a uuid,p_b uuid,p_engine text)
returns public.af_duels language plpgsql security invoker set search_path='' as $$
declare r public.af_duels; fa public.af_fighters; fb public.af_fighters;
  today timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  failing boolean;
begin
  -- One short admission transaction serializes keys and the free-beta budgets.
  perform pg_advisory_xact_lock(193402019);
  failing := (select coalesce(sum(failures),0) from public.af_duels where failed_at>=today) >= 20;
  select * into r from public.af_duels where request_key=p_key;
  if found then
    if r.a<>p_a or r.b<>p_b then raise exception 'idempotency-conflict'; end if;
    -- A retry of an unfinished match runs the engine again.
    if r.result is null and failing then raise exception 'duels-failing'; end if;
    return r;
  end if;
  if p_a=p_b or p_engine is null then raise exception 'invalid-duel'; end if;
  if exists(select 1 from public.af_settings where paused) then raise exception 'duels-paused'; end if;
  if failing then raise exception 'duels-failing'; end if;
  select * into fa from public.af_fighters where id=p_a;
  select * into fb from public.af_fighters where id=p_b;
  if fa.id is null or fb.id is null or not fa.runtime_approved or not fb.runtime_approved
    or not fa.duel_approved or not fb.duel_approved or fa.review_state<>'approved' or fb.review_state<>'approved'
    or fa.runtime_scope<>'arena-player-v1' or fb.runtime_scope<>'arena-player-v1'
    or fa.duel_manifest_sha is distinct from fa.manifest_sha or fb.duel_manifest_sha is distinct from fb.manifest_sha
    then raise exception 'duel-not-approved'; end if;
  -- Budgets count completed and in-flight matches, not failed runs.
  if (select count(*) from public.af_duels where failed_at is null)>=10000
    or (select count(*) from public.af_duels where failed_at is null and created_at>=today)>=100
    or (select count(*) from public.af_duels where failed_at is null and created_at>=today
      and ((a=p_a and b=p_b) or (a=p_b and b=p_a)))>=20 then raise exception 'duel-budget'; end if;
  insert into public.af_duels(request_key,a,b,hash_a,hash_b,seed,engine)
    values(p_key,p_a,p_b,fa.manifest_sha,fb.manifest_sha,
      ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint,p_engine) returning * into r;
  return r;
end $$;

create or replace function public.af_complete_duel(p_id uuid,p_engine text,p_result jsonb)
returns public.af_duels language plpgsql security invoker set search_path='' as $$
declare r public.af_duels;
begin
  select * into r from public.af_duels where id=p_id for update;
  if not found then raise exception 'not-found'; end if;
  if r.engine<>p_engine then raise exception 'engine-mismatch'; end if;
  if r.result is not null then
    if r.result is distinct from p_result then raise exception 'result-conflict'; end if;
    return r;
  end if;
  if p_result is null or jsonb_typeof(p_result)<>'object' or not (p_result ?& array['winner','how','ms','hp','contacts','digest'])
    or p_result->>'winner' not in ('0','1') or p_result->>'how' not in ('ko','decision')
    or not (p_result->>'digest' ~ '^[a-f0-9]{8}$')
    or (p_result->>'ms')::numeric not between 1 and 90000
    or jsonb_array_length(p_result->'hp')<>2 or jsonb_array_length(p_result->'contacts')<>2 then raise exception 'invalid-result'; end if;
  if (select count(*) from public.af_fighters f where (f.id=r.a and f.manifest_sha=r.hash_a or f.id=r.b and f.manifest_sha=r.hash_b)
    and f.duel_approved and f.runtime_approved and f.review_state='approved' and f.duel_manifest_sha=f.manifest_sha)<>2
    then raise exception 'duel-not-approved'; end if;
  -- A successful retry of a failed run counts as an ordinary match again.
  update public.af_duels set result=p_result, winner=case when p_result->>'winner'='0' then a else b end,
    completed_at=now(), failed_at=null, failure=null where id=r.id returning * into r;
  return r;
end $$;

create function public.af_fail_duel(p_id uuid,p_engine text,p_code text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.af_duels set failed_at=now(), failures=failures+1, failure=p_code
    where id=p_id and engine=p_engine and result is null;
end $$;
revoke all on function public.af_fail_duel(uuid,text,text) from public,anon,authenticated;
grant execute on function public.af_fail_duel(uuid,text,text) to service_role;
