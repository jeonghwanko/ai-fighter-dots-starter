import { updateFighterProfile } from './fighter-profile.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { createAccountHandler } from './account.mjs';
import { createDeviceLoginHandler } from './device-login.mjs';
import { createAdminHandler } from './admin.mjs';
import { createDuelHandler } from './duels.mjs';
import { createFighterStatisticsHandler } from './fighter-statistics.mjs';
import { createWorkshopHandler, workshopRoute } from './workshop.mjs';
import { createGenerationHandler, generationRoute } from './generations.mjs';
import { Problem, UUID, bearerToken, jsonResponse, readBody, sha256, verifiedUserId } from './http.mjs';
import { BUCKET, checkedManifest, objectKey, storeAsset } from './submissions.mjs';

export { Problem, readBody, sha256 } from './http.mjs';
export { BUCKET, objectKey } from './submissions.mjs';
// The worker stamps this on every receipt. af_settings.validator_versions lists the versions af_finish accepts.
export const VALIDATOR_VERSION = 'ai-fighter-validator-0.2.0';
const ROSTER_CORS = { methods: 'GET, OPTIONS' };
const requireId = value => { if (!UUID.test(value ?? '')) throw new Problem(400, 'invalid-id'); return value; };
// rejected and expired uploads are final: nothing remains to wait for, so pending is empty.
const uploadExpired = row => row.status === 'uploading' && Date.parse(row.expires_at) <= Date.now();
const view = (row, admission) => ({ ok: true, stage: row.status, submissionId: row.id, manifestSha256: row.manifest_sha,
  fighterId: row.fighter_id ?? null, validation: row.validation ?? null, ...(uploadExpired(row) ? { code: 'upload-expired' } : {}),
  runtimeApproved: admission?.runtime_approved === true, runtimeScope: admission?.runtime_scope ?? null,
  ...(row.status === 'registered' ? { availability: admission?.runtime_approved ? 'active' : 'removed', moderationReason: admission?.moderation_reason ?? '' } : {}),
  pending: row.status === 'registered' ? []
    : row.status === 'rejected' || uploadExpired(row) ? [] : ['server-validation', 'registration'] });
const conflictCodes = ['idempotency-conflict','fighter-quota','fighter-removed','fighter-unchanged','fighter-changed','profile-not-editable','open-submission-exists','submission-quota','storage-budget-full','assets-incomplete','upload-expired','stale-validation','submissions-paused','beta-capacity'];
function check(error) {
  if (!error) return;
  if (conflictCodes.includes(error.message)) throw new Problem(409, error.message);
  if (error.message === 'not-found' || error.message === 'fighter-not-found') throw new Problem(404, error.message);
  if (error.message === 'rate-limit') throw new Problem(429, 'rate-limit');
  if (error.message === 'account-disabled') throw new Problem(403, 'account-disabled');
  if (['validator-version','validation-incomplete','validation-result-limit'].includes(error.message)) throw new Problem(400, error.message);
  if (['byte-budget-mismatch','profile-only-required'].includes(error.message)) throw new Problem(422, error.message);
  throw new Problem(503, 'database-unavailable');
}
/**
 * `agentClient` (공방과 연대기, 2026-10-27): the cloud MCP's OAuth client for its in-process calls — the workshop labels notes and canon
 * versions with that agent's name. The public Edge handler never sets it.
 */
