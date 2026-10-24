-- Each account can register three fighters. Existing IDs, packages and records stay intact.
-- Slots plus a unique constraint enforce the bound even for concurrent or direct inserts.
alter table public.af_fighters add column account_slot smallint not null default 1
  constraint af_fighters_account_slot_check check (account_slot between 1 and 3);
alter table public.af_fighters alter column account_slot drop default;
alter table public.af_fighters drop constraint af_fighters_owner_id_key;
alter table public.af_fighters add constraint af_fighters_owner_slot_key unique(owner_id,account_slot);

create function public.af_allocate_fighter_slot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.af_creators where owner_id=new.owner_id for update;
  -- Preserve idempotent submission inserts, including when all slots are occupied.
  select account_slot into new.account_slot from public.af_fighters
    where submission_id=new.submission_id and owner_id=new.owner_id;
  if found then return new; end if;
  select candidate into new.account_slot from generate_series(1,3) candidate
    where not exists(select 1 from public.af_fighters f where f.owner_id=new.owner_id and f.account_slot=candidate)
    order by candidate limit 1;
  if new.account_slot is null then raise exception 'fighter-quota'; end if;
  return new;
end $$;
revoke all on function public.af_allocate_fighter_slot() from public,anon,authenticated;
grant execute on function public.af_allocate_fighter_slot() to service_role;
create trigger af_allocate_fighter_slot before insert on public.af_fighters
  for each row execute function public.af_allocate_fighter_slot();

-- Removed fighters still occupy a slot. Updating an owned fighter does not allocate a new slot.
-- Keep submission retries, one pending upload, validation, moderation and storage limits unchanged.
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
    if (select count(*) from public.af_fighters where owner_id=p_owner) >= 3 then raise exception 'fighter-quota'; end if;
  else
    select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner;
    if not found then raise exception 'fighter-not-found'; end if;
    if f.review_state='rejected' then raise exception 'fighter-removed'; end if;
    if f.manifest_sha=p_sha then raise exception 'fighter-unchanged'; end if;
  end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  if (select count(*) from public.af_submissions where owner_id=p_owner) >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::numeric) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Reservations count even expired/rejected records until an operator removes their objects and records together.
  if (select coalesce(sum(asset_bytes),0) from public.af_submissions)+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,replaces_fighter)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes,p_fighter) returning * into s;
  return s;
end $$;
revoke all on function public.af_create_submission(uuid,uuid,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.af_create_submission(uuid,uuid,text,text,bigint,uuid) to service_role;

