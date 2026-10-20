import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../api/admin.mjs';

test('a send failure never rolls back the decision; retry requires a verified administrator and never takes a recipient from the caller',async()=>{
  const actor=crypto.randomUUID(),owner=crypto.randomUUID(),calls=[];
  let sends=0;
  const mailer={configured:true,deliver:async({owner:recipientOwner,version})=>{
    sends++;assert.equal(recipientOwner,owner);assert.equal(version,'2026-10-21T00:00:00.123456Z');throw new Error('provider unavailable');
  }};
  const db={auth:{getUser:async token=>({data:{user:{id:token==='fixture-admin-token'?actor:owner}}})},rpc:async(name,args)=>{
    calls.push({name,args});
    if (name==='af_admin_account') return {data:args.p_actor===actor};
    if (name==='af_admin_review') return {data:{status:'approved',replayed:false}};
    if (name==='af_admin_retry_mail') return {data:true};
    throw new Error('unexpected');
  }};
  const handle=createAdminHandler({db,reviewMailer:mailer});
  const call=(action,body,token='fixture-admin-token')=>handle(new Request('https://example.com/ai-fighter/admin/access-requests/'+owner+'/'+action,
    {method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(body)}),['admin','access-requests',owner,action]);
  const review={decision:'approved',version:'2026-10-21T00:00:00.123456Z',reason:'private note'};
  const response=await call('review',review);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,review:{status:'approved',replayed:false},email:{status:'pending'}});
  assert.equal(calls.find(x=>x.name==='af_admin_review').args.p_actor,actor);
  assert.equal((await call('email',{version:review.version},'fixture-person-token')).status,403);assert.equal(sends,1);
  assert.equal((await call('email',{version:review.version,to:'attacker@example.com'})).status,400);assert.equal(sends,1);
  assert.equal((await call('email',{version:review.version})).status,200);assert.equal(sends,2);
  assert.equal((await call('review',{...review,to:'attacker@example.com'})).status,400);
});
