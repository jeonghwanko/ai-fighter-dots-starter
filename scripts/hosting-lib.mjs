import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const hosting = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Reject source files, credentials and links before copying anything to the public branch.
export async function fingerprint(root) {
  const hash = createHash('sha256');
  let files = 0, bytes = 0;
  async function visit(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = prefix + entry.name;
      if (path === 'deployment.json') continue;
      if (entry.isSymbolicLink() || /(^|\/)(\.git|\.env[^/]*|node_modules|\.secret)(\/|$)|\.(?:tsx?|map|pem|key)$/i.test(path)) {
        throw new Error(`Non-public artifact rejected: ${path}`);
      }
      if (entry.isDirectory()) await visit(join(dir, entry.name), path + '/');
      else if (entry.isFile()) {
        const data = await readFile(join(dir, entry.name));
        if (data.subarray(0, 42).toString().startsWith('version https://git-lfs.github.com/spec/v1')) {
          throw new Error(`Unresolved Git LFS asset: ${path}`);
        }
        bytes += data.length; files++;
        if (bytes > 950 * 1024 * 1024) throw new Error('Pages artifact exceeds the 950 MiB safety limit');
        hash.update(path + '\0' + createHash('sha256').update(data).digest('hex') + '\n');
      } else throw new Error(`Unsupported artifact: ${path}`);
    }
  }
  await visit(root);
  return { digest: hash.digest('hex'), files, bytes };
}

export async function verifyArtifact(root) {
  for (const path of ['creator.html', 'fighter.html', 'league.html', 'index.html', '.nojekyll', '.vite/manifest.json']) {
    if (!(await stat(join(root, path))).isFile()) throw new Error(`Missing site entry: ${path}`);
  }
  const release = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8'));
  if (release.siteUrl !== hosting.siteUrl || release.dirty ||
      !/^[a-f0-9]{40}$/.test(release.sourceCommit) || !/^[a-f0-9]{40}$/.test(release.hostingCommit)) {
    throw new Error('Artifact requires clean, committed sources and the configured site');
  }
  const measured = await fingerprint(root);
  if (measured.digest !== release.digest || measured.files !== release.files || measured.bytes !== release.bytes) {
    throw new Error('Artifact changed after build; rebuild before publishing');
  }
  return release;
}

export async function waitForJson(url, predicate, { timeoutMs = 15 * 60_000, intervalMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(Math.min(30_000, deadline - Date.now())) });
      if (response.ok && predicate(await response.json())) return;
    } catch { /* A cold start or deploy may temporarily be unavailable. */ }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('Deployment not confirmed before timeout; inspect the hosting dashboard before retrying');
}
