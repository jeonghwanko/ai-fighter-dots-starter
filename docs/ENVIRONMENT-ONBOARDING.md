# Dots 제작 환경 연결

첫 구현은 **GPT 외형 제작의 계정 연결**이다. 새 캐릭터 생성이나 기존 작품 재생성 권한을
부여하지 않는다. 외형을 현재 대화에서 직접 생성·표시할 수 있으면 `DELIVERY.md`의 직접 경로를
먼저 확인한다. 그 경로에 VM 설치나 별도 CLI 로그인을 강제하지 않는다.

## 사용자 흐름

1. 캐릭터 설명/참고 이미지를 먼저 받는다. 기존 제작이면 선택한 버전과 작업 기록부터 복원한다.
2. `get_creation_environment`로 연결 상태를 읽는다. 없으면 현재 단계에 필요한 본인 계정만 묻는다.
   GPT / Grok / 둘 다 선택과 이미지·영상 기능 확인은 별도 사실이다. 이미 받은 답은 다시 묻지 않는다.
3. `update_creation_environment`의 `configure`로 사용자의 실제 선택·발언을 기록한다.
4. 반환된 `plan`의 목적·도메인·환경 범위를 보여주고 호스트의 네트워크 승인 절차를 이용한다.
   그 절차에서 받은 승인이 같은 목록/범위에 해당하면 다시 승인받지 않고 `approve-network`로 기록한다.
   사용자의 발언이나 호스트 승인 결과가 없으면 승인 기록을 만들지 않는다.
5. 호스트의 실제 적용 결과를 확인하고 `report-host-network`에 근거를 기록한다.
   이어 `check-network`로 bootstrap 주소의 HTTPS 도달 여부를 검사한다.
6. 계정 연결 요청 범위에서 `prepare_generation_login`을 호출하고 반환된 `execution`의 명령·인자·cwd를
   그대로 호스트 실행 도구로 실행한다. `awaiting-user`의 공개 로그인 링크와 확인 코드만 보여준다.
   사용자가 공식 제공자 페이지에서 로그인하면 실행이 끝나고 `get_creation_environment`로 상태를 다시 읽는다.
7. 생성·원본 전달·현재 대화의 미리보기 사전 조건을 별도로 확인한다. 실제 요청한 첫 시안으로 생성과 표시를 확인한다.
   로그인 검사나 네트워크 검사 때문에 새 테스트 이미지를 생성하지 않는다.

명령은 `creation:tool`로도 사용 가능하다. 인자를 JSON 파일로 작성하고 실행한다.

```sh
npm run creation:tool -- call <absolute-workspace> get_creation_environment
npm run creation:tool -- call <absolute-workspace> update_creation_environment <arguments.json>
npm run creation:tool -- call <absolute-workspace> prepare_generation_login
```

최초 configure 인자 예시(값은 실제 사용자 답으로 채운다):

```json
{
  "expectedRevision": 0,
  "change": {
    "type": "configure",
    "account": "gpt",
    "host": "dots",
    "conversationId": "current-conversation-id",
    "confirmedAccess": ["gpt-image"],
    "feedback": "사용자가 실제로 말한 계정 연결 요청과 이미지 접근 확인"
  }
}
```

`confirmedAccess`는 아직 확인하지 못했으면 빈 배열이다. 계정 선택으로 채우지 않는다.
모든 변경은 최신 `revision`을 `expectedRevision`으로 사용한다. 충돌하면 다시 읽고 의도를 재평가한다.
새 대화에서는 configure로 실제 conversationId와 기존 선택을 이어받고 전달 사전 조건을 갱신한다.

## 상태의 의미

| 항목 | 확인하는 것 | 확인하지 않는 것 |
| --- | --- | --- |
| 계정 선택 | 사용자가 요청한 제공자와 개별 기능 확인 | 로그인·잔여 한도 |
| generation | 같은 실행 환경의 공식 `codex login status` 결과 | 이미지 백엔드·사용자 동일성·이미지 생성 성공 |
| network.approved | 표시한 planHash에 대한 승인 기록 | 방화벽 변경 |
| network.application | 15분 이내 호스트 적용 관찰 기록 | 도구가 직접 검증한 권한 증명 |
| network.reachability | 승인/적용 기록 뒤 수행한 HEAD 응답 | 생성 API 권한·모든 다운로드/CDN·브라우저/커넥터 네트워크 |
| delivery | 현재 환경/대화에 묶인 전달 사전 조건 기록 | 실제 파일 업로드·대화 표시 |

`readyForWorkflow`는 기존의 설치/선택 준비 상태다. `readyForGeneration`은 여기에 환경의 사전 조건 기록이
충족되어야 true다. 어느 값도 생성 요청, 성공, 검수, 사용자 선택의 대체물이 아니다.
현재 adapter는 GPT 외형만 준비한다. Grok 또는 GPT+Grok 선택은 보존하지만 Grok 로그인을 자동 실행하지 않는다.
이후 영상 단계는 기존 sprite-gen workflow에서 별도로 확인하며, GPT로 조용히 대체하지 않는다.

