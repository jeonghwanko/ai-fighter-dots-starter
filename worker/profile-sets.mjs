// @ts-check
// The validator's second queue (선수 프로필 세트, 2026-10-31): claim a submitted profile set, download its front painting, check it in a child
// process (profile-set-check.mjs), store the derived card and face under the lease and finish. The same Render worker drains the package
// queue first (server.mjs). An infrastructure failure hands the set back without spending one of its attempts, as run.mjs does.
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { apiRequest, transferTimeoutMs, validProjectUrl } from '../api/client.mjs';
import { readBody, sha256 } from '../api/http.mjs';
import { PROFILE_SET_VALIDATOR_VERSION, parseProfileSet } from '../api/profile-sets.mjs';

// The server lease is five minutes: download, check and store within four.
const JOB_DEADLINE_MS = 4 * 60 * 1000, CHECK_TIMEOUT_MS = 30000;
const FINISH_RETRY_MS = [1000, 3000];
class RetryLater extends Error {}

/**
 * What worker/profile-sets/claim answers (api/profile-sets.mjs).
 * @typedef {{ stage: 'idle' } | { stage: 'validating', profileSetId: string, leaseToken: string, manifestText: string, manifestSha256: string,
 *   front: { bytes: number, sha256: string, width: number, height: number, downloadUrl: string }, face: { x: number, y: number, side: number } }} ClaimedSet
 */
/** @typedef {{ ok: boolean, stage?: string, errors: { code: string, path: string }[], derived?: any }} ChildVerdict */

/**
 * Run the pixel check in a child process with its own deadline. An unanswered or crashed child is the worker's problem (RetryLater).
 * @param {string} directory @returns {Promise<ChildVerdict>}
 */
function checkInChild(directory) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./profile-set-child.mjs', import.meta.url)), [directory], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=256'], env: { ...process.env, VIPS_CONCURRENCY: '1' } });
    /** @type {ChildVerdict | undefined} */
    let result;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, CHECK_TIMEOUT_MS);
    child.on('message', message => { if (!timedOut) result ??= /** @type {ChildVerdict} */ (message); });
    child.once('error', () => { clearTimeout(timer); reject(new RetryLater('check-start-failed')); });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!result || result.stage === 'worker') reject(new RetryLater(timedOut ? 'check-timeout' : 'check-failed'));
      else resolve(result);
    });
  });
}

/**
 * Validate one queued profile set, or answer idle.
 * @param {{ url?: string, workerToken?: string }} config @param {string} [profileSetId]
 */
