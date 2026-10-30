// @ts-check
const virtualId = 'virtual:oddbout-analytics';
const resolvedId = '\0oddbout-analytics';

/**
 * The page globals Analytics uses: Google's tag queue and the sign-in binding site-milestones.mjs calls.
 * @typedef {typeof window & { dataLayer: IArguments[], oddboutAnalyticsStarted?: boolean, [gaDisable: string]: unknown,
 *   gtag: { (command: 'get', target: string, field: string, done: (value: any) => void): void, (...args: unknown[]): void },
 *   oddboutBindAnalytics?: (api: string, token: string, key: string) => Promise<void> }} AnalyticsWindow
 * The Vite plugin hooks the site build uses (also site-milestones.mjs and site-social.mjs).
 * @typedef {{ name: string, enforce?: 'pre', configResolved?: (config: { root: string }) => void,
 *   resolveId?: (id: string) => string | undefined, load?: (id: string) => string | undefined,
 *   transform?: (code: string, id: string) => string | null,
 *   transformIndexHtml?: { order: 'pre', handler: (html: string, context: { filename: string }) => string } }} SitePlugin
 */

/** @param {string} measurementId @param {string} hostname @param {string | null} apiBase */
function startAnalytics(measurementId, hostname, apiBase) {
  if (window.location.hostname !== hostname || window.location.protocol !== 'https:' ||
      window.location.pathname.endsWith('/admin.html') || /** @type {AnalyticsWindow} */ (window).oddboutAnalyticsStarted) return;
  const current = new URL(window.location.href);
  const fragment = new URLSearchParams(current.hash.slice(1));
  const privateKeys = ['code', 'state', 'handoff', 'dot', 'token', 'access_token', 'refresh_token', 'id_token', 'error_description'];
  if (privateKeys.some(key => current.searchParams.has(key) || fragment.has(key))) return;
  const campaign = new URLSearchParams();
  for (const key of ['utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const value = current.searchParams.get(key);
    if (value && value.length <= 100 && !value.includes('@')) campaign.set(key, value);
  }
  current.search = campaign.toString(); current.hash = '';
  if (/\/(?:index|league)\.html$/.test(current.pathname)) current.pathname = current.pathname.replace(/[^/]+$/, '');
  let referrer = '';
  try {
    const source = new URL(document.referrer);
    if (['http:', 'https:'].includes(source.protocol)) referrer = source.origin + '/';
  } catch {}
  const permitted = () => /** @type {Navigator & { globalPrivacyControl?: boolean }} */ (navigator).globalPrivacyControl !== true && !/** @type {AnalyticsWindow} */ (window)['ga-disable-' + measurementId];
  /** @type {AnalyticsWindow} */ (window).oddboutBindAnalytics = async (api, token, key) => {
    if (!apiBase || api !== apiBase || typeof token !== 'string') return;
    try {
      /** @type {{ enabled: boolean, clientId?: string, sessionId?: string }} */
      let body = { enabled: false };
      if (permitted()) {
        /** @type {(field: string) => Promise<any>} */
        const get = field => new Promise(resolve => {
          const timer = setTimeout(() => resolve(null), 2500);
          /** @type {AnalyticsWindow} */ (window).gtag('get', measurementId, field, value => { clearTimeout(timer); resolve(value); });
        });
        const [clientId, sessionId] = await Promise.all([get('client_id'), get('session_id')]);
        if (!/^\d{1,20}\.\d{1,20}$/.test(clientId ?? '') || !/^\d{1,20}$/.test(String(sessionId ?? '')) || !permitted()) return;
        body = { enabled: true, clientId, sessionId: String(sessionId) };
      }
      await fetch(apiBase + '/analytics/context', { method: 'POST', credentials: 'omit', redirect: 'error', keepalive: true,
        headers: { authorization: 'Bearer ' + token, apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    } catch { /* Measurement does not affect sign-in or creation. */ }
  };
  if (!permitted()) {
    window.dispatchEvent(new CustomEvent('oddbout:analytics-ready'));
    return;
  }
  /** @type {AnalyticsWindow} */ (window).oddboutAnalyticsStarted = true;
  /** @type {AnalyticsWindow} */ (window).dataLayer = /** @type {AnalyticsWindow} */ (window).dataLayer || [];
  /** @type {AnalyticsWindow} */ (window).gtag = function () { /** @type {AnalyticsWindow} */ (window).dataLayer.push(arguments); };
  const page = { page_location: current.href, page_referrer: referrer };
  /** @type {AnalyticsWindow} */ (window).gtag('js', new Date());
  /** @type {AnalyticsWindow} */ (window).gtag('set', { ...page, allow_google_signals: false, allow_ad_personalization_signals: false });
  /** @type {AnalyticsWindow} */ (window).gtag('config', measurementId, { ...page, send_page_view: false,
    allow_google_signals: false, allow_ad_personalization_signals: false });
  window.addEventListener('oddbout:milestone', event => {
    if (!permitted()) return;
    const { name, parameters = {} } = /** @type {CustomEvent} */ (event).detail ?? {};
    if (!['game_start', 'match_complete', 'creation_start'].includes(name)) return;
    /** @type {Record<string, string>} */
    const safe = { ...page, send_to: measurementId };
    if (['play', 'watch', 'tournament', 'exhibition'].includes(parameters.mode)) safe.mode = parameters.mode;
    if (['ko', 'decision', 'forfeit', 'timeout', 'win', 'loss'].includes(parameters.result)) safe.result = parameters.result;
    if (name === 'creation_start') safe.method = 'request_copy';
    /** @type {AnalyticsWindow} */ (window).gtag('event', name, safe);
  });
  window.dispatchEvent(new CustomEvent('oddbout:analytics-ready'));
  /** @type {AnalyticsWindow} */ (window).gtag('event', 'page_view', { ...page, page_title: document.title });
  const script = document.createElement('script');
  script.async = true; script.referrerPolicy = 'no-referrer';
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.append(script);
}

/** @param {string} measurementId @param {string} siteUrl @param {string | null} [apiBase] */
export function analyticsSource(measurementId, siteUrl, apiBase = null) {
  if (!/^G-[A-Z0-9]{6,20}$/.test(measurementId ?? '')) throw new Error('Invalid GA4 measurement ID');
  const site = new URL(siteUrl);
  if (site.protocol !== 'https:') throw new Error('Analytics requires the HTTPS public site');
  return `(${startAnalytics.toString()})(${JSON.stringify(measurementId)}, ${JSON.stringify(site.hostname)}, ${JSON.stringify(apiBase)});`;
}

/** @param {string} html @param {boolean} [privacy] */
export function analyticsHtml(html, privacy = false) {
  if (privacy) {
    const anchor = '<h3>Technical information</h3>';
    if (!html.includes(anchor)) throw new Error('Review the analytics privacy notice after source changes');
    html = html.replace(anchor, '<h3>Website analytics</h3><p>We use Google Analytics to measure visits, page views, game starts, match completions and copying a creation request. For visitors who allow Analytics and sign in, we link the Analytics browser identifier to their account within our backend so that a successful server-validated fighter registration can be counted. This link is retained for at most 30 days and is not sent to Google as an account identifier. Google Analytics uses cookies and browser or device information to produce usage reports. We do not send account emails, sign-in tokens, fighter uploads or account identifiers to Analytics. Our tag keeps only standard campaign tags in page addresses, excludes other query parameters and URL fragments, and reduces referral addresses to website origins. Advertising personalization and Google signals are disabled. <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">How Google uses information from sites that use its services ↗</a></p>' + anchor)
      .replace('<strong>Google</strong> — account sign-in.', '<strong>Google</strong> — account sign-in and website usage analytics.')
      .replace('Google may use its own cookies during sign-in.', 'Google may use its own cookies during sign-in and for Analytics. You can block Analytics with browser privacy tools or the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">Google Analytics opt-out browser add-on</a>. Our tag also respects Global Privacy Control.');
  }
  if (!html.includes('</head>')) throw new Error('Missing HTML head');
  return html.replace('</head>', `<script type="module">import ${JSON.stringify(virtualId)};</script>\n</head>`);
}

/** @param {string | undefined} measurementId @param {string} siteUrl @param {string | null} [apiBase] @returns {SitePlugin | null} */
export function googleAnalyticsPlugin(measurementId, siteUrl, apiBase = null) {
  if (!measurementId) return null;
  const source = analyticsSource(measurementId, siteUrl, apiBase);
  return {
    name: 'oddbout-google-analytics',
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) { if (id === resolvedId) return source; },
    transformIndexHtml: { order: 'pre', handler(html, context) {
      return analyticsHtml(html, context.filename.replaceAll('\\', '/').endsWith('/privacy.html'));
    } },
  };
}
