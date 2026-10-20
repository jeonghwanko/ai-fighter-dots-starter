-- Invoker RPCs run as service_role. Auth is private by default: grant only
-- the two columns needed for the administrator listing, never password data.
grant select (id,email) on auth.users to service_role;
