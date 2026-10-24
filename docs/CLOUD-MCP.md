# Dots 클라우드 등록 연결

사용자는 PC, 로컬 MCP, API 키 또는 터널을 설정할 필요가 없다.
Dots의 플러그인에서 ODDBOUT을 연결하고 Google 로그인과 연결 승인을 마치면,
대화의 실제 파일을 클라우드 서버가 받아 기존 등록 검증 파이프라인에 제출한다.

공개 서버 URL: `https://mcp.oddbout.com/mcp`

기존 개발 연결의 Supabase 함수 URL도 호환용으로 유지한다. 공개 심사에 제출한 주소는
위 ODDBOUT 도메인이며, 현재 심사 중이다.

개인 연결: ChatGPT → 플러그인 → 추가(+) → 사용자 지정 MCP 서버 추가.
이름 `ODDBOUT`, 위 서버 URL, 인증 `OAuth`를 선택한다. 클라이언트 ID/Secret은
직접 넣지 않는다. 서버가 동적 클라이언트 등록과 PKCE를 지원한다.
Google로 로그인한 뒤 `연결 승인하고 Dots로 돌아가기`를 누른다.
공개 플러그인 디렉터리 등록은 별도의 OpenAI 심사 절차이며 서버 배포와 다르다.

연결 후 대화 입력창에서 `@ODDBOUT`을 입력하고 **플러그인 항목을 선택**한다.
일반 텍스트로 이름만 입력한 것과 실제 플러그인 선택은 다르다.
기존 도구 목록이 남아 있으면 설정 → 플러그인 → ODDBOUT → `도구 새로 고침`을 누른다.
세부 정보 → 앱에서 읽기 6개·쓰기 5개, 총 11개 도구와 `check_creation_readiness`,
`prepare_fighter_deletion`, `delete_fighter`가 보이는지 확인한다.
공식 갱신 안내는 새 대화에서 재확인을 권장한다. 기존 대화는 최신 플러그인을 다시 선택해
실제 도구 노출 여부를 확인하며, 목록 갱신을 위해 재로그인·권한 확대·PC 설치를 요구하지 않는다.

## 사용 흐름

1. `get_fighter_spec`의 overview/schema/creation을 읽고 기존 제작·검토 규칙을 따른다.
   첫 생성 전·작업 공간 재시작 뒤·등록 전에는 이 클라우드 커넥터의 `check_creation_readiness`를 호출한다.
   등록 계정 접근과 실제 생성·전달·패키지 검토 상태를 구분하며 로컬 stdio 로그인은 요구하지 않는다.
2. 최종 등록 요청을 받은 실제 fighter.json을 `prepare_fighter_registration`에 파일로 전달한다.
3. 응답의 각 asset ID에 실제 WebP 파일을 `upload_fighter_asset`으로 전달한다.
4. 업로드가 끝나면 `submit_fighter_registration`, 이후 `get_fighter_submission`으로 확인한다.
5. `registered`만 등록 완료다. queued/validating을 완료라고 안내하지 않는다.

### 실제 파일과 연결 계정 확인

- 등록 직전에 `get_profile`의 ID/이메일이 사용자가 선택한 계정인지 확인한다.
  다른 계정을 추가해도 기존 기본 연결이 자동 전환되는 것은 아니다. 계정 변경 후
  기존 턴의 도구가 `Unknown tool`을 반환하면 최신 플러그인을 선택한 새 턴에서 확인한다.
  운영자 연결을 임의로 해제하지 않는다.
- 현재 VM에 파일이 있으면 네이티브 파일 인자에 그 절대 경로를 전달한다. 호스트가
  실제 파일 업로드와 서명 URL 전달을 수행하므로 VM의 등록 서버 직접 접속은 필요하지 않다.
- Library/Page의 기존 파일은 호스트의 공식 materialization 경로를 먼저 사용한다.
  해당 기능이 제공되지 않으면 지원되는 원본 파일 읽기를 사용하되, 실제 반환 바이트를
  저장하고 원본 크기·SHA-256을 모두 비교한다. Pages `read_page_reference`의 JSON 원문과
  `image/webp` 원본 이미지 응답으로 이 경로를 확인했다. 변환된 화면 미리보기는 사용할 수 없다.
- 파일 전달 실패는 재생성 사유가 아니다. 저장된 파일과 제출 상태를 먼저 회수한다.
  임의 파일 ID/URL, 수기로 복사한 base64, 토큰 공유, 네트워크 정책 우회는 사용하지 않는다.
