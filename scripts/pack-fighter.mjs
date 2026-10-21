// Build an AI Fighter package from a `sprite-gen game-pack` output. Deterministic: the same pack and plan give the same bytes.
// Pixels decide what they can measure: body scale, ground line, ground contacts, frame identity and the walk stride.
// The plan decides what pixels cannot: which animation is which motion, contact steps and landmarks.
// Never overwrites a folder. Writes nothing unless the whole package passes the contract.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
import { requireReview } from '../tools/ai-fighter/gait.mjs';

const BODY = spec.input.bodyHeight;
const ALPHA = 32;              // measurement threshold: ignores faint anti-aliasing and soft shadows
const MARGIN = 8;              // transparent pixels kept around the motion's union box
const SCALE_TOLERANCE = 0.02;  // a game pack within 2% of the body height is used without resampling
const MAX_COLUMNS = 8, MAX_SHEET = spec.limits.imageDimension, MAX_FRAME = 1024;
const MOTIONS = Object.keys(spec.motions);
const assetId = name => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const round = value => Math.round(value * 100) / 100;

const crop = z.strictObject({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) });
const motionPlan = z.strictObject({
  animation: z.string().min(1),
  frame: z.number().int().min(0).optional(),
  flipX: z.boolean().optional(),
  origin: z.strictObject({ x: z.number(), y: z.number() }).optional(),
  stridePixels: z.number().positive().optional(),
  gaitReview: z.string().min(1).optional(),
  hitSequenceIndices: z.array(z.number().int().min(0)).optional(),
  landmarks: z.record(z.string(), z.unknown()).optional(),
});
const planSchema = z.strictObject({
  gamePack: z.string().min(1), out: z.string().min(1), localId: z.string(),
  profile: z.strictObject({ name: z.string(), description: z.string(), portraitCrop: crop.optional(), previewCrop: crop.optional() }),
  encoding: z.enum(['lossless', 'lossy']).default('lossless'),
  quality: z.number().int().min(1).max(100).default(92),
  resample: z.enum(['lanczos3', 'nearest']).default('lanczos3'),
  reviewPolicy: z.enum(['required', 'format-only']).default('required'),
  motions: z.strictObject(Object.fromEntries(MOTIONS.map(name => [name, motionPlan]))),
});

class PackError extends Error {
  constructor(code, detail) { super(code); this.detail = detail; }
}
const fail = (code, detail) => { throw new PackError(code, detail); };

