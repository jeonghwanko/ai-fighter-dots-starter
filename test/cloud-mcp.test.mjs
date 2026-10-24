import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, authenticateCloud, allowedFileUrl, downloadHostFile, CLOUD_RESOURCE, CLOUD_ISSUER } from '../mcp/cloud.mjs';
import { verifiedUserId } from '../api/http.mjs';
import { safeClientRedirect, authorizationId } from '../web/cloud-connect/connect.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
const owner = crypto.randomUUID(), session = crypto.randomUUID(), client = crypto.randomUUID();
const token = 'signed-connector-token-for-test';
const claims = () => ({ sub: owner, client_id: client, session_id: session, iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE,
  role: 'af_mcp', af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now()/1000)+600, email: 'test@example.com' });
const dbFor = (c=claims(), active=true) => ({ auth: { getClaims: async () => ({ data: { claims:c } }) }, rpc: async () => ({data:active}) });
const request = (method,params={}, auth=false) => new Request(CLOUD_RESOURCE,{ method:'POST', headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(auth?{authorization:`Bearer ${token}`}:{})}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
const call = async (handle,name,args={}) => (await (await handle(request('tools/call',{name,arguments:args},true))).json()).result;
test('MCP discovery, file schemas, profile identity and HTTP auth challenge interoperate', async () => {
  const handle=createCloudHandler({db:dbFor()});
  const init=await (await handle(request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}))).json();
  assert.equal(init.result.serverInfo.name,'oddbout-cloud');
  const list=await (await handle(request('tools/list'))).json();
  assert.equal(list.result.tools.length,9);
  for(const name of ['prepare_fighter_registration','upload_fighter_asset']) {
    const t=list.result.tools.find(t=>t.name===name), f=t.inputSchema.properties[t._meta['openai/fileParams'][0]];
    assert.deepEqual(new Set(f.required),new Set(['download_url','file_id']));
    assert.deepEqual(Object.keys(f.properties).sort(),['download_url','file_id','file_name','mime_type']);
    assert.equal(t.securitySchemes[0].type,'oauth2');
  }
  const p=list.result.tools.find(t=>t.name==='get_profile');
  assert.equal(p.outputSchema.additionalProperties,false); assert.equal(p._meta['openai/profile'],true);
  assert.deepEqual((await call(handle,'get_profile')).structuredContent,{id:owner,email:'test@example.com',nickname:'ODDBOUT'});
  const denied=await handle(request('tools/call',{name:'get_profile',arguments:{}}));
  assert.equal(denied.status,401); assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);
  const metadata=await (await handle(new Request(`${CLOUD_RESOURCE}/.well-known/oauth-protected-resource`))).json();
  assert.equal(metadata.resource,CLOUD_RESOURCE);
  const gateway=await handle(new Request('http://edge-runtime/ai-fighter-mcp/.well-known/oauth-protected-resource'));
  assert.equal(gateway.status,200);
});
test('normal user tokens, wrong audiences, expiry, future tokens, missing grants and spoofed identities are rejected',async()=>{
  const req=new Request(CLOUD_RESOURCE,{headers:{authorization:`Bearer ${token}`}});
  assert.equal((await authenticateCloud(dbFor(),req)).owner,owner);
  for(const delta of [{aud:'authenticated'},{role:'authenticated'},{iss:'https://evil.test'},{exp:0},{nbf:Date.now()/1000+100},{client_id:null},{session_id:null},{is_anonymous:true},{af_mcp:'admin'},{sub:'other'}])
    assert.equal(await authenticateCloud(dbFor({...claims(),...delta}),req),null);
  assert.equal(await authenticateCloud(dbFor(claims(),false),req),null);
  assert.equal(await verifiedUserId(dbFor(),req),null);
  const encoded=`a.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.c`;
  assert.equal(await verifiedUserId({auth:{getUser:async()=>({data:{user:{id:owner}}})}},new Request(CLOUD_RESOURCE,{headers:{authorization:`Bearer ${encoded}`}})),null);
});
test('cloud readiness never turns account access into generation, display or package approval',async()=>{
  const db={...dbFor(),rpc:async name=>({data:name==='af_account'?{invited:true,accessMode:'open',canSubmit:true}:true})};
  const ready=(await call(createCloudHandler({db}),'check_creation_readiness',{purpose:'registration'})).structuredContent;
  assert.equal(ready.registration.status,'ready');assert.equal(ready.registration.requiresPc,false);
  for(const key of ['generation','delivery','package'])assert.equal(ready[key].status,'unverified');
  assert.deepEqual(ready.nextCommands,[]);
});
test('files cannot fetch arbitrary URLs, follow redirects or exceed manifest byte budget',async()=>{
  for(const url of ['http://files.oaiusercontent.com/a','https://127.0.0.1/x','https://files.oaiusercontent.com.evil.test/x','https://user@files.oaiusercontent.com/x','https://files.oaiusercontent.com:444/x']) assert.equal(allowedFileUrl(url),false);
  let options; const file={download_url:'https://files.oaiusercontent.com/a',file_id:'file_test'};
  await assert.rejects(downloadHostFile(file,3,async(url,opts)=>{options=opts;return new Response('1234')}),/body-limit/);
  assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit');
});
test('foreign submissions and mismatched bytes do not upload; errors never echo signed download URLs',async()=>{
  const filters=[], row={status:'uploading',expires_at:new Date(Date.now()+60000).toISOString(),manifest:{assets:[{id:'idle',bytes:3,sha256:'0'.repeat(64)}]}};
  let data=null, downloads=0;
  const query={select(){return this},eq(k,v){filters.push([k,v]);return this},async maybeSingle(){return{data}}};
  const db={...dbFor(),from:()=>query};
  const handle=createCloudHandler({db,fetcher:async()=>{downloads++;return new Response('abc')}});
  const args={submissionId:crypto.randomUUID(),assetId:'idle',file:{download_url:'https://files.oaiusercontent.com/a?secret=xyz',file_id:'file_a'}};
  assert.equal((await call(handle,'upload_fighter_asset',args)).structuredContent.code,'not-found'); assert.equal(downloads,0);
  assert.ok(filters.some(([k,v])=>k==='owner_id'&&v===owner));
  data=row; const bad=await call(handle,'upload_fighter_asset',args);
  assert.equal(bad.structuredContent.code,'asset-hash-or-size');assert.ok(!JSON.stringify(bad).includes('secret'));
});
test('manifest registration binds owner/idempotency and does not report queued as registered',async()=>{
  const rpcCalls=[],id=crypto.randomUUID(),key=crypto.randomUUID();
  const query={select(){return this},eq(){return this},async single(){return{data:{manifest:example}}},async maybeSingle(){return{data:{id,status:'queued',manifest_sha:'a'.repeat(64)}}}};
  const db={...dbFor(),from:()=>query,rpc:async(name,args)=>{rpcCalls.push([name,args]);return{data:name==='af_create_submission'?{id,status:'uploading',manifest_sha:args.p_sha}:true}}};
  const handle=createCloudHandler({db,fetcher:async()=>new Response(JSON.stringify(example))});
  const prepared=await call(handle,'prepare_fighter_registration',{manifest:{download_url:'https://files.oaiusercontent.com/f.json',file_id:'file_json'},idempotencyKey:key});
  assert.equal(prepared.structuredContent.stage,'uploading');assert.equal(prepared.structuredContent.assets.length,example.assets.length);
  assert.equal(rpcCalls.find(([n])=>n==='af_create_submission')[1].p_owner,owner);assert.equal(rpcCalls.find(([n])=>n==='af_create_submission')[1].p_key,key);
  const status=await call(handle,'get_fighter_submission',{submissionId:id});
  assert.equal(status.structuredContent.stage,'queued');assert.equal(status.structuredContent.fighterId,null);
});
test('native OAuth hook isolates connector tokens and live-session checks enforce owner/client/scope/revocation',async()=>{
  const db=await migratedDatabase();
  try{
    const plain={claims:{sub:owner,role:'authenticated',aud:'authenticated'},authentication_method:'oauth'};
    const hook=e=>db.query('select public.af_mcp_access_token_hook($1) value',[e]).then(r=>r.rows[0].value.claims);
    assert.deepEqual(await hook(plain),plain.claims);
    assert.equal((await hook({...plain,claims:{...plain.claims,client_id:client}})).role,'af_mcp');
    await db.query('insert into auth.oauth_clients(id) values($1)',[client]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)',[session,owner,client,'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)',[owner,client,'openid email profile']);
    const active=(o=owner)=>db.query('select public.af_mcp_session_active($1,$2,$3) value',[o,session,client]).then(r=>r.rows[0].value);
    assert.equal(await active(),true);assert.equal(await active(crypto.randomUUID()),false);
    await db.exec("update auth.sessions set scopes='openid'");assert.equal(await active(),false);
    await db.exec("update auth.sessions set scopes='openid email profile';update auth.oauth_consents set revoked_at=now()");assert.equal(await active(),false);
    await db.exec('set role authenticated');await assert.rejects(active(),/permission denied/);
  }finally{await db.close()}
});
test('consent never redirects to a supplied third-party origin and preserves only a valid authorization ID',()=>{
  assert.equal(safeClientRedirect('https://chatgpt.com/connector_platform/oauth/callback?code=a'),true);
  for(const url of ['javascript:alert(1)','https://chatgpt.com.evil.test','https://user@chatgpt.com/x','http://chatgpt.com'])assert.equal(safeClientRedirect(url),false);
  assert.equal(authorizationId('?authorization_id='+client,null),client);assert.equal(authorizationId('?authorization_id=bad',client),null);
});
