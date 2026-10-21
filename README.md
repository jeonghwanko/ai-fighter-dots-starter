# AI Fighter × Dot starter

Dot 사용자가 AI Fighter의 제작 규격을 읽고, **함께 포함된 sprite-gen으로 자기 캐릭터의 원화·애니메이션과 JSON을 만든 뒤 AI Fighter에 제출·등록**하는 로컬 MCP 제작 키트입니다.
MIT 오픈소스입니다. 포함된 sprite-gen 서브모듈은 별도의 Apache-2.0입니다. Node 22.12 이상이 필요합니다.

sprite-gen 소스는 `vendor/sprite-gen` Git 서브모듈에 포함됩니다. 각 사용자의 Dot이 이를 로컬에서 실행하고,
각자의 생성 계정과 구독을 사용합니다. 운영자의 생성 계정이나 API 키를 공유하지 않습니다.
[Dot 제작 흐름](docs/DOT-CREATION.md)에 설치부터 생성·검수·등록까지 설명합니다.

[보행 설계·검수](docs/GAIT-REVIEW.md)는 공통 좌표·배율, 지지발 계획, 양발의 접지 측정과 등록 전 미리보기를 연결합니다.
`npm run fighter:gait -- init output/my-walk`로 시작합니다. `fighter:pack`은 기본적으로 현재 walk/run과 일치하는 검수 결과를 요구합니다.
sprite-gen 설치·파일 검사 성공만으로 시각 품질이 자동 승인되지는 않습니다.

**현재 가능:** 규격 조회, JSON·WebP 검사, 인증된 업로드, 서버 재검증, 중복 없는 선수 등록과 조회, 자동 검사된 패키지의 게임 전달, 서버 경기 결과·전적·랭킹 API.
Google 로그인은 홈페이지와 제작 도구에서 같은 계정으로 진행합니다. 신규 그림은 동작 품질을 검수한 뒤 등록합니다.
아래 기본 실행은 로컬 검사입니다. 실제 제출에는 본인의 Google 로그인과 서버 검증 작업자가 필요합니다. 사전 승인은 없습니다.
2026-10-19 실제 Free 프로젝트에서 MCP 제출→저장 파일 재검증→선수 1명 등록을 확인했습니다.
현재 이용 조건은 [공개 이용 안내](docs/OPEN-REGISTRATION.md), 과거 시험 기록은 [이전 베타 운영 기록](docs/SUPABASE-BETA.md)에 있습니다.
Sparring Bot과 Challenger Bot은 서버·형식 검사용 기하학 견본입니다. 생성 캐릭터가 아니며 공개 선수 목록에서 제외했습니다.
게임에서는 직접 조종과 공통 AI의 자동 조종을 선택할 수 있습니다. 선수 JSON에 실행 코드를 넣지 않습니다.
자동 검사를 통과한 등록 선수끼리는 같은 AI 규칙으로 싸울 수 있습니다. 서버가 경기를 계산해 Supabase에 저장하고 게임이 같은 경기를 재생합니다.
승패·랭킹은 다른 브라우저에서도 유지됩니다. 실제 Sparring Bot 대 Challenger Bot 경기, 동시 재시도 4회와 새 브라우저 조회를 검증했습니다.
대결 실행에는 운영 게임에서 만든 엔진 번들이 필요합니다. 이 샘플의 빈 엔진 어댑터는 경기 생성을 503으로 막습니다.
게임 본체는 이 샘플에 포함하지 않습니다. 새 등록은 파일 검사 후 바로 이용할 수 있습니다. 부적절한 선수는 사후에 내릴 수 있습니다.

## 3분 실행

```sh
git clone --branch codex/creator-hosting --single-branch https://github.com/jeonghwanko/ai-fighter-dots-starter.git
cd ai-fighter-dots-starter
npm ci --ignore-scripts
npm run validate -- examples/sparring-bot/fighter.json
npm run mcp:smoke
```

홈페이지와 연결할 제작 도구는 `codex/creator-hosting` 브랜치를 사용합니다.
이 브랜치의 `deploy/creator-site.json`에 공개 로그인 연결 설정이 있습니다. 기본 `main`으로 대체하지 않습니다.

`mcp:smoke`는 공식 SDK 클라이언트로 서버를 띄워 `initialize → tools/list → tools/call`을 실제 호출합니다.
성공 결과에도 `pending: ["runtime-preview", "visual-review", "server-registration"]`이 남습니다.
새 테스트 패키지는 `npm run example`로 `output/sparring-bot/`에 생성할 수 있습니다. 기존 폴더는 덮어쓰지 않습니다.
게임 원본 그림은 포함하지 않았습니다. 로봇 그림과 생성 코드는 이 샘플의 독자적인 형식 시험 자료입니다.

실제 새 선수 제작에는 Git과 Python 3.11+도 필요합니다.

```sh
npm run sprite:setup
npm run sprite:status
npm run sprite -- workflow --kind sprite
```

