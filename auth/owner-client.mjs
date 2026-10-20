/** Browser integration adapter. Pass the existing first-party Supabase client from the game app. */
export function createOwnerConnectionClient({ supabase, url, fetchImpl = fetch }) {
  let consent = null, version = 0;
  const clearConsent = () => { consent = null; version++; };
  const api = async (route, value) => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error('sign-in-required');
    const response = await fetchImpl(`${url}/functions/v1/ai-fighter/connections${route ? `/${route}` : ''}`, {
      method: value === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.code ?? 'connection-request-failed');
    return result.connection;
  };
  return {
    clearConsent,
    // Google owns credential collection. Browser navigation is performed only by the human.
    async login(redirectTo) {
      clearConsent();
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true } });
      if (error || !data?.url) throw new Error('login-unavailable');
      return data.url;
    },
    async callback(code) {
      clearConsent();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error || !data.session) throw new Error('login-callback-failed');
      return true;
    },
    async inspect(code) {
      clearConsent(); const started = version;
      const result = await api('inspect', { code });
      if (started !== version) throw new Error('connection-inspection-stale');
      if (result.status === 'pending' && typeof result.subject === 'string') consent = { code, subject: result.subject };
      return result;
    },
    async approve(code, permissions, seconds = 900) {
      if (!consent || consent.code !== code) throw new Error('inspect-required');
      const expectedSubject = consent.subject;
      const result = await api('approve', { code, permissions, seconds, expectedSubject });
      clearConsent(); return result;
    },
    async deny(code) { const result = await api('deny', { code }); clearConsent(); return result; },
    revoke: connectionId => api('revoke', { connectionId }),
    list: () => api(''),
  };
}
