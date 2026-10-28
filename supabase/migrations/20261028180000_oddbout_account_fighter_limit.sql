-- One per-account fighter limit for every entry point: a package submission, a hosted request, its registration and the slot itself.
-- Three stays the default. The operator raises one account with
--   update public.af_creators set fighter_limit = <n> where owner_id = '<account id>';
-- (null = the default). Every account has a creator row: af_authorize makes it on the account's first call.
alter table public.af_creators add column fighter_limit smallint
  constraint af_creators_fighter_limit_check check (fighter_limit between 1 and 20);

create function public.af_fighter_limit(p_owner uuid) returns integer
language sql stable security invoker set search_path = '' as $$
  select coalesce((select fighter_limit from public.af_creators where owner_id = p_owner), 3)::integer
$$;
revoke all on function public.af_fighter_limit(uuid) from public, anon, authenticated;
grant execute on function public.af_fighter_limit(uuid) to service_role;

-- The table keeps a fixed ceiling; the account's own bound is checked when a slot is taken or moved.
alter table public.af_fighters drop constraint af_fighters_account_slot_check;
alter table public.af_fighters add constraint af_fighters_account_slot_check check (account_slot between 1 and 20);

create or replace function public.af_allocate_fighter_slot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.af_creators where owner_id=new.owner_id for update;
  -- Preserve idempotent submission inserts, including when all slots are occupied.
  select account_slot into new.account_slot from public.af_fighters
    where submission_id=new.submission_id and owner_id=new.owner_id;
  if found then return new; end if;
  select candidate into new.account_slot from generate_series(1,public.af_fighter_limit(new.owner_id)) candidate
    where not exists(select 1 from public.af_fighters f where f.owner_id=new.owner_id and f.account_slot=candidate)
    order by candidate limit 1;
  if new.account_slot is null then raise exception 'fighter-quota'; end if;
  return new;
end $$;

create function public.af_guard_fighter_slot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.account_slot > public.af_fighter_limit(new.owner_id) then raise exception 'fighter-quota'; end if;
  return new;
end $$;
revoke all on function public.af_guard_fighter_slot() from public, anon, authenticated;
grant execute on function public.af_guard_fighter_slot() to service_role;
create trigger af_guard_fighter_slot before update of account_slot on public.af_fighters
  for each row execute function public.af_guard_fighter_slot();

-- The three count checks change only their bound. Rewriting the live definitions keeps everything else as deployed.
do $$
declare fn text; definition text;
  bound constant text := $p$(\(select count\(\*\) from public\.af_fighters where owner_id ?= ?p_owner and deleted_at is null\) >= )[0-9]+( then raise exception 'fighter-quota')$p$;
begin
  foreach fn in array array[
    'public.af_create_submission(uuid,uuid,text,text,bigint,uuid)',
    'public.af_generation_create(uuid,uuid,text,text,uuid[],boolean,boolean,text,uuid,boolean)',
    'public.af_generation_register(uuid,uuid,jsonb)'] loop
    definition := pg_get_functiondef(fn::regprocedure);
    if (select count(*) from regexp_matches(definition, bound, 'g')) <> 1 then raise exception 'review-fighter-quota-bound %', fn; end if;
    execute regexp_replace(definition, bound, '\1public.af_fighter_limit(p_owner)\2');
  end loop;
end $$;
