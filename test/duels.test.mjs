import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createHandler,sha256} from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with {type:'json'};

/** Two duel-approved fighters in a migrated PGlite, and a db adapter shaped like the Supabase client. */
async function duelFixture() {
  const sql=new PGlite();
  await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    grant usage on schema auth to authenticated,service_role; create schema storage; create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql') && !x.includes('dispatch')).sort()) await sql.exec(await readFile(new URL(file,dir),'utf8'));
  const ids=[]; const manifestText=JSON.stringify(example),hash=await sha256(new TextEncoder().encode(manifestText));
  for(const name of ['A','B']) {
    const owner=crypto.randomUUID(),sub=crypto.randomUUID(),id=crypto.randomUUID();ids.push(id);
    await sql.query('insert into auth.users values($1)',[owner]);await sql.query('insert into af_creators(owner_id) values($1)',[owner]);
    await sql.query(`insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
      values($1,$2,$3,$4,$5,$6,1,'registered')`,[sub,owner,crypto.randomUUID(),manifestText,example,hash]);
    await sql.query(`insert into af_fighters(id,submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,runtime_manifest_sha,review_evidence,duel_approved,duel_manifest_sha)
      values($1,$2,$3,$4,$5,'approved',true,'arena-player-v1',$4,$6,true,$4)`,[id,sub,owner,hash,name==='A'?{name,names:{ko:'에이'}}:{name},{authorization:'test',validation:'test',duelValidation:'test'}]);
  }
  const functions={af_reserve_duel:['p_key','p_a','p_b','p_engine'],af_complete_duel:['p_id','p_engine','p_result'],af_fail_duel:['p_id','p_engine','p_code'],af_duel_rankings:[]};
  const db={rpc:async(name,args)=>{try {
    const values=functions[name].map(k=>args[k]);
    const q=name==='af_duel_rankings'?'select * from af_duel_rankings()':`select to_jsonb(public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')})) as value`;
    const r=await sql.query(q,values);return {data:name==='af_duel_rankings'?r.rows:r.rows[0].value};
  }catch(error){return {error};}},from:table=>{
    assert.ok(['af_fighters','af_submissions','af_duels'].includes(table));let filters=[],values=[];
    const q={select:()=>q,eq:(k,v)=>{assert.match(k,/^\w+$/);values.push(v);filters.push(`${k}=$${values.length}`);return q;},
      not:(k)=>{assert.equal(k,'completed_at');filters.push('completed_at is not null');return q;},
      in:(k,v)=>{assert.match(k,/^\w+$/);values.push(v);filters.push(`${k}=any($${values.length})`);return q;},
      then:(resolve,reject)=>sql.query(`select * from ${table} where ${filters.join(' and ')}`,values).then(r=>({data:r.rows}),error=>({error})).then(resolve,reject),
      maybeSingle:async()=>({data:(await sql.query(`select * from ${table} where ${filters.join(' and ')}`,values)).rows[0]??null})};return q;
  }};
  return {sql,db,ids};
}