`sprite:setup`은 sprite-gen 고정 커밋을 얕게(약 100 MB) 받고 전용 venv에만 설치합니다. 검사만 할 때는 필요 없습니다.
`sprite:status`는 로그인이나 구독 확인을 대신하지 않습니다.
이후 Dot이 `vendor/sprite-gen/SKILL.md`를 읽고 사용자에게 필요한 선택만 확인한 뒤 생성합니다.
생성 결과는 `sprite-gen game-pack`으로 모은 뒤 `npm run fighter:pack -- plan.json`으로 AI Fighter 패키지를 만듭니다.
시트·해시·기준점·접지를 실제 픽셀에서 재고 계약 검사까지 실행합니다. [Dot 제작 흐름](docs/DOT-CREATION.md#패키지-만들기-game-pack--fighterpack)을 따릅니다.
GitHub ZIP에는 서브모듈 내용이 없으므로 Git clone을 사용합니다.

## 현재 데스크톱 Dot/Codex에서 사용

로컬 작업을 실행하는 데스크톱 호스트에서는 MCP stdio 서버를 연결합니다.
[공식 MCP 안내](https://developers.openai.com/codex/mcp)에 따르면 데스크톱 앱·Codex CLI·IDE는 같은 호스트의 MCP 설정을 공유합니다.

설정 명령을 출력합니다. 이 단계는 설정 파일을 바꾸지 않습니다.

```sh
node scripts/print-install.mjs
```

출력된 `codex mcp add ai-fighter --env ... -- ...` 한 줄을 터미널에서 실행합니다.
절대 Node 경로, 서버 경로, 검사할 폴더 `AI_FIGHTER_ROOT`가 포함됩니다.
`codex mcp list`로 확인하고 앱에서 새 로컬 대화를 엽니다. 도구가 보이지 않으면 앱을 다시 시작합니다.
설치 후 폴더를 이동했다면 명령을 새 경로에서 다시 출력하여 등록합니다.

Dot에 다음처럼 요청합니다.

> ai-fighter의 get_fighter_spec으로 overview와 creation, guide를 먼저 읽어줘.
> examples/sparring-bot/fighter.json을 validate_fighter_package로 검사하고,
> 통과한 단계와 아직 남은 단계를 구분해서 알려줘.

제출하려면 로그인합니다. Google 계정으로 브라우저에서 로그인하면 세션 파일 `~/.ai-fighter/client.json`이 생깁니다.
MCP는 이 파일을 자동으로 찾습니다. 이미 실행 중인 앱은 다시 시작합니다. 서비스 키와 작업자 키는 쓰지 않습니다.

```sh
npm run login -- --url https://YOUR_PROJECT_REF.supabase.co --key YOUR_PROJECT_PUBLISHABLE_KEY
```

Google로 로그인하면 초대나 사전 승인 없이 제출할 수 있습니다. [현재 이용·사후 조치 정책](docs/OPEN-REGISTRATION.md)을 따릅니다.
Google 로그인은 2026-10-21 운영 서버에 반영되었습니다. 상태는 [베타 운영 안내](docs/SUPABASE-BETA.md#google-로그인)를 봅니다.
운영자가 준비한 세션 파일을 쓰는 기존 방식도 `AI_FIGHTER_CLIENT_CONFIG`로 계속 쓸 수 있습니다.

연결 확인 후 실제 제작·제출 요청 예시:

> AI Fighter에 쓸 파란 갑옷의 고양이 복서를 만들어줘.
> ai-fighter 규격·creation 안내·스키마를 읽고, 포함된 sprite-gen으로 새 원화와 필수 11개 동작을 제작해.
> 내 생성 계정의 사용 가능 여부를 확인하고, 형식 시험용 로봇을 새 선수로 대신 사용하지 마.
> output/blue-cat/에 정적 WebP와 fighter.json을 저장하고 실제 파일에서 해시와 크기를 계산해.
> JSON과 패키지를 검사하고 오류를 수정해. 연결된 베타에 제출하고 등록 결과를 조회해.
> 하나의 패키지에는 같은 idempotencyKey를 사용해. 실제 등록 완료와 이용 가능 여부를 확인해줘.

애셋 생성은 Dot이 이 저장소의 sprite-gen을 실행해 수행합니다. 이 MCP 자체에는 생성 모델이나 생성 API 요금이 없습니다.
호스트의 이미지 생성 도구 지원 여부와 이용 한도는 별도입니다.

| 도구 | 입력 | 결과 |
| --- | --- | --- |
| `get_fighter_spec` | `section`: overview/creation/guide/schema/example, 선택 `motion` | 버전·한도·sprite-gen 제작 흐름·스키마·예제. `motion`이 있으면 그 동작의 스키마·예제만 |
| `validate_fighter_manifest` | `manifestJson`: 원문 문자열 | 구조·참조·예산 검사 |
| `validate_fighter_package` | `manifestPath`: 작업 폴더 기준 상대 경로 | 파일·해시·전체 디코딩 검사 |
| `submit_fighter_package` | 상대 경로, `idempotencyKey`: UUID | 인증된 업로드 후 서버 검증 대기 |
| `get_fighter_submission` | `submissionId` | 검증·등록·반려 상태 |
| `get_registered_fighter` | `fighterId` | 서버에 등록된 프로필 |
| `open_creator_homepage` | 없음 | [제작자 홈페이지](https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html)에 이 베타 계정으로 로그인하는 일회용 링크(10분, 어느 기기의 브라우저에서나) |

`AI_FIGHTER_ROOT`를 지정하지 않으면 파일 검사 도구는 노출되지 않습니다.
클라이언트 설정이 없으면 앞의 로컬 도구 3개만 노출됩니다. 등록 도구는 사용자 세션을 사용하며 Supabase 서비스 키를 받지 않습니다.

내 선수를 홈페이지에서 보려면 Dot에 "AI Fighter 홈페이지를 내 등록 계정으로 열어줘"라고 요청합니다. `open_creator_homepage`가
서버에 이 계정 전용 일회용 로그인 토큰을 요청하고, 그 해시를 붙인 홈페이지 링크를 돌려줍니다.
링크는 폰·다른 컴퓨터 등 어느 브라우저에서 열어도 됩니다. 페이지에서 [내 선수 보기]를 누르면 연결됩니다.
한 번 쓰거나 10분이 지나면 만료되며, 그때는 Dot에 새 링크를 요청합니다. 세션 파일의 토큰은 링크에 들어가지 않습니다.
링크는 로그인 수단이므로 다른 사람에게 보내지 않습니다. 로컬 개발 페이지는 `AI_FIGHTER_CREATOR_URL`(루프백 `creator.html`)로 지정합니다.
연결 제거: `codex mcp remove ai-fighter`.

## ChatGPT 웹과 공개 플러그인

위 명령은 로컬 데스크톱 호스트용입니다. 웹 ChatGPT에서 로컬 stdio 프로세스를 직접 실행할 수는 없습니다.
웹 배포에는 공개 HTTPS Streamable HTTP MCP와 플러그인 연결 절차가 필요합니다.
사용자별 업로드·등록에는 OAuth와 요청마다 소유권 검사가 필요합니다.
GitHub 공개는 플러그인 디렉터리 등록이나 서버 배포를 뜻하지 않습니다.
절차는 [공식 연결 안내](https://developers.openai.com/plugins/deploy/connect-chatgpt)와
[인증 안내](https://developers.openai.com/plugins/build/auth)를 따릅니다.

## 개발과 검증

```sh
npm run spec:check
npm test
npm run validate -- output/my-fighter/fighter.json --metadata-only
npm run fighter:pack -- output/my-fighter-work/plan.json
```

검증 코드는 허용 목록, 중복 JSON 키, 경로 탈출, 용량·픽셀 예산, 실제 인코딩, 빈 프레임과 crop을 확인합니다.
MCP 파일 검사는 한 번에 한 개의 자식 프로세스로 실행하며 20초가 지나면 종료합니다.
제작 폴더를 외부 공격자가 동시에 바꾸는 경우는 지원하지 않습니다.
서버 작업자는 새 다운로드 폴더와 불변 파일을 사용하며, 불특정 다수 공개 전 OS 자원 격리가 추가로 필요합니다.
자동 GitHub Actions는 포함하지 않았습니다.

- [제작 안내](docs/AUTHORING.md)
- [Dot과 포함된 sprite-gen으로 내 선수 만들기](docs/DOT-CREATION.md)
- [적대적 리뷰와 남은 출시 조건](docs/ADVERSARIAL-REVIEW.md)
- [Supabase 무료 베타 배포·인증·작업자 운영](docs/SUPABASE-BETA.md)
- [제작자 홈페이지 무료 호스팅·재배포](docs/CREATOR-HOSTING.md)
- [보안 경계](SECURITY.md)

규격 원천은 `contracts/ai-fighter/v1/contract-source.mjs`입니다.
이 저장소에는 게임 제작 계약의 v1 스냅샷을 포함합니다. 원본 저장소를 내려받을 필요가 없습니다.
검사기와 패키지 검사 파일은 게임 저장소 파일의 바이트 복사본이며 [SOURCE.json](contracts/ai-fighter/SOURCE.json)이 해시를 고정합니다.
게임이 계약을 바꾸면 `npm run contract:vendored -- --compare <게임의 kaito_web 폴더>`로 차이를 확인하고 다시 복사합니다.
한도나 필수 필드를 호환되지 않게 바꾸면 새 규격 버전으로 배포해야 합니다.

검증 범위: 공식 MCP SDK와 실제 stdio 프로세스, 실제 Supabase 업로드·등록, 다른 계정 접근 차단과 중복 방지.
게임 전달 API는 [가입 후 바로 이용하기](docs/OPEN-REGISTRATION.md)을 따릅니다.
개별 사용자의 Dot UI에서 도구가 노출되는 과정과 생성 모델의 제작 품질은 자동 시험하지 않았습니다.
