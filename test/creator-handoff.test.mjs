import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { PUBLIC_CREATOR_PAGE, creatorPage, startCreatorHandoff } from '../mcp/creator-handoff.mjs';

const PUBLIC_ORIGIN = 'https://rupin.pryzm.gg';
const ACCESS = { url: 'https://abcdefghijklmnopqrst.supabase.co', accessToken: 'access-token', expiresAt: 4102444800, refreshToken: 'must-not-leak' };

/** node:http so the test can send the browser's Origin and preflight headers as they are. */
function call(port, { method = 'POST', origin = PUBLIC_ORIGIN, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/exchange', method,
      headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
function linkParts(loginUrl) {
  const url = new URL(loginUrl), fragment = new URLSearchParams(url.hash.slice(1));
  return { page: `${url.origin}${url.pathname}`, code: fragment.get('dot'), port: Number(fragment.get('port')) };
}

test('links open only the public creator homepage or a loopback development page', () => {
  assert.deepEqual(creatorPage(), { origin: PUBLIC_ORIGIN, href: PUBLIC_CREATOR_PAGE });
  assert.equal(creatorPage('http://127.0.0.1:5190/creator.html').origin, 'http://127.0.0.1:5190');
  for (const page of ['https://evil.example/creator.html', 'http://rupin.pryzm.gg/creator.html', 'https://rupin.pryzm.gg/index.html',
    'https://rupin.pryzm.gg/creator.html#x', 'https://user@rupin.pryzm.gg/creator.html', 'http://192.168.0.2:5190/creator.html'])
    assert.throws(() => creatorPage(page), /creator-page-not-allowed/, page);
});

test('the public homepage exchanges the one-use code for an access token only', async () => {
  const link = await startCreatorHandoff({ loadAccess: async () => ACCESS });
  try {
    const { page, code, port } = linkParts(link.loginUrl);
    assert.equal(page, PUBLIC_CREATOR_PAGE);
    assert.match(code, /^[a-f0-9]{64}$/);
    // Chrome's preflight for a public page calling 127.0.0.1.
    const preflight = await call(port, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers['access-control-allow-origin'], PUBLIC_ORIGIN);
    assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
    assert.equal((await call(port, { origin: 'https://evil.example', body: { code } })).status, 403);
    assert.equal((await call(port, { body: { code: 'a'.repeat(64) } })).status, 403);
    const granted = await call(port, { body: { code } });
    assert.equal(granted.status, 200);
    assert.deepEqual(granted.json, { url: ACCESS.url, accessToken: ACCESS.accessToken, expiresAt: ACCESS.expiresAt });
    assert.equal((await call(port, { body: { code } })).status, 410);
  } finally { link.close(); }
});

test('open_creator_homepage is offered with a beta session and returns the public link', async () => {
  const [{ createServer }, { InMemoryTransport }] = await Promise.all([import('../mcp/server.mjs'), import('@modelcontextprotocol/sdk/inMemory.js')]);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({ remote: { request: async () => ({ ok: true, stage: 'unused' }), session: async () => ACCESS } }).connect(serverSide);
  const client = new Client({ name: 'creator-link-test', version: '1.0.0' });
  await client.connect(clientSide);
  try {
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'open_creator_homepage'));
    const result = await client.callTool({ name: 'open_creator_homepage', arguments: {} });
    assert.equal(result.structuredContent.ok, true, JSON.stringify(result.structuredContent));
    const { page, port, code } = linkParts(result.structuredContent.loginUrl);
    assert.equal(page, PUBLIC_CREATOR_PAGE);
    assert.ok(Date.parse(result.structuredContent.expiresAt) > Date.now());
    assert.equal((await call(port, { body: { code } })).json.accessToken, ACCESS.accessToken);
  } finally { await client.close(); }
});
