// Read-only test against an explicitly selected deployed beta. Not part of npm test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const base = process.env.AI_FIGHTER_API_BASE, id = process.env.AI_FIGHTER_TEST_ID;
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/ai-fighter$/.test(base ?? '') || !/^[a-f0-9-]{36}$/.test(id ?? '')) {
  throw new Error('Set AI_FIGHTER_API_BASE and AI_FIGHTER_TEST_ID for an approved beta fighter');
}
const get = async url => { const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  assert.equal(response.status, 200); return response; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const listResponse = await get(`${base}/roster`);
assert.equal(listResponse.headers.get('access-control-allow-origin'), '*');
const roster = await listResponse.json(), matches = roster.fighters.filter(f => f.id === id);
assert.equal(matches.length, 1); assert.equal(matches[0].runtimeScope, 'arena-player-v1');
const pkg = await (await get(`${base}/roster/${id}`)).json();
assert.equal(pkg.runtimeApproved, true); assert.equal(pkg.runtimeScope, 'arena-player-v1');
assert.equal(sha(pkg.manifestText), matches[0].manifestSha256);
const manifest = JSON.parse(pkg.manifestText);
assert.equal(pkg.files.length, manifest.assets.length);
let bytes = 0;
for (const asset of manifest.assets) {
  const file = pkg.files.find(f => f.id === asset.id); assert.ok(file);
  const url = new URL(file.downloadUrl); assert.equal(url.origin, new URL(base).origin);
  assert.ok(url.pathname.startsWith('/storage/v1/object/sign/ai-fighter-beta/'));
  const body = Buffer.from(await (await get(url)).arrayBuffer());
  assert.equal(body.length, asset.bytes); assert.equal(sha(body), asset.sha256); bytes += body.length;
}
let mcpChecked = false;
if (process.env.AI_FIGHTER_CLIENT_CONFIG) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const client = new Client({ name: 'live-roster-check', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/stdio.mjs', import.meta.url))],
      env: { AI_FIGHTER_ROOT: root, AI_FIGHTER_CLIENT_CONFIG: process.env.AI_FIGHTER_CLIENT_CONFIG }, stderr: 'inherit' }));
    const call = async (name, args) => { const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError && result.structuredContent?.ok); return result.structuredContent; };
    const fighter = (await call('get_registered_fighter', { fighterId: id })).fighter;
    assert.equal(fighter.runtime_approved, true); assert.equal(fighter.runtime_scope, 'arena-player-v1');
    const submission = await call('get_fighter_submission', { submissionId: fighter.submission_id });
    assert.equal(submission.fighterId, id); assert.equal(submission.runtimeApproved, true);
    assert.equal(submission.runtimeScope, 'arena-player-v1'); mcpChecked = true;
  } finally { await client.close(); }
}
console.log(JSON.stringify({ ok: true, fighterId: id, name: manifest.profile.name,
  runtimeScope: pkg.runtimeScope, files: pkg.files.length, bytes, mcpChecked }));
