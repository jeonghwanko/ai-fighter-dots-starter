# Dots VM acceptance record — 0.5.5 candidate

## Implemented scope

- A small Git front door resolves an immutable source commit, delegates installation/check/recovery,
  and retains the original runtime when a character already exists.
- A clean Linux saved-environment recipe installs pinned Node/Grok plus Python, ffmpeg and WebP.
  Device login occurs in each user's running VM, after publishing the environment.
- The selected product path is Grok subscription image/video. Codex protected-session collection and
  XAI_API_KEY fallback are blocked in Dots dispatch. Unobserved media capability remains unknown.
- Private PNG originals use owner-scoped storage, immutable idempotency, sealed short-lived VM grants,
  exact byte/hash verification, full PNG decoding, and local no-clobber admission.
- Startup returns one next action and recovers unknown jobs before any new work. Creation then follows
  the existing review groups; source receipt, generation, display and acceptance stay distinct.

## Evidence collected (2026-10-28 KST)

On Windows, the 13 related suites (creator-sources, dots-start, dots-workspace, portable-plugin,
cloud-mcp, plugin-bundle, migration-rules, api, file-input-probe, runtime-fetch,
cloud-plugin-publication, creator-plugin, sprite-tools) report **115 passed, 0 failed, 5 skipped**.
Skipped checks require POSIX permissions/symlinks or the Linux WebP fixture. Directory junction rejection
did run on Windows. Actual npm --version through the repaired launcher returned **10.9.7**.
The Linux shell recipe passes Bash syntax validation; it has not been installed as a fresh saved image.

The existing Dots VM task **ODDBOUT 0.4.0 분리 설치 검증** ran the candidate in
/workspace/oddbout-dots-vm-acceptance-20261028, preserving the original checkouts.
The task title is not the installed version: its old light kit was actually 0.3.0.
The tested front door was c6ebe4a, runtime 66aab684addabdf211b5d23cd41536aa0bfb33f2, kit 0.5.5,
engine pin **0dc264ba257c0d417f86ef797bc503f933e1e142**.

- Real VM tools: Node 24.19.0, npm 11.9.0, Python 3.12.14, ffmpeg/ffprobe 7.1.5.
  The pinned Python engine installed as 3.4.0. This is not the new image's Node 22.22.2 recipe.
- npm installation succeeded; WebP was missing and its download prevented full setup.
  Fixed in the follow-up: use inherited proxy transport, return a nonzero front-door exit on
  installation failure, and report only a sanitized known blocker/host.
- Reinvoking the entry preserved the same six monitored files, hashes and mtimes; no pull, reinstall,
  or generation dispatch occurred. A real VM restart was not performed.
- Grok 1.0.70 initially failed in its npm postinstall at the unwritable home directory.
  The same official lock with npm ci --ignore-scripts --no-audit --no-fund succeeded;
  its unmodified launcher returned **grok 1.0.70 (f50904eaee6c)**, exit 0.
  No HOME/GROK_HOME changes, authentication copying, source patches or login occurred.
- Linux's original 12 Codex fixture failures came from running mock PC tests inside a marked Dots
  runtime. On a clean checkout, **107 passed, 1 failed** across the original 108 tests.
  The remaining POSIX cleanup-hook order was fixed. The follow-up at front-door 647483c / runtime
  97890ddf399cbbaae9351ee6d11ac0776714d7b0 ran all 13 suites: **120 passed, 0 failed, 0 skipped**, exit 0.
- The existing VM network policy lacks storage.googleapis.com and
  ztfxxhtmtrvxvuxlqmgz.supabase.co. The saved environment must be republished and a fresh VM
  validated; neither repository code nor relogin changes this host policy. The follow-up attempted a new
  workspace install once: npm exit 0, sprite exit 1, front-door exit 1; nextAction correctly named
  environment-preparer, repair-installation, network-connect-forbidden and storage.googleapis.com.

The private-source migration is applied and MCP **v30** deployed. Production checks confirmed a private
16 MiB PNG bucket, owner checks, service-only table/RPC access and unauthenticated HTTP 401.
The public tool list contains store_creator_source, get_creator_source and prepare_creator_source_download.
The old VM catalog remains stale; after the official app refresh, a newly created Work task exposed all
three with their input schemas. The actual native file/private VM transfer trial is recorded below.
Local security tests additionally use migrated PostgreSQL (PGlite) and simulated Storage.

