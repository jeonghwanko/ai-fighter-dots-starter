# Dot에서 내 선수 만들기

Dot이 이 저장소에 포함된 **sprite-gen**으로 사용자의 새 선수 원화와 애니메이션을 만든다.
사용자는 만들고 싶은 캐릭터를 설명한다. Dot은 제작 도구 실행, AI Fighter 패키징, 검사와 요청받은 등록을 맡는다.
각 사용자의 로컬 실행 환경과 본인의 생성 계정을 사용한다. 제작자의 로그인·토큰·서비스 키를 배포하지 않는다.

## 1. 제작 도구 받기

터미널과 로컬 파일을 사용할 수 있는 Dot/Codex 호스트에서 실행한다. 로컬 실행 기능이 없는 웹 호스트에는
이 설치 명령을 실행했다고 말하지 않는다. 호스트 지원 여부를 먼저 확인한다.

```sh
git clone --branch codex/creator-hosting --single-branch https://github.com/jeonghwanko/ai-fighter-dots-starter.git
cd ai-fighter-dots-starter
npm ci --ignore-scripts
npm run sprite:setup
npm run sprite:status
```

홈페이지와 연결할 때는 `codex/creator-hosting` 브랜치를 사용한다. 공개 로그인 연결 설정은
이 브랜치의 `deploy/creator-site.json`에서 읽는다. 기본 `main`으로 대체하지 않는다.
기존 설치를 재사용할 때도 브랜치와 파일을 확인하고, 사용자의 변경을 덮어쓰지 않는다.

Git·Node 22.12+·Python 3.11+가 필요하다. `sprite:setup`이 sprite-gen 고정 커밋만 얕게(약 100 MB) 받는다.
GitHub ZIP에는 서브모듈 내용이 없으므로 Git clone을 사용한다.
`sprite:setup`은 `vendor/sprite-gen/.venv`에 도구를 설치한다. 전역 sprite-gen이나 운영자 PC 경로에 의존하지 않는다.
Python 탐지가 필요한 호스트는 `AI_FIGHTER_BOOTSTRAP_PYTHON`에 Python 실행 파일 경로를 지정한다.
해당 변수는 venv 생성에만 쓴다. 생성과 추출은 항상 포함된 도구의 venv에서 실행한다.

## 2. Dot이 읽을 규칙과 계정 선택

1. `get_fighter_spec`의 `overview`, `creation`, `guide`, `schema`를 읽는다. `creation`은 현재 호스트의
   제작 도구 위치와 이 안내를 반환한다. 오프라인 제작은 가능하며 서버 등록 가능 여부는 `overview`로 확인한다.
2. [포함된 sprite-gen 스킬](../vendor/sprite-gen/SKILL.md)과 그 스킬이 지정한 시작 절차를 읽는다.
   [사용자별 설정·접근 확인](../vendor/sprite-gen/docs/user-workflow.md)을 따른다.
3. `npm run sprite -- workflow --kind sprite`로 접근 상태와 빠진 선택을 확인한다.
   질문이 남으면 종료 코드 2로 끝난다. 실패가 아니라 `questions`를 처리하라는 뜻이다.
   사용자가 이미 밝힌 원화 제공자·동작 방식·구독 접근 가능 여부는 다시 묻지 않는다.
   다른 사용자의 확인이나 이 예제의 GPT 선택을 현재 사용자의 계정 확인으로 취급하지 않는다.
4. 사용자가 GPT 원화·GPT 동작과 자신의 구독 사용 가능 여부를 확인한 경우:

```sh
npm run sprite -- workflow --kind sprite --image-provider codex --motion-method gpt-rows --confirmed-access codex
```

이는 준비 상태를 읽는 명령이다. `needs-input`이면 반환된 질문을 처리한다. 처음 실행할 때는
GPT를 사용할 수 없을 경우의 선택도 남아 있을 수 있다. Dot이 답을 대신 정하거나 설정을 저장하지 않는다.
`status: ready` 이후에 실제 생성 명령을 실행한다.
생성 계정은 각자 로그인한다. 소스가 포함됐다는 사실만으로 생성 구독·한도가 제공되는 것은 아니다.
API 과금 제공자로 임의 전환하지 않는다. 상위 도구의 종료 코드 75는 사용자 선택이 필요한 상태이므로 그대로 처리한다.

## 3. 원화 → 애니메이션 → AI Fighter 패키지

- 사용자 설명으로 **새 전신 원화**를 만든다. 원더루팡 화풍은 사용자가 그 화풍을 요청한 경우의 디자인 방향이다.
  이 공개 저장소는 원더루팡의 원본 그림을 포함하지 않는다. 사용자가 제공한 참조가 있으면 적법한 참조로 사용한다.
- AI Fighter의 시점은 오른쪽을 보는 정사영, 카메라 고도 16도, 몸높이 기준 400px이다.
  그림에서 실제 시점·정체성을 확인한 뒤 같은 원화를 모든 동작의 기준으로 삼는다.
