# 에이전트 연결 최종 보안 재검증 — 2026-10-20

작업 경로: `/workspace/ai-fighter-dots-starter`

기존 Supabase Auth·API·stdio MCP를 유지한 연결 기능을 구현하고, 독립 공격 관점 리뷰에서
재현된 문제를 수정했다. 최초 검증은 전체 90개, 최신 main 통합 후에는 **전체 93개 통과, 실패 0, skip 0**.
운영 반영은 하지 않았다.

## 후속 커밋 준비와 최신 main 통합

사용자가 커밋·푸시를 명시적으로 요청한 후 원격 main을 다시 확인했다.
새 main **`878aaa8597a8bf6f7f1a1ac43062b8adfc5ef42d`**의 홈페이지 일회용 로그인 링크 기능을
보존하며 로컬 `work` 브랜치의 변경을 rebase했다. 텍스트 충돌은 없었다.
해당 기능은 기존 사용자 세션에서만 노출하고, 제한된 grant는 `session()`을 제공하거나
`open_creator_homepage` 도구를 노출하지 않도록 통합 검사를 추가했다.

- 최초 검토한 29개 파일과 patch가 정확히 일치함을 확인하고 명시적으로 stage했다.
  통합 보완도 같은 29개 파일 안에 한정했다. 관련 없는 변경은 없다.
- 최신 main의 홈페이지 테스트 3개가 더해져 최종 `npm test`는 **93개 통과 / 실패 0 / skip 0**,
  약 34.4초다. 로그는 `output/agent-connections/review/pre-push-full.txt`.
- `npm run spec:check`와 `git diff --check`도 통과했다.
- 저장소에 `.github` 워크플로와 자동 배포 설정 파일은 없다. GitHub API 조회에서
  Actions 실행 이력은 0건, 최신 main commit status는 0건, Pages는 비활성 상태였다.
- 커밋에는 `[skip ci]`를 포함한다. GitHub 공식 지원 범위는 push/pull_request 워크플로이며
  외부 서비스의 webhook 전체를 차단하는 수단은 아니다.
  참고: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs
- CLI의 GitHub 토큰 상태 검사는 실패했고 직접 API 접근은 프록시 403으로 차단됐다.
  위 저장소·Actions·status·Pages 정보는 기존에 연결된 GitHub의 허용된 읽기 도구로 확인했다.
  외부 webhook/배포 서비스 설정 조회는 제공되지 않아 검증하지 못했다.
- CI·배포·운영 DB/OAuth/권한 변경은 계속 금지하며 실행하지 않는다.
  최종 푸시 결과·브랜치·커밋 SHA는 별도 완료 응답과 로컬 영수증에 기록한다.

## 기준과 테스트 수 정정

아래는 `85b31ef` 기준 최초 구현·독립 리뷰 시점의 기록이다.

원격 `main`을 다시 조회한 SHA와 로컬 HEAD는 모두
`85b31ef57d4708059926a2fcd33e391ea44721da`다. 브랜치는 `work`.
원래 깨끗한 체크아웃에서 fetch/ff-only merge로 최신 상태를 확인했으며
강제 reset·stash·커밋·푸시·PR은 하지 않았다.

| 실행 | 통과/실패/skip | 의미 |
| --- | --- | --- |
| 같은 SHA의 격리된 원본 main, `npm test` | 65 / 0 / 0 | `git archive HEAD`를 임시 디렉터리에 풀고 기존 설치 의존성과 동일 vendor를 재사용 |
| 초기 관련 테스트 | 48 / 0 / 0 | 기존 관련 31개 + 새 연결 17개. 전체 테스트라는 의미가 아님 |
| 리뷰 수정 전 작업 트리, `npm test` | 82 / 0 / 0 | 원본 65개 + 새 연결 17개 |
| 보안 수정 후 최종 작업 트리, `npm test` | **90 / 0 / 0** | 원본 65개 + 새 연결 17개 + 보안 회귀 8개 |
| `npm run spec:check` | 통과 | 기존 계약 산출물과 일치 |
| `git diff --check` | 통과 | 공백·충돌 마커 검사 |

48개 결과에서 빠졌던 기존 테스트 34개는 contract 24개, pack 6개, worker 4개다.
기존 테스트를 삭제해서 통과 수가 줄어든 것이 아니다. 최종 실행은 Node v24.19.0에서 약 37.7초 걸렸다.
전체 테스트 명령은 로컬 실행이며 CI 서비스를 호출하지 않았다.

증거 파일:

- `output/agent-connections/review/baseline.txt` — main 65개
- `output/agent-connections/tests.txt` — 초기 관련 48개
- `output/agent-connections/review/full-before.txt` — 리뷰 전 전체 82개
- `output/agent-connections/review/security-focused.txt` — 보안 수정 중 24개; 마지막 UI 회귀 1개 추가 전 결과
- `output/agent-connections/review/full-final.txt` — 최종 전체 90개
- `output/agent-connections/review/changes.patch` — 기존 추적 파일 수정과 새 파일을 모두 포함한 diff
- `output/agent-connections/review/changed-files.txt` — 최종 변경 파일 목록

