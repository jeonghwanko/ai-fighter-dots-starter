// @ts-check
import { readFile } from 'node:fs/promises';
import { fetchCreationContext, reviewCreationProgress } from '../mcp/creation-context.mjs';
const [statePath] = process.argv.slice(2);
const context = await fetchCreationContext();
const result = statePath ? reviewCreationProgress(context, JSON.parse(await readFile(statePath, 'utf8'))) : context;
console.log(JSON.stringify(result, null, 2));
if (statePath && !/** @type {ReturnType<typeof reviewCreationProgress>} */ (result).canAdvance) process.exitCode = 1;
