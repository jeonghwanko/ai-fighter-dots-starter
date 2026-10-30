# 가입 후 바로 이용하기

Google 로그인 → Dot에서 제작 → 업로드 → 자동 파일 검사 → 등록(제작 중) → 주인의 동작 확인 → 출전 순서다.
제작 중인 선수는 주인이 미리보기·아레나 연습으로 확인한다. 출전한 선수만 공개 명단·랭크 대결·컵·스파링과 그 순위에 나온다(주소를 아는 사람은 프로필을 볼 수 있다).
베타 초대, 신청 심사, 별도 게임 사용 승인은 필요하지 않다. 과거 초대 거절·만료도 가입과 업로드를 막지 않는다.

ODDBOUT 통합 플러그인은 연결된 Google 계정을 PC와 Dots 등록에 공통으로 사용한다.
`get_profile`과 클라우드 `check_creation_readiness`로 확인하며 작업 공간의 별도 로그인을 요구하지 않는다.
예전 독립 CLI만 `deploy/creator-site.json`의 `apiBase` origin과 `publishableKey`로 로그인한다.
생성은 사용자 자신의 생성 계정으로 PC 또는 사용자별 Dots 작업 공간에서 진행한다.
추가 비용이나 제공자 변경은 먼저 확인한다. [통합 플러그인 안내](ODDBOUT-PLUGIN.md)를 참고한다.

파일 형식·해시·용량·전체 WebP 디코딩 검사는 계속 수행한다. 실패한 파일은 오류를 고쳐 다시 제출한다.
`registered`, `fighterId`, `runtimeApproved: true`를 확인하고 홈페이지에서 실제 애니메이션을 확인한다.
등록한 선수는 **제작 중**이다. 선수 페이지의 "모든 동작"에서 필수 동작 11개를 하나씩 재생해 확인 표시를 하면 **출전**할 수 있다.
서버는 확인한 패키지 해시와 동작을 기록한다. 새 패키지로 바꾸면 다시 제작 중이 된다. 이름·소개·싸우는 성격 수정은 출전을 유지한다.

- API: `POST /fighters/:id/entry` `{ "expectedManifestSha256": "현재 해시", "reviewedClips": [필수 동작 11개] }`, `DELETE`는 출전 취소.
  같은 요청을 반복해도 같은 답이라 멱등 키가 필요 없다. `/spec`의 `registration.fighterEntry: "v1"`이 지원 여부다.
- MCP: `enter_fighter`·`withdraw_fighter`(에이전트 도구). 사용자에게 동작을 보여주고 요청을 받은 뒤에만 부른다.
- 기존 선수(2026-10-30 마이그레이션): 전적(완료된 랭크 대결 또는 컵 경기)이 있는 선수는 출전, 없는 선수는 제작 중으로 옮겼다.
- 원천: [출전 마이그레이션](../supabase/migrations/20261030130000_ai_fighter_entry.sql), [출전 API](../api/fighter-entry.mjs).
작업자가 잠든 경우 자동 검사에 시간이 걸릴 수 있다. 수동 승인 대기라고 안내하지 않는다.

## 사후 조치

관리자는 `admin.html`의 선수 관리에서 부적절한 선수를 내리거나 복원한다. 사유 입력은 필수다.
조치 사유는 제작자에게 표시하고, 실행 관리자·대상·시각·버전을 별도 감사 기록에 남긴다.
내려진 선수는 공개 목록, 신규 파일 전달, 새 대결에서 제외한다. 기존 등록 기록과 전적은 보존한다.
이미 다운로드한 파일이나 발급된 서명 URL은 회수할 수 없다. 서명 URL은 최대 10분 뒤 만료된다.
복원은 서버 검사를 통과한 동일 불변 패키지에만 허용한다. 일반 사용자는 상태를 직접 바꿀 수 없다.

## 기술 호환과 무료 운영 한도

