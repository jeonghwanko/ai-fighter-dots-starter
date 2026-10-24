-- OAuth connector tokens must not inherit the user's normal database/API privileges.
-- af_mcp is deliberately NOT a database role: PostgREST/Storage cannot SET ROLE to it.
create function public.af_mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare c jsonb := event->'claims';
begin
  if nullif(c->>'client_id', '') is not null then
    c := c || jsonb_build_object(
      'aud', 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp',
      'role', 'af_mcp', 'af_mcp', 'registration-v1');
  elsif event->>'authentication_method' = 'oauth_provider/authorization_code' then
    raise exception 'OAuth client identity required';
  end if;
  return jsonb_build_object('claims', c);
end;
$$;
revoke all on function public.af_mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.af_mcp_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- The Edge service alone can check revocation; neither user tokens nor the connector can invoke this RPC.
create function public.af_mcp_session_active(p_owner uuid, p_session uuid, p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    join auth.oauth_clients c on c.id = s.oauth_client_id
    join auth.oauth_consents g on g.user_id = s.user_id and g.client_id = c.id
    where s.id = p_session and s.user_id = p_owner and s.oauth_client_id = p_client
      and (s.not_after is null or s.not_after > now())
      and c.deleted_at is null and g.revoked_at is null
      and string_to_array(s.scopes, ' ') @> array['openid','email','profile']
      and string_to_array(g.scopes, ' ') @> array['openid','email','profile']
  );
$$;
revoke all on function public.af_mcp_session_active(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.af_mcp_session_active(uuid,uuid,uuid) to service_role;
