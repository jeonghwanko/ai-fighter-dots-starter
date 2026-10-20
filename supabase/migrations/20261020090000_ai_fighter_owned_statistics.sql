-- One aggregate owns both the public top 20 and the owner's complete record.
-- No counters, client table grants, or changes to saved matches.
create function public.af_duel_statistics()
returns table(id uuid, owner_id uuid, name text, appearances bigint, won bigint, lost bigint, points bigint, rank bigint)
language sql stable security invoker set search_path='' as $$
  with results as (
    select a as id, winner=a as won from public.af_duels where completed_at is not null
    union all select b as id, winner=b as won from public.af_duels where completed_at is not null
  ), totals as (
    select f.id, f.owner_id, f.profile->>'name' as name,
      f.duel_approved and f.runtime_approved and f.review_state='approved'
        and f.duel_manifest_sha=f.manifest_sha as ranked,
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

create or replace function public.af_duel_rankings()
returns table(id uuid,name text,won bigint,lost bigint,points bigint,rank bigint)
language sql stable security invoker set search_path='' as $$
  select s.id,s.name,s.won,s.lost,s.points,s.rank from public.af_duel_statistics() s
  where s.rank is not null order by s.won desc,s.lost asc,s.name,s.id limit 20;
$$;

-- Only the Edge service may call this. p_owner comes from auth.getUser(token),
-- never from a request body/query. Missing and foreign fighters both return no row.
create function public.af_owned_fighter_statistics(p_owner uuid,p_fighter uuid)
returns table(id uuid,appearances bigint,won bigint,lost bigint,points bigint,rank bigint)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_owner is null or not exists(select 1 from public.af_fighters f where f.id=p_fighter and f.owner_id=p_owner) then
    return;
  end if;
  return query select s.id,s.appearances,s.won,s.lost,s.points,s.rank
    from public.af_duel_statistics() s where s.id=p_fighter and s.owner_id=p_owner;
end;
$$;

revoke all on function public.af_duel_statistics(),public.af_owned_fighter_statistics(uuid,uuid),public.af_duel_rankings() from public,anon,authenticated;
grant execute on function public.af_duel_statistics(),public.af_owned_fighter_statistics(uuid,uuid),public.af_duel_rankings() to service_role;
