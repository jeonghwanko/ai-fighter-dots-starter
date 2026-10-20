import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { createDuelHandler } from './duels.mjs';
import { createFighterStatisticsHandler } from './fighter-statistics.mjs';

export const BUCKET = 'ai-fighter-beta';
export const VALIDATOR_VERSION = 'ai-fighter-validator-0.2.0';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class Problem extends Error { constructor(status, code, errors) { super(code); this.status = status; this.errors = errors; } }
export const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
export const objectKey = (submission, asset) => `${submission.owner_id}/${submission.id}/${asset.id}.webp`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const requireId = value => { if (!UUID.test(value ?? '')) throw new Problem(400, 'invalid-id'); return value; };
export async function readBody(request, maximum) {
  if (Number(request.headers.get('content-length')) > maximum) throw new Problem(413, 'body-limit');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.length;
      if (count > maximum) { await reader.cancel(); throw new Problem(413, 'body-limit'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(count); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
// rejected and expired uploads are final: nothing remains to wait for, so pending is empty.
const uploadExpired = row => row.status === 'uploading' && Date.parse(row.expires_at) <= Date.now();
const view = (row, admission) => ({ ok: true, stage: row.status, submissionId: row.id, manifestSha256: row.manifest_sha,
  fighterId: row.fighter_id ?? null, validation: row.validation ?? null, ...(uploadExpired(row) ? { code: 'upload-expired' } : {}),
  runtimeApproved: admission?.runtime_approved === true, runtimeScope: admission?.runtime_scope ?? null,
  pending: row.status === 'registered' ? admission?.runtime_approved ? [] : ['runtime-preview', 'visual-review', 'game-integration']
    : row.status === 'rejected' || uploadExpired(row) ? [] : ['server-validation', 'registration'] });
/** Postgres jsonb cannot store U+0000 or an unpaired surrogate. JSON.parse and the v1 schema accept both. */
function unstorableTextPath(value, at = '') {
  if (typeof value === 'string') return value.includes('\0') || !value.isWellFormed() ? at : null;
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) { const found = unstorableTextPath(item, `${at}/${key}`); if (found !== null) return found; }
  return null;
}
const conflictCodes = ['idempotency-conflict','fighter-quota','open-submission-exists','submission-quota','storage-budget-full','assets-incomplete','upload-expired','stale-validation','submissions-paused','beta-capacity'];
function check(error) {
  if (!error) return;
  if (conflictCodes.includes(error.message)) throw new Problem(409, error.message);
  if (error.message === 'not-found') throw new Problem(404, 'not-found');
  if (error.message === 'rate-limit') throw new Problem(429, 'rate-limit');
  if (error.message === 'invite-required') throw new Problem(403, 'invite-required');
  if (['validator-version','validation-incomplete','validation-result-limit'].includes(error.message)) throw new Problem(400, error.message);
  if (error.message === 'byte-budget-mismatch') throw new Problem(422, error.message);
  throw new Problem(503, 'database-unavailable');
}
export function createHandler({ db, simulateDuel = null, engineVersion = null }) {
  const duelHandler = createDuelHandler({db,simulateDuel,engineVersion});
  const statisticsHandler = createFighterStatisticsHandler({ db });
  async function rpc(name, args) { const { data, error } = await db.rpc(name, args); check(error); return data; }
  async function present(row) {
    if (row.status !== 'registered') return view(row);
    const { data, error } = await db.from('af_fighters').select('runtime_approved,runtime_scope').eq('submission_id', row.id).maybeSingle();
    check(error); return view(row, data);
  }
  async function authenticate(request, worker) {
    const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]{16,4096})$/)?.[1];
    if (!token) throw new Problem(401, 'authentication-required');
    if (worker) {
      if (!/^afw_[a-f0-9]{64}$/.test(token)) throw new Problem(403, 'worker-required');
      const hash = await sha256(new TextEncoder().encode(token));
      const { data, error } = await db.from('af_workers').select('token_hash').eq('token_hash', hash).eq('enabled', true).gt('expires_at', new Date().toISOString()).maybeSingle();
      check(error); if (!data) throw new Problem(403, 'worker-required');
      return null;
    }
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user || data.user.is_anonymous) throw new Problem(401, 'authentication-required');
    await rpc('af_authorize', { p_owner: data.user.id });
    return data.user.id;
  }
  async function ownSubmission(owner, id) {
    const { data, error } = await db.from('af_submissions').select('*').eq('id', requireId(id)).eq('owner_id', owner).maybeSingle();
    check(error); if (!data) throw new Problem(404, 'not-found'); return data;
  }
  return async request => {
    try {
      const segments = new URL(request.url).pathname.split('/').filter(Boolean), prefix = segments.indexOf('ai-fighter');
      const parts = prefix >= 0 ? segments.slice(prefix + 1) : segments, method = request.method;
      if (parts[0] === 'duels' || parts[0] === 'rankings') return duelHandler(request,parts);
      if (parts[0] === 'fighters' && parts[2] === 'statistics') return statisticsHandler(request, parts);
      if (method === 'GET' && parts.join('/') === 'spec') return json({ ok: true, stage: 'public-contract', data: { ...spec,
        registration: { available: true, mode: 'invite-only-beta', auth: 'supabase-user-jwt', assetUpload: 'authenticated-binary', runtimeApproved: false } } });
      // Only explicitly reviewed arena packages are publicly readable. Uploads and pending drafts stay private.
      if (parts[0] === 'roster' && (method === 'GET' || method === 'OPTIONS')) {
        const reply = (body, status = 200) => { const response = json(body, status); response.headers.set('access-control-allow-origin', '*');
          response.headers.set('access-control-allow-methods', 'GET, OPTIONS'); return response; };
        if (method === 'OPTIONS') return reply({ ok: true });
        let query = db.from('af_fighters').select('id,submission_id,manifest_sha,profile,runtime_approved,runtime_scope,runtime_manifest_sha,duel_approved,duel_manifest_sha')
          .eq('runtime_approved', true).eq('runtime_scope', 'arena-player-v1').eq('review_state', 'approved');
        if (parts.length === 1) {
          const { data, error } = await query.order('created_at').limit(20); check(error);
          return reply({ ok: true, fighters: data.filter(f => f.runtime_manifest_sha === f.manifest_sha)
            .map(f => ({ id: f.id, manifestSha256: f.manifest_sha, name: f.profile.name, runtimeScope: f.runtime_scope,
              duelApproved: f.duel_approved === true && f.duel_manifest_sha === f.manifest_sha })) });
        }
        if (parts.length !== 2 || !UUID.test(parts[1])) return reply({ ok: false, code: 'not-found' }, 404);
        const { data: fighter, error } = await query.eq('id', parts[1]).maybeSingle(); check(error);
        if (!fighter || fighter.runtime_manifest_sha !== fighter.manifest_sha) return reply({ ok: false, code: 'not-found' }, 404);
        const { data: row, error: readError } = await db.from('af_submissions').select('*').eq('id', fighter.submission_id).eq('status', 'registered').maybeSingle();
        check(readError);
        if (!row || row.manifest_sha !== fighter.manifest_sha) return reply({ ok: false, code: 'not-found' }, 404);
        const files = [];
        for (const asset of row.manifest.assets) {
          const { data, error: signError } = await db.storage.from(BUCKET).createSignedUrl(objectKey(row, asset), 600);
          if (signError || !data) throw new Problem(503, 'storage-unavailable');
          files.push({ id: asset.id, downloadUrl: data.signedUrl });
        }
        return reply({ ok: true, fighterId: fighter.id, manifestSha256: fighter.manifest_sha, runtimeApproved: true,
          runtimeScope: fighter.runtime_scope, duelApproved: fighter.duel_approved === true && fighter.duel_manifest_sha === fighter.manifest_sha,
          manifestText: row.manifest_text, files });
      }
      const isWorker = parts[0] === 'worker';
      const owner = await authenticate(request, isWorker);
      if (method === 'POST' && parts.join('/') === 'submissions') {
        const key = requireId(request.headers.get('idempotency-key'));
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, spec.limits.jsonBytes)); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-utf8'); }
        const parsed = parseFighterJson(text);
        if (!parsed.ok) throw new Problem(422, 'invalid-manifest', parsed.errors.slice(0, 20));
        const result = validateFighter(parsed.data);
        if (!result.ok) throw new Problem(422, 'invalid-manifest', result.errors.slice(0, 20));
        // Reject here with 422. Otherwise the jsonb cast in af_create_submission fails and the API returns 503.
        const unstorable = unstorableTextPath(parsed.data);
        if (unstorable !== null) throw new Problem(422, 'invalid-manifest', [{ code: 'UNSUPPORTED_TEXT', path: unstorable,
          expected: 'text without U+0000 or unpaired surrogates', actual: 'unsupported character' }]);
        const sha = await sha256(new TextEncoder().encode(text));
        const row = await rpc('af_create_submission', { p_owner: owner, p_key: key, p_text: text, p_sha: sha, p_bytes: result.assetBytes });
        return json(await present(row), 200);
      }
      if (parts[0] === 'submissions' && parts.length >= 2) {
        const row = await ownSubmission(owner, parts[1]);
        if (method === 'GET' && parts.length === 2) return json(await present(row));
        if (method === 'POST' && parts.length === 3 && parts[2] === 'submit')
          return json(await present(await rpc('af_submit', { p_owner: owner, p_id: row.id })));
        if (method === 'PUT' && parts.length === 4 && parts[2] === 'assets') {
          if (row.status !== 'uploading' || new Date(row.expires_at).getTime() <= Date.now()) throw new Problem(409, 'upload-closed');
          const asset = row.manifest.assets.find(a => a.id === parts[3]);
          if (!asset) throw new Problem(404, 'asset-not-found');
          if (request.headers.get('content-type') !== 'image/webp') throw new Problem(415, 'webp-required');
          const bytes = await readBody(request, asset.bytes);
          if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Problem(422, 'asset-hash-or-size');
          if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8, 12)) !== 'WEBP') throw new Problem(422, 'webp-required');
          const bucket = db.storage.from(BUCKET), path = objectKey(row, asset);
          const { error } = await bucket.upload(path, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
          if (error) {
            // An existing immutable object is a successful retry only if its actual bytes still match.
            const { data, error: getError } = await bucket.download(path);
            if (getError || !data || data.size !== asset.bytes || await sha256(await data.arrayBuffer()) !== asset.sha256) throw new Problem(503, 'storage-unavailable');
          }
          return json({ ok: true, stage: 'uploaded', assetId: asset.id, bytes: bytes.length });
        }
      }
      if (method === 'GET' && parts[0] === 'fighters' && parts.length === 2) {
        const { data, error } = await db.from('af_fighters').select('id,submission_id,manifest_sha,profile,status,review_state,runtime_approved,runtime_scope,duel_approved,created_at').eq('id', requireId(parts[1])).eq('owner_id', owner).maybeSingle();
        check(error); if (!data) throw new Problem(404, 'not-found'); return json({ ok: true, stage: 'registered', fighter: data });
      }
      if (isWorker && method === 'POST') {
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (parts.join('/') === 'worker/claim') {
          if (body.submissionId) requireId(body.submissionId);
          const row = await rpc('af_claim', { p_id: body.submissionId ?? null });
          if (!row?.id) return json({ ok: true, stage: 'idle' });
          const files = [];
          for (const asset of row.manifest.assets) {
            const { data, error } = await db.storage.from(BUCKET).createSignedUrl(objectKey(row, asset), 300);
            if (error || !data) throw new Problem(503, 'storage-unavailable');
            files.push({ ...asset, downloadUrl: data.signedUrl });
          }
          return json({ ok: true, stage: 'validating', submissionId: row.id, leaseToken: row.lease_token,
            manifestText: row.manifest_text, manifestSha256: row.manifest_sha, files });
        }
        if (parts.join('/') === 'worker/finish') {
          requireId(body.submissionId); requireId(body.leaseToken);
          if (!/^[a-f0-9]{64}$/.test(body.manifestSha256 ?? '') || typeof body.passed !== 'boolean' || !body.result || Array.isArray(body.result)) throw new Problem(400, 'invalid-result');
          return json(await present(await rpc('af_finish', { p_id: body.submissionId, p_lease: body.leaseToken,
            p_sha: body.manifestSha256, p_passed: body.passed, p_result: body.result })));
        }
      }
      throw new Problem(404, 'route-not-found');
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, stage: 'api', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'api', code: 'service-unavailable' }, 503);
    }
  };
}
