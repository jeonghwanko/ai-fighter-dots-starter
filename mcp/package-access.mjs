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

export function makePackageValidator(root, { timeoutMs = 20000 } = {}) {
  let busy = false;
  return async relative => {
    if (busy) return issue('VALIDATOR_BUSY');
    busy = true;
    try {
      const manifest = await resolveManifest(root, relative);
      if (!manifest) return issue('PATH_NOT_ALLOWED');
      return await new Promise(resolve => {
        const child = fork(fileURLToPath(new URL('./package-worker.mjs', import.meta.url)), [manifest], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=128'],
          env: { ...process.env, VIPS_CONCURRENCY: '1' },
        });
        let result;
        const timer = setTimeout(() => { result = issue('VALIDATION_TIMEOUT'); child.kill(); }, timeoutMs);
        child.on('message', message => { result = message; });
        child.once('error', () => { clearTimeout(timer); resolve(issue('WORKER_START_FAILED')); });
        child.once('exit', code => { clearTimeout(timer); resolve(result ?? issue(code === 0 ? 'WORKER_NO_RESULT' : 'WORKER_FAILED')); });
      });
    } catch { return issue('PACKAGE_UNAVAILABLE'); }
    finally { busy = false; }
  };
}
