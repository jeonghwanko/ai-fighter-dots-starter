# AI Fighter creator kit

This repository lets each user create their own fighter through Dot. Read
`docs/DOT-CREATION.md`, `docs/AUTHORING.md`, and the live AI Fighter spec before creating a package.

- Read `docs/CREATION-UX.md` for intent, text/image intake, account choices and the process evaluation rubric.
  Process design/review requests and forwarded example characters are not authorization to generate a character.
  Follow the latest direct user intent; stop dependent generation when that intent changes.
- Accept text, reference images, or both. Ask only about missing reference roles or material conflicts.
  Distinguish user requirements from proposed details; do not make users complete a long character form.
- Default recommendation: GPT base + Grok video when both are available, all Grok when only Grok is available,
  all GPT when only GPT is available. Explicit user choices override this product preference. Confirm current
  access in one understandable question; this recommendation never authorizes an automatic runtime provider switch.

- Creation is conversational in meaningful review groups: appearance (concept/idle), locomotion
  (fightIdle/walk/run), attacks (combo/slam/dash), defense and reactions (block/hit/groggy/fall), then final review.
  Complete the agreed group autonomously, show its actual previews together, and wait for feedback at the
  group boundary, not after every motion. A positive response advances to the next group without another
  permission question. Only skip review boundaries when the user explicitly delegates those groups.
  Reuse choices the user already made; a request to create/register alone does not waive group feedback.
  Read the full feedback: praise with a revision request is a revision; praise of one motion is not group acceptance.
- Ask only for missing creative decisions that affect the next preview. Handle installation, extraction,
  measurement and validation within the agreed step without making the user approve each command.
  Show actual images/animation, not only progress text. Preserve selected versions and revise affected
  assets only. Follow the feedback and work-note rules in `docs/DOT-CREATION.md`.
- Use the bundled `vendor/sprite-gen/SKILL.md` and its referenced workflow. `npm run sprite:setup`
  installs this checkout's source in its own venv. `npm run sprite -- <command>` runs that environment.
- Use the current user's generation account. Never copy the maintainer's credentials, home paths,
  subscription confirmations, or saved choices to another user. Preserve upstream provider selection and billing rules.
- `examples/sparring-bot` and `npm run example` are geometric test fixtures. They do not satisfy a request
  for a generated character. Do not rename or restyle that fixture and call it sprite-gen output.
- The v1 contract requires all 11 motions, including 16 walk frames and 12 run frames. Validate actual
  motion, identity, foot alternation, and ground contact; schema/decoder success alone is not visual approval.
- Follow `docs/GAIT-REVIEW.md`: keep one coordinate/scale reference, write the phase plan before generation,
  run `fighter:gait review` with both same-foot stance ROIs, and show its preview before registration.
  Missing or uncertain observations stay unverified. Bind gait reviews to the final game-pack pixels and durations.
  Split heel/forefoot contacts may use docs/FOOT-EVIDENCE.md only with fresh per-frame outlines of both feet.
  This is an explicit AI Fighter extension; retain the upstream report and every other rejection. Never fabricate foot identity.
- Build the package with `npm run sprite -- game-pack` and then `npm run fighter:pack -- <plan.json>`
  (see `docs/DOT-CREATION.md`). It measures scale, frames, origins, contacts and hashes from the pixels.
  Do not hand-assemble sheets or type those values. The plan holds contact steps, landmarks and gait review paths.
  Normal authoring uses the default reviewPolicy required; format-only is for format fixtures, not visual approval.
  Separate get-up art uses fall.getUpAnimation (docs/DOT-CREATION.md); keep auxiliary cells out of fall playback.
- Never invent hashes, origins, contact timing, successful generation, or registration results.
- Creation is local. Any signed-in user may upload without an invitation or manual approval.
  Submit only within the user's request, reuse the same idempotency key for retries, and distinguish
  validation failures from post-publication moderation. Validated registrations become usable automatically.
  Never overwrite a registered immutable package.
- Preserve unrelated working-tree changes. Run only relevant tests. Do not run CI unless explicitly requested.

The sprite-gen gitlink pins the upstream revision. Keep its Apache-2.0 LICENSE and NOTICE.
Do not update the pin or modify vendor code as part of ordinary character creation.
