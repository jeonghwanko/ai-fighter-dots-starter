import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { createHandler } from '../api/handler.mjs';
import { registerFileInputProbe } from './file-input-probe.mjs';
import { Problem, UUID, bearerToken, readBody, sha256 } from '../api/http.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import schema from '../contracts/ai-fighter/v1/fighter.schema.json' with { type: 'json' };

export const CLOUD_RESOURCE = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp';
export const LEGACY_PUBLIC_RESOURCE = 'https://ai-fighter-validator.onrender.com/mcp';
export const PUBLIC_RESOURCE = 'https://mcp.oddbout.com/mcp';
export function validCloudAudience(aud) {
  const current = [CLOUD_RESOURCE, LEGACY_PUBLIC_RESOURCE, PUBLIC_RESOURCE];
  if (typeof aud === 'string') return current.includes(aud);
  if (!Array.isArray(aud) || new Set(aud).size !== aud.length) return false;
  const expected = aud.length === 2 ? [CLOUD_RESOURCE, LEGACY_PUBLIC_RESOURCE] : current;
  return aud.length === expected.length && aud.every(value => expected.includes(value));
}
export const CLOUD_ISSUER = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/auth/v1';
/** ODDBOUT's arena function (the game's `oddbout-arena`): rankings, records, cups, bout records, and the agent calls behind its key. */
export const ARENA_URL = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/oddbout-arena';
/**
 * Tools anyone may call without a connected account: the contract and ODDBOUT's public records. The agent tools (3단계, 2026-10-27) list only
 * while the arena key is configured (`ODDBOUT_ARENA_AGENT_KEY`), so a release of this code alone does not change the published tool list.
 */
export const PUBLIC_TOOLS = new Set(['get_fighter_spec', 'get_style_guide', 'list_fighters', 'get_rankings', 'get_fighter_record', 'get_cup', 'read_bout']);
/** Public tools that spend an arena budget: a signed-in caller's call counts on his owner (MCP 점검, 2026-10-27). */
export const OWNER_BUDGET_TOOLS = new Set(['read_bout']);
/**
 * How a fighter's `combat.style` reads (the game contract's README, 싸우는 성격; values in `spec.combatStyle`). An agent translates the
 * fighter's concept into these closed choices itself; the server only checks them. Grade 3 and missing values are the standard kit.
 */
export const STYLE_GUIDE = Object.freeze({
  mix: 'How often each swing is chosen, slam/combo/fast 0-4 each: slam = one heavy blow, combo = a chained string, fast = a quick jab (counted half). At least one above 0; fast at most slam + combo.',
  special: 'The swing (slam, combo or fast) used to chase an opponent who opens distance and to strike back while getting up.',
  super: 'The move used as the super: slam, combo, fast or dash.',
  distance: 'Fighting range 1-5: 1 swings up close, 5 from far.',
  shockwave: 'true: the heavy blow sends a ground shockwave.',
  summon: 'One summon called by the heavy-blow clip: crane, bolt, sportsCar or roadster.',
  temper: 'Temperament 1-5 each: guard (blocking), retreat (backing off), measure (keeping distance), patience (waiting).',
  exchanges: 'Exchange patterns 0-3 each: cross (crossing dash), pinball (rope bounces), rush (head-on clash). 0 never, 1 half, 2 standard, 3 double.',
  extras: 'The skill clip, a summon and a shockwave together: at most two (STYLE_EXTRAS).',
  skill: 'The unique skill comes from the optional skill clip (stretch, pincer, flight, feint, slide, counter, brace), fixed at registration; a style edit cannot add one.',
  translate: 'Read the fighter\'s concept, moves and lines. Pick only the choices the character clearly implies; leave the rest out. Spar before and after a change and keep the version that fights like the character.',
});
const FILE = z.object({ download_url: z.string().max(8192), file_id: z.string().min(1).max(256),
  mime_type: z.string().max(128).optional(), file_name: z.string().max(512).optional() }).strict();
/**
 * A UUID argument. zod's `uuid()` writes a 168-character pattern into every tool's schema (13 of them, 2.2 KB of each tools/list, every
 * conversation — MCP 점검 2026-10-27); the server checks the ids again (`api/http.mjs` UUID), so a short pattern is enough here.
 */
const UUID_ARG = () => z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const AUTH = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }];
const output = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value,
  ...(value.ok === false ? { isError: true } : {}) });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

