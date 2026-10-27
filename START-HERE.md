# Start in a saved Dots VM

Give Dots this repository URL and your character idea or reference. Dots handles the commands below.
This entry point selects **kit 0.5.5 candidate**, pinned in `deploy/dots-release.json`, rather than running
the historical 0.2.0 package still present on main. Saved-VM creation acceptance is **pending**.

1. The environment preparer follows [the one-time install recipe](deploy/dots-environment/README.md)
   and publishes a clean Linux environment with no personal login or originals.
2. In the user's running VM, read [the Start instructions](docs/DOTS-START.md) and run:

   ```sh
   . "$HOME/.local/share/oddbout-tools/env.sh"
   node dots.mjs --install
   ```

3. Follow the single `nextAction`. Connect only the user's Grok subscription through official device login
   if needed. Image/video access, private source receipt and actual conversation preview delivery are
   checked separately. No API-key fallback or protected Codex session recovery is used.
4. Later requests run `node dots.mjs` in the same environment and workspace. Keep the bound version,
   source originals, current selections and unfinished requests. Never upgrade an active character.
5. For an explicit creation request, use the **returned runtime's** AGENTS.md and creation workflow.
   Show appearance, movement, attack and reaction groups for feedback, then validate all eleven motions.
   Registration uses the connected ODDBOUT account when the user requests it.

Sharing a URL alone does not authorize generation. An installation or login result does not certify a
finished character. See [the architecture](docs/DOTS-VM-ARCHITECTURE.md),
[private source delivery](docs/DOTS-PRIVATE-SOURCES.md), and [acceptance evidence](docs/DOTS-VM-ACCEPTANCE.md).

## 한국어

환경 준비자가 도구가 설치된 Dots VM을 한 번 게시한 뒤, 사용자는 Git 주소와 캐릭터 제작 요청을 보냅니다.
Dots가 `node dots.mjs --install`로 정확한 제작 버전을 준비하고 본인의 Grok 구독을 연결합니다.
다음 요청부터는 `node dots.mjs`로 같은 작업을 재개합니다. 원본은 비공개로 보관하고 VM에서 바이트와
해시·디코딩까지 확인합니다. 미리보기는 실제 대화에 표시한 뒤 그룹별 피드백을 받습니다.
main에 남아 있는 0.2.0 소스를 직접 설치하는 경로는 이 Dots 제작 진입점이 아닙니다.
현재 0.5.5 후보의 실제 VM 제작 검증은 진행 중이며 완료로 표시하지 않습니다.