export function createHandler({ db, simulateDuel = null, engineVersion = null, engines = null, release = null, creatorLink = null, analytics = null, agentClient = null, limiter = null, decisionsReviewer = null, responsesReviewer = null }) {
  const duelHandler = createDuelHandler({db,simulateDuel,engineVersion,engines,release,limiter});
  const statisticsHandler = createFighterStatisticsHandler({ db });
  const accountHandler = createAccountHandler({ db, creatorLink });
  const deviceLoginHandler = createDeviceLoginHandler({ db, creatorLink, limiter });
  const adminHandler = createAdminHandler({ db });
  async function rpc(name, args) { const { data, error } = await db.rpc(name, args); check(error); return data; }
  async function present(row) {
    if (row.status !== 'registered') return view(row);
    const { data, error } = await db.from('af_fighters').select('runtime_approved,runtime_scope,moderation_reason').eq('submission_id', row.id).maybeSingle();
    check(error); return view(row, data);
  }
  /** One Storage call signs every asset of a submission, in manifest order. */
  // The agent that made each fighter (`af_fighter_agents`, 2026-10-27). Not knowing it never fails a roster read.
  async function madeWith(ids) {
    if (!ids.length) return new Map();
    try {
      const { data, error } = await db.from('af_fighter_agents').select('fighter_id,client_name').in('fighter_id', ids);
      return error || !Array.isArray(data) ? new Map() : new Map(data.map(row => [row.fighter_id, row.client_name]));
    } catch { return new Map(); }
  }
  async function signedUrls(row, seconds) {
    const paths = row.manifest.assets.map(asset => objectKey(row, asset));
    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, seconds);
    const signed = new Map((Array.isArray(data) ? data : []).map(item => [item.path, item]));
    return paths.map(key => {
      const item = signed.get(key);
      if (error || !item || item.error || typeof item.signedUrl !== 'string') throw new Problem(503, 'storage-unavailable');
      return item.signedUrl;
    });
  }
  // `worker`: false for a creator; 'validation' or 'generation' for a worker key of that scope (2026-10-27 — the generation worker has its own).
  async function authenticate(request, worker) {
    const token = bearerToken(request);
    if (!token) throw new Problem(401, 'authentication-required');
    if (worker) {
      if (!/^afw_[a-f0-9]{64}$/.test(token)) throw new Problem(403, 'worker-required');
      const hash = await sha256(new TextEncoder().encode(token));
      const { data, error } = await db.from('af_workers').select('token_hash,host_id').eq('token_hash', hash).eq('enabled', true).eq('scope', worker)
        .gt('expires_at', new Date().toISOString()).maybeSingle();
      check(error); if (!data) throw new Problem(403, 'worker-required');
      // A generation key names its host (커뮤니티 호스트, 2026-10-28); one without is the official host's.
      return worker === 'generation' ? data.host_id ?? null : null;
    }
    const owner = await verifiedUserId(db, request);
    if (!owner) throw new Problem(401, 'authentication-required');
    await rpc('af_authorize', { p_owner: owner });
    return owner;
  }
  const workshopHandler = createWorkshopHandler({ db, authenticate: request => authenticate(request, false), rpc, agentClient });
  const generationHandler = createGenerationHandler({ db, authenticate, present, decisionsReviewer, responsesReviewer });
  async function ownSubmission(owner, id) {
    const { data, error } = await db.from('af_submissions').select('*').eq('id', requireId(id)).eq('owner_id', owner).maybeSingle();
    check(error); if (!data) throw new Problem(404, 'not-found'); return data;
  }
  return async request => {
    let cors;
    const json = (body, status = 200) => jsonResponse(body, status, cors);
    try {
      const segments = new URL(request.url).pathname.split('/').filter(Boolean), prefix = segments.indexOf('ai-fighter');
      const parts = prefix >= 0 ? segments.slice(prefix + 1) : segments, method = request.method;
      const profileRoute = parts[0] === 'fighters' && parts[2] === 'profile' && parts.length === 3;
      if (profileRoute) {
        cors = { methods: 'PATCH, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key' };
        if (method === 'OPTIONS') return json({ ok: true });
      }
      // The creator page registers a package picked in the browser (2026-10-26): create, upload, submit and poll.
      // Bearer auth only, no cookies, so any origin may call it the way the kit's CLI does.
      if (parts[0] === 'submissions') {
        cors = { methods: 'GET, POST, PUT, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key' };
        if (method === 'OPTIONS') return json({ ok: true });
      }
      if (parts[0] === 'admin') return adminHandler(request, parts);
      if (workshopRoute(parts)) return workshopHandler(request, parts);
      if (generationRoute(parts)) return generationHandler(request, parts);
      if (parts[0] === 'duels' || parts[0] === 'rankings') return duelHandler(request,parts);
      if (parts[0] === 'fighters' && parts[2] === 'statistics') return statisticsHandler(request, parts);
      // Device-connection sign-in: start and poll are unauthenticated; approve verifies the user itself.
      if (parts[0] === 'device-logins') return deviceLoginHandler(request, parts);
      // Account and sign-in handoff routes work for every verified account.
      if (parts.length === 1 && ['me', 'access-requests', 'creator-handoffs'].includes(parts[0])) return accountHandler(request, parts);
      if (method === 'GET' && parts.join('/') === 'spec') return json({ ok: true, stage: 'public-contract', data: { ...spec,
        registration: { available: true, mode: 'open', auth: 'supabase-user-jwt', assetUpload: 'authenticated-binary',
          approvalRequired: false, publication: 'automatic-after-file-validation', moderation: 'post-publication', deviceLogin: 'v1', profileUpdate: 'v1', dailySubmissionLimit: 5, revisionsCountTowardLimit: false } } });
      // Validated, active packages are public; uploads and removed packages remain private.
      if (parts[0] === 'roster' && (method === 'GET' || method === 'OPTIONS')) {
        const reply = (body, status = 200) => jsonResponse(body, status, ROSTER_CORS);
        if (method === 'OPTIONS') return reply({ ok: true });
        let query = db.from('af_fighters').select('id,created_at,submission_id,manifest_sha,profile,runtime_approved,runtime_scope,runtime_manifest_sha,duel_approved,duel_manifest_sha')
          .eq('runtime_approved', true).eq('runtime_scope', 'arena-player-v1').eq('review_state', 'approved');
        if (parts.length === 1) {
          // An unlisted fighter (`listed`, 2026-10-27) is left out of the list only: his own address below still serves him.
          query = query.eq('listed', true);
          const cursor = new URL(request.url).searchParams.get('after');
          if (cursor !== null) {
            // Strictly validate both parts before placing them in PostgREST filter syntax.
            const parts = cursor.split('|'), [createdAt, id] = parts;
            if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(createdAt)
              || !Number.isFinite(Date.parse(createdAt)) || !UUID.test(id)) return reply({ ok: false, code: 'invalid-cursor' }, 400);
            query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`);
          }
          query = query.order('created_at', { ascending: false }).order('id');
          const { data, error } = await query.limit(21); check(error);
          const last = data[19], hasMore = data.length > 20, shown = data.slice(0, 20).filter(f => f.runtime_manifest_sha === f.manifest_sha);
          const makers = await madeWith(shown.map(f => f.id));
          return reply({ ok: true, hasMore, nextCursor: hasMore ? `${last.created_at}|${last.id}` : null,
            fighters: shown.map(f => ({ id: f.id, manifestSha256: f.manifest_sha, name: f.profile.name, ...(f.profile.names ? { names: f.profile.names } : {}), runtimeScope: f.runtime_scope,
              duelApproved: f.duel_approved === true && f.duel_manifest_sha === f.manifest_sha, ...(makers.has(f.id) ? { madeWith: makers.get(f.id) } : {}) })) });
        }
        if (parts.length !== 2 || !UUID.test(parts[1])) return reply({ ok: false, code: 'not-found' }, 404);
        const { data: fighter, error } = await query.eq('id', parts[1]).maybeSingle(); check(error);
        if (!fighter || fighter.runtime_manifest_sha !== fighter.manifest_sha) return reply({ ok: false, code: 'not-found' }, 404);
        const { data: row, error: readError } = await db.from('af_submissions').select('*').eq('id', fighter.submission_id).eq('status', 'registered').maybeSingle();
        check(readError);
        if (!row || row.manifest_sha !== fighter.manifest_sha) return reply({ ok: false, code: 'not-found' }, 404);
        const urls = await signedUrls(row, 600), maker = (await madeWith([fighter.id])).get(fighter.id);
        const files = row.manifest.assets.map((asset, index) => ({ id: asset.id, downloadUrl: urls[index] }));
        return reply({ ok: true, fighterId: fighter.id, manifestSha256: fighter.manifest_sha, runtimeApproved: true,
          runtimeScope: fighter.runtime_scope, duelApproved: fighter.duel_approved === true && fighter.duel_manifest_sha === fighter.manifest_sha,
          manifestText: row.manifest_text, files, ...(maker ? { madeWith: maker } : {}) });
      }
      if (parts.join('/') === 'analytics/context' && request.method === 'OPTIONS' && analytics) return analytics.preflight();
      const isWorker = parts[0] === 'worker';
      const owner = await authenticate(request, isWorker ? 'validation' : false);
      if (!isWorker && parts.join('/') === 'analytics/context' && analytics) return analytics.context(request, owner);
      if (profileRoute && method === 'PATCH') {
        const row = await updateFighterProfile({ request, owner, id: requireId(parts[1]), key: requireId(request.headers.get('idempotency-key')), db, rpc });
        return json(await present(row));
      }
      if (method === 'POST' && parts.join('/') === 'submissions') {
        const key = requireId(request.headers.get('idempotency-key'));
        // ?fighter=<id> replaces the package of the caller's own fighter in place (2026-10-23); absent, it registers another fighter within the account quota.
        const target = new URL(request.url).searchParams.get('fighter');
        if (target !== null && !UUID.test(target)) throw new Problem(422, 'invalid-fighter');
        const manifest = await checkedManifest(request);
        const row = await rpc('af_create_submission', { p_owner: owner, p_key: key, p_text: manifest.text, p_sha: manifest.sha, p_bytes: manifest.bytes, p_fighter: target });
        return json(await present(row), 200);
      }
      if (parts[0] === 'submissions' && parts.length >= 2) {
        const row = await ownSubmission(owner, parts[1]);
        if (method === 'GET' && parts.length === 2) return json(await present(row));
        if (method === 'POST' && parts.length === 3 && parts[2] === 'submit')
          return json(await present(await rpc('af_submit', { p_owner: owner, p_id: row.id })));
        if (method === 'PUT' && parts.length === 4 && parts[2] === 'assets') return json(await storeAsset(db, row, parts[3], request));
      }
      if (method === 'GET' && parts[0] === 'fighters' && parts.length === 2) {
        const { data, error } = await db.from('af_fighters').select('id,submission_id,manifest_sha,profile,status,review_state,runtime_approved,runtime_scope,duel_approved,created_at,moderation_reason,deleted_at').eq('id', requireId(parts[1])).eq('owner_id', owner).maybeSingle();
        check(error); if (!data) throw new Problem(404, 'not-found');
        if (data.deleted_at) return json({ ok: true, stage: 'deleted', fighterId: data.id, deletedAt: data.deleted_at });
        // His current combat (2026-10-27): the stats, the fighting style and the skill clip's kind — what a style edit starts from.
        const { data: current, error: currentError } = await db.from('af_submissions').select('manifest').eq('id', data.submission_id)
          .eq('owner_id', owner).maybeSingle();
        check(currentError);
        const manifest = current?.manifest;
        return json({ ok: true, stage: 'registered', fighter: { ...data, ...(manifest ? { combat: { stats: manifest.combat?.stats ?? null,
          style: manifest.combat?.style ?? null, skill: manifest.clips?.skill?.skill?.kind ?? null } } : {}) } });
      }
      if (isWorker && method === 'POST') {
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (parts.join('/') === 'worker/claim') {
          if (body.submissionId) requireId(body.submissionId);
          const row = await rpc('af_claim', { p_id: body.submissionId ?? null });
          if (!row?.id) return json({ ok: true, stage: 'idle' });
          // The lease is five minutes; the URLs outlive it so a slow job fails on its deadline, not on a dead link.
          const urls = await signedUrls(row, 360);
          const files = row.manifest.assets.map((asset, index) => ({ ...asset, downloadUrl: urls[index] }));
          return json({ ok: true, stage: 'validating', submissionId: row.id, leaseToken: row.lease_token,
            manifestText: row.manifest_text, manifestSha256: row.manifest_sha, files });
        }
        if (parts.join('/') === 'worker/finish') {
          requireId(body.submissionId); requireId(body.leaseToken);
          if (!/^[a-f0-9]{64}$/.test(body.manifestSha256 ?? '') || typeof body.passed !== 'boolean' || !body.result || Array.isArray(body.result)) throw new Problem(400, 'invalid-result');
          const completed = await rpc('af_finish', { p_id: body.submissionId, p_lease: body.leaseToken,
            p_sha: body.manifestSha256, p_passed: body.passed, p_result: body.result });
          try { await analytics?.registered(completed); } catch { /* Analytics must never break registration. */ }
          return json(await present(completed));
        }
        // An infrastructure failure under the caller's own lease: requeue without spending one of the package's attempts.
        if (parts.join('/') === 'worker/release') {
          requireId(body.submissionId); requireId(body.leaseToken);
          if (!/^[a-z0-9-]{1,64}$/.test(body.code ?? '')) throw new Problem(400, 'invalid-release-code');
          const released = await rpc('af_release', { p_id: body.submissionId, p_lease: body.leaseToken, p_code: body.code });
          return json({ ok: true, stage: released.status === 'queued' ? 'requeued' : 'rejected' });
        }
      }
      throw new Problem(404, 'route-not-found');
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, stage: 'api', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'api', code: 'service-unavailable' }, 503);
    }
  };
}
