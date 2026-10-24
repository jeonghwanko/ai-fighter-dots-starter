-- Device-connection sign-in for a workspace whose 127.0.0.1 callback the user's browser cannot reach (a bot VM).
-- The workspace keeps a secret device code; only its SHA-256 is stored here. The user approves a short, public
-- pairing code on the homepage while signed in with Google. The workspace then polls once more and receives a
-- one-use magic-link token hash for that user (the same mechanism as creator-handoffs). No authorization code or
-- token ever has to pass through chat.
create table public.af_device_logins (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique check (device_code_hash ~ '^[a-f0-9]{64}$'),
  user_code text not null check (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{8}$'),
  status text not null default 'pending' check (status in ('pending','approved','consumed')),
  owner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz, consumed_at timestamptz, polled_at timestamptz,
  check ((status = 'pending') = (owner_id is null))
);
-- A pending code names exactly one request; old codes may repeat once their request is closed.
create unique index af_device_logins_open_code on public.af_device_logins(user_code) where status = 'pending';
create index af_device_logins_created on public.af_device_logins(created_at);
create index af_device_logins_owner_approved on public.af_device_logins(owner_id, approved_at);
alter table public.af_device_logins enable row level security;
revoke all on public.af_device_logins from public,anon,authenticated;
grant all on public.af_device_logins to service_role;
create policy af_device_logins_service on public.af_device_logins for all to service_role using (true) with check (true);

-- Unauthenticated start: a global brake of 120 starts per 10 minutes, and rows closed for a day are removed.
create function public.af_device_login_start(p_device_code_hash text,p_user_code text,p_ttl_seconds integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.af_device_logins;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 900 then raise exception 'invalid-ttl'; end if;
  delete from public.af_device_logins where expires_at < now() - interval '1 day';
  if (select count(*) from public.af_device_logins where created_at > now() - interval '10 minutes') >= 120 then
    raise exception 'rate-limit';
  end if;
  begin
    insert into public.af_device_logins(device_code_hash,user_code,expires_at)
    values (p_device_code_hash,p_user_code,now() + make_interval(secs => p_ttl_seconds)) returning * into r;
  exception when unique_violation then raise exception 'user-code-collision';
  end;
  return jsonb_build_object('userCode', r.user_code, 'expiresAt', r.expires_at);
end $$;

-- p_owner always comes from the verified token in the Edge API. At most 10 approvals per user per hour.
create function public.af_device_login_approve(p_owner uuid,p_user_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.af_device_logins;
begin
  if p_owner is null then raise exception 'authentication-required'; end if;
  if (select count(*) from public.af_device_logins where owner_id = p_owner and approved_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate-limit';
  end if;
  update public.af_device_logins set status = 'approved', owner_id = p_owner, approved_at = now()
  where user_code = p_user_code and status = 'pending' and expires_at > now() returning * into r;
  if not found then raise exception 'device-login-not-found'; end if;
  return jsonb_build_object('approved', true, 'expiresAt', r.expires_at);
end $$;

-- The workspace polls with its secret. An approval is handed out exactly once: approved becomes consumed here.
-- Polling within 4 seconds of the previous accepted poll is refused (RFC 8628 slow_down).
create function public.af_device_login_poll(p_device_code_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.af_device_logins; previous timestamptz;
begin
  select * into r from public.af_device_logins where device_code_hash = p_device_code_hash for update;
  if not found then raise exception 'device-login-not-found'; end if;
  if r.status = 'consumed' then return jsonb_build_object('status', 'consumed'); end if;
  if r.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  previous := r.polled_at;
  update public.af_device_logins set polled_at = now() where id = r.id;
  if previous is not null and previous > now() - interval '4 seconds' then raise exception 'slow-down'; end if;
  if r.status = 'pending' then return jsonb_build_object('status', 'pending'); end if;
  update public.af_device_logins set status = 'consumed', consumed_at = now() where id = r.id;
  return jsonb_build_object('status', 'approved', 'owner', r.owner_id);
end $$;

revoke all on function public.af_device_login_start(text,text,integer) from public,anon,authenticated;
revoke all on function public.af_device_login_approve(uuid,text) from public,anon,authenticated;
revoke all on function public.af_device_login_poll(text) from public,anon,authenticated;
grant execute on function public.af_device_login_start(text,text,integer) to service_role;
grant execute on function public.af_device_login_approve(uuid,text) to service_role;
grant execute on function public.af_device_login_poll(text) to service_role;
