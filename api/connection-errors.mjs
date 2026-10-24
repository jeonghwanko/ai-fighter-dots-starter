// Classify only observable transport failures. Never return raw messages (URLs/tokens may be present).
export function transportCode(error) {
  const seen = new Set(), queue = [error], messages = [], codes = [];
  while (queue.length && seen.size < 12) {
    const item = queue.shift();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    messages.push(String(item.message ?? '')); codes.push(item.code, item.name);
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 8));
  }
  const message = messages.join(' ');
  if (/\b(?:CONNECT|tunnel|proxy)\b[^\n]{0,160}\b403\b/i.test(message)) return 'network-connect-forbidden';
  if (codes.some(code => ['TimeoutError', 'AbortError', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code))) return 'network-timeout';
  if (codes.some(code => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))) return 'network-dns-failed';
  return 'api-unreachable';
}

export const isTransportCode = code => ['network-connect-forbidden', 'network-timeout', 'network-dns-failed', 'api-unreachable'].includes(code);

export function connectionAction(code) {
  if (code === 'network-connect-forbidden') return { actor: 'environment-preparer', code: 'prepare-workspace-network',
    message: 'VM 연결 프록시가 CONNECT 요청을 차단했다. 초기 환경 준비자가 필요한 호스트 허용과 환경 재게시(Republish)를 확인한다. 키트는 네트워크 설정을 변경할 수 없다. 일반 제작 사용자에게 재로그인을 요구하지 않는다.' };
  if (isTransportCode(code)) return { actor: 'environment-preparer', code: 'check-workspace-connectivity',
    message: 'VM에서 서비스까지 연결하지 못했다. 네트워크·DNS·시간 제한을 확인하고 복구 후 기존 작업을 다시 조회한다. 원인이 불명확하면 허용목록 누락이나 계정 오류로 단정하지 않는다.' };
  if (['authentication-required', 'client-sign-in-required', 'api-http-401'].includes(code)) return { actor: 'user', code: 'connect-oddbout',
    message: 'ODDBOUT 연결에서 본인 Google 계정으로 로그인하고 이 작업 공간의 연결 요청을 승인한다.' };
  if (['forbidden', 'access-denied', 'api-http-403'].includes(code)) return { actor: 'service-operator', code: 'check-service-access',
    message: '서비스가 요청을 거부했다. VM CONNECT 차단과 구분하여 계정·서비스 정책을 확인한다. 자동 재로그인이나 보안 설정 우회는 하지 않는다.' };
  return { actor: 'agent', code: 'recheck-connection', message: '응답을 확인한 뒤 같은 작업 공간의 연결 상태를 다시 조회한다. 새 생성이나 등록으로 연결을 시험하지 않는다.' };
}
