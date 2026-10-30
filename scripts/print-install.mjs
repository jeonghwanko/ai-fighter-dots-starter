// @ts-check
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
// Print a reviewable command; never edit host settings automatically.
const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../mcp/stdio.mjs', import.meta.url));
/** @type {(value: string) => string} */
const quote = value => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
const config = process.env.AI_FIGHTER_CLIENT_CONFIG;
const clientEnv = config ? ` --env ${quote(`AI_FIGHTER_CLIENT_CONFIG=${config}`)}` : '';
console.log(`codex mcp add ai-fighter --env ${quote(`AI_FIGHTER_ROOT=${root}`)}${clientEnv} -- ${quote(realpathSync(process.execPath))} ${quote(script)}`);
