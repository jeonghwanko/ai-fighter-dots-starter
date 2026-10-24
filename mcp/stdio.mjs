import { realpath, stat } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';
import { createLazyRemoteClient } from '../api/client.mjs';
import { defaultSessionPath } from '../scripts/login.mjs';

// No implicit filesystem access. The installer must name an existing directory.
const root = process.env.AI_FIGHTER_ROOT ? await realpath(process.env.AI_FIGHTER_ROOT) : undefined;
if (root && !(await stat(root)).isDirectory()) throw new Error('AI_FIGHTER_ROOT must be a directory');
// The session file comes from `npm run login` (default ~/.ai-fighter/client.json) or AI_FIGHTER_CLIENT_CONFIG.
// Tools stay discoverable before login; every remote operation still requires a valid user session.
// Login after MCP startup is adopted on the next call. Logout stops subsequent remote requests.
const sessionPath = defaultSessionPath();
const remote = createLazyRemoteClient(sessionPath);
// AI_FIGHTER_CREATOR_URL: a loopback creator homepage for local development; the public homepage otherwise.
const server = createServer({ root, remote, creatorPage: process.env.AI_FIGHTER_CREATOR_URL || undefined });
await server.connect(new StdioServerTransport());
// stdout is reserved for MCP; no banners, debug prints, or credentials.
