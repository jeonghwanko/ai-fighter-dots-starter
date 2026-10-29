-- pg_net's request queue temporarily contains the wake Authorization header.
-- Requests are sent by its privileged worker, never read directly by API clients.
-- Hosted Supabase retains its owner grants despite these best-effort revokes.
-- The following signed_dispatch migration removes the durable key from requests.
revoke all on table net.http_request_queue from public, anon, authenticated;
revoke all on table net._http_response from public, anon, authenticated;
