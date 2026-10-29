-- 호스팅 생성 (2026-10-27): the API's database role preloads safeupdate, which refuses an UPDATE without a WHERE clause. The worker's
-- heartbeat and stage progress touched the one settings row without one, so every heartbeat failed (database-unavailable) and hosted
-- generation could never come on. The same functions, naming the row.

create or replace function public.af_generation_heartbeat(p_health jsonb) returns jsonb language sql security invoker set search_path = '' as $$
  update public.af_generation_settings set worker_seen_at = now(), worker_health = coalesce(p_health, '{}'::jsonb) where singleton;
  select public.af_generation_capabilities();
$$;

create or replace function public.af_generation_progress(p_id uuid, p_token uuid, p_progress integer, p_event jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token);
begin
  update public.af_generation_jobs set lease_expires_at = now() + interval '5 minutes', progress = least(greatest(coalesce(p_progress, progress), 0), 100),
    updated_at = now() where id = p_id returning * into row;
  update public.af_generation_settings set worker_seen_at = now() where singleton;
  if p_event is not null then insert into public.af_generation_events(job_id, kind, data) values (p_id, left(coalesce(p_event->>'kind', 'progress'), 40), p_event); end if;
  return row;
end $$;
