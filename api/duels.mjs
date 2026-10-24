import { Problem, UUID, jsonResponse, readBody, sha256 } from './http.mjs';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
const CORS = {methods:'GET, POST, OPTIONS',headers:'Content-Type'};
const reply = (body,status=200) => jsonResponse(body,status,CORS);
const present = row => ({id:row.id,a:row.a,b:row.b,hashes:[row.hash_a,row.hash_b],seed:row.seed,engine:row.engine,
  createdAt:row.created_at,completedAt:row.completed_at,result:row.result});
function check(error) {
  if (!error) return;
  const status = {'idempotency-conflict':409,'duel-not-approved':409,'duels-paused':503,'duel-budget':429,
    'invalid-duel':422,'not-found':404,'engine-mismatch':409,'result-conflict':409,'duels-failing':503,'invalid-result':503}[error.message];
  throw new Problem(status ?? 503,status ? error.message : 'duel-service-unavailable');
}
/** Guest-triggered, server-computed matches. No client result or seed is accepted. All DB access stays service-only. */
export function createDuelHandler({db,simulateDuel,engineVersion}) {
  const rpc = async (name,args) => { const {data,error}=await db.rpc(name,args); check(error); return data; };
  async function manifest(id,hash) {
    const {data:f,error:e}=await db.from('af_fighters').select('submission_id').eq('id',id).maybeSingle(); check(e);
    if (!f) throw new Problem(404,'not-found');
    const {data:s,error}=await db.from('af_submissions').select('manifest_text,manifest_sha').eq('id',f.submission_id).eq('status','registered').maybeSingle(); check(error);
    if (!s || s.manifest_sha!==hash || await sha256(new TextEncoder().encode(s.manifest_text))!==hash) throw new Problem(409,'package-mismatch');
    const parsed=parseFighterJson(s.manifest_text);
    if (!parsed.ok || !validateFighter(parsed.data).ok) throw new Problem(409,'package-invalid');
    return parsed.data;
  }
  /** The ranking rows with each fighter's per-language names (contract profile.names) where he has them. */
  async function rankings() {
    const rows=await rpc('af_duel_rankings',{});
    if (!rows.length) return rows;
    const {data,error}=await db.from('af_fighters').select('id,profile').in('id',rows.map(row=>row.id)); check(error);
    const names=new Map((data??[]).map(f=>[f.id,f.profile?.names]));
    return rows.map(row=>names.get(row.id)?{...row,names:names.get(row.id)}:row);
  }
  return async (request,parts) => {
    try {
      if (request.method==='OPTIONS') return reply({ok:true});
      if (request.method==='GET' && parts.join('/')==='rankings') return reply({ok:true,rankings:await rankings(),engine:engineVersion});
      if (request.method==='GET' && parts.length===2 && parts[0]==='duels' && UUID.test(parts[1])) {
        const {data,error}=await db.from('af_duels').select('*').eq('id',parts[1]).not('completed_at','is',null).maybeSingle(); check(error);
        if (!data) throw new Problem(404,'not-found'); return reply({ok:true,match:present(data)});
      }
      if (request.method!=='POST' || parts.join('/')!=='duels') throw new Problem(404,'not-found');
      if (typeof simulateDuel!=='function' || !engineVersion) throw new Problem(503,'duel-engine-unavailable');
      let body; try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBody(request,2048))); }
      catch(e) { if(e instanceof Problem) throw e; throw new Problem(422,'invalid-duel'); }
      if (!body || Object.keys(body).sort().join(',')!=='a,b,idempotencyKey' || ![body.a,body.b,body.idempotencyKey].every(x=>typeof x==='string' && UUID.test(x)) || body.a===body.b)
        throw new Problem(422,'invalid-duel');
      const row=await rpc('af_reserve_duel',{p_key:body.idempotencyKey,p_a:body.a,p_b:body.b,p_engine:engineVersion});
      if (row.result) return reply({ok:true,match:present(row)});
      if(row.engine!==engineVersion) throw new Problem(409,'engine-mismatch');
      // A run that cannot finish is recorded as failed: it leaves the match budget and counts toward the failure brake.
      const fail = code => db.rpc('af_fail_duel',{p_id:row.id,p_engine:engineVersion,p_code:code}).then(()=>{},()=>{});
      let result;
      try {
        const [ma,mb]=await Promise.all([manifest(row.a,row.hash_a),manifest(row.b,row.hash_b)]);
        result=await simulateDuel(row.a,ma,row.b,mb,row.seed);
      } catch(e) {
        await fail(e instanceof Problem ? e.message : 'engine-error');
        throw e instanceof Problem ? e : new Problem(503,'duel-engine-failed');
      }
      let completed;
      try { completed=await rpc('af_complete_duel',{p_id:row.id,p_engine:engineVersion,p_result:result}); }
      catch(e) { if (e instanceof Problem && ['invalid-result','duel-not-approved'].includes(e.message)) await fail(e.message); throw e; }
      return reply({ok:true,match:present(completed)});
    } catch(e) { return reply({ok:false,code:e instanceof Problem ? e.message:'duel-service-unavailable'},e instanceof Problem ? e.status:503); }
  };
}
