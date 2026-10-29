# Offline animation-review evaluation

`scripts/animation-review-eval.mjs` evaluates **saved** benchmark-runner results against separately recorded,
per-question human labels. It also prepares an unchanged loop and a copy with two candidate frames exchanged.
It performs no generation, network request, enrollment, credential lookup or approval. Existing Luna→Sol
behavior, its 0.8 threshold, gait checks and user review remain unchanged.

This is evaluation infrastructure, not evidence that a reviewer improved. Ordinary hosted sequence review runs
after existing gait gates pass, so those reports alone cannot estimate recall on rejected animations.
Use independently selected clean, obvious-defect and subtle-defect cases as well.

The [2026-10-29 real-call pilot](research/ANIMATION-REVIEW-PILOT-20261029.md) found no improvement at the frozen gate; its candidate remains research-only.

## Mechanics-only demonstration

Run from the repository root with its existing dependencies installed:

```powershell
node scripts/animation-review-eval.mjs demo C:/work/animation-eval-demo
node scripts/animation-review-eval.mjs evaluate C:/work/animation-eval-demo/labels.json C:/work/animation-eval-demo/results.json C:/work/animation-eval-demo/replayed.json 0.8
```

The destination directory must be new and its parent must exist. The demo creates tiny colored-square PNGs,
synthetic labels, simulated Luna answers, and an evaluation marked `mechanicsOnly: true`. Its planted outcomes
exercise a false-clear, an abstention and a held-out split. **No model is called and no real animation is graded.**
Do not combine these fixtures with a real benchmark or use their numbers to choose a production threshold.
All output files are created exclusively; existing files/directories are never overwritten.

## Freeze a small independent dataset

1. Select roughly 20–30 existing sequences covering clean, obvious and subtle problems, including cases that
   fail existing checks. This is a starting pilot, not a statistically representative quality estimate.
   Keep the original pixels, reference, canvas dimensions, order and per-frame playback times.
2. Assign each source and all its edited/permuted variants to **one** `sourceGroup` and one partition:
   `calibration` or `held-out`. Use the original sequence's evidence digest as its group ID. For related exports
   or representations of the same source, retain that same group even when their exact bytes differ.
   The evaluator also detects identical image inventories across splits despite reordered frames, changed
   durations or a mistaken group ID. Shared reference art alone does not group different candidate sequences.
3. Before seeing model answers, have a human inspect normal/slow playback and ordered frames. Record **each**
   existing sequence question: `anatomy`, `identity`, `continuity`, `alternation`, `contact`. Use `clear`, `defect`
   or `unverified`. Hidden feet, uncertain identity and missing ground evidence remain `unverified`.
   The question definitions remain in `api/decisions-review.mjs`; do not substitute a single overall label.
4. Save the label manifest separately from provider output. Use an opaque reviewer alias, an ISO timestamp,
   and `method: "human-independent"`. Freeze/version the file and any cutoff-selection cost rule before running
   comparisons. Keep held-out answers hidden while selecting the cutoff. The program validates declarations
   and hashes, but cannot prove human independence, blinding, honest labels or complete source-family ancestry.

The label manifest format is:

```json
{
  "version": 1,
  "provenance": {
    "method": "human-independent",
    "reviewer": "reviewer-a",
    "recordedAt": "2026-01-01T00:00:00.000Z"
  },
  "cases": [
    {
      "id": "walk-original",
      "sourceGroup": "REPLACE_WITH_ORIGINAL_EVIDENCE_SHA256",
      "split": "calibration",
      "evidence": "REPLACE_WITH_PAIR_ORIGINAL_EVIDENCE_OBJECT",
      "labels": {
        "anatomy": "unverified",
        "identity": "unverified",
        "continuity": "unverified",
        "alternation": "unverified",
        "contact": "unverified"
      }
    }
  ]
}
```

This is a schema illustration with deliberately invalid placeholders, not a labeled dataset. Replace the
timestamp and labels with actual review records. `evidence` is `{stage, scope, images}`; copy the exact
`originalEvidence`/`variantEvidence` objects from the pair preparation below, or the saved report's
`{stage, scope, images: binding.images}`. All candidate entries include zero-based index, SHA-256, width,
height and duration; the reference includes its role, SHA-256 and dimensions. Version 1 accepts
the existing 16-frame walk and 12-frame run sequence formats. The native research format below is separate.

