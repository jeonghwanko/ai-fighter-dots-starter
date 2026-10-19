# AI Fighter × Dot starter

Dot 사용자가 AI Fighter의 제작 규격을 읽고, 선수의 애셋과 JSON을 만든 뒤 **Supabase 베타에 제출·등록**하는 로컬 MCP 샘플입니다.
MIT 오픈소스입니다. Node 22.12 이상이 필요합니다.

**현재 가능:** 규격 조회, JSON·WebP 검사, 인증된 업로드, 서버 재검증, 중복 없는 선수 등록과 조회, 출전 승인된 패키지의 게임 전달.
**후속 구현:** 공개 OAuth 설치 흐름, 기존 게임 계정 연결, 신규 그림의 품질 검수와 등록 선수의 AI 상대 지원.
아래 기본 실행은 로컬 검사입니다. 실제 제출에는 초대된 베타 계정과 별도 검증 작업자가 필요합니다.
2026-10-19 실제 Free 프로젝트에서 MCP 제출→저장 파일 재검증→선수 1명 등록을 확인했습니다.
상세 조건과 시험 결과는 [베타 운영 안내](docs/SUPABASE-BETA.md)에 있습니다.
등록된 Sparring Bot은 `arena-player-v1` 범위로 승인하여 로컬 AI Fighter 선수 목록과 실제 WebGL 경기에 연결했습니다.
게임 본체는 이 샘플에 포함하지 않습니다. 새 등록은 여전히 출전 승인 대기로 시작합니다.

## 3분 실행

```sh
git clone https://github.com/jeonghwanko/ai-fighter-dots-starter.git
cd ai-fighter-dots-starter
npm ci --ignore-scripts
npm run validate -- examples/sparring-bot/fighter.json
npm run mcp:smoke
```

`mcp:smoke`는 공식 SDK 클라이언트로 서버를 띄워 `initialize → tools/list → tools/call`을 실제 호출합니다.
성공 결과에도 `pending: ["runtime-preview", "visual-review", "server-registration"]`이 남습니다.
새 테스트 패키지는 `npm run example`로 `output/sparring-bot/`에 생성할 수 있습니다. 기존 폴더는 덮어쓰지 않습니다.
게임 원본 그림은 포함하지 않았습니다. 로봇 그림과 생성 코드는 이 샘플의 독자적인 형식 시험 자료입니다.

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

> ai-fighter의 get_fighter_spec으로 overview와 guide를 먼저 읽어줘.
> examples/sparring-bot/fighter.json을 validate_fighter_package로 검사하고,
> 통과한 단계와 아직 남은 단계를 구분해서 알려줘.

초대된 베타 계정의 세션 파일을 받은 경우 `AI_FIGHTER_CLIENT_CONFIG` 환경 변수로 그 **비공개 파일 경로**를 지정하고
설정 명령을 다시 출력합니다. 서비스 키와 작업자 키는 이 파일에 넣지 않습니다.

```powershell
$env:AI_FIGHTER_CLIENT_CONFIG = 'C:/private/ai-fighter/client.json'
node scripts/print-install.mjs
```

연결 확인 후 실제 제작·제출 요청 예시:

> AI Fighter에 쓸 파란 갑옷의 고양이 복서를 만들어줘.
> ai-fighter 규격·스키마·예제를 읽고 새 원화와 필수 11개 동작을 제작해.
> output/blue-cat/에 정적 WebP와 fighter.json을 저장하고 실제 파일에서 해시와 크기를 계산해.
> JSON과 패키지를 검사하고 오류를 수정해. 연결된 베타에 제출하고 등록 결과를 조회해.
> 하나의 패키지에는 같은 idempotencyKey를 사용해. 실제 경기 출전 승인 여부도 구분해줘.

애셋 생성은 Dot 호스트의 이미지·애니메이션 도구가 담당합니다. 이 MCP 자체에는 생성 모델이나 생성 API 요금이 없습니다.
호스트의 이미지 생성 도구 지원 여부와 이용 한도는 별도입니다.

| 도구 | 입력 | 결과 |
| --- | --- | --- |
| `get_fighter_spec` | `section`: overview/guide/schema/example | 버전·한도·안내·스키마·예제 |
| `validate_fighter_manifest` | `manifestJson`: 원문 문자열 | 구조·참조·예산 검사 |
| `validate_fighter_package` | `manifestPath`: 작업 폴더 기준 상대 경로 | 파일·해시·전체 디코딩 검사 |
| `submit_fighter_package` | 상대 경로, `idempotencyKey`: UUID | 인증된 업로드 후 서버 검증 대기 |
| `get_fighter_submission` | `submissionId` | 검증·등록·반려 상태 |
| `get_registered_fighter` | `fighterId` | 서버에 등록된 프로필 |

`AI_FIGHTER_ROOT`를 지정하지 않으면 파일 검사 도구는 노출되지 않습니다.
클라이언트 설정이 없으면 앞의 로컬 도구 3개만 노출됩니다. 등록 도구는 사용자 세션을 사용하며 Supabase 서비스 키를 받지 않습니다.
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
```

검증 코드는 허용 목록, 중복 JSON 키, 경로 탈출, 용량·픽셀 예산, 실제 인코딩, 빈 프레임과 crop을 확인합니다.
MCP 파일 검사는 한 번에 한 개의 자식 프로세스로 실행하며 20초가 지나면 종료합니다.
제작 폴더를 외부 공격자가 동시에 바꾸는 경우는 지원하지 않습니다.
서버 작업자는 새 다운로드 폴더와 불변 파일을 사용하며, 불특정 다수 공개 전 OS 자원 격리가 추가로 필요합니다.
자동 GitHub Actions는 포함하지 않았습니다.

- [제작 안내](docs/AUTHORING.md)
- [적대적 리뷰와 남은 출시 조건](docs/ADVERSARIAL-REVIEW.md)
- [Supabase 무료 베타 배포·인증·작업자 운영](docs/SUPABASE-BETA.md)
- [보안 경계](SECURITY.md)

규격 원천은 `contracts/ai-fighter/v1/contract-source.mjs`입니다.
이 저장소에는 게임 제작 계약의 v1 스냅샷을 포함합니다. 원본 저장소를 내려받을 필요가 없습니다.
한도나 필수 필드를 호환되지 않게 바꾸면 새 규격 버전으로 배포해야 합니다.

검증 범위: 공식 MCP SDK와 실제 stdio 프로세스, 실제 Supabase 업로드·등록, 다른 계정 접근 차단과 중복 방지.
게임 전달 API는 [승인과 게임 로딩](docs/SUPABASE-BETA.md#승인과-게임-로딩)을 따릅니다.
개별 사용자의 Dot UI에서 도구가 노출되는 과정과 생성 모델의 제작 품질은 자동 시험하지 않았습니다.
