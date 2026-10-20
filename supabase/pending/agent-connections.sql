-- File only: apply through the project's reviewed migration process, never db reset.
-- No OAuth application, user, invitation, signing key or live grant is created.
create table public.af_connection_clients (
  id text primary key check (id ~ '^[a-z0-9-]{1,64}$'),
  name text not null check (length(name) between 1 and 100),
  enabled boolean not null default false
);
insert into public.af_connection_clients(id,name) values ('ai-fighter-stdio','AI Fighter local stdio');
create table public.af_connections (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  agent_id uuid not null default gen_random_uuid(),
  client_id text not null references public.af_connection_clients(id),
  resource text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  requested text[] not null check (cardinality(requested) between 1 and 2 and requested <@ array['fighter:read','fighter:submit']),
  permissions text[] not null default '{}',
  owner_id uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled','revoked')),
  created_at timestamptz not null default now(),
  pending_until timestamptz not null default now() + interval '10 minutes',
  expires_at timestamptz,
  check (permissions <@ requested),
  check (status <> 'approved' or (owner_id is not null and cardinality(permissions)>0 and expires_at is not null))
);
create index af_connections_owner on public.af_connections(owner_id,created_at);
create index af_connections_created on public.af_connections(created_at);
create table public.af_connection_events (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.af_connections(id),
  owner_id uuid references auth.users(id),
  agent_id uuid not null,
  client_id text not null,
  action text not null,
  target text not null default '',
  created_at timestamptz not null default now()
);
alter table public.af_connection_clients enable row level security;
alter table public.af_connections enable row level security;
alter table public.af_connection_events enable row level security;
revoke all on public.af_connection_clients, public.af_connections, public.af_connection_events from public,anon,authenticated;
grant all on public.af_connection_clients, public.af_connections, public.af_connection_events to service_role;
revoke all on sequence public.af_connection_events_id_seq from public,anon,authenticated;
grant usage,select on sequence public.af_connection_events_id_seq to service_role;

-- Existing permissive owner policies alone must not admit native OAuth clients.
-- Equivalent to auth.jwt()->>'client_id'; current_setting also works in isolated Postgres tests.
create policy af_submissions_first_party on public.af_submissions as restrictive for all to authenticated
  using ((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb ->> 'client_id') is null);
create policy af_fighters_first_party on public.af_fighters as restrictive for all to authenticated
  using ((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb ->> 'client_id') is null);
-- Supabase Storage has RLS enabled. A pre-existing game's permissive owner policy
-- must not accidentally expose this private bucket, even to a first-party JWT.
-- Other buckets keep their existing policies; Edge/worker use service_role.
create policy af_storage_api_only on storage.objects as restrictive for all to anon,authenticated
  using (bucket_id <> 'ai-fighter-beta')
  with check (bucket_id <> 'ai-fighter-beta');

create function public.af_connection_view(c public.af_connections) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',c.id,'agentId',c.agent_id,'clientId',c.client_id,
    'clientName',(select name from public.af_connection_clients where id=c.client_id),
    'resource',c.resource,'requested',c.requested,'permissions',c.permissions,
    'status',case when (c.status='pending' and c.pending_until<=now())
      or (c.status='approved' and c.expires_at<=now()) then 'expired' else c.status end,
    'pendingUntil',c.pending_until,'expiresAt',c.expires_at);
$$;

