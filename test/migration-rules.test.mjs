import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const directory = new URL('../supabase/migrations/', import.meta.url);
const migrations = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
// Applied before this rule (2026-10-27). They stay as written; production already ran them.
const STRING_PATCHED = ['20261024022222_ai_fighter_profile_edits.sql', '20261024104406_ai_fighter_owner_deletion.sql'];

test('a migration restates a changed function instead of string-patching its live definition', async () => {
  // replace() over pg_get_functiondef hides the resulting body: reading it needs every earlier migration replayed
  // (a review misread af_create_submission's budget this way). Write the whole `create or replace function`.
  const offenders = [];
  for (const name of migrations.filter(name => !STRING_PATCHED.includes(name)))
    if (/pg_get_functiondef/i.test(await readFile(new URL(name, directory), 'utf8'))) offenders.push(name);
  assert.deepEqual(offenders, []);
});

test('every migration has its own version', () => {
  // `supabase db push` and `db reset` key the history on this version; 20261021090000 was once used twice.
  const versions = migrations.map(name => name.slice(0, 14));
  assert.deepEqual([...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))], []);
  assert.ok(migrations.every(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)), 'name: <14-digit version>_<snake_case>.sql');
});
