import { realpath, stat } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';

// No implicit filesystem access. The installer must name an existing directory.
const root = process.env.AI_FIGHTER_ROOT ? await realpath(process.env.AI_FIGHTER_ROOT) : undefined;
if (root && !(await stat(root)).isDirectory()) throw new Error('AI_FIGHTER_ROOT must be a directory');
const server = createServer({ root });
await server.connect(new StdioServerTransport());
// stdout is reserved for MCP; no banners, debug prints, or credentials.
