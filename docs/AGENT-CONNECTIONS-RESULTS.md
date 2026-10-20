# 에이전트 연결 구현 결과 — 2026-10-20

작업 경로: `/workspace/ai-fighter-dots-starter`.
구현·로컬 검증 완료, 운영 적용 미실행. 이 문서는 최초 커밋 전 검증 기록이다.
후속 독립 보안 리뷰와 전체 재검증까지 완료했다. **최종 전체 90개 통과 / 0 실패 / 0 skip**이며,
아래 48개는 초기 관련 범위 결과다. [최종 보안 재검증 보고서](AGENT-CONNECTIONS-SECURITY-REVIEW.md)를 함께 확인한다.
이후 사용자가 커밋·푸시를 명시적으로 허용했다. 최신 main `878aaa8` 통합 후 전체 **93개 통과** 기록은
같은 보안 보고서의 후속 통합 항목에 있다. CI·배포·운영 권한 변경 금지는 계속 유지한다.

## Git와 사전 확인

- origin: `https://github.com/jeonghwanko/ai-fighter-dots-starter.git`.
- 작업 브랜치: `work`. 시작 시 미커밋 변경 없음.
- `git ls-remote origin refs/heads/main` → `git fetch --no-tags origin main` →
  `git merge --ff-only FETCH_HEAD`: 이미 최신 상태.
- 시작·완료 시 원격 main과 로컬 HEAD 모두 **`85b31ef57d4708059926a2fcd33e391ea44721da`**.
- 강제 reset, stash, 커밋, 푸시, PR 생성 없음.
- `AGENTS.md`, 관련 Supabase 운영 문서, API/MCP/Edge/SQL/테스트 구조 확인.
  `.agents/skills` 디렉터리는 없음. vendor sprite-gen skill은 캐릭터 제작용으로 이 인증 변경에 적용하지 않음.
  세션에 제공된 Supabase 스킬과 공식 OAuth/Google/PKCE/보안 문서를 참고함.
- 홈페이지·게임 원천은 이 저장소에 없음. 게임 저장소에 필요한 연동을 사용 문서에 명시함.

## 구현과 변경 파일

| 파일 | 변경 |
| --- | --- |
| `api/connections.mjs` | 연결 시작·상태·승인·거절·취소·목록·철회 API, 작업별 grant 검사 |
| `api/http.mjs` | 검증된 JWT의 sub/issuer/audience/role/exp/비익명 검사, native OAuth client 소유자 경로 거부 |
| `api/handler.mjs` | grant 소유권으로 기존 제출·조회 재사용, GET `/fighters`로 자기 선수 발견 |
| `api/fighter-statistics.mjs` | 전적 조회에도 grant 권한·철회 적용 |
| `api/client.mjs` | 기존 세션 갱신 유지, 사용자 JWT가 없는 제한 연결 설정 지원 |
| `api/private-config.mjs` | 파싱 오류의 비밀 노출 방지, 파일 소유권·권한·링크 검사와 안전한 저장 |
| `auth/agent-connection.mjs`, `scripts/agent-connect.mjs` | 비공개 설정 저장, 시작 재시도·상태·취소 CLI |
| `auth/owner-client.mjs` | 기존 Supabase client를 사용하는 로그인·callback·승인·해제 어댑터 |
| `connect/index.html`, `connect/app.mjs`, `connect/style.css`, `scripts/connection-ui.mjs` | 사용자 PC용 Google 가입/로그인·명시적 권한 승인·철회 화면, loopback/Host/Origin/CSP 제한 |
| `mcp/remote-tools.mjs` | 기존 도구 유지, `get_my_fighter` 추가 |
| `supabase/functions/ai-fighter/index.ts` | 서버 URL에서 issuer/resource 결정 |
| `supabase/pending/agent-connections.sql` | 기본 비활성 client, 만료 grant, 실행자 audit, service 전용 RPC, OAuth 우회 차단 RLS |
| `package.json` | `connect`, `connect:ui`, `test:connections` 명령만 추가; 의존성 변경 없음 |
| `test/connections.test.mjs`, `test/connection-client.test.mjs`, `test/connection-security.test.mjs`, `test/support/auth.mjs`, `test/support/connection-db.mjs` | 보안·PostgreSQL·SDK·MCP·CLI·UI 검증 |
| `test/api.test.mjs`, `test/fighter-statistics.test.mjs` | 기존 인증 mock을 SDK의 검증된 claims 계약에 맞게 수정 |
| `README.md`, `docs/SUPABASE-BETA.md`, `docs/AGENT-CONNECTIONS.md`, 이 파일 | 상태·설치·운영 최소 설정·외부 게임 연동·검증 한계 |

DB의 `af_fighters.owner_id UNIQUE`, `fighter-quota`, 기존 제출 불변성 및 작업자 등록 흐름을 변경하지 않았다.
실제 사용자/선수/Storage에 접근하거나 Sparring Bot을 삭제·변경한 적이 없다.

## OSS 근거

