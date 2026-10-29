// Offline analysis only. Never dispatches review/generation or changes approval policy.
import { createHash } from 'node:crypto';
import { reviewEvidence, questions } from '../api/decisions-review.mjs';
import { RESPONSE_REVIEW } from '../api/responses-benchmark.mjs';

const HEX = /^[a-f0-9]{64}$/;
const VALUES = ['clear', 'defect', 'unverified'];
const NAMES = questions('sequence').map(q => q.name);
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const unit = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const hash = value => typeof value === 'string' && HEX.test(value);
const identifier = (value, max) => typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9_-]+$/.test(value);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// This is the image-evidence identity, NOT the server prompt/request fingerprint.
// Normalize key order while retaining image order, reference, dimensions and timing.
export function canonicalEvidence(value) {
  if (!exact(value, ['stage', 'scope', 'images']) || value.stage !== 'sequence' || !['walk', 'run'].includes(value.scope)
    || !Array.isArray(value.images)) fail('Expected sequence evidence');
  let candidates = 0, references = 0;
  const images = value.images.map(image => {
    if (!object(image) || !['candidate', 'reference'].includes(image.role)) fail('Invalid image binding');
    const candidate = image.role === 'candidate';
    const keys = ['role', 'sha256', 'width', 'height', ...(candidate ? ['index', 'durationMs'] : [])];
    if (!exact(image, keys) || !hash(image.sha256) || ![image.width, image.height].every(n => Number.isInteger(n) && n >= 1 && n <= 2048)
      || (candidate && (image.index !== candidates || !Number.isInteger(image.durationMs) || image.durationMs < 1 || image.durationMs > 10_000))) fail('Invalid image binding');
    if (candidate) candidates++; else references++;
    return Object.fromEntries(keys.map(k => [k, image[k]]));
  });
  if (references !== 1 || candidates !== (value.scope === 'walk' ? 16 : 12)) fail('Wrong sequence image count');
  return { stage: value.stage, scope: value.scope, images };
}
export const evidenceDigest = value => digest(JSON.stringify(canonicalEvidence(value)));

export function validateLabels(manifest) {
  if (!exact(manifest, ['version', 'provenance', 'cases']) || manifest.version !== 1
    || !exact(manifest.provenance, ['method', 'reviewer', 'recordedAt'])
    || !['human-independent', 'synthetic-demo'].includes(manifest.provenance.method)
    || !identifier(manifest.provenance.reviewer, 64)
    || typeof manifest.provenance.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.provenance.recordedAt)
    || !Number.isFinite(Date.parse(manifest.provenance.recordedAt))
    || new Date(manifest.provenance.recordedAt).toISOString() !== manifest.provenance.recordedAt
    || !Array.isArray(manifest.cases) || !manifest.cases.length || manifest.cases.length > 1000) fail('Invalid labels manifest');
  const ids = new Set(), bindings = new Set(), groups = new Map(), inventories = new Map();
  return manifest.cases.map(entry => {
    if (!exact(entry, ['id', 'sourceGroup', 'split', 'evidence', 'labels']) || !identifier(entry.id, 80)
      || ids.has(entry.id) || !hash(entry.sourceGroup) || !['calibration', 'held-out'].includes(entry.split)
      || !exact(entry.labels, NAMES) || Object.values(entry.labels).some(v => !VALUES.includes(v))) fail('Invalid or duplicate labeled case');
    const evidenceSha256 = evidenceDigest(entry.evidence);
    if (bindings.has(evidenceSha256)) fail('Duplicate labeled evidence');
    if (groups.has(entry.sourceGroup) && groups.get(entry.sourceGroup) !== entry.split) fail('Source family crosses calibration/held-out split');
    // Catch undeclared frame permutations/time variants even if sourceGroup was assigned incorrectly.
    // A shared reference alone does not group unrelated candidate sequences.
    const inventory = digest(JSON.stringify(canonicalEvidence(entry.evidence).images.map(({ role, sha256, width, height }) =>
      JSON.stringify({ role, sha256, width, height })).sort()));
    if (inventories.has(inventory) && inventories.get(inventory) !== entry.split) fail('Same image inventory crosses calibration/held-out split');
    inventories.set(inventory, entry.split);
    ids.add(entry.id); bindings.add(evidenceSha256); groups.set(entry.sourceGroup, entry.split);
    return { ...entry, evidenceSha256 };
  });
}

