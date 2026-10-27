import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, copy } from '../web/cloud-connect/connect.mjs';

function harness({ session = { user: { email: 'review@example.test', is_anonymous: false } }, language = 'en', signOutError = null } = {}) {
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
        return { data: { redirect_url: 'https://chatgpt.com/connector_platform/oauth/callback' }, error: null };
      },
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