For a source without a pair, `evidenceDigest(evidence)` exported by `scripts/animation-review-eval-lib.mjs`
computes its group ID. Do not invent hashes or reuse the server's prompt fingerprint as an evidence ID.
Only opaque aliases and public fixtures belong in this repository; keep real benchmark assets/labels/results
in an operator-controlled directory outside the checkout.

## Prepare a controlled frame-order pair

Given an existing benchmark request body (`stage`, `scope`, inline `images`):

```powershell
node scripts/animation-review-eval.mjs swap C:/work/existing-walk.request.json 4 9 C:/work/walk-order-pair
```

The command verifies image headers/hashes through the existing evidence validator. It writes:

- `original.request.json`: byte-for-byte copy of the original request.
- `swapped.request.json`: only the two candidate images exchange slots. Image data, hashes and dimensions
  are unchanged; **each playback slot retains its original duration**, including unequal-duration sequences.
- `pair.json`: both evidence bindings, request-file hashes, the original source group, selected indices,
  `proposedFaultOnly: true`, and `labels: null`.

Indices refer to candidate frames only; a reference image is never swapped. The command rejects duplicate
indices, out-of-range indices, identical selected image bytes, and invalid source evidence. It does not render,
enroll or submit either request. A human must view the pair and decide whether the proposed swap actually
creates a visible defect; swapping two frames is not an automatic defect label. Keep source and swapped
variants in the same split, preferably presented under blinded/randomized aliases during labeling.

Original request-file hashes, server model-request fingerprints and normalized evidence hashes are different
identities. Pair provenance hashes raw request files; the evaluator matches **complete image evidence** across
models. In particular, runner `calls[].requestSha256` must not be compared with `report.binding.requestSha256`
as though both hash the same object. The latter includes model prompts/configuration. The CLI records hashes
of its label and result input files for audit, but local files are not cryptographically authenticated server logs.
Identical image evidence also does not establish identical design intent, prompt wording or blind labels;
freeze those in the operator's experiment records and verify the same intent/question protocol across arms.

## Score saved results

Use the existing authorized server benchmark workflow in [SERVER-DECISIONS-REVIEW.md](SERVER-DECISIONS-REVIEW.md)
when actual calls are separately authorized. This utility cannot make them. Its results input is the JSON saved
by `scripts/decisions-benchmark-runner.mjs`, including `calls[].report`. For separate Luna/Sol/Astra runs, combine
their `calls` arrays locally into one JSON object only after checking provenance; do not copy model answers
into the label file. Duplicate evidence within one model/configuration cohort is rejected, so repeated trials
need separate evaluations rather than being counted as independent examples.

```powershell
node scripts/animation-review-eval.mjs evaluate C:/work/labels.json C:/work/saved-results.json C:/work/evaluation.json 0.8
```

The optional final number is an **explicitly frozen experimental cutoff**, applied to both Luna confidence
and chosen-choice probability independently. It never modifies production configuration. Omitting it leaves
the recorded baseline and raw-choice views but produces no candidate-cutoff held-out view. The output has a
calibration-only sweep from 0 to 1 in 0.1 increments. No cutoff is automatically selected or called calibrated:
choose from calibration data according to a predeclared cost for missed defects, false rejects and abstentions,
then freeze it before inspecting held-out results. Probability and confidence are different scores, and a
threshold sweep does not make either a calibrated probability. Small samples warrant reporting counts and
denominators, not claiming a statistically established improvement.

Each cohort records model, adapter, rubric, question subset, policy and (for Luna) stored threshold. Luna
raw choices and recorded gate results remain separate. Sol/Astra have no synthetic probability or cutoff.
Responses reports must carry the current adapter's fixed reasoning/output-token configuration; missing or
different values are rejected rather than merged into a misleading shared cohort.
Embedded Sol followups are checked against their parent request and identical evidence, then scored in their
own subset cohort; their answers never overwrite Luna. Different question subsets/coverage are not equal-case
model comparisons. The output separates calibration and held-out partitions, with per-question counts and:

