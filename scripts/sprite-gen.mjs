import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureSpritePatch, inspectSpritePatch } from './sprite-patch.mjs';
import { inspectTools, inspectRife, installImg2webp, toolEnv, toolsItem } from './sprite-tools.mjs';

export const kitRoot = fileURLToPath(new URL('../', import.meta.url));
export const spriteRoot = path.join(kitRoot, 'vendor', 'sprite-gen');
export const spritePython = path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const exists = async file => { try { await access(file); return true; } catch { return false; } };

export async function spriteStatus({ tools = true } = {}) {
  const sourcePresent = await exists(path.join(spriteRoot, 'SKILL.md'));
  const metadata = sourcePresent ? await readFile(path.join(spriteRoot, 'pyproject.toml'), 'utf8').catch(() => '') : '';
  const motionPatch = sourcePresent ? await inspectSpritePatch(spriteRoot).then(state => ({ id: state.manifest.id, applied: state.applied }), error => ({ applied: false, error: error.message })) : { applied: false };
  return {
    sourcePresent, version: metadata.match(/^version = "([^"]+)"/m)?.[1] ?? null, motionPatch,
    environmentPresent: await exists(spritePython), repositoryRoot: kitRoot, sourceRoot: spriteRoot,
    skillPath: path.join(spriteRoot, 'SKILL.md'), pythonPath: spritePython,
    setupCommand: 'npm run sprite:setup', runCommand: 'npm run sprite --', packCommand: 'npm run fighter:pack -- <plan.json>',
    gaitCommand: 'npm run fighter:gait -- review <gait-plan.json> <review-directory> [annotations.json]',
    gaitGuidePath: path.join(kitRoot, 'docs', 'GAIT-REVIEW.md'),
    poseCommand: 'npm run sprite -- gen-motion --plan <pose-plan.json> --run-dir <new-run> --frame <pose-id>',
    poseGuidePath: path.join(spriteRoot, 'docs', 'pose-motion.md'),
    authentication: 'Each creator uses their own generation account. Presence of a venv does not verify login, quota, or generation quality.',
    // ffmpeg, ffprobe, img2webp (-exact) and RIFE as sprite-gen finds them; ready means the required three work.
    ...(tools ? { tools: toolsItem(await inspectTools({ spriteRoot, python: spritePython })) } : {}),
  };
}

function run(command, args, { cwd = kitRoot, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false, windowsHide: true, timeout,
      env: { ...toolEnv(spriteRoot), PYTHONUTF8: '1', SPRITE_GEN_ROOT: spriteRoot } });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}

