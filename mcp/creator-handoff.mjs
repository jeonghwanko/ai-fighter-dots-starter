/** The public AI Fighter creator homepage on free GitHub Pages. */
export const PUBLIC_CREATOR_PAGE = 'https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html';
const LEGACY_CREATOR_PAGE = 'https://rupin.pryzm.gg/creator.html';

/** The page a link opens: the public homepage, or a loopback HTTP homepage for local development. */
export function creatorPage(value = PUBLIC_CREATOR_PAGE) {
  const url = new URL(value);
  // Upgrade saved pre-migration settings before attaching a sign-in token.
  if (url.href === LEGACY_CREATOR_PAGE) return creatorPage(PUBLIC_CREATOR_PAGE);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  const allowed = loopback ? url.pathname === '/creator.html'
    : url.href === PUBLIC_CREATOR_PAGE;
  if (!allowed || url.username || url.password || url.search || url.hash) throw new Error('creator-page-not-allowed');
  return { origin: url.origin, href: url.href };
}

/**
 * The server mints a one-use Supabase Auth token for the signed-in user; the link carries only its hash, in the fragment,
 * so it never reaches server logs or link-preview fetchers. The page redeems it on a click, in any browser on any device.
 */
export async function creatorLink({ page = PUBLIC_CREATOR_PAGE, request }) {
  const { href } = creatorPage(page);
  const { tokenHash, expiresAt } = await request('creator-handoffs', { method: 'POST' });
  if (typeof tokenHash !== 'string' || !/^[a-f0-9]{40,128}$/.test(tokenHash) || !Number.isFinite(Date.parse(expiresAt))) throw new Error('invalid-api-response');
  return { loginUrl: `${href}#handoff=${tokenHash}`, expiresAt };
}
