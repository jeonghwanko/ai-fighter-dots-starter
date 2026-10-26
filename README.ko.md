# ODDBOUT · AI Fighter Creator

[English](README.md) | **한국어**

**AI와 함께 만든 나만의 캐릭터를 대전 게임에 출전시키세요.**

ODDBOUT은 직접 만든 캐릭터로 플레이하는 대전 게임입니다. 이 저장소에는 캐릭터를 만드는 오픈소스 도구가 들어 있습니다. AI와 대화하며 설명이나 참고 이미지를 원화와 애니메이션으로 만들고, 게임에 쓸 선수 패키지로 완성할 수 있습니다. 도구와 문서에서는 AI Fighter라는 이름도 사용합니다.

[게임하기](https://oddbout.com/fighter.html) · [내 선수 관리](https://oddbout.com/creator.html?lang=ko) · [제작 시작 안내](docs/START-HERE.md) · [문제 제보](https://github.com/jeonghwanko/ai-fighter-dots-starter/issues)

## 무엇을 만들 수 있나요?

- 짧은 설명이나 참고 이미지로 시작합니다. 둘을 함께 보내도 됩니다.
- AI가 보여주는 그림과 움직임을 보고 마음에 들지 않는 부분을 고쳐 달라고 하면 됩니다. 이미 선택한 버전은 보존합니다.
- 필수 11개 동작을 모아 패키지를 만들고, 파일을 검사한 뒤 내 계정으로 등록합니다.
- 등록한 선수를 직접 조종하거나 공통 AI에게 조종을 맡길 수 있습니다.

키트에는 sprite-gen, 제작 절차, 파일 검사 도구, AI와 게임을 연결하는 MCP 서버가 포함됩니다. 게임 엔진은 별도로 관리합니다.

## PC 없이 Dots에서 등록하기

ChatGPT 플러그인에서 **ODDBOUT** 클라우드 MCP를 연결하고 Google로 로그인한 뒤,
Dots 대화에서 `@ODDBOUT`을 선택하세요. 계정 확인·파일 전달·등록은 클라우드 연결이
처리합니다. 로컬 MCP 설치, API 키 입력, 로그인 콜백 복사는 필요하지 않습니다.
서버 주소와 최초 연결 순서는 [클라우드 연결 안내](docs/CLOUD-MCP.md)에 있습니다.
이미지 생성·미리보기·최종 검토는 선택한 실행 환경과 본인의 생성 계정을 사용합니다.
아래 설치 과정은 제작 키트를 작업 공간에서 실행할 때의 안내이며 클라우드 로그인에는 필요하지 않습니다.

## 로컬 키트로 캐릭터 만들기

내 PC나 작업 환경에서 명령을 실행하고 파일을 읽을 수 있는 Dot·Codex·Claude 등의 새 대화에 [시작 링크](https://github.com/jeonghwanko/ai-fighter-dots-starter/blob/codex/game-context/START-HERE.md)를 보내세요. 원하는 캐릭터 설명이나 참고 이미지를 함께 보내면 됩니다. 예를 들면:

> 이 키트로 ODDBOUT에 쓸 파란 갑옷의 고양이 복서를 만들어줘.
> 먼저 원화 한 장을 보여주고, 내 피드백으로 외형을 다듬어줘.
> 외형을 정하면 이동, 공격, 방어·피격을 묶음별로 보여줘.
> 최종 결과를 선택하면 검사해서 내 계정으로 등록하고 게임에서 쓸 수 있는지 확인해줘.

설치와 생성, 패키징, 파일 검사는 AI가 맡습니다. 사용자는 결과를 보면서 캐릭터의 외형과 움직임을 정합니다. ODDBOUT에 로그인하기 전에도 로컬에서 제작을 시작할 수 있습니다.

### 준비물

| 준비물 | 설명 |
| --- | --- |
| 로컬 실행 환경 | 본인 PC 또는 사용자별 작업 환경에 Git, Node.js **22.12+**, Python **3.11+**가 필요합니다. 설치는 AI의 도움을 받을 수 있습니다. |
| 본인의 생성 계정 | 이미지와 동작 생성에는 본인 계정과 구독을 사용합니다. 시작 전에 실제 이미지·영상 접근과 미리보기 전달 경로를 확인합니다. |
| 등록용 Google 계정 | 업로드·등록할 때 로그인합니다. 초대나 수동 승인은 필요하지 않습니다. |

로컬 키트를 처음 쓸 때는 제작 도구를 설치하고, 진행 중에는 여러 차례 결과를 확인해야 합니다. 걸리는 시간과 이용 한도, 비용은 쓰는 서비스와 수정 횟수에 따라 다릅니다. 생성 서비스는 사용자와 함께 정합니다. 다른 서비스로 바꾸거나 과금 API를 쓰려면 사용자의 동의가 필요합니다. 웹 대화창에서 전체 과정을 진행하려면 별도의 실행 환경을 연결해야 합니다.

### 한 묶음씩 만들고 확인합니다

| 단계 | 함께 확인할 결과 |
| --- | --- |
| 외형 | 전신 원화, 기본 자세, 같은 그림의 얼굴 확대 |
| 이동 | 같은 크기로 재생하는 전투 대기·걷기·달리기 |
| 공격 | 준비와 회수가 포함된 연타·강타·돌진 |
| 방어·피격 | 막기·맞기·비틀거림·쓰러짐·기상 |
| 최종 확인 | 완성된 패키지의 11개 동작, 이름·소개·초상 |

AI는 한 묶음이 끝날 때마다 실제 결과를 보여주고 의견을 기다립니다. 수정할 부분만 다시 만들고 나머지 선택은 보존합니다. 이후 단계는 알아서 진행해 달라고 맡길 수도 있습니다. AI가 파일 검사와 함께 캐릭터의 일관성, 움직임, 발이 땅에 닿는 모습, 동작 타이밍을 검토하고, 사용자는 결과를 확인한 뒤 다음 단계로 넘어갑니다.

생성·수정·패키징의 자세한 절차는 [전체 제작 흐름](docs/DOT-CREATION.md)에 있습니다.

## 직접 설치하기

공개 서비스 연결 설정이 있는 **codex/creator-hosting** 브랜치를 사용합니다. 새로 설치할 때는 다음 명령을 실행하세요.

```sh
git clone --branch codex/creator-hosting --single-branch https://github.com/jeonghwanko/ai-fighter-dots-starter.git
cd ai-fighter-dots-starter
npm ci --ignore-scripts
npm run sprite:setup
npm run sprite:status
```

설치 도구가 고정된 버전의 sprite-gen 소스를 받아 전용 Python 환경에 설치합니다. GitHub 소스 ZIP에는 서브모듈 파일이 없으므로 Git clone을 사용하세요. 상태 명령은 설치 상태를 확인하며, 생성 기능 접근이나 잔여 한도까지 확인하지는 않습니다.

설치 도구는 sprite-gen이 쓰는 외부 도구도 sudo 없이 받습니다. `-exact`를 지원하는 `img2webp`(libwebp 1.6.0, SHA-256 고정 — 시스템에 없거나 Ubuntu 24.04의 1.3.x처럼 오래되면 키트 전용 환경에 넣습니다)와 걷기·달리기 루프를 매끄럽게 잇는 RIFE(`sprite-gen rife install`, 약 430MB 다운로드)입니다. `ffmpeg`는 먼저 직접 설치하세요: `sudo apt install ffmpeg`(Ubuntu·Debian), `brew install ffmpeg`(macOS), `winget install --id Gyan.FFmpeg -e`(Windows). 설치와 `sprite:status`가 도구마다 `ok`·`missing`·`broken`과 고치는 명령을 보여줍니다. GPU가 없는 Linux에서는 RIFE용으로 `sudo apt install libvulkan1 mesa-vulkan-drivers`도 필요합니다. RIFE가 없으면 루프는 촬영된 그대로 잘리고 경고가 남습니다. 캐릭터를 제작 중이라면 작업 폴더를 유지하고 저장소 업데이트를 받지 마세요.

도구 연결은 [Codex 로컬 플러그인 안내](docs/LOCAL-PLUGIN.md)를 따릅니다. MCP를 직접 연결하려면 `node scripts/print-install.mjs`로 설치 명령을 출력해 실행하세요. 다른 로컬 호스트는 `AI_FIGHTER_ROOT`를 이 저장소 경로로 지정하고 `mcp/stdio.mjs`를 연결합니다.

별도의 Windows 배포 패키지는 [번들 안내](docs/PLUGIN-DISTRIBUTION.md)를 참고하세요. 로컬 플러그인 설치와 공개 디렉터리 등록은 별개입니다.

## 등록하고 플레이하기

최종 결과를 선택하고 등록을 요청하면 AI가 패키지를 검사하고 Google 로그인을 도와줍니다. 키트에 서비스 연결 설정이 들어 있어, 직접 서버를 만들거나 서비스 API 키를 발급받을 필요는 없습니다.

서버가 업로드된 파일을 검사한 뒤 게임에서 쓸 수 있게 합니다. AI가 처리 결과까지 확인해 내 캐릭터가 실제로 등록됐고 게임에서 이용 가능한지 알려줍니다. 대기열 상황에 따라 시간이 걸릴 수 있습니다.

같은 Google 계정으로 [제작자 페이지](https://oddbout.com/creator.html?lang=ko)에 로그인하면 내 선수를 확인할 수 있습니다. 이용 한도와 프로필 수정은 [등록 안내](docs/OPEN-REGISTRATION.md)를 참고하세요. 로그인 링크, 콜백 주소, 세션 파일은 공개하지 마세요.

## 문제 제보와 기여

설치·생성·로그인·등록·게임 이용 중 문제가 생기면 실패한 단계, 기대한 결과와 실제 결과, 오류 메시지, 도구 버전이나 커밋을 [이슈](https://github.com/jeonghwanko/ai-fighter-dots-starter/issues)에 남겨주세요. 인증 정보와 비공개 파일은 제외합니다. 생성이나 업로드가 시간 초과된 경우에는 기존 요청과 결과물부터 확인한 뒤 재시도합니다.

버그 제보, 설치 안내 개선, 재현 가능한 예제를 환영합니다. AI와 함께 저장소를 수정할 때는 [AGENTS.md](AGENTS.md)를 먼저 읽어주세요.

| 문서 | 내용 |
| --- | --- |
| [클라우드 연결](docs/CLOUD-MCP.md) · [연결 복구](docs/CONNECTION-READINESS.md) | Google 로그인, 계정 확인, 클라우드 등록 |
| [제작 규격](docs/AUTHORING.md) | 선수 파일과 패키지 규격 |
| [제작 UX](docs/CREATION-UX.md) | 캐릭터 입력, 피드백, 버전 선택 |
| [게임 제작 데이터](docs/GAME-CREATION-CONTEXT.md) | 현재 동작·조작·시간 규칙 |
| [보행 검수](docs/GAIT-REVIEW.md) | 걷기·달리기 품질과 접지 근거 |
| [실행 환경](docs/EXECUTION-HOST.md) · [미리보기 전달](docs/DELIVERY.md) | 계정 분리, 로컬 실행, 실제 결과 표시 |
| [호스팅](docs/CREATOR-HOSTING.md) · [보안](SECURITY.md) | 배포와 보안 경계 |

의존성 설치 후 로컬 개발 검사는 다음 명령으로 실행합니다.

```sh
npm run spec:check
npm test
npm run validate -- examples/sparring-bot/fighter.json
npm run mcp:smoke
```

예제 sparring-bot은 형식 검사용 기하학 견본입니다. 위 검사로 새 캐릭터가 생성되거나 등록되지는 않습니다. 자체 서버에서 경기를 실행하려면 별도로 관리하는 운영 게임 엔진 번들이 필요합니다.

## 라이선스

제작 키트는 [MIT 라이선스](LICENSE)를 따릅니다. 포함된 [sprite-gen](vendor/sprite-gen) 서브모듈에는 별도의 Apache-2.0 LICENSE와 NOTICE가 적용됩니다. 생성 서비스의 계정과 이용에는 각 제공자의 약관이 적용됩니다.