`delivery` 변경은 workspace-relative JSON 경로를 받는다. 기존 `delivery-check.json`의 `environment`에는
반환된 environmentId, `conversationId`에는 현재 대화 ID를 쓴다. 파일 내용 해시가 바뀌거나 다른 대화이면
다시 확인한다. 사전 조건의 근거는 실제 호스트/도구 관찰에서 기록한다.

## 프로필과 웹 배포

`deploy/creation-environments.json`은 버전이 있는 선언적 bootstrap 목록이다. 현재 GPT 인증·요청 주소만 포함한다.
실제 생성 결과 CDN과 Dots 전달 경로는 미검증 항목으로 명시한다. 완전한 운영 allowlist로 취급하지 않는다.
설치용 주소나 다른 제공자 주소를 무조건 더하지 않으며, 미확인 도메인을 오류 메시지에서 자동 승인하지 않는다.

사이트 빌드는 공개 `/creation-environments/v1.json`을 산출물에 넣는다. 개인 환경 ID·승인·인증 정보는 포함하지 않는다.
`refresh-profile`은 설정된 공개 사이트의 고정 경로만 읽고 redirect를 거부한다. 읽기 실패는 기존 기록을 보존한다.

- 번들과 동일한 프로필은 정규화된 콘텐츠 SHA-256으로 확인한다. 첫 접속에도 번들 목록을 쓸 수 있다.
- 변경된 원격 콘텐츠는 `deploy/creation-environment-trust.json`에 **별도 설치된** Ed25519 공개 키가 있어야 한다.
  기본 키 목록은 비어 있으므로 변경된 원격 목록은 거부한다. 배포 담당자가 키를 준비하기 전에는 서명 업데이트가 활성화되지 않는다.
- envelope는 `{ "profile": ..., "keyId": ..., "signature": "base64" }`다. 서명 대상은 `canonical(profile)`의 UTF-8 바이트다.
  비밀 키는 이 저장소·플러그인·공개 웹사이트에 넣지 않는다. 키 배포와 서명은 릴리스 운영에서 수행한다.
- revision 감소, 같은 revision의 다른 내용, 알 수 없는 필드, wildcard·IP·내부 호스트는 거부한다.
- 새 내용은 기존 승인/호스트 적용/접속/전달 기록을 무효화한다. 새 목록을 보여주고 필요한 승인을 받는다.

현재 `hostAdapter`는 **manual-handoff**다. Dots의 관리형 네트워크를 변경하는 공개 API가 확인되지 않아
자동 적용을 구현했다고 표시하지 않는다. 직접 운영하는 VM의 방화벽 어댑터도 아직 연결하지 않았다.
`report-host-network`의 근거가 있어도 source는 항상 `host-reported`이며 라이브 인증서로 승격하지 않는다.
`revoke-network`는 로컬 승인만 해제한다. 실제 호스트 권한 해제는 별도 수행해야 한다.

## 인증·보존·복구

공식 `codex login --device-auth`를 사용한다. 설치된 CLI의 help에 옵션이 있어야 시작한다.
ChatGPT의 기기 로그인 설정/조직 정책 때문에 거부되면 중단한다. 콜백 주소·토큰·API 키 붙여넣기를 제안하지 않는다.
토큰 파일을 직접 읽거나 복사하지 않으며 공식 CLI가 현재 사용자의 자격 증명 저장소를 관리한다.
CLI와 이후 sprite-gen은 같은 사용자 전용 workspace와 CODEX_HOME/환경에서 실행해야 한다.
로그인 성공을 이미지 기능이나 Dots 대화 계정 동일성으로 확대하지 않는다.

연결 상태는 `output/creation-environment/environment.json`에 보존한다. 호스트명·실제 workspace 경로·자격 증명 홈이 달라지면
다른 VM에 복사된 기록을 차단한다. 공개 코드 외 CLI 출력은 메모리에서만 처리하고 로그/도구 응답으로 내보내지 않는다.
`get_creation_environment`는 이때 현재 revision과 `rebind` 조치를 반환한다. 사용자가 새 환경에서 연결을 요청하면
최신 revision으로 `rebind`(host, conversationId, feedback)를 기록한다. 캐릭터 파일·계정 선택은 보존하며
기능 확인·네트워크 승인·전달 확인만 초기화한다. 자격 증명을 옮기지 않는다.
로그인은 환경 잠금을 유지하므로 겹쳐 실행되지 않는다. 프로세스 강제 종료로 잠금이 남으면 실제 실행 상태부터 확인한다.
잠금을 자동 삭제하고 재시도하지 않는다. 인증 중단은 캐릭터 재생성 권한이 아니다.

## 검증 범위

로컬 테스트는 상태 보존, 승인/적용 분리, 서명·변조·롤백, 출력 비밀정보 제거, MCP 연결, 로그인 실행 명령을 검증한다.
실제 Dots 계정 연결·네트워크 권한 UI·첫 시안 표시의 종단간 검증은 별도 사용자 세션에서 수행해야 한다.
해당 검증 없이 VM 지원이나 생성 성공을 선언하지 않는다.

