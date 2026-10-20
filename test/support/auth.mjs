export const claimsFor = (sub, extra = {}) => ({ sub, role: 'authenticated', aud: 'authenticated',
  iss: 'https://test/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false, ...extra });
export const authFor = sub => ({ getClaims: async () => ({ data: { claims: claimsFor(sub) } }) });