## Published settings and actual VM installation

With the user's explicit approval, the saved ai-fighter-dots-starter environment was published on
2026-10-28 KST. Its initial install script pinned front door 1f110b3e37c4cfbc965014960e937d646c57b630,
which pins runtime 97890ddf399cbbaae9351ee6d11ac0776714d7b0. Start instructions cover the complete
Grok creation/recovery flow. The exact three hosts nodejs.org, storage.googleapis.com and
ztfxxhtmtrvxvuxlqmgz.supabase.co were added (8 -> 11 custom hosts). Unrestricted Internet remains off;
no proxy secrets or environment credentials were added.

The task-creation tool's default Work task (6ae0cf8e-5e78-83ec-88e7-116b2ed2066e) did not select this
saved environment. Its host e359ea652db4 correctly stopped before installation. The browser's Codex
Cloud environment selector resolved that routing issue: task **ODDBOUT 0.5.5 게시 환경 실증**
(01a17e32-c032-77ac-887c-7913888b50ac), host fffae06c15fb, started in /workspace with all three added
hosts allowed. All three private-source MCP tools are visible there.

This correctly selected VM still had old main b1e1966 and no prepared env.sh/Grok/WebP. Publication had
applied settings but did not demonstrate execution of the saved installer or capture of prepared tools.
A separate direct installation trial preserved that original checkout and all previous attempt logs:

| Front door | Actual result | Follow-up |
| --- | --- | --- |
| 1f110b3 | exit 127, sudo absent before installation | Check/reuse usable base tools; apt only for missing tools with supported privilege |
| fdae405 | Node 22.22.2 SHA-256 and execution pass; exit 254 at npm home cache | Keep npm/pip download caches in the workspace; retain official authentication locations |
| 6b7b8bfaf6728dff8f75b8f155c356616ee0f592 | installer exit 0 | Actual installation and ordinary resume both exit 0 |

The final script ran once. Actual kit 0.5.5, Node 22.22.2, Python 3.12.14, Grok 1.0.70,
engine 0dc264ba257c0d417f86ef797bc503f933e1e142 and img2webp -exact were checked. The separate
/workspace/oddbout-v055-acceptance --install returned installation: reused with no installation steps;
ordinary resume retained the identical binding. Both Git traces had no pull/fetch/clone. Installation
receipt, dependency files and FETCH_HEAD hashes were unchanged. The resulting single next action was
connect-grok-subscription / sign-in-required; these checks did not log in or generate.
Evidence: /workspace/work/oddbout-v055-evidence/direct-install-6b7b8bf/verification.json and adjacent
stdout/stderr, exit-code, file-hash and Git-trace records in that VM.

The saved environment draft now names this tested front door. Preparing its reusable filesystem and
republishing still require the environment preparer, followed by a new-task and real-restart check.
Direct installation in a running user's VM does not update the reusable saved image.

## Current pinned runtime and launcher verification

Runtime **52db965f7ad6f54b99e8920a6be2db14dc1e2756** installed successfully in the selected VM for
/workspace/oddbout-gun-meme-cat. Creation readiness now verifies the immutable runtime marker, workspace
binding, exact source/vendor commits and clean source instead of requiring a mutable branch or pull.
The actual kit check returned ready. The existing acceptance workspace and engine pin were preserved.

The first ordinary front-door resume failed because a child Node exited 0 with empty stdout. A bounded
read-only probe reproduced this even with console.log of a fixed test string; direct CLI execution
returned valid JSON. Path/realpath and main-guard comparisons matched, and no timeout or signal occurred.
The managed host's underlying pipe behavior remains unexplained; this was not a generation failure.

Front door **da4b05aff428a0e0bfe859a84e075237f40278ef** now imports the selected runtime's start function
and returns its typed result directly. It still verifies the bound commit before loading the runtime.
No automatic fallback, process-global environment rewrite or runtime upgrade was introduced.
In the same real VM, ordinary resume and the subsequent --install each ran once and exited **0** with
valid JSON. --install returned **installation: reused, steps: []**. HEAD, binding, install receipt and
FETCH_HEAD hashes were unchanged; Git traces contained no fetch, pull or clone. The sole next action
remained connect-grok-subscription / sign-in-required. Evidence is under
/workspace/work/oddbout-v055-evidence/frontdoor-da4b05a/.

