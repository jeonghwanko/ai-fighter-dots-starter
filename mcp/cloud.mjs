import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { createHandler } from '../api/handler.mjs';
import { Problem, UUID, bearerToken, readBody, sha256 } from '../api/http.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import schema from '../contracts/ai-fighter/v1/fighter.schema.json' with { type: 'json' };

export const CLOUD_RESOURCE = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp';
export const PUBLIC_RESOURCE = 'https://ai-fighter-validator.onrender.com/mcp';
export function validCloudAudience(aud) {
  return aud === CLOUD_RESOURCE || aud === PUBLIC_RESOURCE || (Array.isArray(aud) && aud.length === 2 &&
    new Set(aud).size === 2 && aud.every(value => [CLOUD_RESOURCE, PUBLIC_RESOURCE].includes(value)));
}
export const CLOUD_ISSUER = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/auth/v1';
const FILE = z.object({ download_url: z.string().max(8192), file_id: z.string().min(1).max(256),
  mime_type: z.string().max(128).optional(), file_name: z.string().max(512).optional() }).strict();
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const AUTH = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }];
const output = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value,
  ...(value.ok === false ? { isError: true } : {}) });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

// Files come from the host's fileParams capability, never arbitrary URLs or VM paths.
// Do not follow redirects: even an allowed origin must not redirect to a private network or another service.
export function allowedFileUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname === 'files.oaiusercontent.com' || u.hostname.endsWith('.oaiusercontent.com') || u.hostname === 'files.openai.com');
  } catch { return false; }
}
export async function downloadHostFile(file, maximum, fetcher = fetch) {
  if (!allowedFileUrl(file.download_url)) throw new Problem(400, 'unsupported-file-origin');
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

export function cloudServer({ db, identity, fetcher = fetch }) {
  const server = new McpServer({ name: 'oddbout-cloud', version: '1.0.0' }, {
    instructions: 'Create and register AI Fighter characters using the user’s own generation account. Call this cloud connector’s check_creation_readiness before first generation, after a workspace restart and before registration. It checks account access; generation and display still require actual host evidence. Do not run local stdio login or ask for a PC to authenticate cloud registration. Do not generate merely to test access. Require the user’s final registration request and preserve motion review boundaries. Use host file attachments for fighter.json and WebP assets. Never ask for tokens or callback URLs in chat. A queued submission is not registered; inspect its status. Reuse one UUID for retries of identical bytes.' });
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
  const register = (name, title, description, inputSchema, run, { write = false, publish = false, files = [], profile = false, publicTool = false } = {}) => {
    server.registerTool(name, { title, description, inputSchema,
      ...(profile ? { outputSchema: z.object({ id: z.string().min(1), email: z.string().optional(), nickname: z.string().optional() }).strict() } : {}),
      annotations: { ...READ, readOnlyHint: !write, openWorldHint: write, destructiveHint: publish },
      _meta: { securitySchemes: publicTool ? [{ type: 'noauth' }] : AUTH,
        ...(files.length ? { 'openai/fileParams': files } : {}), ...(profile ? { 'openai/profile': true } : {}) } }, async args => {
      if (!publicTool && !identity) return { ...output({ ok: false, code: 'authentication-required' }),
        _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${CLOUD_RESOURCE}/.well-known/oauth-protected-resource"`] } };
      try { return output(await run(args)); }
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
      return { ok: true, data: section === 'schema' ? schema : { steps: ['appearance review', 'locomotion review', 'attack review', 'defense/reaction review', 'final review', 'prepare_fighter_registration', 'upload_fighter_asset for each pending asset', 'submit_fighter_registration', 'get_fighter_submission'],
        account: 'Use only the current user’s chosen generation account; no subscription/API billing substitution.',
        delivery: 'Use the current conversation’s actual image previews and approved files. A file path or a readiness flag is not a preview.',
        package: 'Produce fighter.json and assets/<id>.webp with the kit game-pack/pack commands, then pass actual host file attachments. Never invent measurements or hashes.',
        network: 'The cloud connector handles registration and host file downloads; no user PC MCP or VM registration API login is needed.' } };
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
    const { data, error } = await db.from('af_fighters').select('id,profile,status,review_state,created_at').eq('owner_id', identity.owner).order('created_at', { ascending: false }).limit(50);
    if (error) throw new Problem(503, 'database-unavailable'); return { ok: true, fighters: data };
  });
  register('prepare_fighter_registration', '캐릭터 등록 준비', 'After the user requests registration and approves the final package, create/resume a private upload from the actual fighter.json file. Use a new UUID for changed package bytes and the same UUID for immutable retries. This does not publish. Return pending asset IDs for upload_fighter_asset.',
    { manifest: FILE, idempotencyKey: z.string().uuid() }, async ({ manifest, idempotencyKey }) => {
      const bytes = await downloadHostFile(manifest, spec.limits.jsonBytes, fetcher);
      const result = await invoke('submissions', 'POST', bytes, { 'content-type': 'application/json', 'idempotency-key': idempotencyKey });
      if (!result.ok || result.stage !== 'uploading') return result;
      const { data, error } = await db.from('af_submissions').select('manifest').eq('id', result.submissionId).eq('owner_id', identity.owner).single();
      if (error) throw new Problem(503, 'database-unavailable');
      return { ...result, assets: data.manifest.assets.map(({ id, path, bytes, sha256 }) => ({ id, path, bytes, sha256 })) };
    }, { write: true, files: ['manifest'] });
  register('upload_fighter_asset', '캐릭터 파일 전달', 'Upload one actual WebP file to your private submission. Its size and SHA-256 must match fighter.json. Repeat safely with identical bytes; never regenerate for a delivery failure.',
    { submissionId: z.string().uuid(), assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), file: FILE }, async ({ submissionId, assetId, file }) => {
      const { data: row, error } = await db.from('af_submissions').select('manifest,status,expires_at').eq('id', submissionId).eq('owner_id', identity.owner).maybeSingle();
      if (error) throw new Problem(503, 'database-unavailable'); if (!row) throw new Problem(404, 'not-found');
      if (row.status !== 'uploading' || Date.parse(row.expires_at) <= Date.now()) throw new Problem(409, 'upload-closed');
      const asset = row.manifest.assets.find(a => a.id === assetId);
      if (!asset || !Number.isSafeInteger(asset.bytes) || asset.bytes > spec.limits.assetBytes) throw new Problem(404, 'asset-not-found');
      const bytes = await downloadHostFile(file, asset.bytes, fetcher);
      if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Problem(422, 'asset-hash-or-size');
      return invoke(`submissions/${submissionId}/assets/${assetId}`, 'PUT', bytes, { 'content-type': 'image/webp' });
    }, { write: true, files: ['file'] });
  register('submit_fighter_registration', '캐릭터 등록', 'Publish the user-approved uploaded package after authoritative validation. Requires the user’s explicit registration request. All asset uploads and visual reviews must be complete. Queued/validating is not registered; follow get_fighter_submission until final.',
    { submissionId: z.string().uuid() }, ({ submissionId }) => invoke(`submissions/${submissionId}/submit`, 'POST'), { write: true, publish: true });
  register('get_fighter_submission', '등록 진행 상태', 'Read your submission. Only registered confirms registration; rejected contains the validation failure. Do not regenerate automatically.',
    { submissionId: z.string().uuid() }, ({ submissionId }) => invoke(`submissions/${submissionId}`));
  register('get_registered_fighter', '등록된 캐릭터 확인', 'Read your registered fighter and immutable package identity.',
    { fighterId: z.string().uuid() }, ({ fighterId }) => invoke(`fighters/${fighterId}`));
  return server;
}

export function createCloudHandler({ db, fetcher = fetch }) {
  return async request => {
    const url = new URL(request.url);
    // The Edge gateway may strip /functions/v1 and replace the origin before forwarding.
    const segments = url.pathname.split('/').filter(Boolean), prefix = segments.indexOf('ai-fighter-mcp');
    const route = (prefix < 0 ? segments : segments.slice(prefix + 1)).join('/');
    const resource = request.headers.get('x-oddbout-public-resource') === PUBLIC_RESOURCE ? PUBLIC_RESOURCE : CLOUD_RESOURCE;
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
    if (body.method === 'tools/call' && body.params?.name !== 'get_fighter_spec') {
      try { identity = await authenticateCloud(db, request); } catch { /* fail closed */ }
      if (!identity) return json({ error: 'invalid_token' }, 401, { 'www-authenticate': `Bearer resource_metadata="${metadataUrl}", scope="openid email profile"` });
    }
    const server = cloudServer({ db, identity, fetcher });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      // SDK 1.32 serializes custom auth metadata only in _meta. Publish the current host's top-level contract too.
      if (body.method === 'tools/list' && response.status === 200) {
        const result = await response.json();
        for (const tool of result.result?.tools ?? []) tool.securitySchemes = tool._meta.securitySchemes;
        return json(result);
      }
      return response;
    } catch { return json({ error: 'mcp_unavailable' }, 503); }
    finally { await server.close(); }
  };
}
