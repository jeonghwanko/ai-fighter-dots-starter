import { createOwnerConnectionClient } from '/owner-client.mjs';
const state = new URL(location.href);
const callback = state.searchParams.get('code'), loginError = state.searchParams.has('error');
// Remove callback codes/errors before fetching configuration or starting Auth.
history.replaceState(null, '', '/');
const $ = id => document.getElementById(id);
const config = await (await fetch('/config.json')).json();
const supabase = globalThis.supabase.createClient(config.url, config.publishableKey, {
  auth: { flowType: 'pkce', storage: sessionStorage, persistSession: true, detectSessionInUrl: false, autoRefreshToken: true },
});
const owner = createOwnerConnectionClient({ supabase, url: config.url });
let inspectedCode;
let inspectionVersion = 0;
function clearConsent() {
  inspectedCode = null; inspectionVersion++; owner.clearConsent(); $('consent').hidden = true;
}
const run = fn => async () => {
  try { $('message').textContent = ''; await fn(); }
  catch (error) { $('message').textContent = /^[a-z0-9-]+$/.test(error.message) ? error.message : '요청을 완료하지 못했습니다.'; }
};
async function account() {
  const { data } = await supabase.auth.getUser();
  $('account').textContent = data.user ? `로그인 계정: ${data.user.email ?? data.user.id}` : '로그인이 필요합니다.';
}
await run(async () => {
  if (loginError) { sessionStorage.removeItem('login-pending'); throw new Error('login-cancelled'); }
  if (callback) {
    if (!sessionStorage.getItem('login-pending')) throw new Error('unexpected-login-callback');
    sessionStorage.removeItem('login-pending');
    await owner.callback(callback);
  }
  await account();
})();
$('code').value = sessionStorage.getItem('connection-code') ?? '';
$('code').oninput = clearConsent;
let currentSubject;
supabase.auth.onAuthStateChange((_event, session) => {
  const subject = session?.user?.id ?? null;
  if (subject !== currentSubject) clearConsent();
  currentSubject = subject;
  $('account').textContent = session?.user ? `로그인 계정: ${session.user.email ?? subject}` : '로그인이 필요합니다.';
});
$('login').onclick = run(async () => {
  sessionStorage.setItem('connection-code', $('code').value.trim());
  sessionStorage.setItem('login-pending', '1');
  location.assign(await owner.login(`${location.origin}/`));
});
$('logout').onclick = run(async () => {
  await supabase.auth.signOut({ scope: 'local' }); sessionStorage.clear();
  clearConsent(); $('connections').replaceChildren(); await account();
  $('message').textContent = '로그아웃했습니다. 에이전트 연결은 별도로 해제해야 합니다.';
});
$('inspect').onclick = run(async () => {
  clearConsent(); const started = inspectionVersion;
  const code = $('code').value.trim(), grant = await owner.inspect(code);
  if (started !== inspectionVersion || $('code').value.trim() !== code) return;
  if (grant.status !== 'pending') throw new Error(`connection-${grant.status}`);
  inspectedCode = code;
  $('details').textContent = `${grant.clientName}\n에이전트 ID: ${grant.agentId}\n대상: ${grant.resource}\n승인 대기 만료: ${grant.pendingUntil}`;
  for (const [id, permission] of [['read', 'fighter:read'], ['submit', 'fighter:submit']]) {
    $(id).checked = false; $(id).disabled = !grant.requested.includes(permission);
  }
  $('consent').hidden = false;
});
$('approve').onclick = run(async () => {
  if (!inspectedCode) throw new Error('inspect-required');
  if ($('code').value.trim() !== inspectedCode) { clearConsent(); throw new Error('inspect-required'); }
  const selected = [['read', 'fighter:read'], ['submit', 'fighter:submit']].filter(([id]) => $(id).checked && !$(id).disabled).map(([, p]) => p);
  await owner.approve(inspectedCode, selected, Number($('seconds').value));
  clearConsent(); sessionStorage.removeItem('connection-code');
  $('message').textContent = '연결을 승인했습니다. 에이전트에서 status를 확인하세요.'; await list();
});
async function deny() {
  if (!inspectedCode) throw new Error('inspect-required');
  if ($('code').value.trim() !== inspectedCode) { clearConsent(); throw new Error('inspect-required'); }
  await owner.deny(inspectedCode); clearConsent();
  sessionStorage.removeItem('connection-code'); $('message').textContent = '요청을 거절했습니다.';
}
$('deny').onclick = run(deny);
// Cancelling a displayed consent request makes it terminal, instead of leaving a hidden approval pending.
$('cancel').onclick = run(deny);
async function list() {
  const { items } = await owner.list(); $('connections').replaceChildren();
  for (const grant of items) {
    const row = document.createElement('div'), label = document.createElement('span');
    label.textContent = `${grant.clientName} · ${grant.agentId} · ${grant.status} · ${grant.permissions.join(', ')} · ${grant.expiresAt ?? ''}`;
    row.append(label);
    if (grant.status === 'approved') {
      const button = document.createElement('button'); button.textContent = '연결 해제';
      button.onclick = run(async () => { await owner.revoke(grant.id); await list(); $('message').textContent = '연결을 해제했습니다.'; });
      row.append(button);
    }
    $('connections').append(row);
  }
}
$('refresh').onclick = run(list);
