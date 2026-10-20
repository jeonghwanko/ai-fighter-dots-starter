import { cp, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { hosting, git, verifyArtifact, waitForJson } from './hosting-lib.mjs';

const [output, option, ...extra] = process.argv.slice(2);
if (!output || extra.length || (option && option !== '--dry-run')) {
  throw new Error('Usage: node scripts/publish-creator-site.mjs <built-directory> [--dry-run]');
}
const source = resolve(output);
const release = await verifyArtifact(source);
if (option === '--dry-run') {
  console.log(JSON.stringify({ status: 'verified-only', branch: hosting.branch, ...release }));
} else {
  const parent = await realpath(tmpdir());
  const temporary = await mkdtemp(join(parent, 'ai-fighter-pages-'));
  const checkout = join(temporary, 'repository');
  const previousSsh = process.env.GIT_SSH_COMMAND;
  try {
    if (process.env.AI_FIGHTER_PAGES_DEPLOY_KEY) {
      const keyFile = join(temporary, 'deploy-key');
      const hostsFile = join(temporary, 'known_hosts');
      const response = await fetch('https://api.github.com/meta', { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('Cannot retrieve GitHub SSH host keys');
      const keys = (await response.json()).ssh_keys;
      if (!Array.isArray(keys) || !keys.some(key => key.startsWith('ssh-ed25519 '))) throw new Error('Missing GitHub SSH host keys');
      await writeFile(keyFile, process.env.AI_FIGHTER_PAGES_DEPLOY_KEY + '\n', { mode: 0o600 });
      await writeFile(hostsFile, keys.map(key => `github.com ${key}\n`).join(''));
      const quote = path => "'" + path.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
      process.env.GIT_SSH_COMMAND = `ssh -i ${quote(keyFile)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(hostsFile)}`;
      delete process.env.AI_FIGHTER_PAGES_DEPLOY_KEY;
    }
    // No checkout means old tracked assets are absent. add -A removes stale assets
    // from the new commit without deleting anything in an existing user checkout.
    git(parent, 'clone', '--depth=1', '--single-branch', '--no-checkout', '--branch', hosting.branch,
      'git@github.com:jeonghwanko/ai-fighter-dots-starter.git', checkout);
    for (const entry of await readdir(source)) await cp(join(source, entry), join(checkout, entry), { recursive: true, errorOnExist: true, force: false });
    git(checkout, 'config', 'user.name', 'AI Fighter deploy');
    git(checkout, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    git(checkout, 'config', 'core.autocrlf', 'false');
    git(checkout, 'add', '-A');
    git(checkout, 'commit', '-m', `Deploy AI Fighter ${release.sourceCommit.slice(0, 12)}`);
    // No force: concurrent deploys must fail instead of replacing newer work.
    git(checkout, 'push', 'origin', `HEAD:refs/heads/${hosting.branch}`);
    console.log(JSON.stringify({ status: 'pushed', commit: git(checkout, 'rev-parse', 'HEAD') }));
    const marker = new URL('deployment.json', hosting.siteUrl);
    marker.searchParams.set('build', release.buildId);
    await waitForJson(marker, body => body.buildId === release.buildId && body.digest === release.digest);
    for (const page of ['creator.html', 'fighter.html', 'league.html']) {
      const response = await fetch(new URL(page, hosting.siteUrl), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Published entry unavailable: ${page} (${response.status})`);
    }
    console.log(JSON.stringify({ status: 'live', siteUrl: hosting.siteUrl, buildId: release.buildId }));
  } finally {
    if (previousSsh === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = previousSsh;
    const target = await realpath(temporary);
    if (dirname(target) !== parent || !target.startsWith(join(parent, 'ai-fighter-pages-'))) throw new Error('Unsafe temporary directory');
    await rm(target, { recursive: true, force: true });
  }
}
