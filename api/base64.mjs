// Native base64 for Deno and Node. bytes.mjs and http.mjs stay free of Node imports; Buffer enters here only.
import { Buffer } from 'node:buffer';

/** The padded text btoa gives, without a binary JS string or a callback per byte. */
export function encodeBase64(bytes) {
  const view = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes);
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
}

/**
 * atob's grammar (WHATWG forgiving-base64): Buffer alone also takes base64url, stray characters and a bad tail.
 * Returns a fresh Uint8Array like the old atob path, never a view into Buffer's shared pool.
 */
export function decodeBase64(text) {
  let data = text.replace(/[\t\n\f\r ]+/g, '');
  if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
  if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) throw new SyntaxError('invalid-base64');
  return new Uint8Array(Buffer.from(data, 'base64'));
}
