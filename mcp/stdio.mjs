import { realpath, stat } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';
import { createRemoteClient } from '../api/client.mjs';

// No implicit filesystem access. The installer must name an existing directory.
const root = process.env.AI_FIGHTER_ROOT ? await realpath(process.env.AI_FIGHTER_ROOT) : undefined;
if (root && !(await stat(root)).isDirectory()) throw new Error('AI_FIGHTER_ROOT must be a directory');
const remote = process.env.AI_FIGHTER_CLIENT_CONFIG ? await createRemoteClient(process.env.AI_FIGHTER_CLIENT_CONFIG) : undefined;
// AI_FIGHTER_CREATOR_URL: a loopback creator homepage for local development; the public homepage otherwise.
const server = createServer({ root, remote, creatorPage: process.env.AI_FIGHTER_CREATOR_URL || undefined });
await server.connect(new StdioServerTransport());
// stdout is reserved for MCP; no banners, debug prints, or credentials.
