import Ajv from 'ajv';
import schema from './v1/fighter.schema.json' with { type: 'json' };
import spec from './v1/spec.json' with { type: 'json' };

const checkSchema = new Ajv({ allErrors: true, jsonPointers: true, ownProperties: true,
  coerceTypes: false, useDefaults: false, removeAdditional: false }).compile(schema);
const pointer = text => String(text).replace(/~/g, '~0').replace(/\//g, '~1');
const issue = (code, path, expected, actual) => ({ code, path, expected, actual });

/** Parse before accepting a JSON object: JSON.parse alone silently loses duplicate members. */
export function parseFighterJson(text) {
  if (new TextEncoder().encode(text).byteLength > spec.limits.jsonBytes)
    return { ok: false, errors: [issue('JSON_TOO_LARGE', '', spec.limits.jsonBytes, 'exceeded')] };
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, errors: [issue('INVALID_JSON', '', 'valid JSON', 'syntax error')] }; }
  const stack = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)) {
    const value = token[0], top = stack.at(-1);
    if (value === '{' || value === '[') {
      stack.push(value === '{' ? { keys: new Set(), key: true } : { keys: null });
      if (stack.length > 32) return { ok: false, errors: [issue('JSON_TOO_DEEP', '', 32, stack.length)] };
    } else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && top?.keys) top.key = true;
    else if (value.startsWith('"') && top?.keys && top.key) {
      const key = JSON.parse(value);
      if (top.keys.has(key)) return { ok: false, errors: [issue('DUPLICATE_MEMBER', '', 'unique JSON member names', key)] };
      top.keys.add(key); top.key = false;
    }
  }
  return { ok: true, data };
}