- VM의 Supabase 직접 GET이 차단돼도 네이티브 MCP까지 실패했다고 결론 내리지 않는다.
  실제 네이티브 계정 호출과 실제 파일 인자 전달 결과를 각각 확인한다.

파일 인자는 OpenAI `fileParams`의 `download_url`, `file_id`를 사용한다.
호스트가 이 인자를 파일 경로 형식으로 노출하면 실제 파일의 절대 경로를 전달한다.
호스트가 업로드와 서명 URL 발급을 담당하므로 에이전트가 URL이나 파일 ID를 만들지 않는다.
로컬 경로, 임의 외부 URL, 사용자 토큰을 대화에 요구하지 않는다.
동일한 패키지 재시도는 동일 UUID, 패키지 바이트 변경은 새 UUID를 사용한다.
서버는 기존 패키지를 덮어쓰지 않으며 소유자·크기·해시·유효기간을 검사한다.

등록 연결은 이미지 생성 구독/계정이나 VM 네트워크 허용을 대신하지 않는다.
실제 생성·대화 내 미리보기·사용자 검토·최종 패키징은 각각 확인해야 한다.
이 연결을 이유로 신규 생성, 제공자 변경, 검토 생략을 자동 승인하지 않는다.

## 운영 설정과 배포

### 본인 소유 캐릭터 삭제

1. 사용자의 명시적인 삭제 요청을 받고 `get_profile`·`list_my_fighters`로 소유 계정과 정확한 대상을 확인한다.
2. `prepare_fighter_deletion(fighterId)`로 계정·캐릭터 이름·삭제 범위·10분 유효 확인값을 받는다.
   이 호출만으로 삭제하지 않는다. 반환된 대상과 범위를 사용자에게 보여 준다.
3. 사용자가 그 계정·대상의 삭제를 명시적으로 지시했을 때만 반환된 `confirmationToken`,
   정확한 `confirmName`, `confirm: true`로 `delete_fighter`를 실행한다.
   기존 지시가 같은 대상과 범위에 명확히 해당하면 같은 확인을 반복해서 요구하지 않는다.
4. 삭제 영수증의 `stage: deleted`, 대상 조회 결과와 내 목록에서의 제외를 확인한다.

서버는 이메일이나 owner ID 입력을 받지 않고 서명된 OAuth 소유자·세션·클라이언트를 사용한다.
두 단계 모두 살아 있는 세션/동의를 검사하며 실행 시 소유권, 이름, 만료, 패키지·프로필 버전을
트랜잭션 안에서 다시 검사한다. 세션 변경·이름 불일치·확인 후 수정은 거부한다.
같은 확인값의 성공 재시도는 원래 영수증을 반환한다. 새 확인값으로 무작정 재시도하지 않는다.

삭제는 내 목록·공개 로스터·세계관 캐릭터 카드·랭킹에서 제거하고 새 대전을 막으며 계정 슬롯을 반환한다.
비공개 원본 패키지와 제출·경기·감사 기록은 보존한다. 파일 완전 삭제라고 안내하지 않는다.
이미 발급된 공개 에셋 링크는 최대 600초 안에 만료된다. 기존 패키지는 덮어쓰지 않으며
일반 업데이트나 진행 중이던 검증이 삭제된 캐릭터를 되살릴 수 없다.
DB RPC/확인 기록은 service_role 전용이고, 일반 사용자와 MCP 토큰은 직접 실행/조회할 수 없다.
삭제 migration은 `20261024104406_ai_fighter_owner_deletion.sql`이다.

검증: `node --test test/fighter-deletion.test.mjs test/cloud-mcp.test.mjs test/api.test.mjs test/database.test.mjs`.
`scripts/run-cloud-review-checks.mjs`의 `ODDBOUT_REVIEW_CHECK_DELETION=1`은 기존 심사 캐릭터를
삭제하지 않고 준비·잘못된 토큰·이름·다른 소유자 차단을 점검한다. 시험 OAuth grant는 종료 시 철회한다.

### 서버와 승인 페이지

- Supabase 프로젝트 `ztfxxhtmtrvxvuxlqmgz`, 함수 `ai-fighter-mcp`.
- `verify_jwt=false`는 공개 MCP discovery를 위한 설정이다. 비공개 도구는 함수가
  서명/issuer/audience/만료/전용 권한 및 OAuth 세션·동의 철회를 직접 검증한다.
- Auth → OAuth Server: enabled, authorization path `/connect.html`, dynamic registration enabled.
- Auth → URL Configuration: Site URL `https://oddbout.com`, Redirect URLs에
  `https://oddbout.com/connect.html**` 추가. 기존 다른 URL은 보존한다.
