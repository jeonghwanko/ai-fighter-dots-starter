#!/usr/bin/env node
// Hosted generation measurement (docs/MEASUREMENT.md). Reads the JSON from scripts/measure-export.sql (db.json) and, optionally, the
// host ledger (`og report --json`), and writes kpis.json and clip-labels.jsonl. It never connects to anything and reads no requester text.
// node scripts/measure-export.mjs --db db.json [--ledger ledger.json] --out-dir output/measure-YYYYMMDD
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const READY = { appearance_ready: 'appearance', motion_ready: 'motions' };
const ANSWERS = new Set(['appearance-answer', 'motion-answer', 'register', 'cancelled']);
const ENDED = new Set(['submitted', 'rejected', 'failed', 'needs_review', 'cancelled', 'expired']);
const LOOKS = ['look-a', 'look-b'];

/** The worker's folder name for a job (generation-stages.mjs `ogJobId`): the ledger is kept by it. */
export const ogJobId = job => `${new Date(job.createdAt).toISOString().slice(0, 10).replaceAll('-', '')}-gen-${job.id.replaceAll('-', '')}`;
const ms = (a, b) => Date.parse(b) - Date.parse(a);
const rate = (n, d) => (d ? n / d : null);
function spread(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), at = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return sorted.length ? { n: sorted.length, p50: at(0.5), p95: at(0.95), mean: sorted.reduce((s, v) => s + v, 0) / sorted.length } : { n: 0 };
}
const count = (map, key, by = 1) => { map[key] = (map[key] ?? 0) + by; return map; };
const minutes = list => spread(list.map(v => v / 60000));

/** One job's events in order, read once: what the user answered, how long each stage and each wait took, which release made it. */
export function timeline(job, events) {
  const own = events.filter(e => e.jobId === job.id).sort((a, b) => (a.id ?? 0) - (b.id ?? 0) || a.at.localeCompare(b.at));
  const t = { job, events: own, stageMs: {}, claims: {}, waitsMs: [], calls: {}, kit: null, engine: null,
    stageReviews: [], stageRetries: [], operatorRetries: 0, operatorWaitsMs: [], cancelledAfterReview: false, workerPicks: 0, gaits: [] };
  let claimed = null, ready = null, reviewed = null;
  for (const e of own) {
    const data = e.data ?? {};
    if (e.kind === 'versions') { t.kit = data.kit ?? t.kit; t.engine = data.engine ?? t.engine; }
    if (e.kind === 'claimed') { claimed = e; count(t.claims, data.status ?? 'unknown'); }
    if (e.kind === 'finished') {
      const stage = claimed?.data?.status ?? 'unknown';
      if (claimed) (t.stageMs[stage] ??= []).push(ms(claimed.at, e.at));
      claimed = null;
      // A stage that stopped for an operator, or will run again: the job may still end well, so the end state alone hides these.
      if (data.outcome === 'review') { t.stageReviews.push({ stage, code: data.code ?? 'none' }); reviewed = e; }
      if (data.outcome === 'retry') t.stageRetries.push({ stage, code: data.code ?? 'none' });
      if (['a', 'b'].includes(data.choice)) t.workerPicks += 1;   // 맡기기: the look the worker's judge chose
      for (const [tool, v] of Object.entries(data.calls ?? {})) if (Array.isArray(v)) t.calls[tool] = (t.calls[tool] ?? [0, 0, 0]).map((x, i) => x + (v[i] ?? 0));
      if (READY[data.status]) ready = e;
    }
    if (ANSWERS.has(e.kind) && ready) { t.waitsMs.push(ms(ready.at, e.at)); ready = null; }
    if (e.kind === 'operator' && data.action === 'retry') {
      t.operatorRetries += 1;
      if (reviewed) { t.operatorWaitsMs.push(ms(reviewed.at, e.at)); reviewed = null; }
    }
    if (e.kind === 'cancelled' && reviewed) { t.cancelledAfterReview = true; reviewed = null; }
    if (e.kind === 'gait' && ['walk', 'run'].includes(data.gait)) t.gaits.push(data);   // how a walk or run ended, every cut tried
  }
  const first = kind => own.find(e => e.kind === kind);
  t.firstAppearance = first('appearance-answer') ?? null;
  const firstMotionReady = own.find(e => e.kind === 'finished' && e.data?.status === 'motion_ready');
  t.reachedAppearance = own.some(e => e.kind === 'finished' && e.data?.status === 'appearance_ready');
  t.reachedMotions = Boolean(firstMotionReady);
  t.firstMotionDecision = firstMotionReady ? own.find(e => e.id > firstMotionReady.id && ['motion-answer', 'register'].includes(e.kind)) ?? null : null;
  t.register = first('register') ?? null;
  t.created = first('created') ?? null;
  t.delegated = t.created ? t.created.data?.delegate === true : null;   // unknown for jobs created before the request said
  return t;
}

