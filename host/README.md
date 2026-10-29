# 호스팅 생성기 (`host/`)

ODDBOUT 제작자 페이지·에이전트의 **호스팅 생성 신청**(글과 그림 → 선수)을 실제로 만드는 생성 PC의 도구다.
서버(`api/generations.mjs`)는 작업 표와 상태만 가진다. 그림·동작은 이 도구가 생성 PC의 GPT(codex)·Grok 구독으로 만든다.

같은 파일이 두 가지로 설치된다.

| 설치 | 누구 | 어떻게 |
| --- | --- | --- |
| 서비스 | ODDBOUT 자신의 PC(공식 호스트) | 서비스 전용 유닉스 사용자(`/srv/oddbout-gen`), 운영자는 sudo 규칙 하나로 `og`만 부른다(`install-service-user.sh`). 신청 글의 안전 판정(브리프)은 공식 호스트만 한다 |
| 사용자 | 커뮤니티 호스트(승인된 제작자의 Linux PC) | 호스트 자신의 계정으로 돈다. sudo가 없다. `npm run host:setup`이 설치 폴더(기본 `~/.local/share/oddbout-host`)를 만들고 `host.env`를 쓴다. 안내: [GENERATION-HOST.md](../docs/GENERATION-HOST.md) |

`og`는 자기 위쪽 폴더에 `host.env`가 있으면 사용자 설치로 돈다. 두 설치 모두 codex·grok은 **설치 폴더를 HOME으로** 돈다. 그래서 그 PC 사람의
`~/.codex`(MCP 서버·플러그인·셸 도구)와 개인 로그인이 생성에 쓰이지 않는다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `og` | 모든 제공자 호출의 관문: 계정 고정(`login`), codex 칸, 메모리 상한(systemd 슬라이스), 장부, codex 기능 끄기(`harden`), 워커 서비스(`worker key·install·uninstall·start·stop·log`), 정리(`prune`), 고리 정렬의 RIFE(`rife torch|ncnn` — NVIDIA GPU면 PyTorch로 약 2배). 서비스 설치만: 운영자 수동 흐름(`new·deliver·close`)과 `self-update` |
| `generation-worker.mjs` | 워커: 1분마다 심장 박동, 1시간마다 `og health`, 하루 한 번 `og prune`, 한 번에 한 작업의 한 단계를 임대해 돌리고 결과를 올린다 |
| `generation-stages.mjs` | 단계: 브리프·외형·동작·제출의 명령과 프롬프트, 결과 검사 |
| `sprite-outcome.mjs` | sprite-gen 보고서로 실패한 실행의 과금 여부와 다음 할 일을 판정. 크리에이터 작업(`mcp/creation-jobs.mjs`)도 같은 파일을 쓴다. 호스트는 `host/`의 파일을 bin 한 폴더에 평평하게 설치하므로 워커가 부르는 파일은 모두 여기 있어야 한다 |
| `motions.py` | 동작 단계의 픽셀 일(키트 sprite-gen venv의 NumPy·Pillow) |
| `ledger-report.mjs` | 장부 한 줄 쓰기와 요약. 신청 글·프롬프트·경로는 남기지 않는다. 종료 3은 `notStarted`(sprite-gen이 provider 요청 전에 실패: 만든 것도 과금도 없음), 2·75는 `needsInput`, 129·130·143은 `interrupted` |
| `install-service-user.sh` | 서비스 설치의 처음 한 번(root) |
| `*.test.mjs` | `node --test host/*.test.mjs` |

단계 모듈은 서버가 비교 모드를 켠 경우에만 증거를 ODDBOUT 검수 API로 전달한다.
OpenAI 키는 서버 Secrets에만 둔다([서버 검수 운영](../docs/SERVER-DECISIONS-REVIEW.md)).

## 단계

| 단계 | 누가 | 하는 일 |
| --- | --- | --- |
| 브리프 | 공식 호스트만 | codex를 파일·셸·브라우저 기능을 끄고 돌려 안전 판정·프로필 초안·외형 설명을 받는다 |
| 외형 | 맡은 호스트 | 후보 두 장을 동시에 그린다. 맡기기 작업의 첫 회차는 codex 판정(도구 끔)이 하나를 고른다 |
| 동작 | 맡은 호스트 | GPT 키포즈 줄, Grok 걷기, Grok 달리기를 동시에. 엔진 검사와 codex 판정을 통과한 것만, 모든 프레임을 외형 크기로 맞춰(아래 "몸 크기") 패키지로 묶는다 |
| 제출 | 맡은 호스트 | 신청자가 확인한 프로필로 그의 계정에 제출한다 |

