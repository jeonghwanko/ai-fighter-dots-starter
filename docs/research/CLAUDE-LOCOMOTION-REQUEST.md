# Claude 검토 요청

콘솔에서 이 파일과 같은 폴더의 `MOCHA-LOCOMOTION-HANDOFF.md`를 읽혀 사용한다.
작업 저장소: `C:/Users/turbo08/ai-fighter-dots-starter`.
별도 폴더에서 실행한다면 이 절대 경로로 문서를 지정한다.
아직 Claude의 답변을 받은 상태가 아니며, 아래는 검토 요청서다.

사용자의 명시적 요청에 따른 독립 기술/제품 검토입니다. 한국어로 답변해 주세요.
읽기 전용: 파일 편집, 명령 실행, 설치, 생성, 서버 조작은 하지 마세요.
기존 AGENTS의 생성 절차는 이번 리뷰에 대한 생성 권한이 아닙니다.

먼저 `docs/research/MOCHA-LOCOMOTION-HANDOFF.md` 전체를 읽어 주세요.
문서의 GPT 최종 재시험 JSON/실제 도구 프롬프트, VACE03 assessment/decoder-assessment,
`gen_motion.py`의 generate, `codex_provider.py`의 dispatch, `gait.py`의 sample/audit/screen_audit를
필요한 범위만 읽고 주장을 대조해 주세요. 큰 패치 JSON 전체는 읽지 않아도 됩니다.
GPT 비교 PNG와 VACE03 `review/run-all-feet.png`를 Read로 볼 수 있다면 직접 봐 주세요.
이미지를 보지 못했다면 문서 기반 판단이라고 명시해 주세요.

핵심 제약: 고객은 Dots 또는 Grok bots 등 **한 서비스만 구독**할 가능성이 높습니다.
추가 GPU/VACE/ComfyUI 설치나 두 번째 유료 계정을 기본 요구하면 제품 문제를 해결한 것이 아닙니다.
VACE는 원인 분리 연구이며 더 튜닝하자는 답을 기본 결론으로 삼지 마세요.

2000~3500자 정도로 아래를 답변해 주세요. 필요하면 근거 표를 추가하세요.

1. 기록의 논리적 오류/전제, 확인된 원인과 가설을 분리한 진단.
2. 이미지 전용 / 동일 구독 영상 가능 / 제어 가능한 편집 기능 보유 경우의 현실적 경로.
   최신 기능이나 비공개 내부 알고리즘을 추측해 사실처럼 쓰지 마세요.
3. 제품 기본 전략과 버릴 접근. 리그를 제안하면 전신·가려진 면·외형 유지의 작성 비용을 포함하세요.
4. 엄격한 guide 좌표 평가와 자연스러운 동작 평가의 분리. 숨은 heel=unknown을 pass로 꾸미지 않는 방법.
5. 바꿀 sprite-gen 코드 경계, 최대2개 최소 실험, 호출 수 상한과 중단 기준.
6. 이미지 생성 구독만으로 현재 보장할 수 없는 약속.

중요 주장에는 읽은 파일/함수 근거를 붙이고 미실험 제안은 가설이라고 표시해 주세요.
외부 자료를 직접 조회하지 않았다면 최신 문서로 검증했다고 표현하지 마세요.

## 콘솔에 붙여 넣을 짧은 프롬프트

```text
C:/Users/turbo08/ai-fighter-dots-starter/docs/research/CLAUDE-LOCOMOTION-REQUEST.md와
같은 폴더의 MOCHA-LOCOMOTION-HANDOFF.md를 읽고 독립적인 기술·제품 검토를 해줘.
고객은 Dots 또는 Grok 등 한 서비스만 구독한다고 가정해.
추가 GPU/VACE 설치나 두 번째 구독을 기본 해결책으로 삼지 말고,
실패 원인, 현재 평가의 문제, sprite-gen 변경 경계, 최대 두 개의 최소 실험을 제안해줘.
파일 수정·생성·서버 조작 없이 읽기 전용으로 검토하고 한국어로 답해줘.
```
