// @ts-check
// Per-caller brakes for unauthenticated routes. Stores only a keyed hash of the caller's address (af_rate_hits).
//
// Which header carries the real address on Supabase Edge is an operator setting, not a guess in code:
// the first X-Forwarded-For entry is written by the client itself (github.com/orgs/supabase/discussions/34647),
// so it is never used. `source` is 'cf-connecting-ip' or 'forwarded-last' (the entry the edge proxy appended),
// chosen after a probe with spoofed headers. Without a source or secret the brake is off and only the
// global limits apply; a limiter fault also lets the request through to those global limits.
const SOURCES = ['cf-connecting-ip', 'forwarded-last'];
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;

/** The caller's address from the configured header, or null when it is missing or not an address. */
export function clientAddress(request, source) {
  let value = null;
  if (source === 'cf-connecting-ip') value = request.headers.get('cf-connecting-ip');
  else if (source === 'forwarded-last') value = request.headers.get('x-forwarded-for')?.split(',').at(-1) ?? null;
  value = value?.trim().toLowerCase() ?? null;
  return value && (IPV4.test(value) || (value.includes(':') && IPV6.test(value))) ? value : null;
}

async function keyedHash(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `allow(request, bucket, limit, windowSeconds)` resolves false only when this caller is over `limit` in the window.
 * `secret` must be at least 32 characters; it never leaves the Edge function.
 */
export function createClientLimiter({ db, secret, source, now = () => new Date(), warn = console.warn }) {
  const enabled = typeof secret === 'string' && secret.length >= 32 && SOURCES.includes(source);
  return {
    enabled,
    async allow(request, bucket, limit, windowSeconds) {
      if (!enabled) return true;
      const address = clientAddress(request, source);
      if (!address) return true; // Nothing to key on: the global brakes still apply.
      const day = now().toISOString().slice(0, 10);
      try {
        const { data, error } = await db.rpc('af_rate_hit', { p_bucket: bucket, p_key: await keyedHash(secret, `${bucket}|${day}|${address}`),
          p_limit: limit, p_window_seconds: windowSeconds });
        if (error) throw error;
        return data !== false;
      } catch {
        warn(JSON.stringify({ stage: 'client-limit-unavailable', bucket }));
        return true;
      }
    },
  };
}

// The brakes in use. Each stays well under its route's global limit so one caller cannot spend it for everyone.
export const CLIENT_LIMITS = Object.freeze({
  duel: { bucket: 'duel-start', limit: 25, windowSeconds: 86_400 },          // global: 100 a day
  deviceLogin: { bucket: 'device-login-start', limit: 10, windowSeconds: 600 }, // global: 120 per 10 minutes
});
