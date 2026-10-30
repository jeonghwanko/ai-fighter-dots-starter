# 모카 보행 생성: 제품 목표, 과정, 외부 검토 자료

기준일: 2026-10-23. 상태: **새 VACE 생성 보류, 제품 접근 재검토 중**.
최신 사용자 지시: 목표·과정·문제를 문서화하고, 사용자가 콘솔에서 직접 Claude에게 문의한다.
브라우저/Computer Use로 문의를 계속하지 않는다. 검토 질문은 같은 폴더의
`CLAUDE-LOCOMOTION-REQUEST.md`에 있다.
고객은 Dots 또는 Grok bots 등 한 서비스만 구독할 가능성이 높다.
별도 GPU·ComfyUI·VACE 설치나 추가 구독을 기본 해결책의 필수 조건으로 삼지 않는다.

## 목표와 제약

사용자가 대화에 설명/원화를 넣으면 보유한 생성 계정으로 외형이 일관된 게임 캐릭터를 만든다.
사용자는 설치·모델 연결·긴 설정표보다 외형/동작 미리보기에 피드백한다.
구독 권한, API 권한, 이미지/영상 접근은 별개이며 이름만 보고 같다고 가정하지 않는다.

모카: 큰 머리와 배, 짧은 다리, 청록 복싱 글러브, 버건디 반바지의 카피바라 복서.
승인 원화 SHA256: `28b723b2141df15245f490a9d0a8e4c999e70c55ca67b2531a1ac1d7dddfaf36`.
외형을 유지하면서 자연스러운 걷기·달리기를 만든다. v1 게임 계약은11동작, walk16/run12프레임이다.
이번 연구 범위는 두 보행 동작이다. 파일 형식 성공, 가이드 통과, 실제 동작 품질, 원화 동일성은 별도다.

- 기본 고객은 한 서비스만 구독. 추가 유료 API·생성 계정·GPU 서버를 숨은 조건으로 넣지 않는다.
- 같은 구독에 영상 기능이 실제 있으면 검토 가능하다. 현재 제공 기능·자동화 가능성·잔여량은 따로 확인한다.
- 이미지 전용 환경의 실패를 다른 공급자로 조용히 전환해 성공했다고 표현하지 않는다.
- 원화·기존 실패·승인 자산·실제 호출 기록 보존. 새 가설 없이 같은 재생성을 반복하지 않는다.
- 정지 몸통에 분리 다리를 붙이기, 다리 복제, 매 프레임 바닥 정렬로 결함을 숨기는 합성을 해결로 인정하지 않는다.
- A/B는 물리적 다리 ID다. 화면 좌우가 바뀌어도 재명명하지 않는다. 가려진 발은 추측해 채점하지 않는다.
- 전체 시퀀스 전에 첫 포즈가 거절된 실험을 완성된28프레임 영상의 실패로 요약하지 않는다.

## 현재 코드의 실제 구조

### GPT / sprite-gen

`연속 phase → IK / world foot lock → 포즈·부위·깊이 가이드 → 일반 이미지 참조 → 한 장 생성 → 사후 검사`

`vendor/sprite-gen/sprite_gen/gen/gen_motion.py`는 한 목표 포즈씩 생성한다.
참조 순서는 목표 가이드, 승인 원화, 검수된 anchor(있을 때), visible/depth와 amodal/X-ray다.
`codex_provider.py`는 Codex가 실행하는 `image_gen`에 `referenced_image_paths`를 전달하도록 요청하고
실제 도구 호출 흔적을 별도로 저장한다. 요청 프롬프트와 실제 도구 프롬프트가 동일하다고 가정하지 않는다.

이는 **일반 참조 이미지 조건부 생성**이다. IK가 생성기 내부 관절/픽셀을 직접 고정하지 않는다.
호출 간 시간축 latent, optical-flow 제약, 학습된 pose/depth 모듈을 공유하는 구현은 없다.
anchor를 다음 이미지 참조로 쓰는 것은 영상 모델의 시간 일관성 학습과 다르다.
비공개 모델 내부 구조는 확인하지 않았다. 해시/검수 장치는 실패 검출을 개선하며 생성기의 학습 능력을 추가하지 않는다.

### 결정론적 가이드

`scene/gait.py`: A/B 반주기 차이, 접지 발의 세계 좌표 고정, 두 뼈 길이 고정, 도달 불가 IK 거절.
카메라가 몸을 따라가면 접지 발은 화면에서 뒤로 움직인다. 화면 X 고정이 foot lock은 아니다.
발 X 이동은 quintic smootherstep, 높이는 `clearance * 64*u^3*(1-u)^3`.
`gait_render.py`: 깊이 버퍼로 가려짐 계산, X-ray 관절과 실제 보이는 부위 마스크 구분.
원화의 숨은 관절/깊이는 복원한 사실이 아니라 명시한 가정이다.

