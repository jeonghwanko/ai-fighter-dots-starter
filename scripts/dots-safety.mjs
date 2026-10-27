// Built-ins only: usable before npm install. Never reads credentials or Codex sessions.
import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const fail = code => { throw Error(code); };
export const INSTALL_OUTCOME_UNKNOWN = 79;
const protectedPart = /^(?:\.codex|\.grok|\.aws|\.ssh|sessions|auth\.json|client\.json|pending-login\.json)$/i;
export async function safePath(value, { root } = {}) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value)) fail('path-not-allowed');
  if (root && (path.isAbsolute(value) || /[\\:?=#]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..'))) fail('path-not-allowed');
  if (!root && !path.isAbsolute(value)) fail('absolute-path-required');
  const target = root ? path.join(root, value) : path.resolve(value);
  const parsed = path.parse(target), parts = target.slice(parsed.root.length).split(path.sep);
  if (parts.some(p => protectedPart.test(p))) fail('protected-path-not-allowed');
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (info?.isSymbolicLink()) fail('symlink-not-allowed');
  }
  return target;
}
export async function readRecord(file) {
  await safePath(file);
  const info = await lstat(file);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) fail('invalid-record');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function writableDirectory(target) {
  await safePath(target);
  let current = target, exists = true;
  while (true) {
    const info = await lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (info) {
      if (!info.isDirectory() || !(info.mode & 0o222)) return { status: 'blocked', reason: 'directory-not-writable' };
      try { await access(current, constants.W_OK | constants.X_OK); }
      catch { return { status: 'blocked', reason: 'directory-not-writable' }; }
      return { status: exists ? 'writable' : 'creatable', scope: 'permission-check-no-write' };
    }
    exists = false;
    const parent = path.dirname(current);
    if (parent === current) return { status: 'blocked', reason: 'directory-unavailable' };
    current = parent;
  }
}
export async function fingerprint(root, record) {
  try {
    if (!record || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 0)
      return { status: 'invalid-record' };
    const file = await safePath(record.path, { root }), info = await lstat(file);
    if (!info.isFile() || info.size !== record.bytes || info.size > 128 * 1024 * 1024) return { status: 'missing-or-changed' };
    const actual = sha256(await readFile(file));
    return { path: record.path, bytes: info.size, sha256: actual, status: actual === record.sha256 ? 'verified-bytes' : 'missing-or-changed' };
  } catch { return { status: 'missing-or-unsafe' }; }
}
export async function directoryEntries(root, relative) {
  const dir = await safePath(relative, { root });
  return readdir(dir, { withFileTypes: true }).catch(e => { if (e.code !== 'ENOENT') throw e; return []; });
}
