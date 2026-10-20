-- Google sign-in creates Supabase users. Submission stays invite-only through af_creators.
-- Signed-in users without an invitation can only read their own status and leave one access request.
create table public.af_access_requests (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  request_window timestamptz not null default now(), request_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.af_access_requests enable row level security;
revoke all on public.af_access_requests from public,anon,authenticated;
grant all on public.af_access_requests to service_role;
create policy af_access_requests_service on public.af_access_requests for all to service_role using (true) with check (true);

-- p_owner always comes from the verified token in the Edge API, never from the request.
create function public.af_account(p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'invited', c.owner_id is not null,
    'expiresAt', c.expires_at,
    'request', case when r.owner_id is null then null
      else jsonb_build_object('status', r.status, 'createdAt', r.created_at, 'updatedAt', r.updated_at) end)
  from (select p_owner as id) me
  left join public.af_creators c on c.owner_id=me.id and c.enabled and c.expires_at>now()
  left join public.af_access_requests r on r.owner_id=me.id;
$$;

-- One row per user. A repeat request reopens it; at most 3 requests per user in 24 hours.
-- A declined request stays declined for 7 days, so a repeat cannot erase the operator's decision at once.
create function public.af_request_access(p_owner uuid,p_note text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.af_access_requests;
begin
  if p_owner is null then raise exception 'authentication-required'; end if;
  if char_length(coalesce(p_note,'')) > 500 then raise exception 'note-too-long'; end if;
  if exists(select 1 from public.af_creators where owner_id=p_owner and enabled and expires_at>now()) then
    raise exception 'already-invited';
  end if;
  -- Two first requests at once: the second insert waits and does nothing instead of failing on the key.
  insert into public.af_access_requests(owner_id,note,request_count) values (p_owner,coalesce(p_note,''),0)
    on conflict (owner_id) do nothing;
  select * into r from public.af_access_requests where owner_id=p_owner for update;
  if r.status='declined' and r.updated_at > now()-interval '7 days' then raise exception 'request-declined'; end if;
  if r.request_count = 0 then
    update public.af_access_requests set request_count=1,request_window=now(),updated_at=now() where owner_id=p_owner;
  elsif r.request_window < now()-interval '24 hours' then
    update public.af_access_requests set note=coalesce(p_note,''),status='pending',request_window=now(),request_count=1,updated_at=now()
      where owner_id=p_owner;
  elsif r.request_count >= 3 then raise exception 'rate-limit';
  else
    update public.af_access_requests set note=coalesce(p_note,''),status='pending',request_count=r.request_count+1,updated_at=now()
      where owner_id=p_owner;
  end if;
  return public.af_account(p_owner);
end $$;

revoke all on function public.af_account(uuid),public.af_request_access(uuid,text) from public,anon,authenticated;
grant execute on function public.af_account(uuid),public.af_request_access(uuid,text) to service_role;
