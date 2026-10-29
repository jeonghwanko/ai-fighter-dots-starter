-- Infrastructure failures (download, deadline, validator process) say nothing about the creator's package.
-- Before this, the worker left the lease to expire and af_claim counted the attempt: three storage or
-- cold-start incidents rejected a real submission as worker-attempt-limit and used one of the owner's
-- five submissions. Now the worker hands the job back under its own lease: the attempt is refunded and
-- counted separately, so the queue retries at once. The separate limit still stops a package that
-- crashes the validator every time; a dead worker still falls back to lease expiry and attempts.
alter table public.af_submissions add column infra_failures integer not null default 0 check (infra_failures >= 0);

create function public.af_release(p_id uuid, p_lease uuid, p_code text)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions;
begin
  if p_code is null or p_code !~ '^[a-z0-9-]{1,64}$' then raise exception 'invalid-release-code'; end if;
  select * into s from public.af_submissions where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  -- Only the current holder of a live lease may hand it back; a finished or reclaimed job is left alone.
  if s.status <> 'validating' or s.lease_token is distinct from p_lease then raise exception 'stale-validation'; end if;
  if s.infra_failures + 1 >= 10 then
    update public.af_submissions set status = 'rejected', lease_token = null, lease_until = null, infra_failures = infra_failures + 1,
      validation = jsonb_build_object('code', 'worker-infrastructure-limit', 'lastFailure', p_code)
      where id = s.id returning * into s;
  else
    update public.af_submissions set status = 'queued', lease_token = null, lease_until = null,
      attempts = greatest(attempts - 1, 0), infra_failures = infra_failures + 1
      where id = s.id returning * into s;
  end if;
  return s;
end $$;

revoke all on function public.af_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.af_release(uuid, uuid, text) to service_role;
