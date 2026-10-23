# 외형 생성 전 전달 확인

외형 단계의 목표는 사용자가 **현재 대화에서 실제 전신과 같은 그림의 얼굴 확대를 보고 피드백하는 것**이다.
생성 완료만으로 이 목표를 달성한 것이 아니다. 이 문서는 호스트·계정·전달 경로 확인 절차이며 게임 규격을 바꾸지 않는다.

## 생성 전에 두 경로를 확인한다

1. 현재 사용자의 환경·계정·모델·비용·실패 시 중단 조건을 기록한다. 과거 작품이나 다른 계정의 확인을 재사용하지 않는다.
   생성 도구와 현재 계정의 접근 상태를 확인하되 로그인만으로 구독·한도를 단정하지 않는다.
2. PC가 필수가 아닌 외형 시안은 현재 대화의 직접 이미지 생성·표시 기능부터 확인한다. 현재 도구의 문서와 실제 가용성이
   이를 지원하고 사용자 제약에 맞을 때만 사용한다. 확인용 새 이미지를 생성하지 않는다. 전신과 동일 그림의 얼굴 crop을
   표시할 경로도 확인한다. 얼굴을 별도 생성해 확대본으로 대체하지 않는다.
3. 로컬 생성이 필요한 경우 bundled sprite-gen 절차와 별도로 **로컬 결과를 이 대화에 표시·전달할 경로**를 확인한다.
   에이전트가 사용할 실제 실행 경로에서 읽기 전용 기능 탐색 또는 지원되는 사전 점검을 한다. 모델에게 도구 이름이
   보이는 것만으로 로컬 helper에서도 쓸 수 있다고 가정하지 않는다. Library를 쓴다면 해당 helper가 필요한 준비·완료
   기능을 실제로 찾는지 확인한다. 파일 전달이 필요한 작업이면 표시 기능뿐 아니라 원본 파일 전달 기능도 확인한다.
4. 둘 중 하나라도 unavailable / denied / unknown이면 해당 생성은 시작하지 않는다. 누락된 기능과 다음으로 가능한
   지원 경로를 설명한다. 전달 불가 상태에서 로컬 생성만 한 뒤 사용자에게 파일 재업로드를 떠넘기지 않는다.
   이미 지원되는 직접 표시 경로가 있고 사용자 제약을 충족하면 그 경로를 사용하며 PC 설치를 선행 조건으로 삼지 않는다.
5. 재개 시 실행 기록·도구 trace·기존 출력부터 확인한다. 결과가 있으면 회수·전달한다. `pending`이나 결과 불명은 실패가
   아니므로 재호출하지 않는다. 같은 이미지가 있는데 전달만 막혔다면 재생성으로 장애를 숨기지 않는다.
   새 생성은 사용자의 명시적인 새 생성·수정 요청이 있을 때만 한다. “보여줘”, “계속해”는 그 자체로 재생성 요청이 아니다.

직접 표시도 부모 대화로 자동 전파된다는 뜻은 아니다. 위임한 작업이면 **사용자가 볼 대상 대화**를 먼저 정한다.
자식 대화의 inline 이미지가 부모에게 텍스트로만 전달되면 부모 대화 표시는 아직 미완료다. 원본 Library/file ID가 실제로
반환됐는지 확인하고, 없으면 실행 이벤트 ID를 파일 ID로 바꾸어 쓰거나 존재하지 않는 첨부를 약속하지 않는다.

## 상태를 따로 기록한다

| 상태 | 완료의 근거 |
| --- | --- |
| 생성 | 실제 호출 및 완료 결과; 실행 전 혼잡 오류와 이미지 도구 실패를 구분 |
| 로컬 저장 | 실제 원본 경로·파일 검사; 대화에서 볼 수 있다는 증거는 아님 |
| Library 저장 | 파일별 실제 저장 응답과 Library ID; 일부 성공을 전체 성공으로 확대하지 않음 |
| 대화 첨부·표시 | 대상 대화에서 실제 이미지가 표시된 결과; `queued`, 텍스트 보고, 로컬 경로는 표시 완료가 아님 |
| 외형 검수 | 전신·동일 그림 얼굴 crop의 실제 관찰과 수치 검사; 미확인은 미확인으로 유지 |
| 사용자 외형 선택 | 해당 버전 전체에 대한 실제 피드백; 이름·색·제공자 선택과 구분 |

실제 전신과 얼굴 확대를 표시하기 전에는 외형 선택을 요청하거나 다음 묶음으로 진행하지 않는다.
표시한 시안도 사용자 선택 전에는 pending이다. 생성·저장·표시·검수·선택은 서로의 성공을 대신하지 않는다.

