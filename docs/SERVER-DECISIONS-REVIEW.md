# 서버 Decisions 보조 검수

호스팅 제작의 검수는 `생성 호스트 → ODDBOUT API → Luna Decisions → 필요한 항목만 Sol Responses`로 연결된다.
OpenAI 키는 서버에만 있다. 사용자 PC의 환경변수·로그인·Codex 설정을 바꾸지 않는다.
공개 저장소, 배포 번들, 생성 호스트의 `worker.env`, 제작 작업 폴더에는 OpenAI 키를 넣지 않는다.

## 실행 경로

- `host/generation-stages.mjs`: 외형 생성 전 설계, 외형 후보 두 장, 기존 검수를 통과한 최종 game-pack의 걷기 16장·달리기 12장을 보낸다.
- 단계 모듈의 `reviewOnServer`: 실제 파일의 SHA-256과 인라인 이미지, 프레임별 재생시간을 만든다. 개인 경로와 생성 계정 자격증명은 보내지 않는다.
- `host/generation-worker.mjs`: 기존 ODDBOUT 생성 워커 키와 작업 임대 토큰으로
  `POST /generation-worker/jobs/{jobId}/decisions`를 호출한다. 호스트는 OpenAI에 직접 접속하지 않는다.
- `api/generations.mjs`: 생성 워커 권한, 해당 호스트에 배정된 작업, 유효한 임대와 제작 단계를 검사한다.
- `api/decisions-review.mjs`: 서버가 정한 질문과 `gpt-6-luna`로 `https://api.openai.com/v1/decisions`에 한 번 요청한다.
  호출자는 모델·질문·엔드포인트·키를 선택할 수 없다. 외부 이미지 URL도 받지 않는다.
- `api/luna-sol-review.mjs`: 완료된 Luna 판정 중 `unverified`·`defect` 항목만 `gpt-6.1-sol`에 한 번 추가 요청한다.
  Luna의 선택 신뢰도와 선택 확률이 모두 0.8 이상인 `clear`는 추가 호출하지 않는다.
  통신 실패·결과 불명·거부는 자동 승급 대상이 아니다. Astra는 자동 호출하지 않는다.
  Sol에는 같은 이미지·재생시간·설계 의도와 선택된 질문만 보내며, Luna의 답은 보내지 않는다.

현재 연결은 호스팅 작업용이다. 일반 PC/VM의 독립 제작 세션은 서버 작업 임대가 없으므로 이 API를 호출할 수 없다.
엔진의 독립 `review-decisions` 명령은 별도 연구 도구로 남지만, 호스팅 흐름에서 실행하거나 키 설정에 사용하지 않는다.

## 서버 설정

운영자가 **Supabase Dashboard → 해당 프로젝트 → Edge Functions → Secrets**에서 관리한다.
키 값은 채팅·셸 인자·문서·`.env` 파일에 쓰지 않는다. 이 기능을 켜기 위해 로컬에 키 파일을 만들 필요가 없다.

| 서버 Secret 이름 | 용도 |
| --- | --- |
| `ODDBOUT_DECISIONS_API_KEY` | 검수 전용 OpenAI 프로젝트의 제한된 API 키. Decisions Write와 Responses Write만 허용하고 서버에서 교체·폐기한다. Responses Write에 자동 포함되는 Read 외 추가 권한은 부여하지 않는다. |
| `ODDBOUT_DECISIONS_MODE` | `shadow`일 때만 활성화. 없거나 다른 값이면 비활성화한다. |

키와 `shadow` 설정이 모두 있어야 워커의 작업 응답에 `decisionsReview.mode: "shadow"`가 들어간다.
기존 `OPENAI_API_KEY`, 사용자 Codex/Grok 로그인, ODDBOUT 워커 키를 OpenAI 인증으로 전용하지 않는다.
API 비용은 이 키의 OpenAI 프로젝트에 청구된다. Codex 앱 크레딧과 별개다.
Supabase의 Secrets는 프로젝트 Edge 실행 환경에 제공되므로, 같은 프로젝트의 다른 서버 함수도 신뢰 경계에 포함된다.

서버 기본 상한은 최근 24시간 **50회**, 작업당 **20회**다. `af_decision_review_limits`에서 운영자가 조정한다.
Luna와 Sol은 이 한도를 공유하며 각각 한 회로 센다. Sol은 `medium`, Standard, 최대 출력 1,800토큰으로 고정한다.
이는 요청 수 제한이며 달러 단위 결제 상한은 아니다. 이미지 합계 요청 본문 8 MiB, 이미지당 2 MiB·2048×2048 이하로 제한한다.
이미지 검사는 파일 종류·헤더·해시·크기 확인이며 시각적 통과 판정이 아니다.

## 결과와 기존 검수

