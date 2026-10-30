// @ts-check
// The code a tool result reports for a failure. Our own failures throw kebab-case codes (`fail('session-busy')`);
// anything else (paths, upstream bodies, stack text) never reaches the client and becomes the caller's fallback.
// Pass the specific code through: an outdated kit (creation-context-incompatible) needs an update, not a retry.
const CODE = /^[a-z][a-z0-9-]{0,80}$/;

/**
 * `missing` replaces a file-not-found error; `prefix` passes through only codes from one source,
 * so a stray lowercase word from a library (`terminated`) is not mistaken for ours.
 * @param {any} error  Anything thrown. @param {string} fallback @param {{ missing?: string, prefix?: string }} [options]
 */
export function errorCode(error, fallback, { missing, prefix = '' } = {}) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (CODE.test(message) && message.startsWith(prefix)) return message;
  if (missing && error?.code === 'ENOENT') return missing;
  return fallback;
}
