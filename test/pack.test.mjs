import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { packFighter } from '../scripts/pack-fighter.mjs';

const fixture = fileURLToPath(new URL('../examples/sparring-bot/', import.meta.url));
let temporary;
before(async () => { temporary = await mkdtemp(path.join(tmpdir(), 'fighter-pack-')); });
after(async () => { await rm(temporary, { recursive: true, force: true }); });

/**
 * A `sprite-gen game-pack` output built from the sample bot: one page per animation, playback order with held
 * steps as separate cells, bottom-center anchors. Each source frame gets a torso mark so distinct frames stay
 * distinct (the sample's sine walk repeats poses).
 */
async function gamePack(name, { scale = 1, repeat, footEdge = false } = {}) {
  const directory = path.join(temporary, name);
  await mkdir(directory);
  const pack = { kind: 'sprite-gen-game-pack', version: 1, textures: [], animations: {} };
  for (const [motion, clip] of Object.entries(example.clips)) {
    const asset = example.assets.find(a => a.id === clip.assetId), sheet = path.join(fixture, asset.path);
    const order = clip.sequence ? clip.sequence.map(s => s.frame) : [...clip.frames];
    if (repeat === motion) order[1] = order[0];
    // footEdge: the canvas ends at the soles (the sample's feet reach row 440 of 512).
    const sourceHeight = footEdge ? 441 : clip.frameHeight;
    const width = Math.round(clip.frameWidth * scale), height = Math.round(sourceHeight * scale), tiles = [], frames = {}, keys = [];
    for (const [step, frame] of order.entries()) {
      const left = frame % clip.columns * clip.frameWidth, top = Math.floor(frame / clip.columns) * clip.frameHeight;
      const { data, info } = await sharp(sheet).extract({ left, top, width: clip.frameWidth, height: sourceHeight })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 226; y < 238; y++) for (let x = 120; x < 132; x++) data[(y * info.width + x) * 4] = 40 + frame * 12;
      const cell = await sharp(data, { raw: info }).resize(width, height).png().toBuffer();
      const key = `${motion}/${String(step).padStart(6, '0')}`, rect = { x: 1 + step * (width + 2), y: 1, w: width, h: height };
      tiles.push({ input: cell, left: rect.x, top: rect.y });
      frames[key] = { frame: rect, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: width, h: height }, sourceSize: { w: width, h: height } };
      keys.push(key);
    }
    const image = `atlas-${pack.textures.length}.png`;
    await sharp({ create: { width: order.length * (width + 2), height: height + 2, channels: 4, background: '#0000' } })
      .composite(tiles).png().toFile(path.join(directory, image));
    pack.textures.push({ image, frames });
    pack.animations[`bot/${motion}`] = { frames: keys, durations_ms: order.map(() => 90), loop: clip.loop, anchor: [width / 2, height],
      size: { w: width, h: height }, events: [] };
  }
  await writeFile(path.join(directory, 'game-pack.json'), JSON.stringify(pack));
  return directory;
}

/** Contact steps and landmarks come from the plan; borrowed cells name playback steps. */
function plan(directory, out, change = () => {}) {
  const motions = {};
  for (const [name, clip] of Object.entries(example.clips)) {
    motions[name] = { animation: `bot/${name}` };
    if (clip.hitSequenceIndices?.length) motions[name].hitSequenceIndices = clip.hitSequenceIndices;
    if (clip.landmarks) motions[name].landmarks = structuredClone(clip.landmarks);
  }
  motions.walk.stridePixels = 90;
  motions.dash.landmarks = { windup: { clip: 'fightIdle', step: 0 }, recover: { clip: 'fightIdle', step: 1 } };
  motions.fall.landmarks.getUp = [{ clip: 'hit', step: 4, durationMs: 90 }, { clip: 'fightIdle', step: 0, durationMs: 90 }];
  const value = { gamePack: 'game-pack.json', out, localId: 'packed-bot',
    profile: { name: 'Packed Bot', description: 'Packed from a sprite-gen game pack fixture.' }, motions };
  change(value);
  return value;
}
async function run(directory, value) {
  const file = path.join(directory, `plan-${value.out}.json`);
  await writeFile(file, JSON.stringify(value));
  return packFighter(file);
}