function checkedReport(report) {
  if (!object(report) || !['completed', 'unverified', 'request_started'].includes(report.status) || !object(report.binding)) fail('Invalid saved report');
  const b = report.binding;
  if (!hash(b.requestSha256) || b.rubric !== 'hosted-sprite-v1') fail('Unsupported report binding/rubric');
  const luna = b.model === 'gpt-6-luna';
  if (luna ? b.adapter !== undefined || !unit(b.threshold)
    : !['gpt-6.1-sol', 'gpt-6-astra'].includes(b.model) || b.adapter !== 'responses-choice-v1'
      || b.confidenceType !== 'not-available' || b.reasoning !== RESPONSE_REVIEW.reasoning
      || b.maxOutputTokens !== RESPONSE_REVIEW.maxOutputTokens) fail('Unsupported report model/adapter/configuration');
  const names = luna ? NAMES : b.questionNames;
  if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(n => !NAMES.includes(n))) fail('Invalid report questions');
  if (b.policy !== undefined && (b.policy !== 'luna-sol-v1' || b.model !== 'gpt-6.1-sol' || !hash(b.parentRequestSha256))) fail('Invalid followup policy');
  const evidence = canonicalEvidence({ stage: report.stage, scope: report.scope, images: b.images });
  if (report.checks !== undefined && (!object(report.checks) || Object.keys(report.checks).some(n => !names.includes(n)))) fail('Unexpected report checks');
  const checks = {};
  for (const name of names) {
    const c = report.checks?.[name];
    if (report.status !== 'completed' || c === undefined) { checks[name] = { status: 'unverified', unavailable: true }; continue; }
    if (!object(c) || !VALUES.includes(c.status)) fail('Invalid saved check');
    if (luna && c.choice === undefined) {
      if (c.status !== 'unverified' || c.reason !== 'refusal') fail('Missing Decisions answer');
      checks[name] = { status: 'unverified' }; continue;
    }
    if (!VALUES.includes(c.choice)) fail('Invalid saved choice');
    if (luna) {
      if (!unit(c.confidence) || !exact(c.probabilities, VALUES) || !Object.values(c.probabilities).every(unit)
        || Math.abs(Object.values(c.probabilities).reduce((a, n) => a + n, 0) - 1) > 0.0001) fail('Invalid saved probabilities');
      if (c.status !== gated(c, b.threshold)) fail('Recorded status contradicts its bound threshold');
    } else if (c.status !== c.choice || typeof c.reason !== 'string' || c.reason.length > 400
      || !Array.isArray(c.frames) || c.frames.length > 16 || new Set(c.frames).size !== c.frames.length
      || c.frames.some(n => !Number.isInteger(n) || n < 0 || n >= evidence.images.length - 1)) fail('Invalid Responses answer');
    checks[name] = c;
  }
  const cohort = { model: b.model, adapter: luna ? 'decisions' : b.adapter, rubric: b.rubric,
    policy: b.policy ?? 'standalone', questionNames: NAMES.filter(n => names.includes(n)),
    ...(luna ? { recordedThreshold: b.threshold } : { reasoning: b.reasoning, maxOutputTokens: b.maxOutputTokens }) };
  return { report, checks, luna, cohort, evidenceSha256: evidenceDigest(evidence) };
}
const gated = (check, cutoff) => check.choice && check.confidence >= cutoff && check.probabilities?.[check.choice] >= cutoff ? check.choice : 'unverified';
const ratio = (n, d) => d ? n / d : null;
function emptyMetric() {
  return { expectedCases: 0, attempted: 0, notAttempted: 0, unavailable: 0,
    confusion: Object.fromEntries(VALUES.map(label => [label, Object.fromEntries(VALUES.map(prediction => [prediction, 0]))])) };
}
function finishMetric(m) {
  const c = m.confusion, defects = Object.values(c.defect).reduce((a, n) => a + n, 0), clean = Object.values(c.clear).reduce((a, n) => a + n, 0);
  const abstentions = c.clear.unverified + c.defect.unverified + c.unverified.unverified;
  return { ...m, falseClear: c.defect.clear, falseReject: c.clear.defect, detectedDefects: c.defect.defect,
    defectAbstentions: c.defect.unverified, labeledDefectAttempts: defects, labeledCleanAttempts: clean,
    humanUnverifiedAttempts: Object.values(c.unverified).reduce((a, n) => a + n, 0), abstentions,
    coverage: ratio(m.attempted, m.expectedCases), falseClearRate: ratio(c.defect.clear, defects),
    falseRejectRate: ratio(c.clear.defect, clean), defectRecall: ratio(c.defect.defect, defects),
    abstentionRate: ratio(abstentions, m.attempted) };
}
function metrics(cases, rows, names, view, cutoff) {
  const byQuestion = Object.fromEntries(names.map(n => [n, emptyMetric()])), total = emptyMetric();
  for (const entry of cases) {
    const row = rows.get(entry.evidenceSha256);
    for (const name of names) for (const m of [byQuestion[name], total]) {
      m.expectedCases++;
      if (!row) { m.notAttempted++; continue; }
      const check = row.checks[name];
      m.attempted++; if (check.unavailable) m.unavailable++;
      const prediction = view === 'raw-choice' ? check.choice ?? 'unverified'
        : view === 'frozen-cutoff' ? gated(check, cutoff) : check.status;
      m.confusion[entry.labels[name]][prediction]++;
    }
  }
  return { total: finishMetric(total), byQuestion: Object.fromEntries(Object.entries(byQuestion).map(([n, m]) => [n, finishMetric(m)])) };
}

