import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/handler.mjs';

const rows = Array.from({ length: 25 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  created_at: new Date(Date.UTC(2026, 9, i + 1)).toISOString(), manifest_sha: 'a'.repeat(64), runtime_manifest_sha: 'a'.repeat(64),
  runtime_approved: true, runtime_scope: 'arena-player-v1', review_state: 'approved', profile: { name: `Fighter ${i}` } }));
function handler(source) {
  return createHandler({ db: { from() {
    let data = [...source], order = [];
    const q = { select: () => q, eq: (key, value) => { data = data.filter(row => row[key] === value); return q; },
      order: (key, { ascending = true } = {}) => { order.push([key, ascending]); return q; },
      range: (start, end) => { data.sort((a, b) => { for (const [key, asc] of order) { const cmp = a[key].localeCompare(b[key]); if (cmp) return asc ? cmp : -cmp; } return 0; }); data = data.slice(start, end + 1); return q; },
      limit: n => q.range(0, n - 1), then: done => Promise.resolve({ data }).then(done) };
    return q;
  } } });
}
test('public roster exposes new fighters first and includes fighters beyond 20 without leaking private fields', async () => {
  const handle = handler(rows), get = page => handle(new Request(`https://test/ai-fighter/roster${page === undefined ? '' : '?page=' + page}`));
  const first = await (await get()).json(), second = await (await get(1)).json();
  assert.equal(first.hasMore, true); assert.equal(first.fighters.length, 20);
  assert.equal(second.hasMore, false); assert.equal(second.fighters.length, 5);
  assert.equal(first.fighters[0].name, 'Fighter 24');
  assert.equal(new Set([...first.fighters, ...second.fighters].map(row => row.id)).size, 25);
  assert.equal('created_at' in first.fighters[0], false);
  for (const page of ['-1', '1.5', 'garbage', '100000']) assert.equal((await get(page)).status, 400);
});
test('removed, pending and hash-mismatched packages are never displayed', async () => {
  const handle = handler([{ ...rows[0], review_state: 'removed' }, { ...rows[1], runtime_approved: false },
    { ...rows[2], runtime_manifest_sha: 'b'.repeat(64) }, rows[3]]);
  const body = await (await handle(new Request('https://test/ai-fighter/roster'))).json();
  assert.deepEqual(body.fighters.map(row => row.id), [rows[3].id]);
});
