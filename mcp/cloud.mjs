import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { createHandler } from '../api/handler.mjs';
import { Problem, UUID, bearerToken, readBody } from '../api/http.mjs';
import { registerFileInputProbe } from './file-input-probe.mjs';
import { registerCreatorSources } from './creator-sources.mjs';
import { AUTH, FILE, READ, downloadHostFile, output } from './cloud/common.mjs';
import { registerRegistrationTools } from './cloud/registration-tools.mjs';
import { registerAgentTools } from './cloud/agent-tools.mjs';
import { registerWorkshopTools } from './cloud/workshop-tools.mjs';
import { HOSTED_INSTRUCTIONS, registerHostedTools } from './cloud/hosted-tools.mjs';
// The cloud MCP's tool families live in ./cloud/ (Edge-only, as this file); these names are this module's as before.
export { allowedFileUrl, compactText, downloadHostFile } from './cloud/common.mjs';
export { STYLE_GUIDE } from './cloud/agent-tools.mjs';
export { HOSTED_WAIT_SECONDS, hostedNext } from './cloud/hosted-tools.mjs';

export const CLOUD_RESOURCE = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp';
export const LEGACY_PUBLIC_RESOURCE = 'https://ai-fighter-validator.onrender.com/mcp';
export const PUBLIC_RESOURCE = 'https://mcp.oddbout.com/mcp';
/**
 * Sign-in first (2026-10-28): the same server at `<function>/signin` asks every request for a sign-in, not only the account tools. Grok's custom
 * connector has no option for it: it decides at its first request whether a server needs one. At mcp.oddbout.com the public tools answer signed
 * out (ChatGPT relies on that), so Grok connected without an account and never offered the sign-in. Its tokens carry the same audience.
 */
export const SIGN_IN_RESOURCE = `${CLOUD_RESOURCE}/signin`;
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
export const PUBLIC_TOOLS = new Set(['get_fighter_spec', 'get_style_guide', 'list_fighters', 'get_rankings', 'get_fighter_record', 'get_cup', 'read_bout',
  'get_fighter_story', 'get_world', 'list_generation_hosts']);
/** Public tools that spend an arena budget: a signed-in caller's call counts on his owner (MCP 점검, 2026-10-27). */
export const OWNER_BUDGET_TOOLS = new Set(['read_bout']);
/** A host's own anonymous user id (`_meta["openai/subject"]` — the Apps SDK sends it "for the purposes of rate limiting"), as a UUID-shaped key. */
async function subjectKey(subject) {
  if (typeof subject !== 'string' || !subject || subject.length > 200) return null;
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`openai-subject:${subject}`))),
    byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

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