| Field | Meaning |
| --- | --- |
| `falseClear`, `falseClearRate` | Human `defect` predicted `clear`, divided by attempted human-defect labels. |
| `detectedDefects`, `defectRecall` | Human `defect` predicted `defect`, divided by attempted human-defect labels **including abstentions**. |
| `defectAbstentions` | Human `defect` predicted `unverified`; not counted as clear or detected. |
| `falseReject`, `falseRejectRate` | Human `clear` predicted `defect`, divided by attempted human-clear labels. |
| `abstentions`, `abstentionRate` | All attempted predictions that are `unverified`. |
| `unavailable` | Bound report unfinished/failed, or a requested check absent; counted as `unverified`. |
| `notAttempted`, `coverage` | Labels without a matching report in this cohort, and attempted/expected coverage. |
| `humanUnverifiedAttempts` | Human labels without an established clean/defect answer; excluded from those rate denominators. |
| `confusion` | All three human-label × prediction counts, including human `unverified`. |

`total` sums **question judgments**, not independent animations; `labeledCases` and `observedCases` count
sequences. Rates with no applicable denominator are `null`. No answered-only accuracy is reported: an
all-abstaining reviewer has zero defect recall when human defects exist. Missing reports do not enter quality
rate denominators, so always inspect coverage alongside rates. `unboundCalls` counts calls with no evidence
binding; inspect the server ledger before drawing a conclusion or taking any separately authorized action.
An unknown outcome never causes an automatic retry. Missing outcomes are not successful reviews.

## Frozen native-sequence paired experiment

Version 2 labels use the same case/provenance fields above, with `version: 2` and the additional top-level
`evidencePolicy: "native-2-64-v1"`. Each case retains one original reference and 2–64 native candidate frames,
with exact pixels, dimensions, order and durations. Production validation and registration still require
16 walk / 12 run frames. Never duplicate, drop, resample or recompress source frames to fit the experiment.

Freeze the protocol **before the candidate author reads human answers, notes or model results**. This is
author-level blinding, not a claim that the entire workflow is blind: the operator may already have inspected
human answers and prepared the label manifest. Record that exposure separately from the candidate author's
lack of access; the current workflow's operator has seen the labels. No tuning follows model results. Source-family
assignments and calibration/held-out splits remain fixed across variants. A pilot with three source families
still has three families, even if it contains many clips or question judgments. Record deviations and disclose
the limited independence; do not claim a statistically significant or guaranteed improvement.

The fixed comparison uses Luna/Decisions and the existing five questions and 0.8 confidence **and** chosen-choice
probability gates in both arms. One enrolled case sends one request with ten independent questions:

- `ordered-native-v1`: unchanged shared developer/input content and the original five question definitions.
- `timeline-loop-native-v1`: five `improved_` questions add a complete timeline, every directed adjacency
  including last→first, whole-cycle inspection instructions, and a last/first panel of the **same original
  images**. Only those questions carry the extra evidence. The baseline shared prefix stays unchanged.

