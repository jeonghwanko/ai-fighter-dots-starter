import { Problem, UUID, jsonResponse, readBody, verifiedUserId } from './http.mjs';

const CORS = { methods: 'GET, POST, OPTIONS', headers: 'Authorization, Content-Type' };
const reply = (body, status = 200) => jsonResponse(body, status, CORS);
const statuses = { 'admin-required': 403, 'not-found': 404, 'review-conflict': 409, 'beta-capacity': 409,
  'invalid-query': 400, 'invalid-review': 400 };
export function createAdminHandler({ db, reviewMailer = null }) {
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Problem(statuses[error.message] ?? 503, statuses[error.message] ? error.message : 'admin-unavailable');
    return data;
  }
  return async (request, parts) => {
    try {
      if (request.method === 'OPTIONS') return reply({ ok: true });
      const actor = await verifiedUserId(db, request);
      if (!actor) throw new Problem(401, 'authentication-required');
      if (await rpc('af_admin_account', { p_actor: actor }) !== true) throw new Problem(403, 'admin-required');
      if (parts.length === 2 && parts[1] === 'me' && request.method === 'GET') return reply({ ok: true, admin: true });
      if (parts.length === 2 && parts[1] === 'access-requests' && request.method === 'GET') {
        const query = new URL(request.url).searchParams, page = query.get('page') ?? '0', status = query.get('status') ?? 'pending', search = (query.get('search') ?? '').trim();
        if (!/^(0|[1-9][0-9]{0,4})$/.test(page) || Number(page)>10000 || search.length>200 || search.includes('\0')
          || !['pending','approved','declined','all'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, emailConfigured: reviewMailer?.configured === true, ...await rpc('af_admin_requests', { p_actor: actor, p_status: status, p_search: search, p_page: Number(page) }) });
      }
      if (parts.length === 4 && parts[1] === 'access-requests' && ['review','email'].includes(parts[3]) && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (parts[3] === 'email') {
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length!==1 || typeof body.version!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(body.version) || !Number.isFinite(Date.parse(body.version))) throw new Problem(400, 'invalid-review');
          if (!reviewMailer?.configured) return reply({ok:false,code:'mail-not-configured'},503);
          await rpc('af_admin_retry_mail',{p_actor:actor,p_owner:parts[2],p_version:body.version});
          let email={status:'pending'}; try { email=await reviewMailer.deliver({owner:parts[2],version:body.version}); } catch { /* Review and outbox persist independently of sending. */ }
          return reply({ok:true,email});
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['decision','version','reason'].includes(key))
          || !['approved','declined'].includes(body.decision) || typeof body.version !== 'string'
          || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(body.version) || !Number.isFinite(Date.parse(body.version))
          || (body.reason !== undefined && typeof body.reason !== 'string')) throw new Problem(400, 'invalid-review');
        const reason = (body.reason ?? '').trim();
        if (reason.length>500 || reason.includes('\0') || !reason.isWellFormed()) throw new Problem(400, 'invalid-review');
        const review = await rpc('af_admin_review', { p_actor: actor, p_owner: parts[2], p_version: body.version, p_decision: body.decision, p_reason: reason });
        let email={status:'not-configured'};
        try { if (reviewMailer) email=await reviewMailer.deliver({owner:parts[2],version:body.version}); } catch { email={status:'pending'}; }
        return reply({ok:true,review,email});
      }
      return reply({ ok: false, code: 'not-found' }, 404);
    } catch (error) {
      return reply({ ok: false, code: error instanceof Problem ? error.message : 'admin-unavailable' }, error instanceof Problem ? error.status : 503);
    }
  };
}