create function public.af_connection_start(p_request uuid,p_client text,p_token_hash text,p_code_hash text,p_resource text,p_permissions text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.af_connections;
begin
  -- Serialize creation across clients for bounded anonymous DB use and duplicate requests.
  perform pg_advisory_xact_lock(20261020,3);
  if not exists(select 1 from public.af_connection_clients where id=p_client and enabled) then raise exception 'connection-client'; end if;
  if p_request is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_resource is null or length(p_resource)>512
    or p_permissions is null or cardinality(p_permissions) not between 1 and 2
    or not (p_permissions <@ array['fighter:read','fighter:submit']) then raise exception 'invalid-connection'; end if;
  select * into c from public.af_connections where request_id=p_request;
  if found then
    if row(c.client_id,c.token_hash,c.code_hash,c.resource,c.requested) is distinct from
      row(p_client,p_token_hash,p_code_hash,p_resource,p_permissions) then raise exception 'connection-conflict'; end if;
    return public.af_connection_view(c);
  end if;
  if exists(select 1 from public.af_connections where token_hash=p_token_hash or code_hash=p_code_hash) then raise exception 'connection-conflict'; end if;
  -- Total cap intentionally stops admission pending operator retention review.
  if (select count(*) from public.af_connections)>=10000
    or (select count(*) from public.af_connections where created_at>now()-interval '1 minute')>=20
    or (select count(*) from public.af_connections where status='pending' and pending_until>now())>=100 then raise exception 'connection-limit'; end if;
  insert into public.af_connections(request_id,client_id,token_hash,code_hash,resource,requested)
    values(p_request,p_client,p_token_hash,p_code_hash,p_resource,p_permissions) returning * into c;
  return public.af_connection_view(c);
end $$;

create function public.af_connection_owner(p_owner uuid,p_command text,p_code_hash text default null,p_id uuid default null,p_permissions text[] default null,p_seconds integer default 900)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.af_connections;
begin
  -- Owner comes only from Edge getClaims, never from a request body or editable metadata.
  if p_owner is null then raise exception 'invalid-connection'; end if;
  if p_command='list' then
    return jsonb_build_object('items',coalesce((select jsonb_agg(public.af_connection_view(s)) from
      (select * from public.af_connections where owner_id=p_owner
        order by (status='approved' and expires_at>now()) desc,created_at desc limit 100) s),'[]'::jsonb));
  end if;
  if p_command not in ('inspect','approve','deny','revoke') then raise exception 'invalid-connection'; end if;
  -- Serialize owner approvals as well as each grant, so concurrent approvals cannot exceed quota.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  if p_command='revoke' then
    select * into c from public.af_connections where id=p_id and owner_id=p_owner for update;
  else
    select * into c from public.af_connections where code_hash=p_code_hash for update;
  end if;
  if not found or (c.owner_id is not null and c.owner_id<>p_owner) then raise exception 'connection-not-found'; end if;
  if p_command='inspect' then return public.af_connection_view(c); end if;
  if p_command='revoke' then
    if c.status='revoked' then return public.af_connection_view(c); end if;
    if c.status<>'approved' then raise exception 'connection-inactive'; end if;
    update public.af_connections set status='revoked' where id=c.id returning * into c;
  else
    if p_command='approve' and c.status='approved' and c.owner_id=p_owner
      and c.permissions=p_permissions and c.expires_at>now() then return public.af_connection_view(c); end if;
    if p_command='deny' and c.status='denied' and c.owner_id=p_owner then return public.af_connection_view(c); end if;
    if c.status<>'pending' then raise exception 'connection-inactive'; end if;
    if c.pending_until<=now() then raise exception 'connection-expired'; end if;
    if p_command='approve' then
      if not exists(select 1 from public.af_connection_clients where id=c.client_id and enabled) then raise exception 'connection-client'; end if;
      if p_permissions is null or cardinality(p_permissions) not between 1 and 2 or not(p_permissions <@ c.requested)
        or p_seconds is null or p_seconds not between 60 and 3600 then raise exception 'connection-permission'; end if;
      if (select count(*) from public.af_connections where owner_id=p_owner and status='approved' and expires_at>now())>=10 then raise exception 'connection-limit'; end if;
      update public.af_connections set owner_id=p_owner,status='approved',permissions=p_permissions,
        expires_at=now()+make_interval(secs=>p_seconds) where id=c.id returning * into c;
    else
      update public.af_connections set owner_id=p_owner,status='denied' where id=c.id returning * into c;
    end if;
  end if;
  insert into public.af_connection_events(connection_id,owner_id,agent_id,client_id,action)
    values(c.id,p_owner,c.agent_id,c.client_id,p_command);
  return public.af_connection_view(c);
end $$;

create function public.af_connection_agent(p_token_hash text,p_client text,p_resource text,p_action text,p_target text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.af_connections;
begin
  select * into c from public.af_connections where token_hash=p_token_hash for update;
  if not found then raise exception 'connection-not-found'; end if;
  if c.client_id is distinct from p_client then raise exception 'connection-client'; end if;
  if c.resource is distinct from p_resource then raise exception 'connection-resource'; end if;
  if p_action='cancel' then
    if c.status='cancelled' then return public.af_connection_view(c); end if;
    if c.status not in ('pending','approved') then raise exception 'connection-inactive'; end if;
    update public.af_connections set status='cancelled' where id=c.id returning * into c;
    insert into public.af_connection_events(connection_id,owner_id,agent_id,client_id,action)
      values(c.id,c.owner_id,c.agent_id,c.client_id,'cancel');
    return public.af_connection_view(c);
  end if;
  if p_action='status' then return public.af_connection_view(c); end if;
  if not exists(select 1 from public.af_connection_clients where id=c.client_id and enabled) then raise exception 'connection-client'; end if;
  if c.status<>'approved' then raise exception 'connection-inactive'; end if;
  if c.expires_at<=now() then raise exception 'connection-expired'; end if;
  if p_action is null or not(p_action=any(c.permissions)) then raise exception 'connection-permission'; end if;
  if length(p_target)>512 then raise exception 'invalid-connection'; end if;
  if (select count(*) from public.af_connection_events where connection_id=c.id and created_at>now()-interval '1 minute')>=120 then raise exception 'connection-limit'; end if;
  -- This records authorization attempts, not a claim of successful resource mutation.
  insert into public.af_connection_events(connection_id,owner_id,agent_id,client_id,action,target)
    values(c.id,c.owner_id,c.agent_id,c.client_id,p_action,p_target);
  return public.af_connection_view(c)||jsonb_build_object('ownerId',c.owner_id);
end $$;
create index af_connection_events_rate on public.af_connection_events(connection_id,created_at);

revoke all on function public.af_connection_view(public.af_connections),
  public.af_connection_start(uuid,text,text,text,text,text[]),
  public.af_connection_owner(uuid,text,text,uuid,text[],integer),
  public.af_connection_agent(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.af_connection_view(public.af_connections),
  public.af_connection_start(uuid,text,text,text,text,text[]),
  public.af_connection_owner(uuid,text,text,uuid,text[],integer),
  public.af_connection_agent(text,text,text,text,text) to service_role;
