import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** The public AI Fighter creator homepage: the only non-loopback page a sign-in link may open. */
export const PUBLIC_CREATOR_PAGE = 'https://rupin.pryzm.gg/creator.html';
const TTL_MS = 300_000;

/** The page a link opens: the public homepage, or a loopback HTTP homepage for local development. */
export function creatorPage(value = PUBLIC_CREATOR_PAGE) {
  const url = new URL(value);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((!loopback && url.href !== PUBLIC_CREATOR_PAGE) || url.username || url.password || url.search || url.hash
    || url.pathname !== '/creator.html') throw new Error('creator-page-not-allowed');
  return { origin: url.origin, href: url.href };
}

/**
 * One-use exchange: the page posts the code from its link to this loopback server and gets an access token.
 * The refresh token never leaves the session file. Only the page's exact origin may call it, once, within the TTL.
 */
export function createHandoff({ origin, loadAccess, onConsumed = () => {}, code = randomBytes(32).toString('hex'), now = Date.now, ttlMs = TTL_MS }) {
  const expires = now() + ttlMs;
  let consumed = false;
  const respond = (status, body, allowed = false) => new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    // A public https page calling 127.0.0.1 is a local-network request; Chrome's preflight asks for this opt-in.
    ...(allowed ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true' } : {}),
  } });
  return { code, expires, async handle(request) {
    const target = new URL(request.url);
    if (target.hostname !== '127.0.0.1' || request.headers.get('origin') !== origin) return respond(403, { error: 'origin-denied' });
    if (target.pathname !== '/exchange') return respond(404, { error: 'not-found' }, true);
    if (request.method === 'OPTIONS') return respond(200, { ok: true }, true);
    if (request.method !== 'POST' || request.headers.get('content-type') !== 'application/json') return respond(405, { error: 'post-json-required' }, true);
    if (consumed || now() >= expires) return respond(410, { error: 'link-expired' }, true);
    let candidate;
    try { candidate = (await request.json()).code; } catch { return respond(400, { error: 'invalid-code' }, true); }
    if (typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate)
      || !timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) return respond(403, { error: 'invalid-code' }, true);
    if (consumed || now() >= expires) return respond(410, { error: 'link-expired' }, true);
    consumed = true;
    try {
      const access = await loadAccess();
      // Explicit allowlist: a session object must never pass its refresh token through.
      return respond(200, { url: access.url, accessToken: access.accessToken, expiresAt: access.expiresAt }, true);
    } catch { return respond(401, { error: 'dot-sign-in-required' }, true); }
    finally { onConsumed(); }
  } };
}

/** Starts the exchange on a free loopback port and returns the one-use link. The server closes after use or the TTL. */
export async function startCreatorHandoff({ page = PUBLIC_CREATOR_PAGE, loadAccess, ttlMs = TTL_MS }) {
  const { origin, href } = creatorPage(page);
  let server;
  const handoff = createHandoff({ origin, loadAccess, ttlMs, onConsumed: () => setTimeout(() => server.close(), 1000).unref() });
  server = createServer(async (req, res) => {
    try {
      // Bound the authority and the body before parsing. No other routes, no proxying.
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403); res.end(); return; }
      let bytes = 0; const parts = [];
      for await (const part of req) { bytes += part.length; if (bytes > 1024) { res.writeHead(413); res.end(); return; } parts.push(part); }
      const body = Buffer.concat(parts);
      const response = await handoff.handle(new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method, headers: req.headers, ...(body.length ? { body } : {}),
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(400, { 'cache-control': 'no-store' }); res.end(); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  server.unref();
  setTimeout(() => server.close(), ttlMs + 10_000).unref();
  return { loginUrl: `${href}#dot=${handoff.code}&port=${server.address().port}`, expiresAt: new Date(handoff.expires).toISOString(), close: () => server.close() };
}
