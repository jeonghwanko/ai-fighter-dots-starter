# Local VoiceStudio voice production

이 저장소에서 사용자 PC의 VoiceStudio에 연결해 상태를 확인하고 WAV를 생성하거나 기존 WAV를 재사용한다. Node 22 이상과 Node 내장 기능만 사용하며 추가 npm 의존성은 없다.

음성은 **별도의 AI 생성 제작 산출물**이다. 현재 `ai-fighter-side-v1` 계약은 정적 WebP 자산을 받으며 음성 필드가 없다. 이 도구는 `fighter.json`, WebP 패키지, 게임 런타임, 선수 등록을 변경하지 않는다. 게임 내 음성 재생 지원 완료를 의미하지 않는다.

## Prepared service

- VoiceStudio source: `28bf2c7a83b8a64836297340c52a45d716684aed` (version field 0.5.7).
- SDK: `supertonic==1.3.1`; model: `Supertone/supertonic-3` at `724fb5abbf5502583fb520898d45929e62f02c0b` (403.51 MB snapshot).
- 기본 주소: `http://127.0.0.1:3900`. `VOICESTUDIO_URL`로 다른 loopback 포트를 지정할 수 있다. 외부 호스트·인증정보 포함 URL·리디렉션을 거절하며 외부 API로 대체하지 않는다.
- 준비된 서버는 별도 Python 3.11 CPU 환경에서 변경하지 않은 공식 REST 핸들러를 올린 최소 호스트다. Electron 전체 앱 설치와는 범위가 다르다. `/health`의 `source_revision`으로 위 commit을 확인한다.
- 서버의 모델 캐시는 고정 모델만 준비하고 오프라인 모드로 실행한다. 이 저장소의 클라이언트는 설치·다운로드·약관 수락·방화벽 변경·서버 시작을 자동 수행하지 않는다.

서버가 꺼져 있다면 설치를 준비한 독립 작업 폴더에서 `venv\Scripts\python.exe local_api.py`를 실행한다. `local_api.py`는 `127.0.0.1`에만 bind한다. 해당 설치 폴더의 실제 위치를 사용하며 사용자별 절대 경로나 자격증명을 저장소에 기록하지 않는다.

## Commands (repository root)

```powershell
node scripts/voicestudio.mjs status
```

`/health`, `/openapi.json`, `/v1/audio/voices`를 읽는다. 정확한 source revision, 공식 `POST /v1/audio/speech`, 사용 가능한 `supertonic3`를 확인해야 `ready: true`이며 종료 코드 0이다. 일반 VoiceStudio의 `/health`에 `source_revision`이 없으면 검증 미완료로 처리한다.

`ready`는 API와 엔진의 가용성 검사 결과이며 새 합성 성공이나 모델 파일 검증을 뜻하지 않는다. 이 명령은 모델을 로드하거나 다운로드하지 않는다. 실제 생성 결과는 WAV·provenance로 따로 확인한다.

이미 만든 샘플을 복사해 연결을 검증한다. 아래 환경 변수에는 기존 파일의 실제 위치를 넣는다. 기존 WAV의 SHA256과 생성 보고서의 SHA256이 일치해야 재사용하며 **추가 합성 요청은 보내지 않는다**.

```powershell
$env:VOICESTUDIO_SAMPLE_WAV = '기존 WAV의 절대 경로'
$env:VOICESTUDIO_SAMPLE_REPORT = '기존 wav-validation.json의 절대 경로'
node scripts/voicestudio.mjs reuse --input "$env:VOICESTUDIO_SAMPLE_WAV" --source-report "$env:VOICESTUDIO_SAMPLE_REPORT" --out output/voice-studio/mocha-M1-ko-0.85.wav
```

새 샘플이 필요할 때만 다음 명령으로 실제 합성을 요청한다. 기본 대사는 “하암… 한 판만 하고, 다시 잘래.”이며 기본값은 M1·한국어·속도 0.85다. 사용할 수 있는 request JSON은 [mocha.sample.json](../examples/voice-studio/mocha.sample.json)에 있다.

```powershell
node scripts/voicestudio.mjs generate --out output/voice-studio/mocha-take-2.wav
node scripts/voicestudio.mjs generate --text "하암… 한 판만 하고, 다시 잘래." --voice M1 --speed 0.85 --language ko --out output/voice-studio/mocha-take-3.wav
```

출력은 WAV와 `<파일명>.provenance.json`이다. `output/`은 Git에서 제외된다. 기존 파일 또는 provenance가 있으면 덮어쓰지 않고 실패한다. REST 오류·JSON 오류 본문·잘못된 WAV·무음·풀스케일 클리핑도 실패로 처리한다. WAV는 44.1kHz 모노 PCM16인지 확인하고 실제 프레임 수·길이·SHA256을 측정한다. 길이와 형식 검사는 발음이나 졸린 음색의 청취 평가를 대신하지 않는다.

재생 예시: `(New-Object System.Media.SoundPlayer (Resolve-Path output/voice-studio/mocha-M1-ko-0.85.wav)).PlaySync()`.

## Verification and terms

관련 테스트만 실행한다: `node --test test/voicestudio.test.mjs`. 테스트는 로컬 응답을 모사하며 설치·모델 다운로드·합성을 하지 않는다.

VoiceStudio 앱은 [AGPL-3.0-only](https://github.com/debpalash/VoiceStudio/blob/28bf2c7a83b8a64836297340c52a45d716684aed/LICENSE-NOTICE.md), SDK는 [MIT](https://github.com/supertone-inc/supertonic/blob/main/LICENSE), 모델은 [OpenRAIL-M](https://huggingface.co/Supertone/supertonic-3/blob/724fb5abbf5502583fb520898d45929e62f02c0b/LICENSE)이다. 라이선스 수락 상태는 VoiceStudio에 남기며 클라이언트가 자동 수락하지 않는다. 모델·SDK·VoiceStudio 코드는 이 저장소에 복사하지 않는다. 배포 시 AI 생성 음성임을 명확히 표시하고 모델의 사용·출력·재배포 조건을 적용한다.
