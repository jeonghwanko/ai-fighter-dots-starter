import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCloudPluginSite } from '../scripts/build-cloud-plugin-site.mjs';

test('a clean publication preserves submitted review links and completed registration evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-review-publication-'));
  try {
    await buildCloudPluginSite(root);
    const dir = join(root, 'cloud-plugin/review-20261024');
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    for (const file of ['evidence.json', 'native-registration-evidence.json', 'walkthrough.mp4', 'logo.webp', 'Pretendard-Regular.woff2']) {
      assert.ok((await stat(join(dir, file))).size > 0, `Public review file missing: ${file}`);
    }
    assert.match(html, /href="native-registration-evidence.json"/);
    const native = JSON.parse(await readFile(join(dir, 'native-registration-evidence.json'), 'utf8'));
    assert.equal(native.registration.stage, 'registered');
    assert.equal(native.sourcePackage.assetCount, 11);
    assert.equal(native.sourcePackage.newGeneration, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
