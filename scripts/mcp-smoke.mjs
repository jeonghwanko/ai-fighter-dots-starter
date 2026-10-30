// @ts-check
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const client = new Client({ name: 'fighter-smoke', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../mcp/stdio.mjs', import.meta.url))], env: { AI_FIGHTER_ROOT: root }, stderr: 'inherit' }));
  console.log('tools:', (await client.listTools()).tools.map(t => t.name).join(', '));
  for (const [name, args] of /** @type {[string, Record<string, unknown>][]} */ ([
    ['get_fighter_spec', { section: 'overview' }],
    ['validate_fighter_package', { manifestPath: 'examples/sparring-bot/fighter.json' }],
  ])) {
    const result = await client.callTool({ name, arguments: args });
    console.log(JSON.stringify({ tool: name, result: result.structuredContent }, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} finally { await client.close(); }
