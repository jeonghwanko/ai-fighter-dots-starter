-- Service-only administration. JWT identity is verified by the Edge API; browsers cannot call these RPCs directly.
create table public.af_admins (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.af_access_reviews (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  request_version timestamptz not null,
  decision text not null check (decision in ('approved','declined')),
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique(owner_id, request_version)
);
alter table public.af_admins enable row level security;
alter table public.af_access_reviews enable row level security;
revoke all on public.af_admins, public.af_access_reviews from public, anon, authenticated;
grant all on public.af_admins, public.af_access_reviews to service_role;
grant usage, select on sequence public.af_access_reviews_id_seq to service_role;
create policy af_admins_service on public.af_admins for all to service_role using (true) with check (true);
create policy af_access_reviews_service on public.af_access_reviews for all to service_role using (true) with check (true);

create function public.af_admin_account(p_actor uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.af_admins where owner_id=p_actor and enabled);
$$;

create function public.af_admin_requests(p_actor uuid, p_status text default 'pending', p_search text default '', p_page integer default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_status not in ('pending','approved','declined','all') or p_status is null or p_page is null or p_page < 0 or p_page > 10000
    or p_search is null or char_length(p_search)>200 then raise exception 'invalid-query'; end if;
  select jsonb_build_object(
    'counts', (select jsonb_build_object('pending',count(*) filter(where status='pending'),
      'approved',count(*) filter(where status='approved'),'declined',count(*) filter(where status='declined')) from public.af_access_requests),
    'activeCreators',(select count(*) from public.af_creators where enabled and expires_at>now()),
    'capacity',20,
    'total',count(*),
    'applications',coalesce((select jsonb_agg(item order by updated_at desc,owner_id) from (
      select r.updated_at,r.owner_id,jsonb_build_object('ownerId',r.owner_id,'email',u.email,'note',r.note,'status',r.status,
        'createdAt',r.created_at,'updatedAt',r.updated_at,
        'invited',coalesce(c.enabled and c.expires_at>now(),false),'expiresAt',c.expires_at,
        'review', (select jsonb_build_object('decision',v.decision,'reason',v.reason,'createdAt',v.created_at)
          from public.af_access_reviews v where v.owner_id=r.owner_id order by v.id desc limit 1)) as item
      from public.af_access_requests r join auth.users u on u.id=r.owner_id left join public.af_creators c on c.owner_id=r.owner_id
      where (p_status='all' or r.status=p_status) and (p_search='' or strpos(lower(coalesce(u.email,'') || ' ' || r.note),lower(p_search))>0)
      order by r.updated_at desc,r.owner_id limit 20 offset p_page*20
    ) page),'[]'::jsonb)) into result
  from public.af_access_requests r join auth.users u on u.id=r.owner_id
  where (p_status='all' or r.status=p_status) and (p_search='' or strpos(lower(coalesce(u.email,'') || ' ' || r.note),lower(p_search))>0);
  return result;
end $$;

create function public.af_admin_review(p_actor uuid,p_owner uuid,p_version timestamptz,p_decision text,p_reason text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare application record; prior record; expiry timestamptz;
begin
  -- Lock the role so disabling an administrator and reviewing cannot race.
  perform 1 from public.af_admins where owner_id=p_actor and enabled for share;
  if not found then raise exception 'admin-required'; end if;
  if p_decision is null or p_decision not in ('approved','declined') or p_version is null or p_reason is null
    or char_length(p_reason)>500 then raise exception 'invalid-review'; end if;
  select * into application from public.af_access_requests where owner_id=p_owner for update;
  if not found then raise exception 'not-found'; end if;
  select * into prior from public.af_access_reviews where owner_id=p_owner and request_version=p_version;
  if found then
    if prior.decision=p_decision and prior.reason=p_reason then
      return jsonb_build_object('status',prior.decision,'replayed',true);
    end if;
    raise exception 'review-conflict';
  end if;
  if application.status <> 'pending' or application.updated_at<>p_version then raise exception 'review-conflict'; end if;
  if p_decision='approved' then
    -- The beta's existing hard cap is 20. Serialize approvals across applicants.
    perform pg_advisory_xact_lock(19042026,16);
    if not exists(select 1 from public.af_creators where owner_id=p_owner and enabled and expires_at>now())
      and (select count(*) from public.af_creators where enabled and expires_at>now())>=20 then raise exception 'beta-capacity'; end if;
    insert into public.af_creators(owner_id,enabled,expires_at) values(p_owner,true,now()+interval '30 days')
      on conflict(owner_id) do update set enabled=true,expires_at=greatest(public.af_creators.expires_at,excluded.expires_at)
      returning expires_at into expiry;
  end if;
  update public.af_access_requests set status=p_decision,updated_at=clock_timestamp() where owner_id=p_owner;
  insert into public.af_access_reviews(owner_id,reviewer_id,request_version,decision,reason)
    values(p_owner,p_actor,p_version,p_decision,p_reason);
  return jsonb_build_object('status',p_decision,'expiresAt',expiry,'replayed',false);
end $$;

revoke all on function public.af_admin_account(uuid), public.af_admin_requests(uuid,text,text,integer),
  public.af_admin_review(uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.af_admin_account(uuid), public.af_admin_requests(uuid,text,text,integer),
  public.af_admin_review(uuid,uuid,timestamptz,text,text) to service_role;
