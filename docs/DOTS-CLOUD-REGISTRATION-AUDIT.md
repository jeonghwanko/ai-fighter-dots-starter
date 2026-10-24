# Dots 클라우드 생성·등록 점검 — 2026-10-24

## 확인된 장애와 증거 범위

사용자가 말한 VM은 Codex의 Dots(미미)가 사용하는 GPT 클라우드 환경이다.
클라우드 채팅 `VM 제작 지침 점검`의 기존 실행 기록에서 공개 GET 3개가 모두 실패했다:

| 대상 | 실제 기록 |
| --- | --- |
| oddbout.com/creator.html | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |
| ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter/spec | 같은 CONNECT 403 |
| chatgpt.com | 같은 CONNECT 403 |

이는 해당 실행 당시 서비스에 도달하기 전 클라우드 프록시 차단이다. Google 계정 오류·가입 제한·게임 검수 실패로
분류하면 잘못된 재로그인·재생성을 유도한다. 커밋 `76109d0`은 이를 구분하는 키트 안내를 추가했지만 네트워크 설정을 바꾸지 않았다.
이 점검에서 로컬 Windows의 공개 API와 홈페이지 GET은 각각 HTTP 200이고 API는 deviceLogin v1을 광고했다.
로컬 성공은 클라우드 복구 증거가 아니다. 새 Google 로그인·이미지 생성·등록은 실행하지 않았다.

## 코드에서 제거한 불필요한 단계

- 로그인 전에 MCP를 시작하면 등록 도구가 숨겨지고 로그인 뒤 재시작해야 했음 → 도구 목록을 고정하고 요청 시 세션을 읽는다.
- 연결·완성된 패키지 등록에서도 생성 계정 질문과 엔진 준비가 실행됨 → readiness의 connection/registration 목적은 이를 생략한다.
- 연결 행동이 셸 명령 안내뿐이었음 → connect_oddbout이 기존 기기 로그인 함수를 직접 호출하고 공개 링크와 코드만 반환한다.
- 대기 중 재호출 → 같은 승인 링크를 반환하고 wait는 한 번 조회한다. 세션 파일만으로 연결 성공을 주장하지 않고 GET /me로 확인한다.
- 재로그인·로그아웃 뒤 이전 메모리 세션이 남음 → 매 요청에서 저장 상태를 확인한다. 사용자 교체는 진행 중 업로드를 중단한다.
- 이미 연결된 사용자에게 홈페이지 장애 복구를 등록 선행 조건처럼 안내함 → 인증된 등록 API 접근을 기준으로 판단한다.

파일·동작 검수, 사용자 선택, 등록 요청, 해시·업로드 검증과 중복 제출 방지는 유지한다.
공개 API 도달은 POST/PUT 허용이나 실제 등록 성공을 증명하지 않는다.

## 클라우드 적용 및 검증

1. [연결 안내](CONNECTION-READINESS.md)의 환경 구분을 먼저 적용한다. 기본 Work 클라우드와 사용자 지정 Codex 환경에
   똑같은 Republish 안내를 하지 않는다. 키트에는 호스트 설정을 변경하는 API가 없다.
2. 작업 중인 캐릭터의 폴더·선택·시도 기록을 보존한다. 제작 중 체크아웃을 pull하거나 생성 엔진을 교체하지 않는다.
   개선 브랜치의 push만으로 실행 중인 클라우드 VM이나 설치된 플러그인에 자동 적용되지 않는다.
   아래 VM 재검증은 작업이 없는 체크아웃에 명시적으로 적용한 결과다.
3. 준비된 새 런타임에서 `connect_oddbout`과 readiness의 `purpose` 입력이 보이는지 확인한다.
   코드 교체 뒤 MCP 도구 목록 갱신은 한 번 필요하지만 이후 사용자 로그인마다 재시작하지 않는다.