한 호스트가 처음 가져간 작업은 끝까지 그 호스트가 맡는다(중간 파일이 그 PC에 있다). 서버가 열쇠로 호스트를 알아 그 호스트 몫만 내준다.

### 몸 크기 (scale-check)

GPT는 자세마다 몸을 따로 그려 외형보다 2~20% 커지거나 작아지고, 걷기·달리기 영상은 통째로 다른 크기로 나온다. 게임은 내장 선수만 크기를
보정하므로, 동작 단계가 game-pack 전에 sprite-gen [`scale-check`](../vendor/sprite-gen/docs/scale-check.md)로 모든 클립의 프레임을 외형(idle)과
**머리 크기로** 비교하고 game-pack이 발 기준점으로 되돌린다. 걷기·달리기는 한 주기를 한 배율(상태 중앙값)로, 나머지는 프레임마다.
넘어짐(`fall`, `fall-getup`)은 머리가 돌아가므로 90°까지 따로 찾는다.

- 보고서는 클립을 경로가 아니라 **프레임 픽셀**로 찾고, 기준 프레임(idle)도 같은 요청의 에셋이어야 한다. game-pack은 보정에 기준의 표시 배율 ÷ 그 클립의
  표시 배율을 곱해 싣는다 — 걷기·달리기는 영상의 `body_h`로 이미 일부 맞춰져 있어 두 번 보정하지 않는다.
- game-pack이 실을 배율이 1보다 커서 클립 캔버스를 벗어나면 `motions.py scale-fit`이 그 클립 캔버스만 키우고(fall과 get-up은 함께) 다시 측정한다. 세 번 안에 끝나지 않으면 운영자 검토(`scale-fit`).
- 머리를 확신하지 못한 프레임(`check`, 탐색 범위 끝에 걸린 크기 포함)은 사람이 보드를 볼 수 없으므로 **그 클립의 측정된 프레임(`head`·`agree`) 중앙값**을 쓴다(측정된 프레임이 없으면 1). 추측한 프레임은
  작업 이벤트 `scale-check`(`guessed`)와 작업 폴더 `motion/assembled/scale/`(보고서·보드·`fit.json`)에 남는다.
- 보행 검수(보폭·loop-review)는 보정된 pack의 픽셀에 묶이므로 game-pack 다음에 돈다.

## 지켜야 할 것

- `og run` 밖에서 `sprite-gen`·`codex`·`grok`을 부르지 않는다. 그러면 고정한 계정·칸·장부를 거치지 않는다.
- 생성 단계가 실패하면 워커는 그 실행이 쓴 sprite-gen 리포트(`--report`, gen-set·video-set의 `set.report.json`)를 읽는다. 리포트가 같은 명령으로 다시 될 수 있다고 할 때만(`retryable`), 또는 리포트가 아예 없을 때(og가 sprite-gen 전에 멈춤)만 다시 시도한다. `outcome-unknown`, xAI가 받은 영상 요청(`*-unfinished`, `requestIds` — `video-resume`으로 받는다), 종료 3(`*-not-started`), 고쳐야 할 오류는 운영자 검토로 간다. og 장부는 종료 코드만 읽는다: 리포트 경로를 아는 쪽은 워커다.
- 워커는 `og harden` 없이는 시작하지 않는다. 신청자의 글이 codex 입력이 되기 때문이다.
- `og setup`(사용자 설치는 `npm run host:setup`)은 열린 작업이 있으면 아무것도 바꾸지 않는다. 키트·CLI 판은 `og` 맨 위에 고정한다.
- 끝난 작업 폴더(신청 글·참조 그림·생성 그림)는 워커가 하루 한 번 지운다: 닫힌 지 7일(`ODDBOUT_GENERATION_KEEP_DAYS`, 1~90),
  닫히지 않은 채 14일 동안 바뀐 파일이 없는 작업(서버가 취소·만료한 작업)도 지운다.
