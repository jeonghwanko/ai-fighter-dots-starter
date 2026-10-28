-- 내 에이전트 (2026-10-28): the agents a creator keeps on his My agents page (Codex, Grok, Claude; Gemini later). Design: game repo
-- docs/kaito-web/ai-fighter-creator.md "내 에이전트". 사용자 결정: 등록 puts a card on the page; 해제 ends the agent's OAuth connection
-- (`auth.oauth.revokeGrant`) and the card stays; 삭제 takes the card away too. A connection is a Supabase Auth OAuth grant and is read there;
-- this table keeps only which cards he registered, so a disconnected agent stays on his page. The site writes it with his own session.
create table public.af_account_agents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('codex', 'grok', 'claude', 'gemini')),
  created_at timestamptz not null default now(),
  primary key (owner_id, agent)
);
alter table public.af_account_agents enable row level security;
revoke all on table public.af_account_agents from public, anon, authenticated;
grant select, insert(owner_id, agent), delete on table public.af_account_agents to authenticated;
grant select on table public.af_account_agents to service_role;
create policy af_account_agents_read_own on public.af_account_agents for select to authenticated using ((select auth.uid()) = owner_id);
create policy af_account_agents_add_own on public.af_account_agents for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy af_account_agents_remove_own on public.af_account_agents for delete to authenticated using ((select auth.uid()) = owner_id);
