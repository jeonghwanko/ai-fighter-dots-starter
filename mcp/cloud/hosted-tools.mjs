// 호스팅 생성 도구 (2026-10-28): ODDBOUT's generation worker makes the fighter; the agent carries the user's answers.
import { z } from 'zod';
import { GENERATION_LIMITS } from '../../api/generations.mjs';
import { Problem } from '../../api/http.mjs';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { profileLimits } from '../../contracts/ai-fighter/profile-limits.mjs';
import { FILE, LIBRARY_FILE_HOSTS, UUID_ARG, downloadHostFile } from './common.mjs';

/**
 * 호스팅 생성 도구 (2026-10-28): ODDBOUT's generation worker makes the fighter from the user's words (and up to two of his pictures) and
 * the agent only carries his answers — which of two looks, one change at a time, the registration. Without them an agent drove every
 * generation step itself (dozens of calls and long guides per fighter); Grok and ChatGPT could not make a fighter at all. The routes are the
 * site's (`api/generations.mjs`); the state machine, quotas and the service switch are the database's. Listed only while the function is
 * configured for them (`ODDBOUT_HOSTED_GENERATION_TOOLS`), so a release of this code alone does not change the published tool list.
 */
export const HOSTED_INSTRUCTIONS = 'When the user wants ODDBOUT to make the fighter for him (no generation setup of his own), '
  + 'use request_hosted_fighter and follow each result\'s next. '
  + 'Save the verified get_profile account id, idempotencyKey and original arguments before sending, '
  + 'and the returned job.id. After a timeout or disconnection, verify get_profile still matches that account, '
  + 'then use get_hosted_fighter with jobId or, if the response was lost, idempotencyKey. '
  + 'With neither identifier, inspect the recent jobs without picking one arbitrarily. A key lookup never creates work; '
  + 'not-found may mean the original call has not saved its job yet. '
  + 'Preserve the unknown outcome and inspect the original call, rather than replaying request_hosted_fighter to recover it. '
  + 'Never create a new key or repeat a look/motion revision merely to recover an unknown outcome. '
  + 'Read the same job again for fresh preview URLs; a URL is not proof that the user saw the image. ';
/** States the worker is on; an answer from the user is not awaited. */
const HOSTED_WORKING = new Set(['queued', 'appearance', 'motions', 'submitting']);
/** A submission still on its way to the registry (`af_submissions`). */
const SUBMISSION_PENDING = new Set(['uploading', 'queued', 'validating']);
/** The longest wait one get_hosted_fighter call holds: enter_cup's proven wait (CUP_WAIT_MS), inside the hosts' tool timeouts and the Edge limit. */
export const HOSTED_WAIT_SECONDS = 25;
const HOSTED_POLL_MS = 3000;
const PROFILE_KEYS = ['name', 'description', 'names', 'lines', 'stats'];
const hostedSettled = (status, submission) => !HOSTED_WORKING.has(status) && !(status === 'submitted' && SUBMISSION_PENDING.has(submission ?? 'queued'));

/** What the agent does next with a job, from its state: the user's answer it asks for, or how long to wait. */
// A run the gate refused, made from the walk (the worker's `run-from-walk` preview note, 2026-10-29): the creator hears it and may film it again.
const RUN_FROM_WALK_NEXT = 'The run preview is the walk played faster: no filmed run passed the checks. Tell the user so; '
  + 'if he wants a real run, revise_hosted_motion with clip run and his words. ';