/** An RGBA frame. */
const frameOf = (width, height, data = Buffer.alloc(width * height * 4)) => ({ width, height, data });
function extract(page, rect) {
  const frame = frameOf(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++)
    page.data.copy(frame.data, y * rect.w * 4, ((rect.y + y) * page.width + rect.x) * 4, ((rect.y + y) * page.width + rect.x + rect.w) * 4);
  return frame;
}
function mirror(frame) {
  const out = frameOf(frame.width, frame.height);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++)
    frame.data.copy(out.data, (y * frame.width + frame.width - 1 - x) * 4, (y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4);
  return out;
}
async function resize(frame, ratio, kernel) {
  const width = Math.max(1, Math.round(frame.width * ratio)), height = Math.max(1, Math.round(frame.height * ratio));
  const data = await sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .resize(width, height, { kernel, fit: 'fill' }).ensureAlpha().raw().toBuffer();
  return frameOf(width, height, data);
}
const alphaAt = (frame, x, y) => frame.data[(y * frame.width + x) * 4 + 3];
/** Opaque bounds as half-open rows/columns, or null for an empty frame. */
function bounds(frame, threshold) {
  let left = frame.width, top = frame.height, right = 0, bottom = 0;
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) if (alphaAt(frame, x, y) >= threshold) {
    if (x < left) left = x; if (x + 1 > right) right = x + 1; if (y < top) top = y; if (y + 1 > bottom) bottom = y + 1;
  }
  return right > left ? { left, top, right, bottom } : null;
}
/** Feet on the ground line: up to two runs of opaque columns in a thin band above it. */
function measureContacts(frame, groundY) {
  const band = Math.max(2, Math.round(BODY * 0.02)), gap = Math.max(2, Math.round(BODY * 0.015)), minimum = Math.max(2, Math.round(BODY * 0.01));
  const runs = [];
  for (let x = 0; x < frame.width; x++) {
    let ink = false;
    for (let y = Math.max(0, groundY - band); y < groundY && !ink; y++) ink = alphaAt(frame, x, y) >= ALPHA;
    if (!ink) continue;
    const last = runs.at(-1);
    if (last && x - last.end <= gap) last.end = x + 1; else runs.push({ start: x, end: x + 1 });
  }
  return runs.filter(r => r.end - r.start >= minimum).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 2)
    .sort((a, b) => a.start - b.start)
    .map(r => ({ x: (r.start + r.end) / 2, y: groundY, rx: (r.end - r.start) / 2, ry: band / 2 }));
}
/** Backward travel of planted feet over one walk cycle: the distance the body must move so feet do not slide. */
function measureStride(contacts) {
  const near = BODY * 0.12, steps = [];
  for (let i = 0; i < contacts.length; i++) {
    const from = contacts[i], to = contacts[(i + 1) % contacts.length], backward = [];
    for (const a of from) {
      const b = to.reduce((best, c) => Math.abs(c.x - a.x) < Math.abs((best?.x ?? Infinity) - a.x) ? c : best, null);
      if (b && Math.abs(b.x - a.x) <= near && b.x - a.x < -0.5) backward.push(b.x - a.x);
    }
    steps.push(backward.length ? median(backward) : null);
  }
  const measured = steps.filter(step => step !== null);
  if (measured.length * 2 < steps.length) return null;
  const typical = median(measured);
  return round(-steps.reduce((sum, step) => sum + (step ?? typical), 0));
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function loadPack(file) {
  let pack;
  try { pack = JSON.parse(await readFile(file, 'utf8')); } catch { fail('GAME_PACK_UNREADABLE', file); }
  if (pack?.kind !== 'sprite-gen-game-pack' || ![1, 2].includes(pack.version) || !Array.isArray(pack.textures) || !pack.animations)
    fail('GAME_PACK_FORMAT', 'expected sprite-gen game-pack.json version 1 or 2');
  const directory = path.dirname(file), frames = new Map(), pages = new Map();
  pack.textures.forEach((texture, page) => {
    for (const [key, entry] of Object.entries(texture.frames ?? {})) {
      if (entry.rotated || entry.trimmed) fail('GAME_PACK_FRAME', `${key}: rotated or trimmed frames are not supported`);
      frames.set(key, { page, rect: entry.frame });
    }
  });
  const page = async index => {
    if (!pages.has(index)) {
      const image = path.resolve(directory, pack.textures[index].image);
      const { data, info } = await sharp(image, { limitInputPixels: MAX_SHEET * MAX_SHEET }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      pages.set(index, { width: info.width, height: info.height, data });
    }
    return pages.get(index);
  };
  // Decoded pages are only needed while frames are cut out; release them before packing.
  return { pack, frames, page, release: () => pages.clear() };
}

/** Frames of one animation in playback order, and its durations, at the game pack's scale. */
async function readAnimation(source, name, motion) {
  const animation = source.pack.animations[motion.animation];
  if (!animation) fail('ANIMATION_NOT_FOUND', `${name}: ${motion.animation}`);
  if (!Array.isArray(animation.frames) || !animation.frames.length || animation.durations_ms?.length !== animation.frames.length)
    fail('GAME_PACK_ANIMATION', `${name}: frames and durations_ms must match`);
  const frames = [];
  for (const key of animation.frames) {
    const location = source.frames.get(key);
    if (!location) fail('GAME_PACK_FRAME', `${name}: missing frame ${key}`);
    const page = await source.page(location.page), r = location.rect;
    if (r.x < 0 || r.y < 0 || r.x + r.w > page.width || r.y + r.h > page.height) fail('GAME_PACK_FRAME', `${name}: ${key} outside its page`);
    const frame = extract(page, r);
    frames.push(motion.flipX ? mirror(frame) : frame);
  }
  if (frames.some(f => f.width !== frames[0].width || f.height !== frames[0].height)) fail('GAME_PACK_FRAME', `${name}: frames differ in size`);
  const [ax, ay] = Array.isArray(animation.anchor) ? animation.anchor : [frames[0].width / 2, frames[0].height];
  return { keys: animation.frames, frames, durations: animation.durations_ms.map(ms => Math.max(1, Math.round(ms))), anchor: { x: motion.flipX ? frames[0].width - ax : ax, y: ay },
    loop: animation.loop, events: animation.events ?? [] };
}

function checkPlanFields(name, motion) {
  const kind = spec.motions[name].kind;
  const misplaced = [
    name !== 'idle' && motion.frame !== undefined && 'frame',
    name !== 'walk' && motion.stridePixels !== undefined && 'stridePixels',
    !['walk', 'run'].includes(name) && motion.gaitReview !== undefined && 'gaitReview',
    kind === 'gait' && motion.hitSequenceIndices !== undefined && 'hitSequenceIndices',
    kind === 'gait' && motion.landmarks !== undefined && 'landmarks',
  ].filter(Boolean);
  if (misplaced.length) fail('PLAN_FIELD', `${name}: ${misplaced.join(', ')} not used by this motion`);
}

function encode(sheet, plan) {
  const image = sharp(sheet.data, { raw: { width: sheet.width, height: sheet.height, channels: 4 } });
  return (plan.encoding === 'lossless' ? image.webp({ lossless: true, effort: 6 })
    : image.webp({ quality: plan.quality, alphaQuality: 100, effort: 6 })).toBuffer();
}

/** Pack one motion: dedupe by pixels, crop to the union box, measure origins and contacts, lay out the sheet. */
async function packMotion(name, motion, animation, plan) {
  const motionSpec = spec.motions[name];
  let playback = animation.frames.map((frame, step) => ({ frame, durationMs: animation.durations[step], key: animation.keys[step] }));
  if (name === 'idle') {
    const index = motion.frame ?? 0;
    if (index >= playback.length) fail('PLAN_FIELD', `idle: frame ${index} outside ${playback.length} playback steps`);
    playback = [playback[index]];
  }
  const unique = [], identity = new Map(), steps = [];
  for (const step of playback) {
    const hash = createHash('sha256').update(step.frame.data).digest('hex');
    if (!identity.has(hash)) { identity.set(hash, unique.length); unique.push({ frame: step.frame, key: step.key }); }
    steps.push({ frame: identity.get(hash), durationMs: step.durationMs });
  }
  if (motionSpec.kind === 'gait') {
    if (unique.length !== (motionSpec.frames ?? 1) || steps.some((step, index) => step.frame !== index))
      fail('GAIT_FRAMES', `${name}: needs ${motionSpec.frames} distinct frames played once in order; found ${unique.length} distinct in ${steps.length} steps`);
    if (new Set(steps.map(step => step.durationMs)).size !== 1) fail('GAIT_TIMING', `${name}: every gait frame needs the same duration`);
  }
  let groundY = 0, union = null;
  for (const { frame } of unique) {
    const solid = bounds(frame, ALPHA), any = bounds(frame, 1);
    if (!solid) fail('EMPTY_FRAME', `${name}: a frame has no visible pixels`);
    groundY = Math.max(groundY, solid.bottom);
    union = union ? { left: Math.min(union.left, any.left), top: Math.min(union.top, any.top), right: Math.max(union.right, any.right), bottom: Math.max(union.bottom, any.bottom) } : any;
  }
  const origin = { x: motion.origin?.x ?? animation.anchor.x, y: animation.gaitReview?.geometry.groundY ?? motion.origin?.y ?? groundY };
  const { width: canvasWidth, height: canvasHeight } = unique[0].frame;
  // The box may extend past the source canvas: feet drawn on its bottom edge still get room for contact ellipses.
  const box = { left: Math.min(union.left, Math.floor(origin.x)) - MARGIN, top: union.top - MARGIN,
    right: Math.max(union.right, Math.ceil(origin.x)) + MARGIN, bottom: Math.max(union.bottom, Math.ceil(origin.y)) + MARGIN };
  const frameWidth = box.right - box.left, frameHeight = box.bottom - box.top;
  if (frameWidth > MAX_FRAME || frameHeight > MAX_FRAME) fail('FRAME_TOO_LARGE', `${name}: ${frameWidth}x${frameHeight} exceeds ${MAX_FRAME}`);
  const columns = Math.min(MAX_COLUMNS, unique.length, Math.floor(MAX_SHEET / frameWidth)), rows = Math.ceil(unique.length / columns);
  if (rows > MAX_COLUMNS || rows * frameHeight > MAX_SHEET) fail('SHEET_TOO_LARGE', `${name}: ${unique.length} frames of ${frameWidth}x${frameHeight} do not fit ${MAX_SHEET}px in ${MAX_COLUMNS} rows`);
  const sheet = frameOf(columns * frameWidth, rows * frameHeight), contacts = [];
  unique.forEach(({ frame }, index) => {
    const left = index % columns * frameWidth, top = Math.floor(index / columns) * frameHeight;
    const fromX = Math.max(0, box.left), toX = Math.min(canvasWidth, box.right);
    for (let y = 0; y < frameHeight; y++) {
      const sourceY = box.top + y;
      if (sourceY < 0 || sourceY >= canvasHeight) continue;
      frame.data.copy(sheet.data, ((top + y) * sheet.width + left + fromX - box.left) * 4, (sourceY * canvasWidth + fromX) * 4, (sourceY * canvasWidth + toX) * 4);
    }
    contacts.push(measureContacts(frame, Math.round(origin.y)));
  });
  const local = (value, offset) => round(value - offset);
  const origins = contacts.map(list => ({ originX: local(origin.x, box.left), originY: local(origin.y, box.top),
    groundContacts: list.map(c => ({ x: local(c.x, box.left), y: local(c.y, box.top), rx: round(c.rx), ry: round(c.ry) })) }));
  const bytes = await encode(sheet, plan);
  const id = assetId(name);
  const asset = { id, path: `assets/${id}.webp`, mediaType: 'image/webp', sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length, width: sheet.width, height: sheet.height };
  const clip = { assetId: id, frameWidth, frameHeight, columns, rows, frames: unique.map((_, i) => i), origins, loop: motionSpec.loop };
  if (motionSpec.kind === 'gait') {
    clip.durationMs = steps[0].durationMs;
    if (name === 'walk') {
      const measured = measureStride(contacts);
      clip.stridePixels = animation.gaitReview?.stridePixels ?? motion.stridePixels ?? (measured >= 1 ? measured : fail('STRIDE_UNMEASURED', 'walk: no verified stride; review actual same-foot stances'));
    }
  } else {
    clip.sequence = steps;
    clip.hitSequenceIndices = motion.hitSequenceIndices ?? [];
    if (motion.landmarks) clip.landmarks = structuredClone(motion.landmarks);
  }
  const report = { animation: motion.animation, playbackSteps: steps.length, distinctFrames: unique.length, frameSize: [frameWidth, frameHeight],
    origin: { x: round(origin.x), y: round(origin.y), source: motion.origin ? 'plan' : 'anchor-x, measured ground line' },
    contactsPerFrame: contacts.map(list => list.length), frameKeys: unique.map(u => u.key), events: animation.events,
    ...(animation.loop !== undefined && animation.loop !== motionSpec.loop ? { loopOverridden: { gamePack: animation.loop, contract: motionSpec.loop } } : {}),
    ...(animation.gaitReview ? { gaitReview: { status: 'pass', sequenceSha256: animation.gaitReview.sequenceSha256 } } : {}),
    ...(name === 'walk' ? { stride: { used: clip.stridePixels, measured: measureStride(contacts),
      source: animation.gaitReview ? 'same-foot-review' : motion.stridePixels ? 'plan' : 'silhouette-estimate',
      estimateWarning: 'Nearest silhouette matching may exchange feet and fills missing steps with a median; it is not verified contact.' } } : {}) };
  return { asset, bytes, clip, report, sheet, steps };
}

function profileCrops(plan, idle) {
  const { clip, sheet } = idle;
  const preview = plan.profile.previewCrop ?? { x: 0, y: 0, width: clip.frameWidth, height: clip.frameHeight };
  if (plan.profile.portraitCrop) return { portrait: plan.profile.portraitCrop, preview };
  // Head square: the top of the body, centered on the top band's opaque pixels.
  const solid = bounds(sheet, ALPHA), size = Math.min(clip.frameWidth, clip.frameHeight, Math.round(BODY * 0.3));
  let sum = 0, count = 0;
  for (let y = solid.top; y < Math.min(solid.bottom, solid.top + Math.round(BODY * 0.15)); y++)
    for (let x = solid.left; x < solid.right; x++) if (alphaAt(sheet, x, y) >= ALPHA) { sum += x; count++; }
  const x = Math.min(clip.frameWidth - size, Math.max(0, Math.round(sum / count - size / 2)));
  const y = Math.min(clip.frameHeight - size, Math.max(0, solid.top - Math.round(BODY * 0.02)));
  return { portrait: { x, y, width: size, height: size }, preview };
}

/** Returns { ok, stage, out?, errors?, report? }. */
export async function packFighter(planFile) {
  let plan;
  try {
    const parsed = planSchema.safeParse(JSON.parse(await readFile(planFile, 'utf8')));
    if (!parsed.success) return { ok: false, stage: 'plan', errors: parsed.error.issues.map(i => ({ code: 'PLAN_SCHEMA', path: `/${i.path.join('/')}`, message: i.message })) };
    plan = parsed.data;
  } catch { return { ok: false, stage: 'plan', errors: [{ code: 'PLAN_UNREADABLE', path: '' }] }; }
  const base = path.dirname(path.resolve(planFile)), out = path.resolve(base, plan.out), gamePack = path.resolve(base, plan.gamePack);
  try {
    if (await lstat(out).then(() => true, () => false)) fail('OUT_EXISTS', `${out} exists; choose a new folder`);
    for (const [name, motion] of Object.entries(plan.motions)) checkPlanFields(name, motion);
    const source = await loadPack(gamePack);
    const animations = {};
    for (const name of MOTIONS) animations[name] = await readAnimation(source, name, plan.motions[name]);
    source.release();
    for (const name of ['walk', 'run']) {
      const motion = plan.motions[name];
      if (plan.reviewPolicy === 'required' || motion.gaitReview) {
        if (!motion.gaitReview) fail('GAIT_REVIEW_REQUIRED', `${name}: run fighter:gait review on the final game-pack animation first`);
        let review;
        try {
          review = requireReview(JSON.parse(await readFile(path.resolve(base, motion.gaitReview), 'utf8')), animations[name], name);
        } catch (error) { fail(error.message.startsWith('GAIT_') ? error.message.split(':')[0] : 'GAIT_REVIEW_UNREADABLE', `${name}: ${error.message}`); }
        if (motion.stridePixels !== undefined) fail('GAIT_STRIDE_OVERRIDE', `${name}: remove stridePixels; the verified report supplies it`);
        if (motion.origin && motion.origin.y !== review.geometry.groundY) fail('GAIT_ORIGIN_MISMATCH', `${name}: origin must use the reviewed ground line`);
        animations[name].gaitReview = structuredClone(review);
      }
    }
    // One scale for every motion, from the idle body: the game draws a sprite at actor height / bodyHeight.
    const idleFrame = animations.idle.frames[plan.motions.idle.frame ?? 0];
    if (!idleFrame) fail('PLAN_FIELD', 'idle: frame outside its animation');
    const body = bounds(idleFrame, ALPHA) ?? fail('EMPTY_FRAME', 'idle: no visible pixels');
    const measured = body.bottom - body.top, ratio = BODY / measured, resized = Math.abs(ratio - 1) > SCALE_TOLERANCE;
    if (resized) for (const name of MOTIONS) {
      const animation = animations[name];
      animation.frames = await Promise.all(animation.frames.map(frame => resize(frame, ratio, plan.resample)));
      animation.anchor = { x: animation.anchor.x * ratio, y: animation.anchor.y * ratio };
      if (plan.motions[name].origin) plan.motions[name].origin = { x: plan.motions[name].origin.x * ratio, y: plan.motions[name].origin.y * ratio };
      if (animation.gaitReview) {
        animation.gaitReview.geometry.groundY *= ratio;
        animation.gaitReview.stridePixels *= ratio;
      }
    }
    const packed = {};
    for (const name of MOTIONS) packed[name] = await packMotion(name, plan.motions[name], animations[name], plan);
    // Borrowed cells may name a playback step ({ clip, step }); deduplication decides its frame index.
    const borrow = (cell, at) => {
      if (!cell || typeof cell !== 'object' || cell.step === undefined) return cell;
      const { step, ...rest } = cell, steps = packed[cell.clip]?.steps;
      if (!steps || cell.frame !== undefined || !Number.isInteger(step) || step < 0 || step >= steps.length)
        fail('PLAN_FIELD', `${at}: step ${step} is not a playback step of ${cell.clip}`);
      return { ...rest, frame: steps[step].frame };
    };
    for (const [name, keys] of [['dash', ['windup', 'recover']], ['fall', ['getUp']]]) {
      const landmarks = packed[name].clip.landmarks;
      if (!landmarks) continue;
      for (const key of keys) landmarks[key] = Array.isArray(landmarks[key])
        ? landmarks[key].map((cell, index) => borrow(cell, `${name}.landmarks.${key}[${index}]`)) : borrow(landmarks[key], `${name}.landmarks.${key}`);
    }
    const crops = profileCrops(plan, packed.idle);
    const fighter = {
      schemaVersion: spec.schemaVersion, specVersion: spec.specVersion, localId: plan.localId,
      profile: { name: plan.profile.name, description: plan.profile.description,
        portrait: { assetId: packed.idle.asset.id, crop: crops.portrait }, preview: { assetId: packed.idle.asset.id, crop: crops.preview } },
      combat: { kitId: 'standard-duel' },
      appearance: { projection: 'orthographic', elevationDegrees: spec.input.cameraElevationDegrees, sourceFacing: 'right', leftFacing: 'mirror', bodyHeight: BODY, bodyScale: 1 },
      assets: MOTIONS.map(name => packed[name].asset),
      clips: Object.fromEntries(MOTIONS.map(name => [name, packed[name].clip])),
    };
    const contract = validateFighter(fighter);
    const report = { generator: 'ai-fighter-dots-starter pack-fighter', gamePackSha256: createHash('sha256').update(await readFile(gamePack)).digest('hex'),
      scale: { measuredBodyHeight: measured, targetBodyHeight: BODY, ratio: round(ratio), resampled: resized ? plan.resample : false },
      motions: Object.fromEntries(MOTIONS.map(name => [name, packed[name].report])),
      reviewPolicy: plan.reviewPolicy,
      review: plan.reviewPolicy === 'format-only' ? 'FORMAT ONLY: gait quality is unverified. This mode is for format fixtures; it is not visual approval.'
        : 'Walk/run evidence matches input pixels and durations. All actions still need visual review; file validation is not universal animation approval.' };
    if (!contract.ok) return { ok: false, stage: contract.stage, errors: contract.errors, report };
    // Stage beside the target, then publish with one rename.
    const staging = path.join(path.dirname(out), `.${path.basename(out)}.pack-${process.pid}`);
    await rm(staging, { recursive: true, force: true });
    try {
      await mkdir(path.join(staging, 'assets'), { recursive: true });
      for (const name of MOTIONS) await writeFile(path.join(staging, packed[name].asset.path), packed[name].bytes, { flag: 'wx' });
      await writeFile(path.join(staging, 'fighter.json'), JSON.stringify(fighter, null, 2) + '\n', { flag: 'wx' });
      await writeFile(path.join(staging, 'pack-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
      if (await lstat(out).then(() => true, () => false)) fail('OUT_EXISTS', `${out} exists; choose a new folder`);
      await rename(staging, out);
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
    const checked = await validateFighterPackage(path.join(out, 'fighter.json'));
    return { ...checked, out, report: path.join(out, 'pack-report.json') };
  } catch (error) {
    if (error instanceof PackError) return { ok: false, stage: 'pack', errors: [{ code: error.message, path: '', detail: error.detail }] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-')) {
    console.error('Usage: npm run fighter:pack -- <plan.json>');
    process.exitCode = 2;
  } else {
    const result = await packFighter(args[0]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
