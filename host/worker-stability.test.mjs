import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASKS, GROK_LIMITED, createStages } from './generation-stages.mjs';
import { STAGE_LIMIT_MS, healthAfter, STAGE_STOPPED, TIMING, errorCode, stageLimitMs, timedOutOutcome, unlessStopped } from './generation-worker.mjs';

const brief = { profile: { name: 'Blue' }, look: { subject: 'A blue cat boxer', palette: ['blue'], prop: 'gloves', avoid: 'none' },
  motion: { temper: 'bold', attack: 'jab' } };
const job = { id: 'j', brief, refs: [], candidates: [], appearanceRound: 0, appearanceNote: null };
const report = (ok, errors = []) => JSON.stringify({ ok, provider_submitted: true, errors });
const asked = { state: null, code: 'provider-asks', retryable: false, message: 'codex cannot run here' };

/** A fake og for looks: `plan[name]` is the exit code, or `{ code, errors }` for a failure with a report. A 0 makes the look. */
function looksOg(plan, made) {
  return async args => {
    const out = args[args.indexOf('--out') + 1], file = args[args.indexOf('--report') + 1], name = path.basename(out, '.png');
    made.push(name);
    const step = typeof plan[name] === 'object' ? plan[name] : { code: plan[name] ?? 0, errors: [] };
    if (step.code === 0) { await writeFile(out, 'png'); await writeFile(file, report(true)); }
    else if (step.errors.length) await writeFile(file, report(false, step.errors));
    return { code: step.code };
  };
}

test('a look this round already made is kept when the stage runs again for the other one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-keep-')), made = [];
  try {
    const plan = { 'look-a-0': 0, 'look-b-0': { code: 1, errors: [{ state: null, code: 'provider-rate-limited', retryable: true, message: '429' }] } };
    const stages = createStages({ og: looksOg(plan, made), api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async (png, webp) => writeFile(webp, 'webp') });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'retry', result: { code: 'look-exit-1' } });
    plan['look-b-0'] = 0; made.length = 0;
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'ok', result: { candidates: ['look-a-0', 'look-b-0'] } });
    assert.deepEqual(made, ['look-b-0'], 'look a was paid for once');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('codex that cannot run here now is a stage to run again, not an operator task', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-asks-')), made = [];
  try {
    const plan = { 'look-a-0': 75, 'look-b-0': 0, 'look-a-1': { code: 1, errors: [asked] }, 'look-b-1': 0 };
    const stages = createStages({ og: looksOg(plan, made), api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async (png, webp) => writeFile(webp, 'webp') });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'retry', result: { code: ASKS } });
    // The same question read from a report (exit 1): a retry too.
    assert.deepEqual(await stages.appearance({ ...job, appearanceRound: 1 }, dir), { outcome: 'retry', result: { code: ASKS } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Decisions screening runs beside the looks, and the stage returns only once it is done', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-screen-')), order = [];
  try {
    let release; const held = new Promise(resolve => { release = resolve; });
    const og = async args => {
      const out = args[args.indexOf('--out') + 1];
      order.push(`gen ${path.basename(out, '.png')}`);
      if (order.filter(o => o.startsWith('gen')).length === 2) release();   // the design review answers only once both looks are under way
      await writeFile(out, 'png'); await writeFile(args[args.indexOf('--report') + 1], report(true));
      return { code: 0 };
    };
    const api = {
      artifact: async () => ({ ok: true }),
      decisions: async (_, evidence) => {
        order.push(`review ${evidence.scope}`);
        if (evidence.scope === 'design') await held;
        order.push(`reviewed ${evidence.scope}`);
        return { ok: true, review: { status: 'completed', checks: {}, advisory: true, visualApproval: false } };
      },
    };
    const stages = createStages({ og, api, fetchBytes: async () => new Uint8Array(), toWebp: async (png, webp) => writeFile(webp, 'webp') });
    const result = await stages.appearance({ ...job, decisionsReview: { mode: 'shadow' } }, dir);
    assert.equal(result.outcome, 'ok');
    assert.ok(order.indexOf('gen look-a-0') < order.indexOf('reviewed design'), order.join(', '));
    assert.deepEqual(order.filter(o => o.startsWith('reviewed')).sort(), ['reviewed design', 'reviewed look-a', 'reviewed look-b']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('each stage has a time limit, and a codex question is checked again within the hour', () => {
  assert.deepEqual(Object.keys(STAGE_LIMIT_MS).sort(), ['appearance', 'motions', 'queued', 'submitting']);
  assert.equal(stageLimitMs('motions'), 150 * 60_000);
  assert.equal(stageLimitMs('something-new'), 150 * 60_000);
  assert.ok(TIMING.askedRecheckMs < TIMING.healthMs);
});

test('a stopped stage starts no run: its next og or motions.py call ends the stage instead', async () => {
  const controller = new AbortController();
  let started = 0;
  const start = async () => { started += 1; return { code: 0 }; };
  assert.deepEqual(await unlessStopped(controller.signal, start), { code: 0 });
  controller.abort();
  await assert.rejects(unlessStopped(controller.signal, start), error => error.code === STAGE_STOPPED);
  assert.equal(started, 1);
  // The stage turns it into its own end; the worker then reports the timeout or drops the cancelled job.
  const stages = createStages({ og: args => unlessStopped(controller.signal, start), api: { artifact: async () => ({ ok: true }) },
    fetchBytes: async () => new Uint8Array(), toWebp: async () => {}, signal: controller.signal });
  const dir = await mkdtemp(path.join(tmpdir(), 'look-stopped-'));
  try {
    await assert.rejects(stages.appearance(job, dir), error => error.code === STAGE_STOPPED);
    assert.equal(started, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an error code the finish takes is a short string, whatever the error carried', () => {
  assert.equal(errorCode({ code: 137 }), '137');
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 'artifact-refused' })), 'artifact-refused');
  assert.equal(errorCode(new Error('no code')), 'stage-error');
  assert.equal(errorCode(null), 'stage-error');
  assert.equal(errorCode({ code: 'x'.repeat(80) }).length, 60);
});