- GPT 동작을 선택한 경우 [행별 제작 절차](../vendor/sprite-gen/docs/atlas-workflow.md)의
  `prepare → gen-set --provider codex → extract → compose-atlas → QA`를 사용한다.
  다른 동작 방식을 선택한 사용자는 `workflow`가 반환한 경로와 문서를 따른다.
  명령은 `npm run sprite -- <명령> ...`로 실행한다. 상대 경로는 npm을 실행한 폴더 기준이다.
  sprite-gen 문서처럼 절대 경로를 써도 된다.
  sprite-gen의 `manifest.json.frame_layout`과 선택된 `curated/` 결과에서 실제 프레임을 읽는다.
  생성 그림을 임의 격자로 자르거나 도형을 그린 것을 sprite-gen 결과라고 보고하지 않는다.
- 필수 11개 동작과 정확한 프레임 수·랜드마크는 AI Fighter spec/schema가 소유한다.
  특히 `walk`는 16칸, `run`은 12칸이다. 원화 생성 성공과 실제 보행 품질 통과는 다르다.
  [sprite-gen 동작 검수](../vendor/sprite-gen/docs/qa-motion.md)로 발 교대·루프·몸통 고정·접지·공격 준비/접촉/회수를 확인한다.
  실패한 걷기를 정지 프레임 복제나 시간 조절로 통과시키지 않는다.
- [보행 설계·검수 흐름](GAIT-REVIEW.md)을 따른다. 공통 좌표와 배율을 고정하고 프레임별 지지발을 계획한 뒤,
  실제 양발의 접지 구간을 `fighter:gait review`로 검사한다. 미검증 상태에서도 등록 전 미리보기를 먼저 보여준다.
