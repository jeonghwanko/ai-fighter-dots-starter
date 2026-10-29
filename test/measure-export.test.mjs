import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipLabels, kpis, ogJobId, report, screening, timeline } from '../scripts/measure-export.mjs';

const script = fileURLToPath(new URL('../scripts/measure-export.mjs', import.meta.url));
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const KIT = 'k'.repeat(40);
let id = 0;
const at = minute => new Date(Date.UTC(2026, 9, 29, 1, minute)).toISOString();
const ev = (jobId, minute, kind, data = {}) => ({ jobId, id: ++id, at: at(minute), kind, data });

// A: one look revision, then look b; walk sent back once; registered. B: failed in motions. C: cancelled while its looks waited.
const db = {
  kind: 'oddbout-measure-db', version: 1, exportedAt: at(59), since: at(0),
  jobs: [
    { id: A, status: 'submitted', createdAt: at(0), appearanceRevisions: 1, motionRevisions: 1, choice: 'b', errorCode: null, previewClips: ['idle', 'walk', 'run'] },
    { id: B, status: 'needs_review', createdAt: at(1), appearanceRevisions: 0, motionRevisions: 0, choice: 'a', errorCode: 'motions-walk-outcome-unknown', previewClips: [] },
    { id: C, status: 'cancelled', createdAt: at(2), appearanceRevisions: 0, motionRevisions: 0, choice: null, errorCode: null, previewClips: [] },
  ],
  events: [
    ev(A, 0, 'created'), ev(A, 0, 'claimed', { status: 'appearance' }), ev(A, 0, 'versions', { kit: KIT, engine: 'e'.repeat(40) }),
    ev(A, 2, 'finished', { outcome: 'ok', status: 'appearance_ready', calls: { 'sprite gen': [2, 0, 60] } }),
    ev(A, 5, 'appearance-answer', { choice: null, revise: true }),
    ev(A, 5, 'claimed', { status: 'appearance' }), ev(A, 7, 'finished', { outcome: 'ok', status: 'appearance_ready', calls: { 'sprite gen': [2, 1, 70] } }),
    ev(A, 9, 'appearance-answer', { choice: 'b', revise: false }),
    ev(A, 9, 'claimed', { status: 'motions' }), ev(A, 29, 'finished', { outcome: 'ok', status: 'motion_ready', calls: { 'sprite video-set': [2, 0, 600] } }),
    ev(A, 31, 'motion-answer', { clip: 'walk' }),
    ev(A, 31, 'claimed', { status: 'motions' }), ev(A, 41, 'finished', { outcome: 'ok', status: 'motion_ready' }),
    ev(A, 44, 'register'),
    ev(B, 1, 'created'), ev(B, 1, 'claimed', { status: 'appearance' }), ev(B, 3, 'finished', { outcome: 'ok', status: 'appearance_ready' }),
    ev(B, 4, 'appearance-answer', { choice: 'a', revise: false }),
    ev(B, 4, 'claimed', { status: 'motions' }), ev(B, 20, 'finished', { outcome: 'review', status: 'needs_review', code: 'motions-walk-outcome-unknown' }),
    ev(C, 2, 'created'), ev(C, 2, 'claimed', { status: 'appearance' }), ev(C, 4, 'finished', { outcome: 'ok', status: 'appearance_ready' }),
    ev(C, 30, 'cancelled'),
  ],
  reviews: [
    { jobId: A, scope: 'look-a', stage: 'pose', createdAt: at(2), status: 'completed', checks: { 'f000.anatomy': 'defect', 'f000.identity': 'clear' } },
    { jobId: A, scope: 'walk', stage: 'sequence', createdAt: at(29), status: 'completed', checks: { 'sequence.limb_tracking': 'defect' } },
    { jobId: A, scope: 'walk', stage: 'sequence', createdAt: at(41), status: 'completed', checks: { 'sequence.limb_tracking': 'clear' } },
    { jobId: A, scope: 'run', stage: 'sequence', createdAt: at(29), status: 'completed', checks: { 'sequence.limb_tracking': 'defect' } },
    { jobId: B, scope: 'design', stage: 'input', createdAt: at(1), status: 'unverified', checks: {} },
  ],
};
const ledger = { jobs: [{ job: ogJobId({ id: A, createdAt: at(0) }), providers: { codex: { runs: 5 }, grok: { runs: 4 } } }] };

