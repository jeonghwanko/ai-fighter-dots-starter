-- 맡기기 (2026-10-28): a creator who leaves the look to ODDBOUT ("알아서 해 줘") answers once, at the end. The worker paints the two looks, a
-- vision check picks one, and the job goes on to the motions without waiting for him; when the check picks none, he is asked as before.
-- He still checks the motions and registers. The request takes `delegate`; a stage's end takes the worker's pick only for such a job.
-- Design: game repo docs/Plan/2026-10-26-hosted-fighter-generation (맡기기).

alter table public.af_generation_jobs add column delegate boolean not null default false;

-- One more argument (with a default, so the API before this release still calls it): the old signature goes, or a call with six named
-- arguments would match both.
drop function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean);
create function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean,
  p_delegate boolean default false)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; caps jsonb; refs uuid[] := coalesce(p_refs, '{}');
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  select * into row from public.af_generation_jobs where owner_id = p_owner and idempotency_key = p_key;
  if found then return row; end if;
  caps := public.af_generation_capabilities();
  if not (caps->>'hosted')::boolean then raise exception 'generation-unavailable'; end if;
  if exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and not public.af_generation_freed(j))
    then raise exception 'generation-quota'; end if;
  if (select count(*) from public.af_generation_jobs where owner_id = p_owner and created_at > now() - interval '1 day') >= 3
    then raise exception 'rate-limit'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= 3 then raise exception 'fighter-quota'; end if;
  perform pg_advisory_xact_lock(74280503);
  if (select count(*) from public.af_generation_jobs where created_at > now() - interval '1 day' and public.af_generation_counted(status, brief))
      >= (caps->>'dailyLimit')::integer then raise exception 'generation-capacity'; end if;
  if cardinality(refs) > 2 or cardinality(refs) <> (select count(distinct x) from unnest(refs) x) then raise exception 'invalid-refs'; end if;
  if cardinality(refs) > 0 and not coalesce(p_rights, false) then raise exception 'rights-required'; end if;
  if (select count(*) from public.af_generation_uploads where id = any(refs) and owner_id = p_owner and job_id is null
      and created_at > now() - interval '1 day') <> cardinality(refs) then raise exception 'invalid-refs'; end if;
  insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, refs_rights, delegate)
    values (p_owner, p_key, btrim(p_description), p_language, cardinality(refs) > 0, coalesce(p_delegate, false)) returning * into row;
  update public.af_generation_uploads set job_id = row.id where id = any(refs);
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'created', jsonb_build_object('refs', cardinality(refs), 'delegate', coalesce(p_delegate, false)));
  return row;
end $$;

create or replace function public.af_generation_finish(p_id uuid, p_token uuid, p_outcome text, p_result jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token); result jsonb := coalesce(p_result, '{}'::jsonb);
begin
  if p_outcome = 'retry' then
    update public.af_generation_jobs set lease_token = null, lease_expires_at = now() + interval '2 minutes', updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'queued' then
    if jsonb_typeof(result->'brief') <> 'object' then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set brief = result->'brief', status = 'appearance', progress = 0, stage_leases = 0, lease_token = null,
      lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'appearance' then
    if jsonb_typeof(result->'candidates') <> 'array' or jsonb_array_length(result->'candidates') <> 2 then raise exception 'invalid-result'; end if;
    -- A pick only for a job its creator left to us; then the motions start without waiting for him.
    if result ? 'choice' and not (row.delegate and coalesce(result->>'choice', '') in ('a', 'b')) then raise exception 'invalid-result'; end if;
    if result ? 'choice' then
      update public.af_generation_jobs set candidates = result->'candidates', choice = result->>'choice', appearance_note = null, status = 'motions',
        waiting_since = null, progress = 0, stage_leases = 0, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
    else
      update public.af_generation_jobs set candidates = result->'candidates', choice = null, appearance_note = null, status = 'appearance_ready',
        waiting_since = now(), progress = 100, stage_leases = 0, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
    end if;
  elsif p_outcome = 'ok' and row.status = 'motions' then
    if jsonb_typeof(result->'preview') <> 'array' or jsonb_array_length(result->'preview') < 1 then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set preview = result->'preview', motion_note = null, status = 'motion_ready', waiting_since = now(), progress = 100,
      stage_leases = 0, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'submitting' then
    if not exists(select 1 from public.af_submissions where id = (result->>'submissionId')::uuid and owner_id = row.owner_id) then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set submission_id = (result->>'submissionId')::uuid, status = 'submitted', progress = 100, stage_leases = 0,
      lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'rejected' and row.status = 'queued' then
    update public.af_generation_jobs set status = 'rejected', error_code = left(coalesce(result->>'code', 'unsafe'), 64), lease_token = null,
      lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome in ('failed', 'review') then
    update public.af_generation_jobs set status = case when p_outcome = 'failed' then 'failed' else 'needs_review' end,
      error_code = left(coalesce(result->>'code', p_outcome), 64), lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  else raise exception 'invalid-result'; end if;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'finished',
    jsonb_build_object('outcome', p_outcome, 'status', row.status, 'code', result->>'code', 'calls', result->'calls', 'choice', result->>'choice'));
  return row;
end $$;

revoke all on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean) from public, anon, authenticated;
grant execute on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean) to service_role;
