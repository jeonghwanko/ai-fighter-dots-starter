import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveManifest, makePackageValidator } from './package-access.mjs';

export function registerRemoteTools(server, { remote, root, respond }) {
  const outputSchema = { ok: z.boolean(), stage: z.string(), submissionId: z.string().optional(), manifestSha256: z.string().optional(),
    fighterId: z.string().nullable().optional(), runtimeApproved: z.boolean().optional(), pending: z.array(z.string()).optional(),
    validation: z.unknown().optional(), code: z.string().optional(), fighter: z.unknown().optional() };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const safe = fn => async args => { try { return respond(await fn(args)); } catch (error) { return respond({ ok: false, stage: 'remote-api', code: /^[a-z0-9-]+$/.test(error.message) ? error.message : 'remote-operation-failed' }); } };
  if (root) {
    const validate = makePackageValidator(root);
    server.registerTool('submit_fighter_package', {
      description: 'Upload the checked local fighter package to the configured Supabase beta and queue authoritative validation. Requires user intent to submit. Use one UUID idempotencyKey per immutable package and reuse it for retries. This does not approve the fighter for gameplay.',
      inputSchema: { manifestPath: z.string().min(1).max(512), idempotencyKey: z.string().uuid() }, outputSchema,
      annotations: { ...read, readOnlyHint: false },
    }, safe(async ({ manifestPath, idempotencyKey }) => {
      const checked = await validate(manifestPath);
      if (!checked.ok) return { ok: false, stage: 'local-validation', code: 'package-invalid' };
      const location = await resolveManifest(root, manifestPath);
      if (!location) throw new Error('path-not-allowed');
      const manifestText = await readFile(location, 'utf8'), manifest = JSON.parse(manifestText);
      const created = await remote.request('submissions', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: manifestText });
      if (created.stage !== 'uploading') return created;
      for (const asset of manifest.assets) {
        const bytes = await readFile(path.join(path.dirname(location), asset.path));
        if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('package-changed-after-validation');
        await remote.request(`submissions/${created.submissionId}/assets/${asset.id}`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body: bytes });
      }
      return remote.request(`submissions/${created.submissionId}/submit`, { method: 'POST' });
    }));
  }
  server.registerTool('get_fighter_submission', { description: 'Read the current user’s submission status. registered means server file validation and registry creation; gameplay approval is separate.',
    inputSchema: { submissionId: z.string().uuid() }, outputSchema, annotations: read }, safe(({ submissionId }) => remote.request(`submissions/${submissionId}`)));
  server.registerTool('get_registered_fighter', { description: 'Read the current user’s persisted fighter ID and profile from the beta registry.',
    inputSchema: { fighterId: z.string().uuid() }, outputSchema, annotations: read }, safe(({ fighterId }) => remote.request(`fighters/${fighterId}`)));
}
