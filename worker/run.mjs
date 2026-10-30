// @ts-check
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { apiRequest, transferTimeoutMs, validProjectUrl } from '../api/client.mjs';
import { readBody, sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { makePackageValidator } from '../mcp/package-access.mjs';

// The server lease is five minutes. Downloads stop at four, so validation (20 s) and finish fit inside it.
const JOB_DEADLINE_MS = 4 * 60 * 1000;
const DOWNLOADS_AT_ONCE = 4;
const FINISH_RETRY_MS = [1000, 3000];

/**
 * An infrastructure failure: a download, the deadline or the validator process. It says nothing about the
 * package, so the worker does not finish the job. It hands the job back (worker/release): the attempt is refunded
 * and counted as an infrastructure failure, which the server limits separately. If the hand-back fails, the
 * lease expires and af_claim retries it, counting the attempt (three, then worker-attempt-limit).
 */
class RetryLater extends Error {}

/**
 * What worker/claim answers (api/handler.mjs): `idle`, or a leased job whose files carry signed download URLs.
 * @typedef {{ stage: 'idle' } | { stage: 'validating', submissionId: string, leaseToken: string, manifestText: string,
 *   manifestSha256: string, files: { id: string, downloadUrl: string }[] }} ClaimedJob
 */

/**
 * Run `task` over items, `limit` at a time. The first failure cancels the rest; returns after every task stopped.
 * @template T
 * @param {T[]} items @param {number} limit @param {AbortController} cancel @param {(item: T) => Promise<void>} task
 */
async function eachLimited(items, limit, cancel, task) {
  let next = 0;
  /** @type {unknown} */
  let failure;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !failure) {
      try { await task(items[next++]); }
      catch (error) { failure ??= error; cancel.abort(); }
    }
  }));
  if (failure) throw failure;
}

/** @param {string} configPath @param {string} [submissionId] */
export async function runOnce(configPath, submissionId) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  return runWithConfig(config, submissionId);
}

/**
 * Environment-backed web services need no credential file on their ephemeral disk.
 * @param {{ url?: string, workerToken?: string }} config checked here: an unset environment variable arrives as undefined
 * @param {string} [submissionId]
 */
