// The cloud MCP's shared pieces: tool argument schemas and annotations, results as hosts read them, host file downloads and arena calls.
import { z } from 'zod';
import { Problem, readBody } from '../../api/http.mjs';

export const FILE = z.object({ download_url: z.string().max(8192), file_id: z.string().min(1).max(256),
  mime_type: z.string().max(128).optional(), file_name: z.string().max(512).optional() }).strict();
/**
 * A UUID argument. zod's `uuid()` writes a 168-character pattern into every tool's schema (13 of them, 2.2 KB of each tools/list, every
 * conversation — MCP 점검 2026-10-27); the server checks the ids again (`api/http.mjs` UUID), so a short pattern is enough here.
 */
export const UUID_ARG = () => z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const AUTH = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }];
export const output = (value, compact = false) => ({ content: [{ type: 'text', text: compact ? compactText(value) : JSON.stringify(value) }], structuredContent: value,
  ...(value.ok === false ? { isError: true } : {}) });
/**
 * A result's text for a host that also reads its structured content (ChatGPT — the Apps SDK hands the model both): the JSON again doubled
 * every result in the conversation (MCP 점검, 2026-10-27; the contract schema is 24 KB). A small result or a failure stays whole; a large one
 * says where its fields are. Other hosts read only the text and keep the whole JSON.
 */
export function compactText(value) {
  const text = JSON.stringify(value);
  if (text.length <= 1200 || value?.ok === false) return text;
  const parts = Object.entries(value).map(([key, item]) => Array.isArray(item) ? `${key}[${item.length}]`
    : item && typeof item === 'object' ? `${key}{${Object.keys(item).slice(0, 8).join(',')}${Object.keys(item).length > 8 ? ',…' : ''}}`
      : `${key}=${(JSON.stringify(item) ?? String(item)).slice(0, 40)}`);
  return `Full result in structuredContent (${text.length} characters): ${parts.join(', ')}`;
}

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

/** One arena call: a GET, or a POST with the agent key. A network failure or a body that is not JSON is `arena-unavailable`. */
export const CUP_WAIT_MS = 25_000;
export async function arenaCall(arena, path, body, owner, timeoutMs = 20000) {
  // A read made for someone (`owner`: the connected owner, or `public`) carries the key: the arena counts it against that owner, not this
  // function's one address (MCP 점검 2026-10-27 — every agent together had six reads a minute).
  const headers = body !== undefined ? { 'content-type': 'application/json', 'x-arena-agent': arena.key }
    : owner !== undefined ? { 'x-arena-agent': arena.key, 'x-arena-owner': owner } : {};
  let response;
  try {
    response = await (arena.fetcher ?? fetch)(`${arena.url}/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs), headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Problem(503, 'arena-unavailable'); }
  let value;
  try { value = await response.json(); } catch { throw new Problem(503, 'arena-unavailable'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Problem(503, 'arena-unavailable');
  return value;
}