export function cloudServer({ db, identity, fetcher = fetch, arena = null, hosted = null, host = {} }) {
  const server = new McpServer({ name: 'oddbout-cloud', version: '1.0.0' }, {
    instructions: (hosted ? HOSTED_INSTRUCTIONS : '') + 'For creation in the user’s workspace, use the user’s own generation account. Verify get_profile matches the intended registration account, especially after adding or switching connected accounts. Call this cloud connector’s check_creation_readiness before first generation, after a workspace restart and before registration. It checks account access; generation and display still require actual host evidence. Do not run local stdio login or ask for a PC to authenticate cloud registration. Do not generate merely to test access. Require the user’s final registration request and preserve motion review boundaries. Use host file attachments for fighter.json and WebP assets. When file inputs are exposed as paths, pass existing absolute workspace paths; the host uploads them. For existing Library or Page files use the host’s supported file materialization or original-byte read tools and verify size and SHA-256 before submission. Never substitute rendered previews or invent file IDs, URLs or hashes. A VM direct-network denial does not establish failure of the native connector; use the supported host file route without bypassing network policy. Never ask for tokens or callback URLs in chat. A queued submission is not registered; inspect its status. Reuse one UUID for retries of identical bytes.' });
  // The existing API runs in-process with an identity bound to this verified request. The shim cannot be
  // selected from tool inputs and never receives/returns a privileged credential or another user's identity.
  const scoped = identity ? new Proxy(db, { get(target, key) {
    if (key === 'auth') return { getClaims: async () => ({ data: { claims: { sub: identity.owner, is_anonymous: false, role: 'authenticated' } }, error: null }) };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) : null;
  // The workshop labels what this client writes (made with); the in-process API takes its OAuth client from the verified token only.
  const api = createHandler({ db: scoped ?? db, agentClient: identity?.claims.client_id ?? null });
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
  // A write states whether repeating it with the same arguments is safe (idempotentHint). It once defaulted to yes, and three tools that
  // make something new on every call told retrying clients they could repeat them (MCP 점검 2026-10-29).
  const register = (name, title, description, inputSchema, run, { write = false, publish = false, openWorld = false, idempotent = write ? undefined : true, files = [], profile = false, publicTool = false, diagnostic = false } = {}) => {
    if (typeof idempotent !== 'boolean') throw Error(`${name}: a write tool states idempotent`);
    server.registerTool(name, { title, description, inputSchema,
      ...(profile ? { outputSchema: z.object({ id: z.string().min(1), email: z.string().optional(), nickname: z.string().optional() }).strict() } : {}),
      annotations: { ...READ, readOnlyHint: !write, openWorldHint: openWorld, destructiveHint: publish, idempotentHint: idempotent },
      _meta: { securitySchemes: publicTool ? [{ type: 'noauth' }] : AUTH,
        ...(files.length ? { 'openai/fileParams': files } : {}), ...(profile ? { 'openai/profile': true } : {}) } }, async args => {
      if (!publicTool && !identity) return { ...output({ ok: false, code: 'authentication-required' }),
        _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${CLOUD_RESOURCE}/.well-known/oauth-protected-resource"`] } };
      try {
        const result = output(await run(args), host.compact === true);
        // A diagnostic failure is useful data; keep it readable by hosts that throw away tool errors.
        return diagnostic ? { ...result, isError: false } : result;
      }
      catch (error) { return output({ ok: false, code: error instanceof Problem ? error.message : 'cloud-operation-unavailable' }); }
    });
  };
  registerRegistrationTools({ register, db, identity, invoke, fetcher, recordAgent });
  // 에이전트 도구 (3단계, 2026-10-27): read ODDBOUT's records, spar, enter cups and tune the fighting style. Listed only with the arena key.
  if (arena?.url && arena?.key) {
    registerAgentTools({ register, arena, db, identity, invoke, recordAgent, caller: host.caller ?? null });
    registerWorkshopTools({ register, arena, invoke });
  }
  if (hosted) registerHostedTools({ register, db, identity, invoke, fetcher, hosted });
  registerFileInputProbe({ register, fileSchema: FILE, identity, downloadFile: downloadHostFile, fetcher });
  registerCreatorSources({ register, fileSchema: FILE, identity, db, downloadFile: downloadHostFile, fetcher });
  return server;
}

/** Browser calls are taken from the agents that connect (ChatGPT, Grok, Cursor, Claude) and ODDBOUT's own site; a call with no origin is not a browser's. */
const ALLOWED_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com', 'https://platform.openai.com', 'https://oddbout.com',
  'https://grok.com', 'https://www.grok.com', 'https://cursor.com', 'https://www.cursor.com', 'https://claude.ai', 'https://claude.com']);

/**
 * Where a request goes: its route under the function, whether it came to the sign-in-first address, and the resource its OAuth metadata
 * names (the sign-in-first address, the public address the gateway says it came through, or the function's own).
 * @param {Request} request
 */
function routeOf(request) {
  // The Edge gateway may strip /functions/v1 and replace the origin before forwarding.
  const segments = new URL(request.url).pathname.split('/').filter(Boolean), prefix = segments.indexOf('ai-fighter-mcp');
  const path = prefix < 0 ? segments : segments.slice(prefix + 1), signInFirst = path[0] === 'signin';
  const requestedResource = request.headers.get('x-oddbout-public-resource') ?? '';
  const resource = signInFirst ? SIGN_IN_RESOURCE
    : [PUBLIC_RESOURCE, LEGACY_PUBLIC_RESOURCE].includes(requestedResource) ? requestedResource : CLOUD_RESOURCE;
  return { route: (signInFirst ? path.slice(1) : path).join('/'), signInFirst, resource };
}

/**
 * The verified identity a call runs as: needed at the sign-in-first address and for account tools (false when there is none), tried for a
 * public tool whose budget is the caller's (a valid token counts it on its owner, anything else on every signed-out agent), else null.
 * @param {any} db @param {Request} request @param {any} body @param {boolean} signInFirst
 */
async function identityFor(db, request, body, signInFirst) {
  const tool = body.method === 'tools/call' ? body.params?.name : null;
  if (signInFirst || (tool !== null && !PUBLIC_TOOLS.has(tool))) return (await authenticateCloud(db, request).catch(() => null)) ?? false;
  if (OWNER_BUDGET_TOOLS.has(tool) && request.headers.has('authorization')) return authenticateCloud(db, request).catch(() => null);
  return null;
}

/**
 * ChatGPT's calls carry its own `_meta` (`openai/locale`, `openai/subject`, …): it reads the structured result, so the text can be short,
 * and its anonymous user is a read budget.
 * @param {any} body
 */
async function hostOf(body) {
  const meta = body.params?._meta && typeof body.params._meta === 'object' ? body.params._meta : {};
  return { compact: Object.keys(meta).some(key => key.startsWith('openai/')), caller: await subjectKey(meta['openai/subject']) };
}

/**
 * The tool list as hosts read it. SDK 1.32 serializes custom auth metadata only in _meta: publish the current host's top-level contract too.
 * Every schema names its JSON Schema draft (1.1 KB of each list, every conversation); hosts do not need it.
 * @param {any} result
 */
function publishedToolList(result) {
  for (const tool of result.result?.tools ?? []) {
    tool.securitySchemes = tool._meta.securitySchemes;
    delete tool.inputSchema?.$schema; delete tool.outputSchema?.$schema;
  }
  return result;
}

/**
 * Keep optional integrations typed at the TypeScript Edge entry boundary: a null default alone
 * makes Deno infer that only null is accepted, even when the integration is configured.
 * @param {object} options
 * @param {import('@supabase/supabase-js').SupabaseClient} options.db
 * @param {typeof fetch} [options.fetcher]
 * @param {{url: string, key: string, fetcher?: typeof fetch, cupWaitMs?: number, pollMs?: number, pollTries?: number} | null} [options.arena]
 * @param {{pollMs?: number} | null} [options.hosted]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createCloudHandler({ db, fetcher = fetch, arena = null, hosted = null }) {
  return async request => {
    const { route, signInFirst, resource } = routeOf(request);
    if (route === '.well-known/oauth-protected-resource' && request.method === 'GET') return json({ resource,
      authorization_servers: [CLOUD_ISSUER], scopes_supported: ['openid', 'email', 'profile'],
      resource_name: 'ODDBOUT character registration', resource_documentation: 'https://oddbout.com/docs.html' });
    if (route) return json({ error: 'not_found' }, 404);
    const origin = request.headers.get('origin');
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': origin ?? 'https://chatgpt.com',
      'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version',
      'access-control-expose-headers': 'WWW-Authenticate' } });
    const unauthorized = () => json({ error: 'invalid_token' }, 401,
      { 'www-authenticate': `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", scope="openid email profile"` });
    if (request.method !== 'POST') {
      // A client that probes the sign-in-first address with GET, or HEAD as Gemini CLI does first (2026-10-29), learns there that it needs a sign-in.
      if (signInFirst && ['GET', 'HEAD'].includes(request.method) && !(await authenticateCloud(db, request).catch(() => null))) return unauthorized();
      return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
    }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 65536))); }
    catch { return json({ error: 'invalid_request' }, 400); }
    if (!body || Array.isArray(body) || typeof body.method !== 'string') return json({ error: 'invalid_request' }, 400);
    const identity = await identityFor(db, request, body, signInFirst);
    if (identity === false) return unauthorized();
    // A server per request on purpose: its tools close over this request's verified identity, so no state can carry one
    // user's identity into another's call. Measured 2026-10-28: building it with all tools and answering tools/list
    // takes about 1.8 ms, small beside the network hop, so sharing a server is not worth that guarantee.
    const server = cloudServer({ db, identity, fetcher, arena, hosted, host: await hostOf(body) });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      if (body.method === 'tools/list' && response.status === 200) return json(publishedToolList(await response.json()));
      return response;
    } catch { return json({ error: 'mcp_unavailable' }, 503); }
    finally { await server.close(); }
  };
}