- 기존 MIT [supabase-js](https://github.com/supabase/supabase-js) **2.117.3**의 Auth 기능을 재사용:
  Google OAuth 시작, PKCE, 코드 교환, JWT 검증, 기존 refresh 갱신.
- 기존 [Supabase Auth](https://github.com/supabase/auth) 기반 사용자 계정 유지.
  native OAuth beta/custom scope/aud 한계 때문에 short-lived delegation만 별도 서버 grant로 관리.
  별도 사용자 인증 공급자·OAuth 서버 라이브러리 추가 없음.
- 기존 공식 `@modelcontextprotocol/sdk` **1.32.1** stdio 및 InMemory transport 재사용.
- 기존 `@electric-sql/pglite` **0.5.10** PostgreSQL로 SQL/RLS 검증.
- `package-lock.json` 변경 없음.
  자세한 공식 소스와 설계 근거는 [사용 문서](AGENT-CONNECTIONS.md#선택한-방식과-oss)에 있음.

## 초기 관련 범위 검증 (전체 재검증으로 보완)

다음 관련 로컬 회귀 테스트 **48개 통과 / 0 실패 / 0 skip**:

```sh
node --test test/connections.test.mjs test/connection-client.test.mjs \
  test/api.test.mjs test/client.test.mjs test/fighter-statistics.test.mjs \
  test/database.test.mjs test/mcp.test.mjs test/roster.test.mjs \
  test/duels.test.mjs test/edge-bundle.test.mjs
```

실행 로그: [`../output/agent-connections/tests.txt`](../output/agent-connections/tests.txt).
`output/`는 기존 .gitignore에 따라 비추적 산출물이다.
이 초기 실행 시간은 약 14.5초, Node v24.19.0이다.
새 JS 파일 6개의 `node --check`와 `git diff --check`도 통과했다.

검증한 주요 경계:

- 소유자/agent 필드 주입 거부, 다른 소유자의 조회·업로드·submit·철회 차단.
- JWT의 잘못된 sub/issuer/aud/role/client_id, 만료·익명 계정 차단.
- 올바른 bearer라도 잘못된 client/resource, 미승인·만료·거절·취소·철회·클라이언트 비활성일 때 차단.
- 요청 권한보다 큰 승인·수명, 권한 없는 제출, worker/관리 경로 차단.
- 동시 start/승인/취소, 응답 유실 후 같은 요청 재시도, 재승인으로 만료 연장 불가.
- service 전용 RPC/테이블 권한, owner RLS를 통한 native OAuth 우회 차단.
- 서버 owner로 생성·audit agent 분리, 기존 선수 보존, 새 선수 생성 `fighter-quota`, unique 제약 유지.
- 기존 사용자 세션 refresh와 공개 API/선수 전적 회귀.
- 실제 SDK로 Google PKCE URL 생성 (네트워크/Google 로그인 없이).
- 실제 MCP SDK → 새 grant API → 11개 WebP 업로드(mock Storage) → PostgreSQL queued,
  동일 키 재시도, 연결 해제 후 MCP 조회 거부.
- 사용자 UI HTTP 제공, 로컬 설치 SDK 제공, secret key/외부 Host/Origin 차단과 보안 헤더.

개발 중 UI Host 검증 테스트 1개가 처음 실패했다.
원인은 Node fetch가 테스트에서 지정한 Host를 교체한 것으로, 실제 HTTP request로 변경한 최종 검증은 통과했다.
남아 있는 실패 테스트는 없다.

## 미실행·보류·차단 상태

| 동작·대상 | 상태·이유 | 완료 범위 |
| --- | --- | --- |
| Supabase CLI 2.121.0의 `migration new --help` | **실패**, `/home/agent/.supabase` 디렉터리 생성 `EROFS: read-only file system` | CLI로 timestamp 파일 생성 전 단계에서 종료 |
| CLI 2.54.11 설치/도움말 대체 시도 | **실패**, npm postinstall exit 1, 상세 원인 출력 없음 | 더 이상 반복하지 않고 준비 SQL 파일과 PGlite로 검증 |
| 운영 DB migration, client 활성화, Edge/홈페이지 배포 | **미실행·보류**, 사용자 금지 범위 | 적용할 SQL·소스·설정 안내 준비 |
| 실제 Google 계정 로그인·OAuth 앱/키 생성·지속 권한 발급 | **미실행·보류**, 운영 자격 증명 및 별도 승인 없음 | SDK PKCE 시작과 mock callback/실패·취소·승인 검증 |
| 운영 JWKS/세션·PostgREST·Edge gateway·private Storage 종단 시험 | **미실행**, 운영/별도 테스트 계정 없이 수행하지 않음 | Auth 결과/Storage mock + 실제 PostgreSQL/SDK 검증 |
| 범용 remote MCP OAuth, 게임 홈페이지 화면 조작·계정 ID 매핑 | **미실행**, 해당 전송/게임 원천 없음 | 기존 stdio 유지, 외부 저장소 연동 명세 제공 |
| CI 서비스, 커밋·푸시·PR, 유료 결제 | **미실행**, 사용자 금지 범위 | 로컬 코드·시험만 수행 |

자동 승인 검토 거부나 결과 불확실한 운영 쓰기는 없다.
환경 오류에 대해 권한 우회·보안 제약 회피를 하지 않았다.
실제 연결에 필요한 최소 남은 설정은 기존 Google provider/정확한 redirect URL, 검토된 SQL 적용,
기본 비활성 client의 명시적 활성화, 기존 duel engine을 보존한 Edge 소스 반영이다.
초대와 기존 Supabase 계정은 재사용하며 새 영구 권한은 별도 승인을 받아야 한다.

철회 완료 이후 시작되는 보호 요청은 차단하지만, 이미 권한 검사를 통과한 진행 중 HTTP/Storage 작업은 완료될 수 있다.
로그아웃은 연결 해제를 대신하지 않는다. 추가 경계와 공개 운영 전 필요한 제한/로그 보존 검토는
[사용 문서의 보안 경계](AGENT-CONNECTIONS.md#보안-경계와-남은-검증)에 명시했다.