## 실패 처리

- 실패 단계, 대상, 실제 호출 여부, 완료한 항목, unavailable / denied / pending / unknown을 구분해 알린다.
  기능 가용성 오류를 계정 제한·권한 거부라고 추측하지 않는다. `Library prepare_uploads is not available`은 업로드 준비
  기능 탐색 단계의 장애다. 실패 응답에서 저장 ID가 없다면 저장 성공을 주장하지 않는다.
- 시작한 helper 업로드를 direct action으로 바꾸지 말라는 도구 규칙이 있으면 그대로 지킨다. 보안 차단을 다른 실행 경로,
  외부 업로드 또는 코드 변경으로 우회하지 않는다. 일부 성공·불명확한 업로드는 기록과 ID부터 회수하고 중복 저장하지 않는다.
- 혼잡·한도 오류에는 현재 사용자의 중단 방침을 적용한다. 예를 들어 같은 계정의 `gpt-6-astra`와
  “혼잡하면 재시도 없이 중단”이 지정됐다면 그 모델을 유지하고 멈춘다. 이를 다른 사용자의 기본 모델로 강제하지 않는다.
  모델·제공자·계정·유료 API를 자동 변경하지 않는다.
- 지원되는 복구 경로만 제시한다. 아직 표시하지 못한 외형으로 이동·공격·음성·등록을 진행하지 않는다.

## 오프라인 기록 점검

Dot이 작업 폴더에 `delivery-check.json`을 기록한다. 사용자에게 JSON 작성을 요구하지 않는다.
아래 값은 형식 예시이며 **실제 접근·표시의 증거가 아니다**. 현재 도구 응답과 실행 경로를 관찰해 채워야 한다.

```json
{
  "version": 1,
  "conversationId": "current-chat",
  "environment": "actual-generation-host",
  "generation": {
    "status": "unknown",
    "route": "selected provider / account / model",
    "evidence": ""
  },
  "delivery": {
    "status": "unknown",
    "route": "actual inline or file delivery tool/helper",
    "conversationId": "current-chat",
    "fullBody": false,
    "faceCrop": false,
    "evidence": ""
  },
  "previousGeneration": { "status": "unknown", "evidence": "" }
}
```

생성 전 두 경로 확인을 마친 뒤 다음을 실행한다:

```sh
npm run creation:delivery -- preflight output/<localId>-work/delivery-check.json <현재-대화-ID>
```

`ready: true`일 때만 생성으로 진행한다. `generation`과 `delivery`에는 실제 확인한 `ready`와 근거를 기록한다.
`previousGeneration.status`는 `none`, `not-started`, `completed`, `failed`, `pending`, `unknown` 중 실제 상태다.
기존 호출이 완료·실패했다면 명시적 새 생성 요청 원문을 `newGenerationRequest`에 기록해야 새 호출 점검을 통과한다.
pending/unknown은 먼저 회수·판별해야 한다. 이 검사는 provider 실행·업로드·자동 재시도를 하지 않는다.

생성 후 같은 기록에 `result`를 추가한다: `version`, `generation: "completed"`, `generationEvidence`,
`localSave: {status, path}`, `librarySave: {status, fileId}`, `attachment: {status}`, `review`,
`previews.fullBody`와 `previews.faceCrop` 각각의 `{status, conversationId, version, evidence}`,
그리고 `selection: {version, feedback}` 또는 `null`이다. 존재하지 않는 경로·ID는 `null`로 두고 저장 상태를 구별한다.

```sh
npm run creation:delivery -- review output/<localId>-work/delivery-check.json <현재-대화-ID>
```

`canRequestFeedback`은 두 미리보기의 현재 버전·대화·실제 `displayed` 근거를 검사한다.
`canAdvanceAppearance`는 여기에 검수 `passed`와 현재 버전의 사용자 선택 기록을 요구한다.
종료 코드는 0 통과, 1 보류·차단, 2 입력 오류다. 표시 완료·사용자 선택 대기는 정상적으로 1이다.
이 명령은 에이전트가 기록한 증거의 누락·모순만 검사한다. 라이브 도구 연결, 이미지 품질, 피드백의 진위를 자동 확인하지 않으며,
모든 생성 도구를 강제로 감싸는 실행 차단기도 아니다. 로컬 실행이 없는 호스트는 같은 조건을 직접 대조하고 CLI를 실행했다고 하지 않는다.
