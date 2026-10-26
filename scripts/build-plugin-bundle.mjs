import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localPath } from '../mcp/creation-store.mjs';
import { ensureSpritePatch, patchFile } from './sprite-patch.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const runtimeFiles = [
  'LICENSE', 'package-lock.json', 'api/client.mjs', 'api/connection-errors.mjs', 'api/runtime-fetch.mjs', 'server/ai-fighter-package.mjs',
  'deploy/creation-context-source.json', 'deploy/creator-site.json',
  'scripts/sprite-gen.mjs', 'scripts/pack-fighter.mjs', 'scripts/run-creation-job.mjs',
  'scripts/sprite-patch.mjs', 'scripts/sprite-tools.mjs', 'patches/sprite-gen-gpt-motion.json', 'patches/README.md',
  'scripts/login.mjs', 'scripts/gait.mjs', 'scripts/contact.mjs', 'scripts/creation-context.mjs',
  'scripts/check-creation-delivery.mjs', 'scripts/check-connection.mjs', 'docs/DELIVERY.md',
  'tools/ai-fighter/gait.mjs', 'tools/ai-fighter/contact_evidence.py', 'tools/ai-fighter/validate-package.mjs',
  'docs/DOT-CREATION.md', 'docs/AUTHORING.md', 'docs/CREATION-UX.md', 'docs/GAIT-REVIEW.md',
  'docs/FOOT-EVIDENCE.md', 'docs/LOCAL-PLUGIN.md', 'docs/GAME-CREATION-CONTEXT.md', 'docs/OPEN-REGISTRATION.md',
  'docs/EXECUTION-HOST.md', 'docs/CONNECTION-READINESS.md',
];
const runtimeScripts = ['start', 'login', 'logout', 'sprite:setup', 'sprite:status', 'sprite',
  'fighter:pack', 'fighter:gait', 'fighter:contact', 'validate', 'creation:context', 'creation:delivery', 'creation:check', 'creation:run'];

function run(command, args, { cwd = root, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    let stdout = '', stderr = '';
    if (capture) { child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); }
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(Error(`${path.basename(command)} exited ${code}: ${stderr.trim()}`)));
  });
}
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Distribution must not contain symlinks');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
    else throw Error('Distribution must contain only regular files');
  }
  return result.sort();
}
async function copy(relative, sourceRoot, targetRoot) {
  const source = await localPath(sourceRoot, relative);
  if (!(await lstat(source)).isFile()) throw Error(`Expected a regular source file: ${relative}`);
  const target = path.join(targetRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { errorOnExist: true, force: false });
}