/** The numbers of docs/MEASUREMENT.md over a set of jobs. Each rate names its denominator; with no jobs behind it a rate is null. */
export function kpis(timelines, { reviews = [], ledger = null } = {}) {
  const ids = new Set(timelines.map(t => t.job.id)), jobs = timelines.map(t => t.job);
  const answeredLook = timelines.filter(t => t.firstAppearance), decidedMotion = timelines.filter(t => t.firstMotionDecision);
  const reachedMotions = timelines.filter(t => t.reachedMotions).length, registered = timelines.filter(t => t.register);
  const reachedReady = timelines.filter(t => t.reachedAppearance || t.reachedMotions);
  const clipRevisions = {};
  for (const t of timelines) for (const e of t.events) if (e.kind === 'motion-answer') count(clipRevisions, e.data?.clip ?? 'unknown');
  const stageMs = {}, claims = {}, calls = {};
  for (const t of timelines) {
    for (const [stage, list] of Object.entries(t.stageMs)) (stageMs[stage] ??= []).push(...list);
    for (const [stage, n] of Object.entries(t.claims)) (claims[stage] ??= []).push(n);
    for (const [tool, v] of Object.entries(t.calls)) calls[tool] = (calls[tool] ?? [0, 0, 0]).map((x, i) => x + v[i]);
  }
  const statuses = {}, errors = {};
  for (const j of jobs) { count(statuses, j.status); if (['failed', 'needs_review'].includes(j.status)) count(errors, j.errorCode ?? 'none'); }
  const ledgerOf = new Map((ledger?.jobs ?? []).map(j => [j.job, j]));
  const runsPerRegistered = {};
  for (const t of registered) {
    for (const [provider, v] of Object.entries(ledgerOf.get(ogJobId(t.job))?.providers ?? {})) (runsPerRegistered[provider] ??= []).push(v.runs ?? 0);
  }
  const reviewCodes = {}, reviewStages = {}, retryCodes = {};
  for (const t of timelines) {
    for (const r of t.stageReviews) { count(reviewCodes, r.code); count(reviewStages, r.stage); }
    for (const r of t.stageRetries) count(retryCodes, r.code);
  }
  const reviewedJobs = timelines.filter(t => t.stageReviews.length), known = timelines.filter(t => t.delegated !== null);
  // Walk and run (the `gait` events): how each branch ended, the take that passed, why each cut was refused, the frames filmed and delivered.
  const gaits = {};
  for (const t of timelines) for (const g of t.gaits) {
    const row = gaits[g.gait] ??= { branches: 0, outcomes: {}, codes: {}, passedTake: {}, fromWalk: 0, cuts: 0, refusedBy: {}, judgeFailed: {}, filmedFrames: {}, deliveredFrames: {}, jolts: [] };
    row.branches += 1; count(row.outcomes, g.outcome ?? 'unknown');
    if (g.code) count(row.codes, g.code);
    if (g.note === 'run-from-walk') row.fromWalk += 1; else if (g.outcome === 'ok') count(row.passedTake, String(g.take ?? 'unknown'));
    for (const c of g.tried ?? []) {
      row.cuts += 1;
      for (const r of c.reasons ?? []) count(row.refusedBy, r.replace(/^frames-\d+$/, 'frames-out-of-range'));
      for (const k of c.judge ?? []) count(row.judgeFailed, k);
      if (Number.isInteger(c.from)) count(row.filmedFrames, String(c.from));
      if (Number.isInteger(c.frames)) count(row.deliveredFrames, String(c.frames));
      if (typeof c.jolt === 'number') row.jolts.push(c.jolt);
    }
  }
  const ownReviews = reviews.filter(r => ids.has(r.jobId)), reviewStatus = {}, reviewScopes = {};
  for (const r of ownReviews) { count(reviewStatus, r.status ?? 'unknown'); count(reviewScopes, r.scope ?? 'unknown'); }
  return {
    jobs: jobs.length,
    appearanceFirstChoice: { rate: rate(answeredLook.filter(t => !t.firstAppearance.data?.revise).length, answeredLook.length), of: answeredLook.length },
    motionFirstAccept: { rate: rate(decidedMotion.filter(t => t.firstMotionDecision.kind === 'register').length, decidedMotion.length), of: decidedMotion.length },
    clipRevisions: Object.fromEntries(Object.entries(clipRevisions).map(([clip, n]) => [clip, { n, perJobAtMotions: rate(n, reachedMotions) }])),
    revisionsPerRegistered: spread(registered.map(t => (t.job.appearanceRevisions ?? 0) + (t.job.motionRevisions ?? 0))),
    endStates: statuses,
    failureCodes: errors,
    failureOrReviewRate: { rate: rate(jobs.filter(j => ['failed', 'needs_review'].includes(j.status)).length, jobs.length), of: jobs.length },
    stageReviews: { total: reviewedJobs.reduce((s, t) => s + t.stageReviews.length, 0), jobs: reviewedJobs.length,
      jobRate: rate(reviewedJobs.length, jobs.length), byCode: reviewCodes, byStage: reviewStages,
      perJob: spread(reviewedJobs.map(t => t.stageReviews.length)) },
    stageRetries: { total: timelines.reduce((s, t) => s + t.stageRetries.length, 0), byCode: retryCodes },
    operatorRetries: timelines.reduce((s, t) => s + t.operatorRetries, 0),
    operatorWaitMinutes: minutes(timelines.flatMap(t => t.operatorWaitsMs)),
    cancelledAfterReview: { n: timelines.filter(t => t.cancelledAfterReview).length, of: reviewedJobs.length },
    delegated: { rate: rate(known.filter(t => t.delegated).length, known.length), of: known.length,
      workerPicks: timelines.reduce((s, t) => s + t.workerPicks, 0) },
    gaits: Object.fromEntries(Object.entries(gaits).map(([gait, { jolts, ...row }]) => [gait, { ...row, jolt: spread(jolts) }])),
    abandonRate: { rate: rate(reachedReady.filter(t => ['cancelled', 'expired'].includes(t.job.status)).length, reachedReady.length), of: reachedReady.length },
    stageMinutes: Object.fromEntries(Object.entries(stageMs).map(([stage, list]) => [stage, minutes(list)])),
    claimsPerStage: Object.fromEntries(Object.entries(claims).map(([stage, list]) => [stage, spread(list)])),
    userWaitMinutes: minutes(timelines.flatMap(t => t.waitsMs)),
    minutesToRegister: minutes(registered.filter(t => t.created).map(t => ms(t.created.at, t.register.at))),
    calls: Object.fromEntries(Object.entries(calls).map(([tool, [runs, failed, seconds]]) => [tool, { runs, failed, seconds }])),
    providerRunsPerRegistered: ledger ? Object.fromEntries(Object.entries(runsPerRegistered).map(([p, list]) => [p, spread(list)])) : null,
    decisions: { reviews: ownReviews.length, byStatus: reviewStatus, byScope: reviewScopes,
      inputTokens: ownReviews.reduce((s, r) => s + (Number(r.usage?.input_tokens) || 0), 0) },
  };
}

