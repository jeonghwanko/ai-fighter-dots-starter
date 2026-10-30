// @ts-check
// Read-only diagnostics for VM setup and old hosts that cannot yet discover the readiness MCP tool.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkReadiness } from '../mcp/creation-readiness.mjs';
import { createLazyRemoteClient } from '../api/client.mjs';
import { defaultSessionPath } from './login.mjs';

export async function checkConnection({ purpose = 'connection', sessionPath = defaultSessionPath(), login = {} } = {}) {
  if (!['connection', 'registration'].includes(purpose)) throw new Error('usage-creation-check-connection-or-registration');
  const remote = createLazyRemoteClient(sessionPath);
  return checkReadiness({ purpose, remoteActive: true, login: { sessionPath, request: remote.request, ...login } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error('usage-creation-check-connection-or-registration');
    console.log(JSON.stringify(await checkConnection({ purpose: process.argv[2] ?? 'connection' }), null, 2));
  } catch {
    console.error('creation-check-failed: use npm run creation:check -- connection|registration');
    process.exitCode = 1;
  }
}
