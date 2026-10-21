# AI Fighter 제작 안내

목표는 사용자가 설명한 **새 선수의 애셋과 `fighter.json`**을 만드는 것이다.
규격 ID는 `ai-fighter-side-v1`이다. 정확한 허용 필드와 한도는
[스키마](../contracts/ai-fighter/v1/fighter.schema.json)와
[spec](../contracts/ai-fighter/v1/spec.json)이 소유한다.
규격 조회 뒤 작업 중에는 같은 버전을 사용한다.

Dot은 먼저 `get_fighter_spec`의 `creation`과 [사용자별 제작 흐름](DOT-CREATION.md)을 읽는다.
이 저장소의 `vendor/sprite-gen`을 설치하고 사용자 본인의 생성 계정으로 새 원화·동작을 만든다.
도형 테스트 샘플은 생성 결과로 납품하지 않는다.

연결된 서버의 `get_fighter_spec` 응답에서 `registration.available`을 확인한다.
오프라인 계약은 `false`, 서버 연결 시에는 `true`다. Google 로그인 후 초대 없이 제출하며 서버 파일 검사 후 자동으로 이용한다. [현재 정책](OPEN-REGISTRATION.md)을 따른다.

## 제작 흐름

보행의 실행 절차와 새 명령은 [GAIT-REVIEW.md](GAIT-REVIEW.md)를 따른다. sprite-gen 설치가 모든 동작의 자동 검수 통과를 뜻하지 않는다.
공통 좌표·중립 기준 배율, 프레임별 지지발 계획, 양발의 실제 접지 측정, 등록 전 미리보기가 필요하다.
fighter:pack은 기본적으로 최종 game-pack의 현재 픽셀·재생 시간과 일치하는 walk/run 검수 결과를 요구한다.

1. 사용자가 원하는 이름, 실루엣, 복장, 색, 장비를 정한다.
2. 호스트의 이미지 생성 도구로 오른쪽을 향한 정사영 측면 전신 원화를 만든다.
   카메라 고도는 16도다. 원화의 정체성을 유지하면서 모든 필수 동작을 제작한다.
3. 각 동작을 투명 배경의 **정적 WebP** 시트로 내보낸다. 움직이는 WebP, GIF, 영상, SVG는 제출 형식이 아니다.
4. 프레임·기준점·접지·시간·접촉 단계와 보조 자세를 측정한다.
5. 같은 선수의 초상과 전신 미리보기 crop을 연결한다.
6. 최종 파일에서 실제 바이트 크기, 이미지 크기, SHA-256을 계산한다. 수치를 추측하지 않는다.
7. `validate_fighter_manifest`에 원문 JSON을 넣고 오류를 수정한다.
8. `validate_fighter_package`에 작업 폴더 아래 상대 경로를 넣어 실제 파일까지 검사한다.
9. 사용자가 등록을 요청했고 본인 계정이 연결되어 있으면 `submit_fighter_package`로 같은 패키지를 제출한다.
   UUID 형식의 `idempotencyKey`를 저장하고 재시도에도 같은 값을 사용한다. 파일을 바꿨으면 새 초안이다.
10. `get_fighter_submission`으로 결과를 조회한다. `registered`와 `fighterId`를 받은 뒤 등록 완료로 안내한다.
    `runtimeApproved: true`이면 이용 가능하다. 등록 후 false라면 사후 이용 제한 여부를 확인한다. 작업자가 꺼져 있으면 자동 검증 대기로 남는다.
    `pending`이 빈 배열이면 최종 상태다. 더 조회하지 않는다.
    `rejected`이면 `validation`의 오류를 고친다. 고친 패키지는 새 초안이므로 새 키로 제출한다.
    `code: "upload-expired"`는 24시간 안에 업로드를 끝내지 못한 제출이다. 새 키로 다시 제출한다.

이미지 생성·애니메이션 제작은 포함된 sprite-gen을 Dot의 로컬 호스트에서 실행한다. 이 MCP는 이미지를 생성하지 않는다.
호스트에 필요한 도구가 없으면 그 제한을 알린다. 기존 샘플의 이름만 바꿔 새 선수라고 제시하지 않는다.

## 패키지

```text
output/my-fighter/
  fighter.json
  assets/
    idle.webp
    walk.webp
    ...
```

`assets/<소문자-이름>.webp`만 허용한다. 외부 URL, 절대 경로, 상위 경로, 심볼릭 링크를 사용하지 않는다.
JSON에 있는 모든 애셋은 적어도 하나의 클립이나 프로필에서 참조해야 한다.
MCP 파일 경로는 `AI_FIGHTER_ROOT`를 기준으로 `output/my-fighter/fighter.json`처럼 지정한다.
파일 검사 중에는 패키지를 변경하지 않는다.

| 필드 | 의미 |
| --- | --- |
| `schemaVersion`, `specVersion` | JSON 구조와 제작 계약 버전 |
| `localId` | 로컬 작업 식별자. 서버 선수 ID가 아니다 |
| `profile` | 이름, 소개, 초상·미리보기의 애셋 ID와 crop |
| `combat.kitId` | `standard-duel`. 서버가 관리할 규칙의 예약 ID |
| `appearance` | 정사영, 16도, 오른쪽 원본, 왼쪽 반전, 몸높이 400, 배율 1 |
| `assets` | 실제 파일의 ID, 경로, MIME, SHA-256, 바이트, 너비·높이 |
| `clips` | 필수 동작의 시트, 프레임, 기준점, 시간, 접촉 표식 |

