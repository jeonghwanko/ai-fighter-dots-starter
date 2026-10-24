// Reproducible, hash-bound changes to the pinned Apache-2.0 dependency.
// Do not overwrite upstream updates or local edits when their hashes differ.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const normalized = text => text.replace(/\r\n/g, '\n');
const hash = text => createHash('sha256').update(normalized(text)).digest('hex');
export const patchFile = path.join(root, 'patches/sprite-gen-gpt-motion.json');

export async function inspectSpritePatch(sourceRoot, manifest) {
  manifest ??= JSON.parse(await readFile(patchFile, 'utf8'));
  const files = [];
  for (const entry of manifest.files) {
    const file = path.resolve(sourceRoot, entry.path);
    if (!file.startsWith(path.resolve(sourceRoot) + path.sep)) throw Error('Patch path outside sprite-gen');
    const current = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const actual = current === null ? null : hash(current);
    const upgrade = entry.upgrades?.find(candidate => candidate.before === actual);
    if (actual !== entry.before && actual !== entry.after && !upgrade) throw Error(`SPRITE_PATCH_SOURCE_CHANGED: preserve local edits and review ${entry.path}`);
    const lines = normalized(current ?? '').split('\n');
    if (actual !== entry.after) {
      for (const hunk of [...(upgrade?.hunks ?? entry.hunks)].reverse()) lines.splice(hunk.start, hunk.remove, ...hunk.insert);
      if (hash(lines.join('\n')) !== entry.after) throw Error(`Invalid sprite patch: ${entry.path}`);
    }
    files.push({ ...entry, file, applied: actual === entry.after, text: lines.join('\n') });
  }
  return { manifest, files, applied: files.every(file => file.applied) };
}

export async function ensureSpritePatch(sourceRoot, manifest) {
  const state = await inspectSpritePatch(sourceRoot, manifest);
  if (state.applied) return state;
  // An exclusive directory prevents simultaneous first-run patch writes.
  const lock = path.join(sourceRoot, '.ai-fighter-patch-lock');
  await mkdir(lock).catch(error => { if (error.code === 'EEXIST') throw Error('Sprite patch is already being applied; retry after it completes.'); throw error; });
  try {
    const fresh = await inspectSpritePatch(sourceRoot, manifest);
    for (const entry of fresh.files.filter(file => !file.applied)) {
      await mkdir(path.dirname(entry.file), { recursive: true });
      const temporary = entry.file + '.ai-fighter-patch.tmp';
      await writeFile(temporary, entry.text, 'utf8');
      await rename(temporary, entry.file);
    }
    return await inspectSpritePatch(sourceRoot, manifest);
  } finally {
    await rmdir(lock); // empty lock only; no recursive removal
  }
}
