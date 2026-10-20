# 에이전트 계정 연결 (로컬 구현, 운영 미적용)

기존 Supabase Auth 계정을 사용한다. 사람이 Google 가입·로그인과 연결 승인을 수행하면,
에이전트는 사용자 JWT/refresh token 없이 기존 선수 API와 stdio MCP를 호출한다.
에이전트의 브라우저 자동 조작은 필요 없다. Google의 사용자 인증·동의 화면 자체를 없애는 기능은 아니다.
홈페이지·게임 계정 UI는 이 저장소에 없으므로 사용자 PC에서 여는 승인 화면과 게임 저장소용 어댑터를 제공한다.

## 선택한 방식과 OSS

기존 `@supabase/supabase-js` **2.117.3** 및 포함된 Auth SDK(MIT)를 유지했다.
[supabase-js 원천](https://github.com/supabase/supabase-js), [Auth 서버 OSS](https://github.com/supabase/auth)를 우선 검토했으며
새 인증 공급자나 OAuth 라이브러리를 추가하지 않았다.
로그인은 SDK `signInWithOAuth({provider:'google'})`, `flowType:'pkce'`,
`exchangeCodeForSession()`을 사용한다. 서버는 `getClaims()`의 검증 결과를 사용한다.
SDK는 대칭 서명일 때 내부에서 Auth 서버로 검증하므로 별도의 decode-only/getUser 우회 분기를 두지 않는다.
기존 사용자 세션 파일의 갱신·동시 refresh 잠금은 그대로 유지한다.

2026-10-20에 확인한 공식 문서:

- [OAuth 시작](https://supabase.com/docs/guides/auth/oauth-server/getting-started):
  native OAuth 서버는 beta이며 동의 UI와 클라이언트 등록이 필요하다.
- [OAuth 흐름](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows):
  PKCE authorization code와 refresh를 지원하지만 custom scope는 아직 지원하지 않는다.
- [토큰·RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security):
  기본 `aud`는 `authenticated`이며 OIDC scope는 DB/API 작업 권한을 제한하지 않는다.
  owner RLS만으로는 OAuth client를 최소 권한으로 제한할 수 없다.
- [Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google),
  [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow):
  사용자의 Google 인증과 앱의 PKCE 세션 교환은 Supabase에 맡긴다.
- [Changelog](https://supabase.com/changelog):
  Node 20 지원 종료, OAuth token endpoint의 200 응답, 새 테이블의 Data API 노출 변경을 확인했다.
  현재 Node 24와 기존 SDK를 사용하며 SQL에서 service_role 권한을 명시한다.
  `changelog.md`는 웹 도구에서 content-type 오류, 직접 요청에서는 403이라 HTML 목록을 확인했다.

위 문서에 근거해 **자체 짧은 수명 pairing grant**를 먼저 구현했다. OAuth 서버를 새로 만들거나
Supabase 사용자 인증을 교체한 것은 아니다. OAuth device grant(RFC 8628)라고 주장하지 않는다.
Supabase native OAuth access token은 이 API에서 소유자 토큰으로 받아들이지 않는다.
`client_id`가 있는 JWT는 거부하며 기존 선수·제출 RLS에도 restrictive 정책을 준비했다.
`ai-fighter-beta` Storage는 기존 API 전용 경계를 유지하도록 anon/authenticated의 직접 접근을
restrictive 정책으로 차단한다. 공유 프로젝트의 광범위한 기존 Storage 정책으로 API 검사를 우회하지 못한다.
다른 bucket의 정책·데이터는 변경하지 않는다.

이 경로는 **범용 remote HTTP MCP OAuth 호환 경로가 아니다**. 기존 stdio 전송을 유지한다.
native OAuth의 audience hook은 존재하지만, MCP의 resource indicator와 요청별 resource audience 발급,
클라이언트별 refresh/철회, protected-resource discovery의 종단 호환은 시험하지 않았다.
향후 도입 시 검증된 `sub/client_id/aud/iss/exp`와 서버 grant를 함께 확인하고,
다른 게임 테이블·Storage를 포함한 모든 RLS를 검토해야 한다. `aud=authenticated`만으로
어떤 remote MCP 서버에나 토큰을 보내면 안 된다.

## 흐름과 권한

1. 에이전트 CLI가 로컬에서 256비트 bearer와 128비트 사용자 확인 코드를 만든다.
   `/connections/start`는 각각의 SHA-256만 저장한다. 요청 ID로 네트워크 재시도가 동일 연결을 반환한다.
2. 에이전트가 사용자에게 코드와 서버가 생성한 agent ID를 보여 준다. **코드는 자신이 시작한 요청에서만 받는다.**
3. 사용자가 승인 화면에서 Google로 가입·로그인한다. 같은 Supabase 프로젝트의 `auth.users.id`가 소유자다.
   첫 Google 로그인에서 계정이 생성될 수 있지만 제출 초대는 자동 발급하지 않는다.
4. 확인 화면이 서버의 client 이름, agent ID, 대상 API, 요청 권한, 대기 만료를 표시한다.
   코드나 로그인 계정이 바뀌면 동의를 무효화하고, 서버도 inspect 시 확인한 계정과 승인 JWT를 대조한다.
   사용자가 권한과 15분/1시간을 직접 선택한 후 승인한다. 기본 선택된 권한은 없다.
5. CLI `status`로 승인 결과를 확인하고 같은 비공개 설정 파일을 기존 MCP에 지정한다.
6. 요청마다 서버에서 토큰 해시, client, resource, 상태, 만료, 허용 작업을 검사한다.
   소유자는 grant의 `owner_id`, 실행자는 별도의 `agent_id/client_id`로 기록한다.
7. 사용자가 연결 해제하면 다음 보호 API 요청부터 차단된다. 에이전트의 `cancel`도 자신을 즉시 차단한다.

| 권한 | 허용 API |
| --- | --- |
| `fighter:read` (CLI 기본 요청) | GET `/fighters` (자기 선수 또는 null), `/submissions/:id`, `/fighters/:id`, `/fighters/:id/statistics` |
| `fighter:submit` (명시적 요청·승인) | POST `/submissions`, PUT `/submissions/:id/assets/:assetId`, POST `/submissions/:id/submit` |

관리자·작업자·게임 출전 승인·선수 삭제/교체·권한 재위임은 제공하지 않는다.
등록은 기존 초대·불변 제출·중복키·용량·`owner_id UNIQUE`/`fighter-quota` 제한을 통과해야 한다.
기존 Sparring Bot이 있는 소유자는 새 선수 생성이 409 `fighter-quota`로 거절된다.
공개 spec/roster/duels/rankings는 원래 공개 API이며 연결 철회의 대상이 아니다.

연결 대기는 10분, 승인 수명은 60~3600초이고 refresh나 자동 연장은 없다.
동일 승인 재시도는 기존 만료를 반환한다. 만료·거절·취소·철회한 연결은 되살리지 않는다.
새 연결 요청은 새 비공개 설정 경로를 사용한다.
사람의 로그아웃과 에이전트 연결 해제는 별개다. 화면에 그 차이를 표시한다.
Google 로그인 취소/실패는 `login-cancelled`/`login-callback-failed`로 처리하고 승인하지 않는다.
동의 화면 취소는 거절로 확정하며, 창을 닫아버린 대기 요청은 10분 후 만료된다.

## 설치 및 운영자가 준비할 최소 설정

이번 작업에서는 아래 운영 작업을 **수행하지 않았다**. 실제 연결 전에 별도의 검토·승인이 필요하다.
새 영구 인증 권한, Google OAuth 앱/키, 장기 refresh 권한을 자동 생성하는 스크립트는 없다.

1. 기존 프로젝트의 Google 로그인 설정을 재사용한다. 없으면 운영자가 별도 승인 후 설정한다.
   Supabase Site URL/Redirect allowlist에 사용자 PC용 `http://127.0.0.1:8791/` 또는
   게임 홈페이지의 정확한 HTTPS callback을 추가한다. 와일드카드를 사용하지 않는다.
   로컬 CLI/UI는 `https://<20자리 project ref>.supabase.co`와 `sb_publishable_` 키를 사용한다.
   브라우저·에이전트에 service/secret key를 넣지 않는다.
2. [SQL 준비 파일](../supabase/pending/agent-connections.sql)을 검토한다.
   이 환경의 CLI 2.121.0은 읽기 전용 `/home/agent/.supabase` 생성 시 EROFS로 실패했고,
   구버전 CLI 2.54.11 설치도 postinstall exit 1로 실패했다.
   따라서 timestamp migration을 임의로 만들지 않고 `supabase/pending`에 보관했다.
   CLI가 정상인 환경에서 `supabase migration new agent_connections`로 생성한 파일에 내용을 옮긴 뒤
   프로젝트의 기존 이력과 대조한다. 운영 적용·`db push`·`db reset`은 이 문서의 자동 절차가 아니다.
   로컬 테스트는 기존 migrations 다음에 준비 SQL을 직접 적용한다.
3. 검토된 SQL 적용 후 `af_connection_clients.id='ai-fighter-stdio'` 행을 운영자가 명시적으로 활성화한다.
   기본은 `enabled=false`다. 이는 공개 client 등록으로 프로그램 배포자의 신원을 증명하지 않는다.
   client ID/header만으로 접근할 수 없고, 승인된 비밀 bearer가 함께 필요하다.
4. API/Edge 소스 반영 시 issuer와 resource를 서버의 `SUPABASE_URL`로 고정한다.
   이 저장소의 Edge 진입점은 이미 이를 전달한다.
   기존 **실제 duel engine 번들을 보존**한다. 저장소의 빈 engine adapter를 운영에 덮어쓰지 않는다.
   사용자 초대 `af_creators`와 worker는 기존 설정을 재사용한다.
5. 로그에서 Authorization·확인 코드·token/code hash·로그인 callback query를 수집하지 않도록 설정한다.
   코드·토큰이 채팅 기록이나 소스 관리에 저장되지 않게 한다.

Node >=22.12와 기존 lockfile 의존성으로 실행한다 (`npm ci`는 설치일 뿐 CI 서비스 실행 명령이 아니다).
저장소 밖에 사용자만 읽는 디렉터리를 먼저 준비한다. Windows에서는 해당 디렉터리의 사용자 ACL도 설정한다.

```sh
# 에이전트 측: 조회만 요청
npm run connect -- start /private/ai-fighter-agent.json https://YOUR_PROJECT_REF.supabase.co
# 새 파일로 조회 + 제출 요청
npm run connect -- start /private/ai-fighter-submit.json https://YOUR_PROJECT_REF.supabase.co submit

# 사용자 PC: Google 로그인/승인 화면 (브라우저를 자동 실행하지 않음)
npm run connect:ui -- https://YOUR_PROJECT_REF.supabase.co sb_publishable_YOUR_PUBLIC_KEY
# 사람이 http://127.0.0.1:8791/ 를 열고 코드 확인 → 로그인 → 명시적 승인

# 에이전트 측: 명시적으로 확인. 숨은 무한 polling/갱신은 하지 않음
npm run connect -- status /private/ai-fighter-submit.json
# 스스로 연결 취소/중단
npm run connect -- cancel /private/ai-fighter-submit.json
```

원격 클라우드 VM에서 화면 서버를 실행해도 사용자 PC의 loopback으로 접속할 수 없다.
승인 화면은 **사용자 PC에 설치한 동일 체크아웃**에서 실행하거나 게임 홈페이지에 통합해야 한다.
공유 클라우드 VM의 0.0.0.0으로 승인 UI를 열지 않는다.
서비스 토큰은 출력하지 않고 0600 파일에만 저장한다. CLI 시작 응답의 코드는 사용자에게 전달하기 위한 정보다.
기존 세션 파일도 POSIX에서 현재 사용자 소유·0600이어야 하며, 부모 디렉터리는 다른 사용자가 쓸 수 없어야 한다.
너무 넓은 파일 권한, 심링크·하드링크는 `unsafe-client-config`로 거절한다. 필요한 경우 소유자가 실제 파일을
확인한 후 권한을 수정한다. CLI는 링크 대상에 자동 chmod를 하지 않는다. Windows ACL 검증은 운영자가 수행한다.
잘못된 JSON은 내용을 포함하지 않는 `invalid-client-config`로 처리해 stderr에 토큰 조각이 나오지 않는다.
실패한 시작을 같은 파일로 재시도하면 같은 요청을 복구한다. 기존 사용자 세션 파일은 덮어쓰지 않는다.

기존 stdio MCP 설정에서 환경 변수만 지정한다:

```json
{
  "command": "node",
  "args": ["/path/to/ai-fighter-dots-starter/mcp/stdio.mjs"],
  "env": {
    "AI_FIGHTER_ROOT": "/path/to/your/fighter/packages",
    "AI_FIGHTER_CLIENT_CONFIG": "/private/ai-fighter-submit.json"
  }
}
```

`submit_fighter_package`, `get_fighter_submission`, `get_registered_fighter`의 인자는 바뀌지 않는다.
`get_my_fighter`를 호출하면 선수 ID를 미리 몰라도 서버가 연결 소유자의 기존 선수 또는 null을 반환한다.
실제 제출은 사용자의 제출 의도가 있을 때만 수행하고 같은 패키지 재시도는 같은 idempotencyKey를 사용한다.
별도 JWT 세션 파일을 쓰던 기존 사용자도 계속 사용할 수 있지만, 에이전트 신규 연결에는 위 grant 방식을 권장한다.
최신 main의 `open_creator_homepage`는 기존 사용자 세션에서만 유지한다.
제한된 연결 설정은 `session()`을 제공하지 않고 이 도구를 노출하지 않으므로,
에이전트 grant로 일반 사용자 홈페이지 로그인 링크를 만들거나 권한을 확장하지 않는다.

## HTTP 계약

기본 경로: `https://PROJECT.supabase.co/functions/v1/ai-fighter`.
모든 JSON 응답은 `Cache-Control: no-store`다. 서버는 요청 body의 owner/agent/resource 추가 필드를 거부한다.
원시 토큰·확인 코드는 로그에 기록하지 않는다.

| 메서드·경로 | 인증 | body |
| --- | --- | --- |
| POST `/connections/start` | 없음, 활성 등록 client만 | `requestId`, `clientId`, `tokenHash`, `codeHash`, `permissions` |
| POST `/connections/status` | 연결 bearer + binding 헤더 | `{}` |
| POST `/connections/cancel` | 연결 bearer + binding 헤더 | `{}` |
| POST `/connections/inspect` | 일반 사용자 JWT | `code` |
| POST `/connections/approve` | 일반 사용자 JWT | `code`, `permissions`, `seconds`, `expectedSubject` (inspect 결과의 subject) |
| POST `/connections/deny` | 일반 사용자 JWT | `code` |
| GET `/connections` | 일반 사용자 JWT | 없음; 자기 활성 연결 우선 + 최근 이력, 최대 100개 |
| POST `/connections/revoke` | 일반 사용자 JWT | `connectionId` |

연결 bearer 요청은 `Authorization: Bearer afg_…`,
`X-AF-Client-ID: ai-fighter-stdio`, `X-AF-Resource: <정확한 기본 API URL>`을 모두 보낸다.
이는 OAuth audience claim으로 가장하는 것이 아니라 서버의 저장된 resource와 일치시키는 자체 프로토콜이다.
JWT 소유자 요청은 서명·UUID sub·정확한 issuer·`role/aud=authenticated`·exp·비익명·client_id 부재를 검증한다.
승인 요청의 `expectedSubject`는 계정 변경 감지용일 뿐 소유권의 근거가 아니다. 서버는 검증된 JWT로 owner를 정한다.
inspect 이후 계정이 바뀌면 403 `connection-account-changed`이며 다시 확인·동의해야 한다.
403은 권한/상태/client/resource 오류, 404는 다른 소유자 또는 없는 연결, 409는 중복키 내용 충돌,
429는 제한, 503은 저장소 장애 또는 설정 미완료다. 실패 시 소유자 경로로 재시도하지 않는다.

## 게임 홈페이지 저장소에 필요한 정확한 연동

1. 같은 Supabase 프로젝트의 기존 로그인 client를 [auth/owner-client.mjs](../auth/owner-client.mjs)의
   `createOwnerConnectionClient({supabase,url})`에 전달한다. 이미 로그인했다면 새 계정이나 세션 복사를 만들지 않는다.
2. 로그인 callback에서 PKCE `exchangeCodeForSession`을 한 번 수행한다.
   이 저장소 UI처럼 query를 history에서 제거하고, 외부 return URL을 신뢰하지 않는다.
   기존 홈페이지가 callback을 소유하면 `owner.callback()`을 중복 호출하지 않는다.
3. `inspect(code)`로 요청 정보를 읽고 사용자 계정·client·agent ID·resource·권한·만료를 표시한다.
   권한 선택 후 `approve(code,permissions,seconds)`, 거절/화면 취소는 `deny(code)`를 호출한다.
   코드 수정·계정 변경·화면 이탈 시 `clearConsent()`와 화면의 확인 정보를 함께 초기화한다.
   어댑터는 inspect 결과의 subject를 승인에 포함하고 오래된 비동기 inspect 결과를 버린다.
4. 계정 설정에 `list()`와 `revoke(id)`를 연결한다.
   웹 쿠키를 쓰는 프록시로 바꾸면 해당 저장소에서 CSRF/Origin 검사를 추가해야 한다.
   여기 제공한 화면은 Authorization 헤더만 사용하며 cross-origin 쿠키를 전송하지 않는다.
5. 게임의 선수 소유자는 기존 Supabase `sub`와 동일해야 한다. 이메일·표시 이름·요청 body로
   기존 선수의 owner_id를 재지정하지 않는다. 다른 Auth 프로젝트/별도 게임 ID라면 양쪽 계정 소유 증명을
   검증하는 서버 매핑이 추가로 필요하다. 이 저장소에는 게임 스키마가 없어 임의 매핑·계정 병합을 구현하지 않았다.
   같은 이메일로 다른 UUID가 생겼다고 기존 Sparring Bot을 복사·삭제·덮어쓰지 않는다.

## 보안 경계와 남은 검증

grant/client/event 테이블은 RLS를 켜고 anon/authenticated의 모든 접근을 회수했다.
RPC는 SECURITY INVOKER, 빈 search_path, service_role 전용 EXECUTE다.
클라이언트 `enabled`도 매 보호 요청에 검사한다. 권한 행의 owner·agent·client로 허용 시도 audit를 남기며,
audit는 작업 성공 영수증을 의미하지 않는다. 이후 입력 검증·선수 소유권 검사에서 거절될 수도 있다.
등록 worker와 사용자/에이전트는 계속 분리한다.

연결 해제 완료 **이후 시작되는 보호 요청**은 거부된다. 철회 직전에 이미 권한 검사를 통과한 HTTP 요청과
진행 중 Storage 업로드는 완료될 수 있다. DB와 Storage를 가로지르는 취소 트랜잭션이나 이미 공개된 데이터를 회수하는
기능은 없다. 업로드 뒤 submit 단계는 다시 grant를 확인하므로 해제 뒤 새 submit은 차단된다.
그 사이 만들어진 미등록 제출은 기존 24시간 업로드 만료 정책을 따른다.

익명 연결 생성은 전체 20회/분, 활성 pending 100개, 전체 기록 10,000개로 제한한다.
소유자당 동시 활성 연결은 10개, 보호 API 허용 시도는 grant당 120회/분이다.
대기·이력 정리는 자동화하지 않는다. 공개 대규모 서비스 전에는 배포 프록시의 IP rate limit/봇 방지,
status/inspect 요청 제한과 audit 보존·정리 운영을 추가 검증한다.

로컬 테스트에서는 PGlite의 실제 PostgreSQL로 migration/RLS/상태 전이/쿼터를 검사하고,
Storage 전송과 대부분의 Auth 응답은 mock한다. 별도 테스트는 메모리에서만 만든 일회성 ES256 키와
mock JWKS로 실제 설치 SDK의 서명 검증·변조 거절 및 service_role 세션 분리를 확인한다.
SDK의 Google PKCE URL 생성과 DOM stub의 동의 UI 상태를 확인하되 실제 브라우저·Google 왕복을 대신하지 않는다.
동시성 시험은 단일 PGlite 엔진의 요청 순서·상태 불변식 시험이며 운영 PostgreSQL 다중 연결 부하 시험은 아니다.
실제 Google 왕복·Supabase Auth JWKS/세션 폐기·운영 PostgREST·Edge gateway·private Storage·홈페이지 화면 조작·
범용 remote MCP OAuth는 운영/테스트 계정 없이 검증하지 않았다.

```sh
npm run test:connections
npm test
```

전체 회귀 테스트 수와 독립 공격 관점 리뷰 결과는 [보안 재검증 보고서](AGENT-CONNECTIONS-SECURITY-REVIEW.md)에 있다.
