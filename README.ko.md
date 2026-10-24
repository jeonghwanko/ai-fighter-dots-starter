# AI Fighter × Dot starter

[English](README.md) | **한국어**

Dot과 함께 나만의 선수를 만들고, AI Fighter에 등록해 게임에서 사용합니다. 짧은 설명, 참고 이미지, 또는 둘의 조합으로 시작하세요. Dot이 포함된 **sprite-gen**을 로컬에서 실행해 원화와 애니메이션을 보여주고, 피드백을 반영한 뒤 등록 요청에 따라 선수 패키지를 만들어 제출합니다.

이 키트는 MIT, 포함된 sprite-gen 서브모듈은 Apache-2.0 라이선스입니다. 생성에는 **사용자 본인의 계정과 구독**을 사용합니다. 로컬 제작을 시작할 때 AI Fighter 가입은 필요하지 않습니다. 업로드·등록 시 Google로 로그인하며, 초대나 수동 승인은 필요하지 않습니다.

## 1. 로컬 대화 시작

[현재 게임 규격이 포함된 시작 링크](https://github.com/jeonghwanko/ai-fighter-dots-starter/blob/codex/game-context/START-HERE.md)를 새 Dot 대화에 보내세요. 만들고 싶은 캐릭터를 묻는 대화부터 시작합니다. 로컬 명령 실행과 파일 접근이 가능한 Dot·Codex·Claude에 이 저장소 주소를 전달해도 됩니다.

요청 예시:

> 이 저장소로 AI Fighter에 쓸 파란 갑옷의 고양이 복서를 만들어줘.
> 우선 원화 한 장만 보여주고 내 피드백으로 수정해줘.
> 외형을 정하면 대기·이동, 공격, 방어·피격을 묶음별로 보여줘.
> 최종 결과를 선택하면 패키지를 검사해 내 계정으로 등록하고 게임에서 이용 가능한지 확인해줘.

설치·생성·추출·측정·패키징·검사는 에이전트가 처리합니다. 사용자는 캐릭터의 외형과 움직임을 결정합니다. 생성이나 등록 없이 대화 흐름만 확인할 때는 별도의 [대화 확인 링크](https://github.com/jeonghwanko/ai-fighter-dots-starter/blob/codex/game-context/DIALOGUE-ONLY.md)를 사용합니다.

## 2. 로컬 제작 도구 준비

Git, Node.js **22.12+**, Python **3.11+**, 로컬 명령을 실행할 수 있는 호스트가 필요합니다. 호스트는 봇 서비스가 사용자별로 배정한 작업 VM이어도 되고 본인 PC여도 됩니다. 계정·격리·보존·보안 규칙은 [실행 환경 운영 지침](docs/EXECUTION-HOST.md)에 있습니다. 다음 준비는 에이전트가 대신 처리할 수 있습니다.

```sh
git clone --branch codex/creator-hosting --single-branch https://github.com/jeonghwanko/ai-fighter-dots-starter.git
cd ai-fighter-dots-starter
npm ci --ignore-scripts
npm run sprite:setup
npm run sprite:status
npm run sprite -- workflow --kind sprite
```

공개 서비스 연결 설정인 `deploy/creator-site.json`이 있는 `codex/creator-hosting` 브랜치를 사용합니다. `sprite:setup`은 고정된 sprite-gen 커밋을 약 100 MB 내려받아 이 저장소의 전용 가상 환경에 설치합니다. GitHub ZIP에는 서브모듈 내용이 없으므로 Git clone을 사용합니다. 기존 설치는 버전을 확인하고 작업 중 변경을 보존한 뒤 재사용할 수 있습니다.

에이전트는 `AGENTS.md`, [전체 제작 흐름](docs/DOT-CREATION.md), [제작 규격 안내](docs/AUTHORING.md), `vendor/sprite-gen/SKILL.md`를 읽습니다. 사용자 본인의 현재 생성 계정 접근 상태를 확인하고, 아직 정하지 않은 선택만 묻습니다. `sprite:status`만으로 로그인이나 구독 이용 가능 여부가 확인되지는 않습니다.

기본 제안은 둘 다 이용 가능하면 **GPT 원화 + Grok 동작**, Grok만 가능하면 모두 Grok, GPT만 가능하면 모두 GPT입니다. 사용자가 지정한 방식이 우선합니다. 이미지와 영상 접근은 따로 확인하며, 제공자 변경이나 과금 API 사용에는 사용자의 선택이 필요합니다.

## 3. AI Fighter 도구 연결

데스크톱 Codex에서는 MCP 설치 명령을 출력합니다.

```sh
node scripts/print-install.mjs
```

출력된 `codex mcp add ai-fighter --env ... -- ...` 명령을 실행합니다. 절대 Node 경로, 서버 경로, 검사할 작업 폴더인 `AI_FIGHTER_ROOT`가 포함됩니다. `codex mcp list`로 확인하고 새 로컬 대화를 엽니다. 도구가 보이지 않으면 앱을 다시 시작합니다. 저장소 폴더를 옮겼다면 새 위치에서 명령을 다시 출력해 등록합니다. 다른 로컬 호스트는 같은 작업 폴더 설정으로 `mcp/stdio.mjs`를 stdio MCP 서버에 연결합니다.

에이전트는 `get_fighter_spec`의 `context`, `overview`, `creation`, `guide`와 필요한 `schema`를 읽습니다. 현재 모션·프레임 규격·조작·시간 규칙은 게임이 제공합니다. 각 묶음과 패키징 전에 `context`를 다시 읽고, 사용자의 선택을 해당 버전과 함께 보관합니다. [게임 제공 제작 데이터](docs/GAME-CREATION-CONTEXT.md)를 참고하세요.

MCP 연결 전에도 로컬 제작은 시작할 수 있습니다. 로컬 프로세스를 실행할 수 없는 웹 대화에서는 생성·패키징을 수행할 로컬 호스트가 필요합니다.

## 4. 제작과 묶음별 확인

에이전트는 맡은 묶음을 완성해 실제 미리보기를 함께 보여주고, 다음 묶음 전에 피드백을 기다립니다. 묶음을 선택하면 다음 작업으로 넘어갑니다. 수정할 때는 영향을 받은 결과만 바꾸고 나머지 선택은 보존합니다. 이후 묶음을 명시적으로 맡길 수도 있습니다. 동작마다 진행 허락을 따로 묻지는 않습니다.

| 묶음 | 보고 선택할 결과 |
| --- | --- |
| 외형 | 전신 원화 한 장, `idle` 기준 자세, 같은 그림의 얼굴 확대 |
| 대기·이동 | 같은 배율로 재생하는 `fightIdle`, 16프레임 `walk`, 12프레임 `run` |
| 공격 | 준비·접촉·회수가 포함된 `combo`, `slam`, `dash` |
| 방어·피격 | `block`, `hit`, `groggy`, `fall`, 기상 자세 |
| 최종 확인 | 최종 패키지에서 재생한 필수 11개 동작과 이름·소개·초상 |

에이전트는 캐릭터 정체성, 실제 움직임, 발 교대, 접지, 공격 박자를 검사합니다. 걷기·달리기는 최종 픽셀과 재생 시간에 맞는 검수 결과가 필요합니다. JSON이나 이미지 디코딩 검사만 통과했다고 동작 품질을 통과한 것은 아닙니다. [보행 검수](docs/GAIT-REVIEW.md)와 [제작 UX 규칙](docs/CREATION-UX.md)을 따릅니다.

에이전트가 game-pack 요청 파일과 패키징 계획을 준비한 뒤 실행합니다.

```sh
npm run sprite -- game-pack --request game.json --out-dir pack
npm run fighter:pack -- plan.json
npm run validate -- output/my-fighter/fighter.json
```

요청·계획·출력 경로는 해당 선수의 작업 폴더에 맞춥니다. 도구가 실제 파일에서 크기·기준점·접지·해시를 측정합니다. 결과는 `output/my-fighter/` 아래의 `fighter.json`과 정적 WebP 시트입니다. 에이전트가 검사 오류를 수정하고 등록 전에 최종 패키지를 보여줍니다. [패키징 절차](docs/DOT-CREATION.md#패키지-만들기-game-pack--fighterpack)를 참고하세요.

## 5. 로그인과 등록

일반 사용자 흐름은 **ODDBOUT 연결 → 본인 Google 로그인 → 공개 코드 확인·연결 승인**입니다.
에이전트는 등록 API·계정, 생성 접근, 부모 대화 전달 상태를 각각 표시합니다. VM 호스트 허용·Republish는 초기 환경 준비자가
맡고 사용자는 준비된 VM을 재사용합니다. 키트가 Dots 자체 버튼이나 VM 보안 설정을 변경하지는 않습니다.
호스트가 버튼을 지원하지 않으면 같은 이름의 선택지와 공식 링크로 안내합니다. [연결 상태와 복구](docs/CONNECTION-READINESS.md)를 참고하세요.

등록을 요청하면 에이전트가 `deploy/creator-site.json`을 읽고, **`apiBase`의 origin**을 프로젝트 URL로, `publishableKey`를 공개 키로 사용해 Google 로그인을 시작합니다. 기존 서비스에 연결하므로 사용자가 Supabase 프로젝트를 만들거나 서비스 키를 발급받을 필요는 없습니다. 공개 설정값을 대입하면 다음 명령입니다.

```sh
npm run login -- --url https://YOUR_PROJECT_REF.supabase.co --key YOUR_PROJECT_PUBLISHABLE_KEY
```

에이전트가 봇 서비스의 VM에서 작업하면 사용자 브라우저와 그 VM의 `127.0.0.1` 콜백은 다른 기기에 있습니다.
공식적으로 지원되는 secure handoff 또는 기기 연결 경로를 사용하고, 없으면 에이전트가 로그인 연결이 막혔다고 알립니다.
콜백 주소에는 인증 코드·토큰이 포함될 수 있으므로 제작 대화에 붙여 넣지 마세요.
현재 CLI의 `--paste` / `--finish` 옵션 자체가 보안 전달 채널은 아니며 PKCE·만료도 대화 복사를 안전하게 만들지 않습니다.
보안 경로는 기기 연결 로그인입니다. 배포된 서버가 지원을 알리면 다음 순서로 진행합니다.
1. 에이전트가 `npm run login -- --device`로 제작 홈페이지 링크와 공개 확인 코드를 보여줍니다.
2. 링크를 열어 Google로 로그인하고, 코드가 같은지 확인한 뒤 승인합니다.
3. 에이전트가 `npm run login -- --device-wait`로 로그인을 마칩니다.

로그인 코드나 토큰은 대화에 나타나지 않습니다. 서버가 아직 지원하지 않으면 에이전트는 로그인이 막혔다고 알립니다. [실행 환경 지침](docs/EXECUTION-HOST.md#7-등록)을 참고하세요.

제작자 홈페이지에서 사용할 계정과 같은 Google 계정을 선택합니다. 로그인하면 `~/.ai-fighter/client.json`에 본인의 세션이 저장되고 MCP가 자동으로 읽습니다. 데스크톱 앱이 이미 실행 중이었다면 다시 시작합니다. 다른 세션 파일 위치는 `AI_FIGHTER_CLIENT_CONFIG`로 지정할 수 있습니다. 세션 토큰은 공개하지 않습니다.

이후 에이전트가 다음 순서로 처리합니다.

1. 선택한 최종 파일을 `validate_fighter_manifest`와 `validate_fighter_package`로 검사하고 오류를 수정합니다.
2. 상대 manifest 경로와 UUID `idempotencyKey`로 `submit_fighter_package`를 호출합니다. 동일한 패키지 재시도에는 같은 키를, 파일 내용이 바뀌면 새 키를 사용합니다.
3. `get_fighter_submission`으로 최종 결과를 조회합니다. 업로드나 대기열 진입만 끝났다면 아직 자동 서버 파일 검사 중입니다.
4. 실제 `stage: "registered"`, `fighterId`, `runtimeApproved: true`를 확인한 뒤 등록 완료와 이용 가능 여부를 안내합니다. 저장된 프로필은 `get_registered_fighter`로 확인합니다.

서버는 저장된 파일을 다시 검사하고 통과한 등록 선수를 자동으로 이용 가능하게 합니다. 검증 작업자가 잠들어 있으면 처리가 늦어질 수 있습니다. 자동 검사 대기이며 수동 승인 대기가 아닙니다. 반려된 패키지는 반환된 검사 오류를 고친 뒤 다시 제출합니다. 업로드나 생성 결과를 알 수 없을 때는 중복 작업을 피하도록 기존 상태부터 확인합니다.

현재 서비스 한도는 계정당 선수 1명, 제출 최대 5회, 패키지당 10 MB, 전체 예약 저장소 100 MB입니다. 부적절한 선수는 등록 후 내려갈 수 있습니다. [현재 이용·사후 조치 정책](docs/OPEN-REGISTRATION.md)을 참고하세요.

## 6. 내 선수 확인과 게임 이용

[제작자 홈페이지](https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html?lang=ko)에 같은 Google 계정으로 로그인해 등록 선수와 애니메이션을 확인합니다. Dot에 다음처럼 요청해도 됩니다.

> AI Fighter 홈페이지를 내 선수가 등록된 계정으로 열어줘.

`open_creator_homepage`는 어느 기기의 브라우저에서든 사용할 수 있는 일회용 로그인 링크를 반환합니다. 링크는 직접 열고 다른 사람에게 공유하지 않습니다. 한 번 사용하거나 10분이 지나면 만료되므로 새 링크를 요청합니다.

게임에서는 직접 조종과 공통 AI 자동 조종을 선택할 수 있습니다. 등록 선수는 같은 게임 규칙을 사용하며 선수 JSON에 실행 코드를 넣지 않습니다. 서버가 경기를 계산하고 결과·랭킹을 저장하므로 다른 브라우저에서도 이어서 확인할 수 있습니다.

## 문제가 생겼을 때

**제작·로그인·업로드·등록·게임 이용은 지원하는 정식 절차입니다. 올바른 입력으로 안내된 절차가 작동하지 않으면 재현해서 고쳐야 할 버그입니다.** 실패한 단계와 오류를 기록합니다. 실험이기 때문이라고 넘기거나, 미완료 결과를 완료로 표시하지 않습니다.

- 원화나 움직임이 잘못되면 해당 버전을 수정하고 다시 확인합니다.
- 파일 검사에서 거절되면 안내된 경로·필드를 수정하고 다시 검사합니다. 품질 검사는 유지합니다.
- 생성이나 제출이 시간 초과되면 기존 요청·상태·파일을 먼저 확인한 뒤 재시도합니다.
- 도구·로그인·서버·게임 단계가 예상과 다르게 실패하면 재현 순서, 기대 결과와 실제 결과, 오류 코드, 관련 도구 버전이나 커밋을 [저장소 이슈](https://github.com/jeonghwanko/ai-fighter-dots-starter/issues)에 남깁니다. 자격증명이나 비공개 파일은 제외합니다.

## MCP 도구 목록

### Codex 로컬 플러그인

`npm run plugin:build`로 이 컴퓨터의 체크아웃을 연결하는 **AI Fighter Creator** 플러그인을 만듭니다.
출력된 마켓플레이스를 Codex에 추가하고 설치하면 제작 스킬과 MCP를 함께 사용할 수 있습니다.
버전별 원본 보존, 묶음별 피드백 기록, 중단 작업 조회와 동일 작업 재실행 방지를 지원합니다.
설치와 사용법은 [로컬 플러그인 안내](docs/LOCAL-PLUGIN.md)를 참고하세요.
독립 실행용 Windows ZIP과 공식 등록 요건은 [플러그인 배포 안내](docs/PLUGIN-DISTRIBUTION.md)에 있습니다.
도메인·HTTPS·로그인 복귀 주소와 정책 페이지 배포는 [도메인 설정 안내](docs/DOMAIN-SETUP.ko.md)를 참고하세요.

| 도구 | 입력 | 결과 |
| --- | --- | --- |
| `get_fighter_spec` | `section`: context/overview/creation/guide/schema/example, 선택 `group` 또는 `motion` | 현재 게임 데이터, 제작 흐름, 규격, 예제 |
| `review_creation_progress` | `stateJson` | 묶음의 남은 항목과 다음 단계 진행 가능 여부 |
| `validate_fighter_manifest` | 원문 `manifestJson` 문자열 | 구조·참조·예산 검사 |
| `validate_fighter_package` | 상대 `manifestPath` | 실제 파일·해시·전체 WebP 디코딩 검사 |
| `submit_fighter_package` | 상대 `manifestPath`, UUID `idempotencyKey` | 인증된 업로드와 서버 검사 대기 |
| `get_fighter_submission` | `submissionId` | 검사·등록·반려 상태 |
| `get_registered_fighter` | `fighterId` | 저장된 선수 프로필 |
| `open_creator_homepage` | 없음 | 현재 계정의 일회용 로그인 링크 |

파일 도구에는 `AI_FIGHTER_ROOT`, 원격 도구에는 유효한 사용자 세션이 필요합니다. Codex 연결 제거는 `codex mcp remove ai-fighter`입니다.

이 MCP는 규격·검사·등록 도구를 제공합니다. 로컬 생성은 사용자 계정으로 포함된 sprite-gen을 실행하며, 지원되는 외형 시안은 [전달 사전 확인](docs/DELIVERY.md) 후 호스트의 직접 이미지 도구를 사용할 수 있습니다. 대화 모델·CLI 작업 모델·이미지 백엔드는 별개이며 로그인이나 요청한 모델명으로 생성 지원을 검증한 것은 아닙니다. 위 stdio 연결은 로컬 호스트에서 실행합니다. 웹 전용 ChatGPT 연결에는 사용자별 인증을 갖춘 별도의 HTTPS MCP 서버가 필요합니다.

## 개발과 참고 자료

로컬 계약·MCP 검사는 다음과 같습니다.

```sh
npm run spec:check
npm test
npm run validate -- examples/sparring-bot/fighter.json
npm run mcp:smoke
```

`examples/sparring-bot`, `npm run example`, Challenger Bot은 형식·서비스 검사에 쓰는 기하학 견본입니다. 생성 캐릭터 결과물이 아닙니다. 연결 검사가 성공해도 `pending: ["runtime-preview", "visual-review", "server-registration"]`이 남으며, 사용자의 선수를 제작하거나 등록하지는 않습니다.

게임 본체 소스는 별도로 관리합니다. 자체 서버에서 경기를 실행하려면 운영 게임 엔진 번들이 필요합니다. 이 키트의 빈 엔진 어댑터는 경기 생성에 HTTP 503을 반환합니다. 배포에 필요한 구성은 호스팅 안내를 따릅니다.

포함된 v1 계약 원천은 `contracts/ai-fighter/v1/contract-source.mjs`입니다. [SOURCE.json](contracts/ai-fighter/SOURCE.json)이 복사한 검사 파일의 해시를 고정합니다. 게임 계약 변경은 `npm run contract:vendored -- --compare <game-kaito_web-directory>`로 비교하며, 호환되지 않는 필드·한도 변경은 새 규격 버전으로 배포합니다.

상세 문서:

- [전체 제작 흐름](docs/DOT-CREATION.md)
- [제작 안내와 패키지 규격](docs/AUTHORING.md)
- [제작 UX와 확인 규칙](docs/CREATION-UX.md)
- [게임 제공 제작 데이터](docs/GAME-CREATION-CONTEXT.md)
- [보행 설계와 검수](docs/GAIT-REVIEW.md)
- [현재 이용·사후 조치 정책](docs/OPEN-REGISTRATION.md)
- [호스팅과 배포](docs/CREATOR-HOSTING.md)
- [보안 경계](SECURITY.md)
