# Native-sequence animation review pilot — 2026-10-29

**The candidate presentation did not demonstrate improvement at the frozen 0.8 gate. Do not promote it to
production on this evidence.** Both methods detected none of the 19 human-labeled defective judgments and
incorrectly cleared two. The candidate abstained more often and correctly answered fewer definitive labels.
Raw choices show a detection/false-rejection tradeoff, not an overall accuracy gain.

This report covers 20 completed real paired Decisions calls against independent human labels. The
[aggregate JSON](ANIMATION-REVIEW-PILOT-20261029.aggregate.json) contains counts and confusion matrices without
case IDs, assets, account details, provider request IDs or human notes. Its matrices were independently
recomputed from the frozen labels and saved answers and checked against every evaluator split and question.
The [evaluation procedure](../ANIMATION-REVIEW-EVALUATION.md#frozen-native-sequence-paired-experiment) defines the
protocol; this report records the observed outcome, not a new scoring rule.

## What was compared

Both arms used `gpt-6-luna`, `/v1/decisions`, the same original images/reference, native frame order and durations,
and five criteria: anatomy, identity, continuity, physical-foot alternation and contact. A choice becomes a
recorded decision only when **both** its confidence and chosen-choice probability are at least 0.8; otherwise
it becomes `unverified`. The threshold was not tuned after observing results.

One request per sequence contained ten independent questions. The baseline (`ordered-native-v1`) retained the
existing shared input and five question definitions. The candidate (`timeline-loop-native-v1`) added a complete
timeline, every adjacent transition including last→first, and repeated original last/first images **inside its
five questions only**. The shared baseline input did not receive candidate instructions. This was an ordered
still-image review, not video inference or observed foot tracking. No original pixels or timing were changed.

Requested and returned model values were `gpt-6-luna` for all 20 calls. The provider returned no dated snapshot
identifier, so the exact backend snapshot is **unobserved**. There was no fallback model or cascade.

Candidate authors did not access human answers or review notes while designing the presentation. The operator
had already seen the labels and prepared the label file; this was **author-level blinding, not a fully blind
workflow**. The candidate and plan were frozen before model results, and the report authors opened labels and
answers for analysis only after completion. No result-driven prompt, threshold or scorer changes were made.
The frozen plan checksum remained:

```text
c06759841c3303ff7536bb6e761c095614f7b167c26f588e9c20f18084b16c3d
```

## Dataset and denominators

The 20 sequences contain 420 candidate frames, eight walk clips and twelve run clips, from **three source
families**. Native lengths are 11, 12, 16, 18, 23 and 49 frames. Each arm answers 100 question judgments;
these are not 100 independent animations. Human labels comprise 76 clear, 19 defect and five unverified.

| Stratum | Sequences | Frames | Human clear | Human defect | Human unverified |
| --- | ---: | ---: | ---: | ---: | ---: |
| Canonical walk-16 / run-12 | 13 | 172 | 63 | 2 | 0 |
| Other native lengths | 7 | 248 | 13 | 17 | 5 |
| Calibration split | 16 | 364 | 56 | 19 | 5 |
| Held-out split | 4 | 56 | 20 | 0 | 0 |

The first two rows partition the same dataset by frame format; the last two partition it by the frozen split.
Calibration contains two source families and held-out contains one, with no family crossing the split.
All 19 defect judgments are in calibration. **Held-out defect recall cannot be estimated**, because its defect
denominator is zero. The canonical subset contains only two defect judgments. Frame format, source family and
defect prevalence are confounded, so differences between these strata do not establish a frame-count effect.

## Primary result: recorded 0.8 gate

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Completed paired cases | 20/20 | 20/20 |
| Detected human defects / human defects | 0/19 (0%) | 0/19 (0%) |
| False clears / human defects | 2/19 (10.5%) | 2/19 (10.5%) |
| False rejections / human-clear labels | 0/76 (0%) | 0/76 (0%) |
| Abstentions / all judgments | 80/100 (80%) | 84/100 (84%) |
| Correct / definitive human labels | 18/95 (18.9%) | 13/95 (13.7%) |
| Resolved predictions / all judgments | 20/100 | 16/100 |

Model abstentions remain in the 95-label accuracy denominator; the five human-unverified labels do not.
Completion coverage is 100%, but most judgments remain unresolved. Zero false rejections therefore does not
mean reliable acceptance. Both arms abstained on 17/19 defect judgments and falsely cleared the other two;
both false clears concerned identity. The candidate emitted one gated `defect` on a human-unverified continuity
judgment. It is neither a detected human defect nor a false rejection and is excluded from both denominators.

Within canonical clips, gated correct judgments fell from 15/65 to 11/65; detected defects were 0/2 for both.
Within extended native clips, gated correct judgments fell from 3/30 to 2/30; detected defects were 0/17 for both.
These small strata support no separate generalization.

## Diagnostic result: raw choices before the gate

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Detected human defects / human defects | 4/19 (21.1%) | 8/19 (42.1%) |
| False clears / human defects | 8/19 (42.1%) | 4/19 (21.1%) |
| False rejections / human-clear labels | 5/76 (6.6%) | 9/76 (11.8%) |
| Abstentions / all judgments | 40/100 (40%) | 40/100 (40%) |
| Correct / definitive human labels | 45/95 (47.4%) | 45/95 (47.4%) |

The candidate's raw continuity decisions detected 5/5 defects versus 1/5 for the baseline, while falsely rejecting
7/14 clear continuity judgments versus 2/14. Overall accuracy did not improve. All 40 alternation/contact
judgments per arm were already `unverified` in the raw choices; the probability gate did not cause those
abstentions. These were model choices, not refusals or missing responses.

The gate removed the correctly detected raw defects in both arms. This identifies a limitation of the present
scores/gate on this sample; it does **not** establish that lowering the threshold would be safe. Raw choices
are a diagnostic view, not a replacement primary result or a new acceptance policy.

## Execution and resource accounting

There were 21 server attempts and 20 completed provider calls, with 20 distinct provider request IDs checked
privately. After eight completions, the first 49-frame request hit HTTP 546 `WORKER_RESOURCE_LIMIT` before a
ledger reservation existed. Operator ledger checks established that this attempt had not dispatched a provider
call. A narrow runtime fix replaced the research-only per-byte JavaScript base64 conversion with the native
buffer codec. Source evidence, canonical content, presentation hashes and every frozen request hash were
unchanged; the 20-case/420-frame plan was recomputed and matched exactly.

Only the remaining twelve original cases resumed, using the same enrolled IDs and original request bytes.
There were **zero paid-request retries**; the known pre-dispatch failure was not treated as an unknown outcome.
No threshold, prompt, model or scorer changed during recovery. The daily cap stayed at 50. Operator closeout
confirmed 20 completed/expired cases, no unfinished reservations and 39 total ledger uses in the shared daily
window, including prior work. The candidate remains restricted to the research benchmark; production policy
was not promoted by this experiment.

The following figures describe each **shared paired call**, never an individual arm:

| Successful-call measurement | Observed total or distribution |
| --- | --- |
| Input / total tokens | 613,264 / 613,264 |
| Output tokens | 0 |
| Cache-read / cache-write input tokens | 1,349 / 184,205 |
| Server review elapsed | Median 1.347 s; nearest-rank p95 4.698 s; range 0.585–4.721 s |
| Client request wall time | Median 2.638 s; nearest-rank p95 5.434 s; range 1.241–5.930 s |

Cache-read and cache-write counts are included in input tokens, not extra tokens to add. Latency distributions
cover the 20 successful calls and exclude the HTTP 546 attempt and deployment/recovery gaps. Server elapsed
is the recorded review-call duration, not isolated model inference time. Per-arm speed, per-arm cost and actual
billed dollars were not measured and cannot be inferred by splitting shared usage in half.

## Decision and next evidence needed

Keep the candidate out of automatic production promotion. Preserve this result, including the increased
abstention and false-rejection tradeoffs. Any later experiment needs a newly frozen protocol and a new held-out
set with actual defects across additional independent source families. It should evaluate whether verified
visible-foot identity, stance/ground observations and directed transition evidence resolve the current
uncertainty; adding labels or guide coordinates alone would not establish those observations.

No further experiment is reported here. Three correlated source families, one operator-exposed label set and
a defect-free held-out split cannot support statistical significance, calibrated confidence, or population-wide
claims. Existing measured gait checks and human review remain necessary.