- Auth → Hooks → Custom Access Token: `public.af_mcp_access_token_hook`.
  일반 로그인은 그대로 유지하고 OAuth client 토큰만 전용 audience와 `af_mcp` role로 제한한다.
  이 role은 Postgres에 생성하지 않는다. 일반 API도 OAuth 토큰을 거부한다.
- migration `20261024053500_ai_fighter_cloud_mcp_oauth.sql`을 먼저 적용한다.
- Deno: `npx deno@2.7.5 check --config supabase/functions/ai-fighter-mcp/deno.json supabase/functions/ai-fighter-mcp/index.ts`.
- `scripts/edge-bundle.mjs`의 `edgeFiles`에 새 함수의 entry/importMap/lock을 넘겨 배포 파일을 수집한다.
- 승인 페이지 소스: `web/cloud-connect/`. `scripts/build-cloud-connect.mjs <site-dir>`가
  페이지와 고정 버전 Supabase 브라우저 SDK를 복사한다. 전체 사이트 빌드에도 포함된다.
- OAuth 비활성화와 hook 비활성화는 함께 검토한다. 서버를 사용하는 동안 hook만 제거하면
  OAuth 토큰이 일반 DB 권한을 상속하므로 금지한다.

검증: `node --test test/cloud-mcp.test.mjs test/api.test.mjs test/database.test.mjs`.
실제 Google 사용자 로그인, 연결 토큰과 파일 전달은 호스트에서 별도로 검증한다.
성공한 MCP discovery만으로 실제 사용자 로그인/등록 성공을 주장하지 않는다.

## 배포 검증 기록 — 2026-10-24

- OAuth 로그인·승인 뒤 Dots에서 네이티브 `get_profile`, `list_my_fighters` 성공.
- 네이티브 `check_creation_readiness`는 `canSubmit: true`, `registration.status: ready`,
  `requiresPc: false` 반환. 생성·화면 표시·패키지 검토는 별도로 unverified를 유지한다.
- 기존 미미는 최초 연결 때의 8개 도구 목록을 유지했다. 도구 새로 고침과 승인된
  공식 재부팅 후 미미 대화에서도 준비 점검 도구의 실제 호출 및 ready 응답을 확인했다.
- 클라우드 VM에서 정확히 `{}`인 2바이트 시험 파일을 호스트 파일 입력으로 전달했다.
  `prepare_fighter_registration`이 서버 검증에 도달해 `invalid-manifest` 및 필수 필드 누락으로
  거절했다. 임의 URL·토큰 복사·VM의 직접 API 통신 없이 파일 전달이 확인됐다.
- 최초 연결 시험에서는 실제 캐릭터를 신규 생성하거나 공개 등록하지 않았다.
  이후 사용자 승인으로 실시한 실제 패키지 전체 시험은 아래 기록을 따른다.
- 연결한 앱은 개인 개발 플러그인이다. 일반 사용자용 공개 디렉터리 심사·배포는 별도다.

## 실제 파일 등록 검증 — 2026-10-24

- 심사 전용 일반 계정으로 Dots의 네이티브 `get_profile`·준비 점검을 실행했다.
- 기존 승인된 레드글러브 냥의 11개 WebP(5,537,184바이트)를 사용했다. 원본과 Library 전달
  파일의 크기·SHA-256을 비교했고, 전체 디코드 검사를 통과했다. 새 그림은 생성하지 않았다.
- VM의 Supabase 직접 다운로드는 정책으로 차단됐다. 비공개 Pages/Library의 원본 바이트
  읽기로 파일을 회수했다. VM 네트워크 정책과 인증·등록 검증은 변경하지 않았다.
- 테스트용 이름·설명·localId만 별도 manifest에서 변경하고, 이미지는 그대로 유지했다.
  실제 네이티브 파일 인자로 prepare → 11개 upload → submit을 실행했다.
- 제출 ID: `131d7814-2c24-4a82-9707-1ebff7978f67`.
- 등록 ID: `1c6160e0-a138-4e25-8b95-db023b8cc408` (`ODDBOUT Review Test`).
- manifest SHA-256: `0cd5eb8c721da8bdbe8f4f0d24700abd3ee82626451600012d32ca7d0968b83a`.
- 최종 상태: `registered`, `approved`, `runtimeApproved: true`, `arena-player-v1`.
  공개 `https://mcp.oddbout.com/mcp`에서도 동일 ID/해시를 일반 심사 계정 OAuth로 조회했다.
  교차 확인 7건이 통과했고 그 확인용 임시 OAuth grant는 철회했다.