Local readiness/startup/workspace/bundle regression tests after this change: **42 passed, 0 failed,
3 platform skips**, 45 total. CI was not run. These tests and ordinary invocation are not a VM restart.

## Actual private file transfer and display boundary

A clearly labeled TEST PNG (not generated character artwork) completed official native file input,
private account-scoped Storage, sealed VM grant and receive. Original and received files were both
**3,589 bytes**, **256 x 128**, SHA-256
**60cc68255b4c2e0ff31a7c519e87ed6683d9056cac785ea05eee71099c94c4e6**.
The full PNG decoded and a repeated receive returned reused: true. Evidence is in
/workspace/oddbout-v055-acceptance/output/transfer-test/verification.json, with the corrected copy in
/workspace/work/oddbout-v055-evidence/runtime-52db965/TEST-transfer-verification.json.

VM view_image plus image emission did not establish display: the actual browser UI showed image load
failure. The host's designated /codex output mount was read-only and yielded no downloadable artifact.
Originals and receipts remain intact. conversationDisplayed is false; no fabricated URLs, file IDs,
base64 chat dumps or duplicate generation were used. The official Pages file bridge then stored the same TEST PNG in an owner-only personal Page. Its
write_page_reference receipt returned file_access_confirmed: true, matching byte_size and sha256.
The exact native Markdown was inserted/read back; the actual browser screenshot showed the complete
yellow TEST / TRANSFER FIXTURE image. The parent's read_page_reference returned actual PNG pixels.
The earlier VM local-image failure remains a separate failed route. Page display is verified; current
conversation inline rendering and future animation playback must be observed separately. Neither
private transfer nor a source receipt alone proves display.

## Related animation change

[PR #38](https://github.com/jeonghwanko/ai-fighter-dots-starter/pull/38) is in this creator-kit repository,
not crashbang-heroes. It merged into codex/creator-hosting as 43c63da3a1362aa113763a8f1f2802c639705a02.
It adds a hosted-only engine-loop packing policy: engine loop/foot-name records and visual verdicts are
bound to final frame pixels/durations, with missing/stale/failing reviews rejected. It helps Grok video
walk/run packaging but changes none of VM installation, login or private-file delivery.
Its own documentation keeps Dot creation on reviewPolicy: required. That policy is retained here;
engine-loop is not silently substituted for same-foot stance evidence. The current pinned runtime
52db965 predates PR #38. Any later runtime integration needs its pack/gait and creation-policy checks
before a new immutable pin, without upgrading a character already in progress.

## Open acceptance gates

The reviewed release remains a candidate. Still required: prepared saved-image publication, new-task verification and restart;
official Grok login plus actual image/video entitlement;
visible delivery to the current conversation; requested character creation, group review and final package.
No successful actual generation, displayed VM output or complete fighter is claimed.

## Required saved-VM evidence (still pending)

Use the existing user's VM with an isolated validation workspace; retain existing characters and originals.
The old task title is not a version source: record actual kit manifest/version, source commit and vendor pin.

1. Read-only inventory: installed tools, proxy/network policy, active jobs and available conversation display.
2. Fresh workspace: run the Git front door at the candidate commit; record selected runtime and `nextAction`.
3. Reinvoke after restart; confirm no pull, duplicate install, provider switch or new generation request.
4. Run the relevant suites on Linux, including the three platform-dependent checks above.
5. With the connected ODDBOUT account and an existing authorized original, exercise native file input →
   private Storage → sealed VM grant → unchanged bytes + full decode. Record actual source/receipt ids.
6. Confirm an existing VM artifact is visibly delivered to the current user conversation by a supported
   host route. A path, text report or queued panel is not displayed media.
7. Confirm the user's Grok image/video access. Execute only the authorized requested appearance group;
   preserve actual provider request/output evidence and original files, show the previews, and obtain
   feedback before later groups. No throwaway generation to make a readiness report pass.
8. Continue authorized groups to eleven motions, actual gait review and validated packaging; registration
   requires the user's final registration request. Do not call an example fixture a generated fighter.

The existing VM passed the related tests and the new selected VM passed direct installation/resume,
immutable creation-readiness checks and private original transfer.
The prepared saved image and complete creation path remain unverified. Main must not advertise this candidate as verified until that evidence exists. Publishing/Republishing the saved environment is a host operation outside the kit.
