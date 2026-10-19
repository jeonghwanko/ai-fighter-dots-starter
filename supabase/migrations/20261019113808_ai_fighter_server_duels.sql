-- All writes are service-only. Public guest requests can ask the Edge engine to fight,
-- but cannot choose a seed/result or write records. No duplicated tally counters.
create table public.af_duels (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  a uuid not null references public.af_fighters(id),
  b uuid not null references public.af_fighters(id),
  hash_a text not null check (hash_a ~ '^[a-f0-9]{64}$'),
  hash_b text not null check (hash_b ~ '^[a-f0-9]{64}$'),
  seed bigint not null check (seed between 0 and 4294967295),
  engine text not null check (length(engine) between 1 and 80),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  winner uuid references public.af_fighters(id),
  result jsonb,
  check (a <> b),
  check ((result is null and winner is null and completed_at is null) or
    (result is not null and winner is not null and completed_at is not null and winner in (a,b)))
);
create index af_duels_created on public.af_duels(created_at);
create index af_duels_a_completed on public.af_duels(a, completed_at desc) where completed_at is not null;
create index af_duels_b_completed on public.af_duels(b, completed_at desc) where completed_at is not null;
alter table public.af_duels enable row level security;
revoke all on public.af_duels from public,anon,authenticated;
grant select,insert,update on public.af_duels to service_role;
create policy af_duels_service on public.af_duels to service_role using (true) with check (true);

create function public.af_reserve_duel(p_key uuid,p_a uuid,p_b uuid,p_engine text)
returns public.af_duels language plpgsql security invoker set search_path='' as $$
declare r public.af_duels; fa public.af_fighters; fb public.af_fighters;
begin
  -- One short admission transaction serializes keys and the free-beta budgets.
  perform pg_advisory_xact_lock(193402019);
  select * into r from public.af_duels where request_key=p_key;
  if found then
    if r.a<>p_a or r.b<>p_b then raise exception 'idempotency-conflict'; end if;
    return r;
  end if;
  if p_a=p_b or p_engine is null then raise exception 'invalid-duel'; end if;
  if exists(select 1 from public.af_settings where paused) then raise exception 'duels-paused'; end if;
  select * into fa from public.af_fighters where id=p_a;
  select * into fb from public.af_fighters where id=p_b;
  if fa.id is null or fb.id is null or not fa.runtime_approved or not fb.runtime_approved
    or not fa.duel_approved or not fb.duel_approved or fa.review_state<>'approved' or fb.review_state<>'approved'
    or fa.runtime_scope<>'arena-player-v1' or fb.runtime_scope<>'arena-player-v1'
    or fa.duel_manifest_sha is distinct from fa.manifest_sha or fb.duel_manifest_sha is distinct from fb.manifest_sha
    then raise exception 'duel-not-approved'; end if;
  if (select count(*) from public.af_duels)>=10000
    or (select count(*) from public.af_duels where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=100
    or (select count(*) from public.af_duels where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
      and ((a=p_a and b=p_b) or (a=p_b and b=p_a)))>=20 then raise exception 'duel-budget'; end if;
  insert into public.af_duels(request_key,a,b,hash_a,hash_b,seed,engine)
    values(p_key,p_a,p_b,fa.manifest_sha,fb.manifest_sha,
      ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint,p_engine) returning * into r;
  return r;
end $$;

create function public.af_complete_duel(p_id uuid,p_engine text,p_result jsonb)
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
  update public.af_duels set result=p_result, winner=case when p_result->>'winner'='0' then a else b end,
    completed_at=now() where id=r.id returning * into r;
  return r;
end $$;

create function public.af_duel_rankings()
returns table(id uuid,name text,won bigint,lost bigint,points bigint,rank bigint)
language sql stable security invoker set search_path='' as $$
  with results as (
    select a as id,winner=a as won from public.af_duels where completed_at is not null
    union all select b,winner=b from public.af_duels where completed_at is not null
  ), totals as (
    select f.id,f.profile->>'name' as name,count(*) filter(where r.won) as won,count(*) filter(where not r.won) as lost
    from public.af_fighters f left join results r on f.id=r.id
    where f.duel_approved and f.runtime_approved and f.review_state='approved' and f.duel_manifest_sha=f.manifest_sha
    group by f.id,f.profile
  ) select id,name,won,lost,won*3 as points,dense_rank() over(order by won desc,lost asc) as rank
    from totals order by won desc,lost asc,name,id limit 20;
$$;
revoke all on function public.af_reserve_duel(uuid,uuid,uuid,text),public.af_complete_duel(uuid,text,jsonb),public.af_duel_rankings() from public,anon,authenticated;
grant execute on function public.af_reserve_duel(uuid,uuid,uuid,text),public.af_complete_duel(uuid,text,jsonb),public.af_duel_rankings() to service_role;
