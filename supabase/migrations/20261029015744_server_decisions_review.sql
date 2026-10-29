-- Server-only advisory screening. No credentials, prompts or picture bytes in this ledger.
create table public.af_decision_review_limits (
  singleton boolean primary key default true check (singleton),
  daily_calls integer not null default 50 check (daily_calls between 0 and 1000),
  job_calls integer not null default 20 check (job_calls between 0 and 100)
);
insert into public.af_decision_review_limits(singleton) values (true);
create table public.af_decision_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.af_generation_jobs(id) on delete cascade,
  host_id uuid not null references public.af_generation_hosts(id),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  stage text not null check (stage in ('input','pose','sequence')),
  scope text not null check (scope in ('design','look-a','look-b','walk','run')),
  created_at timestamptz not null default now(),
  report jsonb not null,
  unique(job_id, fingerprint)
);
create index af_decision_reviews_created on public.af_decision_reviews(created_at);
alter table public.af_decision_review_limits enable row level security;
alter table public.af_decision_reviews enable row level security;
revoke all on public.af_decision_reviews, public.af_decision_review_limits from public, anon, authenticated;
grant select, insert, update, delete on public.af_decision_reviews, public.af_decision_review_limits to service_role;

create function public.af_decision_review_start(p_job uuid, p_host uuid, p_lease uuid, p_fingerprint text,
  p_stage text, p_scope text, p_binding jsonb) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_jobs; h uuid := coalesce(p_host, public.af_generation_official());
  limits public.af_decision_review_limits; r public.af_decision_reviews;
begin
  -- Serialize reservation and quota checks across Edge instances. Never reclaim a started request.
  select * into limits from public.af_decision_review_limits where singleton for update;
  if not found then raise exception 'review-limit'; end if;
  j := public.af_generation_held(p_job, p_lease);
  if j.lease_expires_at is null or j.lease_expires_at <= now() then raise exception 'lease-lost'; end if;
  if j.assigned_host is distinct from h then raise exception 'worker-required'; end if;
  if not exists(select 1 from public.af_generation_hosts where id = h and enabled and removed_at is null) then raise exception 'worker-required'; end if;
  if not ((p_stage in ('input','pose') and j.status = 'appearance') or (p_stage = 'sequence' and j.status = 'motions')) then raise exception 'generation-state'; end if;
  select * into r from public.af_decision_reviews where job_id = p_job and fingerprint = p_fingerprint;
  if found then return jsonb_build_object('started',false,'report',r.report); end if;
  if (select count(*) from public.af_decision_reviews where created_at >= now() - interval '1 day') >= limits.daily_calls
    or (select count(*) from public.af_decision_reviews where job_id = p_job) >= limits.job_calls then raise exception 'review-limit'; end if;
  insert into public.af_decision_reviews(job_id,host_id,fingerprint,stage,scope,report)
    values(p_job,h,p_fingerprint,p_stage,p_scope,jsonb_build_object('status','request_started','mode','shadow','advisory',true,
      'visualApproval',false,'stage',p_stage,'scope',p_scope,'binding',p_binding,'checks','{}'::jsonb,'performanceClaim','unmeasured')) returning * into r;
  return jsonb_build_object('started',true,'id',r.id,'report',r.report);
end $$;

create function public.af_decision_review_finish(p_id uuid, p_report jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.af_decision_reviews;
begin
  select * into r from public.af_decision_reviews where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  if r.report->>'status' <> 'request_started' then return r.report; end if;
  if coalesce(p_report->>'status','') not in ('completed','unverified') or p_report->'binding' is distinct from r.report->'binding'
    or p_report->'advisory' is distinct from 'true'::jsonb or p_report->'visualApproval' is distinct from 'false'::jsonb
    or octet_length(p_report::text) > 32000 then raise exception 'invalid-review-report'; end if;
  update public.af_decision_reviews set report = p_report where id = p_id;
  return p_report;
end $$;
revoke all on function public.af_decision_review_start(uuid,uuid,uuid,text,text,text,jsonb),
  public.af_decision_review_finish(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.af_decision_review_start(uuid,uuid,uuid,text,text,text,jsonb),
  public.af_decision_review_finish(uuid,jsonb) to service_role;