`output/`는 기존 .gitignore에 따라 비추적 산출물이다.

## 독립 리뷰에서 발견하고 수정한 문제

두 독립 리뷰가 서버 권한·RLS와 로그인·토큰·사용자 동의 흐름을 각각 조사했다.
리뷰어의 재현을 확인하고 아래 사항을 코드와 회귀 테스트에 반영했다.

| 발견 | 공격 조건·영향 | 수정·검증 |
| --- | --- | --- |
| 공유 프로젝트의 Storage 정책 우회 | 같은 sub의 native OAuth JWT가 기존 광범위 owner 정책으로 private fighter object를 직접 읽고 수정할 수 있음. API grant 검사만으로 막히지 않음 | `ai-fighter-beta` bucket에 anon/authenticated restrictive 정책 추가. 수정 전 read/update 각각 1행, 수정 후 SELECT/UPDATE/DELETE 0행·INSERT RLS 거절을 재현. 일반 owner JWT도 API 경계를 따름. 다른 bucket·service_role 접근은 보존 |
| 잘못된 설정 JSON의 비밀 노출 | JSON.parse 오류 문자열이 MCP stderr에 토큰 조각을 포함할 수 있음 | `invalid-client-config`로 정규화. 비밀 canary가 stderr/stdout/오류 stack에 나오지 않는 실제 자식 MCP 프로세스 시험 |
| 느슨한 파일 권한·링크 | 공개 읽기 설정 파일 및 심링크·하드링크 허용, 링크 대상 chmod 가능 | 공통 private-config 검사. POSIX 현재 소유자·0600, 쓰기 가능한 부모 제한, regular file·단일 링크·크기 제한, O_NOFOLLOW와 inode 대조, exclusive 생성. 0644와 링크를 거절하며 대상 파일을 수정하지 않음 |
| 화면에서 확인한 코드·계정과 승인 대상 불일치 | inspect 후 코드 입력 변경·계정 전환·늦은 비동기 응답으로 이전 동의가 남을 수 있음 | 코드/계정 변경 시 화면·어댑터 동의 무효화. inspect의 서버 subject를 `expectedSubject`로 승인에 보내고 서버가 검증된 JWT와 대조. 다른 계정은 403. 늦은 inspect 결과와 확인하지 않은 승인을 거절 |
| callback query 제거 시점 | config 요청 뒤에 URL을 정리해 callback 코드가 URL에 더 오래 남음 | 모듈 시작에서 history를 정리한 뒤 config fetch. DOM stub 시험으로 순서와 무관한 returnTo 무시를 확인 |

Storage 변경은 준비 SQL 파일에만 있다. 운영 bucket·정책·object를 읽거나 수정하지 않았다.
다른 게임 bucket·테이블까지 안전하다고 주장하지 않는다.

## 추가 검증과 경계

- 사용자 JWT의 잘못된 sub·client_id·aud·issuer·role·exp·익명 여부와 잘못된 연결 client/resource를 거절한다.
  신뢰할 owner/agent는 서버가 결정하며 body 주입은 차단한다.
- native OAuth의 일반 `aud=authenticated` 토큰은 소유자 API로 허용하지 않는다.
  선수·제출 owner RLS에도 restrictive client_id 정책을 준비했다.
- grant/client/event 테이블 및 관련 RPC는 service_role 전용이고 anon/authenticated 호출 경로가 없다.
  audit identity sequence 권한도 명시적으로 회수했다.
- 설치된 Supabase SDK에 메모리 안의 일회성 ES256 서명과 mock JWKS를 넣어 실제 서명 검증,
  payload 변조 거절, client_id/aud 거절을 검증했다. API 인증 후 DB RPC의 Authorization은
  service key로 유지되고 SDK 사용자 세션은 null이다. 실제 프로젝트 키·영구 키를 만들지 않았다.
- cookie만 있는 cross-origin 승인 요청은 401이다. 제공 UI는 bearer Authorization을 쓰며
  쿠키 프록시를 만들지 않았다. loopback 서버는 Host/Origin을 검사하고 CSP·no-referrer·no-store를 사용한다.
- 실제 SDK의 PKCE URL 생성·코드 교환 호출 계약, callback 시작 표식, 오류/취소 처리,
  고정 loopback redirect를 검증했다. PKCE verifier 처리는 기존 Supabase Auth SDK를 재사용한다.
  Google 측 state·운영 redirect allowlist·실제 인증 왕복은 시험하지 않았다.
- 시작 중복 요청·응답 유실 재시도, approve/cancel 및 approve/revoke 재시도에서도
  철회 상태가 유지되고 재승인으로 만료를 늘리지 않는다. 동일 토큰 해시를 새 요청 ID로 재사용하면 409다.
  이 시험은 단일 PGlite 엔진의 요청 순서·상태 불변식 시험이다. 운영 PostgreSQL 다중 연결 부하 시험은 아니다.
