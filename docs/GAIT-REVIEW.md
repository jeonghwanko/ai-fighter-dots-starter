# 보행 설계와 등록 전 검수

sprite-gen은 이 저장소의 `vendor/sprite-gen` 고정 커밋으로 설치된다. 설치만으로 모든 검수가 자동 실행되는 것은 아니다.
추출·아틀라스 검사, `qa-motion.md`의 시각 검수 절차, `inspect-motion`의 조건부 접지 측정이 각각 있다.
이 저장소의 `fighter:gait`는 이 결과를 한 흐름으로 연결하고, `fighter:pack`은 기본적으로 현재 walk/run과 일치하는 검수 결과를 요구한다.
서버 파일 검사는 형식·파일 무결성 검사다. 캐릭터의 양발을 자동 인식하거나 시각 품질을 승인하는 기능으로 설명하지 않는다.

## 1. 원화와 공통 좌표를 고정

중립 전신 원화에서 외형·머리 크기·팔다리 길이·시점·팔레트를 확정한다. 같은 제작 묶음은 같은 셀 크기, 여백, 기준점과 물리적 배율을 사용한다.
중간 프레임마다 `safe_margin_y`를 바꾸거나 각각 다른 크기로 맞추지 않는다. 서로 다른 실행의 그림을 합치면 공통 좌표와 체형을 다시 확인한다.

걷기는 지지발이 있는 주기이므로 공식 추출기의 공통 하단 정렬을 쓸 수 있다. 이것은 위치 정렬이며 올바른 발 교대의 증거가 아니다.
달리기·점프의 공중 자세는 모든 프레임을 바닥에 붙이면 안 된다. 현재 핀의 `ground_frames: false`는 pixel-unfake 배치 경로에 적용되며,
일반 painted-art component/slot 추출의 바닥 정렬 해제를 보장하지 않는다. 아래 공중 프레임 보존 계약을 따른다.

한 자세의 외곽 높이는 캐릭터의 서 있는 키와 다르다. 웅크림·넘어짐·팔 뻗기마다 높이를 400px로 다시 맞추지 않는다.
공통 좌표로 제작된 결과는 중립 자세에서 잰 키를 모든 동작에 사용한다. 다음 명령은 같은 캔버스인지 검사하고 기준 키를 한 번만 측정한다.
서로 다른 크기로 그려진 캐릭터를 캔버스 크기만 같게 만든 것은 공통 배율이 아니므로 시각 검수가 여전히 필요하다.

```json
{
  "reference": { "file": "sprites/manifest.json", "state": "idle", "frame": 0 },
  "assets": [
    { "id": "cat-idle", "source": { "file": "sprites/manifest.json", "state": "idle" } },
    { "id": "cat-walk", "source": { "file": "sprites/manifest.json", "state": "walk" } }
  ]
}
```

```sh
npm run fighter:gait -- game-request common-scale.json game.json
npm run sprite -- game-pack --request game.json --out-dir pack
```

## 2. 생성 전에 보행 설계표 작성

```sh
npm run fighter:gait -- init output/my-walk
```

새 폴더에 `gait-plan.json`, `sprite-request.json`, `phase-guide.png`가 생성된다. 계획과 포즈 가이드는 제작 지시이며 결과 검증 자료가 아니다.
`near`는 기준 원화에서 카메라에 가까운 같은 다리, `far`는 먼 같은 다리다. 화면에서 앞에 있는 발을 계속 near라고 바꾸어 부르면 안 된다.
기본 걷기는 16칸의 한 주기이고 0번과 8번에서 실제 다리 역할이 바뀐다. 양쪽 착지·지지·통과 자세를 먼저 확인한 뒤 중간 자세를 생성한다.
기존 sprite-gen 행 제작 경로를 사용한다. 추가 포즈 참조를 사용했다면 실제 생성 명령과 `qa-notes.md`에 기록한다.
프레임 수를 맞추려고 복제·속도 변경·실패한 반주기 반복을 하지 않는다.

run은 계획의 `motion`을 `run`으로 하고 12개 phase와 실제 지지·공중 구간을 명시한다. 생성 요청도 12칸으로 맞춘다.
현재 자동 생성되는 포즈 가이드는 walk 전용이다.

## 3. 같은 발의 접지를 측정

