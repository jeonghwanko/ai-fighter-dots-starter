// The same validated project tools in PC and hosted workspaces, without installing a second plugin.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../mcp/server.mjs';

export async function creationTool({ workspace, name, args = {}, contextRequest } = {}) {
  if (!workspace || !path.isAbsolute(workspace)) throw Error('absolute-workspace-required');
  const root = await realpath(workspace);
  if (!(await stat(root)).isDirectory()) throw Error('workspace-directory-required');
  // Registration belongs to the connected ODDBOUT account. Never inherit a CLI login or its tokens.
  const server = createServer({ root, contextRequest, registrationMode: 'cloud' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'oddbout-workspace', version: '0.5.4' });
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    return name ? await client.callTool({ name, arguments: args }) : await client.listTools();
  } finally { await client.close(); await server.close(); }
}

export async function main(argv) {
  // Arguments are in a JSON file so prompts and shell metacharacters are never executed as code.
  const [operation, workspace, name, input, ...extra] = argv;
  if (extra.length || !['list', 'call'].includes(operation) || operation === 'list' && (name || input)
    || operation === 'call' && !name) throw Error('usage: creation:tool -- list <absolute-workspace> | call <absolute-workspace> <tool> [arguments.json]');
  const args = input ? JSON.parse(await readFile(input, 'utf8')) : {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('arguments-object-required');
  return creationTool({ workspace, name, args });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (result.isError) process.exitCode = 1;
  } catch (error) {
    // Do not echo file contents, login data or arbitrary server exception text.
    console.error(JSON.stringify({ ok: false, code: /^[a-z][a-z-]+$/.test(error.message) ? error.message : 'workspace-command-failed' }));
    process.exitCode = 1;
  }
}