- `GET /me`: `accessMode: "open"`, `canSubmit: true`. 기존 `invited` 필드는 같은 이용 가능 상태의 호환 별칭이다.
- `POST /access-requests`: 과거 클라이언트 호환용 계정 상태 응답. 새 초대 요청을 만들지 않는다.
- 과거 초대 심사 API는 410 `registration-open`으로 종료한다. 과거 심사 기록은 보존한다.
- 내부 `runtime_approved`, `duel_approved`, `review_state`는 기술적 이용 가능 상태와 사후 조치를 표현한다.
  이 이름은 사람의 심사를 뜻하지 않는다. 이용 가능 근거는 `open-registration` 정책과 서버 검사 결과이며, 다른 사람에게 나오는 것은 주인의 출전(`entered_at`)이다.
- 로그인 확인, 소유권, RLS, 불변 파일, 요청 속도·파일 용량·저장소 한도는 유지한다.
  신규 등록 시도는 계정당 최근 24시간에 5회다. 반려·삭제된 시도도 그 하루 안에서는 센다. 기존 선수의 수정은 이 횟수에 포함하지 않는다.
  파일 합계 10 MB와 전체 예약 저장소 100 MB 한도, 계정당 선수 한도(기본 3명, 계정별 `af_creators.fighter_limit`)는 유지한다.
  이미지와 소개만 먼저 공개하는 `profile` 상태도 같은 선수 한도에 포함된다. 서비스 전용
  `af_register_character_profile`로 등록하며, 전투 승인·패키지 해시·검증 제출을 만들지 않는다.
  공개 목록은 RLS와 열 권한이 적용된 `af_public_character_profiles` 뷰로 읽는다.
  전투 동작을 완성하면 같은 선수 ID를 지정해 기존 패키지 검증 절차를 통과한다.
  이때 `registered`로 전환되며 세계관 연결과 계정 슬롯은 유지된다.
  이는 사전 심사 제도가 아니며 비용을 제한하는 기술적 상한이다.

운영 변경은 [공개 이용 마이그레이션](../supabase/migrations/20261021092001_ai_fighter_open_registration.sql),
[계정 API](../api/account.mjs), [관리자 API](../api/admin.mjs)가 소유한다.

## 등록한 선수 수정

제작자 페이지의 선수 상세 화면에서 이름과 소개를 저장할 수 있다. 그림을 다시 올리지 않는다.
제작 도구에서는 `get_registered_fighter`로 현재 버전을 읽고 `update_fighter_profile`을 호출한다.
이 경로는 로컬 패키지나 이미지 파일이 없어도 동작한다. 이름·언어별 이름·소개·언어·컨셉·기술 설명·경기 대사만 바꿀 수 있다.
언어별 이름(`names`)과 경기 대사(`lines`)는 `null`을 보내면 지운다. 서버 `/spec`에 각각 `profile-names-1`·`profile-lines-1`이 있어야 한다.
그림·애니메이션·능력치·싸우는 성격 수정은 기존 `submit_fighter_package(fighterId)` 검증 경로를 사용한다.

- API: `PATCH /fighters/:id/profile`, 인증 헤더와 UUID `Idempotency-Key`가 필요하다.
- 본문: `{ "expectedManifestSha256": "현재 해시", "profile": { "name": "새 이름" } }`. 생략한 필드는 유지한다.
- 같은 요청의 재시도에는 본문과 키를 유지한다. `fighter-changed`이면 최신 프로필을 읽고 변경을 다시 확인한다.
- 새 불변 매니페스트와 승인 해시를 한 트랜잭션으로 저장한다. 선수 ID·생성일·전적·이전 매니페스트는 보존한다.
- `asset_source_submission`은 실제 파일이 저장된 원래 제출을 참조한다. 원본 파일·행은 참조가 남아 있는 동안 보존한다.
- 소유권·요청 속도·계정 제한·서비스 일시 중지·사후 조치·진행 중 업로드 검사는 계속 적용한다.

변경의 소유자는 [프로필 수정 마이그레이션](../supabase/migrations/20261024022222_ai_fighter_profile_edits.sql)
(수정 가능한 키는 [경기 대사 마이그레이션](../supabase/migrations/20261027130000_ai_fighter_profile_lines.sql)이 마지막으로 정한다)과
[프로필 API](../api/fighter-profile.mjs)다. API의 `registration.profileUpdate: "v1"`은 지원 여부를 표시한다.
마이그레이션을 먼저 적용하고 API를 갱신한 뒤 제작자 페이지·MCP 도구를 공개한다. 로컬 검증은 배포가 아니다.
