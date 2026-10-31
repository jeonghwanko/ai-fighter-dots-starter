-- 정면 먼저 (2026-10-31 사용자: "생성할 때 2차를 먼저 진행해서 유저에게 보여주고, 스프라이트 애니메이션을 생성하는 방식으로"): a hosted
-- job's looks are front paintings now; the one the creator chose is his profile set's front. The worker keeps it on the job, with the face
-- square it measured, before it submits the package (`generation-worker/jobs/:id/profile-front`); when the validator registers the package
-- the API makes them his set (api/generations.mjs attachJobProfileSet) and links it here. Only the API (service role) writes either column.
-- Plan: crashbang-heroes docs/Plan/2026-10-31-oddbout-profile-set/README.md.
alter table public.af_generation_jobs
  add column profile_front jsonb check (profile_front is null or jsonb_typeof(profile_front) = 'object'),
  add column profile_set_id uuid references public.af_profile_sets(id);
