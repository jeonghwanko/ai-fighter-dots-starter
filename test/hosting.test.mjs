import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, hosting, verifyArtifact, verifyLiveSite, siteEntries, buildRevision, assertSameRevision, git, waitForJson } from '../scripts/hosting-lib.mjs';
import { createServer } from 'node:http';

test('public artifacts reject changed bytes, private inputs and dirty source metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-artifact-test-'));
  try {
    await mkdir(join(root, '.vite'));
    for (const file of [...siteEntries, 'index.html', '.nojekyll', '.vite/manifest.json']) {
      await writeFile(join(root, file), 'test');
    }
    if (hosting.customDomain) await writeFile(join(root, 'CNAME'), hosting.customDomain + '\n');
    const release = { siteUrl: hosting.siteUrl, buildId: '11111111-1111-4111-8111-111111111111', builtAt: new Date().toISOString(),
      sourceCommit: 'a'.repeat(40), hostingCommit: 'b'.repeat(40), dirty: false, ...await fingerprint(root) };
    await writeFile(join(root, 'deployment.json'), JSON.stringify(release));
    await verifyArtifact(root);
    if (hosting.customDomain) {
      await writeFile(join(root, 'CNAME'), 'wrong.example\n');
      await assert.rejects(verifyArtifact(root), /Custom domain CNAME/);
      await writeFile(join(root, 'CNAME'), hosting.customDomain + '\n');
    }
    await writeFile(join(root, 'deployment.json'), JSON.stringify({ ...release, buildId: undefined }));
    await assert.rejects(verifyArtifact(root), /clean, committed/);
    await writeFile(join(root, 'deployment.json'), JSON.stringify(release));
    const clone = join(root, 'copy');
    await mkdir(clone);
    for (const file of [...siteEntries, 'index.html', '.nojekyll', '.vite', 'deployment.json', ...(hosting.customDomain ? ['CNAME'] : [])]) {
      await cp(join(root, file), join(clone, file), { recursive: true });
    }
    await mkdir(join(clone, '.git'));
    await verifyArtifact(clone, { gitCheckout: true });
    await writeFile(join(clone, 'creator.html'), 'changed during copy');
    await assert.rejects(verifyArtifact(clone, { gitCheckout: true }), /changed after build/);
    await rm(clone, { recursive: true });
    await writeFile(join(root, 'fighter.html'), 'changed');
    await assert.rejects(verifyArtifact(root), /changed after build/);
    await writeFile(join(root, '.env.production'), 'private');
    await assert.rejects(fingerprint(root), /Non-public/);
    await rm(join(root, '.env.production'));
    await writeFile(join(root, 'deployment.json'), JSON.stringify({ ...release, dirty: true }));
    await assert.rejects(verifyArtifact(root), /clean, committed/);
  } finally { await rm(root, { recursive: true }); }
});

