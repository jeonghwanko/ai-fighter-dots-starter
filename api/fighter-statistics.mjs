const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
} });

/** Read access depends on verified ownership, not an active submission invitation or leaderboard membership. */
export function createFighterStatisticsHandler({ db }) {
  return async (request, parts) => {
    try {
      if (parts.length !== 3 || parts[0] !== 'fighters' || parts[2] !== 'statistics' || !UUID.test(parts[1]))
        return reply({ ok: false, code: 'not-found' }, 404);
      if (request.method === 'OPTIONS') return reply({ ok: true });
      if (request.method !== 'GET') return reply({ ok: false, code: 'method-not-allowed' }, 405);
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]{16,4096})$/)?.[1];
      if (!token) return reply({ ok: false, code: 'authentication-required' }, 401);
      const { data, error } = await db.auth.getUser(token);
      if (error || !data?.user || data.user.is_anonymous || !UUID.test(data.user.id))
        return reply({ ok: false, code: 'authentication-required' }, 401);
      const { data: rows, error: queryError } = await db.rpc('af_owned_fighter_statistics', {
        p_owner: data.user.id, p_fighter: parts[1],
      });
      if (queryError) return reply({ ok: false, code: queryError.code === 'PGRST202' ? 'statistics-not-ready' : 'statistics-unavailable' }, 503);
      if (!Array.isArray(rows)) return reply({ ok: false, code: 'statistics-unavailable' }, 503);
      if (!rows.length) return reply({ ok: false, code: 'not-found' }, 404);
      if (rows.length !== 1 || rows[0].id !== parts[1].toLowerCase()) return reply({ ok: false, code: 'statistics-unavailable' }, 503);
      return reply({ ok: true, statistics: rows[0] });
    } catch { return reply({ ok: false, code: 'statistics-unavailable' }, 503); }
  };
}