/**
 * Clip-level labels from what users did (weak labels, docs/MEASUREMENT.md). A motion clip's version is the number of revisions asked of it
 * before; the version a revision names is `rejected`, the versions current at registration `accepted`. A look round both of whose looks
 * were sent back is `rejected`; the chosen look `accepted`, the other `not-chosen` (a preference, not a defect). Clips of a job that never
 * registered stay unlabeled. Each label carries the Decisions review of that clip version when there is one.
 */
export function clipLabels(timelines, reviews = []) {
  const rows = [];
  for (const t of timelines) {
    const versions = {}, mine = reviews.filter(r => r.jobId === t.job.id);
    let round = 0;
    const versionAt = (scope, at) => LOOKS.includes(scope)
      ? t.events.filter(e => e.kind === 'appearance-answer' && e.data?.revise && ms(e.at, at) > 0).length
      : t.events.filter(e => e.kind === 'motion-answer' && e.data?.clip === scope && ms(e.at, at) > 0).length;
    const review = (scope, version) => {
      const r = mine.filter(x => x.scope === scope && versionAt(scope, x.createdAt) === version).at(-1);
      if (!r) return null;
      const statuses = Object.values(r.checks ?? {}), n = s => statuses.filter(v => v === s).length;
      return { status: r.status ?? null, defect: n('defect'), clear: n('clear'), unverified: n('unverified'), anyDefect: n('defect') > 0 };
    };
    const row = (scope, version, label) => rows.push({ job: t.job.id, kit: t.kit, engine: t.engine, scope, version, label, review: review(scope, version) });
    for (const e of t.events) {
      if (e.kind === 'appearance-answer') {
        if (e.data?.revise) { for (const look of LOOKS) row(look, round, 'rejected'); round += 1; }
        else if (['a', 'b'].includes(e.data?.choice)) for (const look of LOOKS) row(look, round, look === `look-${e.data.choice}` ? 'accepted' : 'not-chosen');
      }
      if (e.kind === 'motion-answer' && e.data?.clip) { row(e.data.clip, versions[e.data.clip] ?? 0, 'rejected'); count(versions, e.data.clip); }
      if (e.kind === 'register') for (const clip of t.job.previewClips ?? []) row(clip, versions[clip] ?? 0, 'accepted');
    }
  }
  return rows;
}

