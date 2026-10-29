-- Hosted generation measurement export (docs/MEASUREMENT.md). Read-only: one JSON document for scripts/measure-export.mjs.
-- Run it in the Supabase SQL editor (or psql as a role that reads these tables) and save the single cell as db.json.
-- It carries no requester text: no description, appearance or motion note, owner, brief, profile or picture.
-- Change the window in `w` as needed.
with w as (select now() - interval '30 days' as since),
picked as (select j.* from public.af_generation_jobs j, w where j.created_at >= w.since)
select jsonb_build_object(
  'kind', 'oddbout-measure-db',
  'version', 1,
  'exportedAt', now(),
  'since', (select since from w),
  'jobs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', j.id, 'status', j.status, 'createdAt', j.created_at, 'updatedAt', j.updated_at, 'language', j.language,
      'choice', j.choice, 'appearanceRevisions', j.appearance_revisions, 'motionRevisions', j.motion_revisions,
      'errorCode', j.error_code, 'previewClips', (select coalesce(jsonb_agg(p->>'clip'), '[]'::jsonb) from jsonb_array_elements(j.preview) p))
    order by j.created_at) from picked j), '[]'::jsonb),
  -- Only the kinds the export reads; motion-answer data is the clip name only, appearance-answer the choice and whether it was a revision.
  'events', coalesce((select jsonb_agg(jsonb_build_object('jobId', e.job_id, 'id', e.id, 'at', e.at, 'kind', e.kind, 'data', e.data) order by e.id)
    from public.af_generation_events e join picked j on j.id = e.job_id
    where e.kind in ('created', 'claimed', 'finished', 'appearance-answer', 'motion-answer', 'register', 'cancelled', 'operator', 'versions')), '[]'::jsonb),
  'reviews', coalesce((select jsonb_agg(jsonb_build_object('jobId', r.job_id, 'stage', r.stage, 'scope', r.scope, 'createdAt', r.created_at,
      'status', r.report->'status', 'errorCode', r.report->'errorCode', 'usage', r.report->'usage', 'elapsedSeconds', r.report->'elapsedSeconds',
      'checks', (select coalesce(jsonb_object_agg(c.key, c.value->'status'), '{}'::jsonb) from jsonb_each(coalesce(r.report->'checks', '{}'::jsonb)) c))
    order by r.created_at) from public.af_decision_reviews r join picked j on j.id = r.job_id), '[]'::jsonb)
) as export;