### VACE 연구 경로

원격 RTX4060 8GB + ComfyUI + Wan VACE1.3B. 원화+depth 제어 영상.
832×480,49프레임,16fps,20steps,cfg6,shift8,strength1,seed20261023,LoRA 없음.
이는 제어 영상·디코더의 기여를 분리한 실험이며 **고객 기본 경로로 확정된 것이 아니다**.

## 단계별 경과

| 단계 | 바꾼 것 | 결과와 한계 |
|---|---|---|
| 초기 GPT 행 생성 | phase 문구, keypose/전체 행, 공통 좌표·배율, 원본 Y 보존 | 발 교대·형태·접지 문제 반복. 바닥 정렬로 flight가 지워지는 문제 분리/수정 |
| v2–v4 | 한 호출에 whole-body 포즈 하나, 목표 우선 참조, anchor, 실제 dispatch, 캔버스 검사 | 전달/캔버스 오류 일부 수정. 가이드를 출력에 강제하는 연결은 없음 |
| v5 | 원화 랜드마크, 실제 발 윤곽/heel/toe, 몸 기준 제한적 scale/translation 검사 | walk/run 각각1회, 승인 anchor0. 숨은 heel·몸 잔차·지지발 불일치. 보정 PNG/전체 시퀀스 생성 안 함 |
| v6 gait+GPT | phase/IK/foot lock, depth/visible/amodal, 전체 입력 검사 | 입력28개 통과와 출력 통과가 별개. 초기 run 캔버스 오류 수정 후 재시험에서도 발 위치 불일치 |
| VACE01 | 일반 proxy depth+원화,T16 | 체형 차이·발 문제·주기적 잔상 |
| 체형 가이드 보정 | 원화 머리/배/반바지 실루엣의2.5D 부피, 짧은 다리, 의상 가려짐 | 정지 실루엣 일치 개선. 숨은3D 해부학/동작 성공 증명 아님 |
| VACE03 | 보정 가이드,T64,post-trim latent 선저장 | 두 영상 생성 완료. 외형과 큰 흐름의 교대 개선. 일부 발 뭉개짐/뒤집힘, 전체 접지·가려짐 미검증. 둘 다 미승인 |
| 이번 v7 | 최종 투영·샘플링의 공중 높이 검사 | 기존 <1px flight 가이드를 거절. 관련13테스트 통과. 새 AI 결과 없음 |

v6 추가 run 재시험의 실제 도구 호출에는 참조4개와 정사각형 문구가 있었다.
몸 기준 정렬 계산 후 최대 몸 잔차10.66px는 당시12.288px 기준 안이었다.
반면 발끝 오차 A60.43px/B131.91px는20.48px 기준 밖이었다.
마지막 실패를 단순 참조 누락이나 전신 형태 붕괴만으로 설명할 수 없다.
수치는 관찰 랜드마크와 가정한 카메라에 조건부이며 보정 이미지를 만들었다는 뜻이 아니다.
전체 시퀀스는 없으므로 교대·미끄럼·루프 전체를 검증했다고 할 수 없다.

## VACE03에서 분리한 문제

### 디코딩

같은 저장 walk latent를 T16/T64로 디코딩했다. 추가 diffusion0회.
T64 재실행49프레임은 최초 T64와 픽셀 단위 동일(max RGB diff0).
T16은14/26/38 부근에 큰 색·밝기·가장자리 차이가 반복됐다.
그런데 발 변형이 있는6–9프레임의 해당 영역은 T16/T64 차이가0이었다.
시간 분할은 잔상의 한 원인이지만 남은 발 문제 전체를 설명하지 않는다.
T64는 이 모델/길이에서 검증한 설정이며 모든 영상에 적용하는 상수가 아니다.

### 실제로는 읽히지 않는 flight 가이드

run duty0.4,clearance0.22,49프레임16fps,scale163.125px/unit,elevation16°.
flight 표시9샘플의 양발 중 낮은 발 높이가 모두1px 미만, 최대0.9369px였다.
각 발의 자기 지면 투영점 대비 높이이며, 전후 발의 서로 다른 화면Y를 침투로 착각한 측정이 아니다.
수학적 비접지 상태와 화면에서 읽히는 공중 동작은 다르다.

### 남은 미확정 사항

- 가려짐/재출현 전체에 걸친 물리적 A/B 대응, 변형된 발의 heel/toe, 접지 중 미끄럼.
- 평평한 타원형 proxy 발이 출력 발 뭉개짐에 얼마나 기여하는지.
- 전체 몸 중심/크기 정량 통과, loop/alpha 품질.
- 가이드만 고치면 GPT 또는 VACE가 성공할지 여부.

## 현재 작업 상태

### v8 (Claude 검토 반영, 2026-10-23)

