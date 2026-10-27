-- Per-caller brakes for the unauthenticated routes (guest duels, device-login start, 2026-10-28).
-- Their only limits were shared by everyone (100 duels a day, 120 login starts per 10 minutes), so one
-- script could spend them for all users. The Edge handler sends a keyed hash of the caller's network
-- address: HMAC-SHA256 with a server secret over bucket, UTC day and address. The address itself is never
-- stored, the day in the input keeps one day's keys unlinkable to the next, and rows older than a day are
-- deleted on every call. The global brakes stay as they were.
create table public.af_rate_hits (
  bucket text not null check (bucket ~ '^[a-z][a-z0-9-]{0,31}$'),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  primary key (bucket, key_hash, window_start)
);
create index af_rate_hits_window on public.af_rate_hits(window_start);
alter table public.af_rate_hits enable row level security;
revoke all on public.af_rate_hits from public, anon, authenticated;

-- Counts one hit and says whether the caller is still within p_limit for the current window.
create function public.af_rate_hit(p_bucket text, p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare started timestamptz; total integer;
begin
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9-]{0,31}$' or p_key is null or p_key !~ '^[a-f0-9]{64}$'
    or p_limit is null or p_limit not between 1 and 10000 or p_window_seconds is null or p_window_seconds not between 60 and 86400
    then raise exception 'invalid-rate-limit'; end if;
  delete from public.af_rate_hits where window_start < now() - interval '1 day';
  started := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.af_rate_hits(bucket, key_hash, window_start) values (p_bucket, p_key, started)
    on conflict (bucket, key_hash, window_start) do update set hits = public.af_rate_hits.hits + 1
    returning hits into total;
  return total <= p_limit;
end $$;
revoke all on function public.af_rate_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.af_rate_hit(text, text, integer, integer) to service_role;
