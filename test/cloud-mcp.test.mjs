import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, authenticateCloud, allowedFileUrl, downloadHostFile, CLOUD_RESOURCE, CLOUD_ISSUER, PUBLIC_RESOURCE, LEGACY_PUBLIC_RESOURCE } from '../mcp/cloud.mjs';
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
  assert.equal(list.result.tools.length,12);
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
  const publicMetadata=await (await handle(new Request(`${CLOUD_RESOURCE}/.well-known/oauth-protected-resource`,{headers:{'x-oddbout-public-resource':PUBLIC_RESOURCE}}))).json();
  assert.equal(publicMetadata.resource,PUBLIC_RESOURCE);
  assert.equal(list.result.tools.find(t=>t.name==='submit_fighter_registration').annotations.destructiveHint,true);
  // Persisting a private confirmation is a write, but it does not publish or
  // contact an open-ended recipient. File imports and public roster changes do.
  const preparation=list.result.tools.find(t=>t.name==='prepare_fighter_deletion').annotations;
  assert.equal(preparation.readOnlyHint,false);
  assert.equal(preparation.openWorldHint,false);
  assert.equal(preparation.destructiveHint,false);
  for(const name of ['prepare_fighter_registration','upload_fighter_asset','submit_fighter_registration','delete_fighter'])
    assert.equal(list.result.tools.find(t=>t.name===name).annotations.openWorldHint,true,name);
  const gateway=await handle(new Request('http://edge-runtime/ai-fighter-mcp/.well-known/oauth-protected-resource'));
  assert.equal(gateway.status,200);
  const contract=await (await handle(request('tools/call',{name:'get_fighter_spec',arguments:{section:'overview'}}))).json();
  assert.equal(contract.result.structuredContent.data.registration.available,true);
  assert.equal(contract.result.structuredContent.data.registration.requiresPc,false);
  assert.equal(contract.result.structuredContent.data.registration.assetUpload,'openai-fileParams');
  assert.equal(contract.result.structuredContent.data.registration.approvalRequired,false);
});
test('normal user tokens, wrong audiences, expiry, future tokens, missing grants and spoofed identities are rejected',async()=>{
  const req=new Request(CLOUD_RESOURCE,{headers:{authorization:`Bearer ${token}`}});
  assert.equal((await authenticateCloud(dbFor(),req)).owner,owner);
  assert.equal((await authenticateCloud(dbFor({...claims(),aud:[CLOUD_RESOURCE,LEGACY_PUBLIC_RESOURCE]}),req)).owner,owner);
  assert.equal((await authenticateCloud(dbFor({...claims(),aud:[CLOUD_RESOURCE,LEGACY_PUBLIC_RESOURCE,PUBLIC_RESOURCE]}),req)).owner,owner);
  for(const aud of [[CLOUD_RESOURCE,'https://evil.test'],[CLOUD_RESOURCE,CLOUD_RESOURCE],[],['authenticated'],[CLOUD_RESOURCE,PUBLIC_RESOURCE,'authenticated']])
    assert.equal(await authenticateCloud(dbFor({...claims(),aud}),req),null);
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
    assert.deepEqual((await hook({...plain,claims:{...plain.claims,client_id:client}})).aud,[CLOUD_RESOURCE,LEGACY_PUBLIC_RESOURCE,PUBLIC_RESOURCE]);
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

test('deletion tools require explicit confirmation and bind every call to verified owner, session and client',async()=>{
  const calls=[],fighter=crypto.randomUUID(),confirmation=crypto.randomUUID();
  const db={...dbFor(),rpc:async(name,args)=>{
    calls.push([name,args]); return {data:name==='af_mcp_session_active'?true:{ok:true,stage:'confirmation-required'}};
  }};
  const handle=createCloudHandler({db});
  const list=(await (await handle(request('tools/list'))).json()).result.tools;
  const tool=list.find(t=>t.name==='delete_fighter');
  assert.equal(tool.annotations.destructiveHint,true);
  assert.ok(tool.inputSchema.required.includes('confirm'));
  assert.ok(!Object.keys(tool.inputSchema.properties).some(k=>/owner|email|session|client/.test(k)));
  const p=(await call(handle,'prepare_fighter_deletion',{fighterId:fighter})).structuredContent;
  assert.deepEqual(p.account,{id:owner,email:'test@example.com'});
  const args={fighterId:fighter,confirmationToken:confirmation,confirmName:'Exact name'};
  assert.equal((await call(handle,'delete_fighter',{...args,confirm:false})).isError,true);
  assert.equal(calls.filter(([n])=>n==='af_delete_owned_fighter').length,0);
  await call(handle,'delete_fighter',{...args,confirm:true});
  assert.deepEqual(calls.find(([n])=>n==='af_delete_owned_fighter')[1],{
    p_owner:owner,p_session:session,p_client:client,p_fighter:fighter,p_token:confirmation,p_confirm_name:'Exact name'});
  db.rpc=async name=>name==='af_mcp_session_active'?{data:true}:{error:{message:'private database details'}};
  const failed=await call(handle,'delete_fighter',{...args,confirm:true});
  assert.equal(failed.structuredContent.code,'database-unavailable');
  assert.ok(!JSON.stringify(failed).includes('private database'));
});

test('owned list excludes deleted rows and owned lookup returns only a deletion receipt',async()=>{
  const filters=[],fighter=crypto.randomUUID(),deletedAt=new Date().toISOString();
  const query={select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},order(){return this},
    async limit(){return{data:[]}},async maybeSingle(){return{data:{id:fighter,deleted_at:deletedAt,profile:{name:'Deleted'}}}}};
  const db={...dbFor(),from:()=>query};
  const handle=createCloudHandler({db});
  assert.deepEqual((await call(handle,'list_my_fighters')).structuredContent.fighters,[]);
  assert.ok(filters.some(([k,v])=>k==='deleted_at'&&v===null));
  assert.ok(filters.some(([k,v])=>k==='owner_id'&&v===owner));
  assert.deepEqual((await call(handle,'get_registered_fighter',{fighterId:fighter})).structuredContent,
    {ok:true,stage:'deleted',fighterId:fighter,deletedAt});
});

test('agent tools list only with the arena key; reads are public, spars and cups carry the verified owner and the key', async () => {
  const calls = [], key = 'k'.repeat(64);
  const arena = { url: 'https://arena.test/oddbout-arena', key, fetcher: async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/fighters')) return Response.json({ ok: true, rules: 39, fighters: [{ id: 'kuma', name: 'KUMA' }] });
    if (url.includes('/agent/')) return Response.json({ ok: true, echo: JSON.parse(init.body) });
    return Response.json({ ok: true, url });
  } };
  const names = async handle => (await (await handle(request('tools/list'))).json()).result.tools.map(t => t.name);
  assert.equal((await names(createCloudHandler({ db: dbFor() }))).includes('spar'), false);
  assert.equal((await names(createCloudHandler({ db: dbFor(), arena: { url: arena.url, key: null } }))).includes('spar'), false);
  const listed = await names(createCloudHandler({ db: dbFor(), arena }));
  for (const tool of ['get_style_guide', 'list_fighters', 'get_rankings', 'get_fighter_record', 'get_cup', 'read_bout', 'spar', 'enter_cup', 'update_fighter_style'])
    assert.ok(listed.includes(tool), tool);
  // Public reads need no connected account and send no key.
  const signedOut = createCloudHandler({ db: { auth: { getClaims: async () => ({ data: null }) }, rpc: async () => ({ data: false }) }, arena });
  const guide = (await (await signedOut(request('tools/call', { name: 'get_style_guide', arguments: {} }))).json()).result.structuredContent;
  assert.equal(guide.ok, true); assert.deepEqual(guide.contract.temper, ['guard', 'retreat', 'measure', 'patience']);
  const bout = (await (await signedOut(request('tools/call', { name: 'read_bout', arguments: { a: 'kuma', b: 'yume', seed: 7 } }))).json()).result.structuredContent;
  assert.equal(bout.url, 'https://arena.test/oddbout-arena/bout?a=kuma&b=yume&seed=7');
  assert.equal(calls.at(-1).headers['x-arena-agent'], undefined);
  assert.equal((await (await signedOut(request('tools/call', { name: 'spar', arguments: { fighterId: 'kuma', opponentId: 'yume' } }))).status), 401);
  // Agent calls: the owner is the verified one, never an argument.
  const handle = createCloudHandler({ db: dbFor(), arena });
  const spar = (await call(handle, 'spar', { fighterId: 'kuma', opponentId: 'yume', seed: 3 })).structuredContent;
  assert.deepEqual(spar.echo, { owner, a: 'kuma', b: 'yume', seed: 3 }); assert.equal(calls.at(-1).headers['x-arena-agent'], key);
  const fighter = crypto.randomUUID();
  assert.deepEqual((await call(handle, 'enter_cup', { fighterId: fighter })).structuredContent.echo, { owner, fighter });
  assert.equal((await call(handle, 'read_bout', { cupId: fighter })).structuredContent.code, 'invalid-bout');
  const failing = createCloudHandler({ db: dbFor(), arena: { ...arena, fetcher: async () => { throw new Error('down'); } } });
  assert.equal((await call(failing, 'get_rankings', {})).structuredContent.code, 'arena-unavailable');
});

test('a style edit goes through the profile edit on the owner\'s current package', async () => {
  const fighter = crypto.randomUUID(), filters = [];
  const query = { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, is(k, v) { filters.push([k, v]); return this; },
    async maybeSingle() { return { data: { manifest_sha: 'c'.repeat(64) } }; } };
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) };
  const handle = createCloudHandler({ db: { ...dbFor(), from: () => query }, arena });
  const tool = (await (await handle(request('tools/list'))).json()).result.tools.find(t => t.name === 'update_fighter_style');
  assert.equal(tool.annotations.destructiveHint, true);
  const result = (await call(handle, 'update_fighter_style', { fighterId: fighter, style: { distance: 2 }, idempotencyKey: crypto.randomUUID() })).structuredContent;
  // The in-process API asks the database next; this stub has none, so it stops there — after reading only the owner's own fighter.
  assert.equal(result.ok, false);
  assert.ok(filters.some(([k, v]) => k === 'owner_id' && v === owner)); assert.ok(filters.some(([k, v]) => k === 'id' && v === fighter));
});
