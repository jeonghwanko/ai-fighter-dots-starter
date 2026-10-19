// Explicit remote integration test. Never included in npm test or automatic CI.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRemoteClient } from '../api/client.mjs';
import { runOnce } from '../worker/run.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), privateDir = process.env.AI_FIGHTER_PRIVATE_DIR;
if (!privateDir) throw new Error('Set AI_FIGHTER_PRIVATE_DIR with separately provisioned client/other/worker configs');
const clientPath = path.join(privateDir, 'client.json'), otherPath = path.join(privateDir, 'other.json'), workerPath = path.join(privateDir, 'worker.json');
const creator = await createRemoteClient(clientPath), other = await createRemoteClient(otherPath);
const config = JSON.parse(await readFile(clientPath, 'utf8')), statePath = path.join(privateDir, 'test-state.json');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { validKey: randomUUID(), invalidKey: randomUUID() }; await writeFile(statePath, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); }
const checks = [], pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const expectedFailure = async (fn, status, message) => { await assert.rejects(fn, error => error.status === status && (!message || error.message === message)); };
const mcp = new Client({ name: 'dot-live-registration-test', version: '0.2.0' });
const call = async (name, args) => {
  const result = await mcp.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  if (result.isError || !result.structuredContent?.ok) throw new Error(`MCP ${name}: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
};
try {
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp/stdio.mjs')],
    env: { AI_FIGHTER_ROOT: root, AI_FIGHTER_CLIENT_CONFIG: clientPath }, stderr: 'inherit' }));
  const tools = await mcp.listTools();
  assert.equal(tools.tools.find(t => t.name === 'submit_fighter_package').annotations.readOnlyHint, false);
  assert.equal((await call('get_fighter_spec', { section: 'overview' })).data.registration.available, true);
  pass('live MCP discovery and server specification');
  assert.equal((await fetch(`${config.url}/functions/v1/ai-fighter/submissions`, { method: 'POST', body: '{}' })).status, 401);
  pass('anonymous registration denied');
  await expectedFailure(() => creator.request('submissions', { method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: '{"approved":true}' }), 422);
  await expectedFailure(() => creator.request('submissions', { method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: '{"x":1,"x":2}' }), 422);
  await expectedFailure(() => creator.request('submissions', { method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: ' '.repeat(262145) }), 413);
  pass('invalid schema, duplicate JSON and oversized manifest denied by server');
  const submission = await call('submit_fighter_package', { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: state.validKey });
  state.submissionId = submission.submissionId; await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  assert.ok(['queued', 'validating', 'registered'].includes(submission.stage));
  pass('Dot MCP uploaded eleven real WebP assets and submitted the manifest');
  const manifestText = await readFile(new URL('../examples/sparring-bot/fighter.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(manifestText);
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => creator.request('submissions', {
    method: 'POST', headers: { 'idempotency-key': state.validKey }, body: manifestText })));
  assert.ok(concurrent.every(r => r.submissionId === state.submissionId));
  await expectedFailure(() => creator.request('submissions', { method: 'POST', headers: { 'idempotency-key': state.validKey }, body: manifestText + ' ' }), 409, 'idempotency-conflict');
  pass('concurrent create retries return one submission; altered draft conflicts');
  await expectedFailure(() => other.request(`submissions/${state.submissionId}`), 404);
  await expectedFailure(() => other.request(`submissions/${state.submissionId}/assets/idle`, { method: 'PUT', body: 'x' }), 404);
  await expectedFailure(() => creator.request('worker/finish', { method: 'POST', body: '{}' }), 403);
  pass('cross-account read/write and client self-approval denied');
  if (submission.stage !== 'registered') {
    const worker = await runOnce(workerPath, state.submissionId);
    assert.equal(worker.stage, 'registered', JSON.stringify(worker));
  }
  const registered = await call('get_fighter_submission', { submissionId: state.submissionId });
  assert.equal(registered.stage, 'registered'); assert.ok(registered.fighterId); assert.equal(registered.runtimeApproved, false);
  const fighter = await call('get_registered_fighter', { fighterId: registered.fighterId });
  assert.equal(fighter.fighter.profile.name, manifest.profile.name);
  assert.equal(fighter.fighter.manifest_sha, createHash('sha256').update(manifestText).digest('hex'));
  pass('trusted worker downloaded and fully decoded the stored package; fighter persisted');
  const repeated = await call('submit_fighter_package', { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: state.validKey });
  assert.equal(repeated.fighterId, registered.fighterId);
  await expectedFailure(() => creator.request(`submissions/${state.submissionId}/assets/idle`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body: 'x' }), 409);
  pass('repeat registration returns same fighter; registered files cannot be overwritten');
  const otherConfig = JSON.parse(await readFile(otherPath, 'utf8'));
  const rows = await fetch(`${config.url}/rest/v1/af_submissions?id=eq.${state.submissionId}&select=id`, { headers: { apikey: config.publishableKey, authorization: `Bearer ${otherConfig.accessToken}` } });
  assert.equal(rows.status, 200); assert.deepEqual(await rows.json(), []);
  const forged = await fetch(`${config.url}/rest/v1/af_fighters`, { method: 'POST', headers: { apikey: config.publishableKey, authorization: `Bearer ${config.accessToken}`, 'content-type': 'application/json' }, body: '{}' });
  assert.ok(forged.status === 401 || forged.status === 403);
  pass('database RLS hides other owners and direct registry writes are denied');
  // Bypass local validation intentionally: only authoritative server decoding must reject this package.
  const broken = structuredClone(manifest);
  const truncated = (await readFile(new URL('../examples/sparring-bot/assets/idle.webp', import.meta.url))).subarray(0, 32);
  broken.assets[0].bytes = truncated.length; broken.assets[0].sha256 = createHash('sha256').update(truncated).digest('hex');
  const rejectedDraft = await other.request('submissions', { method: 'POST', headers: { 'idempotency-key': state.invalidKey }, body: JSON.stringify(broken) });
  if (rejectedDraft.stage === 'uploading') {
    const bytes = await readFile(new URL('../examples/sparring-bot/assets/idle.webp', import.meta.url));
    await expectedFailure(() => other.request(`submissions/${rejectedDraft.submissionId}/assets/idle`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body: bytes }), 413);
    for (const asset of broken.assets) {
      const body = asset.id === 'idle' ? truncated : await readFile(new URL(`../examples/sparring-bot/${asset.path}`, import.meta.url));
      await other.request(`submissions/${rejectedDraft.submissionId}/assets/${asset.id}`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body });
    }
    await other.request(`submissions/${rejectedDraft.submissionId}/submit`, { method: 'POST' });
  }
  if (rejectedDraft.stage !== 'rejected') await runOnce(workerPath, rejectedDraft.submissionId);
  const rejected = await other.request(`submissions/${rejectedDraft.submissionId}`);
  assert.equal(rejected.stage, 'rejected'); assert.equal(rejected.fighterId, null);
  pass('correctly hashed but truncated WebP is rejected by authoritative decoder');
  const report = { testedAt: new Date().toISOString(), endpoint: `${config.url}/functions/v1/ai-fighter`,
    submissionId: state.submissionId, fighterId: registered.fighterId, profileName: fighter.fighter.profile.name,
    manifestSha256: registered.manifestSha256, status: registered.stage, runtimeApproved: false,
    rejectedSubmissionId: rejectedDraft.submissionId, checks };
  await mkdir(path.join(root, 'output/live-registration'), { recursive: true });
  await writeFile(path.join(root, 'output/live-registration/report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await mcp.close(); }
