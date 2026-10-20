import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const kitRoot = fileURLToPath(new URL('../', import.meta.url));
export const spriteRoot = path.join(kitRoot, 'vendor', 'sprite-gen');
export const spritePython = path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const exists = async file => { try { await access(file); return true; } catch { return false; } };

export async function spriteStatus() {
  const sourcePresent = await exists(path.join(spriteRoot, 'SKILL.md'));
  const metadata = sourcePresent ? await readFile(path.join(spriteRoot, 'pyproject.toml'), 'utf8').catch(() => '') : '';
  return {
    sourcePresent, version: metadata.match(/^version = "([^"]+)"/m)?.[1] ?? null,
    environmentPresent: await exists(spritePython), repositoryRoot: kitRoot, sourceRoot: spriteRoot,
    skillPath: path.join(spriteRoot, 'SKILL.md'), pythonPath: spritePython,
    setupCommand: 'npm run sprite:setup', runCommand: 'npm run sprite --', packCommand: 'npm run fighter:pack -- <plan.json>',
    authentication: 'Each creator uses their own generation account. Presence of a venv does not verify login, quota, or generation quality.',
  };
}

function run(command, args, { cwd = kitRoot, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false, windowsHide: true, timeout,
      env: { ...process.env, PYTHONUTF8: '1', SPRITE_GEN_ROOT: spriteRoot } });
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
    return run(spritePython, ['-m', 'sprite_gen.cli', '--help']);
  }
  if (!args.length) throw new Error('Pass a sprite-gen command, for example: npm run sprite -- workflow --kind sprite');
  if (!(await exists(spritePython))) throw new Error('Run npm run sprite:setup first. No fallback to a global sprite-gen installation.');
  // Use only the bundled source and its venv. Preserve upstream arguments and exit codes (2: questions, 75: choice needed).
  // Relative paths resolve from where the user ran npm, not from inside the submodule.
  return run(spritePython, ['-m', 'sprite_gen.cli', ...args], { cwd: process.env.INIT_CWD || process.cwd() });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.code === 'ENOENT' ? 'Required executable not found. Install Git and Python 3.11+, or set AI_FIGHTER_BOOTSTRAP_PYTHON to your Python executable.' : error.message); process.exitCode = 1; }
}
