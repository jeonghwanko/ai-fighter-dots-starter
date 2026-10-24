# ODDBOUT 연결과 제작 준비

일반 제작 사용자의 흐름은 **ODDBOUT 연결 → 본인 Google 로그인 → 공개 확인 코드 확인·연결 승인**이다.
VM 설치와 호스트 종류에 맞는 네트워크 준비는 초기 환경 준비자가 처리하고 준비된 작업 공간을 재사용한다.
등록 연결과 이미지 생성 접근, 결과 전달은 서로 다른 상태다. 하나가 성공했다고 나머지를 완료로 표시하지 않는다.

## 사용자가 보는 연결

1. 에이전트는 `check_creation_readiness(purpose: "connection")`으로 연결 상태만 읽는다.
   완성된 패키지를 등록할 때는 `purpose: "registration"`이다. 이 두 단계에서는 생성 구독을 묻거나 Python 설치·키트 업데이트를 하지 않는다.
   새로운 생성 준비에만 기본 `purpose: "generation"`을 사용하고 `account`는 사용자가 실제 선택한 경우에만 넘긴다.
2. `items.login.action`의 이름은 **ODDBOUT 연결**이다. 호스트가 버튼을 지원하면 이 행동을 연결하고,
   지원하지 않으면 같은 이름의 선택지와 공식 링크로 안내한다. 키트가 Dots 자체 UI를 설치하거나 제어하지는 않는다.
3. 사용자가 연결 또는 등록을 요청하고 `action.status: "available"`이면 `connect_oddbout(action: "start")`를 호출한다.
   기존 기기 로그인 경로를 MCP에서 직접 실행하며, 에이전트가 셸 명령·프로젝트 키를 조립할 필요가 없다.
   사용자는 반환된 `verificationUrl`에서 Google 로그인 후 `userCode`가 같은지 확인하고 승인한다.
   본인이 시작하지 않은 요청은 승인하지 않는다. 콜백 주소·토큰을 대화로 복사하지 않는다.
4. `awaiting-approval`이면 이미 시작된 요청이다. 다시 `start`해도 같은 공개 링크를 반환한다.
   사용자가 승인하면 `connect_oddbout(action: "wait")`로 한 번 조회한다. 아직 대기 중이면 `retryAfterSeconds`를 지켜 조회한다.
   긴 폴링으로 대화를 붙잡거나 새 요청을 만들지 않는다. 네트워크 오류에도 기존 요청을 보존한다.
5. 로그인 전부터 등록 도구가 노출되며 실제 호출 시 현재 세션을 확인한다. 로그인·같은 사용자 재로그인·로그아웃 때문에
   MCP를 재시작할 필요가 없다. 다른 사용자로 세션이 바뀌면 진행 중 제출을 차단한다.
   연결 도구는 승인 교환 뒤 인증된 `GET /me`를 확인한다. 공개 `/spec` 응답이나 로컬 세션 파일만으로
   계정 연결 완료를 표시하지 않는다. 생성 계정과 같은 계정인지 역시 별도 근거가 없으면 `unknown`이다.

`action.status: "blocked"` / `check-required`이면 새 로그인을 시작하지 않고 `nextAction`의 담당자·이유를 안내한다.
정상 연결된 사용자는 캐릭터마다 다시 로그인하지 않는다. 실제 인증 만료와 VM 네트워크 실패를 구분한다.
이미 인증된 등록 API가 정상이라면 홈페이지 장애가 별도로 있어도 등록 연결을 차단하지 않는다.

구형 호스트에 `connect_oddbout` 도구가 없다면 반환된 CLI `command`와 `resumeCommand`를 쓴다.
준비 도구 자체가 보이지 않을 때는 에이전트가 키트 디렉터리에서 `npm run creation:check -- connection`을 실행한다.
등록만 점검하려면 `npm run creation:check -- registration`이다. 이 명령은 생성·등록·로그인 시작·키트 업데이트를 하지 않는다.
새 코드를 설치한 뒤에는 한 번 MCP를 재시작해 도구 목록을 갱신한다. 구형 프로세스가 반환하는 `restart-required`는
이 런타임 갱신 문제이며 Google 로그인을 반복해서 해결하지 않는다.

## 시스템이 분리해서 보고하는 상태

| 응답 | 의미와 한계 |
| --- | --- |
| `items.kit` | 체크아웃·패치·설치 상태. 캐릭터 작업 중에는 업데이트하지 않음 |
| `items.infrastructure.targets.registrationApi` | 공개 `/spec` 도달 여부와 서버의 기기 로그인 지원 광고. 사용자 인증·등록 성공은 아님 |
| `items.infrastructure.targets.homepage` | 홈페이지 HTTP 도달 여부. Google 로그인·승인 화면의 실제 동작 완료는 아님 |
| `items.infrastructure.targets.library` | 선택한 VM Library helper에 필요한 호스트 안내. 키트가 helper를 호출하지 않으므로 `unverified` |
| `items.login` | 저장된 세션 존재, 기기 승인 대기, 인증된 `/me` 결과와 제출 허용 여부. 원문 토큰·기기 비밀 코드는 반환하지 않음 |
| `items.account` | 사용자가 고른 GPT/Grok 경로. 구독·한도·생성 성공을 보증하지 않음 |
| `items.generation` | readiness가 실제 생성 도구를 호출하지 않으므로 `unverified`(사용자가 멈춤을 선택하면 `stopped`) |
| `items.delivery` | 로컬 저장, Library 저장, 부모 대화 표시, 사용자 선택을 분리. 이 도구는 실제 전달을 관찰하지 않음 |

