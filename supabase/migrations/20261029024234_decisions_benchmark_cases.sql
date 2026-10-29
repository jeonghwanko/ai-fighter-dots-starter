-- Operator-enrolled, expiring evidence only. A benchmark never creates or reopens a generation job.
create table public.af_decision_benchmark_cases (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.af_generation_hosts(id),
  label text not null check (length(label) between 1 and 120),
  intent jsonb not null check (jsonb_typeof(intent) = 'object' and octet_length(intent::text) <= 8000),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 10000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at and expires_at <= created_at + interval '1 day')
);
alter table public.af_decision_benchmark_cases enable row level security;
revoke all on public.af_decision_benchmark_cases from public, anon, authenticated;
grant select, insert, update, delete on public.af_decision_benchmark_cases to service_role;
alter table public.af_decision_reviews alter column job_id drop not null;
alter table public.af_decision_reviews add column benchmark_id uuid unique references public.af_decision_benchmark_cases(id);
alter table public.af_decision_reviews add constraint af_decision_review_source check ((job_id is null) <> (benchmark_id is null));

create function public.af_decision_benchmark_start(p_case uuid, p_host uuid, p_fingerprint text,
  p_stage text, p_scope text, p_binding jsonb) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.af_decision_benchmark_cases; h uuid := coalesce(p_host, public.af_generation_official());
  limits public.af_decision_review_limits; r public.af_decision_reviews;
begin
  -- Same lock and ledger as normal reviews: benchmark calls consume the global rolling quota too.
  select * into limits from public.af_decision_review_limits where singleton for update;
  if not found then raise exception 'review-limit'; end if;
  select * into c from public.af_decision_benchmark_cases where id = p_case for share;
  if not found or c.host_id is distinct from h then raise exception 'worker-required'; end if;
  if c.expires_at <= now() then raise exception 'benchmark-expired'; end if;
  if not exists(select 1 from public.af_generation_hosts where id = h and enabled and removed_at is null) then raise exception 'worker-required'; end if;
  if c.evidence is distinct from jsonb_build_object('stage',p_stage,'scope',p_scope,'images',p_binding->'images') then
    raise exception 'benchmark-evidence-changed'; end if;
  select * into r from public.af_decision_reviews where benchmark_id = p_case;
  if found then return jsonb_build_object('started',false,'report',r.report); end if;
  if (select count(*) from public.af_decision_reviews where created_at >= now() - interval '1 day') >= limits.daily_calls then raise exception 'review-limit'; end if;
  insert into public.af_decision_reviews(benchmark_id,host_id,fingerprint,stage,scope,report)
    values(p_case,h,p_fingerprint,p_stage,p_scope,jsonb_build_object('status','request_started','mode','shadow','advisory',true,
      'visualApproval',false,'stage',p_stage,'scope',p_scope,'binding',p_binding,'checks','{}'::jsonb,'performanceClaim','unmeasured')) returning * into r;
  return jsonb_build_object('started',true,'id',r.id,'report',r.report);
end $$;
revoke all on function public.af_decision_benchmark_start(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.af_decision_benchmark_start(uuid,uuid,text,text,text,jsonb) to service_role;
