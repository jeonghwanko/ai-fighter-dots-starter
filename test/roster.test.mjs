import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sha256 } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

test('only scoped, reviewed immutable packages are delivered to the browser; no owner or worker fields leak', async () => {
  const text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text));
  const approved = { id: crypto.randomUUID(), submission_id: crypto.randomUUID(), manifest_sha: sha, runtime_manifest_sha: sha,
    runtime_approved: true, runtime_scope: 'arena-player-v1', review_state: 'approved', listed: true, profile: example.profile };
  const pending = { ...approved, id: crypto.randomUUID(), runtime_approved: false };
  const changed = { ...approved, id: crypto.randomUUID(), runtime_manifest_sha: 'f'.repeat(64) };
  // An unlisted fighter is out of the list but still served at his own address.
  const unlisted = { ...approved, id: crypto.randomUUID(), listed: false };
  const row = { id: approved.submission_id, owner_id: crypto.randomUUID(), status: 'registered', manifest_sha: sha, manifest_text: text, manifest: example };
  let signCalls = 0;
  const query = source => {
    let selected = source;
    const q = { select: () => q, order: () => q, limit: n => { selected = selected.slice(0, n); return q; },
      eq: (key, value) => { selected = selected.filter(row => row[key] === value); return q; },
      maybeSingle: async () => ({ data: selected[0] ?? null }), then: done => Promise.resolve({ data: selected }).then(done) };
    return q;
  };
  const handle = createHandler({ db: { from: table => query(table === 'af_fighters' ? [approved, pending, changed, unlisted] : [row]),
    storage: { from: () => ({ createSignedUrls: async keys => { signCalls++;
      return { data: keys.map(key => ({ path: key, error: null, signedUrl: `https://example.supabase.co/storage/v1/object/sign/ai-fighter-beta/${key}?token=temporary` })) }; } }) } } });
  const get = id => handle(new Request(`https://test/ai-fighter/roster${id ? '/' + id : ''}`));
  const list = await get(); assert.equal(list.headers.get('access-control-allow-origin'), '*');
  const entries = (await list.json()).fighters;
  assert.deepEqual(entries.map(f => f.id), [approved.id]);
  assert.equal('submission_id' in entries[0], false);
  assert.equal((await get(pending.id)).status, 404);
  assert.equal((await get(changed.id)).status, 404);
  const pkg = await (await get(approved.id)).json();
  assert.equal(pkg.manifestText, text); assert.equal(pkg.runtimeApproved, true); assert.equal(pkg.files.length, example.assets.length);
  assert.equal(signCalls, 1); // One Storage round trip signs every asset.
  assert.equal((await (await get(unlisted.id)).json()).manifestText, text);
  assert.deepEqual(pkg.files.map(f => f.id), example.assets.map(a => a.id));
  assert.equal('owner_id' in pkg, false); assert.equal('lease_token' in pkg, false);
  assert.equal(pkg.duelApproved, false);
  approved.duel_approved = true; approved.duel_manifest_sha = 'f'.repeat(64);
  assert.equal((await (await get(approved.id)).json()).duelApproved, false);
  approved.duel_manifest_sha = sha;
  assert.equal((await (await get(approved.id)).json()).duelApproved, true);
  assert.equal((await (await get()).json()).fighters[0].duelApproved, true);
  approved.duel_approved = false;
  assert.equal((await (await get(approved.id)).json()).duelApproved, false);
});