## Library 전송 장애 이후의 전달 계획 (2026-10-26)

미미의 기존 기록에서는 Library 목록 조회가 성공했지만, VM helper가 공용 hosted apps 브리지의
`tools/list`를 호출할 때 `network` 오류로 끝났다. helper 소스의 호출 순서상 `prepare_materialize`와
다운로드 URL 수신 전 단계다. 정확한 브리지 목적지와 축약 전 네트워크 오류는 미확인이며, 403이나
특정 도메인 차단의 증거는 없다. 이 장애를 ZIP 크기 문제나 생성 제공자 로그인 실패로 분류하지 않는다.

계획을 다음 세 경로로 나눈다. 각 단계가 성공해야 그 범위만 완료로 기록한다.

### 1. 공개 제작 키트: 경량 배포와 검토된 해시로 직접 받기

- `plugin:bundle`은 upstream `docs/assets/`의 문서 예제 미디어만 제외한다. 원본 체크아웃·gitlink·패치를
  변경하지 않고 실행 소스, 패키지 데이터, workflow 문서, LICENSE·NOTICE를 유지한다. 빠진 파일 목록과
  실제 해시는 build-report에 기록한다. runtime manifest는 포함된 실제 파일에서 다시 만든다.
- `kit:release`는 검증된 ZIP과 다운로드 helper를 묶어 `public/creator-kit/<version>/<content-id>/`를 준비한다.
  content-id는 ZIP과 helper의 해시에 함께 묶인다. 고정 URL은 immutable 후보이며 `latest` 자동 업데이트는 없다.
  준비 상태는 `prepared-not-published`다. URL을 만들었다고 서버 게시나 VM 도달 성공으로 기록하지 않는다.
- 최초 신뢰 기준은 **별도로 검토한 release-report의 manifest/helper 해시**다. 같은 서버에서 ZIP과 체크섬을
  함께 받았다는 사실만으로 실행을 허용하지 않는다. 자동 업데이트용 서명 키 배포는 이후 별도 릴리스 작업이다.
- `fetch-creator-kit.py`는 Python 표준 라이브러리만 사용한다. 공개 `oddbout.com`의 HTTPS 경로만 받고,
  리다이렉트·쿼리·다른 origin을 거부한다. 기존 프록시·CA 설정을 유지하며 인증/네트워크 설정은 변경하지 않는다.
  크기·전체 ZIP 해시·runtime 파일 목록과 개별 해시·경로·파일 형식을 검증한 뒤 **새 폴더**에 압축을 푼다.
  실행, 의존성 설치, 로그인, 생성은 하지 않는다. 실패 시 단계와 결과를 보존하고 자동 재시도하지 않는다.
- 릴리스의 networkPlan은 다운로드용 `oddbout.com:443`만 설명한다. npm/Python 설치, 생성 서비스, Library,
  사용자 파일 전달 허용과 다르다. 기존 generation profile에 download 성공이나 허용을 자동 기록하지 않는다.

구현 검증 순서:

1. 변경·손상된 파일, 리다이렉트, 크기 초과, 경로 탈출, 중복 경로, symlink, 기존 목적지 거부 테스트.
2. 실제 경량 ZIP을 로컬 파일 모드로 해시 검사·압축 해제하고 분리된 사용자 runtime에서 설치·도구 호출 확인.
3. `public/` 하위의 버전 경로만 **추가하는 방식**으로 배포한다. 기존 사이트 및 이전 릴리스를 보존하며,
   전체 사이트 교체용 `site:publish`에 이 릴리스 폴더를 넣지 않는다. 게시 후 세 파일의 실제 HTTPS 응답과 바이트를 확인한다.
4. 미미의 별도 검증 폴더에서 동일 manifest 해시로 실제 다운로드·압축 해제·설치를 확인한다. 기존 개구리 폴더는 유지한다.

다운로드·오프라인 압축 해제·로컬 설치·실제 VM HTTPS 전달은 별도 검증이다. Library 장애의 복구나
사용자 이미지 전달 성공으로 확대하지 않는다. 소프트웨어 다운로드 권한이 없으면 호스트의 공식 승인 절차를 따른다.

### 2. 사용자 제작 자료: 공식 플러그인 파일 입력과 비공개 작업 저장소

이 경로는 설계 단계다. 기존 `upload_fighter_asset`은 등록용 자산 업로드이므로 일반 원본·영상 보관에 재사용하지 않는다.
공식 플러그인의 `openai/fileParams` 입력으로 사용자가 선택한 파일을 받는 작은 실증부터 수행한다.
Dots가 해당 입력을 실제로 전달하는지 확인하기 전에는 지원된다고 표시하지 않는다.

