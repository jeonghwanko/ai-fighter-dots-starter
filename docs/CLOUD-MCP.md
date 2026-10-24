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

## 사용 흐름

1. `get_fighter_spec`의 overview/schema/creation을 읽고 기존 제작·검토 규칙을 따른다.
2. 최종 등록 요청을 받은 실제 fighter.json을 `prepare_fighter_registration`에 파일로 전달한다.
3. 응답의 각 asset ID에 실제 WebP 파일을 `upload_fighter_asset`으로 전달한다.
4. 업로드가 끝나면 `submit_fighter_registration`, 이후 `get_fighter_submission`으로 확인한다.
5. `registered`만 등록 완료다. queued/validating을 완료라고 안내하지 않는다.

파일 인자는 OpenAI `fileParams`의 `download_url`, `file_id`를 사용한다.
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
