import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { makePackageValidator, resolveManifest } from '../mcp/package-access.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

async function connect(withFiles) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/stdio.mjs', import.meta.url))],
    env: { ...(withFiles ? { AI_FIGHTER_ROOT: root } : {}) }, stderr: 'pipe' });
  const client = new Client({ name: 'authoring-integration-test', version: '1.0.0' });
  await client.connect(transport); return client;
}
test('real stdio initialize, tools/list and tools/call cover authoring end to end', async () => {
  const client = await connect(true);
  try {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map(t => t.name).sort(), ['get_fighter_spec', 'validate_fighter_manifest', 'validate_fighter_package']);
    assert.ok(catalog.tools.every(t => t.annotations.readOnlyHint && t.outputSchema));
    for (const section of ['overview', 'schema', 'example', 'guide']) {
      const result = await client.callTool({ name: 'get_fighter_spec', arguments: { section } });
      assert.equal(result.structuredContent.ok, true);
      if (section === 'overview') assert.equal(result.structuredContent.data.registration.available, false);
    }
    const valid = await client.callTool({ name: 'validate_fighter_manifest', arguments: { manifestJson: JSON.stringify(example) } });
    assert.equal(valid.structuredContent.ok, true);
    assert.ok(valid.structuredContent.pending.includes('bytes-hashes-and-full-decode'));
    const malformed = await client.callTool({ name: 'validate_fighter_manifest', arguments: { manifestJson: '{"x":1,"x":2}' } });
    assert.equal(malformed.isError, true); assert.equal(malformed.structuredContent.errors[0].code, 'DUPLICATE_MEMBER');
    const full = await client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json' } });
    assert.equal(full.structuredContent.ok, true, JSON.stringify(full));
    assert.ok(full.structuredContent.pending.includes('server-registration'));
    const escape = await client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: '../private/fighter.json' } });
    assert.equal(escape.isError, true); assert.equal(escape.structuredContent.errors[0].code, 'PATH_NOT_ALLOWED');
    const badInput = await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'secrets' } });
    assert.equal(badInput.isError, true);
    const oversizedKey = JSON.stringify(example).replace('{', `{"${'x'.repeat(20000)}":1,`);
    const bounded = await client.callTool({ name: 'validate_fighter_manifest', arguments: { manifestJson: oversizedKey } });
    assert.equal(bounded.isError, true); assert.ok(JSON.stringify(bounded).length < 5000);
  } finally { await client.close(); }
});
test('no configured root means no filesystem tool', async () => {
  const client = await connect(false);
  try { assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['get_fighter_spec', 'validate_fighter_manifest']); }
  finally { await client.close(); }
});
test('local paths reject traversal, Windows devices, URLs and absolute paths', async () => {
  for (const relative of ['../x/fighter.json', '/tmp/fighter.json', 'C:/secret/fighter.json', 'file:///a/fighter.json', 'assets\\fighter.json', 'x//fighter.json', 'x/./fighter.json', 'x/fighter.json:stream'])
    assert.equal(await resolveManifest(root, relative), null);
});
test('worker serialization and deadline are enforced', async () => {
  const validate = makePackageValidator(root);
  const first = validate('examples/sparring-bot/fighter.json');
  assert.equal((await validate('examples/sparring-bot/fighter.json')).errors[0].code, 'VALIDATOR_BUSY');
  assert.equal((await first).ok, true);
  const short = makePackageValidator(root, { timeoutMs: 1 });
  assert.equal((await short('examples/sparring-bot/fighter.json')).errors[0].code, 'VALIDATION_TIMEOUT');
});

// In-process server with a stubbed beta API: the same tool code without spawning stdio.
async function connectInProcess({ root: packageRoot = root, remote }) {
  const [{ createServer }, { InMemoryTransport }] = await Promise.all([import('../mcp/server.mjs'), import('@modelcontextprotocol/sdk/inMemory.js')]);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({ root: packageRoot, remote }).connect(serverSide);
  const client = new Client({ name: 'submission-test', version: '1.0.0' });
  await client.connect(clientSide); return client;
}
function recordingRemote() {
  const requests = [], submissionId = crypto.randomUUID();
  return { requests, remote: { request: async (route, options = {}) => {
    requests.push({ route, method: options.method ?? 'GET', body: options.body });
    if (route === 'submissions') return { ok: true, stage: 'uploading', submissionId };
    if (route.endsWith('/submit')) return { ok: true, stage: 'queued', submissionId, pending: ['server-validation', 'registration'] };
    return { ok: true, stage: 'uploaded' };
  } } };
}
test('submit uploads exactly the validated manifest and asset bytes', async () => {
  const { requests, remote } = recordingRemote(), client = await connectInProcess({ remote });
  try {
    const result = await client.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: crypto.randomUUID() } });
    assert.equal(result.structuredContent.stage, 'queued', JSON.stringify(result.structuredContent));
    const manifestText = await readFile(new URL('../examples/sparring-bot/fighter.json', import.meta.url), 'utf8');
    assert.equal(requests[0].body, manifestText);
    const uploads = requests.filter(r => r.method === 'PUT');
    assert.deepEqual(uploads.map(r => r.route.split('/').at(-1)), example.assets.map(a => a.id));
    for (const [index, upload] of uploads.entries())
      assert.equal(createHash('sha256').update(upload.body).digest('hex'), example.assets[index].sha256);
  } finally { await client.close(); }
});
test('validate and submit share one serial decoder; a busy or invalid package is never uploaded', async () => {
  const { requests, remote } = recordingRemote(), client = await connectInProcess({ remote });
  try {
    const validating = client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json' } });
    const busy = await client.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: crypto.randomUUID() } });
    assert.equal(busy.structuredContent.code, 'local-validation-unavailable');
    assert.equal(busy.structuredContent.errors[0].code, 'VALIDATOR_BUSY');
    assert.equal((await validating).structuredContent.ok, true);
    assert.equal(requests.length, 0);
  } finally { await client.close(); }
  const temporary = await mkdtemp(path.join(tmpdir(), 'fighter-submit-'));
  const second = await connectInProcess({ root: await realpath(temporary), remote });
  try {
    await cp(new URL('../examples/sparring-bot/', import.meta.url), path.join(temporary, 'broken'), { recursive: true });
    const changed = structuredClone(example); changed.assets[0].sha256 = '0'.repeat(64);
    await writeFile(path.join(temporary, 'broken', 'fighter.json'), JSON.stringify(changed));
    const invalid = await second.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'broken/fighter.json', idempotencyKey: crypto.randomUUID() } });
    assert.equal(invalid.structuredContent.code, 'package-invalid');
    assert.ok(invalid.structuredContent.errors.some(e => e.code === 'ASSET_HASH'));
    assert.equal(requests.length, 0);
  } finally { await second.close(); await rm(temporary, { recursive: true, force: true }); }
});
test('an unreachable beta server leaves the offline contract readable', async () => {
  const client = await connectInProcess({ remote: { request: async () => { throw new Error('api-unreachable'); } } });
  try {
    const result = await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'overview' } });
    assert.equal(result.structuredContent.ok, true);
    assert.equal(result.structuredContent.code, 'api-unreachable');
    assert.equal(result.structuredContent.data.registration.available, false);
  } finally { await client.close(); }
});
