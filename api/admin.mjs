// @ts-check
import { Problem, UUID, jsonResponse, readBody, verifiedUserId } from './http.mjs';

const CORS = { methods: 'GET, POST, OPTIONS', headers: 'Authorization, Content-Type' };
const reply = (body, status = 200) => jsonResponse(body, status, CORS);
const statuses = { 'admin-required': 403, 'not-found': 404, 'review-conflict': 409, 'beta-capacity': 409,
  'invalid-query': 400, 'invalid-review': 400, 'validation-incomplete': 409, 'registration-open': 410 };
// A small JSON body with only the named keys.
async function smallBody(request, keys) {
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 1000))); }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw new Problem(400, 'invalid-review');
  return body;
}
export function createAdminHandler({ db }) {
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
      if (parts.length === 2 && parts[1] === 'fighters' && request.method === 'GET') {
        const query = new URL(request.url).searchParams, page = query.get('page') ?? '0', status = query.get('status') ?? 'active', search = (query.get('search') ?? '').trim();
        if (!/^(0|[1-9][0-9]{0,4})$/.test(page) || Number(page)>10000 || search.length>200 || search.includes('\0')
          || !['active','removed','all'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, ...await rpc('af_admin_fighters', { p_actor: actor, p_status: status, p_search: search, p_page: Number(page) }) });
      }
      if (parts.length === 4 && parts[1] === 'fighters' && parts[3] === 'moderation' && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action','version','reason'].includes(key))
          || !['remove','restore'].includes(body.action) || !Number.isSafeInteger(body.version) || body.version<0
          || typeof body.reason !== 'string') throw new Problem(400, 'invalid-review');
        const reason = body.reason.trim();
        if (!reason || reason.length>500 || reason.includes('\0') || !reason.isWellFormed()) throw new Problem(400, 'invalid-review');
        return reply({ ok: true, moderation: await rpc('af_moderate_fighter', { p_actor: actor, p_fighter: parts[2], p_version: body.version, p_action: body.action, p_reason: reason }) });
      }
      if (parts.length === 2 && parts[1] === 'access-requests' && request.method === 'GET') {
        const query = new URL(request.url).searchParams, page = query.get('page') ?? '0', status = query.get('status') ?? 'pending', search = (query.get('search') ?? '').trim();
        if (!/^(0|[1-9][0-9]{0,4})$/.test(page) || Number(page)>10000 || search.length>200 || search.includes('\0')
          || !['pending','approved','declined','all'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, ...await rpc('af_admin_requests', { p_actor: actor, p_status: status, p_search: search, p_page: Number(page) }) });
      }
      if (parts.length === 4 && parts[1] === 'access-requests' && parts[3] === 'review' && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['decision','version','reason'].includes(key))
          || !['approved','declined'].includes(body.decision) || typeof body.version !== 'string'
          || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(body.version) || !Number.isFinite(Date.parse(body.version))
          || (body.reason !== undefined && typeof body.reason !== 'string')) throw new Problem(400, 'invalid-review');
        const reason = (body.reason ?? '').trim();
        if (reason.length>500 || reason.includes('\0') || !reason.isWellFormed()) throw new Problem(400, 'invalid-review');
        return reply({ ok: true, review: await rpc('af_admin_review', { p_actor: actor, p_owner: parts[2], p_version: body.version, p_decision: body.decision, p_reason: reason }) });
      }
      // 생성 호스트와 확인을 기다리는 신청 (2026-10-28): approve or withdraw a host; run a stopped stage again or cancel a request.
      if (parts.length === 2 && parts[1] === 'generation-hosts' && request.method === 'GET')
        return reply({ ok: true, hosts: await rpc('af_admin_generation_hosts', { p_actor: actor }) });
      if (parts.length === 4 && parts[1] === 'generation-hosts' && parts[3] === 'approval' && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        const body = await smallBody(request, ['approved']);
        if (typeof body.approved !== 'boolean') throw new Problem(400, 'invalid-review');
        return reply({ ok: true, host: await rpc('af_admin_generation_host_approval', { p_actor: actor, p_host: parts[2], p_approved: body.approved }) });
      }
      if (parts.length === 2 && parts[1] === 'generations' && request.method === 'GET') {
        const status = new URL(request.url).searchParams.get('status') ?? 'needs_review';
        if (!['needs_review', 'open'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, jobs: await rpc('af_admin_generations', { p_actor: actor, p_status: status }) });
      }
      if (parts.length === 4 && parts[1] === 'generations' && ['retry', 'cancel'].includes(parts[3]) && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        return reply({ ok: true, job: await rpc(parts[3] === 'retry' ? 'af_admin_generation_retry' : 'af_admin_generation_cancel', { p_actor: actor, p_id: parts[2] }) });
      }
      return reply({ ok: false, code: 'not-found' }, 404);
    } catch (error) {
      return reply({ ok: false, code: error instanceof Problem ? error.message : 'admin-unavailable' }, error instanceof Problem ? error.status : 503);
    }
  };
}
