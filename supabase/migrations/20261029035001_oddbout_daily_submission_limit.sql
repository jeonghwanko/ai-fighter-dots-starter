-- af_create_submission counted every new-fighter submission the account ever made, rejected and deleted ones included,
-- and refused the sixth for good ('submission-quota'), whatever af_fighter_limit allowed. The bound now counts the last 24 hours:
-- it still spaces out validation work, and an account below its fighter limit can always try again the next day.
-- The function is restated whole from 20261028181000 with only that check changed.
create or replace function public.af_create_submission(p_owner uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint,p_fighter uuid default null)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; settings public.af_settings; declared numeric; f public.af_fighters;
begin
  perform public.af_authorize(p_owner);
  select * into settings from public.af_settings where singleton for update;
  select * into s from public.af_submissions where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if s.manifest_sha<>p_sha or s.manifest_text<>p_text or s.replaces_fighter is distinct from p_fighter then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if settings.paused then raise exception 'submissions-paused'; end if;
  if p_fighter is null then
    if (select count(*) from public.af_fighters where owner_id=p_owner and deleted_at is null) >= public.af_fighter_limit(p_owner) then raise exception 'fighter-quota'; end if;
  else
    select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner;
    if not found then raise exception 'fighter-not-found'; end if;
    if f.review_state='rejected' then raise exception 'fighter-removed'; end if;
    if f.manifest_sha=p_sha then raise exception 'fighter-unchanged'; end if;
  end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  -- New-fighter submissions are bounded per day, not for the account's life: rejected and deleted attempts used to count forever,
  -- so five of them locked an account out of new fighters even below its fighter limit (2026-10-29).
  if p_fighter is null and (select count(*) from public.af_submissions where owner_id=p_owner and replaces_fighter is null
      and created_at > now() - interval '1 day') >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::numeric) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Reservations count even expired/rejected records until an operator removes their objects and records together.
  if (select coalesce(sum(asset_bytes),0) from public.af_submissions where asset_source_submission is null)+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,replaces_fighter)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes,p_fighter) returning * into s;
  return s;
end $$;
