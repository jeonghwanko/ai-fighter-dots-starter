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
| `og` | 모든 제공자 호출의 관문: 계정 고정(`login`), codex 칸, 메모리 상한(systemd 슬라이스), 장부, codex 기능 끄기(`harden`), 워커 서비스(`worker key·install·uninstall·start·stop·log`), 정리(`prune`). 서비스 설치만: 운영자 수동 흐름(`new·deliver·close`)과 `self-update` |
| `generation-worker.mjs` | 워커: 1분마다 심장 박동, 1시간마다 `og health`, 하루 한 번 `og prune`, 한 번에 한 작업의 한 단계를 임대해 돌리고 결과를 올린다 |
| `generation-stages.mjs` | 단계: 브리프·외형·동작·제출의 명령과 프롬프트, 결과 검사 |
| `motions.py` | 동작 단계의 픽셀 일(키트 sprite-gen venv의 NumPy·Pillow) |
| `ledger-report.mjs` | 장부 한 줄 쓰기와 요약. 신청 글·프롬프트·경로는 남기지 않는다 |
| `install-service-user.sh` | 서비스 설치의 처음 한 번(root) |
| `*.test.mjs` | `node --test host/*.test.mjs` |

## 단계

| 단계 | 누가 | 하는 일 |
| --- | --- | --- |
| 브리프 | 공식 호스트만 | codex를 파일·셸·브라우저 기능을 끄고 돌려 안전 판정·프로필 초안·외형 설명을 받는다 |
| 외형 | 맡은 호스트 | 후보 두 장을 동시에 그린다. 맡기기 작업의 첫 회차는 codex 판정(도구 끔)이 하나를 고른다 |
| 동작 | 맡은 호스트 | GPT 키포즈 줄, Grok 걷기, Grok 달리기를 동시에. 엔진 검사와 codex 판정을 통과한 것만 패키지로 묶는다 |
| 제출 | 맡은 호스트 | 신청자가 확인한 프로필로 그의 계정에 제출한다 |

한 호스트가 처음 가져간 작업은 끝까지 그 호스트가 맡는다(중간 파일이 그 PC에 있다). 서버가 열쇠로 호스트를 알아 그 호스트 몫만 내준다.

## 지켜야 할 것

- `og run` 밖에서 `sprite-gen`·`codex`·`grok`을 부르지 않는다. 그러면 고정한 계정·칸·장부를 거치지 않는다.
- 워커는 `og harden` 없이는 시작하지 않는다. 신청자의 글이 codex 입력이 되기 때문이다.
- `og setup`(사용자 설치는 `npm run host:setup`)은 열린 작업이 있으면 아무것도 바꾸지 않는다. 키트·CLI 판은 `og` 맨 위에 고정한다.
- 끝난 작업 폴더(신청 글·참조 그림·생성 그림)는 워커가 하루 한 번 지운다: 닫힌 지 7일(`ODDBOUT_GENERATION_KEEP_DAYS`, 1~90),
  닫히지 않은 채 14일 동안 바뀐 파일이 없는 작업(서버가 취소·만료한 작업)도 지운다.