/** Schema + cross references. Does not inspect files and never grants registration. */
export function validateFighter(data) {
  if (!checkSchema(data)) return { ok: false, stage: 'schema', errors: checkSchema.errors.map(error => {
    const key = error.keyword === 'required' ? error.params.missingProperty : error.keyword === 'additionalProperties' ? error.params.additionalProperty : null;
    return issue(`SCHEMA_${error.keyword.toUpperCase()}`, error.dataPath + (key ? `/${pointer(key)}` : ''), error.params, error.message);
  }) };
  const errors = [], assets = new Map(), paths = new Set(), used = new Set();
  const add = (code, path, expected, actual) => errors.push(issue(code, path, expected, actual));
  let bytes = 0, pixels = 0;
  data.assets.forEach((asset, index) => {
    const at = `/assets/${index}`;
    if (assets.has(asset.id)) add('DUPLICATE_ASSET_ID', `${at}/id`, 'unique ID', asset.id);
    if (paths.has(asset.path)) add('DUPLICATE_ASSET_PATH', `${at}/path`, 'unique path', asset.path);
    assets.set(asset.id, asset); paths.add(asset.path);
    bytes += asset.bytes; pixels += asset.width * asset.height;
    if (asset.width * asset.height > spec.limits.imagePixels) add('IMAGE_PIXEL_LIMIT', at, spec.limits.imagePixels, asset.width * asset.height);
  });
  if (bytes > spec.limits.packageAssetBytes) add('PACKAGE_BYTE_LIMIT', '/assets', spec.limits.packageAssetBytes, bytes);
  if (pixels > spec.limits.packagePixels) add('PACKAGE_PIXEL_LIMIT', '/assets', spec.limits.packagePixels, pixels);
  const resolve = (id, path) => {
    used.add(id);
    if (!assets.has(id)) add('ASSET_NOT_FOUND', path, 'declared asset ID', id);
    return assets.get(id);
  };
  for (const name of ['portrait', 'preview']) {
    const view = data.profile[name], asset = resolve(view.assetId, `/profile/${name}/assetId`), c = view.crop;
    if (asset && (c.x + c.width > asset.width || c.y + c.height > asset.height))
      add('CROP_OUT_OF_BOUNDS', `/profile/${name}/crop`, [asset.width, asset.height], c);
  }
  for (const [name, clip] of Object.entries(data.clips)) {
    const at = `/clips/${name}`, asset = resolve(clip.assetId, `${at}/assetId`), count = clip.frames.length;
    if (asset && (asset.width !== clip.columns * clip.frameWidth || asset.height !== clip.rows * clip.frameHeight))
      add('SHEET_GEOMETRY', at, [clip.columns * clip.frameWidth, clip.rows * clip.frameHeight], [asset.width, asset.height]);
    if (count > clip.columns * clip.rows || clip.frames.some((frame, index) => frame !== index))
      add('FRAME_GRID', `${at}/frames`, 'contiguous 0..n-1 inside the sheet', clip.frames);
    if (clip.origins.length !== count) add('ORIGIN_COUNT', `${at}/origins`, count, clip.origins.length);
    clip.origins.forEach((origin, index) => {
      if (origin.originX > clip.frameWidth || origin.originY > clip.frameHeight)
        add('ORIGIN_OUT_OF_BOUNDS', `${at}/origins/${index}`, [clip.frameWidth, clip.frameHeight], origin);
      origin.groundContacts.forEach((c, ci) => {
        if (c.x - c.rx < 0 || c.x + c.rx > clip.frameWidth || c.y - c.ry < 0 || c.y + c.ry > clip.frameHeight)
          add('CONTACT_OUT_OF_BOUNDS', `${at}/origins/${index}/groundContacts/${ci}`, 'ellipse inside frame', c);
      });
    });
    const steps = clip.sequence ?? clip.frames.map(frame => ({ frame, durationMs: clip.durationMs }));
    const totalMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
    if (totalMs > spec.limits.clipDurationMs) add('CLIP_DURATION_LIMIT', at, spec.limits.clipDurationMs, totalMs);
    steps.forEach((step, index) => {
      if (step.frame >= count) add('SEQUENCE_FRAME', `${at}/sequence/${index}/frame`, `0..${count - 1}`, step.frame);
    });
    const indexInRange = (value, path) => {
      if (value >= steps.length) add('SEQUENCE_INDEX', path, `0..${steps.length - 1}`, value);
    };
    const hits = clip.hitSequenceIndices ?? [];
    hits.forEach((hit, index) => {
      indexInRange(hit, `${at}/hitSequenceIndices/${index}`);
      if (hit === 0 || (index > 0 && hit <= hits[index - 1])) add('CONTACT_ORDER', `${at}/hitSequenceIndices/${index}`, 'strictly increasing, after step 0', hit);
    });
    const k = clip.landmarks;
    if (name === 'combo') {
      indexInRange(k.spinStart, `${at}/landmarks/spinStart`);
      // The current skin splits C into three spans around the last three contacts.
      if (!(k.spinStart > hits.at(-3) && k.spinStart <= hits.at(-2) && Math.floor((hits.at(-2) + hits.at(-1)) / 2) > k.spinStart))
        add('COMBO_SEGMENTS', `${at}/landmarks/spinStart`, 'three nonempty ordered contact spans', k.spinStart);
    }
    if (name === 'hit') {
      for (const [key, values] of Object.entries(k)) for (const value of Array.isArray(values) ? values : [values])
        indexInRange(value, `${at}/landmarks/${key}`);
      if (!(k.recoil <= k.stagger[0] && k.stagger[0] <= k.stagger[1] && k.stagger[1] < k.recover[0] && k.recover[0] <= k.recover[1]))
        add('HIT_PHASE_ORDER', `${at}/landmarks`, 'recoil, stagger, recover in order', k);
      if (hits[0] !== k.recoil) add('HIT_RECOIL_CONTACT', `${at}/landmarks/recoil`, hits[0], k.recoil);
    }
    const checkBorrow = (cell, path) => {
      if (cell.frame >= data.clips[cell.clip].frames.length) add('BORROWED_FRAME', path, `frame in ${cell.clip}`, cell.frame);
    };
    if (name === 'dash') for (const phase of ['windup', 'recover']) checkBorrow(k[phase], `${at}/landmarks/${phase}`);
    if (name === 'fall') {
      indexInRange(k.lieSequenceIndex, `${at}/landmarks/lieSequenceIndex`);
      if (k.lieSequenceIndex < hits[0]) add('FALL_PHASE_ORDER', `${at}/landmarks/lieSequenceIndex`, `>= ${hits[0]}`, k.lieSequenceIndex);
      if (steps.at(-1).frame !== steps[k.lieSequenceIndex]?.frame) add('FALL_END_POSE', `${at}/sequence`, 'end in lying pose', steps.at(-1).frame);
      k.getUp.forEach((cell, index) => checkBorrow(cell, `${at}/landmarks/getUp/${index}`));
      const getUpMs = k.getUp.reduce((sum, cell) => sum + cell.durationMs, 0);
      if (getUpMs > spec.limits.clipDurationMs)
        add('GET_UP_DURATION_LIMIT', `${at}/landmarks/getUp`, spec.limits.clipDurationMs, getUpMs);
    }
  }
  for (const [index, asset] of data.assets.entries()) if (!used.has(asset.id)) add('UNUSED_ASSET', `/assets/${index}/id`, 'referenced asset', asset.id);
  return { ok: errors.length === 0, stage: 'references-and-geometry', errors, assetBytes: bytes, decodedPixels: pixels,
    pending: ['bytes-hashes-and-full-decode', 'runtime-preview', 'visual-review', 'server-registration'] };
}

/** A side-only preview adapter for the existing left/right consumers; not a registered world pack. */
export function toSidePreviewPack(data) {
  const result = validateFighter(data);
  if (!result.ok) throw new Error('Invalid AI Fighter authoring data');
  const assets = new Map(data.assets.map(asset => [asset.id, asset]));
  const side = Object.fromEntries(Object.entries(data.clips).map(([name, clip]) => {
    const { assetId, loop, landmarks, ...fields } = clip;
    const asset = assets.get(assetId);
    const keys = name === 'dash' ? { standIns: landmarks }
      : name === 'fall' ? { getUp: landmarks.getUp } : landmarks;
    return [name, { ...fields, key: `ai-fighter-preview-${data.localId}-${name}-${asset.sha256}-${clip.frameWidth}x${clip.frameHeight}`, path: asset.path,
      bodyHeight: data.appearance.bodyHeight, oneShot: !loop, durationMs: clip.durationMs ?? null,
      ...(keys ? { keys } : {}), ...(name === 'fall' ? { lieSequenceIndex: landmarks.lieSequenceIndex } : {}),
      ...(name === 'slam' ? { impactSequenceIndex: clip.hitSequenceIndices[0] } : {}) }];
  }));
  return { schemaVersion: 1, adopted: { look: data.localId, runtimeApproved: false },
    camera: { projection: data.appearance.projection, elevationDegrees: data.appearance.elevationDegrees }, directions: { side } };
}
