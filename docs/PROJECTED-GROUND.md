# 양발의 투영 지면 검토

`ai-fighter-projected-ground-v1`은 카메라 고도 때문에 가까운 발과 먼 발의
화면상 바닥 높이가 다른 경우를 다루는 제작 키트의 명시적 검토 확장이다.
sprite-gen 소스·핀·접지 검사·허용치는 바꾸지 않는다.

기본 단일 지면 검사는 그대로 실행되고 `scalarGeometry`에 보존된다.
아래 증거가 모두 통과할 때에만 `GROUND_OFFSET`의 단일 지면 가정을 대체한다.
중복 프레임, 잘림, 양발의 독립된 3프레임 이상 접지 측정, 속도·방향·정체성·해부학·루프
검사는 그대로 필요하다. 최종 패키징 때에도 실제 픽셀에서 증거를 재검사한다.

`annotations.projectedGround`에 다음 항목을 넣는다.

- `kind: "ai-fighter-projected-ground-evidence"`, `version: 1`
- 현재 시퀀스의 `sequenceSha256`, 실제 검토 주체 `reviewer`, 관측 방법 `notes`
- 모든 프레임을 순서대로 담은 `frames`: `index`, `near`, `far`
- 각 발은 `status`(`contact`, `lifted`, `unverified_hidden`)와 관측 `notes`를 가진다.
  보이는 발에는 실제 발바닥 하단 불투명 경계 픽셀 `sole: [x,y]`가 필요하다.
  경계 내부나 빈 픽셀은 거절된다. 숨은 발의 좌표는 추정해서 입력하지 않는다.

양발의 고정 바닥선은 각각의 기존 접지 ROI 안에 있는 3프레임 이상 관측점의 중앙값으로
계산한다. 임의로 프레임마다 지면을 이동하거나 발을 바닥에 정렬하지 않는다.
접촉/들림 선언은 이 바닥선과 기존 `groundTolerance` 및 계획의 지지발과 일치해야 한다.
공중 단계는 양발 모두 보이고 들려 있어야 한다. 지지발이 가려지면 미검증이다.
보이는 발바닥들이 실제 실루엣의 가장 아래 부분을 설명해야 한다.

발 이름·접촉점의 해부학적 의미는 사람/에이전트의 시각 관찰에 의존한다.
픽셀 경계 검사는 자동 발 인식이나 물리적 접지 인증이 아니다. 프레임별 실제 관찰 없이
계획·마스크·수치만으로 통과시키지 않는다. 가려진 비지지발은 미검증으로 표시하며
해당 프레임의 관측을 통과했다고 표현하지 않는다.

`fighter:gait review`의 미리보기에서 양발의 색상별 바닥선과 실제 표식을 확인한다.
최종 game-pack의 픽셀 또는 지속 시간이 바뀌면 증거를 다시 측정하고 검토해야 한다.

회귀 검사:

```sh
node --test test/projected-ground.test.mjs test/gait.test.mjs test/gait-engine.test.mjs test/contact-evidence.test.mjs test/pack.test.mjs
```