// Files come from the host's fileParams capability, never arbitrary URLs or VM paths.
// Do not follow redirects: even an allowed origin must not redirect to a private network or another service.
export function allowedFileUrl(value, additionalHosts = []) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname === 'files.oaiusercontent.com' || u.hostname.endsWith('.oaiusercontent.com') ||
        u.hostname === 'files.openai.com' || additionalHosts.includes(u.hostname));
  } catch { return false; }
}
export async function downloadHostFile(file, maximum, fetcher = fetch, additionalHosts = []) {
  if (!allowedFileUrl(file.download_url, additionalHosts)) throw new Problem(400, 'unsupported-file-origin');
  const response = await fetcher(file.download_url, { redirect: 'error', signal: AbortSignal.timeout(20000), credentials: 'omit' });
  if (!response.ok) throw new Problem(400, 'file-download-unavailable');
  return readBody(response, maximum);
}

// A signed OAuth token is still insufficient without the dedicated audience, role and server-managed permission.
export async function authenticateCloud(db, request, now = Date.now) {
  const token = bearerToken(request);
  if (!token) return null;
  const { data, error } = await db.auth.getClaims(token);
  const c = data?.claims;
  if (error || !c || c.iss !== CLOUD_ISSUER || !validCloudAudience(c.aud) || c.role !== 'af_mcp' ||
    !UUID.test(c.sub ?? '') || !UUID.test(c.client_id ?? '') || !UUID.test(c.session_id ?? '') ||
    c.is_anonymous !== false || !Number.isFinite(c.exp) || c.exp * 1000 <= now() ||
    (c.nbf !== undefined && (!Number.isFinite(c.nbf) || c.nbf * 1000 > now())) || c.af_mcp !== 'registration-v1') return null;
  // Revoked OAuth grants and signed-out sessions stop writes immediately, not merely when the JWT expires.
  const { data: active, error: activeError } = await db.rpc('af_mcp_session_active', {
    p_owner: c.sub, p_session: c.session_id, p_client: c.client_id });
  if (activeError || active !== true) return null;
  return { owner: c.sub, email: c.email ?? '', claims: c };
}