먼저 실제 manifest로 미검증 미리보기를 만든다. 종료 코드 2는 파일 생성 실패가 아니라 품질 미통과다.

```sh
npm run fighter:gait -- review output/my-walk/gait-plan.json output/my-walk/review
```

plan의 `source.file`은 plan 기준 상대 경로다. atlas는 `state`를, 최종 game-pack은 `animation`을 지정한다.
geometry는 해당 단계의 실제 좌표를 사용한다. game-pack 배율이 달라졌다면 지면선과 발 영역도 다시 측정한다.

```json
{ "file": "pack/game-pack.json", "animation": "cat-walk/walk" }
```

`review/annotations-template.json`의 현재 sequence 해시를 유지한다. 실제 그림을 보고 identity/anatomy/alternation/loop를
각각 `pass`, `fail`, `unverified`로 기록한다. 시트와 정상 속도 반복 재생을 모두 확인하며 한쪽만 보고 통과시키지 않는다.
발 구분이 불확실하면 `unverified`다. 생성 프롬프트에 쓰인 동작을 실제 관찰 결과로 복사하지 않는다.

stances에는 같은 발이 지면에 붙어 있는 연속 구간과 그 발만 들어가는 고정 ROI `[x,y,width,height]`를 적는다.
near와 far 각각 세 개 이상의 서로 다른 관찰 자세가 필요하다. 다른 발·몸통이 ROI에 들어가거나 발이 가려져 추적이 끊기면 측정할 수 없다.
다음은 구조 예시이고 실제 좌표나 구간으로 복사해서 쓰면 안 된다.

```text
stances: [
  { foot: "near", start: <첫 프레임>, end: <끝 프레임>, box: [<x>, <y>, <w>, <h>] },
  { foot: "far",  start: <첫 프레임>, end: <끝 프레임>, box: [<x>, <y>, <w>, <h>] }
]
```

```sh
npm run fighter:gait -- review output/my-walk/gait-plan.json output/my-walk/review output/my-walk/annotations.json
```

도구는 원본 manifest 또는 game-pack의 정확한 프레임과 재생 시간을 읽어 측정용 PNG 스냅샷을 저장한다.
그림의 크기·위치·순서·시간은 바꾸지 않는다. 이 스냅샷을 공식 `inspect-motion`에 넘겨 발 영역의 알파 중심 이동,
지면선 안정성, 서로 다른 자세, 방향과 속도 일관성을 검사한다. 자체 이미지 추출·수선 엔진으로 sprite-gen을 대체하지 않는다.

`inspect-motion`의 속도 단위는 px/s다. 보폭은 검증된 속도 × 한 주기 시간으로 계산한다.
양발의 측정 방향이 다르거나 속도가 25% 이상 벌어지면 통과시키지 않는다. 25%는 현 도구의 휴리스틱이며 실제 정확도 확률이 아니다.
지면 오차는 plan의 `groundTolerance`로 검사하며 기본 512px 셀의 3px도 초기 검수 기준이지 모든 그림에 보장되는 품질 기준이 아니다.
검수자는 기준을 바꾸어 오류를 숨기지 말고 변화의 근거를 기록한다.

## 4. 등록 전 미리보기와 패키징

`preview.html`은 등록·로그인·외부 서버 없이 열리는 단일 파일이다. 정상/저속 재생, 프레임 이동, 지면선과 발 영역을 제공한다.
검수에 실패해도 미리보기와 contact-sheet를 만든다. 이동 재생은 보폭이 검증된 경우에만 활성화된다.
계획상 지지발과 실제 관찰·측정을 구분해서 표시한다. 실패를 통과로 보이게 프레임이나 재생 시간을 바꾸지 않는다.

패키징 계획의 walk/run에 최종 game-pack에서 검사한 결과를 지정한다.

```json
{
  "walk": { "animation": "cat-walk/walk", "gaitReview": "review-walk/review.json" },
  "run": { "animation": "cat-run/run", "gaitReview": "review-run/review.json" }
}
```

`fighter:pack`의 기본 `reviewPolicy`는 `required`다. 미검증·실패·다른 프레임·바뀐 시간의 결과를 거절한다.
walk의 보폭은 이 근거에서 받아오므로 `stridePixels`를 수기로 덮어쓰지 않는다.
`reviewPolicy: "format-only"`는 형식 테스트 fixture용 명시적 예외이며 결과 보고서에 시각 품질 미검증을 남긴다.
이를 일반 캐릭터의 검수 통과 우회로로 쓰지 않는다. 서버 계약은 이 로컬 검수 결과를 보안 인증서로 신뢰하지 않는다.