`kitAndAccountReady`는 키트와 생성 경로 선택만 확인한다. 기존 `readyForGeneration`은 실제 생성·전달을 확인하는
기능이 이 도구에 없으므로 `false`다. 이 값으로 사용자 요청을 거부하거나 확인용 생성을 하지 않는다.
요청된 첫 생성은 [DELIVERY.md](DELIVERY.md)의 실제 도구·환경·계정·모델·비용·전달 사전 조건을 별도로 확인한 뒤 진행한다.
`readyForRegistration`도 인증된 API 접근과 `canSubmit`만 뜻한다. 최종 패키지 검수·사용자 등록 요청을 대신하지 않는다.

생성 모델 문자열, 로그인, 도구 목록, `creation:delivery` 기록 검사로 라이브 생성이나 부모 화면 전달 성공을 만들지 않는다.
기존 결과가 있으면 회수·표시하고, `pending`·`unknown`을 재생성 허가로 바꾸지 않는다.

## 초기 환경 준비자 단계

먼저 **어떤 클라우드 실행 환경인지** 확인한다. 아래 설정은 서로 대체하지 않는다.

- Dots/미미가 사용하는 기본 ChatGPT Work 클라우드라면, 제공되는 경우 설정의 `Data controls → Work network access`를 확인한다.
  공개 인터넷 허용은 관리자 제한을 해제하지 않는다. 변경 적용은 현재 실행 종료 후 환경 갱신 시점이다.
  [공식 Work 네트워크 안내](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview#network-access-and-external-destinations)
- 사용자가 구성·게시한 Codex 클라우드 환경이면 `Allow Codex to access internet`, 필요한 `Additional allowed domains`를 확인하고
  해당 환경을 다시 게시한 뒤 새 작업에서 검사한다. 기본 Work 환경에 이 편집 화면이나 Republish가 있다고 가정하지 않는다.
  [공식 Codex 환경 안내](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-services)

웹 검색·연결된 앱의 성공은 VM 셸의 네트워크 허용을 뜻하지 않는다. 실패한 바로 그 환경에서 재검사해야 한다.
설정을 변경할 수 있는 공식 도구가 없으면 확인된 실패 호스트와 환경별 설정 경로를 한 번 안내한다.
서버 방화벽·DNS·인증 정책을 추정해서 바꾸거나 별도 프록시를 만들어 우회하지 않는다.

`networkSettingsManagedByKit: false`가 명시되어 있다. 이 저장소의 도구에는 공식 VM 네트워크 허용목록이나 Republish를
변경하는 기능이 없다. 에이전트가 자동 처리했다고 말하거나 우회 프록시·업로드를 만들지 않는다.

준비자는 선택한 VM의 공식 관리 화면에서 다음 호스트와 설치·선택한 생성 도구의 요구 주소를 확인한다.

| 역할 | 현재 공개 설정의 호스트 |
| --- | --- |
| 홈페이지·Google 연결 승인 | `oddbout.com` (`deploy/creator-site.json`의 `siteUrl`) |
| 등록 API·인증 | `ztfxxhtmtrvxvuxlqmgz.supabase.co` (`apiBase`의 origin) |
| VM Library helper를 선택한 경우 | `chatgpt.com` 및 해당 helper의 공식 안내에 있는 대상 |

호스트 목록은 필요 경로의 안내이지 실제 허용·전달 성공의 증거가 아니다. 직접 대화 표시가 가능한 외형에 Library나 PC를 강제하지 않는다.
준비자는 필요한 허용과, 해당 환경에서 요구하는 재게시를 마친 뒤 같은 VM에서 다시 확인한다.
일반 제작 사용자에게 캐릭터마다 허용목록·Republish·개발 도구 설치를 반복 요청하지 않는다.

## 오류별 다음 행동과 복구

| 관찰된 결과 | 담당자와 다음 행동 |
| --- | --- |
| `network-connect-forbidden` | `environment-preparer`: CONNECT/tunnel 403은 서비스에 도달하기 전 연결 차단. VM 허용·게시 상태를 확인. Google 재로그인으로 해결하려 하지 않음 |
| `network-timeout`, `network-dns-failed`, `api-unreachable` | `environment-preparer`: 네트워크를 확인하되 정보가 없으면 허용목록 누락·인증 오류로 단정하지 않음 |
| 인증된 계정 조회의 `authentication-required`, `client-sign-in-required`, HTTP 401 | `user`: 지원되는 ODDBOUT 연결로 본인 계정 재인증. 네트워크가 막혔으면 먼저 복구. 공개 준비 주소의 401은 `service-operator`가 경로 설정 확인 |
| 서비스 HTTP 403 | `service-operator`: 계정·서비스 정책을 확인. HTTP 403 자체를 CONNECT 403으로 바꾸지 않음 |
| `server-without-device-login` | `service-operator`: 기존 기기 로그인 API와 홈페이지 승인 화면의 배포 확인. 키트가 자동 배포하지 않음 |
| `server-not-checked`, 잘못된 공개 설정·응답 | 미검증으로 유지하고 필요한 설정·읽기 전용 검사를 수행 |

복구 후 새 작업 폴더를 만들지 않는다. `resume.sessionIds`와 `get_creation_session`, `get_creation_job`으로 기존 버전·선택·시도 기록을
읽고 중단한 단계에서 재개한다. 남은 기기 승인도 기존 요청에서 이어간다. readiness는 생성·업로드·등록을 자동 실행하지 않는다.

이 저장소에서 구현·검증하는 것은 키트의 상태 응답, 기존 CLI 연결, 오류 분류와 복구 안내다.
실서비스 기기 로그인 API·홈페이지 승인 화면 배포, Dots 버튼 렌더링, VM 네트워크 설정 변경은 각각 해당 서비스·호스트의 범위다.
로컬 모의 응답 테스트를 그 배포나 라이브 사용자 연결 성공으로 보고하지 않는다.
