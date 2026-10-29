-- API 점검 (2026-10-29): a retry of an unfinished match ran the engine again without admitting it again. A fighter edited or removed
-- after the reservation made each retry fail (package-mismatch, duel-not-approved), and every failure counted toward the day's brake of
-- 20: one owner could stop every guest duel until midnight UTC by repeating one key. A retry is now admitted like a new match, on the
-- packages it was reserved with, and the brake counts the engine's failures only: a run refused for its fighters is theirs.
-- af_reserve_duel is restated whole from 20261027235100; its admission moves into af_duel_admitted, which both paths use.

create function public.af_duel_admitted(f public.af_fighters) returns boolean language sql stable security invoker set search_path='' as $$
  select f.id is not null and coalesce(f.runtime_approved and f.duel_approved and f.review_state='approved' and f.runtime_scope='arena-player-v1'
    and f.duel_manifest_sha is not distinct from f.manifest_sha, false)
$$;

create or replace function public.af_reserve_duel(p_key uuid,p_a uuid,p_b uuid,p_engine text)
returns public.af_duels language plpgsql security invoker set search_path='' as $$
declare r public.af_duels; fa public.af_fighters; fb public.af_fighters;
  today timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  failing boolean;
begin
  -- One short admission transaction serializes keys and the free-beta budgets.
  perform pg_advisory_xact_lock(193402019);
  -- The brake counts the engine's failures. A run refused for its fighters (changed, removed, no longer valid) is theirs, and their
  -- owner could repeat it.
  failing := (select coalesce(sum(failures),0) from public.af_duels where failed_at>=today
    and coalesce(failure,'') not in ('package-mismatch','package-invalid','duel-not-approved','not-found')) >= 20;
  select * into r from public.af_duels where request_key=p_key;
  if found then
    if r.a<>p_a or r.b<>p_b then raise exception 'idempotency-conflict'; end if;
    if r.result is null then
      -- A retry of an unfinished match runs the engine again, so it is admitted again: both fighters still admitted, on the packages
      -- the match was reserved with.
      if failing then raise exception 'duels-failing'; end if;
      select * into fa from public.af_fighters where id=r.a;
      select * into fb from public.af_fighters where id=r.b;
      if not public.af_duel_admitted(fa) or not public.af_duel_admitted(fb) or fa.manifest_sha<>r.hash_a or fb.manifest_sha<>r.hash_b
        then raise exception 'duel-not-approved'; end if;
    end if;
    return r;
  end if;
  if p_a=p_b or p_engine is null then raise exception 'invalid-duel'; end if;
  if exists(select 1 from public.af_settings where paused) then raise exception 'duels-paused'; end if;
  if failing then raise exception 'duels-failing'; end if;
  select * into fa from public.af_fighters where id=p_a;
  select * into fb from public.af_fighters where id=p_b;
  if not public.af_duel_admitted(fa) or not public.af_duel_admitted(fb) then raise exception 'duel-not-approved'; end if;
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

revoke all on function public.af_duel_admitted(public.af_fighters) from public, anon, authenticated;
grant execute on function public.af_duel_admitted(public.af_fighters) to service_role;