- 파일 회수·계정 확인 안내를 MCP 함수 v7에 배포하고 공개 주소의 실제 응답을 확인했다.
  관련 MCP/게이트웨이 테스트 10건이 통과했다. CI는 실행하지 않았다.
- 기존 로그인 세션에 승인 이력이 있으면 다른 계정 연결 요청도 즉시 이전 계정으로
  돌아가던 문제를 수정했다. EN/KR 계정 선택 화면에서 이메일과 계속/다른 계정 사용을
  먼저 표시한다. 계정 전환은 해당 브라우저 세션만 로그아웃하고 연결 요청을 보존한다.
  계정 선택·전환·실패 처리·이메일 로그인 테스트 4건이 통과했다.
- 전체 게임 배포가 심사 증빙 파일을 제거하지 않도록 공개 가능한 기록·동영상·이미지·폰트를
  `website/cloud-plugin/review-20261024/`에 보관하고 표준 사이트 빌드에 포함했다.
  빈 디렉터리에서 배포를 재구성하는 회귀 테스트 1건이 통과했다.
- 테스트 뒤 운영자 Google 연결을 복구하고 임시 심사 계정 연결을 해제했다.
  연결 교체 직후 Dots 호출은 `Unknown tool`을 반환했다. 도구 새로 고침만으로는
  복구되지 않았고, 대기 중인 클라우드 작업을 확인한 뒤 사용자가 승인한 공식 미미
  재부팅으로 해결됐다. 이후 네이티브 프로필·기존 캐릭터 3개·등록 준비 ready를 확인했다.
  이 오류는 등록 서버의 인증 거절과 구분한다. 이미 연결한 계정을 반복 삭제하거나
  새 캐릭터 제출로 점검하지 말고 호스트의 도구 갱신·공식 재시작 경로를 사용한다.

이는 기존 승인 패키지의 전달·등록 검증이다. 새로운 생성 모델의 능력이나 신규 작품의
시각 품질을 검증한 결과로 해석하지 않는다. 공개 플러그인 심사 상태와 별개다.

### 본인 확인·삭제 확인 실사용 검증 — 2026-10-24

- MCP 함수 v8, 등록 API v30 및 삭제 migration을 배포했다. 운영 번들 14개/16개 파일을
  회수해 검증한 배포 입력과 일치함을 확인했다. 기존 API 게임 엔진은 그대로 보존했다.
- 관련 로컬 테스트 32개와 심사 전용 계정의 공개 MCP 점검 11개가 통과했다.
  다른 소유자·잘못된 확인 토큰·이름은 실제 서버에서 거부됐고 심사 캐릭터는 유지했다.
  일반 사용자/익명 역할의 삭제 RPC 실행 권한은 없으며 추가 보안 경고가 발생하지 않았다.
- 도구 갱신 후 앱 상세에는 11개가 보였지만 미미 실행 환경에는 9개가 남았다.
  클라우드 작업 대기 상태를 확인하고 승인된 공식 재부팅 후 네이티브 11개를 확인했다.
- 사용자가 요청한 `레드글러브 냥` / `Redglove Nyang`,
  `08e1b3f9-e31e-4c19-b42a-8ec8243d2ade`의 소유 계정과 준비 응답을 확인하고
  **네이티브 MCP `delete_fighter`**로 삭제했다. 관리자 SQL로 대신 삭제하지 않았다.
  삭제 시각 `2026-10-24T11:21:15.715123+00:00`, 후속 조회 `stage: deleted`.
- 내 목록에는 꿈돌이·꿈순이만 남았다. 두 캐릭터의 전체 DB 행은 삭제 전후 동일했다.
  삭제 대상의 공개 로스터 상세는 HTTP 404이고 공개 랭킹에서도 제외됐다.
  비공개 원본·경기 기록 보존과 슬롯 반환을 삭제 영수증에서 확인했다.
- EN/KR 연결·개인정보·약관·지원 안내를 갱신하고 공개 배포 파일 9개의 바이트 일치를 확인했다.
  기능 구현 커밋 `0cf776dd15f49102c76e6c9ad2dedf12236b6561`,
  사이트 커밋 `c2045a9`, buildId `77c17e7f-6a43-4d9c-8904-e485186f2b68`.
  공개 플러그인 심사 제출은 취소·재생성하지 않았고 CI를 실행하지 않았다.
