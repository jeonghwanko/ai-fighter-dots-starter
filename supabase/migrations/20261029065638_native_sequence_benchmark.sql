-- Research evidence only. Production frame counts and review quotas do not change.
alter table public.af_decision_benchmark_cases drop constraint af_decision_benchmark_cases_evidence_check;
alter table public.af_decision_benchmark_cases add constraint af_decision_benchmark_cases_evidence_check
  check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16000);