비교 모드는 결과를 기록할 뿐 생성, 재생성, 선택, 패키징, 등록 여부를 바꾸지 않는다.
기존 Codex 시각 검수, 엔진 검사, 접지·보행 검수, 사용자 확인은 그대로 수행한다.
키가 없거나 검수 서비스가 실패해도 기존 흐름으로 계속하며 Decisions 결과는 비활성 또는 미검증으로 남긴다.
프레임은 최종 game-pack에서 크기·좌표를 바꾸지 않고 추출한다. PNG 파일 해시와 실제 재생시간을 서버 결과에 묶는다.

`af_decision_reviews`는 서비스 역할만 읽고 쓸 수 있다(RLS 활성화, 공개·사용자 역할 권한 없음).
이미지·프롬프트·키는 저장하지 않고 해시, 고정 검수 기준, 선택 확률, 요청 ID, 토큰 사용량, 경과시간을 보관한다.
작업 소유자는 기존 ODDBOUT 인증으로 `GET /generations/{jobId}/reviews`에서 자신의 보고서를 읽는다.
호스트에도 작업 폴더의 `decisions/`에 보고서를 남긴다. 확률과 기준값은 아직 보정되지 않았으며 정확도·속도 개선을 주장하지 않는다.
호스트 응답의 `checks`는 Luna 원판정이고 `followup.checks`가 Sol의 추가 의견이다. `cascade.questionNames`가 선택 항목이다.
서버 원장은 두 보고서를 별도로 저장하며 Sol의 `binding.parentRequestSha256`으로 Luna와 연결한다.
판정이 다르면 두 의견을 유지한다. Sol의 `clear`로 Luna의 결함 의심이나 기존 보행·접지 실패를 지우지 않는다.
Sol은 확률·보정 신뢰도를 제공하지 않으며 관찰 근거는 모델의 주장이다. 판단이 개선돼도 자동 승인하지 않는다.

요청 전 DB에 예약을 저장하고, 같은 작업·증거·설정은 결과를 재사용한다. 동시 요청의 상한 검사는 DB에서 직렬화한다.
타임아웃·통신 오류·잘못된 응답은 `unverified`, 처리 도중 서버가 종료되면 `request_started`로 남는다.
둘 다 자동 재호출하지 않는다. 호스트 응답이 유실된 경우 소유자의 보고서 조회로 서버 기록을 먼저 확인한다.
HTTP 오류 본문, 예외 문자열, 임의 제공자 메타데이터는 응답과 로그에 남기지 않는다.
제공자 제한은 Luna 25초, 후속 Sol 90초이며 호스트는 140초까지 기다린다. 임대 갱신은 계속한다.
Sol 예약 시에도 임대·호스트·단계·공통 한도를 다시 검사한다. 후속 실패나 한도 초과 시 Luna 결과는 보존한다.

## 배포와 확인

### 기존 결과물 비교

저장된 결과의 독립 정답·질문별 누락 검출·보류율 비교와 생성 없는 프레임 교환 실험은
[오프라인 평가 절차](ANIMATION-REVIEW-EVALUATION.md)를 따른다. 실제 API 호출 없이 실행하는 도구이며,
기존 0.8 기준이나 Luna→Sol 정책을 바꾸지 않는다. 합성 데모는 평가 코드 확인용이고 실제 정확도 근거가 아니다.

완료된 결과물은 운영자가 `af_decision_benchmark_cases`에 호스트, 설계 의도, 증거 해시·크기·시간 및 최대 1일 만료를 등록한 뒤 비교한다.
`POST /generation-worker/decision-benchmarks/{caseId}`는 기존 생성 워커 인증을 요구한다. 워커는 등록·질문 변경·임의 이미지 교체 권한이 없으며,
서버가 해시를 다시 계산해 등록된 전체 바인딩과 일치할 때만 같은 검수기를 호출한다. 생성 작업을 만들거나 기존 작업의 임대·상태를 바꾸지 않는다.
사례마다 한 번만 예약하며 결과 불명도 재호출하지 않는다. 일반 검수와 같은 원장과 24시간 호출 상한을 사용한다.
키는 계속 Edge Secrets에만 있다. 사례와 원장은 사용자 역할에 공개하지 않는다.
실제 cascade 점검은 동일 호스트·의도·증거를 가진 두 사례를 등록하고 첫 사례의
`intent.cascadeFollowupCaseId`에 두 번째 사례 ID를 넣는다. 모델 비교 설정과 함께 쓸 수 없다.
두 번째 사례도 한 번만 예약한다. 두 사례가 모두 유효해야 하며 완료 후 함께 만료시킨다.
비교 기준은 호출 전에 고정하고, 기존 판정과의 일치율을 독립 정답이 있는 정확도로 표현하지 않는다.
원본 PNG 대신 GIF만 남았다면 그 GIF의 픽셀·재생시간을 검수했다고 명시한다. 원본에 대한 검증으로 옮기지 않는다.
비용 추정에는 응답의 입력·캐시 읽기·캐시 쓰기 토큰을 구분하며, 과금 내역을 조회하지 않았다면 실제 청구 금액으로 단정하지 않는다.

