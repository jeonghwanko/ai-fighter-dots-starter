import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { alphaBounds, walkPlan, sequenceHash, inspectGeometry, combineReview, requireReview, commonGameRequest, loadSequence, loopReview, requireLoopReview } from '../tools/ai-fighter/gait.mjs';
import { preview } from '../scripts/gait.mjs';

function frame(bottom = 70, mark = 0, height = 80) {
  const width = 64, data = Buffer.alloc(width * height * 4);
  for (let y = 10; y < bottom; y++) for (let x = 20; x < 40; x++) {
    const at = (y * width + x) * 4;
    data[at] = 100 + mark; data[at + 3] = 255;
  }
  return { width, height, data };
}
function sequence() {
  const value = { frames: Array.from({ length: 16 }, (_, i) => frame(70, i)), durations: Array(16).fill(100) };
  value.sha256 = sequenceHash(value); return value;
}
function plan() {
  const value = walkPlan(); value.geometry = { width: 64, height: 80, groundY: 70, groundTolerance: 2 }; return value;
}
function annotations(seq) {
  return { sequenceSha256: seq.sha256, visual: { identity: 'pass', anatomy: 'pass', alternation: 'pass', loop: 'pass' },
    stances: [{ foot: 'near', start: 1, end: 3, box: [10, 60, 40, 10] }, { foot: 'far', start: 9, end: 11, box: [10, 60, 40, 10] }] };
}
const reports = () => [0, 1].map(() => ({ stride_verified: true, foot_velocity_px_per_second: -10 }));

test('the alternating 17 px baseline regression is caught before packaging', () => {
  const seq = sequence(); seq.frames[1] = frame(53, 1); seq.sha256 = sequenceHash(seq);
  const report = combineReview(seq, plan(), null);
  assert.equal(report.status, 'fail');
  assert.ok(report.errors.some(e => e.code === 'GROUND_OFFSET' && e.frame === 1 && e.measured === 53));
  assert.equal(report.stridePixels, null);
});
test('a clean silhouette and visual pass cannot replace two measured same-foot stances', () => {
  const seq = sequence(), a = annotations(seq);
  assert.equal(combineReview(seq, plan(), null).status, 'unverified');
  assert.equal(combineReview(seq, plan(), a).status, 'unverified');
  a.stances.pop();
  assert.equal(combineReview(seq, plan(), a, reports().slice(0, 1)).status, 'unverified');
});
test('speed is converted from px/s to px/cycle; disagreeing or forward-moving feet fail', () => {
  const seq = sequence(), a = annotations(seq);
  const valid = combineReview(seq, plan(), a, reports());
  assert.equal(valid.status, 'pass'); assert.equal(valid.durationSeconds, 1.6); assert.equal(valid.stridePixels, 16);
  const different = reports(); different[1].foot_velocity_px_per_second = -30;
  assert.equal(combineReview(seq, plan(), a, different).status, 'fail');
  const forward = reports(); forward[0].foot_velocity_px_per_second = 10;
  assert.equal(combineReview(seq, plan(), a, forward).status, 'fail');
});
test('evidence expires after a pixel or timing change and cannot be reused for another motion', () => {
  const seq = sequence(), report = combineReview(seq, plan(), annotations(seq), reports());
  assert.equal(requireReview(report, seq, 'walk'), report);
  seq.durations[0] = 101;
  assert.throws(() => requireReview(report, seq, 'walk'), /STALE/);
  seq.durations[0] = 100; seq.frames[0].data[0] = 1;
  assert.throws(() => requireReview(report, seq, 'walk'), /STALE/);
  assert.throws(() => requireReview(report, seq, 'run'), /REQUIRED/);
});
test('unknown visual anatomy and mismatched support phases are not passed', () => {
  const seq = sequence(), a = annotations(seq);
  a.visual.anatomy = 'unverified';
  assert.equal(combineReview(seq, plan(), a, reports()).status, 'unverified');
  a.stances[0].start = 9; a.stances[0].end = 11;
  assert.equal(combineReview(seq, plan(), a, reports()).status, 'fail');
});
test('a repeated pixel frame cannot pass as an extra drawing', () => {
  const seq = sequence(); seq.frames[1] = seq.frames[0];
  assert.ok(inspectGeometry(seq, plan()).errors.some(e => e.code === 'DUPLICATE_FRAME'));
});
async function temporary(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gait-review-'));
  try { return await fn(dir); } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
}
async function manifest(dir, name, value) {
  await sharp(value.data, { raw: { width: value.width, height: value.height, channels: 4 } }).png().toFile(path.join(dir, name + '.png'));
  const data = { sprite_sheet_alpha: name + '.png', frame_layout: { rows: { idle: [{ x: 0, y: 0, w: value.width, h: value.height }] } }, animation: { rows: { idle: { durations_ms: [100] } } } };
  await writeFile(path.join(dir, name + '.json'), JSON.stringify(data));
  return { file: name + '.json', state: 'idle' };
}
test('a crouched pose uses the neutral reference scale instead of being inflated to standing height', async () => temporary(async dir => {
  const reference = await manifest(dir, 'standing', frame(70)), crouch = await manifest(dir, 'crouch', frame(40));
  const value = await commonGameRequest({ reference, assets: [{ id: 'idle', source: reference }, { id: 'crouch', source: crouch }] }, dir);
  assert.equal(value.referenceBodyHeight, 60);
  assert.deepEqual(value.request.assets.map(a => a.source_body_height), [60, 60]);
  const mismatch = await manifest(dir, 'different-canvas', frame(40, 0, 81));
  await assert.rejects(commonGameRequest({ reference, assets: [{ id: 'wrong', source: mismatch }] }, dir), /Coordinate space/);
  assert.equal(alphaBounds((await loadSequence(crouch, dir)).frames[0]).bottom, 40);
}));
test('failed review still creates a self-contained preview and escapes annotation text', async () => temporary(async dir => {
  const seq = sequence(), a = annotations(seq); a.visual.anatomy = 'fail'; a.visual.notes = '</script><script>unexpected()</script>';
  const report = combineReview(seq, plan(), a, reports());
  await preview(seq, plan(), report, dir);
  const html = await readFile(path.join(dir, 'preview.html'), 'utf8');
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(!html.includes('</script><script>unexpected()'));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok((await readFile(path.join(dir, 'contact-sheet.png'))).length > 100);
}));

