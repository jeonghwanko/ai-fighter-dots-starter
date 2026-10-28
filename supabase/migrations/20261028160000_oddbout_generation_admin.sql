-- 운영자 화면의 생성 호스트와 확인을 기다리는 신청 (2026-10-28). Design: game repo docs/Plan/2026-10-28-community-generation-hosts.
-- The first community host was approved, and its stuck request looked at, only through SQL (사용자: "UX와 성능개선에서 남은 작업 하자").
-- The admin page lists the hosts (approve or withdraw) and the requests a stage left for the operator (needs_review: run that stage again,
-- or cancel). A request waiting for the operator never expires on its own (`af_generation_expire` ends only the ones waiting for creators).

create function public.af_admin_generation_hosts(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'official', h.official, 'approved', h.approved,
      'enabled', h.enabled, 'acceptsAny', h.accepts_any, 'billing', h.billing, 'dailyLimit', h.daily_limit, 'today', public.af_generation_host_today(h.id),
      'live', public.af_generation_host_live(h), 'lastSeenAt', h.worker_seen_at, 'createdAt', h.created_at, 'email', u.email,
      'keys', (select count(*) from public.af_workers w where w.host_id = h.id and w.enabled and w.expires_at > now()))
      order by h.official desc, h.approved, h.created_at desc)
    from public.af_generation_hosts h left join auth.users u on u.id = h.owner_id), '[]'::jsonb);
end $$;

-- Approve a community host (he then takes other people's requests too) or withdraw it (his own requests only, as before approval).
create function public.af_admin_generation_host_approval(p_actor uuid, p_host uuid, p_approved boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare h public.af_generation_hosts;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_approved is null then raise exception 'invalid-review'; end if;
  update public.af_generation_hosts set approved = p_approved, updated_at = now() where id = p_host and not official returning * into h;
  if not found then raise exception 'not-found'; end if;
  return jsonb_build_object('id', h.id, 'approved', h.approved);
end $$;

-- Requests a stage left for the operator (`needs_review`), or every request not over (`open`): newest first, fifty at most.
create function public.af_admin_generations(p_actor uuid, p_status text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_status not in ('needs_review', 'open') then raise exception 'invalid-query'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'status', j.status, 'errorCode', j.error_code, 'description', left(j.description, 160),
      'email', u.email, 'host', coalesce(a.name, r.name), 'official', coalesce(a.official, j.host_choice = 'oddbout'), 'delegate', j.delegate,
      'leases', j.stage_leases, 'createdAt', j.created_at, 'updatedAt', j.updated_at) order by j.updated_at desc)
    from (select * from public.af_generation_jobs j0
          where (p_status = 'needs_review' and j0.status = 'needs_review')
             or (p_status = 'open' and j0.status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired'))
          order by j0.updated_at desc limit 50) j
    left join auth.users u on u.id = j.owner_id
    left join public.af_generation_hosts a on a.id = j.assigned_host
    left join public.af_generation_hosts r on r.id = j.requested_host), '[]'::jsonb);
end $$;

-- Run the stage that stopped again: the brief (no brief yet), the registration (the creator confirmed his profile), the motions (a look is
-- chosen) or the looks. Its three leases start over; the job stays with its host.
create function public.af_admin_generation_retry(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_jobs; next text;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  select * into j from public.af_generation_jobs where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  if j.status <> 'needs_review' then raise exception 'review-conflict'; end if;
  next := case when j.brief is null then 'queued' when j.profile is not null then 'submitting' when j.choice is not null then 'motions' else 'appearance' end;
  update public.af_generation_jobs set status = next, error_code = null, stage_leases = 0, lease_token = null, lease_expires_at = null,
    waiting_since = null, updated_at = now() where id = p_id returning * into j;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'operator', jsonb_build_object('action', 'retry', 'to', next, 'actor', p_actor));
  return jsonb_build_object('id', j.id, 'status', j.status);
end $$;

-- Cancel a request that is not over (the creator sees it cancelled; his free fighter is free again).
create function public.af_admin_generation_cancel(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_jobs;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  update public.af_generation_jobs set status = 'cancelled', waiting_since = null, lease_token = null, lease_expires_at = null, updated_at = now()
    where id = p_id and status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired') returning * into j;
  if not found then raise exception 'review-conflict'; end if;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'operator', jsonb_build_object('action', 'cancel', 'actor', p_actor));
  return jsonb_build_object('id', j.id, 'status', j.status);
end $$;

revoke all on function public.af_admin_generation_hosts(uuid), public.af_admin_generation_host_approval(uuid, uuid, boolean),
  public.af_admin_generations(uuid, text), public.af_admin_generation_retry(uuid, uuid), public.af_admin_generation_cancel(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.af_admin_generation_hosts(uuid), public.af_admin_generation_host_approval(uuid, uuid, boolean),
  public.af_admin_generations(uuid, text), public.af_admin_generation_retry(uuid, uuid), public.af_admin_generation_cancel(uuid, uuid)
  to service_role;
