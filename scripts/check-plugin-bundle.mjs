// Exercise the source distribution in an isolated user runtime; never generate or register.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
if (!process.argv[2]) throw Error('Usage: node scripts/check-plugin-bundle.mjs <unpacked-plugin>');
const source = path.resolve(process.argv[2]);
const temporaryRoot = await realpath(tmpdir());
const temporary = await mkdtemp(path.join(temporaryRoot, 'oddbout-release-'));
const plugin = path.join(temporary, 'plugin'), workspace = path.join(temporary, 'workspace');
try {
  await cp(source, plugin, { recursive: true }); await mkdir(workspace);
  const metadata = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
  assert.equal(metadata.name, 'oddbout');
  assert.notEqual(metadata.extensions['com.openai'].requires_local_executor, true);
  // One plugin (0.6.0): the hosted MCP is inside it (streamable HTTP, Google sign-in), not a separately added connector; nothing runs locally.
  await assert.rejects(readFile(path.join(plugin, '.app.json')), { code: 'ENOENT' });
  const servers = JSON.parse(await readFile(path.join(plugin, 'mcp.json'), 'utf8')).mcpServers;
  assert.deepEqual(Object.keys(servers), ['oddbout']);
  assert.equal(servers.oddbout.type, 'streamable-http'); assert.equal(servers.oddbout.url, 'https://mcp.oddbout.com/mcp');
  assert.equal(servers.oddbout.command, undefined);
  const { initialize } = await import(pathToFileURL(path.join(plugin, 'launcher.mjs')).href);
  const location = await initialize({ base: path.join(temporary, 'data'), workspace });
  assert.equal(location.distribution, 'source');
  assert.equal(location.registration, 'oddbout-cloud');
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  await execute(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: location.runtime, windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 180000 });
  const run = async argv => JSON.parse((await execute(process.execPath,
    [path.join(location.runtime, 'scripts', 'creation-tool.mjs'), ...argv], {
      cwd: temporary, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, AI_FIGHTER_CLIENT_CONFIG: path.join(temporary, 'must-not-read-client.json') },
    })).stdout);
  const call = async (name, args = {}) => {
    const input = path.join(temporary, 'arguments.json'); await writeFile(input, JSON.stringify(args));
    return run(['call', workspace, name, input]);
  };
  const catalog = await run(['list', workspace]);
  assert.ok(catalog.tools.some(t => t.name === 'create_creation_session'));
  assert.ok(catalog.tools.some(t => t.name === 'get_creation_environment'));
  assert.ok(catalog.tools.some(t => t.name === 'prepare_generation_login'));
  assert.equal((await call('get_creation_environment')).structuredContent.data.status, 'not-configured');
  const configured = (await call('update_creation_environment', { expectedRevision: 0, change: {
    type: 'configure', account: 'gpt', host: 'dots', conversationId: 'isolated-release-check', confirmedAccess: [],
    feedback: 'Synthetic installation check only; no live image access or network approval claimed.',
  } })).structuredContent;
  assert.equal(configured.ok, true);
  const restored = (await call('get_creation_environment')).structuredContent.data;
  assert.equal(restored.account, 'gpt');
  assert.equal(restored.revision, configured.data.revision);
  assert.deepEqual(restored.confirmedAccess, []);
  assert.equal(restored.network.approved, false);
  assert.equal(restored.readyForGeneration, false);
  assert.ok(!catalog.tools.some(t => t.name === 'submit_fighter_package'));
  assert.deepEqual((await call('list_creation_sessions')).structuredContent.data, []);
  const creation = (await call('get_fighter_spec', { section: 'creation' })).structuredContent;
  assert.equal(creation.ok, true); assert.equal(creation.data.registrationMode, 'cloud');
  assert.ok(creation.data.tool.repositoryRoot.startsWith(location.runtime));
  assert.equal(creation.data.tool.sourcePresent, true);
  assert.equal(creation.data.tool.environmentPresent, false);
  const fixture = fileURLToPath(new URL('../examples/sparring-bot', import.meta.url));
  await cp(fixture, path.join(workspace, 'fixture'), { recursive: true });
  const validated = (await call('validate_fighter_package', { manifestPath: 'fixture/fighter.json' })).structuredContent;
  assert.equal(validated.ok, true, JSON.stringify(validated));
  await assert.rejects(call('validate_fighter_package', { manifestPath: '../outside/fighter.json' }),
    error => { assert.equal(error.code, 1); assert.equal(JSON.parse(error.stdout).isError, true); return true; });
  console.log(JSON.stringify({ ok: true, checks: ['unified-plugin', 'cloud-account-mapping', 'source-integrity',
    'isolated-dependency-install', 'workspace-cli', 'no-inherited-registration-account', 'bundled-sprite-source',
    'environment-state-restored-in-new-process', 'no-image-access-or-network-approval-inferred',
    'native-WebP-validation', 'failed-command-exit-status'], testedHost: `${process.platform}-${process.arch}`,
    generation: 'not run', cloudRegistration: 'not run', hostedDotsExecution: 'not tested' }, null, 2));
} finally {
  const target = await realpath(temporary);
  if (path.dirname(target) !== temporaryRoot || !path.basename(target).startsWith('oddbout-release-'))
    throw Error('Unsafe temporary cleanup path');
  await rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}
