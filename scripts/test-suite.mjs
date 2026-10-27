// `npm run test:fast` runs every suite except the slow ones; `npm run test:heavy` runs only those; `npm test` runs all.
// Heavy: image packing (sharp encodes), real proxy/timeout paths, and the Python motion engines (need `npm run sprite:setup`).
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const HEAVY = ['pack', 'runtime-fetch', 'contact-evidence', 'gait-engine', 'gpt-motion'].map(name => `test/${name}.test.mjs`);
const root = fileURLToPath(new URL('../', import.meta.url));

const mode = process.argv[2];
if (!['fast', 'heavy'].includes(mode)) { console.error('Usage: node scripts/test-suite.mjs fast|heavy'); process.exit(2); }
const all = (await readdir(new URL('../test/', import.meta.url))).filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`).sort();
const missing = HEAVY.filter(file => !all.includes(file));
if (missing.length) { console.error(`Heavy suites not found (update scripts/test-suite.mjs): ${missing.join(', ')}`); process.exit(2); }
const files = mode === 'heavy' ? HEAVY : all.filter(file => !HEAVY.includes(file));
const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
child.on('close', code => { process.exitCode = code ?? 1; });
