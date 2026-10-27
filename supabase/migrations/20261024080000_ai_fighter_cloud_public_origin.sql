-- Both HTTPS addresses are entry points to this single resource server. Retain
-- the original audience during the public-directory cutover for existing users.
create or replace function public.af_mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare c jsonb := event->'claims';
begin
  if nullif(c->>'client_id', '') is not null then
    c := c || jsonb_build_object(
      'aud', jsonb_build_array('https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp','https://ai-fighter-validator.onrender.com/mcp'),
      'role', 'af_mcp', 'af_mcp', 'registration-v1');
  elsif event->>'authentication_method' = 'oauth_provider/authorization_code' then
    raise exception 'OAuth client identity required';
  end if;
  return jsonb_build_object('claims', c);
end;
$$;
