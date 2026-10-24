// Exercise an unpacked release outside the source checkout, without accounts or generation.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const source = path.resolve(process.argv[2]);
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-fighter-release-'));
const plugin = path.join(temporary, 'plugin'), home = path.join(temporary, 'home');
const workspace = path.join(temporary, 'workspace'), data = path.join(temporary, 'data');
try {
  await cp(source, plugin, { recursive: true });
  await mkdir(home); await mkdir(workspace);
  const config = JSON.parse(await readFile(path.join(plugin, 'mcp.json'), 'utf8')).mcpServers['ai-fighter-creator'];
  assert.equal(config.command, 'node');
  assert.deepEqual(config.args, ['${PLUGIN_ROOT}/launcher.mjs']);
  assert.equal(config.cwd, '${PLUGIN_ROOT}');
  assert.equal(config.env, undefined);
  const client = new Client({ name: 'isolated-release-check', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: config.args.map(arg => arg.replace('${PLUGIN_ROOT}', plugin)), cwd: temporary,
    env: { HOME: home, USERPROFILE: home, AI_FIGHTER_CREATOR_HOME: data, AI_FIGHTER_ROOT: workspace,
      AI_FIGHTER_CLIENT_CONFIG: '' }, stderr: 'pipe' });
  try {
    await client.connect(transport, { timeout: 180000 });
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(tool => tool.name === 'create_creation_session'));
    assert.ok(!tools.some(tool => tool.name === 'submit_fighter_package'));
    const listed = (await client.callTool({ name: 'list_creation_sessions', arguments: {} })).structuredContent;
    assert.equal(listed.ok, true); assert.deepEqual(listed.data, []);
    const creation = (await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'creation' } })).structuredContent;
    assert.equal(creation.ok, true);
    assert.ok(creation.data.tool.repositoryRoot.startsWith(data + path.sep));
    assert.equal(creation.data.packageRoot, workspace);
    assert.equal(creation.data.tool.sourcePresent, true);
    assert.equal(creation.data.tool.environmentPresent, false);
    const fixture = fileURLToPath(new URL('../examples/sparring-bot', import.meta.url));
    await cp(fixture, path.join(workspace, 'fixture'), { recursive: true });
    const validated = (await client.callTool({ name: 'validate_fighter_package',
      arguments: { manifestPath: 'fixture/fighter.json' } })).structuredContent;
    assert.equal(validated.ok, true, JSON.stringify(validated));
    console.log(JSON.stringify({ ok: true, checks: ['portable-manifest', 'isolated-runtime', 'stdio', 'local-tools',
      'no-inherited-login', 'bundled-sprite-source', 'native-WebP-validation'], generation: 'not run',
      registration: 'not run' }, null, 2));
  } finally { await client.close(); await transport.close(); }
} finally { await rm(temporary, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); }
