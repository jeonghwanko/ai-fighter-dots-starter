# AI Fighter creator kit

This repository lets each user create their own fighter through Dot. Read
`docs/DOT-CREATION.md`, `docs/AUTHORING.md`, and the live AI Fighter spec before creating a package.

- Read `docs/CREATION-UX.md` for intent, text/image intake, account choices and the process evaluation rubric.
  Process design/review requests and forwarded example characters are not authorization to generate a character.
  Follow the latest direct user intent; stop dependent generation when that intent changes.
- Accept text, reference images, or both. Ask only about missing reference roles or material conflicts.
  Distinguish user requirements from proposed details; do not make users complete a long character form.
  An explicit edit overrides the reference's existing detail; do not ask again whether to keep what the user said to remove.
- Default recommendation: GPT base + Grok video when both are available, all Grok when only Grok is available,
  all GPT when only GPT is available. Explicit user choices override this product preference. Confirm current
  access in one understandable question; this recommendation never authorizes an automatic runtime provider switch.
  Track image and video access separately. Honor an already chosen stop-on-failure policy without reoffering rejected alternatives.

- Creation is conversational in meaningful review groups: appearance (concept/idle), locomotion
  (fightIdle/walk/run), attacks (combo/slam/dash), defense and reactions (block/hit/groggy/fall), then final review.
  Complete the agreed group autonomously, show its actual previews together, and wait for feedback at the
  group boundary, not after every motion. A positive response advances to the next group without another
  permission question. Only skip review boundaries when the user explicitly delegates those groups.
  Reuse choices the user already made; a request to create/register alone does not waive group feedback.
  Read the full feedback: praise with a revision request is a revision; praise of one motion applies to that motion's current version.
- Track acceptance per motion and version. A positive response about the last pending motion completes the group
  when the other current versions are already accepted and the required checks pass; do not ask for those approvals again.
  Delegating later groups does not waive an earlier pending review. Preserve the user's actual delegated scope.
- An unknown generation outcome is not a confirmed failure, even without a request ID. Inspect existing records
  and outputs before retrying; do not treat a generic continuation request as authorization for a potentially duplicate generation.
- A user-requested metadata-only final edit followed by an explicit registration request needs fresh validation,
  but not repeated approval of unchanged animations. Use a new key for changed package bytes, the same key for immutable retries.
- Ask only for missing creative decisions that affect the next preview. Handle installation, extraction,
  measurement and validation within the agreed step without making the user approve each command.
  Show actual images/animation, not only progress text. Preserve selected versions and revise affected
  assets only. Follow the feedback and work-note rules in `docs/DOT-CREATION.md`.
- Before generation, follow `docs/DELIVERY.md`: verify generation access and actual image/file delivery to the
  current user conversation separately. For appearance previews that do not require a PC, check the host
  direct image-generation/display route first, within the user's environment/account/model constraints.
  Local generation requires a verified delivery route; tool names visible to the model do not prove that
  the selected Library helper can use them. Run `creation:delivery` when local execution is available.
  Distinguish the Dots conversation model, Codex CLI `--model` worker, and actual image tool/backend.
  The provider report's copied `model` is not an observed image backend. Login, model strings and tool
  listings do not verify generation; require actual call traces and completed outputs in that environment.
  Keep unobserved backend and account identity unknown. Readiness flags and `creation:delivery` record
  checks are not live generation/display certificates or authorization to generate.
  Keep generation, local save, Library save, conversation display, review and user selection distinct.
  Queued panels, text reports and local paths are not displayed previews, including across delegated chats.
  Recover existing outputs before any retry; a delivery failure is not permission to regenerate. New
  generation needs an explicit new-generation/edit request. Respect capacity stop conditions and the
  selected model; no automatic model/provider switch or helper/security-rule bypass.
- For local generation, use the bundled `vendor/sprite-gen/SKILL.md` and its referenced workflow. `npm run sprite:setup`
  installs this checkout's source in its own venv. `npm run sprite -- <command>` runs that environment.
