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
    for (const file of ['evidence.json', 'native-registration-evidence.json', 'walkthrough.mp4', 'logo.webp', 'Pretendard-Regular.woff2',
      'deletion.html', 'deletion-checks.json', 'native-deletion-evidence.json', 'walkthrough-with-deletion.mp4']) {
      assert.ok((await stat(join(dir, file))).size > 0, `Public review file missing: ${file}`);
    }
    assert.match(html, /href="native-registration-evidence.json"/);
    const native = JSON.parse(await readFile(join(dir, 'native-registration-evidence.json'), 'utf8'));
    assert.equal(native.registration.stage, 'registered');
    assert.equal(native.sourcePackage.assetCount, 11);
    assert.equal(native.sourcePackage.newGeneration, false);
    assert.match(html, /review-20261025/);
    const supplement = join(root, 'cloud-plugin/review-20261025');
    for (const file of ['index.html', 'index.ko.html', 'style.css', 'reviewer-sample.zip',
      'walkthrough.mp4', 'walkthrough.en.vtt', 'walkthrough.ko.vtt', 'poster.png', 'video-provenance.json']) {
      assert.ok((await stat(join(supplement, file))).size > 0, `Supplement missing: ${file}`);
    }
    const completed = JSON.parse(await readFile(join(supplement, 'native-registration-evidence.json'), 'utf8'));
    assert.equal(completed.registration.stage, 'registered');
    assert.equal(completed.registration.runtimeApproved, true);
    assert.equal(completed.registration.validation.checkedAssetCount, 11);
    assert.equal(completed.events.filter(e => e.tool === 'upload_fighter_asset' && e.ok).length, 11);
    assert.equal(completed.newGeneration, false);
    for (const [file, expected] of [
      ['privacy.html', ['no scheduled automatic erasure', 'more than 29 days old', 'does not erase files', '10 minutes']],
      ['privacy.ko.html', ['자동 파기 일정이 없습니다', '29일이 지나면 매시간', '파일이 지워지는 것은 아닙니다', '10분']]
    ]) {
      const policy = await readFile(join(root, 'cloud-plugin', file), 'utf8');
      for (const phrase of expected) assert.ok(policy.includes(phrase), `Retention disclosure missing: ${phrase}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
