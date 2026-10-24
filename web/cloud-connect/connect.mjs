export function safeClientRedirect(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ['chatgpt.com', 'chat.openai.com'].includes(u.hostname); } catch { return false; }
}
export function authorizationId(search, stored) {
  const id = new URLSearchParams(search).get('authorization_id') ?? stored;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,256}$/.test(id) ? id : null;
}
export function connectionLocale(requested, saved, browser = '') {
  return ['en','ko'].includes(requested) ? requested : ['en','ko'].includes(saved) ? saved : browser.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
export const copy = {
  ko: {
    title:'ODDBOUT · Dots 연결', headline1:'나의 캐릭터,', headline2:'링 위로.',
    lead:'Google 계정을 연결하고\nDots에서 캐릭터를 등록하세요.',
    stepConnect:'계정 연결', stepConsent:'권한 확인', panelTitle:'계정을 선택하세요', consentTitle:'Dots에 연결할까요?', errorTitle:'연결을 다시 시작해 주세요',
    google:'Google로 계속하기', permissions:'허용할 권한', permission1:'기본 프로필·이메일 확인', permission2:'내 캐릭터·등록 상태 조회', permission3:'내가 요청한 캐릭터 파일 업로드·등록',
    permissionNote:'생성 구독이나 결제 권한은 포함되지 않습니다.', approve:'연결 승인', cancel:'취소', loginNote:'PC 설치 없이 연결됩니다.',
    privacy:'개인정보', help:'도움말', returnDots:'Dots로 돌아가기', loading:'연결 요청을 확인하고 있습니다.',
    login:'캐릭터를 소유할 계정으로 로그인하세요.', consent:'Dots에서 시작한 요청인지 확인해 주세요.',
    noRequest:'Dots의 ODDBOUT 플러그인에서 연결을 시작해 주세요.', failed:'요청이 만료되었거나 연결할 수 없습니다. Dots에서 다시 시도해 주세요.',
    unsafe:'지원하는 연결 요청이 아닙니다. 권한을 승인하지 않았습니다.', googleAccount:'Google 계정', connecting:'Google 로그인으로 이동합니다.', approving:'연결을 마무리하고 있습니다.'
  },
  en: {
    title:'ODDBOUT · Connect to Dots', headline1:'Your fighter.', headline2:'Into the ring.',
    lead:'Connect with Google to register\nyour fighter from Dots.',
    stepConnect:'CONNECT ACCOUNT', stepConsent:'REVIEW ACCESS', panelTitle:'Choose your account', consentTitle:'Connect to Dots?', errorTitle:'Start a new connection',
    google:'Continue with Google', permissions:'Access you allow', permission1:'Read your basic profile and email', permission2:'View your fighters and registration status', permission3:'Upload and register fighters you request',
    permissionNote:'No access to generation subscriptions or payments.', approve:'Approve connection', cancel:'Cancel', loginNote:'No PC setup required.',
    privacy:'Privacy', help:'Help', returnDots:'Return to Dots', loading:'Checking your connection request.',
    login:'Use the account that will own your fighter.', consent:'Confirm that you started this request in Dots.',
    noRequest:'Start the connection from the ODDBOUT plugin in Dots.', failed:'This request expired or could not be completed. Start again from Dots.',
    unsafe:'This connection request is not supported. No access was approved.', googleAccount:'Google account', connecting:'Opening Google sign-in.', approving:'Completing your connection.'
  }
};
async function start() {
  const byId = id => document.getElementById(id);
  let savedLanguage;
  try { savedLanguage = sessionStorage.getItem('oddbout-connect-language'); } catch {}
  let language = connectionLocale(new URLSearchParams(location.search).get('lang'), savedLanguage, navigator.language);
  let mode = 'loading', statusKey = 'loading', accountEmail = null, clientLabel = '';
  const render = () => {
    const words = copy[language];
    document.documentElement.lang = language; document.title = words.title;
    document.querySelector('.languages').setAttribute('aria-label', language === 'ko' ? '언어' : 'Language');
    document.querySelector('.connection').setAttribute('aria-label', language === 'ko' ? '계정 연결' : 'Account connection');
    document.querySelector('footer nav').setAttribute('aria-label', language === 'ko' ? '안내' : 'Information');
    for (const element of document.querySelectorAll('[data-copy]')) element.textContent = words[element.dataset.copy];
    for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === language));
    byId('status').textContent = words[statusKey];
    byId('step-number').textContent = mode === 'consent' ? '02' : '01';
    byId('step-label').textContent = words[mode === 'consent' ? 'stepConsent' : 'stepConnect'];
    byId('panel-title').textContent = words[mode === 'consent' ? 'consentTitle' : mode === 'error' ? 'errorTitle' : 'panelTitle'];
    byId('login').hidden = mode !== 'login'; byId('consent').hidden = mode !== 'consent';
    byId('login-note').hidden = mode !== 'login'; byId('retry-link').hidden = mode !== 'error';
    byId('account').textContent = accountEmail || words.googleAccount; byId('client').textContent = clientLabel;
    byId('privacy-link').href = '/ai-fighter-creator/privacy' + (language === 'ko' ? '.ko' : '') + '.html';
    byId('help-link').href = '/creator.html?lang=' + language;
    document.querySelector('.brand').href = '/?lang=' + language;
  };
  const state = (nextMode, nextStatus) => { mode = nextMode; statusKey = nextStatus; render(); };
  for (const button of document.querySelectorAll('[data-lang]')) button.onclick = () => {
    language = button.dataset.lang;
    try { sessionStorage.setItem('oddbout-connect-language', language); } catch {}
    const current = new URL(location.href); current.searchParams.set('lang', language);
    history.replaceState(null, '', current.pathname + current.search + current.hash);
    render();
  };
  render();
  const key = 'oddbout-authorization-id', id = authorizationId(location.search, sessionStorage.getItem(key));
  if (!id) { state('error', 'noRequest'); return; }
  sessionStorage.setItem(key, id);
  const auth = globalThis.supabase.createClient('https://ztfxxhtmtrvxvuxlqmgz.supabase.co',
    'sb_publishable_6UkV7tRAQ1P4qss5cTYSwQ_kVxSIv_V', { auth: { flowType: 'pkce', storage: sessionStorage,
      storageKey: 'oddbout-cloud-consent', detectSessionInUrl: true, persistSession: true } }).auth;
  const go = value => {
    if (!safeClientRedirect(value)) throw new Error('unsafe-redirect');
    sessionStorage.removeItem(key); location.replace(value);
  };
  const fail = () => state('error', 'failed');
  const { data: { session }, error } = await auth.getSession();
  history.replaceState(null, '', '/connect.html?authorization_id=' + encodeURIComponent(id) + '&lang=' + language);
  if (error) { fail(); return; }
  if (!session || session.user.is_anonymous) {
    state('login', 'login');
    byId('login').onclick = async () => {
      byId('login').disabled = true; statusKey = 'connecting'; render();
      const { error } = await auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo: location.origin + '/connect.html?authorization_id=' + encodeURIComponent(id) + '&lang=' + language, queryParams: { prompt: 'select_account' } } });
      if (error) { fail(); byId('login').disabled = false; }
    }; return;
  }
  const details = await auth.oauth.getAuthorizationDetails(id);
  if (details.error || !details.data) { fail(); return; }
  if (details.data.redirect_url) { go(details.data.redirect_url); return; }
  if (!safeClientRedirect(details.data.redirect_uri)) { state('error', 'unsafe'); return; }
  accountEmail = session.user.email;
  clientLabel = (details.data.client.name ?? 'ChatGPT') + ' · ' + new URL(details.data.redirect_uri).hostname;
  state('consent', 'consent');
  for (const action of ['approve', 'deny']) byId(action).onclick = async () => {
    byId('approve').disabled = byId('deny').disabled = true; statusKey = 'approving'; render();
    try {
      const result = await auth.oauth[action === 'approve' ? 'approveAuthorization' : 'denyAuthorization'](id, { skipBrowserRedirect: true });
      if (result.error || !result.data?.redirect_url) throw new Error('consent-failed');
      go(result.data.redirect_url);
    } catch { fail(); byId('approve').disabled = byId('deny').disabled = false; }
  };
}
if (typeof document !== 'undefined') start().catch(() => {
  const words = copy[document.documentElement.lang === 'ko' ? 'ko' : 'en'];
  document.getElementById('status').textContent = words.failed;
  document.getElementById('retry-link').hidden = false;
});
