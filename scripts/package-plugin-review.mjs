// Package only the deliberate review deliverables, never local runs or approval correspondence.
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(process.argv[2] || 'output/plugin-review-20261022');
const site = path.join(root, 'site');
const evidence = JSON.parse(await readFile(path.join(site, 'evidence.json'), 'utf8'));
assert.equal(evidence.status, 'passed'); assert.equal(evidence.steps.length, 9);
assert.ok(evidence.steps.every(s => s.status === 'passed'));
const evidenceText = await readFile(path.join(site, 'evidence.json'), 'utf8');
assert.ok(!evidenceText.includes('turbo08'), 'Private home/account identifier in the tool evidence');
const allowedPages = ['index.html', 'privacy.html', 'terms.html', 'support.html', 'privacy.ko.html', 'terms.ko.html'];
const files = ['site/review.html','site/review-console.html','site/evidence.json','site/walkthrough.mp4',
  'site/walkthrough.en.vtt','site/walkthrough.ko.vtt','site/poster.jpg',
  ...allowedPages.map(file=>'site/ai-fighter-creator/'+file), 'site/ai-fighter-creator/style.css',
  'site/ai-fighter-creator/icon.svg','video-provenance.json','README.txt'];
for (const file of ['review.html', ...allowedPages.map(p => 'ai-fighter-creator/' + p)]) {
  const text = await readFile(path.join(site, file), 'utf8');
  assert.ok(text.includes('Lucas Foundation'));
  assert.ok(!text.includes('Supervillain'));
  for (const match of text.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
    const href = match[1].split('#')[0];
    if (/^[a-z]+:/i.test(href)) continue;
    assert.ok((await stat(path.resolve(site, path.dirname(file), href))).isFile(), `Missing ${file}: ${href}`);
  }
}
await writeFile(path.join(root, 'README.txt'), `AI Fighter Creator — review preparation\nPublisher: Lucas Foundation\nPrepared: 2026-10-22\n\nOpen site/review.html for policy pages and the actual functional demo.\nThe MP4 is 1280x720 H.264, approximately 94 seconds, silent with English and Korean caption files.\nThe recording shows a reviewer console for real MCP calls, not the Codex conversation UI.\nNine tool-level checks passed on installed portable release 0.2.0.\nNo generation, visual approval, login or registration was performed.\n\nPublication is pending. The pages are prepared policy previews, not a legal compliance certification.\nThe complete conversational creation/revision/registration walkthrough and the official reviewer scenarios remain outstanding.\nNo credentials are included. Structured evidence uses synthetic review inputs and redacted local path prefixes.\nPrivate-run folders and approval correspondence are intentionally excluded.\n\nThe separate source memo docs/PLUGIN-POLICY-AND-VIDEO.md records the facts checked and remaining publication details.\n`);
const inventory = {};
for (const file of files) {
  const bytes = await readFile(path.join(root, file));
  inventory[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(path.join(root, 'bundle-inventory.json'), JSON.stringify({ preparedAt: new Date().toISOString(), published: false, files: inventory }, null, 2));
const packed = spawnSync('python', ['-c', `import sys,json,zipfile,pathlib,hashlib
root=pathlib.Path(sys.argv[1])
manifest=json.loads((root/'bundle-inventory.json').read_text(encoding='utf-8'))
files=list(manifest['files'])+['bundle-inventory.json']
with zipfile.ZipFile(root/'ai-fighter-review-materials-20261022.zip','w',zipfile.ZIP_DEFLATED) as archive:
 for name in files: archive.write(root/name,name)
with zipfile.ZipFile(root/'ai-fighter-review-materials-20261022.zip') as archive:
 assert set(archive.namelist())==set(files)
 for name,info in manifest['files'].items(): assert hashlib.sha256(archive.read(name)).hexdigest()==info['sha256']
`, root], { encoding: 'utf8' });
if (packed.status !== 0) throw Error(packed.stderr || 'Review archive failed');
console.log(JSON.stringify({ ok: true, policyPages: allowedPages.length, functionalChecks: evidence.steps.length,
  archive: path.join(root, 'ai-fighter-review-materials-20261022.zip'), files: files.length + 1, published: false }));
