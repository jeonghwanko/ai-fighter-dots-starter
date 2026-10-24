create table public.af_analytics_context (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 client_id text not null check (client_id ~ '^\d{1,20}\.\d{1,20}$'),
 session_id text not null check (session_id ~ '^\d{1,20}$'),
 updated_at timestamptz not null default now()
);
create table public.af_analytics_outbox (
 submission_id uuid primary key references public.af_submissions(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 client_id text not null,
 session_id text,
 status text not null default 'pending' check (status in ('pending','sending','sent','failed','unknown','cancelled')),
 created_at timestamptz not null default now()
);
alter table public.af_analytics_context enable row level security;
alter table public.af_analytics_outbox enable row level security;
revoke all on public.af_analytics_context,public.af_analytics_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.af_analytics_context,public.af_analytics_outbox to service_role;
create index af_analytics_context_age on public.af_analytics_context(updated_at);
create index af_analytics_outbox_age on public.af_analytics_outbox(created_at);
create function public.af_queue_registration_analytics() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.af_analytics_outbox(submission_id,owner_id,client_id,session_id)
 select new.submission_id,new.owner_id,c.client_id,
   case when c.updated_at > now()-interval '24 hours' then c.session_id else null end
 from public.af_analytics_context c
 where c.owner_id=new.owner_id and c.updated_at > now()-interval '30 days'
 on conflict (submission_id) do nothing;
 return new;
end $$;
revoke all on function public.af_queue_registration_analytics() from public,anon,authenticated;
grant execute on function public.af_queue_registration_analytics() to service_role;
create trigger af_queue_registration_analytics after insert on public.af_fighters
 for each row execute function public.af_queue_registration_analytics();
-- Purge at 29 days hourly, so this remains below the approved maximum of 30 days.
select cron.schedule('af-analytics-retention','17 * * * *',
 $$delete from public.af_analytics_context where updated_at < now()-interval '29 days';
   delete from public.af_analytics_outbox where created_at < now()-interval '29 days';$$);