export function hostedNext(job) {
  const left = job.revisionsLeft ?? {}, error = job.error ? ` (${job.error})` : '';
  switch (job.status) {
    case 'queued': case 'appearance':
      if (job.status === 'appearance' && job.host?.choice !== 'oddbout' && job.host && !job.host.assigned)
        return `Waiting for ${job.host.choice === 'host' ? `the host ${job.host.requested?.name ?? ''}` : 'a host'} to take it. Tell the user, and check later with get_hosted_fighter.`;
      return job.delegate
        ? 'ODDBOUT is writing the profile, painting two looks and picking one itself, '
          + 'then it makes the eleven motions (about 15 to 30 minutes in all). '
          + 'Tell the user, and check later with get_hosted_fighter.'
        : 'ODDBOUT is writing the profile and painting two looks (a few minutes). Call get_hosted_fighter with waitSeconds to wait.';
    case 'appearance_ready':
      return `${job.delegate ? 'ODDBOUT could not pick a look by itself. ' : ''}Show the user both looks (candidates a and b) as images and ask which one. `
        + `Then choose_hosted_look with his pick, or with one sentence to change both (${left.appearance ?? 0} changes left).`;
    case 'motions':
      return `ODDBOUT is making the eleven motions from ${job.delegate ? 'the look it picked' : 'the chosen look'} (about 15 to 30 minutes). Tell the user, and check later with get_hosted_fighter.`;
    case 'motion_ready':
      return `${job.preview?.some(p => p.note === 'run-from-walk') ? RUN_FROM_WALK_NEXT : ''}`
        + `Show the user ${job.delegate ? `the look ODDBOUT picked (candidate ${job.choice}), ` : ''}the motion previews as images, and the profile draft. `
        + 'If he likes them, register_hosted_fighter (change only what he asks in the profile). '
        + `To fix one motion, revise_hosted_motion (${left.motions ?? 0} changes left).`;
    case 'submitting':
      return 'ODDBOUT is packaging the fighter and submitting it under the user\'s account. Call get_hosted_fighter with waitSeconds.';
    case 'submitted':
      if (job.submission?.stage === 'registered') return `Registered: fighter ${job.submission.fighterId}. Tell the user; it now fights in ODDBOUT.`;
      if (job.submission?.stage === 'rejected') return 'The server check refused the package. A person at ODDBOUT will look at it; the user\'s free fighter is free again.';
      return 'The server is checking the package. Call get_hosted_fighter with waitSeconds.';
    case 'needs_review': return 'A person at ODDBOUT is checking this step. Nothing to do now; check later.';
    case 'rejected': return `ODDBOUT declined this request${error}. It does not use the user's free fighter; a different request may be made.`;
    case 'failed': return `This request failed${error}. The user's free fighter is free again; he may ask once more.`;
    default: return `This request is ${job.status}; it is over.`;
  }
}
const withNext = result => result?.ok && result.job ? { ...result, next: hostedNext(result.job) } : result;

