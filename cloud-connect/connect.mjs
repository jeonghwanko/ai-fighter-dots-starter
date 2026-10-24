export function safeClientRedirect(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ['chatgpt.com', 'chat.openai.com'].includes(u.hostname); } catch { return false; }
}
export function authorizationId(search, stored) {
  const id = new URLSearchParams(search).get('authorization_id') ?? stored;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,256}$/.test(id) ? id : null;
}
async function start() {
  const byId = id => document.getElementById(id), status = text => { byId('status').textContent = text; };
  const key = 'oddbout-authorization-id', id = authorizationId(location.search, sessionStorage.getItem(key));
  if (!id) { status('Dots의 ODDBOUT 플러그인에서 연결을 시작해 주세요. 이 페이지를 직접 열어서는 연결할 수 없습니다.'); return; }
  sessionStorage.setItem(key, id);
  const auth = globalThis.supabase.createClient('https://ztfxxhtmtrvxvuxlqmgz.supabase.co',
    'sb_publishable_6UkV7tRAQ1P4qss5cTYSwQ_kVxSIv_V', { auth: { flowType: 'pkce', storage: sessionStorage,
      storageKey: 'oddbout-cloud-consent', detectSessionInUrl: true, persistSession: true } }).auth;
  const go = value => {
    if (!safeClientRedirect(value)) throw new Error('unsafe-redirect');
    sessionStorage.removeItem(key); location.replace(value);
  };
  const fail = () => { status('연결 요청이 만료되었거나 확인할 수 없습니다. Dots로 돌아가 ODDBOUT 연결을 다시 시작해 주세요.'); };
  const { data: { session }, error } = await auth.getSession();
  history.replaceState(null, '', `/connect.html?authorization_id=${encodeURIComponent(id)}`);
  if (error) { fail(); return; }
  if (!session || session.user.is_anonymous) {
    status('등록할 캐릭터를 소유할 Google 계정으로 로그인하세요.'); byId('login').hidden = false;
    byId('login').onclick = async () => {
      byId('login').disabled = true;
      const { error } = await auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo: `${location.origin}/connect.html?authorization_id=${encodeURIComponent(id)}`, queryParams: { prompt: 'select_account' } } });
      if (error) { fail(); byId('login').disabled = false; }
    }; return;
  }
  const details = await auth.oauth.getAuthorizationDetails(id);
  if (details.error || !details.data) { fail(); return; }
  if (details.data.redirect_url) { go(details.data.redirect_url); return; }
  if (!safeClientRedirect(details.data.redirect_uri)) { status('지원하는 Dots 연결 요청이 아닙니다. 연결을 승인하지 않았습니다.'); return; }
  byId('account').textContent = `연결 계정: ${session.user.email ?? 'Google 계정'}`;
  byId('client').textContent = `요청 앱: ${details.data.client.name ?? 'ChatGPT'} · ${new URL(details.data.redirect_uri).hostname}`;
  status('아래 권한을 확인하고 연결을 승인하세요.'); byId('consent').hidden = false;
  for (const action of ['approve', 'deny']) byId(action).onclick = async () => {
    byId('approve').disabled = byId('deny').disabled = true;
    try {
      const result = await auth.oauth[action === 'approve' ? 'approveAuthorization' : 'denyAuthorization'](id, { skipBrowserRedirect: true });
      if (result.error || !result.data?.redirect_url) throw new Error('consent-failed');
      go(result.data.redirect_url);
    } catch { fail(); byId('approve').disabled = byId('deny').disabled = false; }
  };
}
if (typeof document !== 'undefined') start().catch(() => {
  document.getElementById('status').textContent = '연결을 완료하지 못했습니다. Dots에서 연결을 다시 시작해 주세요.';
});
