// @ts-check
// Records real calls to the installed portable plugin. No generation, login or upload.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = path.resolve(process.argv[2]);
const sdk = path.join(plugin, 'runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client');
const { Client } = await import(pathToFileURL(path.join(sdk, 'index.js')).href);
const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, 'stdio.js')).href);
const output = path.resolve(process.argv[3] || path.join(root, 'output/plugin-review-20261022'));
const hold = Number(process.env.REVIEW_SCENE_MS || 7500);
const run = randomUUID(), sessionId = 'review-' + run.slice(0, 8);
const work = path.join(output, 'private-run', run), workspace = path.join(work, 'workspace');
await mkdir(workspace, { recursive: true });
await mkdir(path.join(work, 'home'), { recursive: true });
await mkdir(path.join(output, 'site'), { recursive: true });
await cp(path.join(root, 'examples/sparring-bot'), path.join(workspace, 'fixture'), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
const runtimeBytes = await readFile(path.join(plugin, 'runtime-manifest.json'));
/**
 * The evidence.json record and each recorded call.
 * @typedef {{ number: number, title: string, description: string, tool: string, arguments: Record<string, unknown>, startedAt: string,
 *   status: string, response?: unknown, summary?: string[], finishedAt?: string, error?: string }} Step
 * @typedef {{ title: string, run: string, version: string, publisher: string, startedAt: string, runtimeManifestSha256: string,
 *   source: string, presentation: string, limitations: string[], steps: Step[], status: string, finishedAt?: string, error?: string }} Evidence
 */
/** @type {Evidence} */
const evidence = { title: 'AI Fighter Creator — actual MCP functional demonstration', run,
  version: manifest.version, publisher: 'Lucas Foundation', startedAt: new Date().toISOString(),
  runtimeManifestSha256: createHash('sha256').update(runtimeBytes).digest('hex'),
  source: 'Installed portable plugin, launched over stdio into an isolated workspace',
  presentation: 'Reviewer console for real MCP calls; this is not the Codex conversation UI',
  limitations: ['No image or video generation', 'No visual approval', 'No sign-in or registration', 'Geometric fixture used only for file-format validation'],
  steps: [], status: 'running' };
/** @type {(value: unknown) => any} */
const sanitize = value => JSON.parse(JSON.stringify(value).replaceAll(JSON.stringify(work).slice(1, -1), '<ISOLATED_REVIEW_DIR>')
  .replaceAll(JSON.stringify(plugin).slice(1, -1), '<INSTALLED_PLUGIN>')
  .replaceAll(JSON.stringify(root.replace(/[\\/]$/, '')).slice(1, -1), '<SOURCE_CHECKOUT>'));
async function save() {
  const target = path.join(output, 'site', 'evidence.json');
  await writeFile(target + '.next', JSON.stringify(sanitize(evidence), null, 2));
  await rename(target + '.next', target);
}
/** @type {import('@modelcontextprotocol/sdk/client/index.js').Client} */
let client, /** @type {import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport} */ transport;
async function connect() {
  client = new Client({ name: 'ai-fighter-review-demonstration', version: '1.0.0' });
  transport = new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'launcher.mjs')], cwd: work,
    env: { HOME: path.join(work, 'home'), USERPROFILE: path.join(work, 'home'),
      AI_FIGHTER_CREATOR_HOME: process.env.REVIEW_RUNTIME_HOME || path.join(work, 'creator'), AI_FIGHTER_ROOT: workspace, AI_FIGHTER_CLIENT_CONFIG: '' }, stderr: 'pipe' });
  await client.connect(transport, { timeout: 180000 });
}
async function close() { await client?.close(); await transport?.close(); }
/**
 * @param {string} title @param {string} description @param {string} tool @param {Record<string, unknown>} args
 * @param {(result: any) => void} verify @param {(result: any) => string[]} summarize
 */
