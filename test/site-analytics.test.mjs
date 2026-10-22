import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { analyticsSource, analyticsHtml } from '../scripts/site-analytics.mjs';

function visit(href, { gpc = false, referrer = 'https://example.com/path?email=private#secret' } = {}) {
  const scripts = [], location = new URL(href), window = { location };
  const document = { referrer, title: 'ODDBOUT', createElement: () => ({}), head: { append: script => scripts.push(script) } };
  const context = { window, document, navigator: { globalPrivacyControl: gpc }, URL, URLSearchParams };
  const source = analyticsSource('G-ABC123DEF4', 'https://oddbout.com/creator.html');
  return { window, scripts, run: () => runInNewContext(source, context) };
}

test('production visits send one pageview with sanitized addresses and no advertising signals', () => {
  const page = visit('https://oddbout.com/league.html?lang=ko&email=private#fighters');
  page.run(); page.run();
  assert.equal(page.scripts.length, 1);
  assert.equal(page.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4');
  const calls = page.window.dataLayer.map(args => Array.from(args));
  const config = calls.find(args => args[0] === 'config')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  const views = calls.filter(args => args[0] === 'event' && args[1] === 'page_view');
  assert.equal(views.length, 1);
  assert.equal(views[0][2].page_location, 'https://oddbout.com/');
  assert.equal(views[0][2].page_referrer, 'https://example.com/');
  assert.ok(!JSON.stringify(calls).includes('private'));
});

test('campaign attribution is retained while unrelated query values are removed', () => {
  const page = visit('https://oddbout.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch&email=private#fighters');
  page.run();
  const view = page.window.dataLayer.map(args => Array.from(args)).find(args => args[0] === 'event');
  assert.equal(view[2].page_location, 'https://oddbout.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch');
});

test('development, admin, privacy opt-out and incoming sign-in secrets do not load Analytics', () => {
  for (const href of ['http://127.0.0.1:5198/', 'https://other.example/', 'http://oddbout.com/',
    'https://oddbout.com/admin.html', 'https://oddbout.com/creator.html?code=secret',
    'https://oddbout.com/creator.html#handoff=secret', 'https://oddbout.com/creator.html#dot=secret&port=1234']) {
    const page = visit(href); page.run(); assert.equal(page.scripts.length, 0, href);
  }
  const optedOut = visit('https://oddbout.com/', { gpc: true }); optedOut.run(); assert.equal(optedOut.scripts.length, 0);
  assert.throws(() => analyticsSource('bad-id', 'https://oddbout.com/'), /measurement ID/);
});

test('Analytics is included through the build graph and the privacy page explains its use', () => {
  const html = '<html><head></head><body><h3>Technical information</h3><strong>Google</strong> — account sign-in. Google may use its own cookies during sign-in.</body></html>';
  const tagged = analyticsHtml(html, true);
  assert.ok(tagged.includes('import "virtual:oddbout-analytics"'));
  assert.ok(tagged.includes('Website analytics'));
  assert.ok(tagged.includes('website usage analytics'));
  assert.ok(tagged.includes('Google Analytics opt-out'));
  assert.throws(() => analyticsHtml('<head></head>', true), /privacy notice/);
});