export async function buildPluginBundle(destination) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('The first distribution targets Windows x64. Validate another platform before publishing it.');
  if (!destination.startsWith('output/')) throw Error('plugin-output-must-be-under-output');
  const out = await localPath(root, destination);
  if (await lstat(out).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; })) throw Error('plugin-output-exists');
  // Read the pinned tree; never include the checkout venv, credentials, caches or untracked outputs.
  const pinned = (await run('git', ['ls-tree', 'HEAD', 'vendor/sprite-gen'], { capture: true })).match(/^160000 commit ([a-f0-9]{40})\s/)[1];
  const vendor = path.join(root, 'vendor', 'sprite-gen');
  const patch = await ensureSpritePatch(vendor);
  const spriteGenPatch = { id: patch.manifest.id, sha256: sha(await readFile(patchFile)) };
  if ((await run('git', ['rev-parse', 'HEAD'], { cwd: vendor, capture: true })).trim() !== pinned || pinned !== patch.manifest.baseCommit)
    throw Error('Use the pinned sprite-gen commit with the reviewed AI Fighter patch before bundling.');
  const changes = (await run('git', ['diff', 'HEAD', '--name-only', '--no-ext-diff'], { cwd: vendor, capture: true })).trim().split('\n').filter(Boolean);
  if (changes.some(file => !patch.files.some(entry => entry.path === file.trim()))) throw Error('Unrelated sprite-gen edits cannot be bundled.');
  const vendorFiles = (await run('git', ['ls-files', '-z'], { cwd: vendor, capture: true })).split('\0').filter(Boolean);
  for (const entry of patch.files) if (!vendorFiles.includes(entry.path)) vendorFiles.push(entry.path);
  if (!vendorFiles.includes('LICENSE') || !vendorFiles.includes('NOTICE')) throw Error('Missing upstream license or notice');
  const plugin = path.join(out, 'plugins', 'ai-fighter');
  await mkdir(path.dirname(plugin), { recursive: true });
  await cp(path.join(root, 'plugins', 'ai-fighter'), plugin, { recursive: true, force: false, errorOnExist: true });
  const runtime = path.join(plugin, 'runtime'); await mkdir(runtime);
  for (const file of runtimeFiles) await copy(file, root, runtime);
  for (const directory of ['mcp', 'contracts/ai-fighter'])
    for (const file of await files(path.join(root, directory))) await copy(`${directory}/${file}`, root, runtime);
  for (const file of vendorFiles) await copy(file, vendor, path.join(runtime, 'vendor', 'sprite-gen'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  pkg.scripts = Object.fromEntries(runtimeScripts.map(key => [key, pkg.scripts[key]]));
  await writeFile(path.join(runtime, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', { flag: 'wx' });
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  // Fresh locked production dependencies, no install lifecycle hooks and no copied user npm config.
  await run(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: runtime });
  await run(process.execPath, ['--input-type=module', '-e', "import sharp from 'sharp'; await sharp({create:{width:1,height:1,channels:4,background:'#00000000'}}).webp().toBuffer();"], { cwd: runtime });
  const hashes = {};
  for (const file of await files(runtime)) hashes[file] = sha(await readFile(path.join(runtime, file)));
  await writeFile(path.join(plugin, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1,
    platform: process.platform, arch: process.arch, spriteGenCommit: pinned, spriteGenPatch, files: hashes }, null, 2) + '\n');
  await writeFile(path.join(plugin, 'mcp.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {
      'ai-fighter-creator': { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/launcher.mjs'], cwd: '${PLUGIN_ROOT}' },
    },
  }, null, 2) + '\n');
  const metadata = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
  const marketDir = path.join(out, '.agents', 'plugins'); await mkdir(marketDir, { recursive: true });
  await writeFile(path.join(marketDir, 'marketplace.json'), JSON.stringify({ name: 'ai-fighter-local',
    interface: { displayName: 'AI Fighter Creator' }, plugins: [{ name: metadata.name,
      source: { source: 'local', path: './plugins/ai-fighter' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }, null, 2) + '\n');
  const zip = path.join(out, `${metadata.name}-${metadata.version}-${process.platform}-${process.arch}.zip`);
  const python = process.env.AI_FIGHTER_BOOTSTRAP_PYTHON || 'python';
  await run(python, [path.join(root, 'scripts', 'zip-plugin.py'), plugin, zip]);
  const report = { version: metadata.version, platform: `${process.platform}-${process.arch}`, plugin, marketplace: out,
    zip, sha256: sha(await readFile(zip)), runtimeFiles: Object.keys(hashes).length, spriteGenCommit: pinned, spriteGenPatch,
    listingURLs: Object.fromEntries(['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']
      .map(key => [key, metadata.extensions['com.openai'].interface[key]])),
    publicSubmissionReady: false, pending: ['OpenAI local MCP organization allowlisting', 'Verified developer identity',
      'Reviewer access and executed review cases', 'Reviewer-accessible demo video'],
    credentials: 'Only allowlisted source and clean npm production packages are bundled; no home, session, venv or output directories.',
    runtime: 'Node.js 22.12+ must be available. The Python sprite runtime is set up explicitly on each user computer.' };
  await writeFile(path.join(out, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw Error('Usage: npm run plugin:bundle -- [output/new-distribution]');
    console.log(JSON.stringify(await buildPluginBundle(process.argv[2] || 'output/ai-fighter-portable'), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
