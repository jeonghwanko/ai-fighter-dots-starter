// Operator-only integration-test setup. Never run in the Dot MCP process.
// createUser with email_confirm does not send an email. No existing user is modified.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { sha256 } from '../api/handler.mjs';
import { validProjectUrl } from '../api/client.mjs';

const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY, publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!validProjectUrl(url) || !secret || !publishableKey || !process.env.AI_FIGHTER_PRIVATE_DIR) throw new Error('Provide operator credentials and AI_FIGHTER_PRIVATE_DIR through the environment');
const directory = path.resolve(process.env.AI_FIGHTER_PRIVATE_DIR);
await mkdir(directory, { recursive: false, mode: 0o700 });
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const ids = [];
for (const label of ['client', 'other']) {
  const email = `ai-fighter-${label}-${randomBytes(6).toString('hex')}@example.invalid`, password = randomBytes(32).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { ai_fighter_test: true } });
  if (created.error || !created.data.user) throw new Error('test-account-creation-failed');
  const id = created.data.user.id; ids.push(id);
  const { error } = await admin.from('af_creators').insert({ owner_id: id });
  if (error) throw new Error('test-invite-failed');
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error('test-sign-in-failed');
  await writeFile(path.join(directory, `${label}.json`), JSON.stringify({ url, publishableKey, accessToken: signed.data.session.access_token, refreshToken: signed.data.session.refresh_token }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
const workerToken = `afw_${randomBytes(32).toString('hex')}`, hash = await sha256(new TextEncoder().encode(workerToken));
const { error } = await admin.from('af_workers').insert({ token_hash: hash, label: 'local-beta-validator' });
if (error) throw new Error('worker-provision-failed');
await writeFile(path.join(directory, 'worker.json'), JSON.stringify({ url, workerToken }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await writeFile(path.join(directory, 'identifiers.json'), JSON.stringify({ creatorIds: ids, workerTokenHash: hash }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ok: true, testAccounts: ids.length, privateDirectory: directory }));