허용하지 않은 필드는 거절한다. 소유자 ID, 선수 ID, 승인 상태, HP, 피해, 사거리, 실행 코드는 서버가 소유한다.
성격이나 소개는 표시용 데이터다. AI나 게임에 실행을 지시하는 문장이 아니다.
`standard-duel`을 선택해도 경쟁 규칙의 통합이나 서버 연결이 완료되지는 않는다.

## 좌표와 프레임

- 몸높이 기준은 400픽셀이다. 동작마다 키를 다시 정의하지 않는다. 셀 높이는 몸높이와 다를 수 있다.
- 같은 시트의 모든 셀 크기는 같다. `width = frameWidth × columns`, `height = frameHeight × rows`다.
- `frames`는 `[0,1,...]`이며 위쪽 줄부터 왼쪽→오른쪽 순서다. 줄 끝 미사용 셀은 비어 있어도 된다.
- `origins[i]`는 셀 왼쪽 위 기준 `originX`, `originY`다. 셀이 달라져도 발의 세계 좌표가 튀지 않도록 측정한다.
- `groundContacts`는 지면에 닿는 타원의 중심 `x,y`와 반경 `rx,ry`다. 공중은 빈 배열이다.
  빈 배열을 쓰거나 범위 검사에 통과했다는 사실만으로 접지가 올바르다고 판단하지 않는다.
- `profile.portrait`, `preview`는 `{ assetId, crop: { x, y, width, height } }`다.
  crop 좌표는 셀이 아니라 전체 이미지 기준이다. 범위 밖이나 완전히 투명한 crop은 거절한다.
- 같은 체형·복장·색을 모든 동작에서 유지한다. 왼쪽은 반전하므로 문자·문양도 이를 고려한다.

## 필수 동작

| 동작 | 내용 | 시간·표식 |
| --- | --- | --- |
| `idle` | 정지 전신 1칸 | `durationMs` |
| `walk` | 양발이 교대하는 16칸 | `durationMs`, `stridePixels` |
| `run` | 달리기 12칸 | `durationMs` |
| `fightIdle` | 전투 준비 반복 | `sequence`, 접촉 없음 |
| `combo` | 준비·연타·회수 | 접촉 최소 3개, `landmarks.spinStart` |
| `slam` | 강타 | 접촉 1개 |
| `dash` | 돌진 | 접촉 0~1개, `windup`, `recover` 보조 자세 |
| `block` | 가드·막기 | 접촉 1개. 직전 단계가 유지 가드 |
| `hit` | 피격·비틀거림·복귀 | 접촉 1개, `recoil`, `stagger`, `recover` |
| `groggy` | 흔들림 반복 | 접촉 없음 |
| `fall` | 넘어짐·누움 | 접촉 1개, `lieSequenceIndex`, `getUp` |

`idle`·`walk`·`run`의 `durationMs`는 **한 칸**의 시간이다. 한 주기는 `durationMs × 칸 수`이고 10초 이하다.
예: `walk` 16칸이면 칸당 625 ms 이하다.

`sequence`는 `{ frame, durationMs }` 배열이다. 같은 프레임을 반복할 수 있다.
`hitSequenceIndices`는 **이미지 프레임 번호가 아니라 재생 단계 번호**다. 0보다 크고 오름차순이어야 한다.

- `combo.spinStart`: 마지막 세 접촉의 첫째 뒤, 둘째 이하인 단계.
  둘째·셋째 접촉 인덱스 평균의 내림값이 `spinStart`보다 커야 세 구간을 분리할 수 있다.
- `hit.recoil`: 접촉 단계와 같다. `stagger`와 `recover`는 양끝을 포함하는 단계 쌍이다.
  `recoil ≤ stagger[0] ≤ stagger[1] < recover[0] ≤ recover[1]` 순서다.
- `dash.windup`, `recover`: `{ clip, frame }`으로 같은 선수의 다른 전투 자세를 참조한다.
  여기의 `frame`은 **참조 클립의 이미지 프레임 번호**다.
- `fall.lieSequenceIndex`: 착지 이후 누운 단계. 마지막 단계도 그 누운 프레임으로 끝난다.
  `getUp`은 `{ clip, frame, durationMs }` 배열이다. 일어서기의 합산 시간도 10초 이하다.

접촉 표식은 그림의 박자다. 실제 공격 횟수·피해·판정 시간은 신뢰된 게임 규칙이 정한다.
샘플 로봇은 파일 형식 시험용이다. 넘어짐·연타 등의 연기 품질을 보여주는 작품이 아니다.

## 검사 결과 읽기

`ok`, `stage`, `errors`, `pending`을 읽는다. 오류의 `path`는 JSON Pointer다.
전체 스키마·예제는 크다. 동작 하나를 고칠 때는 `get_fighter_spec`에 `motion`(예: `walk`)을 넘겨 그 부분만 읽는다.
파일 검사는 한 번에 하나만 실행하고 최대 2개가 기다린다. 그보다 많으면 `VALIDATOR_BUSY`이므로 잠시 뒤 다시 요청한다.
MCP는 오류를 최대 50개까지 돌려주며 더 많으면 `errorCount`를 포함한다.
명령행 검사는 성공 시 0, 검증 실패 시 1, 사용법 오류 시 2를 반환한다.

`metadata-only` 통과는 파일의 존재·해시·디코딩 통과가 아니다.
전체 파일 검사도 발 교대, 캐릭터 정체성, 접지, 실제 전투 재생, 공정성, 등록을 보증하지 않는다.
베타 서버는 업로드된 불변 파일을 별도 작업자에서 다시 검사한다. Dot의 로컬 통과 보고를 승인 근거로 사용하지 않는다.