- 철회 완료 뒤 시작되는 보호 요청은 차단된다. 철회 전에 권한 검사를 통과한 진행 중 HTTP/Storage 작업은
  완료될 수 있다. 업로드 뒤 submit은 별도로 다시 검사한다.
- 기존 사용자 세션 갱신·동시 refresh 잠금과 API/MCP 호출 계약을 유지했다.
  파일 권한이 느슨한 기존 세션 설정은 소유자가 확인 후 0600으로 바꿔야 읽을 수 있다.
- `owner_id UNIQUE`와 `fighter-quota`는 변경하지 않았다. 테스트의 기존 Sparring Bot을 보존했고,
  실제 계정/선수에는 접근하지 않았다. 이미 등록된 선수·불변 패키지를 덮어쓰는 기능은 없다.

## 구현 파일과 OSS

주요 새 파일:

- `api/connections.mjs`, `api/private-config.mjs`
- `auth/agent-connection.mjs`, `auth/owner-client.mjs`
- `connect/index.html`, `connect/app.mjs`, `connect/style.css`
- `scripts/agent-connect.mjs`, `scripts/connection-ui.mjs`
- `supabase/pending/agent-connections.sql`
- `test/connections.test.mjs`, `test/connection-client.test.mjs`, `test/connection-security.test.mjs`,
  `test/support/auth.mjs`, `test/support/connection-db.mjs`
- `docs/AGENT-CONNECTIONS.md`, `docs/AGENT-CONNECTIONS-RESULTS.md`, 이 보고서

기존 수정 파일:

- `api/client.mjs`, `api/http.mjs`, `api/handler.mjs`, `api/fighter-statistics.mjs`
- `mcp/remote-tools.mjs`, `supabase/functions/ai-fighter/index.ts`, `package.json`
- `test/api.test.mjs`, `test/fighter-statistics.test.mjs`, `README.md`, `docs/SUPABASE-BETA.md`

기존 MIT `@supabase/supabase-js` **2.117.3**와 Supabase Auth의 Google 로그인·PKCE·코드 교환·
서명 검증·세션 갱신을 재사용했다. 기존 공식 MCP SDK **1.32.1**과 PGlite **0.5.10**을 사용했다.
추가 의존성이나 lockfile 변경은 없다.

공식 근거:

- https://github.com/supabase/supabase-js
- https://github.com/supabase/auth
- https://supabase.com/docs/guides/auth/oauth-server/getting-started
- https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- https://supabase.com/docs/guides/auth/oauth-server/token-security
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/sessions/pkce-flow

native OAuth beta, custom scope 미지원, 기본 audience와 resource binding 한계 때문에
우선 기존 stdio MCP에 짧은 수명의 자체 연결 grant를 제공한다.
OAuth device grant 또는 범용 remote HTTP MCP OAuth 호환이라고 주장하지 않는다.

## 실제 연결에 남은 최소 설정과 미실행 항목

1. 기존 Supabase 프로젝트의 Google provider와 정확한 redirect allowlist를 준비한다.
   새 OAuth 앱·키·영구 인증 권한은 별도 승인 없이 만들지 않는다.
2. 준비 SQL을 정상 CLI 환경에서 timestamp migration 파일로 옮겨 검토·적용한다.
   운영 `db push`/reset이나 migration 적용은 이번 작업에서 하지 않았다.
3. 기본 비활성 `ai-fighter-stdio` client를 검토 후 운영자가 명시적으로 활성화한다.
4. 기존 duel engine 번들을 보존해 Edge 소스를 반영한다. issuer/resource는 서버 SUPABASE_URL에 고정한다.
5. 사용자 PC에서 승인 UI를 실행하거나 홈페이지에 `auth/owner-client.mjs`를 연결한다.
   홈페이지 원천은 이 저장소에 없으며 정확한 통합 지침은 `docs/AGENT-CONNECTIONS.md`에 있다.
   같은 Supabase sub로 기존 계정·선수를 찾고 이메일로 owner를 재할당하지 않는다.

운영 Google 로그인, 운영 JWKS/세션 폐기, PostgREST·Edge gateway·Storage 종단, 실제 브라우저 UI,
Windows ACL, 다른 게임 저장소 계정 매핑은 미실행이다. 공개 운영 전에는 IP 기반 제한·봇 방지,
status/inspect 제한, 로그의 token/code/callback 비식별화와 audit 보존도 운영에서 확인해야 한다.

Supabase CLI 2.121.0 도움말 실행은 `/home/agent/.supabase` 생성 EROFS로 실패했고,
2.54.11 대체 설치는 npm postinstall exit 1로 실패했다. SQL 파일 생성 전 환경 오류이며,
재시도·권한 우회 없이 준비 SQL과 PGlite 시험으로 진행했다.
운영 적용·권한 발급은 사용자 금지 범위에 따라 **미실행·보류**다.
자동 승인 검토에 의해 거부된 작업이나 결과가 불확실한 운영 쓰기는 없다.
CI 실행·서비스 배포·커밋·푸시·PR·결제도 하지 않았다.
