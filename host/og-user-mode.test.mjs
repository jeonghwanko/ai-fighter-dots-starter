import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostEnv, installFiles } from '../scripts/host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// A community host's install (커뮤니티 호스트 H2, 2026-10-28): og in <root>/bin beside host.env runs as the caller, no sudo. Fake codex,
// grok, systemctl and systemd-run stand in for the providers and systemd; everything else is the real og.
async function hostInstall() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'og-user-')), root = path.join(base, 'root'), fakes = path.join(base, 'fakes'), units = path.join(base, 'units');
  await mkdir(root, { mode: 0o700 }); await mkdir(fakes);
  await installFiles(root, here);
  await writeFile(path.join(root, 'host.env'), hostEnv({ nodeBin: path.dirname(process.execPath), slots: 2, memory: '4G' }));
  const providers = path.join(root, 'tools', 'node_modules', '.bin');
  await mkdir(providers, { recursive: true });
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'Host@Example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', chatgpt_account_id: 'acct-123456' } })).toString('base64url')}.y`;
  const script = (file, body) => writeFile(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  // Each provider notes the HOME it ran with: the install's root, never the host's own home.
  await script(path.join(providers, 'codex'), `echo "$HOME" > "${base}/codex-home"
case "$1" in
  login) mkdir -p "$HOME/.codex"; printf '{"tokens":{"id_token":"${idToken}"}}' > "$HOME/.codex/auth.json" ;;
  logout) rm -f "$HOME/.codex/auth.json" ;;
  --version) echo "codex-cli 0.157.1" ;;
  *) echo ok ;;
esac`);
  await script(path.join(providers, 'grok'), `case "$1" in
  login) mkdir -p "$HOME/.grok"; printf '{"https://auth.x.ai::u1":{"email":"host@example.com","user_id":"u1","expires_at":"2099-01-01T00:00:00Z"}}' > "$HOME/.grok/auth.json" ;;
  logout) rm -f "$HOME/.grok/auth.json" ;;
  *) echo ok ;;
esac`);
  await script(path.join(fakes, 'systemctl'), `echo "$*" >> "${base}/systemctl.log"`);
  await script(path.join(fakes, 'systemd-run'), `echo "$*" >> "${base}/systemd-run.log"; while [ "$1" != "--" ]; do shift; done; shift; exec "$@"`);
  await script(path.join(fakes, 'sudo'), `echo "sudo $*" >> "${base}/sudo.log"; exit 1`);
  const og = (args, input) => spawnSync(path.join(root, 'bin', 'og'), args, { input, encoding: 'utf8',
    env: { ...process.env, PATH: `${fakes}:${process.env.PATH}`, OG_UNIT_DIR: units, OG_SVC_USER: '', OG_ROOT: '' } });
  return { base, root, units, og };
}

test('a host install runs og as its own account: providers signed in inside the root, the ledger marks the host, no sudo', async () => {
  const { base, root, units, og } = await hostInstall();
  try {
    assert.match(og(['status']).stdout, new RegExp(`root +${root} \\(user ${os.userInfo().username}, user install\\)`));
    // The official host's manual flow is not a host's.
    for (const args of [['new', 'red-cat', '1', 'a@b.c'], ['deliver', 'x'], ['close', 'x', 'y'], ['self-update']]) {
      const r = og(args, 'a request');
      assert.notEqual(r.status, 0); assert.match(r.stderr, /official host|npm run host -- update/);
    }
    // Signing in pins the host's own account; health calls both through the install's HOME.
    assert.equal(og(['login', 'codex']).status, 0);
    const pinned = og(['login', 'grok']);
    assert.equal(pinned.status, 0); assert.match(pinned.stdout, /this host's own subscription/);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'accounts.json'), 'utf8')), { codex: 'host@example.com', grok: 'host@example.com', personal: {} });
    const health = og(['health']);
    assert.match(health.stdout, /^og: codex ok \(host@example\.com\)$/m); assert.match(health.stdout, /^og: grok ok \(host@example\.com\)$/m);
    assert.equal((await readFile(path.join(base, 'codex-home'), 'utf8')).trim(), root);

    // A worker job's run: under the memory slice, codex slots inside the root, the ledger's account `host`.
    const job = '20261028-gen-0123abcd', dir = path.join(root, 'kit', 'output', job);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'request.json'), '{}');
    const run = og(['run', job, '--', 'codex', 'exec', 'hello']);
    assert.equal(run.status, 0, run.stderr);
    assert.match(await readFile(path.join(base, 'systemd-run.log'), 'utf8'), /--slice=oddbout-host\.slice/);
    assert.ok(existsSync(path.join(root, 'slots', 'slot0')));
    const end = (await readFile(path.join(root, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1);
    assert.deepEqual([end.kind, end.phase, end.provider, end.account, end.exit], ['run', 'end', 'codex', 'host', 0]);

    // The worker: its key on stdin (mode 600), codex locked first, a user unit in the host's own systemd.
    assert.notEqual(og(['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter'], 'not-a-key').status, 0);
    assert.equal(og(['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter'], `afw_${'c'.repeat(64)}\n`).status, 0);
    assert.equal(statSync(path.join(root, 'worker.env')).mode & 0o777, 0o600);
    assert.equal(og(['harden']).status, 0);
    assert.match(await readFile(path.join(root, '.codex', 'config.toml'), 'utf8'), /^shell_tool = false$/m);
    assert.equal(og(['worker', 'install']).status, 0);
    const unit = await readFile(path.join(units, 'oddbout-host-worker.service'), 'utf8');
    assert.match(unit, new RegExp(`^ExecStart=${root}/bin/og worker run$`, 'm')); assert.match(unit, /^Slice=oddbout-host\.slice$/m);
    assert.match(await readFile(path.join(base, 'systemctl.log'), 'utf8'), /--user enable --now oddbout-host-worker\.service/);
    assert.equal(og(['worker', 'uninstall']).status, 0);
    assert.ok(!existsSync(path.join(units, 'oddbout-host-worker.service')));
    assert.ok(!existsSync(path.join(base, 'sudo.log')));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('og prune clears closed jobs past the keep days and worker jobs the API ended without telling (idle 14 days)', async () => {
  const { base, root, og } = await hostInstall();
  try {
    const output = path.join(root, 'kit', 'output'), daysAgo = d => new Date(Date.now() - d * 86_400_000);
    const job = async (name, age, closed) => {
      const dir = path.join(output, name);
      await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'request.json'), '{}');
      if (closed) await writeFile(path.join(dir, '.closed'), '');
      for (const file of await readdir(dir)) await utimes(path.join(dir, file), daysAgo(age), daysAgo(age));
      await utimes(dir, daysAgo(age), daysAgo(age));
    };
    await job('20261001-gen-aaaa', 10, true);    // closed 10 days ago: past 7
    await job('20261020-gen-bbbb', 3, true);     // closed 3 days ago: kept
    await job('20261002-gen-cccc', 20, false);   // never closed, untouched 20 days: the API cancelled or expired it
    await job('20261018-gen-dddd', 9, false);    // waiting for its creator (up to 7 days) and a little more: kept
    const pruned = og(['prune', '7']);
    assert.equal(pruned.status, 0, pruned.stderr);
    assert.deepEqual((await readdir(output)).sort(), ['20261018-gen-dddd', '20261020-gen-bbbb']);
  } finally { await rm(base, { recursive: true, force: true }); }
});
