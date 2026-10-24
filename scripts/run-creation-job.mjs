import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCreationStore } from '../mcp/creation-store.mjs';
import { runCreationJob } from '../mcp/creation-jobs.mjs';

export async function main(args) {
  if (args.length !== 2) throw new Error('Usage: npm run creation:run -- <session-id> <job-uuid>');
  const root = await realpath(process.env.AI_FIGHTER_ROOT || fileURLToPath(new URL('../', import.meta.url)));
  const result = await runCreationJob(createCreationStore(root), ...args);
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'succeeded' ? 0 : result.status === 'needs-input' ? 75 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