export async function runWithConfig(config, submissionId) {
  if (!validProjectUrl(config.url) || !/^afw_[a-f0-9]{64}$/.test(config.workerToken ?? '')) throw new Error('invalid-worker-config');
  const project = /** @type {string} */ (config.url), token = /** @type {string} */ (config.workerToken); // both checked just above
  /** @type {(route: string, body: object) => Promise<any>} */
  const send = (route, body) => apiRequest(project, token, route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  /** @type {ClaimedJob} */
  const job = await send('worker/claim', { ...(submissionId ? { submissionId } : {}) });
  if (job.stage === 'idle') return job;
  const deadline = AbortSignal.timeout(JOB_DEADLINE_MS), cancel = new AbortController();
  const base = fileURLToPath(new URL('../output/worker-jobs/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'job-'));
  /** @type {{ ok: boolean, stage: string, errors: { code: string, path?: string }[] }} */
  let result;
  try {
    if (await sha256(new TextEncoder().encode(job.manifestText)) !== job.manifestSha256) throw new RetryLater('server-manifest-hash');
    const parsed = parseFighterJson(job.manifestText);
    if (!parsed.ok || !validateFighter(parsed.data).ok) {
      // A verdict: this manifest fails the worker's contract.
      result = { ok: false, stage: 'server-manifest', errors: [{ code: 'invalid-server-manifest' }] };
    } else {
      if (job.files.length !== parsed.data.assets.length) throw new RetryLater('invalid-server-files');
      await mkdir(path.join(directory, 'assets'));
      await eachLimited(parsed.data.assets, DOWNLOADS_AT_ONCE, cancel, async asset => {
        const file = job.files.find(f => f.id === asset.id);
        if (!file) throw new RetryLater('invalid-server-files');
        const url = new URL(file.downloadUrl);
        if (url.origin !== config.url || !url.pathname.startsWith('/storage/v1/object/sign/ai-fighter-beta/')) throw new RetryLater('invalid-download-origin');
        let bytes;
        try {
          const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(transferTimeoutMs(asset.bytes)), deadline, cancel.signal]) });
          if (!response.ok) throw new RetryLater('download-failed');
          bytes = await readBody(response, asset.bytes);
        } catch (error) { throw error instanceof RetryLater ? error : new RetryLater(deadline.aborted ? 'job-deadline' : 'download-failed'); }
        // Upload already checked these bytes; a mismatch now is a storage fault, not the creator's package.
        if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new RetryLater('download-integrity');
        await writeFile(path.join(directory, asset.path), bytes, { flag: 'wx', mode: 0o600 });
      });
      if (deadline.aborted) throw new RetryLater('job-deadline');
      await writeFile(path.join(directory, 'fighter.json'), job.manifestText, { flag: 'wx', mode: 0o600 });
      result = await makePackageValidator(base)(`${path.basename(directory)}/fighter.json`);
      // Timeouts, crashes and a busy validator are the worker's problem, not a package verdict.
      if (result.stage === 'local-access' || result.stage === 'worker')
        throw new RetryLater(String(result.errors?.[0]?.code ?? 'validator-unavailable').toLowerCase().replaceAll('_', '-'));
    }
  } catch (error) {
    if (!(error instanceof RetryLater)) return { ok: false, stage: 'retry-later', submissionId: job.submissionId, code: 'worker-error' };
    // Best effort: an older API or an outage leaves the lease to expire as before.
    const requeued = await send('worker/release', { submissionId: job.submissionId, leaseToken: job.leaseToken, code: error.message })
      .then(() => true, () => false);
    return { ok: false, stage: 'retry-later', submissionId: job.submissionId, code: error.message, requeued };
  } finally {
    const relative = path.relative(base, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('unsafe-cleanup');
    await rm(directory, { recursive: true, force: true });
  }
  const receipt = { validatorVersion: VALIDATOR_VERSION, stage: result.stage, errors: result.errors.slice(0, 20).map(e => ({ code: e.code, path: e.path ?? '' })),
    checkedAssetCount: job.files.length, manifestSha256: job.manifestSha256 };
  const finish = { submissionId: job.submissionId, leaseToken: job.leaseToken, manifestSha256: job.manifestSha256, passed: result.ok, result: receipt };
  // Same lease receipt is retryable; a stale lease can never finalize a new worker's job.
  // Back off (1 s, then 3 s) so a brief outage does not discard a finished validation; both fit inside the lease.
  for (let attempt = 0; ; attempt++) {
    try { return await send('worker/finish', finish); }
    catch (/** @type {any} */ error) {
      if (error.status >= 400 && error.status < 500) return refused(error);
      if (attempt >= 2) throw error;
    }
    await delay(FINISH_RETRY_MS[attempt]);
  }
  /**
   * A finish the server refuses (a validator version it does not take, …) says nothing about the package: hand the job back, as for an
   * infrastructure failure. Left to expire, each lease spent one of the package's three attempts and a valid package was rejected
   * (API 점검 2026-10-29). A lost lease is not this worker's to hand back, and a refused worker key stops the worker.
   * @param {Error & { status?: number }} error
   */
  async function refused(error) {
    if (error.status === 401 || error.status === 403 || error.message === 'stale-validation') throw error;
    const code = `finish-refused-${error.message.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64);
    const requeued = await send('worker/release', { submissionId: finish.submissionId, leaseToken: finish.leaseToken, code }).then(() => true, () => false);
    return { ok: false, stage: 'retry-later', submissionId: finish.submissionId, code, requeued };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = process.env.AI_FIGHTER_WORKER_CONFIG;
  if (!config) throw new Error('Set AI_FIGHTER_WORKER_CONFIG to a private worker config file');
  const watch = process.argv.includes('--watch');
  let idleMs = 15000;
  do {
    // Drain the queue: claim again at once after a finished job. Back off only while idle or failing.
    let waitMs = 0;
    try {
      const result = await runOnce(config, process.argv.find(arg => /^[a-f0-9-]{36}$/.test(arg)));
      if (!watch || result.stage !== 'idle') console.log(JSON.stringify(result));
      // Idle or an infrastructure failure: back off. A finished job: claim the next at once.
      if (result.stage === 'idle' || result.stage === 'retry-later') { waitMs = idleMs; idleMs = Math.min(idleMs * 2, 120000); } else idleMs = 15000;
    } catch (/** @type {any} */ error) {
      if (!watch || error.status === 401 || error.status === 403) throw error;
      console.error(JSON.stringify({ stage: 'retry-wait', code: 'worker-api-unavailable' }));
      waitMs = idleMs; idleMs = Math.min(idleMs * 2, 120000);
    }
    if (!watch) break;
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  } while (true);
}
