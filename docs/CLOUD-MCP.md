# Dots 클라우드 등록 연결

사용자는 PC, 로컬 MCP, API 키 또는 터널을 설정할 필요가 없다.
Dots의 플러그인에서 ODDBOUT을 연결하고 Google 로그인과 연결 승인을 마치면,
대화의 실제 파일을 클라우드 서버가 받아 기존 등록 검증 파이프라인에 제출한다.

서버 URL: `https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp`

개인 연결: ChatGPT → 플러그인 → 추가(+) → 사용자 지정 MCP 서버 추가.
이름 `ODDBOUT`, 위 서버 URL, 인증 `OAuth`를 선택한다. 클라이언트 ID/Secret은
직접 넣지 않는다. 서버가 동적 클라이언트 등록과 PKCE를 지원한다.
Google로 로그인한 뒤 `연결 승인하고 Dots로 돌아가기`를 누른다.
공개 플러그인 디렉터리 등록은 별도의 OpenAI 심사 절차이며 서버 배포와 다르다.

연결 후 대화 입력창에서 `@ODDBOUT`을 입력하고 **플러그인 항목을 선택**한다.
일반 텍스트로 이름만 입력한 것과 실제 플러그인 선택은 다르다.
기존 도구 목록이 남아 있으면 설정 → 플러그인 → ODDBOUT → `도구 새로 고침`을 누른다.
세부 정보 → 앱에서 읽기 6개·쓰기 3개, 총 9개 도구와 `check_creation_readiness`가 보이는지 확인한다.
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
- 실제 캐릭터를 신규 생성하거나 공개 등록하지 않았다. 완성된 실제 패키지의
  업로드 → submit → registered 전체 검증은 이 시험의 결과에 포함하지 않는다.
- 연결한 앱은 개인 개발 플러그인이다. 일반 사용자용 공개 디렉터리 심사·배포는 별도다.
