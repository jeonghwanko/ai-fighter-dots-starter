// 호스팅 생성 (2026-10-27): a creator asks our generation worker to make his fighter. The creator's routes (`generations/…`, his own token)
// and the worker's (`generation-worker/…`, a worker key of scope `generation`). The state machine, quotas and leases are the database's
// (`supabase/migrations/20261028100000_oddbout_hosted_generation.sql`); pictures stay in the private bucket `af-generation` and reach a reader
// only as signed URLs of ten minutes. The package the worker makes goes through the same submission checks as any other
// (`submissions.mjs`) under the creator's account — the job row names the owner, never the worker.
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { profileLimits } from '../contracts/ai-fighter/profile-limits.mjs';
import { text } from './canon.mjs';
import { probeImage } from './image-probe.mjs';
import { Problem, UUID, jsonResponse, readBody, sha256 } from './http.mjs';
import { checkedManifest, storeAsset } from './submissions.mjs';

export const GENERATION_BUCKET = 'af-generation';
export const GENERATION_LIMITS = Object.freeze({ descriptionMin: 10, description: 600, refs: 2, refBytes: 4_000_000, refSide: Object.freeze([64, 4096]),
  note: 200, artifactBytes: 8_000_000, result: 12_000, signedSeconds: 600 });
const ARTIFACT = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MOTIONS = Object.keys(spec.motions);
/** What the worker may say about one preview clip: `run-from-walk`, a run the gate refused made from the walk (2026-10-29). */
export const PREVIEW_NOTES = Object.freeze(['run-from-walk']);
const CORS = { methods: 'GET, POST, PATCH, DELETE, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key' };
// A join code (내 PC 붙이기): made by the site for a signed-in host, copied into his PC's terminal once; 160 bits, so nobody guesses one.
export const JOIN_CODE = /^ohj_[a-f0-9]{40}$/;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const workerToken = () => `afw_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
const STATUS = { 'generation-unavailable': 409, 'generation-quota': 409, 'generation-capacity': 409, 'generation-state': 409, 'revision-limit': 409,
  'fighter-quota': 409, 'lease-lost': 409, 'rate-limit': 429, 'invalid-refs': 422, 'rights-required': 422, 'invalid-answer': 422,
  'invalid-result': 422, 'not-found': 404, 'account-disabled': 403, 'invite-required': 403,
  // 커뮤니티 호스트 (2026-10-28).
  'invalid-host': 422, 'host-consent-required': 422, 'host-offline': 409, 'host-capacity': 409, 'host-terms-required': 422,
  'host-not-approved': 403, 'host-key-limit': 409, 'host-not-found': 404, 'join-code-invalid': 410, 'invalid-join-code': 400, 'host-busy': 409,
  // The submission path's own refusals (`af_create_submission`, `af_submit`), as the creator's routes name them.
  'submission-quota': 409, 'open-submission-exists': 409, 'idempotency-conflict': 409, 'upload-closed': 409, 'assets-incomplete': 409,
  'submissions-paused': 503, 'storage-budget-full': 503, 'beta-capacity': 503 };
/** Stats the contract takes: 1-5 each, summing to 9 (`contracts/ai-fighter/validate.mjs`). */
export const STAT_TOTAL = 9;

/** Is this path the hosted generation's? */
export const generationRoute = parts => parts[0] === 'generations' || parts[0] === 'generation-worker';

const id = value => { if (!UUID.test(value ?? '')) throw new Problem(400, 'invalid-id'); return value.toLowerCase(); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (body, allowed) => {
  if (!isObject(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new Problem(422, 'invalid-body');
  return body;
};
async function readJson(request, limit) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, limit))); }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
}
export const artifactPath = (job, name) => `jobs/${job}/${name}.webp`;

/**
 * The profile the creator confirms before registering: name and description (required), his fighter's names, bout lines and stats — each
 * within the v1 contract's limits. Null fields are left out; the worker fills the rest from the brief.
 */
export function confirmedProfile(value) {
  const body = fields(value, ['name', 'description', 'names', 'lines', 'stats']);
  const out = { name: text(body.name, profileLimits.name, '/profile/name', { code: 'invalid-profile' }),
    description: text(body.description, profileLimits.description, '/profile/description', { lines: true, code: 'invalid-profile' }) };
  for (const [key, allowed, max] of [['names', profileLimits.languages, profileLimits.displayName], ['lines', profileLimits.lineKeys, profileLimits.line]]) {
    if (body[key] === undefined || body[key] === null) continue;
    const part = fields(body[key], allowed), kept = {};
    for (const name of allowed) if (part[name] !== undefined && part[name] !== null && part[name] !== '')
      kept[name] = text(part[name], max, `/profile/${key}/${name}`, { code: 'invalid-profile' });
    if (Object.keys(kept).length) out[key] = kept;
  }
  if (body.stats !== undefined && body.stats !== null) {
    const stats = fields(body.stats, ['power', 'toughness', 'speed']);
    if (['power', 'toughness', 'speed'].some(key => !Number.isInteger(stats[key]) || stats[key] < 1 || stats[key] > 5)
      || stats.power + stats.toughness + stats.speed !== STAT_TOTAL) throw new Problem(422, 'invalid-profile');
    out.stats = { power: stats.power, toughness: stats.toughness, speed: stats.speed };
  }
  return out;
}

export function createGenerationHandler({ db, authenticate, present }) {
  async function call(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (!error) return data;
    const known = Object.keys(STATUS).sort((x, y) => y.length - x.length).find(code => error.message?.includes(code));
    if (known) throw new Problem(STATUS[known], known);
    throw new Problem(503, 'database-unavailable');
  }
  const bucket = () => db.storage.from(GENERATION_BUCKET);
  async function signed(paths) {
    if (!paths.length) return new Map();
    const { data, error } = await bucket().createSignedUrls(paths, GENERATION_LIMITS.signedSeconds);
    if (error || !Array.isArray(data)) throw new Problem(503, 'storage-unavailable');
    return new Map(data.filter(item => !item.error && typeof item.signedUrl === 'string').map(item => [item.path, item.signedUrl]));
  }
  const candidatesOf = row => Array.isArray(row.candidates) ? row.candidates.filter(name => ARTIFACT.test(name ?? '')) : [];
  const previewOf = row => Array.isArray(row.preview) ? row.preview.filter(p => isObject(p) && MOTIONS.includes(p.clip) && ARTIFACT.test(p.name ?? '')) : [];
  /** The hosts a job names, by id: their names (and whether official) for its creator. */
  async function hostsOf(ids) {
    const wanted = [...new Set(ids.filter(Boolean))];
    if (!wanted.length) return new Map();
    const { data, error } = await db.from('af_generation_hosts').select('id,name,official').in('id', wanted);
    if (error) throw new Problem(503, 'database-unavailable');
    return new Map((data ?? []).map(h => [h.id, { id: h.id, name: h.name, official: h.official === true }]));
  }
  // A job as its creator reads it: no lease, no prompt, no brief beyond its profile draft; pictures as signed URLs.
  // While the motions are made: the previews the worker put up as its branches passed (its latest `drafts` event, this round's).
  async function draftsOf(row) {
    if (row.status !== 'motions') return [];
    const { data, error } = await db.from('af_generation_events').select('data').eq('job_id', row.id).eq('kind', 'drafts')
      .order('at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    const round = `-${row.motion_revisions}`;
    return (Array.isArray(data?.data?.clips) ? data.data.clips : []).filter(d => isObject(d) && MOTIONS.includes(d.clip)
      && ARTIFACT.test(d.name ?? '') && d.name.startsWith('draft-') && d.name.endsWith(round)).slice(0, MOTIONS.length);
  }
  async function view(row) {
    const candidates = candidatesOf(row), preview = previewOf(row), drafts = await draftsOf(row);
    const hosts = await hostsOf([row.requested_host, row.assigned_host]);
    const urls = await signed([...candidates.map(name => artifactPath(row.id, name)), ...preview.map(p => artifactPath(row.id, p.name)),
      ...drafts.map(d => artifactPath(row.id, d.name))]);
    let submission = null;
    if (row.submission_id) {
      const { data, error } = await db.from('af_submissions').select('id,status,fighter_id').eq('id', row.submission_id).maybeSingle();
      if (error) throw new Problem(503, 'database-unavailable');
      if (data) submission = { id: data.id, stage: data.status, fighterId: data.fighter_id ?? null };
    }
    return { id: row.id, status: row.status, progress: row.progress, error: row.error_code ?? null, description: row.description, language: row.language,
      delegate: row.delegate === true, createdAt: row.created_at, updatedAt: row.updated_at, profile: row.profile ?? (isObject(row.brief?.profile) ? row.brief.profile : null),
      candidates: candidates.map((name, i) => ({ key: i === 0 ? 'a' : 'b', url: urls.get(artifactPath(row.id, name)) ?? null })), choice: row.choice ?? null,
      revisionsLeft: { appearance: 2 - row.appearance_revisions, motions: 3 - row.motion_revisions },
      preview: preview.map(p => ({ clip: p.clip, url: urls.get(artifactPath(row.id, p.name)) ?? null, ...(PREVIEW_NOTES.includes(p.note) ? { note: p.note } : {}) })),
      submission,
      drafts: drafts.map(d => ({ clip: d.clip, url: urls.get(artifactPath(row.id, d.name)) ?? null })),
      host: { choice: row.host_choice ?? 'oddbout', requested: hosts.get(row.requested_host) ?? null, assigned: hosts.get(row.assigned_host) ?? null } };
  }
  async function ownJob(owner, jobId) {
    const { data, error } = await db.from('af_generation_jobs').select('*').eq('id', id(jobId)).eq('owner_id', owner).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data) throw new Problem(404, 'not-found');
    return data;
  }
  // The job the worker holds for its submission routes: his lease, and the job registering.
  async function heldForSubmission(request, jobId) {
    const row = await call('af_generation_held', { p_id: id(jobId), p_token: id(request.headers.get('x-generation-lease')) });
    if (row.status !== 'submitting') throw new Problem(409, 'generation-state');
    return row;
  }
  async function jobSubmission(row) {
    const { data, error } = await db.from('af_submissions').select('*').eq('owner_id', row.owner_id).eq('idempotency_key', row.id).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data) throw new Problem(404, 'not-found');
    return data;
  }

  /**
   * A creator's own host (커뮤니티 호스트): his settings, whether he is on now, today's jobs and live keys, and his subscriptions as his worker
   * last checked them (`health` — the site's My agents shows them on his Codex and Grok cards). A removed host is none.
   */
  async function ownHost(owner) {
    const { data, error } = await db.from('af_generation_hosts').select('*').eq('owner_id', owner).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data || data.removed_at) return null;
    const { data: keys, error: keyError } = await db.from('af_workers').select('expires_at,enabled').eq('host_id', data.id);
    if (keyError) throw new Problem(503, 'database-unavailable');
    // On now, approved or not (not approved, he makes his own requests: 내 선수는 내 PC로).
    const live = data.enabled && Date.parse(data.worker_seen_at ?? '') > Date.now() - 180_000 && data.worker_health?.ok === true;
    const today = await call('af_generation_host_today', { p_host: data.id });
    return { id: data.id, name: data.name, approved: data.approved, enabled: data.enabled, acceptsAny: data.accepts_any, billing: data.billing,
      dailyLimit: data.daily_limit, online: live, todayLeft: Math.max(data.daily_limit - (Number(today) || 0), 0), lastSeenAt: data.worker_seen_at ?? null,
      health: { codex: data.worker_health?.codex === true, grok: data.worker_health?.grok === true,
        checkedAt: typeof data.worker_health?.at === 'string' ? data.worker_health.at : null },
      keys: (keys ?? []).filter(k => k.enabled && Date.parse(k.expires_at) > Date.now()).map(k => ({ expiresAt: k.expires_at })) };
  }
  const hostView = row => ({ id: row.id, name: row.name, approved: row.approved, enabled: row.enabled, acceptsAny: row.accepts_any,
    billing: row.billing, dailyLimit: row.daily_limit });

  async function creator(request, parts, owner) {
    const method = request.method, route = parts.join('/');
    if (route === 'generations/host') {
      if (method === 'GET') return { ok: true, host: await ownHost(owner) };
      if (method === 'POST') {
        // Applying (or renaming): his name for requesters, how he pays the providers, and his acceptance of the host terms.
        const body = fields(await readJson(request, 2000), ['name', 'billing', 'termsAccepted']);
        return { ok: true, host: hostView(await call('af_generation_host_apply', { p_owner: owner, p_name: typeof body.name === 'string' ? body.name : null,
          p_billing: body.billing ?? null, p_terms: body.termsAccepted === true })) };
      }
      if (method === 'PATCH') {
        const body = fields(await readJson(request, 2000), ['enabled', 'acceptsAny', 'dailyLimit']);
        for (const key of ['enabled', 'acceptsAny']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new Problem(422, 'invalid-host');
        if (body.dailyLimit !== undefined && !Number.isInteger(body.dailyLimit)) throw new Problem(422, 'invalid-host');
        return { ok: true, host: hostView(await call('af_generation_host_update', { p_owner: owner, p_enabled: body.enabled ?? null,
          p_accepts_any: body.acceptsAny ?? null, p_daily_limit: body.dailyLimit ?? null })) };
      }
      // 삭제 (My agents, 2026-10-28): off every list and claim, keys off; refused while a request for him is not over.
      if (method === 'DELETE') {
        const removed = await call('af_generation_host_remove', { p_owner: owner });
        return { ok: true, removed: true, revoked: Number(removed?.revoked) || 0 };
      }
    }
    if (route === 'generations/host/keys') {
      if (method === 'POST') {
        // The key is shown once, here; the database keeps its hash.
        const token = workerToken();
        const issued = await call('af_generation_host_key', { p_owner: owner, p_hash: await sha256(new TextEncoder().encode(token)),
          p_label: `host-${new Date().toISOString().slice(0, 10)}` });
        return { ok: true, key: token, host: issued.host, expiresAt: issued.expiresAt };
      }
      if (method === 'DELETE') return { ok: true, revoked: await call('af_generation_host_revoke', { p_owner: owner }) };
    }
    if (route === 'generations/host/join-codes' && method === 'POST') {
      // Shown once, here, for the host to paste into his PC (`npm run host -- join <code>`); the database keeps its hash.
      const code = `ohj_${hex(crypto.getRandomValues(new Uint8Array(20)))}`;
      const made = await call('af_generation_host_join_code', { p_owner: owner, p_hash: await sha256(new TextEncoder().encode(code)) });
      return { ok: true, code, host: made.host, expiresAt: made.expiresAt };
    }
    if (method === 'GET' && route === 'generations') {
      const { data, error } = await db.from('af_generation_jobs').select('*').eq('owner_id', owner).order('created_at', { ascending: false }).limit(5);
      if (error) throw new Problem(503, 'database-unavailable');
      const jobs = await Promise.all((data ?? []).map(view));
      // His one hosted fighter is taken by a job that is not over — a submitted package that failed its check frees it, as the database does.
      // A fighter made on his own PC (his subscription) does not use it up (내 선수는 내 PC로, 2026-10-28).
      const { data: own, error: ownError } = await db.from('af_generation_hosts').select('id').eq('owner_id', owner).maybeSingle();
      if (ownError) throw new Problem(503, 'database-unavailable');
      return { ok: true, jobs, used: jobs.some(job => !['rejected', 'failed', 'cancelled', 'expired'].includes(job.status)
        && !(job.status === 'submitted' && job.submission?.stage === 'rejected') && !(own && job.host?.requested?.id === own.id)),
        capabilities: await call('af_generation_capabilities', {}) };
    }
    if (method === 'POST' && route === 'generations/uploads') {
      const bytes = await readBody(request, GENERATION_LIMITS.refBytes), image = probeImage(bytes), [min, max] = GENERATION_LIMITS.refSide;
      if (!image) throw new Problem(415, 'image-required');
      if (image.width < min || image.height < min || image.width > max || image.height > max) throw new Problem(422, 'image-size');
      const upload = crypto.randomUUID(), path = `refs/${owner}/${upload}.${image.ext}`;
      const { error } = await bucket().upload(path, bytes, { contentType: image.type, upsert: false });
      if (error) throw new Problem(503, 'storage-unavailable');
      try {
        await call('af_generation_upload', { p_owner: owner, p_id: upload, p_path: path, p_type: image.type, p_bytes: bytes.length, p_width: image.width, p_height: image.height });
      } catch (problem) { await bucket().remove([path]).catch(() => {}); throw problem; }
      return { ok: true, upload: { id: upload, width: image.width, height: image.height } };
    }
    if (method === 'POST' && route === 'generations') {
      const key = id(request.headers.get('idempotency-key'));
      const body = fields(await readJson(request, 8000), ['description', 'language', 'refs', 'rightsConfirmed', 'delegate', 'host', 'hostConsent']);
      if (!['ko', 'en'].includes(body.language)) throw new Problem(422, 'invalid-language');
      if (body.delegate !== undefined && typeof body.delegate !== 'boolean') throw new Problem(422, 'invalid-body');
      // Where it goes (커뮤니티 호스트): ODDBOUT's own worker by default, any approved host, one host by id, or `mine` — his own host,
      // approved or not, with no consent to give (내 선수는 내 PC로, 2026-10-28).
      let host = body.host ?? 'oddbout';
      if (host === 'mine') {
        const { data: own, error: ownError } = await db.from('af_generation_hosts').select('id,removed_at').eq('owner_id', owner).maybeSingle();
        if (ownError) throw new Problem(503, 'database-unavailable');
        if (!own || own.removed_at) throw new Problem(404, 'host-not-found');
        host = own.id;
      }
      if (!['oddbout', 'any'].includes(host) && !UUID.test(host)) throw new Problem(422, 'invalid-host');
      const target = host === 'oddbout' ? {} : { p_host_choice: UUID.test(host) ? 'host' : 'any', ...(UUID.test(host) ? { p_host: host.toLowerCase() } : {}),
        p_host_consent: body.hostConsent === true };
      if (body.refs !== undefined && (!Array.isArray(body.refs) || body.refs.length > GENERATION_LIMITS.refs)) throw new Problem(422, 'invalid-refs');
      const refs = (body.refs ?? []).map(id);
      const row = await call('af_generation_create', { p_owner: owner, p_key: key,
        p_description: text(body.description, GENERATION_LIMITS.description, '/description', { min: GENERATION_LIMITS.descriptionMin, lines: true, code: 'invalid-description' }),
        p_language: body.language, p_refs: refs, p_rights: body.rightsConfirmed === true,
        // 맡기기 (2026-10-28): the worker picks the look and goes on to the motions; the creator answers once, at the end.
        ...(body.delegate ? { p_delegate: true } : {}), ...target });
      return { ok: true, job: await view(row) };
    }
    if (parts[0] === 'generations' && parts.length === 2 && method === 'GET') return { ok: true, job: await view(await ownJob(owner, parts[1])) };
    if (parts[0] === 'generations' && parts.length === 2 && method === 'DELETE')
      return { ok: true, job: await view(await call('af_generation_cancel', { p_owner: owner, p_id: id(parts[1]) })) };
    if (parts[0] === 'generations' && parts.length === 3 && method === 'POST') {
      const job = id(parts[1]);
      if (parts[2] === 'appearance') {
        const body = fields(await readJson(request, 2000), ['choose', 'revise']);
        if ((body.choose === undefined) === (body.revise === undefined)) throw new Problem(422, 'invalid-answer');
        if (body.choose !== undefined && !['a', 'b'].includes(body.choose)) throw new Problem(422, 'invalid-answer');
        const note = body.revise === undefined ? null : text(body.revise, GENERATION_LIMITS.note, '/revise', { min: 2, code: 'invalid-answer' });
        return { ok: true, job: await view(await call('af_generation_appearance', { p_owner: owner, p_id: job, p_choice: body.choose ?? null, p_note: note })) };
      }
      if (parts[2] === 'motions') {
        const body = fields(await readJson(request, 2000), ['revise']), revise = fields(body.revise, ['clip', 'note']);
        if (!MOTIONS.includes(revise.clip)) throw new Problem(422, 'invalid-answer');
        const note = text(revise.note, GENERATION_LIMITS.note, '/revise/note', { min: 2, code: 'invalid-answer' });
        return { ok: true, job: await view(await call('af_generation_motion', { p_owner: owner, p_id: job, p_clip: revise.clip, p_note: note })) };
      }
      if (parts[2] === 'register') {
        const body = fields(await readJson(request, 8000), ['profile']);
        return { ok: true, job: await view(await call('af_generation_register', { p_owner: owner, p_id: job, p_profile: confirmedProfile(body.profile) })) };
      }
    }
    throw new Problem(404, 'route-not-found');
  }

  async function worker(request, parts, host) {
    const method = request.method, route = parts.join('/');
    if (method === 'PUT' && parts[1] === 'jobs' && parts[3] === 'artifacts' && parts.length === 5) {
      const row = await call('af_generation_held', { p_id: id(parts[2]), p_token: id(request.headers.get('x-generation-lease')) });
      if (!ARTIFACT.test(parts[4])) throw new Problem(422, 'invalid-artifact');
      const bytes = await readBody(request, GENERATION_LIMITS.artifactBytes);
      if (probeImage(bytes)?.type !== 'image/webp') throw new Problem(415, 'webp-required');
      // A stage made again writes its pictures again (a new round uses new names; a retried upload replaces its own).
      const { error } = await bucket().upload(artifactPath(row.id, parts[4]), bytes, { contentType: 'image/webp', upsert: true });
      if (error) throw new Problem(503, 'storage-unavailable');
      return { ok: true, artifact: parts[4], bytes: bytes.length };
    }
    if (parts[1] === 'jobs' && parts[3] === 'submission') {
      const row = await heldForSubmission(request, parts[2]);
      if (method === 'POST' && parts.length === 4) {
        const manifest = await checkedManifest(request);
        const submission = await call('af_create_submission', { p_owner: row.owner_id, p_key: row.id, p_text: manifest.text, p_sha: manifest.sha,
          p_bytes: manifest.bytes, p_fighter: null });
        return present(submission);
      }
      if (method === 'PUT' && parts[4] === 'assets' && parts.length === 6) return storeAsset(db, await jobSubmission(row), parts[5], request);
      if (method === 'POST' && parts[4] === 'submit' && parts.length === 5)
        return present(await call('af_submit', { p_owner: row.owner_id, p_id: (await jobSubmission(row)).id }));
      throw new Problem(404, 'route-not-found');
    }
    if (method !== 'POST') throw new Problem(404, 'route-not-found');
    const body = await readJson(request, GENERATION_LIMITS.result + 2000);
    if (route === 'generation-worker/heartbeat') {
      const health = fields(body, ['health']).health;
      if (!isObject(health) || JSON.stringify(health).length > 2000) throw new Problem(422, 'invalid-health');
      return { ok: true, capabilities: await call('af_generation_host_heartbeat', { p_host: host, p_health: health }) };
    }
    // Which of this host's jobs are over for him (the worker closes their folders). A community host: his own jobs that ended. The official
    // host writes every job's brief, so it also hears of jobs that ended anywhere, and of jobs another host took after its brief (2026-10-28 —
    // the brief folder of the first test host's job stayed open on the office PC and blocked og setup).
    if (route === 'generation-worker/ended') {
      const jobs = fields(body, ['jobs']).jobs;
      if (!Array.isArray(jobs) || jobs.length > 50) throw new Problem(422, 'invalid-body');
      if (!jobs.length) return { ok: true, ended: [] };
      const ids = jobs.map(id), official = host ? null : await call('af_generation_official', {});
      const { data, error } = await db.from('af_generation_jobs').select('id,status,assigned_host').in('id', ids);
      if (error) throw new Problem(503, 'database-unavailable');
      const over = row => ['cancelled', 'expired', 'rejected', 'failed', 'submitted'].includes(row.status);
      return { ok: true, ended: (data ?? []).filter(row => host ? row.assigned_host === host && over(row)
        : over(row) || (row.assigned_host !== null && row.assigned_host !== official)).map(row => row.id) };
    }
    if (route === 'generation-worker/claim') {
      const row = await call('af_generation_claim_for', { p_host: host });
      if (!row?.id) return { ok: true, stage: 'idle' };
      const { data: refs, error } = await db.from('af_generation_uploads').select('id,path,content_type,width,height').eq('job_id', row.id);
      if (error) throw new Problem(503, 'database-unavailable');
      const candidates = candidatesOf(row);
      const urls = await signed([...(refs ?? []).map(ref => ref.path), ...candidates.map(name => artifactPath(row.id, name))]);
      return { ok: true, job: { id: row.id, status: row.status, leaseToken: row.lease_token, owner: row.owner_id, createdAt: row.created_at, description: row.description,
        language: row.language, brief: row.brief ?? null, delegate: row.delegate === true, choice: row.choice ?? null, appearanceNote: row.appearance_note ?? null,
        appearanceRound: row.appearance_revisions, motionNote: row.motion_note ?? null, motionRound: row.motion_revisions, profile: row.profile ?? null,
        refs: (refs ?? []).map(ref => ({ id: ref.id, contentType: ref.content_type, width: ref.width, height: ref.height, url: urls.get(ref.path) ?? null })),
        candidates: candidates.map((name, i) => ({ key: i === 0 ? 'a' : 'b', name, url: urls.get(artifactPath(row.id, name)) ?? null })),
        preview: previewOf(row) } };
    }
    const lease = fields(body, ['jobId', 'leaseToken', 'progress', 'event', 'outcome', 'result']);
    const at = { p_id: id(lease.jobId), p_token: id(lease.leaseToken) };
    if (route === 'generation-worker/progress') {
      if (lease.event !== undefined && (!isObject(lease.event) || JSON.stringify(lease.event).length > 2000)) throw new Problem(422, 'invalid-event');
      const row = await call('af_generation_progress', { ...at, p_progress: Number.isInteger(lease.progress) ? lease.progress : null, p_event: lease.event ?? null });
      return { ok: true, status: row.status, leaseExpiresAt: row.lease_expires_at };
    }
    if (route === 'generation-worker/finish') {
      if (!['ok', 'rejected', 'review', 'failed', 'retry'].includes(lease.outcome)) throw new Problem(422, 'invalid-result');
      const result = lease.result ?? {};
      if (!isObject(result) || JSON.stringify(result).length > GENERATION_LIMITS.result) throw new Problem(422, 'invalid-result');
      if (result.candidates !== undefined && (!Array.isArray(result.candidates) || result.candidates.some(name => !ARTIFACT.test(name ?? ''))))
        throw new Problem(422, 'invalid-result');
      if (result.choice !== undefined && !['a', 'b'].includes(result.choice)) throw new Problem(422, 'invalid-result');
      if (result.preview !== undefined && (!Array.isArray(result.preview)
        || result.preview.some(p => !isObject(p) || !MOTIONS.includes(p.clip) || !ARTIFACT.test(p.name ?? '')
          || (p.note !== undefined && !PREVIEW_NOTES.includes(p.note))))) throw new Problem(422, 'invalid-result');
      const row = await call('af_generation_finish', { ...at, p_outcome: lease.outcome, p_result: result });
      return { ok: true, status: row.status };
    }
    throw new Problem(404, 'route-not-found');
  }

  return async (request, parts) => {
    const isWorker = parts[0] === 'generation-worker';
    const json = (body, status = 200) => jsonResponse(body, status, isWorker ? undefined : CORS);
    try {
      if (request.method === 'OPTIONS' && !isWorker) return json({ ok: true });
      if (!isWorker && request.method === 'GET' && parts.join('/') === 'generations/capabilities')
        return json({ ok: true, capabilities: await call('af_generation_capabilities', {}) });
      if (!isWorker && request.method === 'GET' && parts.join('/') === 'generations/hosts')
        return json({ ok: true, hosts: await call('af_generation_hosts_public', {}) });
      // A PC trades a join code for its worker key: no account session on the PC, a host key only.
      if (!isWorker && request.method === 'POST' && parts.join('/') === 'generations/host/join') {
        const body = fields(await readJson(request, 1000), ['code']);
        if (typeof body.code !== 'string' || !JOIN_CODE.test(body.code)) throw new Problem(400, 'invalid-join-code');
        const token = workerToken();
        const joined = await call('af_generation_host_join', { p_code_hash: await sha256(new TextEncoder().encode(body.code)),
          p_key_hash: await sha256(new TextEncoder().encode(token)), p_label: `host-join-${new Date().toISOString().slice(0, 10)}` });
        return json({ ok: true, key: token, host: joined.host, name: joined.name, approved: joined.approved, expiresAt: joined.expiresAt });
      }
      // The key names the worker's host; the stages it may take are his (the official host's when the key names none).
      if (isWorker) return json(await worker(request, parts, await authenticate(request, 'generation')));
      return json(await creator(request, parts, await authenticate(request, false)));
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, stage: 'generation', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'generation', code: 'service-unavailable' }, 503);
    }
  };
}
