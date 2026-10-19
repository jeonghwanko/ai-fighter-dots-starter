// Trusted/local Node worker only. sharp must not be imported into Supabase Edge Functions.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';

// Bound the read itself, not only a prior stat. Local files must not be concurrently
// replaced by an untrusted process; this helper is not a hostile-filesystem sandbox.
/** @param {string} file @param {number} maximum */
async function readLimitedFile(file, maximum) {
  if (!(await lstat(file)).isFile()) throw new Error('Regular file required');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error('File limit');
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maximum) throw new Error('File limit');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** @param {string} manifestPath @param {{ metadataOnly?: boolean }} options */
export async function validateFighterPackage(manifestPath, { metadataOnly = false } = {}) {
  /** @param {string} code @param {string} at @param {unknown} expected @param {unknown} actual */
  const fail = (code, at, expected, actual) => ({ code, path: at, expected, actual });
  let root, text;
  try {
    const manifestStat = await lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.size > spec.limits.jsonBytes)
      return { ok: false, stage: 'json', errors: [fail('JSON_FILE_LIMIT', '', spec.limits.jsonBytes, manifestStat.size)] };
    root = await realpath(path.dirname(path.resolve(manifestPath)));
    text = new TextDecoder('utf-8', { fatal: true }).decode(await readLimitedFile(manifestPath, spec.limits.jsonBytes));
  } catch { return { ok: false, stage: 'json', errors: [fail('JSON_READ', '', 'readable UTF-8 file', 'unavailable')] }; }
  const parsed = parseFighterJson(text);
  if (!parsed.ok) return { ...parsed, stage: 'json' };
  const result = validateFighter(parsed.data);
  if (!result.ok || metadataOnly) return result;
  // Schema and cross references have passed; use the checked JSON shape for file access.
  const fighter = /** @type {typeof import('../contracts/ai-fighter/v1/example.fighter.json')} */ (parsed.data);
  const errors = [];
  // Decode serially: the pixel limit bounds one image's RGBA working buffer.
  for (const [index, asset] of fighter.assets.entries()) {
    const at = `/assets/${index}`;
    try {
      if ((await lstat(path.join(root, 'assets'))).isSymbolicLink()) {
        errors.push(fail('ASSET_PATH_ESCAPE', `${at}/path`, 'regular assets directory', asset.path)); continue;
      }
      const file = path.resolve(root, asset.path), physical = await realpath(file);
      const relative = path.relative(root, physical);
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        errors.push(fail('ASSET_PATH_ESCAPE', `${at}/path`, 'file within package', asset.path)); continue;
      }
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size !== asset.bytes || stat.size > spec.limits.assetBytes) {
        errors.push(fail('ASSET_BYTES', `${at}/bytes`, asset.bytes, stat.size)); continue;
      }
      const buffer = await readLimitedFile(file, spec.limits.assetBytes);
      if (buffer.length !== asset.bytes) { errors.push(fail('ASSET_BYTES', `${at}/bytes`, asset.bytes, buffer.length)); continue; }
      const hash = createHash('sha256').update(buffer).digest('hex');
      if (hash !== asset.sha256) { errors.push(fail('ASSET_HASH', `${at}/sha256`, asset.sha256, hash)); continue; }
      // Reject other formats before handing attacker-controlled bytes to any decoder.
      if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        errors.push(fail('ASSET_ENCODING', `${at}/path`, 'WebP RIFF signature', 'different format')); continue;
      }
      const decoder = sharp(buffer, { limitInputPixels: spec.limits.imagePixels, failOn: 'warning' });
      const metadata = await decoder.metadata();
      if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1 || !metadata.hasAlpha) {
        errors.push(fail('ASSET_ENCODING', `${at}/path`, 'static WebP with alpha', metadata.format)); continue;
      }
      if (metadata.width !== asset.width || metadata.height !== asset.height) {
        errors.push(fail('ASSET_DIMENSIONS', at, [asset.width, asset.height], [metadata.width, metadata.height])); continue;
      }
      // Reading only the header is insufficient: fully decode and reject an empty or opaque image.
      const { data: rgba, info } = await decoder.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let visible = false, transparent = false;
      for (let i = 3; i < rgba.length; i += info.channels) { visible ||= rgba[i] > 0; transparent ||= rgba[i] < 255; }
      if (!visible || !transparent) errors.push(fail('ASSET_ALPHA', `${at}/path`, 'visible art and transparent background', { visible, transparent }));
      else for (const [name, clip] of Object.entries(fighter.clips)) {
        if (clip.assetId !== asset.id) continue;
        for (const frame of clip.frames) {
          const left = frame % clip.columns * clip.frameWidth, top = Math.floor(frame / clip.columns) * clip.frameHeight;
          let ink = false;
          for (let y = top; y < top + clip.frameHeight && !ink; y++) for (let x = left; x < left + clip.frameWidth && !ink; x++)
            ink = rgba[(y * info.width + x) * info.channels + 3] > 0;
          if (!ink) errors.push(fail('EMPTY_FRAME', `/clips/${name}/frames/${frame}`, 'visible character pixels', frame));
        }
      }
      for (const name of ['portrait', 'preview']) {
        const view = fighter.profile[/** @type {'portrait' | 'preview'} */ (name)];
        if (view.assetId !== asset.id) continue;
        const c = view.crop;
        let ink = false;
        for (let y = c.y; y < c.y + c.height && !ink; y++) for (let x = c.x; x < c.x + c.width && !ink; x++)
          ink = rgba[(y * info.width + x) * info.channels + 3] > 0;
        if (!ink) errors.push(fail('EMPTY_PROFILE_CROP', `/profile/${name}/crop`, 'visible character pixels', c));
      }
    } catch {
      errors.push(fail('ASSET_READ_OR_DECODE', `${at}/path`, 'existing decodable WebP within limits', asset.path));
    }
  }
  return { ...result, ok: errors.length === 0, stage: 'bytes-hashes-and-full-decode', errors,
    pending: ['runtime-preview', 'visual-review', 'server-registration'] };
}
