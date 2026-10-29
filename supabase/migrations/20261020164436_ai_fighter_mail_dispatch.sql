create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists af_private;
revoke all on schema af_private from public,anon,authenticated;
-- Reuse the existing worker wake secret, with a distinct HMAC audience.
-- Only short-lived signatures enter pg_net's request queue.
create or replace function af_private.wake_review_mail() returns bigint
language plpgsql security definer set search_path='' as $$
declare endpoint text; token text; stamp text;
begin
  if not exists(select 1 from public.af_review_emails where status in ('pending','failed','sending')
    and next_attempt_at<=now() and (lease_until is null or lease_until<now())) then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='ai_fighter_mail_url';
  select decrypted_secret into token from vault.decrypted_secrets where name='ai_fighter_wake_token';
  if endpoint is null or endpoint !~ '^https://[a-z0-9]{20}[.]supabase[.]co/functions/v1/ai-fighter/internal/review-emails$'
    or token is null or token !~ '^[a-f0-9]{64}$' then return null; end if;
  stamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  return net.http_post(url:=endpoint,body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','X-AI-Fighter-Time',stamp,
      'X-AI-Fighter-Signature',encode(extensions.hmac('af-review-email:'||stamp,token,'sha256'),'hex')),timeout_milliseconds:=90000);
end $$;
revoke all on function af_private.wake_review_mail() from public,anon,authenticated;

create function af_private.mail_wake_valid(p_time bigint,p_signature text) returns boolean
language plpgsql security definer set search_path='' as $$
declare token text;
begin
  if p_time is null or p_signature is null or p_signature !~ '^[a-f0-9]{64}$'
    or abs(extract(epoch from clock_timestamp())-p_time)>120 then return false; end if;
  select decrypted_secret into token from vault.decrypted_secrets where name='ai_fighter_wake_token';
  if token is null then return false; end if;
  return p_signature=encode(extensions.hmac('af-review-email:'||p_time::text,token,'sha256'),'hex');
end $$;
revoke all on function af_private.mail_wake_valid(bigint,text) from public,anon,authenticated;
grant usage on schema af_private to service_role;
grant execute on function af_private.mail_wake_valid(bigint,text) to service_role;
-- The exposed wrapper has no elevated privileges. Only the signed worker path can use it.
create function public.af_mail_verify_wake(p_time bigint,p_signature text) returns boolean
language sql security invoker set search_path='' as $$
  select af_private.mail_wake_valid(p_time,p_signature);
$$;
revoke all on function public.af_mail_verify_wake(bigint,text) from public,anon,authenticated;
grant execute on function public.af_mail_verify_wake(bigint,text) to service_role;
select cron.schedule('ai-fighter-review-emails','*/5 * * * *','select af_private.wake_review_mail();');