export function evaluate(manifest, results, { cutoff = null } = {}) {
  const cases = validateLabels(manifest);
  if (cutoff !== null && !unit(cutoff)) fail('Cutoff must be a finite number in [0, 1]');
  if (!object(results) || !Array.isArray(results.calls) || results.calls.length > 5000) fail('Expected saved benchmark runner calls');
  const labels = new Map(cases.map(c => [c.evidenceSha256, c]));
  const cohorts = new Map(); let unboundCalls = 0;
  for (const call of results.calls) {
    if (!object(call) || !['response_received', 'request_started', 'transport_outcome_unknown'].includes(call.status)) fail('Invalid saved call');
    if (!call.report?.binding) { unboundCalls++; continue; }
    if (call.status !== 'response_received' || call.httpStatus !== 200) fail('Bound report contradicts call outcome');
    const reports = [call.report];
    if (call.report.followup) {
      const followup = call.report.followup;
      // Disabled/limit-skipped followups have no binding and are not model answers.
      if (followup.binding) {
        if (followup.binding.policy !== 'luna-sol-v1' || followup.binding.parentRequestSha256 !== call.report.binding.requestSha256
          || evidenceDigest({ stage: followup.stage, scope: followup.scope, images: followup.binding.images })
            !== evidenceDigest({ stage: call.report.stage, scope: call.report.scope, images: call.report.binding.images })) fail('Followup evidence/parent mismatch');
        reports.push(followup);
      }
    }
    for (const report of reports) {
      const row = checkedReport(report);
      if (!labels.has(row.evidenceSha256)) fail('Report evidence has no matching independent labels');
      const key = JSON.stringify(row.cohort);
      if (!cohorts.has(key)) cohorts.set(key, { info: row.cohort, luna: row.luna, rows: new Map() });
      const cohort = cohorts.get(key);
      if (cohort.rows.has(row.evidenceSha256)) fail('Duplicate evidence within model cohort; evaluate repeated trials separately');
      cohort.rows.set(row.evidenceSha256, row);
    }
  }
  const output = [];
  for (const { info, luna, rows } of cohorts.values()) {
    const partitions = {};
    for (const split of ['calibration', 'held-out']) {
      const subset = cases.filter(c => c.split === split);
      partitions[split] = { labeledCases: subset.length, observedCases: subset.filter(c => rows.has(c.evidenceSha256)).length,
        recorded: metrics(subset, rows, info.questionNames, 'recorded'),
        ...(luna ? { rawChoice: metrics(subset, rows, info.questionNames, 'raw-choice') } : {}),
        ...(luna && cutoff !== null ? { frozenCutoff: { cutoff, ...metrics(subset, rows, info.questionNames, 'frozen-cutoff', cutoff) } } : {}) };
    }
    output.push({ ...info, partitions,
      ...(luna ? { calibrationSweep: Array.from({ length: 11 }, (_, i) => i / 10).map(t => ({ cutoff: t,
        ...metrics(cases.filter(c => c.split === 'calibration'), rows, info.questionNames, 'frozen-cutoff', t) })) } : {}) });
  }
  return { version: 1, advisory: true, visualApproval: false, mechanicsOnly: manifest.provenance.method === 'synthetic-demo',
    provenance: manifest.provenance, labelsSha256: digest(JSON.stringify(manifest)), frozenCutoff: cutoff,
    labeledCases: cases.length, unboundCalls, cohorts: output,
    limitations: ['Human independence and source-family declarations require operator verification.',
      'Unbound calls cannot be assigned a model or evidence; inspect the server ledger, never retry automatically.',
      'Unverified human labels are excluded from defect/clean denominators; missing reports are not clean.',
      'Calibration sweep replays separate confidence and chosen-choice probability gates; it does not calibrate either score.',
      'No cutoff is selected automatically. Freeze the cutoff before inspecting held-out results.',
      'Cohorts with different question subsets or coverage are not an equal-case model comparison.',
      'Frame references are not transition localization; this evaluator does not score localization or approve artwork.'] };
}

