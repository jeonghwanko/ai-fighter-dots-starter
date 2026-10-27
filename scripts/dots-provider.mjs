import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readRecord, safePath, sha256 } from './dots-safety.mjs';

// A source inspection can establish incompatibility, never establish a working image bridge.
// Future adapters need an audited, official output contract. No caller-supplied supportsImages flag.
export async function inspectProvider(runtime, provider = 'codex') {
  if (!['codex', 'grok', 'none'].includes(provider)) throw Error('unsupported-provider-choice');
  if (provider === 'none') return { provider, status: 'not-selected', readyForGeneration: false };
  const relative = `vendor/sprite-gen/sprite_gen/gen/${provider}_provider.py`;
  let source;
  try { source = await readFile(await safePath(relative, { root: runtime }), 'utf8'); }
  catch { return { provider, status: 'unknown', reason: 'provider-source-unavailable', readyForGeneration: false }; }
  const protectedAccess = provider === 'codex' && /_rollout_files|_resolve_rollout|_collect_inline_results|rollout-.*jsonl|["']sessions["']/.test(source);
  return { provider, sourceSha256: sha256(source), status: protectedAccess ? 'blocked' : 'unknown',
    reason: protectedAccess ? 'protected-session-output-contract' : 'official-host-file-bridge-unverified', readyForGeneration: false,
    nextAction: 'Use a verified official host output adapter; never inspect, relocate or delete protected sessions.' };
}
export async function isDotsWorkspace(runtime, workspace, env = process.env) {
  if (env.AI_FIGHTER_EXECUTION_HOST === 'dots') return true;
  for (const [root, file] of [[runtime, '.dots-runtime.json'], [workspace, 'output/creation-environment/environment.json']]) {
    try { if ((await readRecord(await safePath(file, { root }))).host === 'dots') return true; }
    catch (e) { if (e.code !== 'ENOENT') throw Error('dots-host-record-invalid'); }
  }
  return false;
}
// Indirect calls (motion redraws, facing checks) may also invoke Codex. Until an adapter is audited,
// a Dots-managed generation command is blocked before workflow probes or child dispatch. Packing is unaffected.
const generation = new Set(['gen', 'gen-set', 'gen-motion', 'video', 'video-set', 'video-resume']);
export async function guardDotsExecution(runtime, workspace, args, env = process.env) {
  if (!generation.has(args[0]) || !await isDotsWorkspace(runtime, workspace, env)) return;
  const capability = await inspectProvider(runtime, 'codex');
  throw Error(capability.status === 'blocked' ? 'dots-protected-session-provider-blocked' : 'dots-generation-output-contract-unverified');
}
