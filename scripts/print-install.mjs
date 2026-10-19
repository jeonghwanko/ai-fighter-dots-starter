import { fileURLToPath } from 'node:url';
// Print a reviewable command; never edit host settings automatically.
const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../mcp/stdio.mjs', import.meta.url));
const quote = value => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
console.log(`codex mcp add ai-fighter --env ${quote(`AI_FIGHTER_ROOT=${root}`)} -- ${quote(process.execPath)} ${quote(script)}`);
