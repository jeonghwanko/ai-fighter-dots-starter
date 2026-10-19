import { test } from 'node:test';
import assert from 'node:assert/strict';
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
