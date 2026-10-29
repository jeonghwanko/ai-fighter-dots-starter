# 서버 Decisions 보조 검수

호스팅 제작의 검수는 `생성 호스트 → ODDBOUT API → OpenAI Decisions`로 연결된다.
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

현재 연결은 호스팅 작업용이다. 일반 PC/VM의 독립 제작 세션은 서버 작업 임대가 없으므로 이 API를 호출할 수 없다.
엔진의 독립 `review-decisions` 명령은 별도 연구 도구로 남지만, 호스팅 흐름에서 실행하거나 키 설정에 사용하지 않는다.

## 서버 설정

운영자가 **Supabase Dashboard → 해당 프로젝트 → Edge Functions → Secrets**에서 관리한다.
키 값은 채팅·셸 인자·문서·`.env` 파일에 쓰지 않는다. 이 기능을 켜기 위해 로컬에 키 파일을 만들 필요가 없다.

| 서버 Secret 이름 | 용도 |
| --- | --- |
| `ODDBOUT_DECISIONS_API_KEY` | 검수 전용 OpenAI 프로젝트의 제한된 API 키. Decisions 호출 권한만 부여하고 서버에서 교체·폐기한다. |
| `ODDBOUT_DECISIONS_MODE` | `shadow`일 때만 활성화. 없거나 다른 값이면 비활성화한다. |

키와 `shadow` 설정이 모두 있어야 워커의 작업 응답에 `decisionsReview.mode: "shadow"`가 들어간다.
기존 `OPENAI_API_KEY`, 사용자 Codex/Grok 로그인, ODDBOUT 워커 키를 OpenAI 인증으로 전용하지 않는다.
API 비용은 이 키의 OpenAI 프로젝트에 청구된다. Codex 앱 크레딧과 별개다.
Supabase의 Secrets는 프로젝트 Edge 실행 환경에 제공되므로, 같은 프로젝트의 다른 서버 함수도 신뢰 경계에 포함된다.

서버 기본 상한은 최근 24시간 **50회**, 작업당 **20회**다. `af_decision_review_limits`에서 운영자가 조정한다.
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

요청 전 DB에 예약을 저장하고, 같은 작업·증거·설정은 결과를 재사용한다. 동시 요청의 상한 검사는 DB에서 직렬화한다.
타임아웃·통신 오류·잘못된 응답은 `unverified`, 처리 도중 서버가 종료되면 `request_started`로 남는다.
둘 다 자동 재호출하지 않는다. 호스트 응답이 유실된 경우 소유자의 보고서 조회로 서버 기록을 먼저 확인한다.
HTTP 오류 본문, 예외 문자열, 임의 제공자 메타데이터는 응답과 로그에 남기지 않는다.

## 배포와 확인

1. `20261029015744_server_decisions_review.sql` 마이그레이션과 관련 테스트를 검토한다.
2. 마이그레이션을 적용하고 `ai-fighter` Edge Function을 배포한다. 기존 서버 배포 소스와 비교해 다른 변경을 덮어쓰지 않는다.
3. 캐릭터 작업이 끝난 호스트에 새 생성기 파일을 설치한다. 기존 설치·self-update 파일 목록을 그대로 사용한다.
4. 서버 Secrets를 준비한 다음 비교 모드를 켠다. 끄려면 서버의 `ODDBOUT_DECISIONS_MODE`를 `off`로 바꾼다.
5. 실제 실행에서는 보고서의 `completed`, 요청 ID, 사용량을 확인한다. 모의 응답 테스트를 실제 API 검수 성공으로 보고하지 않는다.

공식 계약: [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions),
[Supabase 서버 Secrets](https://supabase.com/docs/guides/functions/secrets#production-secrets).
