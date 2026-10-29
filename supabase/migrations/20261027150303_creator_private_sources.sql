-- Originals are private, immutable and owned by the authenticated connector account.
create table public.af_creator_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes integer not null check (bytes between 33 and 16777216),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  status text not null default 'pending' check (status in ('pending','ready')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique(owner_id, idempotency_key),
  check (width::bigint * height <= 33554432)
);
alter table public.af_creator_sources enable row level security;
revoke all on public.af_creator_sources from public, anon, authenticated;
grant select, insert, update, delete on public.af_creator_sources to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('af-creator-sources', 'af-creator-sources', false, 16777216, array['image/png']);
-- No direct client Storage policy. Owner checks precede every short-lived signed grant.

create function public.af_reserve_creator_source(p_owner uuid, p_key uuid, p_sha text, p_bytes integer,
  p_width integer, p_height integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item public.af_creator_sources; used bigint; items bigint;
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 831));
  select * into item from public.af_creator_sources where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if item.sha256 <> p_sha or item.bytes <> p_bytes or item.width <> p_width or item.height <> p_height then
      raise exception 'source-idempotency-conflict';
    end if;
    return to_jsonb(item);
  end if;
  select coalesce(sum(bytes),0), count(*) into used, items from public.af_creator_sources where owner_id=p_owner;
  if used + p_bytes > 134217728 or items >= 64 then raise exception 'source-quota'; end if;
  insert into public.af_creator_sources(owner_id,idempotency_key,sha256,bytes,width,height)
    values(p_owner,p_key,p_sha,p_bytes,p_width,p_height) returning * into item;
  return to_jsonb(item);
end $$;
revoke all on function public.af_reserve_creator_source(uuid,uuid,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.af_reserve_creator_source(uuid,uuid,text,integer,integer,integer) to service_role;
