# Dot에서 내 선수 만들기

Dot이 이 저장소에 포함된 **sprite-gen**으로 사용자의 새 선수 원화와 애니메이션을 만든다.
사용자는 만들고 싶은 캐릭터를 설명한다. Dot은 제작 도구 실행, AI Fighter 패키징, 검사와 요청받은 등록을 맡는다.
각 사용자의 로컬 실행 환경과 본인의 생성 계정을 사용한다. 제작자의 로그인·토큰·서비스 키를 배포하지 않는다.

## 1. 제작 도구 받기

터미널과 로컬 파일을 사용할 수 있는 Dot/Codex 호스트에서 실행한다. 로컬 실행 기능이 없는 웹 호스트에는
이 설치 명령을 실행했다고 말하지 않는다. 호스트 지원 여부를 먼저 확인한다.

```sh
git clone --recurse-submodules https://github.com/jeonghwanko/ai-fighter-dots-starter.git
cd ai-fighter-dots-starter
npm ci --ignore-scripts
npm run sprite:setup
npm run sprite:status
```

Git·Node 22.12+·Python 3.11+가 필요하다. 기존 checkout은 `git submodule update --init -- vendor/sprite-gen`으로
같은 커밋을 받는다. GitHub ZIP에는 서브모듈 내용이 없으므로 위 Git clone을 사용한다.
`sprite:setup`은 `vendor/sprite-gen/.venv`에 도구를 설치한다. 전역 sprite-gen이나 운영자 PC 경로에 의존하지 않는다.
Python 탐지가 필요한 호스트는 `AI_FIGHTER_BOOTSTRAP_PYTHON`에 Python 실행 파일 경로를 지정한다.
해당 변수는 venv 생성에만 쓴다. 생성과 추출은 항상 포함된 도구의 venv에서 실행한다.

## 2. Dot이 읽을 규칙과 계정 선택

1. `get_fighter_spec`의 `overview`, `creation`, `guide`, `schema`를 읽는다. `creation`은 현재 호스트의
   제작 도구 위치와 이 안내를 반환한다. 오프라인 제작은 가능하며 서버 등록 가능 여부는 `overview`로 확인한다.
2. [포함된 sprite-gen 스킬](../vendor/sprite-gen/SKILL.md)과 그 스킬이 지정한 시작 절차를 읽는다.
   [사용자별 설정·접근 확인](../vendor/sprite-gen/docs/user-workflow.md)을 따른다.
3. `npm run sprite -- workflow --kind sprite`로 접근 상태와 빠진 선택을 확인한다.
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
  명령은 `npm run sprite -- <명령> ...`로 실행한다. 파일 인수는 절대 경로를 쓴다.
  sprite-gen의 `manifest.json.frame_layout`과 선택된 `curated/` 결과에서 실제 프레임을 읽는다.
  생성 그림을 임의 격자로 자르거나 도형을 그린 것을 sprite-gen 결과라고 보고하지 않는다.
- 필수 11개 동작과 정확한 프레임 수·랜드마크는 AI Fighter spec/schema가 소유한다.
  특히 `walk`는 16칸, `run`은 12칸이다. 원화 생성 성공과 실제 보행 품질 통과는 다르다.
  [sprite-gen 동작 검수](../vendor/sprite-gen/docs/qa-motion.md)로 발 교대·루프·몸통 고정·접지·공격 준비/접촉/회수를 확인한다.
  실패한 걷기를 정지 프레임 복제나 시간 조절로 통과시키지 않는다.
- 모델이 만든 동작을 확인한 뒤 정적 투명 WebP 시트로 변환한다. AI Fighter `fighter.json`에는
  실제 측정한 frame-local origin, crop, 재생 시간, 접촉 단계와 해시·크기를 기록한다.
  sprite-gen manifest를 그대로 AI Fighter JSON이라고 제출하지 않는다.
- `output/<새-선수>/fighter.json`과 `assets/*.webp`를 만들고 JSON·패키지 검사를 통과시킨다.
  이 경로는 `AI_FIGHTER_ROOT` 아래여야 한다. 그림의 생성 보고서와 동작 검수 근거는 별도로 보존한다.
- 사용자에게 실제 애니메이션을 보여준다. 사용자가 등록을 요청한 범위에서 같은 불변 패키지를 제출한다.
  수정한 패키지는 새 idempotencyKey를 사용하고, 동일 요청 재시도는 원래 키를 재사용한다.

`examples/sparring-bot`과 `npm run example`은 **연결·형식 테스트 전용**이다.
사용자 캐릭터 생성 요청에 이 도형 로봇을 복사하거나 이름만 바꿔 납품하지 않는다.
형식 검사가 통과해도 시각 품질·경기 출전 승인을 자동으로 얻는 것은 아니다.

## 4. 자기 계정으로 등록

제작과 로컬 검사는 누구나 사용할 수 있다. 현재 Supabase 등록은 **초대 베타**다.
사용자 본인의 베타 세션 파일을 `AI_FIGHTER_CLIENT_CONFIG`로 연결한 뒤 `submit_fighter_package`를 호출한다.
`registered`와 `fighterId`를 실제로 확인한다. 출전 승인은 별도이며 작업자가 꺼져 있으면 검증 대기로 남는다.
기존 선수의 불변 파일을 덮어쓰지 않는다. 공개 OAuth·누구나 가입 가능한 등록은 아직 별도 작업이다.

사용자 요청 예시:

> 이 AI Fighter 저장소의 sprite-gen으로 내가 설명한 인간형 격투가를 만들어줘.
> 제작 규격과 creation 안내를 읽고 내 계정에서 가능한 생성 경로를 확인해.
> 새 원화와 필수 11개 동작을 만들고, 실제 애니메이션을 검수해서 보여줘.
> fighter.json과 WebP를 검사한 뒤 내 베타 계정에 등록해줘.

sprite-gen은 [공식 저장소](https://github.com/aldegad/sprite-gen)의 고정 커밋을 서브모듈로 포함한다.
원본 Apache-2.0 [LICENSE](../vendor/sprite-gen/LICENSE)와 [NOTICE](../vendor/sprite-gen/NOTICE)를 보존한다.