export async function runProfileSetWithConfig(config, profileSetId) {
  if (!validProjectUrl(config.url) || !/^afw_[a-f0-9]{64}$/.test(config.workerToken ?? '')) throw new Error('invalid-worker-config');
  const project = /** @type {string} */ (config.url), token = /** @type {string} */ (config.workerToken);
  /** @type {(route: string, body: object) => Promise<any>} */
  const send = (route, body) => apiRequest(project, token, route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  /** @type {ClaimedSet} */
  const job = await send('worker/profile-sets/claim', profileSetId ? { profileSetId } : {});
  if (job.stage === 'idle') return job;
  const deadline = AbortSignal.timeout(JOB_DEADLINE_MS);
  const base = fileURLToPath(new URL('../output/worker-jobs/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'profile-set-'));
  /** @type {ChildVerdict} */
  let verdict;
  /** @type {any} */
  let derived = null;
  try {
    if (await sha256(new TextEncoder().encode(job.manifestText)) !== job.manifestSha256) throw new RetryLater('server-manifest-hash');
    const parsed = parseProfileSet(job.manifestText);
    if (!parsed.ok) verdict = { ok: false, stage: 'server-manifest', errors: [{ code: 'invalid-server-manifest', path: '' }] };
    else {
      const front = parsed.data.front, url = new URL(job.front.downloadUrl);
      if (url.origin !== project || !url.pathname.startsWith('/storage/v1/object/sign/ai-fighter-beta/')) throw new RetryLater('invalid-download-origin');
      let bytes;
      try {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(transferTimeoutMs(front.bytes)), deadline]) });
        if (!response.ok) throw new RetryLater('download-failed');
        bytes = await readBody(response, front.bytes);
      } catch (error) { throw error instanceof RetryLater ? error : new RetryLater(deadline.aborted ? 'job-deadline' : 'download-failed'); }
      // Upload already checked these bytes; a mismatch now is a storage fault, not the creator's painting.
      if (bytes.length !== front.bytes || await sha256(bytes) !== front.sha256) throw new RetryLater('download-integrity');
      await writeFile(path.join(directory, 'front.webp'), bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(path.join(directory, 'set.json'), JSON.stringify(parsed.data), { flag: 'wx', mode: 0o600 });
      verdict = await checkInChild(directory);
      if (deadline.aborted) throw new RetryLater('job-deadline');
      if (verdict.ok) {
        /** @type {Record<string, { sha256: string, bytes: number }>} */
        const stored = {};
        for (const name of ['card', 'face']) {
          const file = await readFile(path.join(directory, `${name}.webp`)), hash = await sha256(file);
          let answer;
          try {
            answer = await apiRequest(project, token, `worker/profile-sets/${job.profileSetId}/derived/${name}`, { method: 'PUT',
              headers: { 'content-type': 'image/webp', 'x-profile-set-lease': job.leaseToken }, body: file });
          } catch { throw new RetryLater('derived-upload-failed'); }
          if (answer.sha256 !== hash || answer.bytes !== file.length) throw new RetryLater('derived-upload-integrity');
          stored[name] = { sha256: hash, bytes: file.length };
        }
        derived = { card: { ...stored.card, ...verdict.derived.card }, face: { ...stored.face, ...verdict.derived.face } };
      }
    }
  } catch (error) {
    if (!(error instanceof RetryLater)) return { ok: false, stage: 'retry-later', profileSetId: job.profileSetId, code: 'worker-error' };
    const requeued = await send('worker/profile-sets/release', { profileSetId: job.profileSetId, leaseToken: job.leaseToken, code: error.message })
      .then(() => true, () => false);
    return { ok: false, stage: 'retry-later', profileSetId: job.profileSetId, code: error.message, requeued };
  } finally {
    const relative = path.relative(base, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('unsafe-cleanup');
    await rm(directory, { recursive: true, force: true });
  }
  const receipt = { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: verdict.ok ? 'profile-set-full-decode' : verdict.stage ?? 'profile-set-check',
    errors: verdict.errors.slice(0, 20).map(e => ({ code: e.code, path: e.path ?? '' })), manifestSha256: job.manifestSha256 };
  const finish = { profileSetId: job.profileSetId, leaseToken: job.leaseToken, manifestSha256: job.manifestSha256, passed: verdict.ok, result: receipt,
    ...(verdict.ok ? { derived } : {}) };
  for (let attempt = 0; ; attempt++) {
    try { return { ...(await send('worker/profile-sets/finish', finish)), profileSetId: job.profileSetId }; }
    catch (/** @type {any} */ error) {
      // A refused finish says nothing about the painting: hand it back. A lost lease or a refused key is not this worker's to hand back.
      if (error.status >= 400 && error.status < 500) {
        if (error.status === 401 || error.status === 403 || error.message === 'stale-validation') throw error;
        const code = `finish-refused-${error.message.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64);
        const requeued = await send('worker/profile-sets/release', { profileSetId: job.profileSetId, leaseToken: job.leaseToken, code }).then(() => true, () => false);
        return { ok: false, stage: 'retry-later', profileSetId: job.profileSetId, code, requeued };
      }
      if (attempt >= 2) throw error;
    }
    await delay(FINISH_RETRY_MS[attempt]);
  }
}
