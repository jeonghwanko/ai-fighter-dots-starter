// Read-only public probes and authenticated GET /me. No OAuth start, upload or network policy mutation.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validProjectUrl } from '../api/client.mjs';
import { connectionAction, transportCode } from '../api/connection-errors.mjs';
import { isPublishableKey, pendingDeviceLoginPath } from '../scripts/login.mjs';

export async function readProject(root) {
  try {
    const site = JSON.parse(await readFile(path.join(root, 'deploy/creator-site.json'), 'utf8'));
    const origin = new URL(site.apiBase).origin, page = new URL(site.siteUrl);
    if (!validProjectUrl(origin) || site.apiBase !== `${origin}/functions/v1/ai-fighter` || !isPublishableKey(site.publishableKey)
      || !/^[A-Za-z0-9._-]+$/.test(site.publishableKey)
      || page.protocol !== 'https:' || page.username || page.password || page.search || page.hash) return null;
    return { origin, apiBase: site.apiBase, siteUrl: page.href, flags: `--url ${origin} --key ${site.publishableKey}` };
  } catch { return null; }
}

const unknown = reason => ({ status: 'unverified', reason, deviceLogin: 'unknown' });
/** A reachable HTTP error is different from a CONNECT failure before reaching the service. */
export async function probePublic(url, { spec = false, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: 'blocked', reason: `api-http-${response.status}`, httpStatus: response.status, deviceLogin: 'unknown',
        nextAction: response.status === 401 ? { actor: 'service-operator', code: 'check-public-service',
          message: '공개 준비 상태 주소가 인증을 요구한다. 서비스 운영자가 공개 경로 설정을 확인한다. 일반 사용자의 Google 로그인으로 대신하지 않는다.' }
          : connectionAction(`api-http-${response.status}`) };
    }
    if (!spec) { await response.body?.cancel(); return { status: 'reachable', httpStatus: response.status }; }
    let result;
    try { result = await response.json(); } catch { return unknown('invalid-api-response'); }
    if (result?.ok !== true || !result.data?.registration) return unknown('invalid-api-response');
    return { status: 'reachable', httpStatus: response.status, deviceLogin: result.data.registration.deviceLogin === 'v1' ? 'available' : 'unsupported' };
  } catch (error) {
    const reason = transportCode(error);
    return { status: 'blocked', reason, deviceLogin: 'unknown', nextAction: connectionAction(reason) };
  }
}

export async function probeConnections(project, { checkServer = true, probe = probePublic } = {}) {
  if (!project) return { api: unknown('public-config-invalid'), homepage: unknown('public-config-invalid') };
  if (!checkServer) return { api: unknown('server-not-checked'), homepage: unknown('server-not-checked') };
  const [api, homepage] = await Promise.all([probe(`${project.apiBase}/spec`, { spec: true }), probe(project.siteUrl)]);
  return { api, homepage };
}

/** Only a successful server response verifies the active MCP account; a local JWT claim never does. */
export async function checkAccount({ hasSession, remoteActive, request, checkServer }) {
  if (!hasSession) return { status: 'sign-in-required', canSubmit: null, accountMatch: 'unknown' };
  if (!remoteActive) return { status: 'restart-required', canSubmit: null, accountMatch: 'unknown' };
  if (!checkServer || !request) return { status: 'session-present-unverified', canSubmit: null, accountMatch: 'unknown' };
  try {
    const result = await request('me', { timeoutMs: 8000 });
    if (result?.ok !== true || typeof result.account?.invited !== 'boolean')
      return { status: 'unverified', reason: 'invalid-account-response', canSubmit: null, accountMatch: 'unknown' };
    return { status: 'connected', evidence: 'authenticated GET /me', canSubmit: typeof result.account.canSubmit === 'boolean' ? result.account.canSubmit : null,
      accountMatch: 'unknown' };
  } catch (error) {
    const reason = [401, 403].includes(error.status) ? `api-http-${error.status}`
      : /^[a-z][a-z0-9-]{0,80}$/.test(error.message) ? error.message : transportCode(error);
    return { status: ['authentication-required', 'client-sign-in-required', 'api-http-401'].includes(reason) ? 'sign-in-required' : 'blocked',
      reason, canSubmit: null, accountMatch: 'unknown', nextAction: connectionAction(reason) };
  }
}

export async function pendingConnection(sessionPath, { now = Date.now } = {}) {
  try {
    const pending = JSON.parse(await readFile(pendingDeviceLoginPath(sessionPath), 'utf8'));
    // Report presence/expiry only. Never return the secret device code, session or user identifier.
    if (pending?.version !== 1 || !Number.isFinite(Date.parse(pending.expiresAt))) return { status: 'unknown' };
    return { status: Date.parse(pending.expiresAt) > now() ? 'pending' : 'expired' };
  } catch (error) { return { status: error.code === 'ENOENT' ? 'none' : 'unknown' }; }
}

export function infrastructureItem(project, connections) {
  const blocked = [connections.api, connections.homepage].some(item => item.status === 'blocked');
  return { status: blocked ? 'blocked' : [connections.api, connections.homepage].every(item => item.status === 'reachable') ? 'service-reachable' : 'unverified',
    actor: 'environment-preparer', setupScope: 'once-per-workspace', networkSettingsManagedByKit: false,
    targets: { registrationApi: { host: project ? new URL(project.apiBase).hostname : null, ...connections.api },
      homepage: { host: project ? new URL(project.siteUrl).hostname : null, ...connections.homepage },
      library: { host: 'chatgpt.com', status: 'unverified', reason: 'helper-not-probed', requiredWhen: 'VM Library helper is the selected delivery route' } },
    note: '호스트 허용·Republish는 초기 환경 준비자가 공식 VM 설정에서 처리한다. 키트에는 이를 바꾸는 도구가 없으며 성공으로 처리하지 않는다. 제작 사용자는 준비된 작업 공간을 재사용한다.' };
}

export function unverifiedCreation(choice) {
  return {
    generation: { status: choice === 'stop' ? 'stopped' : 'unverified', providerChoice: choice ?? null,
      accountMatch: 'unknown', imageBackend: 'unknown',
      nextAction: { actor: 'agent', code: 'check-generation-access', message: '현재 실행 경로의 도구 가용성과 사용자 제약을 확인한다. 실제 호출 trace·완료 출력 전에는 성공을 검증했다고 하지 않는다. 확인용 이미지를 새로 만들지 않는다.' } },
    delivery: { status: 'unverified', localSave: 'unchecked', librarySave: 'unchecked', parentDisplay: 'unverified', userSelection: 'unchecked',
      evidenceScope: 'not-observed-by-readiness',
      nextAction: { actor: 'agent', code: 'check-parent-delivery', message: '기존 결과를 회수해 대상 부모 대화의 실제 표시·원본 전달 경로를 확인한다. Library 저장·자식 표시·queued·creation:delivery 통과는 부모 표시 성공이 아니다.' } },
  };
}