test('credentials are rejected in copied JSON, HTML, CSS, and the unhashed deployment marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-secret-test-'));
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString('base64url')}.fakeSignature`;
  try {
    for (const [file, credential] of [
      ['settings.json', 'sb_secret_' + 'a'.repeat(32)],
      ['index.html', 'afw_' + 'a'.repeat(64)],
      ['style.css', '-----BEGIN OPENSSH PRIVATE KEY-----'],
      ['deployment.json', 'https://api.render.com/deploy/srv-test?key=example'],
      ['settings.json', jwt],
      ['settings.json', 'AI_FIGHTER_WAKE_TOKEN = ' + 'b'.repeat(64)],
    ]) {
      await writeFile(join(root, file), '\0' + JSON.stringify({ credential }));
      await assert.rejects(fingerprint(root), error => /Private credential/.test(error.message) && !error.message.includes(credential));
      await rm(join(root, file));
    }
    await mkdir(join(root, '.github'));
    await assert.rejects(fingerprint(root), /Non-public/);
  } finally { await rm(root, { recursive: true }); }
});

test('live checks reject missing or wrong asset bytes even when entry HTML returns 200', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-live-test-'));
  try {
    await mkdir(join(root, '.vite'));
    await mkdir(join(root, 'assets'));
    const manifest = Object.fromEntries(siteEntries.map(page => [page, { file: 'assets/main.js', imports: ['shared'], css: ['assets/main.css'] }]));
    manifest.shared = { file: 'assets/shared.js', dynamicImports: ['lazy'] };
    manifest.lazy = { file: 'assets/lazy.js' };
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(manifest));
    const content = new Map([...siteEntries, 'index.html', 'assets/main.js', 'assets/main.css', 'assets/shared.js', 'assets/lazy.js', ...(hosting.customDomain ? ['CNAME'] : [])].map(path => [path, `content for ${path}`]));
    for (const [path, value] of content) await writeFile(join(root, path), value);
    let broken = false, missing = false, staleHtml = false, wrongMime = false;
    const request = async url => {
      const path = url.pathname.slice(new URL('.', hosting.siteUrl).pathname.length);
      if (missing && path === 'assets/lazy.js') return new Response('missing', { status: 404 });
      const wrong = (broken && path === 'assets/main.js') || (staleHtml && path === 'creator.html');
      const mime = wrongMime ? 'text/plain' : path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript';
      return new Response(wrong ? '<html>wrong version</html>' : content.get(path), { status: 200, headers: { 'content-type': mime } });
    };
    await verifyLiveSite(root, { request });
    broken = true;
    await assert.rejects(verifyLiveSite(root, { request }), /differs from build/);
    broken = false; missing = true;
    await assert.rejects(verifyLiveSite(root, { request }), /unavailable/);
    missing = false; staleHtml = true;
    await assert.rejects(verifyLiveSite(root, { request }), /differs from build/);
    staleHtml = false; wrongMime = true;
    await assert.rejects(verifyLiveSite(root, { request }), /content type/);
  } finally { await rm(root, { recursive: true }); }
});

test('build revisions detect changed inputs and commits while allowing unrelated repo files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-revision-test-'));
  try {
    const sourceRepo = join(root, 'source'), builder = join(root, 'builder');
    for (const dir of [sourceRepo, builder]) {
      await mkdir(dir);
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.name', 'Test');
      git(dir, 'config', 'user.email', 'test@example.invalid');
      await writeFile(join(dir, 'README'), 'fixture');
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'fixture');
    }
    const source = join(sourceRepo, 'kaito_web');
    await mkdir(source);
    await writeFile(join(source, 'tsconfig.json'), '{}');
    git(sourceRepo, 'add', '.'); git(sourceRepo, 'commit', '-qm', 'source config');
    const initial = buildRevision(source, builder);
    await writeFile(join(sourceRepo, 'unrelated.txt'), 'unrelated');
    await writeFile(join(source, 'tsconfig.tsbuildinfo'), 'generated');
    assert.deepEqual(buildRevision(source, builder), initial);
    await writeFile(join(source, 'tsconfig.json'), '{"compilerOptions":{}}');
    assert.throws(() => buildRevision(source, builder), /clean source/);
    git(sourceRepo, 'add', 'kaito_web/tsconfig.json'); git(sourceRepo, 'commit', '-qm', 'changed config');
    assert.throws(() => assertSameRevision(initial, buildRevision(source, builder)), /revision changed/);
  } finally { await rm(root, { recursive: true }); }
});

test('a healthy old deployment does not count as the requested commit', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, commit: ++calls < 3 ? 'old' : 'new' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await waitForJson(url, body => body.ok && body.commit === 'new', { timeoutMs: 1000, intervalMs: 5 });
    assert.equal(calls, 3);
    await assert.rejects(waitForJson(url, body => body.commit === 'missing', { timeoutMs: 30, intervalMs: 5 }), /not confirmed/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
