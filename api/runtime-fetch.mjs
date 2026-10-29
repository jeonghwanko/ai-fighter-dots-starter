// @ts-check
import { EnvHttpProxyAgent } from 'undici';
import { transportCode } from './connection-errors.mjs';

/** @type {EnvHttpProxyAgent | undefined} */
let dispatcher;

/** Use the host's proxy and CA configuration, including on Node 22 without env-proxy support. */
/** @param {string | URL | Request} input @param {RequestInit} [init] */
export async function runtimeFetch(input, init) {
  try {
    const configured = process.env.http_proxy || process.env.HTTP_PROXY || process.env.https_proxy || process.env.HTTPS_PROXY;
    // EnvHttpProxyAgent honors the inherited HTTP(S)_PROXY and NO_PROXY rules. No direct fallback on failure.
    if (configured) dispatcher ??= new EnvHttpProxyAgent();
    // Node's fetch takes undici's dispatcher, which the DOM RequestInit does not name.
    return await globalThis.fetch(input, configured ? /** @type {RequestInit} */ ({ ...init, dispatcher }) : init);
  } catch (error) {
    // Auth SDKs can discard causes and log fetch errors. Keep the safe transport reason, never proxy credentials.
    const safe = /** @type {Error & { code?: string }} */ (new Error(transportCode(error)));
    safe.code = safe.message;
    throw safe;
  }
}
