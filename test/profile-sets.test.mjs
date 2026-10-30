import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { createHandler, sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import { createAdminHandler } from '../api/admin.mjs';
import { PROFILE_SET_SPEC, PROFILE_SET_VALIDATOR_VERSION, PROFILE_SET_VERSION, parseProfileSet, profileSetKey, rosterProfileSet } from '../api/profile-sets.mjs';
import { checkProfileSet } from '../worker/profile-set-check.mjs';

const set = (front = {}, face = {}) => ({ version: PROFILE_SET_VERSION,
  front: { path: 'front.webp', bytes: 1000, sha256: 'a'.repeat(64), width: 1024, height: 1536, ...front }, face: { x: 402, y: 108, side: 220, ...face } });

test('the set file names one WebP front painting within the size limits and a face square inside it', () => {
  assert.equal(parseProfileSet(JSON.stringify(set())).ok, true);
  const codes = value => { const result = parseProfileSet(typeof value === 'string' ? value : JSON.stringify(value)); return result.ok ? [] : result.errors.map(e => e.code); };
  assert.deepEqual(codes('{'), ['INVALID_JSON']);
  assert.deepEqual(codes({ ...set(), extra: 1 }), ['PROFILE_SET_KEYS']);
  assert.deepEqual(codes({ ...set(), version: 'v0' }), ['PROFILE_SET_VERSION']);
  assert.deepEqual(codes(set({ path: '../front.webp' })), ['FRONT_PATH']);
  assert.deepEqual(codes(set({ bytes: 4000001 })), ['FRONT_BYTES']);
  assert.deepEqual(codes(set({ width: 900, height: 900 })), ['FRONT_DIMENSIONS']);
  assert.deepEqual(codes(set({ width: 2049 })), ['FRONT_DIMENSIONS']);
  assert.deepEqual(codes(set({ width: 511 }, { x: 0 })), ['FRONT_DIMENSIONS']);
  assert.deepEqual(codes(set({}, { x: 900, side: 200 })), ['FACE_OUTSIDE']);
  assert.deepEqual(codes(set({}, { side: 8 })), ['FACE_OUTSIDE']);
  // The spec carries the house colouring and its anchor (사용자 2026-10-31: 담백한 채색).
  assert.match(PROFILE_SET_SPEC.style.colouring, /flat clean cel colours with\none soft shadow tone/);
  assert.equal(PROFILE_SET_SPEC.style.anchor.url, 'https://oddbout.com/art/oddbout/style-anchor-front.webp');
});

/** A transparent 1024×1536 painting: a body and a head, optionally on a background (with one clear pixel, so it keeps its alpha channel). */
async function painting({ background = false } = {}) {
  const width = 1024, height = 1536, rgba = Buffer.alloc(width * height * 4);
  const paint = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rgba.set([200, 120, 90, 255], (y * width + x) * 4); };
  if (background) { paint(0, 0, width - 1, height - 1); rgba.set([0, 0, 0, 0], (700 * width + 900) * 4); }
  paint(412, 110, 612, 310); paint(362, 300, 662, 1450);
  return sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
}

test('the validator decodes the painting and makes a 600-px card and a 192-px face; a background or a misplaced face fails', async () => {
  const good = await checkProfileSet(await painting(), set());
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  const card = await sharp(good.card).metadata(), face = await sharp(good.face).metadata();
  assert.deepEqual([card.format, card.height, card.width, card.hasAlpha], ['webp', 600, good.derived.card.width, true]);
  assert.deepEqual([face.width, face.height], [192, 192]);
  // The figure (301 × 1341) scaled to 600 high; the face square follows it into the card's pixels.
  assert.equal(good.derived.card.width, Math.round(301 * 600 / 1341));
  assert.deepEqual(good.derived.card.face, { x: Math.round(40 * 600 / 1341), y: 0, side: Math.round(220 * 600 / 1341) });
  const codes = async (bytes, value) => { const result = await checkProfileSet(bytes, value); return result.ok ? [] : result.errors.map(e => e.code); };
  assert.deepEqual(await codes(await painting({ background: true }), set()), ['FRONT_BACKGROUND']);
  const opaque = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#c87850' } }).webp().toBuffer();
  assert.deepEqual(await codes(opaque, set()), ['FRONT_ENCODING'], 'no alpha channel');
  assert.deepEqual(await codes(await painting(), set({}, { x: 100 })), ['FACE_OUTSIDE_FIGURE']);
  assert.deepEqual(await codes(await painting(), set({}, { side: 100 })), ['FACE_SIZE']);
  assert.deepEqual(await codes(await painting(), set({}, { y: 700 })), ['FACE_POSITION']);
  assert.deepEqual(await codes(await painting(), set({ width: 1000 })), ['FRONT_DIMENSIONS']);
  assert.deepEqual(await codes(Buffer.from('not an image at all'), set()), ['FRONT_ENCODING']);
});