부츠 굽·앞창의 분리된 접촉면 때문에 공식 검사만 미검증인 경우 [명시적 양발 윤곽 근거](FOOT-EVIDENCE.md)를 사용할 수 있다.
이것은 AI Fighter가 유지하는 선택적 검사 확장이며 공식 검사 결과도 함께 보존한다. 다른 실패나 시각 검수를 대신하지 않는다.

## 달리기 공중 프레임 보존 계약

현재 `extract`의 painted-art component 경로와 `--allow-slot-fallback`은 여전히 각 그림을 셀에 맞춰 배치한다.
`fit.ground_frames=false` 또는 slot 옵션만 보고 원본의 수직 위치가 보존됐다고 판단하지 않는다.
`slice-sheet --scale sheet`도 공통 배율과 별개로 각 그림의 밑부분을 baseline에 놓으므로 공중 동작 보존 수단이 아니다.
따라서 현재 painted 행/컴포넌트 생성·추출 경로를 그대로 유지한다는 조건에서는 공중 높이 보존이 미지원이다.
아래 PNG 경로는 이미 공통 캔버스가 보존된 입력을 위한 별도 지원 경로이며, 기존 행의 오프셋을 복구하는 옵션이나
grid 일괄 생성으로 전환하라는 지침이 아니다. 해당 입력이 없다면 run 검수를 미완료로 남기고 추출기 개선이 필요하다고 기록한다.

이미 같은 크기·배율·고정 카메라·기준 지면으로 제작된 투명 PNG들이 있으면 공식 `sprite-gen-asset` descriptor에
각 PNG와 실제 재생 시간을 명시하고 `game-pack`으로 직접 전달한다. `game-pack`은 셀 전체를 같은 배율로 바꾸며 프레임별 알파 하단을 정렬하지 않는다.
중립 원화의 `source_body_height`를 모든 동작에 공통 적용한다. 이미 바닥 정렬돼 사라진 공중 높이를 이 단계가 복원하지는 못한다.

```json
{"kind":"sprite-gen-asset","version":1,"anchor":[256,460],"frames":[
  {"file":"run-00.png","duration":0.0625},
  {"file":"run-01.png","duration":0.0625}
]}
```

위는 descriptor 구조 예시이며 실제 run에는 12개 서로 다른 프레임이 필요하다. PNG들이 이미 공통 캔버스를 공유한다면
`unpack-atlas --pngs-dir`로 가져오는 공식 경로도 원본 크기의 셀을 유지한다. 자동 컴포넌트 bbox 탐지·중앙 재배치는 쓰지 않는다.
실제로 규칙적인 셀에 그려진 시트는 공식 row-major grid descriptor로 해당 셀을 읽을 수 있지만,
임의 AI 행 이미지에 균등 격자를 가정해 잘라 쓰지 않는다. 프레임이 경계를 넘거나 셀 기준점이 다르면 먼저 제작 결과를 수정한다.

현재 run gate는 12개 고유 프레임, 공통 캔버스·지면 좌표, 양쪽 단독 지지 phase, 양발 각각 3개 이상의 실제 접지 관찰을 요구한다.
공중 phase는 `support: []`로 기록한다. 지지 phase에만 하단 지면 오차를 검사하므로 **공중 phase가 실제로 떠 있는지를 자동 증명하지 않는다**.
`flight: true` 텍스트만으로 합격되지도 않는다. 실제 공중 자세와 높이 보존은 시트·정상/저속 재생에서 시각 검수해야 한다.
최종 `game-pack`에서 다시 검수하고, 패키징은 공통 groundY와 동일한 크롭/원점을 써 상대적인 수직 오프셋을 유지한다.

수정 시 관련 테스트는 `node --test test/gait.test.mjs test/pack.test.mjs`로 실행한다.
기존 실패 시퀀스의 지면 오차, 양발 근거 누락, 보폭 단위, 검수 해시 만료, 자세별 과대 확대와 미리보기 생성이 회귀 검사 대상이다.