4. 같은 클라우드에서 `npm run creation:check -- connection`으로 도달 여부를 재검사한다. 등록 전에는 `registration`을 쓴다.
   계정은 사용자 본인의 것만 연결하며, 실제 사용자가 승인한 요청에서 Google 승인 → GET /me를 확인한다.
5. 생성·미리보기 전달은 별도 조건이다. 기존 결과를 현재 대화에 실제로 표시하고, 새 생성은 사용자의 생성 요청 범위에서만 실행한다.
6. 최종 선택된 패키지의 검증 → 동일 패키지에 고정된 idempotency key로 제출 → 최종 서버 결과 조회를 확인한다.

단위·MCP 통합 테스트는 가짜 인증/API와 임시 파일을 사용한다. 이 테스트를 클라우드 라이브 연결·표시·등록 성공으로 보고하지 않는다.

## 최초 로컬 Windows 검증

- 관련 Node 테스트 66/66 통과: client, connection-readiness, creation-readiness, login, connect-oddbout,
  mcp, creator-plugin, portable-plugin. 같은 실행 중 MCP에서 연결 승인 후 등록 준비 확인까지 테스트했다.
- 대화 규칙 오프라인 기록 검사 35/35 통과. 실제 사용자 대화 품질 시험은 아니다.
- git diff --check 통과. 실제 이미지 생성, 사용자 로그인, 등록, CI, 클라우드 배포는 실행하지 않았다.
- 분리된 작업 브랜치: codex/dots-creator-flow. 원래 작업 폴더의 다른 변경과 vendor/sprite-gen은 보존했다.

## 같은 클라우드 VM 적용 및 재검증 — 2026-10-24

### 적용한 코드와 보존 범위

- 작업 경로는 `/workspace/ai-fighter-dots-starter`, 브랜치는 `codex/creator-hosting`이다. 사용자 PC에는 접근하지 않았다.
- 시작 HEAD는 `76109d0ce1c80a7f4a048913ab94f18ed5896fce`였다. fetch한 creator-hosting은
  `7cb01dae6049eb603513b1d98229db3a2800603a`이고, 그 직계 후손인 dots-creator-flow의
  `25933682320f9763dad1b89f94b0619326731451` 및 `6294eeef662e6c37f33ae56ae581627b12e6d79c`를 읽었다.
- 생성 프로세스, 캐릭터 기록과 작업 결과가 없는 체크아웃임을 확인했다. `output/`의 파일은 0개였고,
  기본 ODDBOUT 세션·기기 승인 대기 파일도 없었다. 기존 작업을 생성하거나 인증 파일을 만들지 않았다.
- 서브모듈 재귀 갱신 없이 `git -c submodule.recurse=false merge --ff-only 6294eeef662e6c37f33ae56ae581627b12e6d79c`로 적용했다.
  테스트한 런타임 SHA는 **`6294eeef662e6c37f33ae56ae581627b12e6d79c`**다.
  push 직전 원격이 여전히 `7cb01da`임을 확인하고 두 기존 `[skip ci]` 커밋을 creator-hosting에 일반 push했다.
- `vendor/sprite-gen`의 기존 v8 패치 23개 파일은 모두 manifest의 적용 후 SHA-256과 일치했다.
  gitlink와 vendor HEAD `38bddef764183fe2044bc85c764b0572409a6b15`는 그대로다. 이 변경은 커밋에 포함하지 않았다.

### 모의 검사와 실제 도구 목록

- Node v24.19.0에서 관련 테스트 **67/67** 통과: client 9, connection-readiness 4, creation-readiness 12,
  login 10, connect-oddbout 4, mcp 11, creator-plugin 15, portable-plugin 2.
  최종 검사는 각 파일을 별도 `node test/<name>.test.mjs` 프로세스로 실행했다.
  최초 제한된 샌드박스에서는 로그인 모의 서버의 `listen EPERM 127.0.0.1`을 확인했다.
  공식 실행 도구의 `with_additional_permissions`와 `network.enabled: true`를 사용해 검사했으며,
  테스트 코드·기대값·프록시 설정은 바꾸지 않았다. 가짜 인증/API와 임시 파일만 사용했다.
