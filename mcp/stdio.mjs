import { access, realpath, stat } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';
import { createRemoteClient } from '../api/client.mjs';
import { defaultSessionPath } from '../scripts/login.mjs';

// No implicit filesystem access. The installer must name an existing directory.
const root = process.env.AI_FIGHTER_ROOT ? await realpath(process.env.AI_FIGHTER_ROOT) : undefined;
if (root && !(await stat(root)).isDirectory()) throw new Error('AI_FIGHTER_ROOT must be a directory');
// The session file comes from `npm run login` (default ~/.ai-fighter/client.json) or AI_FIGHTER_CLIENT_CONFIG.
// Without one, only the local tools are exposed. A login made after start needs a host restart.
// An explicitly configured file must be valid. A broken default file only disables the remote tools.
const sessionPath = defaultSessionPath();
let remote;
if (process.env.AI_FIGHTER_CLIENT_CONFIG) remote = await createRemoteClient(sessionPath);
else if (await access(sessionPath).then(() => true, () => false)) {
  try { remote = await createRemoteClient(sessionPath); }
  catch (error) { process.stderr.write(`ai-fighter: ignoring ${sessionPath} (${error.message}); run npm run login again.\n`); }
}
// AI_FIGHTER_CREATOR_URL: a loopback creator homepage for local development; the public homepage otherwise.
const server = createServer({ root, remote, creatorPage: process.env.AI_FIGHTER_CREATOR_URL || undefined });
await server.connect(new StdioServerTransport());
// stdout is reserved for MCP; no banners, debug prints, or credentials.
