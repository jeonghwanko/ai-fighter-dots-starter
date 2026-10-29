// `npm run typecheck`: tsc over api/ with tsconfig.json (strict null checks), then again with noImplicitAny. Every api/ module
// meets the second run except the ones still listed below, so a new module starts typed. The list only shrinks: a listed module
// with nothing left to fix fails until it is taken off.
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const IMPLICIT_ANY_PENDING = [
  'decisions-benchmark.mjs', 'decisions-review.mjs', 'generations.mjs', 'handler.mjs', 'responses-benchmark.mjs', 'sequence-benchmark.mjs',
  'workshop.mjs',
];

const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = (...flags) => spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--pretty', 'false', ...flags],
  { cwd: root, encoding: 'utf8' });
/** Error lines by file (`api/x.mjs`), from tsc's plain output. */
function errorsByFile(output) {
  const out = new Map();
  for (const line of output.split('\n')) {
    const file = /^(api\/[^(]+)\(\d+,\d+\): error TS\d+/.exec(line)?.[1];
    if (file) out.set(file, [...(out.get(file) ?? []), line]);
  }
  return out;
}

export function typecheck() {
  const problems = [], base = tsc();
  if (base.status !== 0) problems.push(base.stdout + base.stderr);
  const modules = new Set((spawnSync('git', ['ls-files', 'api/*.mjs'], { cwd: root, encoding: 'utf8' }).stdout).split('\n').filter(Boolean));
  for (const name of IMPLICIT_ANY_PENDING) if (!modules.has(`api/${name}`)) problems.push(`IMPLICIT_ANY_PENDING names api/${name}, which does not exist`);
  const strict = errorsByFile(tsc('--noImplicitAny').stdout);
  for (const [file, lines] of strict) if (!IMPLICIT_ANY_PENDING.includes(file.slice(4))) problems.push(...lines);
  for (const name of IMPLICIT_ANY_PENDING) if (modules.has(`api/${name}`) && !strict.has(`api/${name}`))
    problems.push(`api/${name} has nothing left under noImplicitAny: take it off IMPLICIT_ANY_PENDING in scripts/typecheck.mjs`);
  return { problems, pending: IMPLICIT_ANY_PENDING.map(name => [name, strict.get(`api/${name}`)?.length ?? 0]) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { problems, pending } = typecheck();
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log(`typecheck: clean; noImplicitAny pending in ${pending.length} modules (${pending.reduce((a, [, n]) => a + n, 0)} errors)`);
}
