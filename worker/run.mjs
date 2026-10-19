import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiRequest, validProjectUrl } from '../api/client.mjs';
import { readBody, sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { makePackageValidator } from '../mcp/package-access.mjs';

export async function runOnce(configPath, submissionId) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!validProjectUrl(config.url) || !/^afw_[a-f0-9]{64}$/.test(config.workerToken ?? '')) throw new Error('invalid-worker-config');
  const send = (route, body) => apiRequest(config.url, config.workerToken, route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const job = await send('worker/claim', { ...(submissionId ? { submissionId } : {}) });
  if (job.stage === 'idle') return job;
  const base = fileURLToPath(new URL('../output/worker-jobs/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'job-'));
  let result;
  try {
    const parsed = parseFighterJson(job.manifestText);
    if (!parsed.ok || !validateFighter(parsed.data).ok || await sha256(new TextEncoder().encode(job.manifestText)) !== job.manifestSha256) throw new Error('invalid-server-manifest');
    if (job.files.length !== parsed.data.assets.length) throw new Error('invalid-server-files');
    await mkdir(path.join(directory, 'assets'));
    for (const asset of parsed.data.assets) {
      const file = job.files.find(f => f.id === asset.id), url = new URL(file.downloadUrl);
      if (url.origin !== config.url || !url.pathname.startsWith('/storage/v1/object/sign/ai-fighter-beta/')) throw new Error('invalid-download-origin');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('download-failed');
      const bytes = await readBody(response, asset.bytes);
      if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Error('download-integrity');
      await writeFile(path.join(directory, asset.path), bytes, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(path.join(directory, 'fighter.json'), job.manifestText, { flag: 'wx', mode: 0o600 });
    result = await makePackageValidator(base)(`${path.basename(directory)}/fighter.json`);
  } catch (error) { result = { ok: false, stage: 'server-download', errors: [{ code: /^[a-z0-9-]+$/.test(error.message) ? error.message : 'download-or-validation-failed' }] }; }
  finally {
    const relative = path.relative(base, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('unsafe-cleanup');
    await rm(directory, { recursive: true, force: true });
  }
  const receipt = { validatorVersion: VALIDATOR_VERSION, stage: result.stage, errors: result.errors.slice(0, 20).map(e => ({ code: e.code, path: e.path ?? '' })),
    checkedAssetCount: job.files.length, manifestSha256: job.manifestSha256 };
  const finish = { submissionId: job.submissionId, leaseToken: job.leaseToken, manifestSha256: job.manifestSha256, passed: result.ok, result: receipt };
  // Same lease receipt is retryable; a stale lease can never finalize a new worker's job.
  for (let attempt = 0; ; attempt++) {
    try { return await send('worker/finish', finish); } catch (error) { if (attempt >= 2 || error.status < 500) throw error; }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = process.env.AI_FIGHTER_WORKER_CONFIG;
  if (!config) throw new Error('Set AI_FIGHTER_WORKER_CONFIG to a private worker config file');
  const watch = process.argv.includes('--watch');
  let idleMs = 15000;
  do {
    try {
      const result = await runOnce(config, process.argv.find(arg => /^[a-f0-9-]{36}$/.test(arg)));
      if (!watch || result.stage !== 'idle') console.log(JSON.stringify(result));
      idleMs = result.stage === 'idle' ? Math.min(idleMs * 2, 120000) : 15000;
    } catch (error) {
      if (!watch || error.status === 401 || error.status === 403) throw error;
      console.error(JSON.stringify({ stage: 'retry-wait', code: 'worker-api-unavailable' }));
      idleMs = Math.min(idleMs * 2, 120000);
    }
    if (!watch) break;
    await new Promise(resolve => setTimeout(resolve, idleMs));
  } while (true);
}
