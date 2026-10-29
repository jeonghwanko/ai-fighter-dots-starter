-- Single round-trip reads for the public API (2026-10-29). The Edge function runs near its caller (Seoul) and the database in
-- Singapore, so each query costs about 90 ms: GET rankings read the per-language names after the ranking, and the roster read a
-- page's makers after the page. The ranking now carries the names, and the roster reads one view that already joins the maker.

-- The return type gains a column, which `create or replace` cannot do; the drop and create run in this migration's transaction.
drop function public.af_duel_rankings();
create function public.af_duel_rankings()
returns table(id uuid, name text, won bigint, lost bigint, points bigint, rank bigint, names jsonb)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.name, s.won, s.lost, s.points, s.rank, f.profile->'names'
  from public.af_duel_statistics() s left join public.af_fighters f on f.id = s.id
  where s.rank is not null order by s.won desc, s.lost asc, s.name, s.id limit 20;
$$;
revoke all on function public.af_duel_rankings() from public, anon, authenticated;
grant execute on function public.af_duel_rankings() to service_role;

-- af_fighters with the agent that made each fighter (`af_fighter_agents`), for the roster's list and its per-fighter address.
create view public.af_roster_entries with (security_invoker = true) as
  select f.id, f.created_at, f.submission_id, f.manifest_sha, f.profile, f.runtime_approved, f.runtime_scope, f.runtime_manifest_sha,
    f.duel_approved, f.duel_manifest_sha, f.review_state, f.listed, a.client_name as made_with
  from public.af_fighters f left join public.af_fighter_agents a on a.fighter_id = f.id;
revoke all on table public.af_roster_entries from public, anon, authenticated;
grant select on table public.af_roster_entries to service_role;