export async function main(args) {
  if (args[0] === 'status') { console.log(JSON.stringify(await spriteStatus(), null, 2)); return 0; }
  if (args[0] === 'setup') {
    if (args.length !== 1) throw new Error('Usage: npm run sprite:setup');
    if (!(await exists(path.join(spriteRoot, 'SKILL.md')))) {
      // History is not needed to run the pinned commit; depth 1 skips the upstream history download.
      if (!(await exists(path.join(kitRoot, '.git')))) throw new Error('sprite-gen source missing and this folder is not a Git checkout. Clone AI Fighter with git; GitHub ZIP archives do not include submodules.');
      const result = await run('git', ['submodule', 'update', '--init', '--depth', '1', '--', 'vendor/sprite-gen']);
      if (result) return result;
    }
    if (!(await exists(path.join(spriteRoot, 'SKILL.md')))) throw new Error('sprite-gen source missing. Clone AI Fighter with --recurse-submodules. GitHub ZIP archives do not include submodules.');
    await ensureSpritePatch(spriteRoot);
    if (!(await exists(spritePython))) {
      // A global Python is used only to create this repository's isolated environment.
      const candidates = process.env.AI_FIGHTER_BOOTSTRAP_PYTHON ? [[process.env.AI_FIGHTER_BOOTSTRAP_PYTHON, []]]
        : process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
      let bootstrap;
      for (const [command, prefix] of candidates) {
        try {
          if (await run(command, [...prefix, '-c', 'import sys,venv; sys.exit(0 if sys.version_info >= (3,11) else 1)'], { timeout: 10000 }) === 0) {
            bootstrap = [command, prefix]; break;
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (!bootstrap) throw new Error('Python 3.11+ with venv support is required. Set AI_FIGHTER_BOOTSTRAP_PYTHON to its executable.');
      const created = await run(bootstrap[0], [...bootstrap[1], '-m', 'venv', path.join(spriteRoot, '.venv')]);
      if (created) return created;
    }
    const installed = await run(spritePython, ['-m', 'pip', 'install', '-e', spriteRoot]);
    if (installed) return installed;
    const help = await run(spritePython, ['-m', 'sprite_gen.cli', '--help']);
    if (help) return help;
    return setupTools();
  }
  if (!args.length) throw new Error('Pass a sprite-gen command, for example: npm run sprite -- workflow --kind sprite');
  if (!(await exists(spritePython))) throw new Error('Run npm run sprite:setup first. No fallback to a global sprite-gen installation.');
  await ensureSpritePatch(spriteRoot);
  await requireMotionContract(args, process.env.INIT_CWD || process.cwd());
  // Use only the bundled source and its venv. Preserve upstream arguments and exit codes (2: questions, 75: choice needed).
  // Relative paths resolve from where the user ran npm, not from inside the submodule.
  return run(spritePython, ['-m', 'sprite_gen.cli', ...args], { cwd: process.env.INIT_CWD || process.cwd() });
}

/**
 * After sprite-gen: the tools a run needs that the kit can fetch without sudo (img2webp with -exact, RIFE), then a report
 * of what the person preparing the workspace must still install. Exit 1 only when a kit download failed for a required tool.
 */
async function setupTools() {
  const options = { spriteRoot, python: spritePython };
  let tools = await inspectTools({ ...options, rife: false });
  let failed = 0;
  if (tools.img2webp.status !== 'ok' && tools.img2webp.install.actor === 'agent') {
    try { console.error(`img2webp: installed ${await installImg2webp(options)}`); }
    catch (error) { console.error(error.message); failed = 1; }
  }
  // RIFE: sprite-gen's own installer. A finished install is only checked again; a failed check frame (no Vulkan) is a warning.
  let rife = await inspectRife({ ...options, env: toolEnv(spriteRoot) });
  if (rife.status === 'missing') {
    if (await run(spritePython, ['-m', 'sprite_gen.cli', 'rife', 'install'])) console.error('rife: sprite-gen rife install did not finish; see the message above.');
    rife = await inspectRife({ ...options, env: toolEnv(spriteRoot) });
  }
  tools = { ...(await inspectTools({ ...options, rife: false })), rife };
  const item = toolsItem(tools);
  console.error('\nsprite-gen tools:');
  for (const name of ['ffmpeg', 'ffprobe', 'img2webp', 'rife']) {
    const tool = item[name];
    console.error(`  ${name.padEnd(9)} ${tool.status.padEnd(8)} ${tool.path ?? ''}${tool.version ? ` (${tool.version})` : ''}${tool.reason ? ` — ${tool.reason}` : ''}`);
  }
  for (const warning of item.warnings) console.error(`  warning: rife ${warning.status} — ${warning.message}. Next: ${warning.command}`);
  if (item.nextAction) console.error(`  action required (${item.nextAction.actor}): ${item.nextAction.commands.join('  |  ')}`);
  return failed;
}

export async function requireMotionContract(args, cwd) {
  if (!['gen-set', 'gen-motion'].includes(args[0])) return;
  const option = key => {
    const matches = args.flatMap((value, index) => value === key || value.startsWith(key + '=') ? [index] : []);
    if (matches.length > 1) throw Error(`Duplicate option: ${key}`);
    const index = matches[0] ?? -1;
    return index < 0 ? undefined : args[index].includes('=') ? args[index].slice(key.length + 1) : args[index + 1];
  };
  if (args[0] === 'gen-motion') {
    if (!option('--plan')) return; // the engine owns CLI errors/help
    const plan = JSON.parse(await readFile(path.resolve(cwd, option('--plan')), 'utf8'));
    const expected = plan.motion === 'walk' ? 16 : plan.motion === 'run' ? 12 : null;
    if (expected === null || plan.frames?.length !== expected)
      throw Error(`AI Fighter pose plan needs ${expected ?? '16 walk / 12 run'} frames; diagnostic poses belong to that full plan`);
    if (option('--frame') && !args.includes('--reconcile') && plan.version !== 2)
      throw Error('POSE_BODY_CALIBRATION_REQUIRED: v5 generation needs a version 2 plan with observed original body landmarks; legacy runs remain available for inspection/reconciliation/export, not repeated uncalibrated generation');
    return;
  }
  if (!option('--run-dir')) return; // the engine owns CLI errors
  const request = JSON.parse(await readFile(path.resolve(cwd, option('--run-dir'), 'sprite-request.json'), 'utf8'));
  const selected = option('--states')?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  for (const [state, entry] of Object.entries(request.states ?? {})) {
    if (selected.length && !selected.includes(state)) continue;
    const locomotion = state.match(/(^|[-_])(walk|walking|run|running)($|[-_])/);
    if (locomotion && !entry.motion)
      throw Error(`MOTION_CONTRACT_REQUIRED: ${state}; use fighter:gait init and review key poses before a full GPT sequence`);
    if (locomotion && entry.motion.kind !== (locomotion[2].startsWith('walk') ? 'walk' : 'run'))
      throw Error(`Motion kind does not match state: ${state}`);
    if (entry.motion?.stage === 'sequence' && entry.frames !== (entry.motion.kind === 'walk' ? 16 : 12))
      throw Error(`AI Fighter full sequence needs ${entry.motion.kind === 'walk' ? 16 : 12} frames: ${state}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.code === 'ENOENT' ? 'Required executable not found. Install Git and Python 3.11+, or set AI_FIGHTER_BOOTSTRAP_PYTHON to your Python executable.' : error.message); process.exitCode = 1; }
}