#### Sol·Astra 비교

native 프레임의 Luna 기존/개선 paired 비교는 [동결 실험 절차](ANIMATION-REVIEW-EVALUATION.md#frozen-native-sequence-paired-experiment)를 따른다.
운영자가 `intent.sequenceBenchmark`에 `paired-native-v1`과 동결 계획 해시를 등록하면 한 호출에 기존 5개와 개선 5개 독립 질문을 보낸다.
개선 시간표·인접 전이·원본 마지막/첫 프레임 패널은 개선 질문 안에만 있고 기존 shared input은 변하지 않는다.
연구 전용으로 2–64 원본 프레임, 32 MiB 본문, 110초 제한을 허용하며 운영 16/12 프레임·8 MiB·25초는 유지한다.
메타데이터 16,000바이트 migration을 먼저 검토하고 같은 원장·상한·서버 키를 사용한다. Responses/cascade와 혼합하거나 결과 불명을 재시도하지 않는다.
팔별 시간·비용은 분리 측정할 수 없으며 실제 독립 정답과 동결 계획이 없는 모의 테스트는 성능 결과가 아니다.

운영자가 등록한 사례의 `intent.benchmarkReview`만 Responses 비교를 선택할 수 있다.
형식은 `{ "model": "gpt-6.1-sol", "questionNames": ["anatomy", "identity", "framing"] }`이며,
모델은 `gpt-6.1-sol` 또는 `gpt-6-astra`, 질문은 기존 단계의 질문 이름만 허용한다.
Sol은 그 단계의 전체 질문을 요구하고 Astra는 사전에 고른 어려운 항목만 받을 수 있다.
워커의 요청 본문에는 모델·질문·프롬프트를 추가할 수 없다. 이 수동 비교와 일반 생성의 Luna→Sol 경로는 별도다.

`api/responses-benchmark.mjs`는 같은 개발자 규칙, 질문, 선택지, 원본 이미지·순서·재생시간을 사용한다.
Responses 입력의 JSON은 같은 데이터를 텍스트로 직렬화한다. `medium`, Standard, 출력 최대 1,800토큰,
`store: false`, 도구 없음으로 고정한다. 답과 짧은 관찰 근거·프레임 번호를 엄격한 JSON으로 받고,
모델이 쓴 근거는 관찰의 확정 증거나 실행 지시로 취급하지 않는다.
Responses는 Decisions의 선택 확률을 제공하지 않으므로 확률을 만들거나 0.8 기준을 복제하지 않는다.
Luna의 원시 선택과 기준 적용 후 판정을 함께 비교하고 API·출력 형식 차이를 결과에 명시한다.

실험 전에 서버 검수 키에 Responses 쓰기 권한이 필요하다. 키 값은 계속 Supabase Secrets에만 두며,
실험만을 위해 임시로 확대한 권한은 완료 후 기존 범위로 되돌린다. 운영 cascade의 Responses 권한은 유지하며,
만료 연장·키 교체는 별도로 승인된 서버 자격증명 관리 절차를 따른다.
기존 서비스 전용 사례 등록, 이미지 바인딩, 공통 호출 상한과 한 번 예약 규칙을 그대로 사용한다.
110초 제공자 제한, 135초 호스트 제한 안에 완료되지 않거나 출력이 잘리면 미검증으로 보존하며 자동 재시도하지 않는다.
실행 후 사례를 만료시키고 기존 생성 작업·승인·등록 상태는 바꾸지 않는다.

### 운영 반영

1. `20261029015744_server_decisions_review.sql` 마이그레이션과 관련 테스트를 검토한다.
2. 마이그레이션을 적용한다. `ai-fighter`는 게임 저장소에서 `npm run fighter:edge -- plan`으로 변경 파일·대결 엔진·운영 버전을 확인한 뒤, 같은 옵션의 `npm run fighter:edge -- deploy --plan <id>`로만 배포한다. 이 제작 키트의 엔진 파일은 빈 어댑터이므로 Supabase CLI/MCP나 수제 번들로 직접 올리면 운영 엔진이 사라진다. 배포 후 release와 제공 엔진을 확인하며, 다른 세션이 먼저 배포했다면 새 plan을 검토한다.
3. 캐릭터 작업이 끝난 호스트에 새 생성기 파일을 설치한다. 기존 설치·self-update 파일 목록을 그대로 사용한다.
4. 서버 Secrets를 준비한 다음 비교 모드를 켠다. 끄려면 서버의 `ODDBOUT_DECISIONS_MODE`를 `off`로 바꾼다.
5. 실제 실행에서는 보고서의 `completed`, 요청 ID, 사용량을 확인한다. 모의 응답 테스트를 실제 API 검수 성공으로 보고하지 않는다.

공식 계약: [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions),
[Supabase 서버 Secrets](https://supabase.com/docs/guides/functions/secrets#production-secrets).
