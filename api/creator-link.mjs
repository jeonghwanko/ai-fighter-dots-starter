// @ts-check
import { Problem } from './http.mjs';

/** Must match Supabase Auth's "Email OTP expiration" setting; the page cannot redeem a token after Auth expires it. */
export const HANDOFF_TTL_SECONDS = 600;

/**
 * One-use sign-in for the creator homepage. Auth's admin API makes a magic-link token for the verified user without
 * sending mail; only its hash leaves here. The browser redeems it at /auth/v1/verify, which also enforces one use.
 */
export function createCreatorLink({ db, now = Date.now }) {
  return async owner => {
    const { data: found, error: lookup } = await db.auth.admin.getUserById(owner);
    if (lookup || !found?.user) throw new Problem(503, 'handoff-unavailable');
    const email = found.user.email;
    if (typeof email !== 'string' || !email) throw new Problem(422, 'handoff-email-required');
    const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    // The token must belong to the account that asked: never hand out a link for another user.
    if (error || data?.user?.id !== owner || typeof data?.properties?.hashed_token !== 'string') throw new Problem(503, 'handoff-unavailable');
    return { tokenHash: data.properties.hashed_token, expiresAt: new Date(now() + HANDOFF_TTL_SECONDS * 1000).toISOString() };
  };
}