- `6294eee`의 다른 프로젝트 승인 파일 교환 차단 회귀 검사를 포함한다.
  같은 MCP 실행 중 로그인 상태 채택·로그아웃·사용자 교체 차단, 연결/등록 목적의 엔진 준비 생략도 통과했다.
- `node scripts/evaluate-creation-dialogue.mjs --responses test/fixtures/creation-dialogue/responses-reference.json`은
  **35/35**, 실제 실행 도구 기록 0건이었다. 라이브 생성이나 대화 표시 성공의 증거가 아니다.
- 새 VM stdio 프로세스에서 `initialize`와 `tools/list`만 실행해 **19개 도구**를 확인했다.
  `connect_oddbout.action`은 status/start/wait, `check_creation_readiness.purpose`는 generation/connection/registration이다.
  로그인 전에도 submit_fighter_package 및 update_fighter_profile이 목록에 있었다. 이 도구들을 실제 호출하지 않았다.
- 현재 Dots 대화에 제공된 도구 목록에는 AI Fighter 도구가 없었다. VM 소스와 새 stdio 목록의 갱신을
  Dots 호스트의 플러그인 연결·버튼 노출 완료로 취급하지 않는다. 호스트의 공식 MCP 연결/목록 갱신은 남아 있다.
- 개선 커밋의 문서 상대 링크 63개와 `git diff --check`가 통과했다.
  번들 선언에 check-connection, creation:check, 연결/전달 문서와 mcp 디렉터리 포함을 확인했다.
  Windows용 배포 ZIP 빌드·설치·공개 배포는 하지 않았다.

### 현재 VM 네트워크 결과와 정책 근거

기존 프록시·CA를 유지하고 공식 실행 네트워크 권한을 사용한 공개 GET 결과다. 로그인 헤더나 토큰은 보내지 않았다.

| 대상 | 같은 VM 재검사 결과 |
| --- | --- |
| `https://oddbout.com/creator.html` | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |
| `https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter/spec` | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |
| `https://chatgpt.com/` — 기존 VM Library helper 경로의 호스트 | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |

- `/etc/codex/network-policy.json`은 존재하며 version 1이었다. 시작 시 정책의
  `http_network_policy.type`은 `restricted`이고 `http_network_policy.egress_rules`에는 위 세 호스트가 없었다.
  GitHub는 포함되어 있었다. Git fetch/push 성공은 ODDBOUT·Library 연결 복구 증거가 아니다.
- 이 대화에는 `cloud_environment.environment_status` 도구가 제공되지 않아 `observations_current`와
  현재 HTTP policy enforced 필드는 조회하지 못했다. 시작 시 정책 파일과 실제 CONNECT 403 관찰을 구분한다.
  정책 파일은 읽기만 했고, 파일 수정으로 권한이 바뀐다고 가정하지 않았다.
- `npm run creation:check -- connection`은 완료됐지만 홈페이지·API를 blocked/network-dns-failed로 반환했다.
  이는 해당 Node 진단 경로의 결과이고 curl의 CONNECT 403 관찰과 동일한 오류 문자열로 바꾸지 않았다.
  kit/account는 not-required, elicitation은 not-needed, readyForRegistration은 false였다.
  generation/delivery는 unverified, Library는 helper-not-probed였다. 설치·업데이트·로그인을 실행하지 않았다.

### Node fetch의 상속 프록시 호환성 추가 진단

- 이 VM의 Node는 v24.19.0이며 로컬 `node --help`와 `process.allowedNodeEnvironmentFlags`에서
  `--use-env-proxy` 지원을 확인했다. HTTP_PROXY/HTTPS_PROXY/NO_PROXY와 소문자 대응 변수는 설정되어 있었으나
  NODE_USE_ENV_PROXY 및 NODE_OPTIONS는 설정되어 있지 않았다. 프록시 값·인증 정보는 출력하지 않았다.
