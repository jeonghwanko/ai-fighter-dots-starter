// Uses the same stdio tools exposed to Dot. No privileged key, registration bypass or self-approval.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = process.argv[2], config = process.env.AI_FIGHTER_CLIENT_CONFIG;
if (!manifestPath || !config) throw new Error('Provide a relative manifest path and AI_FIGHTER_CLIENT_CONFIG');
const output = path.join(root, 'output', path.basename(path.dirname(manifestPath)) + '-registration');
await mkdir(output, { recursive: true });
const statePath = path.join(output, 'request.json');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; state = { manifestPath, idempotencyKey: randomUUID() };
  await writeFile(statePath, JSON.stringify(state), { flag: 'wx' }); }
if (state.manifestPath !== manifestPath) throw new Error('Request path mismatch');
const mcp = new Client({ name: 'dot-fighter-registration', version: '0.2.0' });
const call = async (name, args) => {
  const response = await mcp.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  if (response.isError || !response.structuredContent?.ok) throw new Error(`MCP ${name}: ${JSON.stringify(response.structuredContent)}`);
  return response.structuredContent;
};
try {
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp/stdio.mjs')],
    env: { AI_FIGHTER_ROOT: root, AI_FIGHTER_CLIENT_CONFIG: path.resolve(config) }, stderr: 'inherit' }));
  await call('get_fighter_spec', { section: 'overview' });
  let submission = await call('submit_fighter_package', state);
  console.log(JSON.stringify({ submissionId: submission.submissionId, stage: submission.stage }));
  for (let n = 0; n < 60 && ['queued', 'validating'].includes(submission.stage); n++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    submission = await call('get_fighter_submission', { submissionId: submission.submissionId });
  }
  if (submission.stage !== 'registered') throw new Error(`Registration stage: ${submission.stage}`);
  const fighter = await call('get_registered_fighter', { fighterId: submission.fighterId });
  const retry = await call('submit_fighter_package', state);
  if (retry.fighterId !== submission.fighterId) throw new Error('Duplicate registration');
  const report = { testedAt: new Date().toISOString(), submissionId: submission.submissionId, fighterId: submission.fighterId,
    name: fighter.fighter.profile.name, manifestSha256: submission.manifestSha256, stage: submission.stage, duplicate: false };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await mcp.close(); }