후속 구현은 로그인한 사용자의 작업 소유권, 비공개 저장, 용량/형식 제한, 콘텐츠 해시, 멱등 요청,
만료되는 다운로드 권한을 함께 다룬다. 파일 참조와 작업 상태는 보존하고 임시 URL 만료 때문에 재생성하지 않는다.
다운로드 URL은 서버에서 처리하며 대화·일반 로그에 노출하지 않는다. 임의 URL 다운로드 도구로 확대하지 않고
URL/redirect/내부 네트워크 접근을 검증한다. 파일 수신, 서버 저장, VM 수신, 해시 확인, 현재 대화 표시를 각각 기록한다.
불명확한 결과는 기존 작업/파일 기록을 조회한 뒤 판단한다. Library 보관·표시도 필요한 경우 별도 확인한다.

완료 기준은 비민감 작은 파일로 수신·재개·권한 분리·실제 VM 바이트 일치를 확인하는 것이다.
생성 테스트를 위해 새 이미지를 만들지 않으며, 기존 개구리 원본의 새 전송은 그 파일과 목적지에 대한 승인 범위에서 진행한다.

### 3. 준비된 실행 환경과 플랫폼 오류 진단

키트/의존성을 준비된 Codex 환경에 설치하면 반복 설치를 줄일 수 있다. 공통 환경에 개인 로그인이나
서비스 키를 넣지 않으며 사용자별 작업 공간을 유지한다. 환경 갱신은 새 작업에서 검증하고 기존 제작 작업을 초기화하지 않는다.
Library 오류는 별도로 실제 bridge 목적지, 축약 전 오류, 요청 시각을 플랫폼 측에서 확인해야 한다.
재로그인·도메인 확장·보안 우회를 일반적인 해결책으로 실행하지 않는다.

### 실제 검증 결과 (2026-10-26)

사용자가 실제 이미지 생성·전달 검증을 요청한 뒤, 미미의 직접 이미지 도구로 파란 정육면체 테스트 이미지
1장을 생성했다. 미미는 실제 호출 완료, 원본 PNG 1,254×1,254 / 1,596,801바이트의 디코딩·해시 검사,
Library 저장과 네이티브 첨부를 보고했다. 이 검증을 관리한 브라우저에서도 같은 이미지가 미미 부모 대화에
표시되고 `complete=true`, `naturalWidth=naturalHeight=1254`임을 직접 관측했다.
이미지 백엔드·모델·계정 동일성은 도구에서 확인되지 않았다. 직접 생성 성공을 VM의 sprite-gen 생성 성공으로 확대하지 않는다.

별도 검증 VM에서는 이미 Library에 있던 PNG 1개를 현재 공식 helper로 1회 내려받았으나,
16:05:54 KST에 `library download request failed: hosted apps tools/list request failed: network`로
exit 1 종료됐다. Library 메타데이터 조회는 성공했지만 materialize 성공 응답과 수신 파일은 없었다.
기존 오류가 재현되어 새 큐브의 VM 다운로드는 반복하지 않았다. 실패 목적지·HTTP 상태·권한 거절 여부는 미확인이다.

따라서 직접 시안 생성·Library 보관·부모 대화 표시는 확인됐고, **Library→VM 전달은 미복구**다.
플랫폼의 도구 탐색 오류 진단과 2번의 공식 파일 입력 실증은 남은 작업이다. 이 결과를 근거로 도메인을
추가하거나 다른 제공자·유료 API로 전환하지 않는다. 공개 키트와 기존 설치 보고서는 변경하지 않았다.

로컬 근거: `output/mimi-image-delivery-20261026/verification-result.json`,
`browser-display-evidence.json`, `mimi-generated-image-visible.jpg`.

