import { jsonResponse } from './http.mjs';

/** Private Cron wake. A publishable key or a creator/admin bearer token is insufficient. */
export function createInternalMailHandler({db,reviewMailer}) {
  return async request => {
    if (request.method!=='POST') return jsonResponse({ok:false,code:'not-found'},404);
    const stamp=request.headers.get('x-ai-fighter-time')??'',signature=request.headers.get('x-ai-fighter-signature')??'';
    if (!/^\d{10}$/.test(stamp) || !/^[a-f0-9]{64}$/.test(signature)) return jsonResponse({ok:false,code:'wake-required'},403);
    try {
      const checked=await db.rpc('af_mail_verify_wake',{p_time:Number(stamp),p_signature:signature});
      if (checked.error || checked.data!==true) return jsonResponse({ok:false,code:'wake-required'},403);
      if (!reviewMailer?.configured) return jsonResponse({ok:false,code:'mail-not-configured'},503);
      return jsonResponse({ok:true,...await reviewMailer.drain()});
    } catch { return jsonResponse({ok:false,code:'mail-unavailable'},503); }
  };
}
