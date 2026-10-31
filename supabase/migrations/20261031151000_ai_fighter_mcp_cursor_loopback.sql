-- Cursor's client, as it really registers (2026-10-31, production): redirect URIs
-- 'https://www.cursor.com/agents/mcp/oauth/callback,http://localhost:8787/callback'. 20261031150000 asked every redirect URI to be a
-- cursor.com callback, so the Grok Bot it was written for came out 'strict'. Now: at least one cursor.com MCP callback, and every
-- other one a plain http loopback address (as the consent page takes them). A client with any other https callback stays 'strict'.
-- Restated whole from 20261031150000 with only that rule changed.

create or replace function public.af_mcp_expired_token_state(p_owner uuid, p_session uuid, p_client uuid, p_issued_at bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not public.af_mcp_session_active(p_owner, p_session, p_client)
      or exists (select 1 from auth.users u where u.id = p_owner and (u.deleted_at is not null or u.banned_until > now())) then 'ended'
    when not coalesce((select bool_or(btrim(uri) in ('https://www.cursor.com/agents/mcp/oauth/callback', 'https://www.cursor.com/bot/mcp/oauth/callback'))
        and bool_and(btrim(uri) in ('https://www.cursor.com/agents/mcp/oauth/callback', 'https://www.cursor.com/bot/mcp/oauth/callback')
          or btrim(uri) ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?/')
      from auth.oauth_clients c cross join unnest(string_to_array(c.redirect_uris, ',')) uri where c.id = p_client), false) then 'strict'
    when exists (select 1 from auth.sessions s where s.id = p_session and extract(epoch from s.refreshed_at) >= p_issued_at + 5) then 'refreshed'
    else 'usable' end;
$$;
revoke all on function public.af_mcp_expired_token_state(uuid,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.af_mcp_expired_token_state(uuid,uuid,uuid,bigint) to service_role;
