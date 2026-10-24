// Install only bundled bytes into a writable, per-user runtime. Never download or run setup here.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = fileURLToPath(new URL('./', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const exists = file => lstat(file).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; });
function child(root, relative) {
  if (!relative || relative.includes('\\') || relative.includes(':') || relative.startsWith('/') ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Invalid bundled path');
  return path.join(root, ...relative.split('/'));
}

export async function initialize({ base = process.env.AI_FIGHTER_CREATOR_HOME || path.join(homedir(), '.ai-fighter', 'creator'),
  workspace = process.env.AI_FIGHTER_ROOT } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 12) throw Error('AI Fighter Creator needs Node.js 22.12 or newer.');
  if (!path.isAbsolute(base)) throw Error('AI_FIGHTER_CREATOR_HOME must be an absolute directory.');
  const bytes = await readFile(path.join(pluginRoot, 'runtime-manifest.json'));
  const manifest = JSON.parse(bytes);
  if (manifest.platform !== process.platform || manifest.arch !== process.arch)
    throw Error(`This bundle requires ${manifest.platform}-${manifest.arch}; use a bundle built for this computer.`);
  const runtime = path.join(base, 'runtimes', hash(bytes));
  const marker = path.join(runtime, '.bundle-complete');
  if (!await exists(marker)) {
    await mkdir(path.dirname(runtime), { recursive: true });
    const pending = `${runtime}.pending-${randomUUID()}`;
    await mkdir(pending);
    try {
      for (const [relative, expected] of Object.entries(manifest.files)) {
        const source = child(path.join(pluginRoot, 'runtime'), relative);
        if (!(await lstat(source)).isFile()) throw Error('Bundle contains a non-regular file');
        const data = await readFile(source);
        if (hash(data) !== expected) throw Error(`Bundle integrity check failed: ${relative}`);
        const target = child(pending, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data, { flag: 'wx' });
      }
      await writeFile(path.join(pending, '.bundle-complete'), hash(bytes), { flag: 'wx' });
      try { await rename(pending, runtime); }
      catch (error) { if (!await exists(marker)) throw error; }
    } finally { await rm(pending, { recursive: true, force: true }); }
  }
  if (await readFile(marker, 'utf8') !== hash(bytes)) throw Error('Invalid runtime completion marker');
  const root = workspace || path.join(base, 'workspace');
  if (!path.isAbsolute(root)) throw Error('AI_FIGHTER_ROOT must be an absolute directory.');
  await mkdir(root, { recursive: true });
  return { root, runtime, platform: `${manifest.platform}-${manifest.arch}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await initialize();
    if (process.argv[2] === '--status') console.log(JSON.stringify(result, null, 2));
    else {
      process.env.AI_FIGHTER_ROOT = result.root;
      await import(pathToFileURL(path.join(result.runtime, 'mcp', 'stdio.mjs')).href);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