test('Postgres: upload → validation → review → approval names the set on the roster; a new approval supersedes; the entry gate', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(), admin = crypto.randomUUID(), other = crypto.randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)', [owner, 'o@example.com', admin, 'a@example.com', other, 'x@example.com']);
    await db.query('insert into public.af_creators(owner_id) values($1),($2)', [owner, other]);
    await db.query('insert into af_admins(owner_id) values($1)', [admin]);
    const value = result => result.rows[0].value;
    // A registered fighter, the way the package route makes one.
    const text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text)), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const submission = value(await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [owner, crypto.randomUUID(), text, sha, bytes]));
    for (const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, submission.id]);
    const leased = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [submission.id]));
    const fighter = value(await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value',
      [submission.id, leased.lease_token, sha, { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] }])).fighter_id;

    const create = async (key = crypto.randomUUID(), who = owner, file = set()) => {
      const body = JSON.stringify(file);
      return value(await db.query('select to_jsonb(public.af_profile_set_create($1,$2,$3,$4,$5,$6)) as value',
        [who, fighter, key, body, await sha256(new TextEncoder().encode(body)), file.front.bytes]));
    };
    await assert.rejects(create(crypto.randomUUID(), other), /fighter-not-found/);
    const key = crypto.randomUUID(), first = await create(key);
    assert.equal(first.status, 'uploading');
    assert.equal((await create(key)).id, first.id); // The same key and bytes answer the same set.
    await assert.rejects(create(key, owner, set({ bytes: 1001 })), /idempotency-conflict/);
    await assert.rejects(create(), /open-profile-set-exists/);
    await assert.rejects(db.query('select public.af_profile_set_submit($1,$2)', [owner, first.id]), /assets-incomplete/);
    await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', profileSetKey(owner, first.id, 'front'), { size: 1000 }]);
    assert.equal(value(await db.query('select to_jsonb(public.af_profile_set_submit($1,$2)) as value', [owner, first.id])).status, 'queued');

    const claim = async id => value(await db.query('select to_jsonb(public.af_profile_set_claim($1)) as value', [id]));
    const derived = { card: { sha256: 'c'.repeat(64), bytes: 300, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
      face: { sha256: 'f'.repeat(64), bytes: 200, size: 192 } };
    const finish = (row, passed = true, more = {}) => db.query('select to_jsonb(public.af_profile_set_finish($1,$2,$3,$4,$5,$6)) as value',
      [row.id, row.lease_token, row.manifest_sha, passed, { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [], ...more },
        passed ? derived : null]).then(value);
    const store = async row => {
      await db.query('insert into storage.objects values($1,$2,$3),($1,$4,$5)', ['ai-fighter-beta', profileSetKey(owner, row.id, 'card'), { size: 300 },
        profileSetKey(owner, row.id, 'face'), { size: 200 }]);
    };
    const validating = await claim(first.id);
    assert.equal(validating.status, 'validating');
    await assert.rejects(finish({ ...validating, lease_token: crypto.randomUUID() }), /stale-validation/);
    await assert.rejects(finish(validating), /validation-incomplete/, 'the derived files must be stored');
    await store(validating);
    await assert.rejects(finish(validating, true, { validatorVersion: 'v0' }), /validator-version/);
    assert.equal((await finish(validating)).status, 'review');
    assert.equal((await finish(validating)).status, 'review', 'a repeated finish answers the same');

    const roster = async () => (await db.query('select profile_set from public.af_roster_entries where id=$1', [fighter])).rows[0].profile_set;
    assert.equal(await roster(), null, 'review is not on the roster');
    const approve = id => db.query('select public.af_admin_profile_set_approve($1,$2) as value', [admin, id]).then(value);
    await assert.rejects(db.query('select public.af_admin_profile_set_approve($1,$2)', [owner, first.id]), /admin-required/);
    const list = (await db.query('select public.af_admin_profile_sets($1,$2) as value', [admin, 'review'])).rows[0].value;
    assert.deepEqual(list.map(item => [item.id, item.name, item.email]), [[first.id, example.profile.name, 'o@example.com']]);
    assert.equal(list[0].previewKey, `${owner}/${submission.id}/${example.clips.idle.assetId}.webp`);
    assert.equal((await approve(first.id)).status, 'approved');
    assert.deepEqual(await roster(), { id: first.id, derived });
    assert.equal((await approve(first.id)).status, 'approved', 'approving the current set again answers the same');

    const second = await create();
    await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', profileSetKey(owner, second.id, 'front'), { size: 1000 }]);
    await db.query('select public.af_profile_set_submit($1,$2)', [owner, second.id]);
    const secondLease = await claim(second.id);
    await store(secondLease);
    await finish(secondLease);
    await approve(second.id);
    const statuses = (await db.query('select id, status from public.af_profile_sets order by created_at')).rows.map(row => row.status);
    assert.deepEqual(statuses, ['superseded', 'approved']);
    assert.equal((await roster()).id, second.id);
    const rejected = (await db.query('select public.af_admin_profile_set_reject($1,$2,$3) as value', [admin, second.id, ' 화풍이 다르다 '])).rows[0].value;
    assert.deepEqual([rejected.status, rejected.previous], ['rejected', 'approved']);
    assert.equal(await roster(), null, 'rejecting the current set takes it off the roster');
    assert.equal((await db.query('select reason from public.af_profile_sets where id=$1', [second.id])).rows[0].reason, '화풍이 다르다');
    await assert.rejects(db.query('select public.af_admin_profile_set_reject($1,$2,$3)', [admin, first.id, 'x'.repeat(301)]), /invalid-review/);

    // A failed check is a verdict: rejected with the validator's errors.
    const third = await create();
    await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', profileSetKey(owner, third.id, 'front'), { size: 1000 }]);
    await db.query('select public.af_profile_set_submit($1,$2)', [owner, third.id]);
    assert.equal((await finish(await claim(third.id), false, { stage: 'profile-set-check', errors: [{ code: 'FRONT_BACKGROUND', path: '/front' }] })).status, 'rejected');

    // The entry gate is off by default; on, a fighter registered after the switch enters only with a validated set.
    const enter = () => db.query('select public.af_enter_fighter($1,$2,$3,$4) as value', [owner, fighter, sha, ['idle']]);
    await db.exec("update public.af_settings set profile_set_required_after = now() - interval '1 day'");
    await db.exec("update public.af_profile_sets set status = 'rejected' where status <> 'rejected'");
    await assert.rejects(enter(), /profile-set-required/);
    await db.query("update public.af_profile_sets set status = 'review' where id = $1", [third.id]);
    assert.equal(value(await enter()).stage, 'entered');

    // Owners read only their own sets.
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select id from public.af_profile_sets')).rows.length, 0);
    await assert.rejects(db.query('select public.af_profile_set_claim(null)'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('the roster names an approved set by this project\'s public bucket only', () => {
  const db = { storage: { from: bucket => ({ getPublicUrl: path => ({ data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/${bucket}/${path}` } }) }) } };
  const fighter = crypto.randomUUID(), id = crypto.randomUUID();
  const derived = { card: { sha256: 'c'.repeat(64), bytes: 300, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } }, face: { sha256: 'f'.repeat(64), bytes: 200, size: 192 } };
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: { id, derived } }), { profileSet: { id,
    card: { url: `https://ref.supabase.co/storage/v1/object/public/af-profile-sets/${fighter}/${'c'.repeat(64)}.webp`, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
    face: { url: `https://ref.supabase.co/storage/v1/object/public/af-profile-sets/${fighter}/${'f'.repeat(64)}.webp`, size: 192 } } });
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: null }), {});
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: { id, derived: { ...derived, card: { ...derived.card, sha256: '../x' } } } }), {});
  assert.deepEqual(rosterProfileSet({}, { id: fighter, profile_set: { id, derived } }), {});
});

