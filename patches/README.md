# AI Fighter's sprite-gen GPT motion patch

`sprite-gen-gpt-motion.json` is a reproducible local patch against commit
`38bddef764183fe2044bc85c764b0572409a6b15` (2.44.0). The gitlink stays pinned.
These are AI Fighter changes, not a claim that upstream shipped them.
Keep upstream Apache-2.0 LICENSE and NOTICE with the patched distribution.

`scripts/sprite-patch.mjs` verifies normalized UTF-8/LF SHA-256 before applying
zero-based line replacements and verifies the resulting hashes. A null `before`
means a new file must not exist. Applied files are reused; unknown changes cause
an error without being overwritten. Setup, the kit CLI and plugin bundling all
use this check. Bundling permits only these reviewed dependency changes and
includes the new module and patch; no unpublished submodule commit is needed.

The patch:

- v8 (`ai-fighter-gpt-motion-v8-semantic-coverage`) applies the single-subscription
  locomotion review. New gait-motion runs use contract 5: prompts name the pose
  (support, planted/lifted leg, ahead/behind own hip, knee bend) instead of sending
  float joint/world-state/ground dumps; guide geometry is diagnostic and no longer
  blocks visual review or a visual retry; hidden heel/toe points are declared
  (`hidden`, `null`) and reported `unverified_hidden`, never pass; export also
  requires `contact-coverage.json` per physical stance interval and run flight.
  The gait profile gains an optional run-only `flight_lift` so a jog duty (0.4)
  has readable flight; the example returns to duty 0.4 with flight_lift 0.15,
  which also restores the native-ray flight test v7 broke. Contract 3/4 runs keep
  their gates. A blind annotation repeatability check (no generation) kept the
  provisional 0.6% coverage tolerance, moved coverage's body-reliability cutoff to
  2.4% because 1.2% flipped by annotator, and pinned the nostril/toe/heel
  definitions in `docs/pose-motion.md`. No generation was run to validate v8.

- v7 (`ai-fighter-gpt-motion-v7-screen-flight`) rejects numerical run-flight
  schedules whose simultaneous foot lift is unresolved at the final projection
  and sample times. Both half-cycles need a >=4px sample; video integrations must
  also check exact timestamps and camera scale. This proxy gate does not measure
  raster visibility or approve AI output. The example run duty changes to0.25.
  See `docs/research/MOCHA-LOCOMOTION-HANDOFF.md` for the measured subpixel-flight
  failure, decoder isolation, and the single-subscription product constraint.

- v6 (`ai-fighter-gpt-motion-v6-gait-guides`) adds a generation-free `gait-guide`
  utility: shared continuous phase, fixed-length 2-bone IK, world-space foot
  locking and depth-tested proxy rendering. Mocha is an authored proportion
  example, not regenerated art. Dense kinematic checks and rendered part/depth
  evidence are separate from existing image/pose approval. V5 generation gates
  and provider choices remain intact.
  The explicit `gait-motion` bridge binds the approved continuous joints,
  contacts, depth and separate visible/amodal references to version-2 pose plans.
  Its optional elevated camera projects the world ground per foot. Foot masks
  are ray-rendered directly at the final canvas resolution; every frame in both
  motions must pass the unchanged geometry tolerance and raster contract before
  any generation. Camera and sample changes remain authored input evidence.

- v5 (`ai-fighter-gpt-motion-v5-geometry`) adds calibrated original body landmarks
  in version-2 pose plans, hash-bound observed body/foot geometry, and independent
  pixel contact/clearance/pose checks before anchors or export. Explicit measured
  registration corrects only bounded uniform whole-body scale/translation from
  body points; feet cannot drive floor alignment. Raw pixels are preserved,
  corrected pixels are remeasured and require fresh visual review. Geometric
  failure blocks regeneration. Legacy runs retain their original contracts.

- v4 (`ai-fighter-gpt-motion-v4-pose-inputs`) adds target-first reference roles,
  readable joint/contact guides, normalized placement language and input review.
  Retries carry only failed visual observations; structural failures cannot
  regenerate. The motion runner disables lower-level timeout retry, explicitly
  requests native alpha and preserves sessions. Codex reports retain actual
  image-tool call source separately from requested references. Old review bindings
  are archived after canvas normalization. These are input/reliability fixes;
  actual gait quality still needs a new observed trial.

- v3 (`ai-fighter-gpt-motion-v3-pose-canvas`) adds opt-in same-aspect whole-canvas
  resolution normalization with immutable provider bytes and transform provenance.
  Known v2 bytes have explicit hash-bound upgrade hunks; unknown edits still stop.

- v2 (`ai-fighter-gpt-motion-v2-pose`) adds `gen-motion`, authored joint/foot-contact
  guides, original + pose + reviewed-anchor references, bounded single-pose retries,
  hash-bound pose/cycle reviews and fixed-canvas asset export. Its implementation
  and offline tests are ported from the user's reviewed sprite-gen checkout without
  changing the vendor pin. See `vendor/sprite-gen/docs/pose-motion.md`;

- preserves a painted row's source Y before component cropping and applies one
  scale/vertical translation when `fit.ground_frames` is false;
- retains `states.<state>.motion` through prepare and puts its phase instructions
  in the generated prompt;
- attaches hash-checked phase guides and reviewed key-pose images during gen-set,
  requiring the key-pose review before full sequence generation;
- binds reuse to the prompt, references, motion plan and requested provider/model;
- preserves ambiguous attempts and outputs without automatically retrying;
- reports image generation separately from unverified motion quality.

The patch does not add a temporal neural model, infer anatomy, repair a bad gait,
or prove visual approval. See `docs/GAIT-REVIEW.md` for the complete workflow.
Extraction changes invalidate upstream derived-frame caches. Preserve accepted
versions and review re-extracted pixels before reusing any prior approval.

For maintenance, edit the pinned source deliberately, regenerate each changed
file's line replacements from the pinned original (available through `git show`
in the submodule), and update both normalized hashes. New files use a null base.
Do not regenerate hashes merely to suppress an unexpected local-change error.
Run `node --test test/gpt-motion.test.mjs test/gait.test.mjs test/gait-engine.test.mjs test/pack.test.mjs`.
The tests use synthetic geometry and a fake generation transport; they never
spend generation credits or establish a character's visual quality.
