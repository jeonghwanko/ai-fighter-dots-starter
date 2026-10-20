import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

const unsafe = () => new Error('unsafe-client-config');
const owned = info => process.platform === 'win32' || info.uid === process.getuid();
async function privateParent(file) {
  const info = await lstat(path.dirname(path.resolve(file)));
  if (!info.isDirectory() || !owned(info) || (process.platform !== 'win32' && (info.mode & 0o022))) throw unsafe();
}
function privateFile(info) {
  if (!info.isFile() || info.nlink !== 1 || !owned(info)
    || (process.platform !== 'win32' && (info.mode & 0o077))) throw unsafe();
}

/** Read credentials without following a final symlink or exposing JSON fragments in errors. */
export async function readPrivateConfig(file) {
  let handle;
  try {
    await privateParent(file);
    // lstat also rejects symlinks on platforms that lack O_NOFOLLOW.
    const before = await lstat(file);
    privateFile(before);
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await handle.stat(); privateFile(info);
    if (info.dev !== before.dev || info.ino !== before.ino || info.size > 65536) throw unsafe();
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > 65536) throw unsafe();
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('invalid-client-config'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-client-config');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw new Error(error.message === 'invalid-client-config' ? 'invalid-client-config' : 'unsafe-client-config');
  } finally { await handle?.close(); }
}

/** Exclusive 0600 creation. Never chmod a path that might be a link to another file. */
export async function createPrivateConfig(file, value) {
  await privateParent(file);
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    privateFile(await handle.stat());
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally { await handle.close(); }
}
