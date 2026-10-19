-- Separate admission for a package used on either side of the symmetric AI duel.
alter table public.af_fighters add column duel_approved boolean not null default false;
alter table public.af_fighters add column duel_manifest_sha text;
alter table public.af_fighters add constraint af_fighters_duel_admission check (
  (not duel_approved and duel_manifest_sha is null)
  or (duel_approved and runtime_approved and review_state='approved'
    and duel_manifest_sha is not null and duel_manifest_sha=manifest_sha
    and review_evidence is not null and review_evidence ? 'duelValidation')
);
-- Existing owner RLS and service_role-only writes apply to these columns too.
