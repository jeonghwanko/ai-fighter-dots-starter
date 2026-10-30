-- As 20261021092000, and a queued profile set wakes the validator too (20261031100000): the same Render worker validates both queues.
-- Hosted pg_net/Vault: like the other dispatch migrations, the test database (PGlite) skips this file.
create or replace function af_private.wake_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare endpoint text; token text; timestamp_text text; signature text;
begin
  if not exists (
    select 1 from public.af_submissions
    where status = 'queued' or (status = 'validating' and lease_until < now())
  ) and not exists (
    select 1 from public.af_profile_sets
    where status = 'queued' or (status = 'validating' and lease_until < now())
  ) then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'ai_fighter_worker_url';
  select decrypted_secret into token from vault.decrypted_secrets where name = 'ai_fighter_wake_token';
  if endpoint is null or endpoint !~ '^https://[a-z0-9-]+[.]onrender[.]com/wake$'
    or token is null or token !~ '^[a-f0-9]{64}$' then return null; end if;
  timestamp_text := floor(extract(epoch from clock_timestamp()))::bigint::text;
  signature := encode(extensions.hmac(timestamp_text, token, 'sha256'), 'hex');
  return net.http_post(
    url := endpoint, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-AI-Fighter-Time', timestamp_text, 'Authorization', 'Bearer ' || signature),
    timeout_milliseconds := 90000
  );
end $$;
revoke all on function af_private.wake_worker() from public, anon, authenticated;

-- The submission trigger's function wakes the worker and never fails the update; a set reaching `queued` calls it the same way.
create trigger af_profile_set_wake
after update of status on public.af_profile_sets
for each row when (new.status = 'queued' and old.status is distinct from new.status)
execute function af_private.on_submission_queued();