test('the worker folder of a job is its UTC date and its id without dashes', () => {
  assert.equal(ogJobId({ id: A, createdAt: '2026-10-29T23:30:00+09:00' }), `20261029-gen-${A.replaceAll('-', '')}`);
});

test('the numbers read what users answered, how long stages and waits took, and what it ran', () => {
  const k = kpis(db.jobs.map(job => timeline(job, db.events)), { reviews: db.reviews, ledger });
  assert.equal(k.jobs, 3);
  assert.deepEqual(k.appearanceFirstChoice, { rate: 0.5, of: 2 });   // A revised first, B chose
  assert.deepEqual(k.motionFirstAccept, { rate: 0, of: 1 });         // A sent walk back before registering; B never reached its motions
  assert.deepEqual(k.clipRevisions, { walk: { n: 1, perJobAtMotions: 1 } });
  assert.equal(k.revisionsPerRegistered.mean, 2);
  assert.deepEqual(k.failureCodes, { 'motions-walk-outcome-unknown': 1 });
  assert.deepEqual(k.abandonRate, { rate: 1 / 3, of: 3 });
  assert.deepEqual([k.stageMinutes.appearance.n, k.stageMinutes.motions.n, k.stageMinutes.motions.p95], [4, 3, 20]);
  assert.deepEqual(k.claimsPerStage.motions.mean, 1.5);
  assert.equal(k.userWaitMinutes.n, 6);   // A: its looks twice and its motions twice, B: its looks, C: until it cancelled
  assert.equal(k.minutesToRegister.p50, 44);
  assert.deepEqual(k.calls, { 'sprite gen': { runs: 4, failed: 1, seconds: 130 }, 'sprite video-set': { runs: 2, failed: 0, seconds: 600 } });
  assert.deepEqual(k.providerRunsPerRegistered.codex, { n: 1, p50: 5, p95: 5, mean: 5 });
  assert.deepEqual(k.decisions.byScope, { 'look-a': 1, walk: 2, run: 1, design: 1 });
});

test('stops for an operator count even when the job ends well, with the operator retries and their waits', () => {
  // As the hosted jobs of 2026-10-28 went: D (delegated) stops twice at its walk and run gates, an operator retries it each time, and it
  // registers; E (delegated) stops at its run gate and is cancelled; F predates the `delegate` field and once meets a codex question.
  const D = '44444444-4444-4444-8444-444444444444', E = '55555555-5555-4555-8555-555555555555', F = '66666666-6666-4666-8666-666666666666';
  const jobs = [
    { id: D, status: 'submitted', createdAt: at(0), appearanceRevisions: 0, motionRevisions: 0, previewClips: ['walk'] },
    { id: E, status: 'cancelled', createdAt: at(0), appearanceRevisions: 0, motionRevisions: 0, errorCode: 'run-not-clean', previewClips: [] },
    { id: F, status: 'submitted', createdAt: at(0), appearanceRevisions: 0, motionRevisions: 0, previewClips: ['walk'] },
  ];
  const events = [
    ev(D, 0, 'created', { delegate: true }), ev(D, 0, 'claimed', { status: 'appearance' }), ev(D, 1, 'finished', { outcome: 'ok', status: 'motions', choice: 'b' }),
    ev(D, 1, 'claimed', { status: 'motions' }), ev(D, 10, 'finished', { outcome: 'review', status: 'needs_review', code: 'walk-not-clean' }),
    ev(D, 20, 'operator', { action: 'retry', to: 'motions' }),
    ev(D, 20, 'claimed', { status: 'motions' }), ev(D, 30, 'finished', { outcome: 'review', status: 'needs_review', code: 'run-not-clean' }),
    ev(D, 35, 'operator', { action: 'retry', to: 'motions' }),
    ev(D, 35, 'claimed', { status: 'motions' }), ev(D, 40, 'finished', { outcome: 'ok', status: 'motion_ready' }), ev(D, 42, 'register'),
    ev(E, 0, 'created', { delegate: true }), ev(E, 0, 'claimed', { status: 'motions' }),
    ev(E, 15, 'finished', { outcome: 'review', status: 'needs_review', code: 'run-not-clean' }), ev(E, 25, 'cancelled'),
    ev(F, 0, 'claimed', { status: 'motions' }), ev(F, 3, 'finished', { outcome: 'retry', status: 'motions', code: 'provider-asks' }),
    ev(F, 20, 'claimed', { status: 'motions' }), ev(F, 30, 'finished', { outcome: 'ok', status: 'motion_ready' }), ev(F, 31, 'register'),
  ];
  const k = kpis(jobs.map(job => timeline(job, events)));
  assert.deepEqual(k.failureOrReviewRate, { rate: 0, of: 3 }, 'the end state alone shows none of it');
  assert.deepEqual([k.stageReviews.total, k.stageReviews.jobs, k.stageReviews.jobRate], [3, 2, 2 / 3]);
  assert.deepEqual(k.stageReviews.byCode, { 'walk-not-clean': 1, 'run-not-clean': 2 });
  assert.deepEqual(k.stageReviews.byStage, { motions: 3 });
  assert.deepEqual(k.stageRetries, { total: 1, byCode: { 'provider-asks': 1 } });
  assert.equal(k.operatorRetries, 2);
  assert.deepEqual([k.operatorWaitMinutes.n, k.operatorWaitMinutes.mean], [2, 7.5]);   // 10 and 5 minutes
  assert.deepEqual(k.cancelledAfterReview, { n: 1, of: 2 });
  assert.deepEqual(k.delegated, { rate: 1, of: 2, workerPicks: 1 });   // F is unknown, not counted either way
});