test('the owner routes: a bad set file is 422 before the database; the spec names the profile set', async () => {
  const rpcs = [];
  const handle = createHandler({ db: { auth: { getClaims: async () => ({ data: { claims: { sub: crypto.randomUUID(), is_anonymous: false, role: 'authenticated' } }, error: null }) },
    rpc: async (name, args) => { rpcs.push(name); return { data: name === 'af_authorize' ? true : null, error: null }; } } });
  const post = body => handle(new Request(`https://test/ai-fighter/fighters/${crypto.randomUUID()}/profile-sets`, { method: 'POST',
    headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' }, body }));
  const bad = await post(JSON.stringify(set({ width: 100 })));
  assert.equal(bad.status, 422); assert.equal((await bad.json()).code, 'invalid-profile-set');
  assert.deepEqual(rpcs, ['af_authorize']);
  assert.equal((await handle(new Request(`https://test/ai-fighter/fighters/${crypto.randomUUID()}/profile-sets`, { method: 'OPTIONS' }))).headers.get('access-control-allow-methods'), 'GET, POST, PUT, OPTIONS');
  const spec = await (await handle(new Request('https://test/ai-fighter/spec'))).json();
  assert.equal(spec.data.registration.profileSet, 'v1'); assert.equal(spec.data.profileSet.version, PROFILE_SET_VERSION);
});

test('the operator\'s review list and approval: the shape admin.html reads, files copied to the public bucket before the roster names them', async () => {
  const actor = crypto.randomUUID(), owner = crypto.randomUUID(), fighter = crypto.randomUUID(), id = crypto.randomUUID();
  const card = Buffer.from('RIFF0000WEBPcard'), face = Buffer.from('RIFF0000WEBPface');
  const derived = { card: { sha256: await sha256(card), bytes: card.length, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
    face: { sha256: await sha256(face), bytes: face.length, size: 192 } };
  const objects = new Map([[`ai-fighter-beta/${profileSetKey(owner, id, 'card')}`, card], [`ai-fighter-beta/${profileSetKey(owner, id, 'face')}`, face]]);
  const calls = [];
  let status = 'review';
  const db = { auth: { getClaims: async () => ({ data: { claims: { sub: actor, is_anonymous: false, role: 'authenticated' } }, error: null }) },
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'af_admin_account') return { data: true, error: null };
      if (name === 'af_admin_profile_sets') return { data: [{ id, fighterId: fighter, ownerId: owner, name: 'Blue', email: 'o@example.com', status: 'review',
        manifest: set(), derived, previewKey: `${owner}/sub/idle.webp`, submittedAt: '2026-10-31T00:00:00Z', current: false, entered: true }], error: null };
      if (name === 'af_admin_profile_set') return { data: { id, fighterId: fighter, ownerId: owner, status, derived }, error: null };
      if (name === 'af_admin_profile_set_approve') { status = 'approved'; return { data: { id, fighterId: fighter, status, derived }, error: null }; }
      if (name === 'af_admin_profile_set_reject') return { data: { id, fighterId: fighter, status: 'rejected', previous: status, derived }, error: null };
      throw new Error(name);
    },
    storage: { from: bucket => ({
      createSignedUrls: async paths => ({ data: paths.map(path => ({ path, error: path.includes('idle') ? null : null, signedUrl: `https://ref.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` })) }),
      download: async path => { const bytes = objects.get(`${bucket}/${path}`); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: 'missing' } }; },
      upload: async (path, bytes) => { if (objects.has(`${bucket}/${path}`)) return { error: { message: 'exists' } }; objects.set(`${bucket}/${path}`, Buffer.from(bytes)); return { error: null }; },
      remove: async paths => { for (const path of paths) objects.delete(`${bucket}/${path}`); return { data: [], error: null }; } }) } };
  const handle = createAdminHandler({ db });
  const ask = (path, init = {}) => handle(new Request(`https://test/ai-fighter/${path}`, { ...init, headers: { authorization: 'Bearer signed-user-token-for-test', ...init.headers } }),
    path.split('?')[0].split('/'));
  const listed = await (await ask('admin/profile-sets')).json();
  assert.deepEqual(Object.keys(listed), ['ok', 'profileSets']);
  const item = listed.profileSets[0];
  assert.deepEqual({ ...item, front: { ...item.front, url: typeof item.front.url } }, { id, fighterId: fighter, fighterName: 'Blue', ownerEmail: 'o@example.com',
    status: 'review', submittedAt: '2026-10-31T00:00:00Z', front: { url: 'string', width: 1024, height: 1536 },
    card: { url: `https://ref.supabase.co/storage/v1/object/sign/ai-fighter-beta/${profileSetKey(owner, id, 'card')}?token=t`, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
    face: { url: `https://ref.supabase.co/storage/v1/object/sign/ai-fighter-beta/${profileSetKey(owner, id, 'face')}?token=t`, size: 192 },
    previewUrl: `https://ref.supabase.co/storage/v1/object/sign/ai-fighter-beta/${owner}/sub/idle.webp?token=t`,
    reason: null, current: false, entered: true, validatedAt: null, reviewedAt: null });
  assert.equal((await ask('admin/profile-sets?status=open')).status, 400);
  const approved = await ask(`admin/profile-sets/${id}/approve`, { method: 'POST' });
  assert.deepEqual(await approved.json(), { ok: true, status: 'approved' });
  assert.ok(objects.has(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`)); assert.ok(objects.has(`af-profile-sets/${fighter}/${derived.face.sha256}.webp`));
  assert.ok(calls.indexOf('af_admin_profile_set_approve') > calls.indexOf('af_admin_profile_set'));
  assert.equal((await ask(`admin/profile-sets/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: '' }) })).status, 400);
  const rejected = await ask(`admin/profile-sets/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: '화풍이 다르다' }) });
  assert.deepEqual(await rejected.json(), { ok: true, status: 'rejected' });
  assert.equal(objects.has(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`), false, 'a rejected current set leaves the public bucket');
  // A stored file that no longer matches the validator's hash is never published.
  status = 'review'; objects.set(`ai-fighter-beta/${profileSetKey(owner, id, 'card')}`, Buffer.from('RIFF0000WEBPchanged'));
  assert.equal((await ask(`admin/profile-sets/${id}/approve`, { method: 'POST' })).status, 409);
});
