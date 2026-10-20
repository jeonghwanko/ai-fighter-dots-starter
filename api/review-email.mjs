import { PUBLIC_CREATOR_PAGE } from '../mcp/creator-handoff.mjs';

const creator = new URL(PUBLIC_CREATOR_PAGE); creator.searchParams.set('lang','en');
const apply = new URL(creator); apply.searchParams.set('apply','founding-league');
const escape = text => String(text).replace(/[&<>"']/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));
const date = value => new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');

/** Version 1 is immutable: pending retries must keep the exact provider payload. */
export function reviewEmail(job) {
  if (job.templateVersion!==1 || !['approved','declined'].includes(job.decision)) throw new Error('invalid-email-template');
  const approved=job.decision==='approved';
  const subject=approved ? "You're approved — start building your AI Fighter" : 'Update on your AI Fighter application';
  const steps=[
    'Open your creator page and sign in with the same Google account you used to apply.',
    'Open Dot or Codex with the AI Fighter tools. Ask your agent: "Create an original AI Fighter, follow the current fighter spec, validate the assets, and submit it to my creator account." Use your own image-generation account and original assets.',
    'Return to your creator page to check submission status and preview your fighter once it has passed review.',
  ];
  const intro=approved ? `Your AI Fighter creator application has been approved. Your submission access is active until ${date(job.expiresAt)}.`
    : `Thank you for applying to the AI Fighter Founding League. We are unable to approve your current application. You can apply again from ${date(new Date(Date.parse(job.eventAt)+7*86400000))}, with more detail about your original fighter idea and the tools you plan to use.`;
  const ending=approved ? "Once you submit, we'll review your fighter for league play. We'll share league timing separately."
    : 'We appreciate the time you put into applying and hope to see your next idea.';
  const url=approved ? creator.href : apply.href, cta=approved ? 'Open your creator page' : 'View your application';
  return {from:job.sender,to:[job.recipient],subject,
    text:`Hi there,\n\n${intro}\n\n${approved ? 'What to do next\n'+steps.map((s,i)=>`${i+1}. ${s}`).join('\n')+'\n\n' : ''}${cta}: ${url}\n\n${ending}\n\nThe AI Fighter team`,
    html:`<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;background:#f9f8f3;font-family:Arial,sans-serif;color:#242424"><main style="max-width:600px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e5e3dd;border-radius:12px"><p style="font-size:12px;letter-spacing:2px">AI FIGHTER / FOUNDING LEAGUE</p><h1 style="font-size:28px">${approved ? 'Your next fighter starts here.' : 'An update on your application'}</h1><p>Hi there,</p><p style="line-height:1.7">${escape(intro)}</p>${approved ? '<h2 style="font-size:20px">What to do next</h2><ol style="padding-left:24px;line-height:1.7">'+steps.map(s=>`<li style="margin-bottom:12px">${escape(s)}</li>`).join('')+'</ol>' : ''}<p style="margin:28px 0"><a href="${escape(url)}" style="display:inline-block;padding:14px 20px;background:#e9c66a;border-radius:6px;color:#242424;font-weight:bold;text-decoration:none">${cta}</a></p><p style="line-height:1.7">${escape(ending)}</p><p>The AI Fighter team</p><p style="font-size:12px;word-break:break-all">If the button does not work, open ${escape(url)}</p></main></body></html>`};
}

/** No SDK, no browser secret, one provider idempotency key for each persisted review. */
export function createReviewMailer({db,apiKey='',sender='',fetch:sendFetch=fetch}) {
  const configured=/^re_[A-Za-z0-9_-]+$/.test(apiKey) && sender.length<=200 && !/[\r\n]/.test(sender) && /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/.test(sender);
  async function deliver({owner=null,version=null}={}) {
    if (!configured) return {status:'not-configured'};
    const claimed=await db.rpc('af_mail_claim',{p_sender:sender,p_owner:owner,p_version:version});
    if (claimed.error) return {status:'pending'};
    const job=claimed.data; if (!job) return {status:'unchanged'};
    let id=null,error='provider-unavailable';
    try {
      const payload=reviewEmail(job);
      const response=await sendFetch('https://api.resend.com/emails',{method:'POST',redirect:'error',credentials:'omit',
        headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json','idempotency-key':`af-review/${job.deliveryKey}`},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
      if (response.ok) {
        const body=await response.json(); if (typeof body?.id==='string' && body.id.length>0 && body.id.length<=200) {id=body.id;error=null;}
      } else if ([400,409,422].includes(response.status)) error='provider-rejected';
      // Do not persist or expose raw provider bodies: they can contain addresses or credentials.
    } catch { /* Durable queue retries an uncertain timeout with the same idempotency key. */ }
    const saved=await db.rpc('af_mail_finish',{p_review:job.reviewId,p_lease:job.lease,p_provider_id:id,p_error:error});
    return {status:saved.error || saved.data!==true ? 'pending' : id ? 'sent' : error==='provider-rejected' ? 'attention' : 'failed'};
  }
  return {configured,deliver,async drain() {
    if (!configured) return {configured:false,processed:0};
    let processed=0;
    for (;processed<5;processed++) {const result=await deliver(); if (['unchanged','pending'].includes(result.status)) break;}
    return {configured:true,processed};
  }};
}