/**
 * Would a "no defect found" screen have agreed with the users? Only labeled clips whose review completed count. Weak labels: a user
 * sends a clip back for taste as well as for a defect, and accepts a clip with a small flaw; read it with docs/MEASUREMENT.md.
 */
export function screening(rows) {
  const scored = rows.filter(r => ['accepted', 'rejected'].includes(r.label) && r.review?.status === 'completed');
  const m = { rejectedFlagged: 0, rejectedMissed: 0, acceptedFlagged: 0, acceptedPassed: 0 };
  for (const r of scored) m[`${r.label}${r.review.anyDefect ? 'Flagged' : r.label === 'rejected' ? 'Missed' : 'Passed'}`] += 1;
  return { clips: scored.length, ...m, detectionRate: rate(m.rejectedFlagged, m.rejectedFlagged + m.rejectedMissed),
    falseBlockRate: rate(m.acceptedFlagged, m.acceptedFlagged + m.acceptedPassed), labels: 'user decisions, clip level; not independent question labels' };
}

export function report(db, ledger = null) {
  if (db?.kind !== 'oddbout-measure-db' || db.version !== 1) throw new Error('measure-export: expected the JSON of scripts/measure-export.sql');
  const all = db.jobs.map(job => timeline(job, db.events));
  const labels = clipLabels(all, db.reviews);
  const byKit = {};
  for (const t of all) (byKit[t.kit ?? 'unknown'] ??= []).push(t);
  return {
    kpis: { kind: 'oddbout-measure', version: 1, exportedAt: db.exportedAt, since: db.since, ledger: Boolean(ledger),
      ended: all.filter(t => ENDED.has(t.job.status)).length,
      all: kpis(all, { reviews: db.reviews, ledger }), screening: screening(labels),
      byKit: Object.fromEntries(Object.entries(byKit).map(([kit, list]) => [kit, kpis(list, { reviews: db.reviews, ledger })])) },
    labels,
  };
}

async function main(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dbFile = arg('--db'), ledgerFile = arg('--ledger'), outDir = arg('--out-dir');
  if (!dbFile || !outDir) { console.error('usage: measure-export.mjs --db db.json [--ledger ledger.json] --out-dir <dir>'); return 2; }
  const read = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  let db = await read(dbFile);
  if (Array.isArray(db) && db[0]?.export) db = db[0].export;   // the SQL editor's download: one row, one `export` column
  if (typeof db?.export === 'object') db = db.export;
  const { kpis: summary, labels } = report(db, ledgerFile ? await read(ledgerFile) : null);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'kpis.json'), JSON.stringify(summary, null, 2) + '\n');
  await writeFile(path.join(outDir, 'clip-labels.jsonl'), labels.map(row => JSON.stringify(row)).join('\n') + (labels.length ? '\n' : ''));
  const a = summary.all, pct = v => (v === null ? '—' : `${Math.round(v * 100)}%`);
  console.log(`jobs ${a.jobs} (ended ${summary.ended})  look first choice ${pct(a.appearanceFirstChoice.rate)} of ${a.appearanceFirstChoice.of}  ` +
    `motions first accept ${pct(a.motionFirstAccept.rate)} of ${a.motionFirstAccept.of}  failed/review ${pct(a.failureOrReviewRate.rate)}  ` +
    `stage reviews ${a.stageReviews.total} in ${a.stageReviews.jobs} job(s)  operator retries ${a.operatorRetries}  ` +
    `labels ${labels.length}  screened clips ${summary.screening.clips}`);
  console.log(`wrote ${path.join(outDir, 'kpis.json')} and clip-labels.jsonl`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}