test('server matches: immutable result, atomic pair records, retries, budgets, admission and denied direct writes',async()=>{
  const {sql,db,ids}=await duelFixture();
  try {
    let calls=0;
    const result={winner:0,how:'ko',ms:1000,hp:[0.5,0],contacts:[3,1],digest:'1234abcd'};
    const handle=createHandler({db,engineVersion:'test-v1',simulateDuel:(a,ma,b,mb,seed)=>{
      calls++;assert.equal(a,ids[0]);assert.equal(b,ids[1]);assert.deepEqual(ma,example);assert.deepEqual(mb,example);
      assert.ok(seed>=0&&seed<=0xffffffff);return result;
    }});
    const body={a:ids[0],b:ids[1],idempotencyKey:crypto.randomUUID()};
    const post=(b=body)=>handle(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify(b)}));
    for(const extra of [{winner:1},{seed:42},{result},{manifest:{}}]) assert.equal((await post({...body,...extra})).status,422);
    assert.equal((await post({...body,manifest:example})).status,413);
    assert.equal((await post({...body,b:body.a})).status,422);
    const attempts=await Promise.all(Array.from({length:4},()=>post()));
    for(const r of attempts) assert.equal(r.status,200);
    const matches=await Promise.all(attempts.map(x=>x.json()));const match=matches[0].match;
    assert.ok(matches.every(x=>x.match.id===match.id));assert.equal('request_key' in match,false);
    assert.equal((await sql.query('select count(*)::int as n from af_duels')).rows[0].n,1);
    const rank=await (await handle(new Request('https://test/ai-fighter/rankings'))).json();
    assert.deepEqual(rank.rankings.map(x=>[x.name,Number(x.won),Number(x.lost),Number(x.points)]),[['A',1,0,3],['B',0,1,0]]);
    assert.deepEqual(rank.rankings.map(x=>x.names??null),[{ko:'에이'},null]);
    const callsBefore=calls;assert.equal((await post()).status,200);assert.equal(calls,callsBefore);
    assert.equal((await post({...body,a:body.b,b:body.a})).status,409);
    const read=await (await handle(new Request(`https://test/ai-fighter/duels/${match.id}`))).json();assert.equal(read.match.id,match.id);
    await assert.rejects(sql.query('select af_complete_duel($1,$2,$3)',[match.id,'test-v1',{...result,winner:1}]),/result-conflict/);
    await sql.query('update af_fighters set duel_approved=false,duel_manifest_sha=null where id=$1',[body.b]);
    assert.equal((await post({...body,idempotencyKey:crypto.randomUUID()})).status,409);
    await sql.query('update af_fighters set duel_approved=true,duel_manifest_sha=manifest_sha where id=$1',[body.b]);
    for(let i=1;i<20;i++) assert.equal((await post({...body,idempotencyKey:crypto.randomUUID()})).status,200);
    assert.equal((await post({...body,idempotencyKey:crypto.randomUUID()})).status,429);
    assert.equal((await post()).status,200); // Retries do not consume a budget slot.
    for(const role of ['anon','authenticated']) {
      await sql.exec(`set role ${role}`);
      await assert.rejects(sql.query('select af_reserve_duel($1,$2,$3,$4)',[crypto.randomUUID(),...ids,'test-v1']),/permission denied/);
      await assert.rejects(sql.query('select af_complete_duel($1,$2,$3)',[match.id,'test-v1',result]),/permission denied/);
      await assert.rejects(sql.query('update af_duels set result=$1',[result]),/permission denied/);
      await assert.rejects(sql.query('select * from af_duels'),/permission denied/);
      await sql.exec('reset role');
    }
    assert.equal((await createHandler({db})(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify(body)}))).status,503);
  } finally {await sql.close();}
});

test('a failed run leaves the match budget, retries can finish it, and repeated failures stop new runs',async()=>{
  const {sql,db,ids}=await duelFixture();
  try {
    const result={winner:1,how:'decision',ms:90000,hp:[0.2,0.4],contacts:[2,5],digest:'abcd1234'};
    let broken=true;
    const handle=createHandler({db,engineVersion:'test-v1',simulateDuel:()=>{ if(broken) throw new Error('engine crashed'); return result; }});
    const post=key=>handle(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify({a:ids[0],b:ids[1],idempotencyKey:key})}));
    const first=crypto.randomUUID();
    const failed=await post(first);
    assert.equal(failed.status,503); assert.equal((await failed.json()).code,'duel-engine-failed');
    const row=(await sql.query('select failed_at is not null as failed,failures,failure,result from af_duels where request_key=$1',[first])).rows[0];
    assert.deepEqual(row,{failed:true,failures:1,failure:'engine-error',result:null});
    // Failed runs do not spend the pair budget of 20: 19 more failures still leave room for real matches.
    for(let i=0;i<18;i++) assert.equal((await post(crypto.randomUUID())).status,503);
    broken=false;
    const retried=await post(first);
    assert.equal(retried.status,200);
    assert.deepEqual((await sql.query('select failed_at,failure from af_duels where request_key=$1',[first])).rows[0],{failed_at:null,failure:null});
    for(let i=0;i<19;i++) assert.equal((await post(crypto.randomUUID())).status,200);
    assert.equal((await post(crypto.randomUUID())).status,429);
    // The brake: 20 failed runs in a day stop new runs and retries of unfinished ones.
    await sql.query("update af_duels set failed_at=now(),failures=20,failure='engine-error' where request_key=(select request_key from af_duels where result is null limit 1)");
    const braked=await post(crypto.randomUUID());
    assert.equal(braked.status,503); assert.equal((await braked.json()).code,'duels-failing');
    assert.equal((await post(first)).status,200); // A finished match is still returned.
  } finally {await sql.close();}
});
