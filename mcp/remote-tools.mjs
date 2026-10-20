import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { resolveManifest } from './package-access.mjs';
import { startCreatorHandoff } from './creator-handoff.mjs';

const CHANGED = 'package-changed-after-validation';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read exactly the declared size from a regular file. The final component must not be a symbolic link. */
async function readDeclaredFile(file, bytes) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== bytes) throw new Error(CHANGED);
    const buffer = Buffer.alloc(bytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== bytes) throw new Error(CHANGED);
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** The manifest bytes, or null when the path is not an allowed, existing manifest. */
async function readManifest(root, manifestPath) {
  try {
    const location = await resolveManifest(root, manifestPath);
    return location ? { location, bytes: await readFile(location) } : null;
  } catch { return null; }
}

export function registerRemoteTools(server, { remote, validatePackage, root, respond, creatorPage }) {
  const outputSchema = { ok: z.boolean(), stage: z.string(), submissionId: z.string().optional(), manifestSha256: z.string().optional(),
    fighterId: z.string().nullable().optional(), runtimeApproved: z.boolean().optional(), runtimeScope: z.string().nullable().optional(), pending: z.array(z.string()).optional(),
    validation: z.unknown().optional(), code: z.string().optional(), fighter: z.unknown().optional(),
    errors: z.array(z.unknown()).optional(), errorCount: z.number().optional(), loginUrl: z.string().optional(), expiresAt: z.string().optional() };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const safe = fn => async args => { try { return respond(await fn(args)); } catch (error) { return respond({ ok: false, stage: 'remote-api', code: /^[a-z0-9-]+$/.test(error.message) ? error.message : 'remote-operation-failed' }); } };
  if (validatePackage) {
    server.registerTool('submit_fighter_package', {
      description: 'Upload the checked local fighter package to the configured Supabase beta and queue authoritative validation. Requires user intent to submit. Use one UUID idempotencyKey per immutable package and reuse it for retries. This does not approve the fighter for gameplay.',
      inputSchema: { manifestPath: z.string().min(1).max(512), idempotencyKey: z.string().uuid() }, outputSchema,
      annotations: { ...read, readOnlyHint: false },
    }, safe(async ({ manifestPath, idempotencyKey }) => {
      // Upload exactly what the validator saw: the manifest must not change while the child process checks it,
      // and every uploaded asset must match the hash in that manifest.
      const before = await readManifest(root, manifestPath);
      const checked = await validatePackage(manifestPath);
      if (!checked.ok) return { ok: false, stage: 'local-validation', errors: checked.errors,
        code: checked.stage === 'local-access' ? 'local-validation-unavailable' : 'package-invalid' };
      const after = await readManifest(root, manifestPath);
      if (!before || !after || !after.bytes.equals(before.bytes)) throw new Error(CHANGED);
      const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(after.bytes);
      const parsed = parseFighterJson(manifestText);
      // The schema confines every asset path to assets/<id>.webp.
      if (!parsed.ok || !validateFighter(parsed.data).ok) throw new Error(CHANGED);
      const directory = path.dirname(after.location);
      if ((await lstat(path.join(directory, 'assets'))).isSymbolicLink()) throw new Error(CHANGED);
      const created = await remote.request('submissions', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: manifestText });
      if (created.stage !== 'uploading' || created.code === 'upload-expired') return created;
      for (const asset of parsed.data.assets) {
        const bytes = await readDeclaredFile(path.join(directory, asset.path), asset.bytes);
        if (sha256(bytes) !== asset.sha256) throw new Error(CHANGED);
        await remote.request(`submissions/${created.submissionId}/assets/${asset.id}`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body: bytes });
      }
      return remote.request(`submissions/${created.submissionId}/submit`, { method: 'POST' });
    }));
  }
  server.registerTool('open_creator_homepage', {
    description: 'Make a one-use link that signs the current user into the AI Fighter creator homepage (https://rupin.pryzm.gg/creator.html) with this beta session: their registered fighters, animations, statistics and downloads. Use when the user asks to see their fighters on the homepage. Give the link to the user to open in a browser on this computer within 5 minutes; it works once. The page receives only an access token.',
    inputSchema: {}, outputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, safe(async () => {
    const { loginUrl, expiresAt } = await startCreatorHandoff({ page: creatorPage, loadAccess: () => remote.session() });
    return { ok: true, stage: 'creator-link', loginUrl, expiresAt };
  }));
  server.registerTool('get_fighter_submission', { description: 'Read the current user’s submission status. registered means server file validation and registry creation; gameplay approval is separate. Empty pending means the status is final.',
    inputSchema: { submissionId: z.string().uuid() }, outputSchema, annotations: read }, safe(({ submissionId }) => remote.request(`submissions/${submissionId}`)));
  server.registerTool('get_registered_fighter', { description: 'Read the current user’s persisted fighter ID and profile from the beta registry.',
    inputSchema: { fighterId: z.string().uuid() }, outputSchema, annotations: read }, safe(({ fighterId }) => remote.request(`fighters/${fighterId}`)));
}
