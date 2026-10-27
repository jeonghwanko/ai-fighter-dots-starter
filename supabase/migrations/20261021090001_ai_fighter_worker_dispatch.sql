-- Render Free sleeps when idle. Only unfinished submissions cause an outbound wake.
-- Configure ai_fighter_worker_url and ai_fighter_wake_token in Vault after deployment.
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists af_private;
revoke all on schema af_private from public, anon, authenticated;

create function af_private.wake_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare endpoint text; token text;
begin
  if not exists (
    select 1 from public.af_submissions
    where status = 'queued' or (status = 'validating' and lease_until < now())
  ) then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'ai_fighter_worker_url';
  select decrypted_secret into token from vault.decrypted_secrets where name = 'ai_fighter_wake_token';
  -- Fail closed until an operator configures a deployment. No user-controlled URLs.
  if endpoint is null or endpoint !~ '^https://[a-z0-9-]+[.]onrender[.]com/wake$'
    or token is null or token !~ '^[a-f0-9]{64}$' then return null; end if;
  return net.http_post(
    url := endpoint, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || token),
    timeout_milliseconds := 90000
  );
end $$;
revoke all on function af_private.wake_worker() from public, anon, authenticated;

create function af_private.on_submission_queued() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform af_private.wake_worker();
  return new;
exception when others then
  -- Dispatch failure must not roll back a valid submission. Cron retries the durable queue.
  raise warning 'AI Fighter worker wake deferred';
  return new;
end $$;
revoke all on function af_private.on_submission_queued() from public, anon, authenticated;

create trigger af_submission_wake
after update of status on public.af_submissions
for each row when (new.status = 'queued' and old.status is distinct from new.status)
execute function af_private.on_submission_queued();

-- No keep-alive requests: when the queue is idle this only performs an indexed database check.
select cron.schedule('ai-fighter-pending-worker', '* * * * *', 'select af_private.wake_worker();');