test('a look whose outcome is unknown goes to an operator even when the other look asked the codex question', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-unknown-')), made = [];
  try {
    const timeout = { state: null, code: 'provider-timeout', retryable: false, message: 'no answer in time' };
    const plan = { 'look-a-0': 75, 'look-b-0': { code: 1, errors: [timeout] } };
    const stages = createStages({ og: looksOg(plan, made), api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async () => {} });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'review', result: { code: 'look-outcome-unknown' } });
    // The other way round, and with a look that may be retried: still the operator's.
    Object.assign(plan, { 'look-a-0': { code: 1, errors: [{ ...timeout, code: 'provider-rate-limited', retryable: true }] }, 'look-b-0': { code: 1, errors: [timeout] } });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'review', result: { code: 'look-outcome-unknown' } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a stage past its limit goes to an operator with the xAI requests it named, to resume rather than film again', () => {
  assert.deepEqual(timedOutOutcome('motions', { outcome: 'review', result: { code: 'video-unfinished', requestIds: ['req-1'] } }),
    { outcome: 'review', result: { code: 'motions-stage-timeout', requestIds: ['req-1'] } });
  assert.deepEqual(timedOutOutcome('appearance', undefined), { outcome: 'review', result: { code: 'appearance-stage-timeout' } });
  assert.deepEqual(timedOutOutcome('motions', { outcome: 'retry', result: { code: 'stage-stopped' } }),
    { outcome: 'review', result: { code: 'motions-stage-timeout' } });
});

test('a look gen said it made but whose picture is not there goes to an operator, never sent again', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-no-output-')), made = [];
  try {
    const og = async args => { made.push(args); await writeFile(args[args.indexOf('--report') + 1], report(true)); return { code: 0 }; };
    const stages = createStages({ og, api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async () => {} });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'review', result: { code: 'look-no-output' } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a provider that cannot run here now is marked down, the other keeps its health, and any other outcome changes nothing', () => {
  const up = { ok: true, codex: true, grok: true, at: 't' };
  assert.deepEqual(healthAfter(up, ASKS), { ok: false, codex: false, grok: true, at: 't' });
  assert.deepEqual(healthAfter(up, GROK_LIMITED), { ok: false, codex: true, grok: false, at: 't' });
  assert.equal(healthAfter(up, 'video-exit-1'), up);
  assert.equal(healthAfter(up, undefined), up);
});
