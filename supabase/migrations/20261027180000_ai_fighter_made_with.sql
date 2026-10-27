-- Made with (3단계 에이전트 도구, 2026-10-27): which agent made a fighter. The cloud MCP records the OAuth client of each submission it
-- prepares or edits (`af_record_submission_agent`); the roster shows the client of a fighter's first such submission (`af_fighter_agents`).
-- A client names itself at dynamic registration (auth.oauth_clients.client_name, e.g. "ChatGPT"): it is shown as given, at most 40 characters.
-- Submissions made without the cloud MCP (the creator page, the kit's device login) have none.
create table public.af_submission_agents (
  submission_id uuid primary key references public.af_submissions(id),
  client_id uuid not null,
  client_name text not null check (length(client_name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.af_submission_agents enable row level security;
revoke all on table public.af_submission_agents from public, anon, authenticated;
grant select, insert on table public.af_submission_agents to service_role;

-- The owner's own submission and a live client only; a second record of one submission is ignored.
create function public.af_record_submission_agent(p_owner uuid, p_submission uuid, p_client uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.af_submission_agents(submission_id, client_id, client_name)
  select s.id, c.id, left(btrim(c.client_name), 40) from public.af_submissions s join auth.oauth_clients c on c.id = p_client
  where s.id = p_submission and s.owner_id = p_owner and c.deleted_at is null and length(btrim(coalesce(c.client_name, ''))) > 0
  on conflict (submission_id) do nothing;
$$;
revoke execute on function public.af_record_submission_agent(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.af_record_submission_agent(uuid, uuid, uuid) to service_role;

-- A fighter's maker: the agent of his earliest recorded submission (a registration or an edit through the cloud MCP).
create view public.af_fighter_agents with (security_invoker = true) as
  select distinct on (s.fighter_id) s.fighter_id, a.client_name
  from public.af_submissions s join public.af_submission_agents a on a.submission_id = s.id
  where s.fighter_id is not null
  order by s.fighter_id, s.created_at, s.id;
revoke all on table public.af_fighter_agents from public, anon, authenticated;
grant select on table public.af_fighter_agents to service_role;
