import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCreationContext, reviewCreationProgress } from '../mcp/creation-context.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../mcp/server.mjs';
const context = { owner: 'game', contextVersion: 1, specVersion: spec.specVersion, revision: 'a'.repeat(64),
  contract: { motions: spec.motions }, controls: { actions: [] }, timing: { clocks: {} }, workflow: { gates: {}, groups: [
    { id: 'appearance', motions: ['idle'] }, { id: 'locomotion', motions: ['fightIdle', 'walk', 'run'] },
    { id: 'attacks', motions: ['combo', 'slam', 'dash'] }, { id: 'defense', motions: ['block', 'hit', 'groggy', 'fall'], auxiliaries: ['getUp'] },
    { id: 'final', motions: [] },
  ] } };
const item = (selected = true) => ({ version: 'v1', selectedVersion: selected ? 'v1' : null, review: 'hypothetical' });
const session = () => ({ mode: 'dialogue-only', contextRevision: context.revision, groupId: 'locomotion', items: {
  idle: item(), fightIdle: item(false), walk: item(false), run: item(),
} });
test('partial praise, later delegation, revision and stale context cannot skip pending work', () => {
  const state = session();
  assert.deepEqual(reviewCreationProgress(context, state).blockers, ['unselected:fightIdle', 'unselected:walk']);
  state.delegatedGroups = ['attacks']; state.items.idle = item(false);
  assert.ok(reviewCreationProgress(context, state).blockers.includes('unselected:idle'));
  state.items.idle = item(); state.items.fightIdle = item(); state.items.walk = item();
  assert.equal(reviewCreationProgress(context, state).nextGroup, 'attacks');
  state.items.walk.version = 'v2';
  assert.deepEqual(reviewCreationProgress(context, state).blockers, ['unselected:walk']);
  state.contextRevision = 'b'.repeat(64);
  assert.ok(reviewCreationProgress(context, state).blockers.includes('context-changed'));
});
test('substituted motions and hypothetical approvals never satisfy real creation', () => {
  const state = session(); state.groupId = 'attacks'; state.items.ultimate = item();
  assert.ok(reviewCreationProgress(context, state).blockers.includes('unknown-item:ultimate'));
  assert.ok(reviewCreationProgress(context, state).blockers.includes('missing:dash'));
  state.mode = 'creation';
  assert.ok(reviewCreationProgress(context, state).blockers.includes('unchecked:idle'));
});
test('get-up, profile and validation are required; final acceptance never authorizes registration', () => {
  const state = session(); state.groupId = 'final';
  state.items = Object.fromEntries(Object.keys(spec.motions).map(id => [id, item()]));
  assert.deepEqual(reviewCreationProgress(context, state).blockers, ['missing:getUp', 'profile-unselected']);
  state.items.getUp = item(); state.profile = { selected: true };
  assert.equal(reviewCreationProgress(context, state).canAdvance, true);
  assert.equal(reviewCreationProgress(context, state).registrationAuthorized, false);
  state.pendingEdits = ['getUp'];
  assert.deepEqual(reviewCreationProgress(context, state).blockers, ['pending-edit:getUp']);
});
test('fetch refreshes, scopes only motions, and fails closed on invalid or oversized payload', async () => {
  const revisions = []; const request = async (_url, options) => {
    assert.equal(options.cache, 'no-store'); revisions.push(context.revision); return new Response(JSON.stringify(context));
  };
  const result = await fetchCreationContext({ request, group: 'attacks' });
  assert.deepEqual(Object.keys(result.contract.motions), ['combo', 'slam', 'dash']);
  await fetchCreationContext({ request }); assert.equal(revisions.length, 2);
  await assert.rejects(fetchCreationContext({ request: async () => new Response('bad', { status: 503 }) }), /unavailable/);
  await assert.rejects(fetchCreationContext({ request: async () => new Response('x'.repeat(128 * 1024 + 1)) }), /too-large/);
  const wrong = structuredClone(context); wrong.workflow.groups[2].motions[2] = 'ultimate';
  await assert.rejects(fetchCreationContext({ request: async () => new Response(JSON.stringify(wrong)) }), /motions/);
});
test('MCP context and boundary tool use latest public game data without a login', async () => {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ contextRequest: async () => new Response(JSON.stringify(context)) }).connect(serverTransport);
  const client = new Client({ name: 'context-test', version: '1' }); await client.connect(clientTransport);
  try {
    const data = (await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'context', group: 'attacks' } })).structuredContent;
    assert.equal(data.ok, true); assert.deepEqual(Object.keys(data.data.contract.motions), ['combo', 'slam', 'dash']);
    const decision = (await client.callTool({ name: 'review_creation_progress', arguments: { stateJson: JSON.stringify(session()) } })).structuredContent;
    assert.equal(decision.data.canAdvance, false); assert.deepEqual(decision.data.blockers, ['unselected:fightIdle', 'unselected:walk']);
  } finally { await client.close(); }
});
