import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, hosting, verifyArtifact, waitForJson } from '../scripts/hosting-lib.mjs';
import { createServer } from 'node:http';

test('public artifacts reject changed bytes, private inputs and dirty source metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-artifact-test-'));
  try {
    await mkdir(join(root, '.vite'));
    for (const file of ['creator.html', 'fighter.html', 'league.html', 'admin.html', 'index.html', '.nojekyll', '.vite/manifest.json']) {
      await writeFile(join(root, file), 'test');
    }
    const release = { siteUrl: hosting.siteUrl, sourceCommit: 'a'.repeat(40), hostingCommit: 'b'.repeat(40), dirty: false, ...await fingerprint(root) };
    await writeFile(join(root, 'deployment.json'), JSON.stringify(release));
    await verifyArtifact(root);
    await writeFile(join(root, 'fighter.html'), 'changed');
    await assert.rejects(verifyArtifact(root), /changed after build/);
    await writeFile(join(root, '.env.production'), 'private');
    await assert.rejects(fingerprint(root), /Non-public/);
    await rm(join(root, '.env.production'));
    await writeFile(join(root, 'deployment.json'), JSON.stringify({ ...release, dirty: true }));
    await assert.rejects(verifyArtifact(root), /clean, committed/);
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