test('a game pack becomes a package that passes full file validation', async () => {
  const directory = await gamePack('valid');
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.stage, 'bytes-hashes-and-full-decode');
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter', 'fighter.json'), 'utf8'));
  assert.equal(fighter.clips.walk.frames.length, 16); assert.equal(fighter.clips.run.frames.length, 12);
  // A held step reuses its frame, so the fall still ends on the lying pose.
  assert.equal(fighter.clips.fall.frames.length, 4);
  assert.equal(fighter.clips.fall.sequence.at(-1).frame, fighter.clips.fall.sequence[fighter.clips.fall.landmarks.lieSequenceIndex].frame);
  assert.deepEqual(fighter.clips.dash.landmarks.windup, { clip: 'fightIdle', frame: 0 });
  assert.deepEqual(fighter.clips.fall.landmarks.getUp[0], { clip: 'hit', frame: 4, durationMs: 90 });
  // One ground line per motion; standing frames have feet on it.
  const idle = fighter.clips.idle.origins[0];
  assert.equal(idle.groundContacts.length, 2);
  assert.ok(idle.groundContacts.every(c => c.y === idle.originY));
  assert.ok(fighter.clips.walk.origins.every(o => o.originY === fighter.clips.walk.origins[0].originY));
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  assert.equal(report.scale.resampled, false);
  assert.equal(typeof report.motions.walk.stride.measured, 'number');
  assert.equal(report.motions.walk.stride.source, 'plan');
});
test('packing is deterministic, never overwrites and writes nothing for an invalid plan', async () => {
  const directory = await gamePack('repeat-run');
  for (const out of ['first', 'second']) assert.equal((await run(directory, plan(directory, out))).ok, true);
  for (const file of ['fighter.json', ...example.assets.map(a => a.path)])
    assert.ok((await readFile(path.join(directory, 'first', file))).equals(await readFile(path.join(directory, 'second', file))), file);
  const again = await run(directory, plan(directory, 'first'));
  assert.equal(again.errors[0].code, 'OUT_EXISTS');
  const missingHits = await run(directory, plan(directory, 'invalid', value => { delete value.motions.combo.hitSequenceIndices; }));
  assert.equal(missingHits.ok, false);
  assert.ok(missingHits.errors.some(e => e.path === '/clips/combo/hitSequenceIndices'), JSON.stringify(missingHits.errors));
  assert.deepEqual((await readdir(directory)).filter(name => name.includes('invalid')), ['plan-invalid.json']);
});
test('a walk that repeats a frame is refused instead of padded', async () => {
  const directory = await gamePack('repeated-walk', { repeat: 'walk' });
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.errors[0].code, 'GAIT_FRAMES');
});
test('a game pack at the wrong body scale is resampled to the 400 px body', async () => {
  const directory = await gamePack('half', { scale: 0.5 });
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  assert.equal(report.scale.resampled, 'lanczos3');
  assert.ok(Math.abs(report.scale.measuredBodyHeight - 202) <= 3, String(report.scale.measuredBodyHeight));
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter', 'fighter.json'), 'utf8'));
  const idle = fighter.assets.find(a => a.id === 'idle');
  assert.ok(idle.height > 400 && idle.height < 440, String(idle.height));
});
test('plan fields are checked against the motion they belong to', async () => {
  const directory = await gamePack('plan-checks');
  const misplaced = await run(directory, plan(directory, 'a', value => { value.motions.run.stridePixels = 120; }));
  assert.equal(misplaced.errors[0].code, 'PLAN_FIELD');
  const unknown = await run(directory, plan(directory, 'b', value => { value.motions.idle.hp = 999; }));
  assert.equal(unknown.errors[0].code, 'PLAN_SCHEMA');
  const badStep = await run(directory, plan(directory, 'c', value => { value.motions.dash.landmarks.windup.step = 40; }));
  assert.equal(badStep.errors[0].code, 'PLAN_FIELD');
  assert.equal(await stat(path.join(directory, 'a')).then(() => true, () => false), false);
});
test('feet on the canvas edge still get transparent room for their contacts', async () => {
  const directory = await gamePack('foot-edge', { footEdge: true });
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter', 'fighter.json'), 'utf8'));
  const idle = fighter.clips.idle;
  assert.equal(idle.origins[0].groundContacts.length, 2);
  assert.ok(idle.frameHeight - idle.origins[0].originY >= 8);
});
