import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, copy, agentOf, fillAgent, agentWords } from '../web/cloud-connect/connect.mjs';

function harness({ session = { user: { email: 'review@example.test', is_anonymous: false } }, language = 'en', signOutError = null,
  details = { redirect_url: 'https://chatgpt.com/connector_platform/oauth/callback' }, approved = null } = {}) {
  const elements = new Map(), calls = [], redirects = [], values = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, value: '', textContent: '', setAttribute() {} });
    return elements.get(id);
  };
  const id = 'review-authorization-123456';
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    signOut: async options => { calls.push(['signOut', options]); return { error: signOutError }; },
    signInWithOAuth: async options => { calls.push(['google', options]); return { error: null }; },
    signInWithPassword: async () => ({ data: { session: { user: { email: 'owner@example.test', is_anonymous: false } } }, error: null }),
    oauth: {
      getAuthorizationDetails: async requestId => {
        calls.push(['details', requestId]);
        return { data: details, error: null };
      },
      approveAuthorization: async () => ({ data: { redirect_url: approved }, error: null }),
    },
  };
  const env = {
    document: { documentElement: {}, getElementById: element, querySelector: element, querySelectorAll: () => [] },
    location: { search: `?authorization_id=${id}&lang=${language}`, href: `https://oddbout.com/connect.html?authorization_id=${id}&lang=${language}`,
      origin: 'https://oddbout.com', replace: value => redirects.push(value) },
    sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigator: { language }, history: { replaceState() {} }, supabase: { createClient: () => ({ auth }) },
  };
  return { env, element, calls, redirects, values, id };
}

test('a saved account cannot silently reuse a prior OAuth grant before the user chooses it', async () => {
  const h = harness(); await start(h.env);
  assert.equal(h.element('account-choice').hidden, false);
  assert.equal(h.element('existing-account').textContent, 'review@example.test');
  assert.equal(h.element('panel-title').textContent, copy.en.accountChoice);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.redirects, []);
  await h.element('continue-account').onclick();
  assert.deepEqual(h.calls, [['details', h.id]]);
  assert.deepEqual(h.redirects, ['https://chatgpt.com/connector_platform/oauth/callback']);
  assert.equal(h.values.has('oddbout-authorization-id'), false);
});

test('switching account signs out only the local session and preserves the pending authorization', async () => {
  const h = harness({ language: 'ko' }); await start(h.env);
  assert.equal(h.element('panel-title').textContent, copy.ko.accountChoice);
  h.element('email-address').value = 'review@example.test'; h.element('email-password').value = 'test-only';
  await h.element('switch-account').onclick();
  assert.deepEqual(h.calls, [['signOut', { scope: 'local' }]]);
  assert.equal(h.values.get('oddbout-authorization-id'), h.id);
  assert.equal(h.element('login').hidden, false); assert.equal(h.element('account-choice').hidden, true);
  assert.equal(h.element('email-address').value, ''); assert.equal(h.element('email-password').value, '');
  await h.element('login').onclick();
  const options = h.calls[1][1].options;
  assert.equal(options.queryParams.prompt, 'select_account');
  assert.equal(new URL(options.redirectTo).searchParams.get('authorization_id'), h.id);
  assert.deepEqual(h.redirects, []);
});

test('a failed local sign-out cannot approve the old account or proceed as if it changed', async () => {
  const h = harness({ signOutError: new Error('test failure') }); await start(h.env);
  await h.element('switch-account').onclick();
  assert.equal(h.element('login').hidden, true);
  assert.equal(h.element('retry-link').hidden, false);
  assert.equal(h.values.get('oddbout-authorization-id'), h.id);
  assert.equal(h.calls.some(c => c[0] === 'details'), false); assert.deepEqual(h.redirects, []);
});

test('fresh email login still resolves consent for the explicitly chosen new account', async () => {
  const h = harness({ session: null }); await start(h.env);
  assert.equal(h.element('login').hidden, false);
  h.element('email-address').value = 'owner@example.test'; h.element('email-password').value = 'test-only';
  await h.element('email-form').onsubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, [['details', h.id]]);
  assert.equal(h.element('email-password').value, '');
  assert.equal(h.redirects.length, 1);
});

test('each agent comes back only to its own callback addresses', () => {
  assert.equal(agentOf('https://chatgpt.com/connector_platform/oauth/callback'), 'dots');
  assert.equal(agentOf('https://chat.openai.com/aip/oauth/callback?code=x'), 'dots');
  assert.equal(agentOf('https://grok.com/connectors-oauth-exchange-code/?code=x&state=y'), 'grok');
  assert.equal(agentOf('https://www.cursor.com/agents/mcp/oauth/callback'), 'grok');
  assert.equal(agentOf('https://www.cursor.com/bot/mcp/oauth/callback?code=x'), 'grok');
  for (const refused of ['https://grok.com/', 'https://grok.com/connectors-oauth-exchange-code-evil', 'http://grok.com/connectors-oauth-exchange-code/',
    'https://www.cursor.com/settings', 'https://cursor.com/agents/mcp/oauth/callback', 'https://grok.com:8443/connectors-oauth-exchange-code/',
    'https://user@grok.com/connectors-oauth-exchange-code/', 'http://localhost:8787/callback', 'cursor://anysphere.cursor-mcp/oauth/callback', 'not a url'])
    assert.equal(agentOf(refused), null, refused);
});

test('the copy names the agent with the particles its sound takes', () => {
  assert.equal(fillAgent(copy.ko.consentTitle, agentWords.ko.grok), 'Grok에 연결할까요?');
  assert.equal(fillAgent(copy.ko.returnDots, agentWords.ko.grok), 'Grok으로 돌아가기');
  assert.equal(fillAgent(copy.ko.returnDots, agentWords.ko.dots), 'Dots로 돌아가기');
  assert.equal(fillAgent(copy.en.consentTitle, agentWords.en.any), 'Connect to your agent?');
  for (const language of ['ko', 'en']) for (const text of Object.values(copy[language])) {
    for (const words of Object.values(agentWords[language])) assert.doesNotMatch(fillAgent(text, words), /[{}]/);
  }
});

test('a Grok request is consented as Grok, returns to Grok, and its approval goes back to Grok', async () => {
  const h = harness({ language: 'ko', details: { redirect_uri: 'https://grok.com/connectors-oauth-exchange-code/', client: { name: 'Grok' } },
    approved: 'https://grok.com/connectors-oauth-exchange-code/?code=abc&state=xyz' });
  await start(h.env);
  await h.element('continue-account').onclick();
  assert.equal(h.element('consent').hidden, false);
  assert.equal(h.element('panel-title').textContent, 'Grok에 연결할까요?');
  assert.equal(h.element('client').textContent, 'Grok · grok.com');
  assert.equal(h.element('retry-link').href, 'https://grok.com/connectors');
  assert.equal(h.values.get('oddbout-connect-agent'), `${h.id} grok`);
  await h.element('approve').onclick();
  assert.deepEqual(h.redirects, ['https://grok.com/connectors-oauth-exchange-code/?code=abc&state=xyz']);
});

test('an unknown agent is refused and approves nothing', async () => {
  const h = harness({ details: { redirect_uri: 'https://evil.example/callback', client: { name: 'Grok' } } });
  await start(h.env);
  await h.element('continue-account').onclick();
  assert.equal(h.element('consent').hidden, true);
  assert.equal(h.element('status').textContent, copy.en.unsafe);
  assert.deepEqual(h.redirects, []);
});