export async function swappedPair(raw, a, b) {
  if (!(raw instanceof Uint8Array) || raw.byteLength > 8 * 1024 * 1024) fail('Request must be at most 8 MiB');
  const request = JSON.parse(Buffer.from(raw).toString('utf8'));
  const original = await reviewEvidence(request);
  if (original.stage !== 'sequence') fail('Swap requires sequence evidence');
  const slots = request.images.flatMap((image, index) => image.role === 'candidate' ? [index] : []);
  if (![a, b].every(n => Number.isSafeInteger(n) && n >= 0 && n < slots.length) || a === b) fail('Two distinct zero-based candidate indices required');
  const variant = structuredClone(request), x = slots[a], y = slots[b];
  if (request.images[x].sha256 === request.images[y].sha256) fail('Selected frames have identical bytes');
  // Swap pixels only. Each playback slot retains its original duration.
  variant.images[x] = { ...request.images[y], durationMs: request.images[x].durationMs };
  variant.images[y] = { ...request.images[x], durationMs: request.images[y].durationMs };
  const changed = await reviewEvidence(variant), variantBytes = Buffer.from(JSON.stringify(variant, null, 2) + '\n');
  const originalEvidence = canonicalEvidence({ stage: original.stage, scope: original.scope, images: original.binding });
  const variantEvidence = canonicalEvidence({ stage: changed.stage, scope: changed.scope, images: changed.binding });
  return { variantBytes, provenance: { version: 1, operation: 'swap-candidate-pixels-preserve-slot-durations', indices: [a, b],
    sourceRequestSha256: digest(raw), variantRequestSha256: digest(variantBytes), sourceGroup: evidenceDigest(originalEvidence),
    originalEvidence, variantEvidence, proposedFaultOnly: true, labels: null } };
}
