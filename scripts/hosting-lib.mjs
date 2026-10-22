import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const hosting = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Rewrite public site and homepage links while retaining repository documentation links.
export function publicSiteText(text) {
  const base = new URL('.', hosting.siteUrl).href;
  return text.replaceAll('https://jeonghwanko.github.io/ai-fighter-dots-starter/', base)
    .replaceAll(base + 'league.html', base)
    .replaceAll('./league.html', './')
    .replace(/((?:\\)?["'])league\.html(?=(?:\\)?["'])/g, '$1');
}
export const siteEntries = ['creator.html', 'fighter.html', 'league.html', 'about.html', 'docs.html', 'privacy.html', 'admin.html'];

function assertPublicContent(data, path) {
  if (!['sb_secret_', 'afw_', 'AI_FIGHTER_WAKE_TOKEN', 'PRIVATE KEY', 'api.render.com', 'eyJ'].some(value => data.includes(value))) return;
  const text = data.toString('utf8').replaceAll('\\/', '/');
  const privateValue = /sb_secret_[A-Za-z0-9_-]{20,}|afw_[a-f0-9]{64}|AI_FIGHTER_WAKE_TOKEN["'\s:=\\]+[a-f0-9]{64}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https:\/\/api\.render\.com\/deploy\/[^\s"'<>]*[?&]key=[A-Za-z0-9_-]+/;
  if (privateValue.test(text)) throw new Error(`Private credential found in artifact: ${path}`);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { continue; }
    if (claims.role === 'service_role') throw new Error(`Private credential found in artifact: ${path}`);
  }
}

// Reject source files, credentials and links before copying anything to the public branch.
export async function fingerprint(root, { gitCheckout = false } = {}) {
  const hash = createHash('sha256');
  let files = 0, bytes = 0;
  async function visit(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = prefix + entry.name;
      // Only the publisher's freshly cloned checkout may contain its Git directory.
      if (gitCheckout && path === '.git' && entry.isDirectory()) continue;
      if (entry.isSymbolicLink() || /(^|\/)(\.git(?:hub|attributes|modules)?|\.env[^/]*|node_modules|\.secret|\.ssh)(\/|$)|\.(?:tsx?|map|pem|key)$/i.test(path)) {
        throw new Error(`Non-public artifact rejected: ${path}`);
      }
      if (entry.isDirectory()) await visit(join(dir, entry.name), path + '/');
      else if (entry.isFile()) {
        const data = await readFile(join(dir, entry.name));
        if (data.length >= 100 * 1024 * 1024) throw new Error(`Artifact exceeds GitHub's single-file limit: ${path}`);
        assertPublicContent(data, path);
        if (path === 'deployment.json') continue; // Inspect the marker, but do not hash itself.
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

export async function verifyArtifact(root, options) {
  for (const path of [...siteEntries, 'index.html', '.nojekyll', '.vite/manifest.json']) {
    if (!(await stat(join(root, path))).isFile()) throw new Error(`Missing site entry: ${path}`);
  }
  if (hosting.customDomain && (await readFile(join(root, 'CNAME'), 'utf8')).trim() !== hosting.customDomain) {
    throw new Error('Custom domain CNAME does not match the configured site');
  }
  const release = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8'));
  if (release.siteUrl !== hosting.siteUrl || release.dirty !== false ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(release.buildId ?? '') ||
      !Number.isFinite(Date.parse(release.builtAt)) ||
      !/^[a-f0-9]{40}$/.test(release.sourceCommit) || !/^[a-f0-9]{40}$/.test(release.hostingCommit)) {
    throw new Error('Artifact requires clean, committed sources and the configured site');
  }
  const measured = await fingerprint(root, options);
  if (measured.digest !== release.digest || measured.files !== release.files || measured.bytes !== release.bytes) {
    throw new Error('Artifact changed after build; rebuild before publishing');
  }
  return release;
}

/** Check the actual entry documents and manifest asset bytes, not just HTTP 200. */
export async function verifyLiveSite(root, { siteUrl = hosting.siteUrl, request = fetch } = {}) {
  const manifest = JSON.parse(await readFile(join(root, '.vite/manifest.json'), 'utf8'));
  const files = new Set(['index.html', ...siteEntries, ...(hosting.customDomain ? ['CNAME'] : [])]), visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry || typeof entry.file !== 'string') throw new Error(`Missing Vite entry: ${key}`);
    for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) files.add(file);
    for (const imported of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) visit(imported);
  }
  for (const page of siteEntries) visit(page);
  for (const file of files) {
    if (!file || /(^|\/)\.\.(\/|$)|[\\?#]/.test(file) || file.startsWith('/') || /^[a-z]+:/i.test(file)) {
      throw new Error('Unsafe manifest asset path');
    }
    const url = new URL(file, siteUrl);
    const response = await request(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    if (response.status !== 200) throw new Error(`Published asset unavailable: ${file} (${response.status})`);
    const mime = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css'
      : /\.(?:m?js)$/.test(file) ? /^(?:text|application)\/javascript$/
      : file.endsWith('.wasm') ? 'application/wasm' : null;
    const actualMime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (mime && (typeof mime === 'string' ? actualMime !== mime : !mime.test(actualMime))) {
      throw new Error(`Incorrect published content type: ${file}`);
    }
    const expected = await readFile(join(root, file));
    const actual = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length;
      if (bytes > expected.length) throw new Error(`Published asset differs from build: ${file}`);
      actual.update(chunk);
    }
    if (bytes !== expected.length || actual.digest('hex') !== createHash('sha256').update(expected).digest('hex')) {
      throw new Error(`Published asset differs from build: ${file}`);
    }
  }
}

/** Capture before building and compare after: a later commit must not label earlier bytes. */
export function buildRevision(source, hostingRoot) {
  if (git(source, 'status', '--porcelain', '--', '.', ':!tsconfig.tsbuildinfo') ||
      git(hostingRoot, 'status', '--porcelain')) throw new Error('Build requires clean source inputs and hosting checkout');
  return { sourceCommit: git(source, 'rev-parse', 'HEAD'), hostingCommit: git(hostingRoot, 'rev-parse', 'HEAD') };
}

export function assertSameRevision(before, after) {
  if (before.sourceCommit !== after.sourceCommit || before.hostingCommit !== after.hostingCommit) {
    throw new Error('Source revision changed during build; rebuild from a stable checkout');
  }
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