근거: [공식 파일 입력 API](https://developers.openai.com/plugins/reference#file-apis),
[Work 네트워크 범위](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security),
[Dots 실행 환경](https://learn.chatgpt.com/docs/dots/computers-and-apps),
[준비된 클라우드 환경](https://learn.chatgpt.com/docs/environments/cloud-environments).

### Library 지원 범위와 대조 진단 (2026-10-26 후속)

[공식 cloud task 접근 문서](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security#what-a-cloud-task-can-access)는
사용자가 업로드하거나 Library에서 첨부한 파일을 지원 경로에 포함한다. 따라서 Library→cloud 전달은 원래 불가능한
기능으로 분류하지 않는다. 부모 대화의 로컬 파일 시스템이 자식 VM에 자동 공유된다는 뜻도 아니다.

[Work 네트워크 설정](https://learn.chatgpt.com/docs/sandboxing?surface=web)과
[저장 환경의 도메인 설정](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-services)은 존재하지만,
조사한 공식 문서에서는 별도 Library→VM 활성화 스위치를 확인하지 못했다. 네트워크 정책과 플러그인 권한은 서로
다르며, 도메인 허용이 서비스 인증을 대신하지 않는다. 이번 오류는 목적지·HTTP 상태를 제공하지 않아 도메인 추가로
해결할 수 있다고 판단할 근거가 없다.

또한 [공식 Work Cloud 정책 범위](https://learn.chatgpt.com/docs/enterprise/agent-security#how-agent-security-applies-to-work-cloud)에
따르면 Dots 부모 cloud computer와 저장된 Codex Cloud 실행 환경은 실행 설정이 다르다. 저장 환경의 도메인을
허용했다고 부모에도 적용된 것으로 기록하지 않는다. 기업 관리 화면의 capability 위치가 문서화돼 있어도 개인 계정의
현재 부모 런타임에 특정 호스트만 즉시 적용하는 경로가 제공된다고 가정하지 않는다.

동일한 기존 큐브 원본으로 아래 대조를 수행했다. 새 이미지는 생성하지 않았다.

| 경로 | 관측 결과 |
| --- | --- |
| Library → 미미 부모 | 현재 metadata와 새 공식 helper로 별도 새 파일 수신 성공. 디코딩·크기·해시 일치를 미미가 보고 |
| 미미 이미지 뷰어 → 브라우저 다운로드 | 실제 로컬 파일 1,596,801바이트와 SHA-256을 독립 확인 |
| 브라우저 원본 → 기존 검증 VM 공식 파일 선택기 | `이미지를 업로드하지 못했습니다` 표시, 첨부 메시지·수신 파일 성립 안 됨 |
| 같은 큐브 → 검증 VM 공식 Library helper | 16:34:56 KST, exit 1, 같은 `hosted apps tools/list request failed: network` 재현 |

큐브 SHA-256은 `4e5e820aa120a4efd0d87802b0a014bb479d750da0998c7375198688de018979`이다.
검증 VM에서는 현재 metadata 조회가 성공했지만 materialize 성공 응답·원본 바이트는 없었다. HTTP status, 실패 host,
request ID는 미확인이다. 직접 제어 검증 후 미미 관리 상태로 반환했다. 이전 설치·전달 보고서의 해시는 유지됐다.

[동일 증상의 공개 이슈 #51737](https://github.com/openai/codex/issues/51737)는 10월 7일 개설 후 10월 23일까지
같은 부모 성공/저장 환경 실패 사례가 보고됐고 조사 시점에도 열려 있었다. 사용자 재현 보고이며 확정 원인이나
공식 해결책은 아니다. 직접 첨부와 연결된 Drive로 성공한 사례도 있으나 다른 보고에서는 실패하여 보편적인 복구법으로
간주하지 않는다. 공개 상태 페이지의 정상 표시 역시 특정 환경 장애를 배제하지 않는다.

운영 판단은 다음과 같다. 실제 바이트 수신이 가능한 부모 실행 환경에서 처리 가능성을 먼저 검증하고, 외부 VM이
필수인 작업은 지원되는 파일 전달 경로를 종단간 확인한 뒤 시작한다. 파일 ID를 텍스트로 전달하거나 원본을 재생성하여
전달 성공을 대신하지 않는다. 전용 비공개 파일 입력 경로는 위 2번의 별도 실증 대상으로 유지한다.

이번 대조 근거는 `output/library-recovery-research-20261026/verification-result.json`과
`consumer-command-evidence.json`에 있다. `platform-diagnostic-draft.json`은 비밀·개인 식별 정보를 제외한
플랫폼 진단 초안이며 외부에 제출하지 않았다.

### 별도 발견: 전체 사이트 배포가 키트 파일을 제거한 문제

부모 환경의 대안 설치 점검 중 고정 helper URL에서 HTTP 404를 확인했다. 이는 Library 브리지 오류와 별개다.
뒤따른 사이트 배포 `cae8b7b2c3ab0998e9a6bf716c6c9ffc915004f2`가 기존 키트 파일 3개를 제거한 것이
커밋 diff와 실제 HTTPS 응답에서 확인됐다.

`publish-creator-kit.mjs`로 현재 사이트를 기준으로 동일 검토 바이트 3개만 복원했다. 복원 커밋은
`2b5d4e4d0910712b80a795cdfc5e615d96438e2a`이며 기존 5,577개 파일의 변경·삭제는 0개다.
2026-10-26 07:38:22 UTC에 세 파일 모두 HTTP 200, 크기·해시 일치 및 주요 사이트 파일의 전후 일치를 확인했다.
근거는 `output/creator-kit-recovery-20261026/publication-result.json`이다.

이 체크아웃의 전체 사이트 게시 경로에는 `restoreCreatorKitReleases`/`assertCreatorKitsUnchanged` 보존 장치가 있고,
해당 회귀 테스트 1개가 통과했다. 다른 배포 경로에도 같은 보호를 적용해야 한다. 이 체크아웃의 테스트 통과나 이번
3개 파일 복원을 다른 게시자의 재발 방지 적용 완료로 확대하지 않는다.

복원 이후 미미 부모 환경의 `attempt-02`에서는 동일 키트 HTTPS 수신·해시·압축 해제,
별도 runtime의 `launcher --status`, Node 의존성 121개 설치, `creation-tool list`의 도구 16개 조회가
성공했다. Library에서 받은 기존 큐브를 `sharp`로 전체 디코딩해 1,254×1,254 RGB와 원본 해시도 확인했다.
따라서 **Library→부모 실행 환경→Node 이미지 처리**는 실제로 동작하는 대안이다.

Python `sprite:setup`은 build dependencies 시작 로그 뒤 종료 코드가 확인되지 않았다. 부모 환경의 자동 승인
검토가 `pypi.org` 허용 전제조건을 이유로 후속 상태 조회를 거절했다고 미미가 보고했으므로, 결과는 실패가 아닌
`unknown`으로 보존한다. `sprite:status`의 venv 존재·소스 버전 확인을 설치 완료로 취급하지 않는다.
이 시점의 `sprite-gen help`와 생성은 미실행이었다. Python 준비와 별도 VM의 Library 복구까지 완료됐다고 표시하지 않는다.

사용자는 이어 부모의 `pypi.org`, `files.pythonhosted.org` 두 호스트 HTTPS 사용을 승인했다. 그러나 현재 부모
런타임에 두 호스트만 적용하는 공식 API/즉시 반영 경로는 확인되지 않아 정책 변경 완료로 기록하지 않았다.
승인 후 기존 세션 결과 회수는 `Unknown process id`로 끝났고 과거 설치의 종료 코드는 여전히 미확인이다.

기존 venv를 새 설치·네트워크 없이 확인한 후속 진단에서는 `pip check`가 exit 0이었지만,
`importlib.metadata.version("sprite-gen")`은 `PackageNotFoundError`, `npm run sprite -- --help`는
`No module named 'sprite_gen'`으로 각각 exit 1이었다. 따라서 현재 부모의 Python 도구는 **미설치/사용 불가**다.
빈 환경에서도 통과할 수 있는 `pip check`를 패키지 설치 성공으로 해석하지 않는다. 과거 실행의 종료 코드 불명과
현재 모듈 부재는 별도 사실이다. 원본·보고서를 보존하고 재설치하지 않았으며, Node 이미지 처리 성공 범위만 유지한다.

### 부모 네트워크 판단 정정 (2026-10-26 17:04 KST)

후속 조사에서 같은 Pro 계정의 실제 `설정 → 데이터 관리 → Work 네트워크 액세스 허용`이 이미 켜져 있음을
브라우저로 확인했다. `클라우드 컴퓨터` 화면의 개별 웹사이트 권한은 Work 브라우저용이며 셸 네트워크 목록이 아니다.
설정은 변경하지 않았다. 공식 웹 설정 설명은
[Sandbox의 웹 권한 안내](https://learn.chatgpt.com/docs/sandboxing?surface=web)에 있다.

기존 사용자 승인 범위의 두 호스트에 부모가 기본 프록시·CA·TLS로 각각 HEAD 1회를 수행했다.
17:04:21 KST에 `pypi.org`는 HTTP 200/exit 0, 17:04:26 KST에 `files.pythonhosted.org` 루트는
HTTP 404/exit 0을 반환했다. 후자는 실제 HTTP 응답이며 네트워크 차단으로 분류하지 않는다.
앞서 부모의 허용 목록이라고 설명한 근거는 모델에 제공된 환경 안내였고 실제 정책 파일을 읽은 결과가 아니었다.
따라서 **두 호스트의 정책 추가 적용이 반드시 필요하다는 이전 결론을 정정한다.** 접속 성공은 패키지 설치 성공이나
Library 연결 복구를 의미하지 않는다. 기존 자동 승인 거절도 실제 방화벽 거부 증거로 바꾸어 해석하지 않는다.

소비 VM에서 현재 공식 Library 스킬·참조 문서 5개와 도구 설명을 확인했지만, 이번 `tools/list` 오류에 대한
추가 debug/trace 옵션, 상관 ID 조회, 연결 상태/재연결, 지원용 진단 내보내기 방법은 문서화돼 있지 않았다.
공식 helper가 사용할 수 없는 경우 중단·보존하도록 돼 있으며 원본 전송을 우회하지 않는다.
내부 연결 진단은 [OpenAI Support](https://help.openai.com/en/articles/6614161-how-can-i-contact-support)에
정확한 실패 시각·계정·환경·오류·작업 정보를 전달하여 요청하는 경로를 확인했다. 지원 요청은 사용자 승인 후에만 제출한다.

근거: `output/library-network-settings-20261026/work-network-already-enabled.png`,
`library-diagnostics-evidence.json`, `support-request-draft.json`.

### OpenAI 지원 문의 제출 (2026-10-26 17:19 KST)

사용자가 준비한 진단 문의 제출을 승인한 뒤, `help.openai.com`에 같은 계정으로 로그인하여 정확한 실패 시각,
검증 작업·실패 턴 ID, 오류, 부모/소비 VM 비교 결과를 전송했다. 원본 이미지, 토큰, 서명 URL, 전체 로그와 HAR는
첨부하지 않았다. 지원 AI의 일반 네트워크 안내 이후 서버 로그 확인을 위해 담당자 이관을 요청했고,
화면에서 **“Escalated to a support specialist”** 및 이메일 답변 안내를 확인했다.
이는 담당자 이관 접수이며 원인 확인이나 복구 완료가 아니다. 접수 번호는 관측한 화면에 표시되지 않았다.

지원 AI는 환경별 인터넷 설정과 `*.oaiusercontent.com` 확인을 제안했지만, 이번 실패의 호스트·HTTP 응답을
특정한 진단은 아니었다. 따라서 그 제안만으로 도메인을 추가하거나 Library 연결이 복구됐다고 기록하지 않았다.
기록은 `output/library-network-settings-20261026/support-request-draft.json`,
`support-receipt-ax.txt`, `support-escalated.png`에 보존했다.

### 부모 Python CLI 설치 복구 확인 (2026-10-26 후속)

`attempt-03`의 npm wrapper 실행 뒤 결과 조회는 자동 승인 검토에서 `registry.npmjs.org`를 이유로 거절됐다.
이는 심사 응답이 보고한 호스트이며 독립적인 HTTP 관측은 아니다. 기존 Node 설치 승인·성공 기록과 사용자 PyPI
추가 승인 범위를 명시하자 기존 세션 조회는 허용됐지만 `Unknown process id 95297`이었다. 따라서 과거 종료 코드는
계속 unknown으로 보존했다. 오프라인 점검에서는 실행 중인 설치가 없고 sprite-gen·Pillow·NumPy가 설치되지 않았음이 확인됐다.

기존 사용자 승인에 따라 `attempt-04`에서 같은 venv Python으로 검토된 소스의 pip editable 설치를 한 번 수행했다.
npm wrapper 없이 승인된 PyPI 경로를 사용하고, 로그·종료 코드를 파일에 남겼다. 미미가 보고한 설치 결과는
**exit 0, 21.13초, timeout 없음**이며, `python -m sprite_gen.cli --help`와 `python -m pip check`도 exit 0이었다.
버전은 Python 3.12.14, sprite-gen 2.44.0, Pillow 12.3.0, NumPy 2.5.4다. setuptools는 빌드 의존성이므로 runtime
venv에는 없으며 추가 설치하지 않았다. 해당 항목 때문에 실패한 합산 버전 조회와 개별 배포 확인 결과를 모두 보존했다.

이는 **부모의 Python CLI 설치 복구**이며 저장 VM의 Library 복구·이미지 생성·인증·등록 완료가 아니다.
소비 VM의 Library 실패와 과거 설치의 미확인 종료 코드는 유지한다. 네트워크 설정은 바꾸지 않았다.
원격 보고서는 `/workspace/shared/oddbout-parent-recovery-20261026/attempt-02/install-recovery-attempt-04/`에 있다.
로컬에는 미미의 실행 결과 보고를 관측한 `parent-python-result-ax.txt`, `parent-python-installed.png`와
이번 조사 전체의 `verification-result.json`을 `output/library-network-settings-20261026/`에 보존했다.
원격 JSON을 로컬로 내려받아 독립 확인한 것으로 기록하지 않는다.

### 인터넷 재조사: 복구 보고와 구현 후보의 구분 (2026-10-26)

동일한 부모 성공/저장 VM 실패를 다루는 [공개 이슈 #51737](https://github.com/openai/codex/issues/51737)는
재조회 시에도 열려 있었다. 새 작업·Library 참조 갱신은 보편적인 복구법으로 확인되지 않았다.
Drive로 실제 바이트를 받은 성공 보고가 있지만, 다른 실행 환경에서는 `file_uri`만 받아 진행하지 못했다.
사용자 재현 보고이며 플랫폼이 확정한 공통 원인으로 취급하지 않는다.

[10월 22일 사용자 복구 보고](https://community.openai.com/t/dot-cannot-deliver-generated-word-excel-attachments-tools-list-http-403-on-oct-20/1408057/7)는
로그인·권한·토큰·endpoint 변경 없이 공식 helper의 TXT/PNG/WAV 업로드·다운로드와 해시 검사가 성공했다고 설명한다.
다만 이 사례는 Dot 업로드의 `tools/list HTTP 403`이다. 우리 저장 VM의 `tools/list ... network` 오류가
같은 원인이거나 이미 복구됐다는 근거가 아니다. 조사한 자료에서 우리 오류에 대한 검증된 범용 복구 절차는 찾지 못했다.

[공식 네트워크 도움말](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps)의
`*.oaiusercontent.com` 안내는 회사 네트워크의 브라우저 업로드 차단 예시를 다룬다. 실패 host가 없는 VM 도구 탐색
오류에 그 목록 전체를 추가해야 한다는 뜻으로 확대하지 않는다. 저장 환경 갱신은
[공식 환경 문서](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-services)에 따라 별도로 저장·게시하고
새 작업에서 검증한다.

위의 사용자 제작 자료 경로는 [공식 File APIs](https://developers.openai.com/plugins/reference#file-apis)로 근거를 구체화한다.
`openai/fileParams`로 선언한 도구 입력은 `download_url`·`file_id`를 받는다. 선택 UI에서는 선택적으로 제공되는
`selectFiles()`를 확인하고, 지원되지 않으면 공식 파일 업로드 UI를 사용한다. 이는 사용자가 선택한 파일의 플러그인
입력이며 부모 파일 시스템을 자동 공유하는 기능이 아니다. 먼저 기존 비민감 PNG 한 개의 서버 수신·해시를 검증한 뒤
비공개 작업 저장과 만료 다운로드 권한을 추가하여 VM 수신을 별도로 검증한다. 현재는 설계·실증 후보이며 배포된 해결책이 아니다.

이번 재조사는 네트워크 설정 변경·새 전송·생성을 수행하지 않았다. 출처와 판단 범위는
`output/library-network-settings-20261026/internet-research-followup.json`에 기록했다.

### 공식 파일 입력 → 서버 원본 해시 실증 성공 (2026-10-26 18:24 KST)

사용자가 기존 파란 큐브 PNG의 공식 파일 입력 실증을 요청한 뒤, 연결된 ODDBOUT MCP에
`verify_creator_file_input`을 추가했다. `openai/fileParams: ["file"]`를 선언하고 기존 OAuth 검증을
그대로 사용한다. 최대 4 MiB를 메모리에 받아 실제 바이트 수·SHA-256·PNG 시그니처/IHDR을 검사하며,
파일 저장·생성·캐릭터 등록은 하지 않는다. 서버의 PNG 검사는 전체 디코딩 검사가 아니다.

최종적으로 **기존 Library 원본 → 공식 Library 선택기 → 네이티브 파일 입력 → ODDBOUT 서버**에서
원본 바이트가 보존됐다. 같은 계정의 새 검증 대화에서 받은 실제 receipt는 다음과 같다.

- `ok=true`, `stage=file-input-verified`
- 크기 **1,596,801 bytes**, PNG **1254 × 1254**
- SHA-256 `4e5e820aa120a4efd0d87802b0a014bb479d750da0998c7375198688de018979`
- `matchesExpectedBytes=true`, `matchesExpectedSha256=true`
- receipt `3026897b-408f-4851-9bf3-1d5b69ea8a4d`, 수신 `2026-10-26T09:24:16.886Z`
- `persisted=false`, `registered=false`, `libraryToVmVerified=false`

서버 배포는 `ai-fighter-mcp` v17이며 같은 시간대의 함수 HTTP 200과 실행 ID
`becd4f2c-e498-47e2-8149-214ef2095b9d`를 별도로 확인했다. HTTP 200만으로 성공을 판정하지 않고
실제 수신 receipt와 원본 해시를 대조했다. 공식 대화 조회로 받은 Library 첨부 파일도 로컬에서 해시를
측정해 원본과 일치했다. 관련 통합 테스트 10개가 통과했으며 CI는 실행하지 않았다.

실증 중 확인한 두 문제를 구분한다. 기존 MCP 파일 허용 규칙에는 실제 `fileParams` 입력이 제공한
`oaisdmntprnznorth.blob.core.windows.net` 및 `oaisdmntprwestus.blob.core.windows.net`이 없어
`unsupported-file-origin`으로 거부됐다. 관측된 두 정확한 호스트만 **진단 도구에 한정해** 허용했다.
다른 Azure 테넌트, 비HTTPS, 사용자정보 포함 URL, 임의 포트, 리다이렉트는 계속 거부한다.
등록 도구의 기존 호스트 정책과 VM 네트워크 설정은 변경하지 않았다. 이 원인은 기존 소비 VM의
Library helper `tools/list ... network` 오류에 대한 원인 규명이 아니다.

또한 로컬 PNG를 브라우저 이미지 첨부로 다시 올린 경로에서는 2,209,116 bytes 및
`4142511d9d3cf65d050d8e7cdf8df6fcd31d030f5dd2813a1140192c6af36e5d`가 수신돼 원본 검증에 실패했다.
해당 첨부와 원본을 로컬에서 전체 RGBA 디코딩한 결과 픽셀은 동일했지만 PNG 바이트는 달랐다.
따라서 원본 해시가 필요한 흐름에서는 재업로드한 이미지의 원본 보존을 가정하지 않는다.
이번에 성공한 경로는 **Library의 기존 원본 직접 선택**이다. 서비스의 모든 파일·지역에 대한 보장은 아니다.

앱 설정의 공식 도구 새로고침 후에도 기존 미미 대화는 이전 목록을 유지해, 사용자 승인으로
[ODDBOUT 파일 입력 실증](https://chatgpt.com/c/6adf1653-de94-83e8-a479-b6025b7a6d60) 대화를 만들었다.
두 중간 호출은 호출측 결과 출력 누락으로 unknown을 유지한다. 후속 실행은 전체 반환값을 명시적으로
출력해 검증했으며, 앞선 실패와 불명 결과를 성공으로 덮어쓰지 않았다.

결과·배포 원본·실패 기록·화면 증거는 `output/file-input-probe-20261026/`에 보존했다.
**Library→저장 VM 직접 전달 복구 및 서버의 비공개 저장→VM 다운로드는 아직 검증하지 않았다.**