test('clip labels follow each clip version, and a review is matched to the version it saw', () => {
  const rows = clipLabels(db.jobs.map(job => timeline(job, db.events)), db.reviews);
  const pick = (scope, version) => rows.find(r => r.scope === scope && r.version === version);
  assert.deepEqual([pick('look-a', 0).label, pick('look-b', 0).label, pick('look-a', 1).label, pick('look-b', 1).label],
    ['rejected', 'rejected', 'not-chosen', 'accepted']);
  assert.equal(pick('look-a', 0).review.anyDefect, true);
  assert.equal(pick('look-b', 1).review, null);
  assert.deepEqual([pick('walk', 0).label, pick('walk', 0).review.anyDefect], ['rejected', true]);
  assert.deepEqual([pick('walk', 1).label, pick('walk', 1).review.anyDefect], ['accepted', false]);
  assert.deepEqual([pick('run', 0).label, pick('run', 0).review.anyDefect, pick('idle', 0).label], ['accepted', true, 'accepted']);
  // B chose a look and never registered: its looks are labeled, its clips are not. C answered nothing.
  assert.deepEqual(rows.filter(r => r.job === B).map(r => [r.scope, r.label]), [['look-a', 'accepted'], ['look-b', 'not-chosen']]);
  assert.ok(rows.every(r => r.job !== C));
  assert.equal(rows.find(r => r.job === A).kit, KIT);

  const s = screening(rows);
  // Scored: look-a v0 rejected (flagged), walk v0 rejected (flagged), walk v1 accepted (passed), run v0 accepted (flagged).
  assert.deepEqual([s.clips, s.rejectedFlagged, s.rejectedMissed, s.acceptedFlagged, s.acceptedPassed], [4, 2, 0, 1, 1]);
  assert.deepEqual([s.detectionRate, s.falseBlockRate], [1, 0.5]);
});

test('the report groups the numbers by kit release and refuses another file', () => {
  const r = report(db, ledger);
  assert.deepEqual(Object.keys(r.kpis.byKit).sort(), ['unknown', KIT].sort());
  assert.equal(r.kpis.byKit[KIT].jobs, 1);
  assert.equal(r.kpis.ended, 3);
  assert.throws(() => report({ jobs: [] }), /measure-export\.sql/);
});

test('the command reads the SQL editor download and writes kpis.json and clip-labels.jsonl', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'measure-'));
  try {
    await writeFile(path.join(dir, 'db.json'), '﻿' + JSON.stringify([{ export: db }]));
    await writeFile(path.join(dir, 'ledger.json'), JSON.stringify(ledger));
    const out = execFileSync(process.execPath, [script, '--db', path.join(dir, 'db.json'), '--ledger', path.join(dir, 'ledger.json'), '--out-dir', path.join(dir, 'out')],
      { encoding: 'utf8' });
    assert.match(out, /jobs 3 \(ended 3\)/);
    const k = JSON.parse(await readFile(path.join(dir, 'out', 'kpis.json'), 'utf8'));
    assert.equal(k.kind, 'oddbout-measure');
    const lines = (await readFile(path.join(dir, 'out', 'clip-labels.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(lines.length >= 7);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