- Use the current user's generation account. Never copy the maintainer's credentials, home paths,
  subscription confirmations, or saved choices to another user. Preserve upstream provider selection and billing rules.
- Run creation in a workspace per `docs/EXECUTION-HOST.md` (bot service VM or the user's PC): one user per
  workspace, the user's own login only, no service API keys in the environment, work folders and attempt
  records preserved across sessions, and no pulls of this repository while a character is in progress.
  Call MCP `check_creation_readiness` before a character's first generation, after a workspace restart and before
  registration. Use purpose `generation` only for generation setup; `connection` and `registration` must not
  ask for generation subscriptions or install/update the engine. Use `connect_oddbout` start/wait for the
  supported device connection; retain pending requests and adopt the new session without a login-only restart.
  Run its kit `nextCommands` (restart when told), pass `account` only as the user stated it (else let
  the host form or numbered options ask). Use login commands only with a supported secure handoff or device
  connection. Callback URLs can contain codes/tokens: never ask users to paste them into ordinary chat or
  describe that as safe, even if tool output suggests paste mode. For a browser on another device, use the
  device connection (`--device` then `--device-wait`) only when readiness reports routes.otherDevice available,
  which requires the deployed server to advertise registration.deviceLogin "v1". The link and pairing code are
  public; tell the user to approve only a request they started and whose code matches. If no secure route is
  supported, report the authentication blocker; do not implement a bypass or assume a planned flow already exists.
- Follow `docs/CONNECTION-READINESS.md`: present the ODDBOUT connection action, then the user's Google sign-in
  and device approval. Reuse the existing device flow; no callback secrets in chat. Keep ODDBOUT API/account,
  generation access and parent delivery separate. A saved session is not a server-verified account.
  VM CONNECT/network blocks belong to the initial environment preparer; ordinary creators reuse that workspace.
  The kit cannot change VM host allowlists or Republish. Report that limitation without claiming success.
  After recovery inspect existing sessions/jobs and pending device approval before any new action.
- Design the default customer flow for one already-owned generation subscription.
  Separate actual image/video/editor capabilities from subscription names and API billing.
  Do not make a second subscription or self-hosted VACE/ComfyUI GPU server a hidden requirement.
  Remote experiments are research evidence unless explicitly selected as the product path.
  Read `docs/research/MOCHA-LOCOMOTION-HANDOFF.md` before resuming Mocha locomotion research;
  further VACE generation is currently paused for the requested architecture review.
- `examples/sparring-bot` and `npm run example` are geometric test fixtures. They do not satisfy a request
  for a generated character. Do not rename or restyle that fixture and call it sprite-gen output.
- The v1 contract requires all 11 motions, including 16 walk frames and 12 run frames. Validate actual
  motion, identity, foot alternation, and ground contact; schema/decoder success alone is not visual approval.
- Follow `docs/GAIT-REVIEW.md`: keep one coordinate/scale reference, write the phase plan before generation,
  run `fighter:gait review` with both same-foot stance ROIs, and show its preview before registration.
  Missing or uncertain observations stay unverified. Bind gait reviews to the final game-pack pixels and durations.
  Split heel/forefoot contacts, padded/hoofed/clawed soles and lifted heels (digitigrade) may use docs/FOOT-EVIDENCE.md
  only with fresh per-frame outlines of both feet; v2 evidence groups sole lobes per foot and tracks the leading ground contact.
  This is an explicit AI Fighter extension; retain the upstream report and every other rejection. Never fabricate foot identity.
- For a requested generation-free gait experiment, use `gait-guide` (docs/GAIT-REVIEW.md).
  Render and review the authored phase/IK/foot-lock proxy before any new generation.
  Proxy joints, depth and contacts are design ground truth, never observations of generated artwork.
  Show actual normal/slow previews and keep visible part masks distinct from X-ray joints.
- GPT locomotion uses this kit's hash-bound sprite-gen motion patch. Run through `npm run sprite --`.
  If the user chooses authored joint pose guidance, use the v5 measured `gen-motion` route documented in
  `docs/GAIT-REVIEW.md` and `vendor/sprite-gen/docs/pose-motion.md`: one whole-body pose per call,
  target guide + immutable appearance-only identity + reviewed anchors, 16/12-frame plans, then pose and cycle review.
  Review the actual prepared original/guide pairing in input-review.json before generation; a coordinate plan
  is not proof of anatomical fit. Inspect image_tool_trace for actual dispatch evidence. Structural canvas
  errors and unknown timeout outcomes must not consume another generation; reconcile existing results.
  New generation requires a version-2 plan with visible original body-landmark calibration.
  Measure actual body points and fresh physical-foot outlines/sole points before visual approval.
  `--measure` and explicit `--register` never generate: registration permits only a bounded uniform
  whole-body scale/translation inferred from body points, with independent foot/flight checks.
  It is not bottom alignment: feet never drive the transform, wrong anatomy is not repaired, raw
  pixels remain immutable and corrected pixels require fresh review. Geometry failures block retry
  in contract 3/4 runs. New gait-motion runs are contract 5: semantic pose prompts, diagnostic guide
  geometry, declared hidden points (`unverified_hidden`, never pass), and export gated by sequence review
  plus per-stance-interval `contact-coverage.json` (docs/GAIT-REVIEW.md).
  This explicit route exports `sprite-gen-asset` directly and does not use row extraction or bind-keyposes.
  The following init/bind steps apply to the existing row route.
  Use `fighter:gait init` for separate key-pose and full-sequence requests. Review both physical legs,
  hip attachments, contacts and whole-body continuity before `fighter:gait bind-keyposes`; missing/failed
  observations remain unverified. The full sequence must carry the actual phase guide and reviewed key-pose image.
  Preserve painted-row source Y with `fit.ground_frames: false`; do not erase flight by bottom-aligning each frame.
  A generic skeleton guide is phase vocabulary, not a measurement of this character's proportions.
  Do not splice a frozen torso onto separate legs, duplicate poses, or label a plan as observed gait.
  `gen-set` success is generation only. Stop after repeated failure of the same anatomy/contact requirement,
  preserve versions and explain the limitation instead of continuing unbounded generation or compositing.
- Build the package with `npm run sprite -- game-pack` and then `npm run fighter:pack -- <plan.json>`
  (see `docs/DOT-CREATION.md`). It measures scale, frames, origins, contacts and hashes from the pixels.
  Do not hand-assemble sheets or type those values. The plan holds contact steps, landmarks and gait review paths.
  Normal authoring uses the default reviewPolicy required; format-only is for format fixtures, not visual approval.
  Separate get-up art uses fall.getUpAnimation (docs/DOT-CREATION.md); keep auxiliary cells out of fall playback.
- Never invent hashes, origins, contact timing, successful generation, or registration results.
- A numerical flight flag is not visible flight. Check final projection and exact sample times
  with `screen_audit`, then inspect raster foot contours and occlusion separately. Keep per-foot
  projected ground references; never substitute guide labels for output observations.
  Save video latents before decoding when supported. Isolate temporal decoding artifacts on
  the same latent; do not resample diffusion or silently reduce tile size to diagnose decoding.
- Packaging and registration use local files; supported appearance previews may be generated and displayed
  directly in the current conversation. Any signed-in user may upload without an invitation or manual approval.
  Submit only within the user's request, reuse the same idempotency key for retries, and distinguish
  validation failures from post-publication moderation. Validated registrations become usable automatically.
  Never overwrite a registered immutable package.
- Preserve unrelated working-tree changes. Run only relevant tests. Do not run CI unless explicitly requested.

The sprite-gen gitlink pins the upstream revision. Keep its Apache-2.0 LICENSE and NOTICE.
Do not update the pin or modify vendor code as part of ordinary character creation.
The reviewed `patches/sprite-gen-gpt-motion.json` is applied by the kit at setup/run time and included in plugin builds.
Its hashes must match; never overwrite an unknown upstream/local change to force the patch to apply.