- 패치 id `ai-fighter-gpt-motion-v8-semantic-coverage`. v7 이하 해시에서 upgrade, gitlink 유지.
- 검토 결론: 이미지 모델은 의미적 포즈는 따르지만 픽셀 좌표는 따르지 않는다(run02: 좌표 문장 전부 도달,
  출력 1254px, 몸이 약 100px 아래로 이동해 `body:translation_out_of_bounds`, B 발끝 132px).
  위 단계표의 "몸 잔차 기준 안"만으로는 이 배치 실패가 빠져 있었다.
  정정: 배율 0.8496의 `scale_out_of_bounds`는 기존 주석에서만 나온다. 독립 주석에서는 0.858~0.860이다.
- 새 gait-motion run은 contract 5: 의미적 포즈 프롬프트, 진단용 가이드 기하, 선언된 hidden 점,
  접지 구간별 `contact-coverage.json` 게이트. contract 3/4 run의 기록·차단 규칙은 그대로다.
- `gait.sample`의 run 공중 구간 원인은 수식 구조였다(공중은 한 발 swing 시작·다른 발 끝에만 있고
  `64u³(1-u)³`이 양 끝에서 0). 선택 항목 `flight_lift`로 duty 0.4에서도 공중이 읽힌다.
  예제는 duty 0.4·flight_lift 0.15로 되돌렸고, v7에서 깨져 있던 native-ray flight 테스트가 다시 통과한다.
- **v8 검증은 오프라인 테스트뿐이며 새 생성 호출은 0회다.**

### 주석 반복성 실험 01 (생성 0회)

`output/mocha-work/experiments/annotation-repeatability-01/`. run02·walk04 출력에 블라인드 주석자 둘과
기존 Codex 관찰(C)을 비교했다.

- 같은 정의 안에서 클릭 오차는 몸 σ≈0.8px, 발 σ≈1.8px(쌍 차이 최대 3.2px)다.
- 0.3% 접지 허용치(3.07px)는 이보다 좁다. run02 A 뒤꿈치 접지 판정이 주석자에 따라 갈렸다.
- 0.6% coverage 허용치는 같은 정의에서 버틴다(넘은 쌍 0건). 2% 발 목표 판정은 바뀐 사례가 없다.
  발 목표 오차 57~144px는 주석 오차로 설명되지 않는다.
- 1.2% 몸 허용치와 배율 0.85 하한은 경계에 걸려 주석자에 따라 판정이 바뀐다.
- 큰 차이는 정의 모호함에서 나온다: 정면 발의 발끝 80px, 콧구멍 끝 23px.
  확대해 보니 C의 walk04 콧구멍 점은 두 콧구멍 사이의 주둥이 주름선 위에 있었고,
  정면 발 발끝 점은 발가락 패드 사이의 오목한 곳이었다.
- 반영: contract 5 coverage는 몸 잔차가 2.4%를 넘는 프레임만 발 근거에서 뺀다(1.2% 대신).
  콧구멍 끝·발끝·heel 정의를 `docs/GAIT-REVIEW.md`와 vendor `docs/pose-motion.md`에 고정했다.
- 한계: 블라인드 주석자 둘이 같은 모델이고 이미지 2장뿐이다. 0.6%는 여전히 임시값이다.

### v7

- 패치 id `ai-fighter-gpt-motion-v7-screen-flight`. 알려진 기존 해시만 받는 upgrade, gitlink 유지.
- `gait.py`의 새 `screen_audit`: canonical frame과 실제 video timestamp를 각각 검사 가능.
- 달리기 두 반주기 각각에 양발 이격>=4px 샘플 필요. 낮은 전환 프레임은 보존한다.
  4px는 설계 허용치이며 물리 법칙이나 생성 성공 보증이 아니다.
- 번들 예제 run duty0.4→0.25. 기존 실험/가이드/원화는 변경하지 않았다.
- 이 검사도 숨은 발·윤곽·가려짐을 못 본다. raster와 AI 출력 검수는 별도다.
- Python gait 테스트13개 통과. 최초 테스트의 임시폴더 sandbox 권한 오류는 저장소 내부 임시폴더로 해결했다.
- 관련 kit 회귀 검사27개도 통과했다 (`gpt-motion`, `gait`, `gait-engine`, `pack`).
  로그: `output/mocha-work/experiments/vace-04/kit-tests.log`. 생성 호출 없는 코드 검사다.
- `output/mocha-work/experiments/vace-04/upgrade_patch.py`는 이번 알려진 바이트 갱신 기록이다.
  이미 적용된 상태에서 반복 실행하는 idempotent 배포 도구가 아니다.