export function registerHostedTools({ register, db, identity, invoke, fetcher, hosted }) {
  const JOB = UUID_ARG();
  const post = (path, body, headers = {}) => invoke(path, 'POST', JSON.stringify(body), { 'content-type': 'application/json', ...headers });
  const jobIdForKey = async key => {
    const { data, error } = await db.from('af_generation_jobs').select('id').eq('owner_id', identity.owner).eq('idempotency_key', key.toLowerCase()).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    return data?.id ?? null;
  };
  register('request_hosted_fighter', 'ODDBOUT에 선수 만들기 맡기기', 'ODDBOUT makes a fighter for the connected user on its own generation worker: '
    + 'two looks to choose from, then the eleven motions, then registration under his account. delegate: '
    + 'true when he leaves the choices to ODDBOUT ("알아서 해 줘", "just make it"): '
    + 'ODDBOUT picks the look itself (or asks him if neither suits) and he answers once, at the finished motions. host: '
    + 'oddbout (default, ODDBOUT\'s own worker), mine (his own PC as a host: '
    + 'no consent to give, approval not needed), any (any approved community host) or a host id from list_generation_hosts; '
    + 'any or another person\'s host sends his words and pictures to that host\'s PC, so ask him first and pass hostConsent: '
    + 'true. Pass his words (what the fighter is and looks like) and, if he gave them, '
    + 'up to two of his own pictures with his confirmation that he has the rights to them. '
    + 'One hosted fighter per account is free. Requires the user\'s request. '
    + 'Save the verified account id and idempotencyKey before calling, and the returned job.id. '
    + 'If the response is lost, recover with get_hosted_fighter using that key; '
    + 'do not replay this creation call while its outcome is unknown. '
    + 'A confirmed safe retry keeps the original key and arguments. Returns the job; follow its next.',
    { description: z.string().min(GENERATION_LIMITS.descriptionMin).max(GENERATION_LIMITS.description), language: z.enum(['ko', 'en']),
      picture: FILE.optional(), secondPicture: FILE.optional(), rightsConfirmed: z.boolean().optional(), delegate: z.boolean().optional(),
      host: z.union([z.enum(['oddbout', 'any', 'mine']), UUID_ARG()]).optional(), hostConsent: z.boolean().optional(), idempotencyKey: UUID_ARG() },
    async ({ description, language, picture, secondPicture, rightsConfirmed, delegate, host, hostConsent, idempotencyKey }) => {
      // Once saved, the same key returns its job without re-uploading pictures. Before that, use read-only recovery.
      const existingId = await jobIdForKey(idempotencyKey);
      if (existingId) return withNext(await invoke(`generations/${existingId}`));
      // Off (the service switch, the worker away or unwell) before any picture is kept. A failed read is the database's, not the switch's.
      const service = await invoke('generations/capabilities');
      if (!service.ok) return service;
      if (!service.capabilities?.hosted) return { ok: false, code: 'generation-unavailable', reason: service.capabilities?.reason ?? null };
      const pictures = [picture, secondPicture].filter(Boolean);
      if (pictures.length && rightsConfirmed !== true) return { ok: false, code: 'rights-required' };
      const ask = { description, language, ...(delegate ? { delegate: true } : {}), ...(host && host !== 'oddbout' ? { host, hostConsent: hostConsent === true } : {}) };
      // The request's own checks (consent, one at a time, the day's limits, the host) before a picture moves: each kept picture spends one
      // of the day's uploads and stays in storage (MCP 점검 2026-10-29). A request without pictures is checked where it is made.
      if (pictures.length) {
        const checked = await post('generations/check', ask);
        if (!checked.ok) return checked;
      }
      const refs = [];
      for (const file of pictures) {
        const uploaded = await invoke('generations/uploads', 'POST', await downloadHostFile(file, GENERATION_LIMITS.refBytes, fetcher, LIBRARY_FILE_HOSTS),
          { 'content-type': 'application/octet-stream' });
        if (!uploaded.ok) return uploaded;
        refs.push(uploaded.upload.id);
      }
      return withNext(await post('generations', { ...ask, ...(refs.length ? { refs, rightsConfirmed: true } : {}) }, { 'idempotency-key': idempotencyKey }));
    }, { write: true, openWorld: true, idempotent: false, files: ['picture', 'secondPicture'] });
  register('list_generation_hosts', '선수 만드는 호스트', 'List who can make a fighter: ODDBOUT itself and the community hosts the operator approved (creators who run the '
    + 'generation worker on their own PC and subscription). For each: '
    + 'id, name, whether it is on now, whether it takes requests that name no host, and how many it can still take today. '
    + 'Pass an id as request_hosted_fighter\'s host.',
    {}, () => invoke('generations/hosts'), { publicTool: true });
  register('get_hosted_fighter', 'ODDBOUT이 만드는 선수', `Read or resume the connected user's hosted fighter after a timeout or disconnection: its state, `
    + `the two looks or the motion previews as fresh image URLs (ten minutes), the profile draft and next. `
    + `Supply either jobId or the original request's idempotencyKey, never both. `
    + `Key lookup only reads an existing job under this account, even when new generation is disabled; `
    + `not-found does not prove that an interrupted request never started. With neither identifier: `
    + `his latest five requests and whether hosted generation is open. Read the same job again if a preview URL expired; `
    + `do not regenerate. waitSeconds (up to ${HOSTED_WAIT_SECONDS}) is a bounded wait, not a completion guarantee; `
    + `if still working, check this job again later.`,
    { jobId: JOB.optional(), idempotencyKey: UUID_ARG().optional(), waitSeconds: z.number().int().min(0).max(HOSTED_WAIT_SECONDS).optional() }, async ({ jobId, idempotencyKey, waitSeconds = 0 }) => {
      if (jobId && idempotencyKey) return { ok: false, code: 'invalid-selector' };
      if (idempotencyKey) {
        jobId = await jobIdForKey(idempotencyKey);
        if (!jobId) return { ok: false, code: 'not-found', next: 'No saved job was found for this key in the connected account. The original request may still be running. '
          + 'Check the account and original call; do not submit again to recover it.' };
      }
      if (!jobId) {
        const list = await invoke('generations');
        return list.ok ? { ...list, jobs: list.jobs.map(job => ({ ...job, next: hostedNext(job) })) } : list;
      }
      // Wait on the state alone (no signed URLs per look), then read the job once.
      const deadline = Date.now() + waitSeconds * 1000, pollMs = hosted.pollMs ?? HOSTED_POLL_MS;
      while (Date.now() + pollMs <= deadline) {
        const { data: row, error } = await db.from('af_generation_jobs').select('status,submission_id').eq('id', jobId).eq('owner_id', identity.owner).maybeSingle();
        if (error || !row) break;
        let stage = null;
        if (row.status === 'submitted' && row.submission_id) {
          const { data } = await db.from('af_submissions').select('status').eq('id', row.submission_id).maybeSingle();
          stage = data?.status ?? null;
        }
        if (hostedSettled(row.status, stage)) break;
        await new Promise(done => setTimeout(done, pollMs));
      }
      return withNext(await invoke(`generations/${jobId}`));
    });
  register('choose_hosted_look', '외형 고르기', 'Answer the two looks of the connected user\'s hosted fighter with his words: '
    + 'choose a or b (ODDBOUT then makes the motions), or revise with one sentence (both looks are painted again). '
    + 'Requires the user\'s answer. Revisions are not idempotent: '
    + 'after an unknown outcome, read get_hosted_fighter instead of repeating this call.',
    { jobId: JOB, choose: z.enum(['a', 'b']).optional(), revise: z.string().min(2).max(GENERATION_LIMITS.note).optional() },
    ({ jobId, choose, revise }) => (choose === undefined) === (revise === undefined) ? { ok: false, code: 'invalid-answer' }
      : post(`generations/${jobId}/appearance`, choose !== undefined ? { choose } : { revise }).then(withNext), { write: true, idempotent: false });
  register('revise_hosted_motion', '동작 하나 고치기', 'Ask ODDBOUT to make one motion of the connected user\'s hosted fighter again with his sentence; the other motions stay. '
    + 'Requires the user\'s request. Not idempotent: '
    + 'after an unknown outcome, read get_hosted_fighter instead of repeating this call.',
    { jobId: JOB, clip: z.enum(Object.keys(spec.motions)), note: z.string().min(2).max(GENERATION_LIMITS.note) },
    ({ jobId, clip, note }) => post(`generations/${jobId}/motions`, { revise: { clip, note } }).then(withNext), { write: true, idempotent: false });
  register('register_hosted_fighter', '맡긴 선수 등록', 'Register the connected user\'s hosted fighter once he approved its motions: '
    + 'ODDBOUT packages it and submits it under his account, through the same server check as any fighter. '
    + 'profile holds only what he changed in the draft (name, description, names, bout lines, stats summing to 9). '
    + 'Requires the user\'s registration request.',
    { jobId: JOB, profile: z.object({ name: z.string().min(1).max(profileLimits.name), description: z.string().min(1).max(profileLimits.description),
      names: z.record(z.string(), z.string()), lines: z.record(z.string(), z.string()),
      stats: z.object({ power: z.number().int(), toughness: z.number().int(), speed: z.number().int() }).strict() }).partial().strict().optional() },
    async ({ jobId, profile = {} }) => {
      const read = await invoke(`generations/${jobId}`);
      if (!read.ok) return read;
      // The draft the worker wrote, with his changes over it; the API checks the result against the contract.
      const draft = read.job.profile ?? {}, merged = { ...draft, ...profile };
      for (const key of ['names', 'lines']) if (profile[key] && draft[key]) merged[key] = { ...draft[key], ...profile[key] };
      const confirmed = Object.fromEntries(PROFILE_KEYS.filter(key => merged[key] != null).map(key => [key, merged[key]]));
      return withNext(await post(`generations/${jobId}/register`, { profile: confirmed }));
    }, { write: true, publish: true, openWorld: true, idempotent: true });
  register('cancel_hosted_fighter', '맡긴 선수 취소', 'Cancel the connected user\'s hosted fighter request; '
    + 'work in progress stops at its next step and his free fighter is free again. Only on his explicit request.',
    { jobId: JOB }, async ({ jobId }) => withNext(await invoke(`generations/${jobId}`, 'DELETE')), { write: true, publish: true, idempotent: true });
}