- 같은 공식 실행 네트워크 권한에서, 위 세 공개 URL에 대한 기본 `fetch()`와
  **해당 진단 자식 프로세스에만** `NODE_USE_ENV_PROXY=1`을 추가한 `fetch()`를 비교했다.
  상속된 프록시·NO_PROXY·CA 값은 모두 유지했다. 새 프록시나 직접 연결 설정은 만들지 않았다.

| 실행 경로 | 세 호스트에서 공통으로 확인한 결과 |
| --- | --- |
| 기본 Node fetch | fetch failed → getaddrinfo EAI_AGAIN, 대상 호스트의 DNS 조회 실패 |
| NODE_USE_ENV_PROXY=1의 Node fetch | fetch failed → Request was cancelled → UND_ERR_ABORTED, Proxy response (403) !== 200 when HTTP Tunneling |
| 기존 프록시를 사용하는 curl | CONNECT tunnel failed, response 403 |

- 같은 권한에서도 재현되므로 최초 권한 제한만으로 설명되는 차이가 아니다. 현재 기본 Node 실행은
  상속된 프록시를 활성화하지 않아 대상 호스트 DNS를 조회했고, 공식 옵션을 적용하면 프록시 차단까지 도달했다.
  이는 이 VM에서 기본 키트 실행의 프록시 사용 설정이 빠진 문제와 실제 egress 차단이 함께 있음을 보여준다.
- `NODE_USE_ENV_PROXY=1`을 진단 프로세스에 적용한 `node scripts/check-connection.mjs connection`은
  홈페이지·API 모두 blocked/**network-connect-forbidden**을 반환했다. 기존 오류 분류는 이 중첩 원인을 처리했다.
  kit/account not-required, 생성·전달 unverified 상태는 유지됐다. Library helper는 호출하지 않았다.
- `mcp/connection-readiness.mjs`와 `api/client.mjs`는 기본 fetch를 사용하고 이 실행 경로에 프록시 활성화 코드가 없다.
  키트의 Node 지원 범위는 >=22.12다. [공식 Node 프록시 문서](https://nodejs.org/learn/http/enterprise-network-configuration)에 따르면
  환경 프록시를 사용하는 fetch는 v22.21.0 또는 v24.0.0 이상, CLI 플래그는 v22.21.0 또는 v24.5.0 이상에서 지원한다.
  따라서 Node 24의 옵션만으로 전체 지원 버전의 호환성이 해결됐다고 주장할 수 없다.
- 요청에 따라 전송·로그인·런처 코드는 수정하지 않았다. 기존 공식 프록시를 존중하는 버전 호환 보완은
  부모 작업에서 처리하며, 그 보완만으로 VM 호스트 허용 정책이 변경되지는 않는다.

### 남은 장애와 미검증

VM 네트워크 정책 변경용 공식 관리 도구는 이 세션에 제공되지 않았다. 필요한 세 호스트의 정상 허용은
초기 환경 준비자/관리자가 [환경별 공식 설정 경로](CONNECTION-READINESS.md#초기-환경-준비자-단계)에서 확인해야 한다.
기본 Work 클라우드에는 제공되는 경우 Work network access를 사용하며, 사용자 지정 Codex 환경에만 해당 환경 설정·재게시를 적용한다.
이번 실행에서는 허용 변경·Republish를 수행하지 않았다. 상속 프록시·CA를 변경/해제하거나 별도 직접 연결·우회 설정을 추가하지 않았다.

실사용 Google 로그인·기기 승인·인증된 GET /me·동일 계정 여부, 실제 이미지 생성 백엔드·구독 접근,
Library 업로드·부모 대화 표시, 패키지 제출·선수 등록은 여전히 미검증이다. 네트워크 복구와 호스트 도구 연결 후
사용자가 요청한 단계에서 확인해야 한다. 새 생성·업로드·등록·자격증명 발급·서비스 배포·CI는 실행하지 않았다.
