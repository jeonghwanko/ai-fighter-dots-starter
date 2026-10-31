-- 만료된 연결 토큰 (2026-10-31): Cursor's Grok Bot signed in once and never refreshed, so every call after the first hour failed. The cloud
-- MCP now takes an expired connector token for up to seven days (EXPIRED_TOKEN_GRACE_MS in mcp/cloud.mjs) only while this says 'usable':
--   * the connection is live (af_mcp_session_active) and its user is neither banned nor deleted;
--   * the OAuth client is Cursor's web agents/Grok Bot, every redirect URI one of its callbacks (web/cloud-connect/connect.mjs). Other
--     clients ('strict') keep the plain expiry: the MCP SDKs refresh only on a 401, so a grace for them would only lengthen their tokens;
--   * the session was not refreshed after the token was issued ('refreshed'): a newer token exists, so this one stays refused. Auth sets
--     sessions.refreshed_at (timestamp without time zone, in UTC) on every refresh just after it signs the new token, within a second.
-- Supabase Auth itself still refuses every expired token, so the grace reaches nothing beyond the MCP.

create function public.af_mcp_expired_token_state(p_owner uuid, p_session uuid, p_client uuid, p_issued_at bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not public.af_mcp_session_active(p_owner, p_session, p_client)
      or exists (select 1 from auth.users u where u.id = p_owner and (u.deleted_at is not null or u.banned_until > now())) then 'ended'
    when not coalesce((select bool_and(btrim(uri) in ('https://www.cursor.com/agents/mcp/oauth/callback', 'https://www.cursor.com/bot/mcp/oauth/callback'))
      from auth.oauth_clients c cross join unnest(string_to_array(c.redirect_uris, ',')) uri where c.id = p_client), false) then 'strict'
    when exists (select 1 from auth.sessions s where s.id = p_session and extract(epoch from s.refreshed_at) >= p_issued_at + 5) then 'refreshed'
    else 'usable' end;
$$;
revoke all on function public.af_mcp_expired_token_state(uuid,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.af_mcp_expired_token_state(uuid,uuid,uuid,bigint) to service_role;