test('a game-pack sequence decodes each sheet once and keeps the exact per-cell pixels', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gait-decode-'));
  try {
    // RGB (alpha added by ensureAlpha) and RGBA pages, cells in a 3x2 grid, one cell reused across both animations.
    const pixels = (w, h, channels, seed) => Buffer.from(Array.from({ length: w * h * channels }, (_, i) => (i * 37 + seed * 11) % 251));
    await sharp(pixels(96, 64, 3, 1), { raw: { width: 96, height: 64, channels: 3 } }).png().toFile(path.join(dir, 'rgb.png'));
    await sharp(pixels(96, 64, 4, 2), { raw: { width: 96, height: 64, channels: 4 } }).png().toFile(path.join(dir, 'rgba.png'));
    const frames = (prefix, image) => Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${prefix}/${i}`, { frame: { x: i % 3 * 32, y: Math.floor(i / 3) * 32, w: 32, h: 32 },
      rotated: false, trimmed: false }]));
    const pack = { kind: 'sprite-gen-game-pack', version: 1, textures: [{ image: 'rgb.png', frames: frames('a', 'rgb.png') }, { image: 'rgba.png', frames: frames('b', 'rgba.png') }],
      animations: { mix: { frames: ['a/0', 'b/1', 'a/5', 'b/4', 'a/0'], durations_ms: [90, 90, 90, 90, 90] } } };
    await writeFile(path.join(dir, 'game-pack.json'), JSON.stringify(pack));
    const sequence = await loadSequence({ file: 'game-pack.json', animation: 'mix' }, dir);
    for (const [index, key] of pack.animations.mix.frames.entries()) {
      const texture = pack.textures.find(t => t.frames[key]), cell = texture.frames[key].frame;
      const expected = await sharp(path.join(dir, texture.image)).extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h }).ensureAlpha().raw().toBuffer();
      assert.ok(sequence.frames[index].data.equals(expected), `frame ${index} (${key})`);
      assert.deepEqual([sequence.frames[index].width, sequence.frames[index].height], [32, 32]);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a loop review fails on an engine retake reason, a failing verdict or an unmeasured walk stride, and binds to the frames', () => {
  const seq = sequence(), verdicts = { identity: 'pass', anatomy: 'pass', alternation: 'pass', loop: 'pass', notes: 'Clean loop.' };
  const pass = loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: { from: 27 } }, visual: verdicts, judge: 'test', stridePixels: 90 });
  assert.equal(pass.status, 'pass');
  assert.equal(requireLoopReview(pass, seq, 'walk'), pass);
  const retake = loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: { retake: { reason: 'broken-beat', reasons: ['broken-beat'] } } },
    visual: verdicts, judge: 'test', stridePixels: 90 });
  assert.deepEqual(retake.errors.map(e => e.code), ['ENGINE_RETAKE']);
  const judged = loopReview({ motion: 'walk', sequence: seq, strip: {}, visual: { ...verdicts, alternation: 'fail' }, judge: 'test' });
  assert.deepEqual(judged.errors.map(e => e.code), ['VISUAL_ALTERNATION', 'STRIDE_UNMEASURED']);
  assert.throws(() => requireLoopReview(judged, seq, 'walk'), /LOOP_REVIEW_REQUIRED/);
  const changed = { ...seq, durations: seq.durations.map((ms, i) => i ? ms : ms + 1) };
  assert.throws(() => requireLoopReview(pass, changed, 'walk'), /LOOP_REVIEW_STALE/);
});