- 검수한 동작은 아래 [패키지 만들기](#패키지-만들기-game-pack--fighterpack)로 AI Fighter 패키지로 바꾼다.
  시트·해시·크기·origin·접지를 손으로 만들지 않는다. sprite-gen manifest를 그대로 AI Fighter JSON이라고 제출하지 않는다.
- 결과 폴더는 `AI_FIGHTER_ROOT` 아래 `output/<새-선수>/`로 둔다. 그림의 생성 보고서와 동작 검수 근거는 별도로 보존한다.
- 사용자에게 실제 애니메이션을 보여준다. 사용자가 등록을 요청한 범위에서 같은 불변 패키지를 제출한다.
  수정한 패키지는 새 idempotencyKey를 사용하고, 동일 요청 재시도는 원래 키를 재사용한다.

### 패키지 만들기: game-pack → fighter:pack

1. 11개 동작의 sprite-gen 결과를 [game-pack](../vendor/sprite-gen/docs/game-pack.md) 요청 하나에 모은다.
   행 아틀라스는 `manifest.json`(모든 상태가 `<id>/<상태>`로 펼쳐진다), 영상 루프는 `<name>.strip.json`을 `source`로 쓴다.
   모든 항목에 `"display": { "body_height": 400 }`을 쓴다. 출처에 `body_h`가 없으면 공통 좌표로 제작된
   **중립 자세의 실제 키를 한 번 측정해** 같은 `source_body_height`로 쓴다. 웅크림·누움마다 외곽 높이를 재서 400px로 확대하지 않는다.
   `fighter:gait game-request`가 공통 기준 측정과 요청 생성을 지원한다. 다른 캔버스는 거절하며 체형 일치는 실제 그림에서도 확인한다.

```sh
npm run sprite -- game-pack --request game.json --out-dir pack
```

2. 계획 파일에 동작과 애니메이션의 대응, 접촉 단계, 랜드마크를 적는다. 그림으로 잴 수 없는 연출 판단이다.
   단계 번호는 game-pack 애니메이션의 재생 위치다(`frames` 배열의 0부터 센 번호). 다른 동작의 자세를 빌리는
   `dash.windup`·`recover`와 `fall.getUp`은 `{ "clip", "step" }`으로 적는다. 아래 숫자는 형식 예시다.

```json
{
  "gamePack": "pack/game-pack.json",
  "out": "../output/blue-cat",
  "localId": "blue-cat",
  "profile": { "name": "파란 고양이", "description": "파란 갑옷의 고양이 복서" },
  "motions": {
    "idle": { "animation": "cat/idle" },
    "walk": { "animation": "cat/walk", "gaitReview": "review-walk/review.json" },
    "run": { "animation": "cat/run", "gaitReview": "review-run/review.json" },
    "fightIdle": { "animation": "cat/guard" },
    "combo": { "animation": "cat/combo", "hitSequenceIndices": [2, 5, 8], "landmarks": { "spinStart": 4 } },
    "slam": { "animation": "cat/slam", "hitSequenceIndices": [3] },
    "dash": { "animation": "cat/dash", "hitSequenceIndices": [2],
      "landmarks": { "windup": { "clip": "fightIdle", "step": 0 }, "recover": { "clip": "fightIdle", "step": 1 } } },
    "block": { "animation": "cat/block", "hitSequenceIndices": [1] },
    "hit": { "animation": "cat/hit", "hitSequenceIndices": [1], "landmarks": { "recoil": 1, "stagger": [2, 3], "recover": [4, 5] } },
    "groggy": { "animation": "cat/groggy" },
    "fall": { "animation": "cat/fall", "hitSequenceIndices": [2],
      "landmarks": { "lieSequenceIndex": 3, "getUp": [{ "clip": "hit", "step": 4, "durationMs": 90 }, { "clip": "fightIdle", "step": 0, "durationMs": 90 }] } }
  }
}
```

3. 최종 game-pack의 walk/run을 `fighter:gait review`로 검수하고 실제 미리보기를 보여준다.
   `npm run fighter:pack -- plan.json`을 실행한다. 경로는 계획 파일 기준이다. 출력 폴더가 이미 있으면 거절한다.

`fighter:pack`이 그림에서 재는 값:

- **크기.** idle 몸높이를 재서 400px가 아니면(2% 초과) 모든 동작을 같은 비율로 다시 맞춘다. 게임은 `actor 높이 / bodyHeight`로
  그리므로 이 값이 틀리면 선수 크기가 틀린다. 도트 그림은 계획에 `"resample": "nearest"`를 쓴다.
- **프레임.** 같은 픽셀의 칸은 하나의 프레임이 된다(멈춘 단계). 걷기 16칸·달리기 12칸은 서로 다른 칸이어야 하며,
  반복 칸이 있으면 채워 넣지 않고 거절한다.
- **기준점·접지.** 동작마다 지면선은 그 동작에서 가장 낮은 발바닥이다. 기준점은 game-pack anchor의 x와 그 지면선이다.
  접지는 지면선 바로 위의 불투명 열 묶음(최대 2개)이다. 계획의 `origin`으로 덮어쓸 수 있다.
- **보행 근거.** 기본 `reviewPolicy: required`는 양발 측정과 시각 검수가 통과한 결과를 요구한다. 그림이나 시간이 바뀐 근거는 거절한다.
- **보폭.** 검수된 같은 발의 후방 이동 속도 × 주기 시간을 사용한다. `stridePixels` 수기 덮어쓰기는 거절한다.
  형식 fixture용 `format-only`에서는 기존 바닥 실루엣 추정을 쓸 수 있으나 발 정체성을 보장하지 않는 추정치로 보고한다.
- **초상·미리보기.** idle 몸 윗부분의 정사각형과 idle 전체 칸. `profile.portraitCrop`·`previewCrop`으로 바꿀 수 있다.

계약 검사를 통과하지 못하면 아무것도 쓰지 않고 오류를 JSON Pointer로 알린다. 통과하면 폴더를 한 번에 만들고
전체 파일 검사까지 실행한다. `pack-report.json`에 잰 값, 동작별 원본 프레임 키, game-pack 이벤트(접촉 후보)를 남긴다.
잰 값은 출발점이다. 사용자에게 실제 동작을 보여 주고 발 교대·접지·공격 박자를 확인한 뒤 등록한다.

`examples/sparring-bot`과 `npm run example`은 **연결·형식 테스트 전용**이다.
사용자 캐릭터 생성 요청에 이 도형 로봇을 복사하거나 이름만 바꿔 납품하지 않는다.
형식 검사 통과만으로 동작의 시각 품질이 보장되지는 않는다. 실제 애니메이션을 검수한다.

## 4. 자기 계정으로 등록

Google 로그인 후 누구나 제작·업로드할 수 있다. **초대나 사전 승인은 없다.** [현재 운영 정책](OPEN-REGISTRATION.md)을 따른다.
사용자 본인의 로그인 세션 파일을 `AI_FIGHTER_CLIENT_CONFIG`로 연결한 뒤 `submit_fighter_package`를 호출한다.
`registered`와 `fighterId`를 실제로 확인한다. 파일 검사 후 자동으로 게임에서 이용할 수 있다. 작업자가 꺼져 있으면 자동 검증 대기로 남는다.
기존 선수의 불변 파일을 덮어쓰지 않는다. 부적절한 선수는 사후 조치로 공개 목록에서 내려갈 수 있다.

사용자 요청 예시:

> 이 AI Fighter 저장소의 sprite-gen으로 내가 설명한 인간형 격투가를 만들어줘.
> 제작 규격과 creation 안내를 읽고 내 계정에서 가능한 생성 경로를 확인해.
> 새 원화와 필수 11개 동작을 만들고, 실제 애니메이션을 검수해서 보여줘.
> fighter.json과 WebP를 검사한 뒤 내 계정에 등록하고 홈페이지에서 실제 애니메이션까지 확인해줘.

sprite-gen은 [공식 저장소](https://github.com/aldegad/sprite-gen)의 고정 커밋을 서브모듈로 포함한다.
원본 Apache-2.0 [LICENSE](../vendor/sprite-gen/LICENSE)와 [NOTICE](../vendor/sprite-gen/NOTICE)를 보존한다.
