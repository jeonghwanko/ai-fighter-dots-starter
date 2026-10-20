import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { PUBLIC_CREATOR_PAGE, creatorLink, creatorPage } from '../mcp/creator-handoff.mjs';

const PUBLIC_ORIGIN = 'https://rupin.pryzm.gg';
const HASH = 'b'.repeat(56);
const EXPIRES = '2099-01-01T00:10:00.000Z';

test('links open only the public creator homepage or a loopback development page', () => {
  assert.deepEqual(creatorPage(), { origin: PUBLIC_ORIGIN, href: PUBLIC_CREATOR_PAGE });
  assert.equal(creatorPage('http://127.0.0.1:5190/creator.html').origin, 'http://127.0.0.1:5190');
  for (const page of ['https://evil.example/creator.html', 'http://rupin.pryzm.gg/creator.html', 'https://rupin.pryzm.gg/index.html',
    'https://rupin.pryzm.gg/creator.html#x', 'https://user@rupin.pryzm.gg/creator.html', 'http://192.168.0.2:5190/creator.html'])
    assert.throws(() => creatorPage(page), /creator-page-not-allowed/, page);
});

test('the link carries only the server-issued token hash, in the fragment', async () => {
  const calls = [];
  const link = await creatorLink({ request: async (route, options) => { calls.push({ route, options }); return { ok: true, tokenHash: HASH, expiresAt: EXPIRES }; } });
  assert.deepEqual(calls, [{ route: 'creator-handoffs', options: { method: 'POST' } }]);
  assert.equal(link.loginUrl, `${PUBLIC_CREATOR_PAGE}#handoff=${HASH}`);
  assert.equal(link.expiresAt, EXPIRES);
  for (const reply of [{ tokenHash: 'not-hex', expiresAt: EXPIRES }, { tokenHash: HASH }, {}])
    await assert.rejects(creatorLink({ request: async () => reply }), /invalid-api-response/);
  await assert.rejects(creatorLink({ page: 'https://evil.example/creator.html', request: async () => ({ tokenHash: HASH, expiresAt: EXPIRES }) }), /creator-page-not-allowed/);
});

test('open_creator_homepage is offered with a beta session and returns the public link', async () => {
  const [{ createServer }, { InMemoryTransport }] = await Promise.all([import('../mcp/server.mjs'), import('@modelcontextprotocol/sdk/inMemory.js')]);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const remote = { request: async route => route === 'creator-handoffs' ? { ok: true, stage: 'creator-link', tokenHash: HASH, expiresAt: EXPIRES } : { ok: true } };
  await createServer({ remote }).connect(serverSide);
  const client = new Client({ name: 'creator-link-test', version: '1.0.0' });
  await client.connect(clientSide);
  try {
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'open_creator_homepage'));
    const result = await client.callTool({ name: 'open_creator_homepage', arguments: {} });
    assert.deepEqual(result.structuredContent, { ok: true, stage: 'creator-link', loginUrl: `${PUBLIC_CREATOR_PAGE}#handoff=${HASH}`, expiresAt: EXPIRES });

    remote.request = async () => { throw new Error('handoff-email-required'); };
    const refused = await client.callTool({ name: 'open_creator_homepage', arguments: {} });
    assert.equal(refused.structuredContent.ok, false);
    assert.equal(refused.structuredContent.code, 'handoff-email-required');
  } finally { await client.close(); }
});