async function step(title, description, tool, args, verify, summarize) {
  /** @type {Step} */
  const item = { number: evidence.steps.length + 1, title, description, tool, arguments: args,
    startedAt: new Date().toISOString(), status: 'running' };
  evidence.steps.push(item); await save();
  try {
    const raw = tool === 'tools/list' ? await client.listTools()
      : tool === 'transport/restart' ? await close().then(connect).then(() => ({ reconnected: true }))
      : await client.callTool({ name: tool, arguments: args });
    const result = /** @type {any} */ (raw).structuredContent || raw;
    item.response = sanitize(result); verify(result);
    item.summary = summarize(result); item.status = 'passed'; item.finishedAt = new Date().toISOString();
    await save(); console.log(JSON.stringify({ step: item.number, title, status: item.status, summary: item.summary }));
    await delay(hold); return result;
  } catch (/** @type {any} */ error) {
    item.status = 'failed'; item.error = String(error.message); await save(); throw error;
  }
}
try {
  await save(); await connect(); await delay(Number(process.env.REVIEW_START_DELAY_MS || 0));
  await step('Portable plugin starts', 'The installed 0.2.0 package starts in a clean, isolated workspace without a user login.',
    'tools/list', {}, r => { assert.ok(/** @type {{ name: string }[]} */ (r.tools).some(t => t.name === 'create_creation_session')); assert.ok(!/** @type {{ name: string }[]} */ (r.tools).some(t => t.name === 'submit_fighter_package')); },
    r => [`${r.tools.length} local MCP tools available`, 'No inherited registration credentials', 'Generation has not run']);
  await step('Inspect setup', 'Read the packaged creation guide and current local prerequisites.',
    'get_fighter_spec', { section: 'creation' }, r => { assert.equal(r.ok, true); assert.equal(r.data.tool.sourcePresent, true); },
    r => ['Bundled sprite-gen source: present', `Python environment: ${r.data.tool.environmentPresent ? 'present' : 'not installed in this clean workspace'}`, 'The tool returns setup guidance, not generated artwork']);
  await step('Create a discussion project', 'A process-review request is recorded as dialogue-only; it is not permission to generate.',
    'create_creation_session', { sessionId, brief: 'Reviewer demonstration: discuss a fictional training robot. Do not generate or register artwork.', mode: 'dialogue-only' },
    r => { assert.equal(r.ok, true); assert.equal(r.data.mode, 'dialogue-only'); },
    r => [`Session: ${r.data.sessionId}`, `Mode: ${r.data.mode}`, `Current group: ${r.data.groupId}`]);
  await step('Restart the MCP process', 'Close the actual stdio process and reconnect to the same workspace.',
    'transport/restart', {}, r => assert.equal(r.reconnected, true), () => ['Original process closed', 'New MCP process connected', 'Project files remain on disk']);
  await step('Resume the project', 'The new process reads the saved brief and current review blockers.',
    'get_creation_session', { sessionId }, r => { assert.equal(r.ok, true); assert.equal(r.data.state.mode, 'dialogue-only'); assert.equal(r.data.state.revision, 1); assert.equal(r.data.decision.canAdvance, false); },
    r => ['Original brief and dialogue-only mode preserved', `Revision: ${r.data.state.revision}`, `Review blockers: ${r.data.decision.blockers.join(', ')}`]);
  await step('Reject an unauthorized generation job', 'Try to reserve a generation command in the dialogue-only project. The real tool must refuse before execution.',
    'prepare_creation_job', { sessionId, jobId: randomUUID(), expectedRevision: 1, plan: {
      engine: 'sprite', args: ['gen', '--provider', 'codex', '--prompt', 'Reviewer test; must not execute'],
      workflowArgs: ['workflow', '--kind', 'image', '--image-provider', 'codex', '--confirmed-access', 'codex'],
      groupId: 'appearance', targets: [{ item: 'idle', version: 'v1' }], inputs: [],
      outputs: [`output/${sessionId}-work/artifacts/idle/v1/image.png`] } },
    r => { assert.equal(r.ok, false); assert.equal(r.code, 'dialogue-only-no-execution'); },
    r => [`Tool returned: ${r.code}`, 'No executable job reserved', 'No generation request sent']);
  await step('Reject an unsafe file path', 'Try to attach a file outside the managed workspace. No private file is read.',
    'update_creation_session', { sessionId, expectedRevision: 1, change: { type: 'version', item: 'idle', version: 'v1', files: ['../private/client.json'], note: 'Boundary test; this file must never be read' } },
    r => { assert.equal(r.ok, false); assert.equal(r.code, 'path-not-allowed'); },
    r => [`Tool returned: ${r.code}`, 'Traversal path rejected', 'Existing project remains intact']);
  await step('Validate real package files', 'Run the native image/file validator on the bundled geometric format fixture. This is not generated artwork or a visual approval.',
    'validate_fighter_package', { manifestPath: 'fixture/fighter.json' }, r => assert.equal(r.ok, true),
    () => ['Manifest and actual WebP files validated', 'Fixture: examples/sparring-bot', 'No character generation or registration claimed']);
  await step('Verify the final project state', 'List the projects after the rejected requests and completed file validation.',
    'list_creation_sessions', {}, r => { assert.equal(r.ok, true); assert.equal(r.data.length, 1); },
    () => ['One preserved discussion project', 'No production approvals recorded', 'Generation and registration remain unperformed']);
  evidence.status = 'passed'; evidence.finishedAt = new Date().toISOString();
} catch (/** @type {any} */ error) { evidence.status = 'failed'; evidence.error = String(error.message); process.exitCode = 1; }
finally { await close(); await save(); }
