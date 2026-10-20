import { fork } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const issue = code => ({ ok: false, stage: 'local-access', errors: [{ code, path: '/manifestPath' }] });
// A local trusted workspace only. Concurrent hostile filesystem replacement needs OS isolation.
export async function resolveManifest(root, relative) {
  if (!relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || path.isAbsolute(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..') || !relative.endsWith('/fighter.json')) return null;
  const canonicalRoot = await realpath(root);
  let target = canonicalRoot;
  for (const component of relative.split('/')) {
    target = path.join(target, component);
    if ((await lstat(target)).isSymbolicLink()) return null;
  }
  const resolved = await realpath(target), within = path.relative(canonicalRoot, resolved);
  if (within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) return null;
  return resolved;
}

/**
 * One decoder at a time. Up to `maxWaiting` further calls wait their turn; more return VALIDATOR_BUSY.
 * Each run gets its own deadline from the moment it starts.
 */
export function makePackageValidator(root, { timeoutMs = 20000, maxWaiting = 2 } = {}) {
  const validateOnce = async relative => {
    try {
      const manifest = await resolveManifest(root, relative);
      if (!manifest) return issue('PATH_NOT_ALLOWED');
      return await new Promise(resolve => {
        const child = fork(fileURLToPath(new URL('./package-worker.mjs', import.meta.url)), [manifest], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=128'],
          env: { ...process.env, VIPS_CONCURRENCY: '1' },
        });
        // A result that arrived before the deadline wins, even if the child is slow to exit.
        let result, timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
        child.on('message', message => { if (!timedOut) result ??= message; });
        child.once('error', () => { clearTimeout(timer); resolve(issue('WORKER_START_FAILED')); });
        child.once('exit', code => { clearTimeout(timer);
          resolve(result ?? issue(timedOut ? 'VALIDATION_TIMEOUT' : code === 0 ? 'WORKER_NO_RESULT' : 'WORKER_FAILED')); });
      });
    } catch { return issue('PACKAGE_UNAVAILABLE'); }
  };
  let pending = 0, tail = Promise.resolve();
  return async relative => {
    if (pending > maxWaiting) return issue('VALIDATOR_BUSY');
    pending++;
    const run = tail.then(() => validateOnce(relative));
    tail = run.then(() => {}, () => {});
    try { return await run; } finally { pending--; }
  };
}
