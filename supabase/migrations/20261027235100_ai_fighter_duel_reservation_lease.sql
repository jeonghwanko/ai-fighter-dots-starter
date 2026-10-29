-- Duel reservations (2026-10-27): af_reserve_duel inserts a row before the Edge engine runs; af_complete_duel or
-- af_fail_duel closes it. If the isolate is killed in between, the row stayed unfinished forever and counted
-- against every duel budget as in flight. Abandoned reservations (older than five minutes, no result, not failed)
-- now stop counting. The whole function is restated from 20261020150000 with only the budget clause changed.
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
  -- Budgets count completed and in-flight matches, not failed runs. A reservation that neither completed nor failed
  -- within five minutes was abandoned (the Edge run was killed); it no longer holds budget. A retry of its key still runs.
  if (select count(*) from public.af_duels where failed_at is null and (result is not null or created_at>now()-interval '5 minutes'))>=10000
    or (select count(*) from public.af_duels where failed_at is null and created_at>=today
      and (result is not null or created_at>now()-interval '5 minutes'))>=100
    or (select count(*) from public.af_duels where failed_at is null and created_at>=today
      and (result is not null or created_at>now()-interval '5 minutes')
      and ((a=p_a and b=p_b) or (a=p_b and b=p_a)))>=20 then raise exception 'duel-budget'; end if;
  insert into public.af_duels(request_key,a,b,hash_a,hash_b,seed,engine)
    values(p_key,p_a,p_b,fa.manifest_sha,fb.manifest_sha,
      ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint,p_engine) returning * into r;
  return r;
end $$;