This uses [independent questions and question-local images](https://developers.openai.com/api/docs/guides/decisions).
The question-local timeline/mapping is serialized as `input_text`; image parts retain `detail: "original"`.
The repeated panel is a derived presentation, not new frames, motion measurements or an altered playback.
It maps explicitly to original frame indices and hashes. No contact-sheet raster or pixel transform is used.
Both arms share call-level latency, token usage and outcome availability; **per-arm cost/speed is unmeasured**.
This transport is kept separate from standalone reviewer cohorts. No model fallback or cascade is permitted.

Prepare a label-free selection JSON with exactly `version: 1` and `cases`. Each case has `id`, `sourceGroup`,
`split`, `request` (path to original request JSON), `requestSha256`, and `intent`. The intent has exactly
`description`, `brief`, `appearance_note`, `motion_note`; use null for absent notes. Do not include labels,
human review comments or cohort descriptions inferred from answers. Freeze with:

```powershell
node scripts/animation-review-plan.mjs C:/work/selection.json C:/work/frozen-plan.json
```

The command verifies original request hashes and all source images, preserves family/split declarations and
exclusively writes a plan. It performs no calls. `freezeComparison` exports the same operation for local tooling,
accepting `{id, sourceGroup, split, raw: Uint8Array, intent}` entries. The plan distinguishes:

- `sourceRequestSha256`: original request-file bytes, including inline PNGs.
- `sourceEvidenceSha256`: canonical original ordered image/reference/dimension/timing binding.
- `presentationSha256`: the method's explicit mapping to those originals.
- `requestSha256`: the complete paired provider request; both virtual arms share this value.
- `planSha256`: the frozen protocol plus all cases, splits and expected method request/presentation hashes.

An operator enrolls one case per sequence with `intent.sequenceBenchmark` set to
`{ "method": "paired-native-v1", "planSha256": "REPLACE_WITH_FROZEN_PLAN_SHA256" }` and the frozen intent/evidence.
The worker supplies only the original request bytes. This config cannot combine with Responses or cascade
settings. The existing host authorization, one-call ledger and shared daily quota apply. Benchmark requests
are bounded to 32 MiB, each source image to the existing 2 MiB, and the research timeout is fixed at 110 seconds;
production remains 8 MiB and 25 seconds. Native binding storage requires the narrowly bounded
`20261029071902_native_sequence_benchmark.sql` migration (16,000-byte metadata bound; no permission/quota change).

Once the plan is frozen, import the independently recorded labels and evaluate saved calls with:

```powershell
node scripts/animation-review-eval.mjs evaluate C:/work/labels-v2.json C:/work/results.json C:/work/evaluation.json 0.8 C:/work/frozen-plan.json
```

Evaluation rejects changed source pixels/timing, family/split drift, question mappings, request/presentation
hashes or threshold. Both cohorts include expected/observed coverage; `pairedComparison` uses the same source
cases and shows prediction transitions, false clears/rejects, defect recall, abstentions and accuracy on
definitive human labels, including model abstentions in its denominator. Human `unverified` labels remain
separate. No reports yields zero coverage, never synthetic answers. No threshold sweep is emitted for these
frozen research cohorts. Report unchanged or worse performance as observed; do not tune after opening labels.

An unknown provider, transport or finish-store outcome retains its reservation. The server and runner never
retry it; the runner stops at the first incomplete/refused outcome. Reconcile the existing ledger before any
further separately authorized work. Do not enlarge daily quota or rotate credentials to complete a benchmark.
Keep source assets, source manifests, labels, frozen plans and results outside the public checkout.

## Next experiments and evidence limits

The community suggestions motivating this pilot are hypotheses:
[baseline and per-question labels](https://www.reddit.com/r/AI_Agents/comments/1xi99ng/openai_decisions_api_for_sprite_animation_review/),
[controlled frame swaps](https://www.reddit.com/r/AI_Agents/comments/1xi99ng/comment/19rtdduniqim8/), and
[endpoint/foot diagnostics](https://www.reddit.com/r/AI_Agents/comments/1xi99ng/comment/19rtdnvq8ugg1/).
The [Decisions guidance](https://developers.openai.com/api/docs/guides/decisions) motivates labeled application
examples and explicit error costs, not treating an untested 0.8 cutoff as a universal guarantee.

Contact-sheet versus ordered-frame comparison is **not implemented** here. A future experiment must preserve
source pixels, order, timing metadata and declared image scale, with a reviewed server evidence adapter rather
than silently feeding a contact sheet into the current per-frame schema. Use the same cases in both arms and
retain source groups across partitions. Do not assume either representation wins.

Transition localization is also unscored: Decisions fixed choices do not localize, and Responses frame indices
alone do not establish which directed transition is bad. A future localization metric needs independently
labeled adjacent frame pairs, including last→first, and a matching response schema. A first/last pixel difference
is diagnostic only; valid loops do not need duplicate endpoint frames. Foot tracking requires observed physical
foot identity and a stable ground reference. Neither generated guide coordinates nor numeric differences can
replace the existing measured gait evidence or resolve hidden feet into a pass.