export function cloudServer({ db, identity, fetcher = fetch, arena = null }) {
  const server = new McpServer({ name: 'oddbout-cloud', version: '1.0.0' }, {
    instructions: 'Create and register AI Fighter characters using the user’s own generation account. Verify get_profile matches the intended registration account, especially after adding or switching connected accounts. Call this cloud connector’s check_creation_readiness before first generation, after a workspace restart and before registration. It checks account access; generation and display still require actual host evidence. Do not run local stdio login or ask for a PC to authenticate cloud registration. Do not generate merely to test access. Require the user’s final registration request and preserve motion review boundaries. Use host file attachments for fighter.json and WebP assets. When file inputs are exposed as paths, pass existing absolute workspace paths; the host uploads them. For existing Library or Page files use the host’s supported file materialization or original-byte read tools and verify size and SHA-256 before submission. Never substitute rendered previews or invent file IDs, URLs or hashes. A VM direct-network denial does not establish failure of the native connector; use the supported host file route without bypassing network policy. Never ask for tokens or callback URLs in chat. A queued submission is not registered; inspect its status. Reuse one UUID for retries of identical bytes.' });
  // The existing API runs in-process with an identity bound to this verified request. The shim cannot be
  // selected from tool inputs and never receives/returns a privileged credential or another user's identity.
  const scoped = identity ? new Proxy(db, { get(target, key) {
    if (key === 'auth') return { getClaims: async () => ({ data: { claims: { sub: identity.owner, is_anonymous: false, role: 'authenticated' } }, error: null }) };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) : null;
  const api = createHandler({ db: scoped ?? db });
  const invoke = async (path, method = 'GET', body, headers = {}) => {
    const response = await api(new Request(`https://internal.invalid/ai-fighter/${path}`, {
      method, headers: { authorization: 'Bearer internal-request-identity', ...headers }, ...(body === undefined ? {} : { body }) }));
    return response.json();
  };
  // Which agent made a submission (`af_record_submission_agent`, 2026-10-27): the roster shows a fighter's maker. Never fails the call.
  const recordAgent = async submissionId => {
    if (!identity || !UUID.test(submissionId ?? '')) return;
    try { await db.rpc('af_record_submission_agent', { p_owner: identity.owner, p_submission: submissionId, p_client: identity.claims.client_id }); }
    catch { /* the maker is a label, not a gate */ }
  };
  const register = (name, title, description, inputSchema, run, { write = false, publish = false, openWorld = false, files = [], profile = false, publicTool = false, diagnostic = false } = {}) => {
    server.registerTool(name, { title, description, inputSchema,
      ...(profile ? { outputSchema: z.object({ id: z.string().min(1), email: z.string().optional(), nickname: z.string().optional() }).strict() } : {}),
      annotations: { ...READ, readOnlyHint: !write, openWorldHint: openWorld, destructiveHint: publish },
      _meta: { securitySchemes: publicTool ? [{ type: 'noauth' }] : AUTH,
        ...(files.length ? { 'openai/fileParams': files } : {}), ...(profile ? { 'openai/profile': true } : {}) } }, async args => {
      if (!publicTool && !identity) return { ...output({ ok: false, code: 'authentication-required' }),
        _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${CLOUD_RESOURCE}/.well-known/oauth-protected-resource"`] } };
      try {
        const result = output(await run(args));
        // A diagnostic failure is useful data; keep it readable by hosts that throw away tool errors.
        return diagnostic ? { ...result, isError: false } : result;
      }
      catch (error) { return output({ ok: false, code: error instanceof Problem ? error.message : 'cloud-operation-unavailable' }); }
    });
  };
  register('get_fighter_spec', '캐릭터 등록 규격', 'Read the fighter contract before authoring. All 11 motions and actual visual review are required. This does not generate or register.',
    { section: z.enum(['overview', 'schema', 'creation']).default('overview') }, async ({ section }) => {
      if (section === 'overview') {
        // Reuse the deployed API's registration policy instead of the offline authoring fallback.
        const result = await invoke('spec');
        if (!result.ok) return result;
        return { ...result, data: { ...result.data, registration: { ...result.data.registration,
          auth: 'google-oauth-via-cloud-connector', assetUpload: 'openai-fileParams', requiresPc: false,
          readinessTool: 'check_creation_readiness' } } };
      }
      return { ok: true, data: section === 'schema' ? schema : { steps: ['appearance review', 'locomotion review', 'attack review', 'defense/reaction review', 'optional style review (skill, entrance and victory clips, fighting style; may be skipped)', 'final review', 'prepare_fighter_registration', 'upload_fighter_asset for each pending asset', 'submit_fighter_registration', 'get_fighter_submission'],
        delivery: 'Use the current conversation’s actual image previews and approved files. A file path or a readiness flag is not a preview.',
        package: 'Produce fighter.json and assets/<id>.webp with the kit game-pack/pack commands, then pass actual host file attachments. For an existing approved package, preserve the original bytes and verify them; do not regenerate or rebuild unchanged art. Never invent measurements or hashes.',
        files: 'If the host exposes a file input as an absolute path, supply the existing workspace file. For Library or Page references, use supported materialization or an original-byte read, then verify the saved file size and SHA-256. Rendered previews are not package files. Recover existing files before any retry.',
        account: 'Use only the current user’s chosen generation account; no subscription/API billing substitution. Before registration, verify get_profile matches the intended connected registration account.',
        network: 'The native cloud connector handles registration and host file downloads; no user PC MCP or VM registration API login is needed. VM direct-network restrictions are separate from connector access; do not bypass network policy.' } };
    }, { publicTool: true });
  register('get_profile', 'ODDBOUT 연결 계정', 'Read the connected ODDBOUT account. Its opaque ID is stable across reconnections and email changes. No creation or publication.', {},
    async () => ({ id: identity.owner, ...(identity.email ? { email: identity.email } : {}), nickname: 'ODDBOUT' }), { profile: true });
  register('check_creation_readiness', '클라우드 제작·등록 연결 점검', 'Use before first generation, after a workspace restart and before registration. Checks this cloud account’s registration access without a PC or CLI login. Generation, conversation display and package review remain unverified until actual evidence exists; this call never generates.',
    { purpose: z.enum(['generation','connection','registration']).default('registration') }, async ({ purpose }) => {
      const result = await invoke('me');
      if (!result.ok) return result;
      return { ok: true, purpose, scope: 'cloud-registration-connection', account: result.account,
        registration: { status: result.account.canSubmit ? 'ready' : 'blocked', requiresPc: false, auth: 'connected-google-oauth' },
        generation: { status: 'unverified', reason: 'actual-host-generation-call-required' },
        delivery: { status: 'unverified', inputCapability: 'openai-fileParams', reason: 'actual-conversation-preview-and-file-transfer-required' },
        package: { status: 'unverified', reason: 'final-visual-review-and-package-validation-required' },
        nextCommands: [], nextAction: result.account.canSubmit ? 'Continue the user-requested review group or register the approved actual package using host file attachments. Verify generation/display separately in the current conversation.' : 'Account registration access is unavailable; inspect the account response.' };
    });
  register('list_my_fighters', '내 캐릭터', 'List only the connected user’s registered fighters.', {}, async () => {
    const { data, error } = await db.from('af_fighters').select('id,profile,status,review_state,created_at').eq('owner_id', identity.owner).is('deleted_at', null).order('created_at', { ascending: false }).limit(50);
    if (error) throw new Problem(503, 'database-unavailable'); return { ok: true, fighters: data };
  });
  const deletionRpc = async (name, args) => {
    const { data, error } = await db.rpc(name, { p_owner: identity.owner,
      p_session: identity.claims.session_id, p_client: identity.claims.client_id, ...args });
    if (error) {
      const expected = ['not-found','authentication-required','invalid-deletion-confirmation','deletion-name-mismatch',
        'deletion-confirmation-expired','fighter-changed','fighter-deleted'];
      throw new Problem(400, expected.includes(error.message) ? error.message : 'database-unavailable');
    }
    return data;
  };
  register('prepare_fighter_deletion', '캐릭터 삭제 확인', 'After a deletion request, verify ownership and return the exact account, fighter, effects and a 10-minute confirmation. This does not delete. Show the result to the user. Deletion removes the fighter from owned/public lists and new matches, frees its slot, and retains private package bytes and history. Never interpret preparation alone as approval.',
    { fighterId: UUID_ARG() }, async ({ fighterId }) => ({
      ...await deletionRpc('af_prepare_fighter_deletion', { p_fighter: fighterId }),
      account: { id: identity.owner, email: identity.email },
    }), { write: true });
  register('delete_fighter', '내 캐릭터 삭제', 'Execute only the user’s explicit deletion instruction for the exact account and fighter returned by prepare_fighter_deletion. Pass that token and exact confirmName, with confirm=true. Existing approval counts only if it unambiguously matches this unchanged fighter and deletion scope; otherwise ask first. Ownership, live session, expiry and package/profile identity are rechecked atomically. This is soft deletion: private package bytes and history remain. Retry only with identical confirmation arguments.',
    { fighterId: UUID_ARG(), confirmationToken: UUID_ARG(), confirmName: z.string().min(1).max(200), confirm: z.literal(true) },
    ({ fighterId, confirmationToken, confirmName }) => deletionRpc('af_delete_owned_fighter', {
      p_fighter: fighterId, p_token: confirmationToken, p_confirm_name: confirmName,
    }), { write: true, publish: true, openWorld: true });
  register('prepare_fighter_registration', '캐릭터 등록 준비', 'After the user requests registration and approves the final package, create/resume a private upload from the actual fighter.json file. Use a new UUID for changed package bytes and the same UUID for immutable retries. This does not publish. Return pending asset IDs for upload_fighter_asset.',
    { manifest: FILE, idempotencyKey: UUID_ARG() }, async ({ manifest, idempotencyKey }) => {
      const bytes = await downloadHostFile(manifest, spec.limits.jsonBytes, fetcher);
      const result = await invoke('submissions', 'POST', bytes, { 'content-type': 'application/json', 'idempotency-key': idempotencyKey });
      if (result.ok) await recordAgent(result.submissionId);
      if (!result.ok || result.stage !== 'uploading') return result;
      const { data, error } = await db.from('af_submissions').select('manifest').eq('id', result.submissionId).eq('owner_id', identity.owner).single();
      if (error) throw new Problem(503, 'database-unavailable');
      return { ...result, assets: data.manifest.assets.map(({ id, path, bytes, sha256 }) => ({ id, path, bytes, sha256 })) };
    }, { write: true, openWorld: true, files: ['manifest'] });
  register('upload_fighter_asset', '캐릭터 파일 전달', 'Upload one actual WebP file to your private submission. Its size and SHA-256 must match fighter.json. Repeat safely with identical bytes; never regenerate for a delivery failure.',
    { submissionId: UUID_ARG(), assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), file: FILE }, async ({ submissionId, assetId, file }) => {
      const { data: row, error } = await db.from('af_submissions').select('manifest,status,expires_at').eq('id', submissionId).eq('owner_id', identity.owner).maybeSingle();
      if (error) throw new Problem(503, 'database-unavailable'); if (!row) throw new Problem(404, 'not-found');
      if (row.status !== 'uploading' || Date.parse(row.expires_at) <= Date.now()) throw new Problem(409, 'upload-closed');
      const asset = row.manifest.assets.find(a => a.id === assetId);
      if (!asset || !Number.isSafeInteger(asset.bytes) || asset.bytes > spec.limits.assetBytes) throw new Problem(404, 'asset-not-found');
      const bytes = await downloadHostFile(file, asset.bytes, fetcher);
      if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Problem(422, 'asset-hash-or-size');
      return invoke(`submissions/${submissionId}/assets/${assetId}`, 'PUT', bytes, { 'content-type': 'image/webp' });
    }, { write: true, openWorld: true, files: ['file'] });
  register('submit_fighter_registration', '캐릭터 등록', 'Publish the user-approved uploaded package after authoritative validation. Requires the user’s explicit registration request. All asset uploads and visual reviews must be complete. Queued/validating is not registered; follow get_fighter_submission until final.',
    { submissionId: UUID_ARG() }, ({ submissionId }) => invoke(`submissions/${submissionId}/submit`, 'POST'), { write: true, publish: true, openWorld: true });
  register('get_fighter_submission', '등록 진행 상태', 'Read your submission. Only registered confirms registration; rejected contains the validation failure. Do not regenerate automatically.',
    { submissionId: UUID_ARG() }, ({ submissionId }) => invoke(`submissions/${submissionId}`));
  register('get_registered_fighter', '등록된 캐릭터 확인', 'Read your registered fighter and immutable package identity.',
    { fighterId: UUID_ARG() }, ({ fighterId }) => invoke(`fighters/${fighterId}`));
  // 에이전트 도구 (3단계, 2026-10-27): read ODDBOUT's records, spar, enter cups and tune the fighting style. Listed only with the arena key.
  if (arena?.url && arena?.key) registerAgentTools({ register, arena, db, identity, invoke, recordAgent });
  registerFileInputProbe({ register, fileSchema: FILE, identity, downloadFile: downloadHostFile, fetcher });
  return server;
}

/** One arena call: a GET, or a POST with the agent key. A network failure or a body that is not JSON is `arena-unavailable`. */
async function arenaCall(arena, path, body, owner) {
  // A read made for someone (`owner`: the connected owner, or `public`) carries the key: the arena counts it against that owner, not this
  // function's one address (MCP 점검 2026-10-27 — every agent together had six reads a minute).
  const headers = body !== undefined ? { 'content-type': 'application/json', 'x-arena-agent': arena.key }
    : owner !== undefined ? { 'x-arena-agent': arena.key, 'x-arena-owner': owner } : {};
  let response;
  try {
    response = await (arena.fetcher ?? fetch)(`${arena.url}/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: AbortSignal.timeout(20000), headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Problem(503, 'arena-unavailable'); }
  let value;
  try { value = await response.json(); } catch { throw new Problem(503, 'arena-unavailable'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Problem(503, 'arena-unavailable');
  return value;
}

function registerAgentTools({ register, arena, db, identity, invoke, recordAgent }) {
  const call = (path, body) => arenaCall(arena, path, body);
  const read = path => arenaCall(arena, path, undefined, identity?.owner ?? 'public');
  const ID = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);
  register('get_style_guide', '싸우는 성격 안내', 'Read how a fighter\'s combat.style choices fight, to translate the character\'s concept into them. Values and limits are the contract\'s (spec.combatStyle). This changes nothing.',
    {}, async () => ({ ok: true, contract: spec.combatStyle, guide: STYLE_GUIDE }), { publicTool: true });
  register('list_fighters', 'ODDBOUT 선수 명단', 'List ODDBOUT\'s fighters: the built-in roster and the listed registered fighters (id and name). Use the ids for records, spars and bouts.',
    {}, async () => {
      // The arena's list and the roster's first page at once (the two hops were 650 ms in a row).
      const [builtins, first] = await Promise.all([call('fighters'), invoke('roster')]);
      if (!builtins.ok) return builtins;
      const registered = [];
      for (let cursor = null, page = 0; page < 5; page++) {
        const list = page === 0 ? first : await invoke(`roster?after=${encodeURIComponent(cursor)}`);
        if (!list.ok) return list;
        registered.push(...list.fighters.map(({ id, name, names }) => ({ id, name, ...(names ? { names } : {}) })));
        if (!list.hasMore) break;
        cursor = list.nextCursor;
      }
      return { ok: true, rules: builtins.rules, builtin: builtins.fighters, registered };
    }, { publicTool: true });
  register('get_rankings', 'ODDBOUT 순위', 'Read the cup rankings: built-in fighters by cup points, or registered fighters by cup win rate (a minimum number of bouts).',
    { scope: z.enum(['builtin', 'registered']).default('builtin') }, ({ scope }) => call(scope === 'registered' ? 'rankings?scope=registered' : 'rankings'), { publicTool: true });
  register('get_fighter_record', '선수 공개 기록', 'Read a fighter\'s public cup record: wins, losses, recent bouts (with each cup\'s seed for read_bout) and the rivals he met most.',
    { fighterId: ID }, async ({ fighterId }) => {
      const record = await call(`fighter?id=${encodeURIComponent(fighterId)}`);
      // Each bout's package pins are 64-character hashes an agent never uses; read_bout finds them from the cup.
      return record.ok && Array.isArray(record.recent) ? { ...record, recent: record.recent.map(({ registered, ...bout }) => bout) } : record;
    }, { publicTool: true });
  register('get_cup', '컵 결과', 'Read a cup by its id (one enter_cup returned, or a week\'s): its bracket, state and every played bout with its winner and finish.',
    { cupId: UUID_ARG() }, ({ cupId }) => call(`cup?id=${cupId}`), { publicTool: true });
  register('read_bout', '경기 기록 읽기', 'Fight a bout again and read its record: who won and how, HP left, hits landed and the highlights (super, air combo, throw, wall, big hit, comeback, KO, clutch) with their times. Give a played cup bout (cupId, round 0-3, slot) or a pair and seed (current packages). The page link plays it in the browser.',
    { cupId: UUID_ARG().optional(), round: z.number().int().min(0).max(3).optional(), slot: z.number().int().min(0).max(7).optional(),
      a: ID.optional(), b: ID.optional(), seed: z.number().int().min(0).max(0xffffffff).optional() },
    async ({ cupId, round, slot, a, b, seed }) => {
      if (cupId !== undefined && round !== undefined && slot !== undefined) return read(`bout?cup=${cupId}&round=${round}&slot=${slot}`);
      if (a !== undefined && b !== undefined && seed !== undefined) return read(`bout?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&seed=${seed}`);
      return { ok: false, code: 'invalid-bout' };
    }, { publicTool: true });
  register('spar', '스파링', 'Spar: one bout between two fighters on their current packages, read back with its record (as read_bout). Not ranked and not kept. Use it to see how a fighter fights, before and after a style change. Give a seed to fight the same bout again.',
    { fighterId: ID, opponentId: ID, seed: z.number().int().min(0).max(0xffffffff).optional() },
    ({ fighterId, opponentId, seed }) => call('agent/spar', { owner: identity.owner, a: fighterId, b: opponentId, ...(seed === undefined ? {} : { seed }) }));
  register('enter_cup', '16강 컵 출전', 'Enter the connected user\'s registered fighter in a 16-fighter cup. The server draws the other fifteen from the built-in roster and fights every bout; the results count in the cup rankings. Requires the user\'s request. Returns the finished cup (a few seconds); if it is still running, read it with get_cup.',
    { fighterId: UUID_ARG() }, async ({ fighterId }) => {
      const issued = await call('agent/cup', { owner: identity.owner, fighter: fighterId });
      if (!issued.ok) return issued;
      // A cup is fought in about seven seconds: wait for it here so the agent needs no second call (MCP 점검 2026-10-27).
      for (let i = 0; i < (arena.pollTries ?? 12); i++) {
        await new Promise(done => setTimeout(done, arena.pollMs ?? 1000));
        const cup = await call(`cup?id=${issued.ticket}`).catch(() => null);
        if (cup?.ok && cup.cup && cup.cup.state !== 'open') return { ...issued, cup: cup.cup };
      }
      return { ...issued, state: 'open', next: 'get_cup' };
    }, { write: true, openWorld: true });
  register('update_fighter_style', '싸우는 성격 고치기', 'Change the connected user\'s registered fighter\'s fighting style (combat.style) without new art: an object replaces it, null removes it. Checked against the contract (get_style_guide). His next bouts fight the new style. Requires the user\'s approval of the change. Use a new UUID per change and the same UUID to retry it.',
    { fighterId: UUID_ARG(), style: z.union([z.record(z.string(), z.unknown()), z.null()]), idempotencyKey: UUID_ARG() },
    async ({ fighterId, style, idempotencyKey }) => {
      const { data: fighter, error } = await db.from('af_fighters').select('manifest_sha').eq('id', fighterId).eq('owner_id', identity.owner)
        .is('deleted_at', null).maybeSingle();
      if (error) throw new Problem(503, 'database-unavailable');
      if (!fighter) throw new Problem(404, 'fighter-not-found');
      const result = await invoke(`fighters/${fighterId}/profile`, 'PATCH', JSON.stringify({ expectedManifestSha256: fighter.manifest_sha, style }),
        { 'content-type': 'application/json', 'idempotency-key': idempotencyKey });
      if (result.ok) await recordAgent(result.submissionId);
      return result;
    }, { write: true, publish: true, openWorld: true });
}

export function createCloudHandler({ db, fetcher = fetch, arena = null }) {
  return async request => {
    const url = new URL(request.url);
    // The Edge gateway may strip /functions/v1 and replace the origin before forwarding.
    const segments = url.pathname.split('/').filter(Boolean), prefix = segments.indexOf('ai-fighter-mcp');
    const route = (prefix < 0 ? segments : segments.slice(prefix + 1)).join('/');
    const requestedResource = request.headers.get('x-oddbout-public-resource');
    const resource = [PUBLIC_RESOURCE, LEGACY_PUBLIC_RESOURCE].includes(requestedResource) ? requestedResource : CLOUD_RESOURCE;
    const metadataUrl = `${resource}/.well-known/oauth-protected-resource`;
    if (route === '.well-known/oauth-protected-resource' && request.method === 'GET') return json({ resource,
      authorization_servers: [CLOUD_ISSUER], scopes_supported: ['openid', 'email', 'profile'],
      resource_name: 'ODDBOUT character registration', resource_documentation: 'https://oddbout.com/docs.html' });
    if (route) return json({ error: 'not_found' }, 404);
    if (request.headers.has('origin') && !['https://chatgpt.com','https://chat.openai.com','https://platform.openai.com','https://oddbout.com'].includes(request.headers.get('origin')))
      return json({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': request.headers.get('origin') ?? 'https://chatgpt.com',
      'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version',
      'access-control-expose-headers': 'WWW-Authenticate' } });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 65536))); }
    catch { return json({ error: 'invalid_request' }, 400); }
    if (!body || Array.isArray(body) || typeof body.method !== 'string') return json({ error: 'invalid_request' }, 400);
    let identity = null;
    if (body.method === 'tools/call' && !PUBLIC_TOOLS.has(body.params?.name)) {
      try { identity = await authenticateCloud(db, request); } catch { /* fail closed */ }
      if (!identity) return json({ error: 'invalid_token' }, 401, { 'www-authenticate': `Bearer resource_metadata="${metadataUrl}", scope="openid email profile"` });
    } else if (body.method === 'tools/call' && OWNER_BUDGET_TOOLS.has(body.params?.name) && request.headers.has('authorization')) {
      // A public tool whose budget is the caller's: a valid token counts it on its owner; anything else on every signed-out agent.
      try { identity = await authenticateCloud(db, request); } catch { identity = null; }
    }
    const server = cloudServer({ db, identity, fetcher, arena });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      // SDK 1.32 serializes custom auth metadata only in _meta. Publish the current host's top-level contract too.
      if (body.method === 'tools/list' && response.status === 200) {
        const result = await response.json();
        for (const tool of result.result?.tools ?? []) {
          tool.securitySchemes = tool._meta.securitySchemes;
          // Every schema names its JSON Schema draft (1.1 KB of each list, every conversation); hosts do not need it.
          delete tool.inputSchema?.$schema; delete tool.outputSchema?.$schema;
        }
        return json(result);
      }
      return response;
    } catch { return json({ error: 'mcp_unavailable' }, 503); }
    finally { await server.close(); }
  };
}