- **vace-04 diffusion 제출0회. 새 가이드 영상/latent/실제 출력 없음.**
- 최신 사용자 방향에 따라 VACE 재생성 보류. 더 많은 VACE 튜닝을 자동 진행하지 않는다.
- 직전 원격 확인: ComfyUI queue empty, VoiceStudio healthy. 이번 작업에서 서비스 중단 없음.
- 자동 Claude Code 문의는 조직의 구독 접근 제한(403)으로 모델 처리 전에 거절됐다.
  답변은 없으며 API 키/유료 경로로 전환하지 않았다. 웹 문의도 전송하지 않았다.
  사용자가 직접 콘솔에서 검토를 실행한다. Claude의 검토 완료로 오인하지 않는다.

## Claude에게 묻는 의사결정

목표는 VACE 튜닝이 아니라 한 구독으로 가능한 제품 전략과 최소 다음 실험이다.

1. 입력/전달 오류, 생성기 제어 한계, 체형/가려짐 모델링, 후처리, 평가 설계 중
   확실한 사실과 반박 가능한 가설을 나눠 달라.
2. 이미지 전용 / 같은 구독에서 영상 가능 / 실제 편집·마스크 기능 보유 경우를 나눠 비교해 달라.
   최신 기능을 모르면 확인 항목으로 남겨 달라.
3. 다중 참조, 전체 시트1회, 포즈별 생성, 순차 편집, 같은 구독의 image-to-video 중 무엇을 우선할 것인가?
4. 생성 모델에 접지를 요구하는 것과 결정론적 렌더러가 접지를 소유하는 것의 경계는 어디인가?
   완전한 캐릭터 리그가 필요하면 가려진 면·작성 노동·외형 손실 비용까지 설명해 달라.
   정지 몸통+다리 합성을 이름만 바꿔 재제안하지 말라.
5. guide 좌표 일치와 자연스러운 동작 평가를 분리해야 하는가? 숨은 heel을 매번 요구하는
   검사 때문에 좋은 동작도 막히는지 검토하되 unknown→pass 우회는 하지 말라.
6. 정확히 어느 코드 경계를 바꿀지, 어떤 증거를 남길지, 최대2개의 최소 실험과 호출 상한·중단 기준을 제시해 달라.
7. 이미지 전용 구독에서 현재 보장할 수 없는 것을 명시해 달라.

## 증거 위치

아래는 저장소 루트 기준. `output/`은 로컬 증거이며 Git 배포에 포함됐다고 가정하지 않는다.
문의에는 이 문서와 필요한 비식별 증거만 제공한다. 자격증명·계정 설정·홈 폴더는 필요 없다.

| 내용 | 경로 |
|---|---|
| 피드백/작업 기록 | `output/mocha-work/creation-notes.md` |
| 기존 연구 및 공식/논문 출처 | `output/mocha-work/research/2026-10-23-locomotion-research.md` |
| 최종 GPT 재시험 | `output/mocha-work/artifacts/locomotion/v20261023-gait-gpt-01/run02-canvas-retest-01/outcome-and-evidence.json` |
| 실제 GPT 도구 프롬프트 | 위 폴더의 `actual-image-tool-source.txt` |
| GPT 비교 PNG | `output/mocha-work/artifacts/locomotion/v20261023-gait-gpt-01/v6-comparison-with-run02-retest.png` |
| v5 판정 | `output/mocha-work/artifacts/locomotion/v20261023-v5-01/v5-outcome-and-evidence.json` |
| VACE03 판정 | `output/mocha-work/experiments/vace-03/assessment.json` |
| 같은 latent 디코더 실험 | 위 폴더의 `decoder-assessment.json` |
| 가이드와 실제 영상 | 위 폴더의 `review.html`, `review/{walk,run}-comparison.mp4` |
| 모든 실제 발 프레임 | 위 폴더의 `review/{walk,run}-all-feet.png` |
| 원화/이전/현재 외형 | 위 폴더의 `review/walk-identity-before-after.png` |
| 실제 실행/latent/해시 | 위 폴더의 `execution-status.json`, `output-hashes.json`, `outputs/{walk,run}/*.latent` |
| 코드 | `vendor/sprite-gen/sprite_gen/{gen,scene,spec}/`, 당시의 `scripts/sprite-patch.mjs`·`patches/README.md`(2026-10-27 sprite-gen-agent 고정으로 지움, git 기록에 있다) |
| 제품/검수 계약 | `docs/CREATION-UX.md`, `docs/GAIT-REVIEW.md`, `docs/DOT-CREATION.md`, `AGENTS.md` |

## 판단 범위

이 문서는 관찰 기록과 코드 점검의 인수인계다. 비공개 모델 내부를 입증한 연구가 아니다.
현재 구독별 기능·한도·UI/API 접근은 추가 확인 전 미확정이다.
Claude의 응답도 설계 의견으로 별도 보존하며 실제 결과나 사용자 승인으로 승격하지 않는다.
