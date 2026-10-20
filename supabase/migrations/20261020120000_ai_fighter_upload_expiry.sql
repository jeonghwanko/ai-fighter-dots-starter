-- Two submission fixes. Signatures, grants and the immutable-submission trigger are unchanged.
-- 1. An expired upload is closed. Before this, an abandoned upload kept status 'uploading':
--    every later submission failed with 'open-submission-exists' and af_submit failed with
--    'upload-expired', so only an operator could unblock the creator. The expired row now
--    becomes 'rejected' with the code 'upload-expired'. Its reservation still counts.
-- 2. The validator accepts JSON integers written as 4096.0. Casting that text to bigint failed
--    and the API returned 503. Byte sums now cast through numeric.
create or replace function public.af_create_submission(p_owner uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; settings public.af_settings; declared numeric;
begin
  select * into settings from public.af_settings where singleton for update;
  select * into s from public.af_submissions where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if s.manifest_sha<>p_sha or s.manifest_text<>p_text then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if settings.paused then raise exception 'submissions-paused'; end if;
  if not exists(select 1 from public.af_creators where owner_id=p_owner and enabled and expires_at>now()) then raise exception 'invite-required'; end if;
  if (select count(*) from public.af_creators where enabled and expires_at>now()) > 20 then raise exception 'beta-capacity'; end if;
  if exists(select 1 from public.af_fighters where owner_id=p_owner) then raise exception 'fighter-quota'; end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  if (select count(*) from public.af_submissions where owner_id=p_owner) >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::numeric) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Reservations count even expired/rejected records until an operator removes their objects and records together.
  if (select coalesce(sum(asset_bytes),0) from public.af_submissions)+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes) returning * into s;
  return s;
end $$;

create or replace function public.af_submit(p_owner uuid,p_id uuid) returns public.af_submissions
language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; a jsonb; key text;
begin
  select * into s from public.af_submissions where id=p_id and owner_id=p_owner for update;
  if not found then raise exception 'not-found'; end if;
  if s.status<>'uploading' then return s; end if;
  if s.expires_at<=now() then raise exception 'upload-expired'; end if;
  for a in select * from jsonb_array_elements(s.manifest->'assets') loop
    key := s.owner_id::text||'/'||s.id::text||'/'||(a->>'id')||'.webp';
    if not exists(select 1 from storage.objects o where o.bucket_id='ai-fighter-beta' and o.name=key and (o.metadata->>'size')::numeric=(a->>'bytes')::numeric)
      then raise exception 'assets-incomplete'; end if;
  end loop;
  update public.af_submissions set status='queued' where id=s.id returning * into s;
  return s;
end $$;
