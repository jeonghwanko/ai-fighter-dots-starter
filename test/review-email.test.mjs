import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createReviewMailer,reviewEmail} from '../api/review-email.mjs';
import {createInternalMailHandler} from '../api/internal-mail.mjs';

test('durable review mail: atomic enqueue, private payloads, leased claims, retries and expiry',async()=>{
  const sql=new PGlite();
  try {
    await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      grant usage on schema auth to authenticated,service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
      grant usage on schema storage to service_role; grant select on storage.objects to service_role;`);
    const dir=new URL('../supabase/migrations/',import.meta.url);
    for (const name of (await readdir(dir)).filter(x=>x.endsWith('.sql')&&!x.includes('dispatch')).sort()) await sql.exec(await readFile(new URL(name,dir),'utf8'));
    const admin=crypto.randomUUID(),approved=crypto.randomUUID(),declined=crypto.randomUUID();
    for (const [i,id] of [admin,approved,declined].entries()) await sql.query('insert into auth.users(id,email) values($1,$2)',[id,`maker${i}@example.com`]);
    await sql.query('insert into af_admins(owner_id) values($1)',[admin]);
    const versions={};
    for (const owner of [approved,declined]) {
      await sql.query('insert into af_access_requests(owner_id,note) values($1,$2)',[owner,'PRIVATE applicant content']);
      versions[owner]=(await sql.query('select updated_at::text as version from af_access_requests where owner_id=$1',[owner])).rows[0].version;
    }
    await sql.exec('set role authenticated');
    await assert.rejects(sql.query('select * from af_review_emails'),/permission denied/);
    await assert.rejects(sql.query('select af_mail_claim($1)',['Team <team@example.com>']),/permission denied/);
    await sql.exec('reset role; set role service_role');
    const review=async(owner,decision)=>sql.query('select af_admin_review($1,$2,$3,$4,$5)',[admin,owner,versions[owner],decision,'PRIVATE internal review note']);
    await review(approved,'approved'); await review(approved,'approved'); await review(declined,'declined');
    assert.equal((await sql.query('select count(*)::int as n from af_review_emails')).rows[0].n,2);
    const keys={af_mail_claim:['p_sender','p_owner','p_version'],af_mail_finish:['p_review','p_lease','p_provider_id','p_error']};
    const db={rpc:async(name,args)=>{
      try {const list=keys[name];return {data:(await sql.query(`select ${name}(${list.map((_,i)=>`$${i+1}`).join(',')}) as result`,list.map(k=>args[k]))).rows[0].result};}
      catch(error){return {error:{message:error.message}};}
    }};
    const disabled=createReviewMailer({db});
    assert.equal((await disabled.deliver()).status,'not-configured');
    assert.equal((await sql.query('select max(attempts) as n from af_review_emails')).rows[0].n,0);
    const requests=[];
    const fetch=async(url,options)=>{requests.push({url,...options}); return new Response(JSON.stringify({id:'fixture-provider-id'}),{status:200});};
    const mailer=createReviewMailer({db,apiKey:'re_fixture',sender:'AI Fighter <team@example.com>',fetch});
    const results=await Promise.all([mailer.deliver({owner:approved,version:versions[approved]}),mailer.deliver({owner:approved,version:versions[approved]})]);
    assert.equal(results.filter(x=>x.status==='sent').length,1);assert.equal(requests.length,1);
    const payload=JSON.parse(requests[0].body);
    assert.deepEqual(payload.to,['maker1@example.com']);assert.ok(payload.subject.includes('approved'));
    assert.ok(payload.text.includes('https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html?lang=en'));
    assert.ok(payload.text.includes('What to do next'));assert.ok(payload.text.includes('same Google account'));
    assert.equal(requests[0].body.includes('PRIVATE'),false);assert.equal(requests[0].body.includes('refresh_token'),false);
    assert.equal((await mailer.deliver({owner:approved,version:versions[approved]})).status,'unchanged');
    let rejectedPayload;
    const failures=[];
    const unavailable=createReviewMailer({db,apiKey:'re_fixture',sender:'AI Fighter <team@example.com>',fetch:async(url,options)=>{
      rejectedPayload=JSON.parse(options.body);failures.push(options);return new Response('private provider response',{status:503});
    }});
    assert.equal((await unavailable.deliver({owner:declined,version:versions[declined]})).status,'failed');
    assert.ok(rejectedPayload.text.includes('You can apply again from'));assert.equal(JSON.stringify(rejectedPayload).includes('PRIVATE'),false);
    let row=(await sql.query("select * from af_review_emails where decision='declined'")).rows[0];
    assert.equal(row.last_error,'provider-unavailable');assert.equal(row.status,'failed');assert.equal(row.provider_id,null);
    await sql.exec("update af_review_emails set next_attempt_at=now() where decision='declined'");
    const retryRequests=[];
    const retry=createReviewMailer({db,apiKey:'re_fixture',sender:'Changed <other@example.com>',fetch:async(url,options)=>{
      retryRequests.push(options);return new Response(JSON.stringify({id:'fixture-decline-id'}));
    }});
    assert.equal((await retry.deliver({owner:declined,version:versions[declined]})).status,'sent');
    assert.equal(retryRequests[0].headers['idempotency-key'],failures[0].headers['idempotency-key']);
    assert.equal(retryRequests[0].body,failures[0].body); // Sender and content are stable across retry configuration changes.
    // A lost acknowledgement is reclaimed with a new lease and the same delivery key.
    await sql.exec("update af_review_emails set status='failed',next_attempt_at=now(),provider_id=null,sent_at=null where decision='declined'");
    const one=(await db.rpc('af_mail_claim',{p_sender:'Team <team@example.com>',p_owner:declined,p_version:versions[declined]})).data;
    assert.ok(one.lease);assert.equal((await db.rpc('af_mail_claim',{p_sender:'Team <team@example.com>',p_owner:declined,p_version:versions[declined]})).data,null);
    assert.equal((await db.rpc('af_mail_finish',{p_review:one.reviewId,p_lease:crypto.randomUUID(),p_provider_id:'wrong-lease',p_error:null})).data,false);
    await sql.exec("update af_review_emails set lease_until=now()-interval '1 minute' where decision='declined'");
    const reclaimed=(await db.rpc('af_mail_claim',{p_sender:'Team <team@example.com>',p_owner:declined,p_version:versions[declined]})).data;
    assert.notEqual(one.lease,reclaimed.lease);assert.equal(one.deliveryKey,reclaimed.deliveryKey);
    await sql.exec("update af_review_emails set first_attempt_at=now()-interval '24 hours',lease_until=now()-interval '1 minute' where decision='declined'");
    assert.equal((await retry.deliver({owner:declined,version:versions[declined]})).status,'unchanged');
    row=(await sql.query("select status,last_error from af_review_emails where decision='declined'")).rows[0];
    assert.equal(row.status,'attention');assert.equal(row.last_error,'retry-window-expired');
    assert.equal((await sql.query('select af_admin_retry_mail($1,$2,$3) as result',[admin,declined,versions[declined]])).rows[0].result,false);
  } finally {await sql.close();}
});

test('signed internal wake rejects callers before accessing the queue and reports missing configuration',async()=>{
  let rpcCalls=0,drains=0;
  const db={rpc:async()=>{rpcCalls++;return {data:true};}};
  const mailer={configured:true,drain:async()=>{drains++;return {processed:1};}};
  const handler=createInternalMailHandler({db,reviewMailer:mailer});
  const base='https://example.com/ai-fighter/internal/review-emails';
  assert.equal((await handler(new Request(base,{method:'POST'}))).status,403);assert.equal(rpcCalls,0);
  const request=()=>new Request(base,{method:'POST',headers:{'x-ai-fighter-time':'1792512000','x-ai-fighter-signature':'a'.repeat(64)}});
  assert.equal((await handler(request())).status,200);assert.equal(drains,1);
  const denied=createInternalMailHandler({db:{rpc:async()=>({data:false})},reviewMailer:mailer});
  assert.equal((await denied(request())).status,403);assert.equal(drains,1);
  assert.equal((await createInternalMailHandler({db,reviewMailer:{configured:false}})(request())).status,503);
});

test('email templates reject unknown versions and never interpolate private application/review notes',()=>{
  const job={templateVersion:1,decision:'approved',recipient:'maker@example.com',sender:'Team <team@example.com>',expiresAt:'2026-11-20T00:00:00Z',eventAt:'2026-10-21T00:00:00Z',reason:'DO NOT SEND',note:'DO NOT SEND'};
  assert.equal(JSON.stringify(reviewEmail(job)).includes('DO NOT SEND'),false);
  assert.throws(()=>reviewEmail({...job,templateVersion:2}),/invalid-email-template/);
});
