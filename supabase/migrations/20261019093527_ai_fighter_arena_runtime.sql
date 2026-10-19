-- Runtime admission is a separate operator decision, bound to the exact validated manifest.
-- This scope permits a controllable arena skin under the existing common player rules; no AI/ranked rules are added.
alter table public.af_fighters drop constraint af_fighters_review_state_check;
alter table public.af_fighters drop constraint af_fighters_runtime_approved_check;
alter table public.af_fighters add column runtime_scope text;
alter table public.af_fighters add column runtime_manifest_sha text;
alter table public.af_fighters add column review_evidence jsonb;
alter table public.af_fighters add constraint af_fighters_review_state_check check (review_state in ('pending','approved','rejected'));
alter table public.af_fighters add constraint af_fighters_runtime_admission check (
  (not runtime_approved and runtime_scope is null and runtime_manifest_sha is null)
  or (runtime_approved and review_state='approved' and runtime_scope='arena-player-v1'
    and runtime_manifest_sha=manifest_sha and runtime_manifest_sha is not null
    and jsonb_typeof(review_evidence)='object' and review_evidence ? 'authorization'
    and review_evidence ? 'validation' and review_evidence is not null)
);
-- Existing RLS and grants remain: only service_role/operator may update approval. No public table policy is added.
