import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type:'json' };
import { sha256, VALIDATOR_VERSION } from '../api/handler.mjs';

test('owner deletion binds live identity, name, expiry and snapshot; removes visibility, frees one slot and retries safely', async () => {
  const db=await migratedDatabase();
  try {
    const owner=crypto.randomUUID(), other=crypto.randomUUID(), session=crypto.randomUUID(), client=crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
    await db.query('insert into auth.oauth_clients(id) values($1)',[client]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)',[session,owner,client,'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)',[owner,client,'openid email profile']);
    const profile={name:'Deletion fixture',description:'Test only',portrait:'/art/character-profiles/test-v1.webp',color:'#ffeebb'};
    const create=()=>db.query('select to_jsonb(af_register_character_profile($1,$2,$3,$4)) value',[owner,crypto.randomUUID(),profile,'kkumssi']).then(r=>r.rows[0].value);
    const f=await create(), second=await create(), third=await create();
    await assert.rejects(create(),/fighter-quota/);
    const prepare=(who=owner,id=f.id,s=session,c=client)=>db.query('select af_prepare_fighter_deletion($1,$2,$3,$4) value',[who,id,s,c]).then(r=>r.rows[0].value);
    const remove=(d,name=d.confirmName,s=session)=>db.query('select af_delete_owned_fighter($1,$2,$3,$4,$5,$6) value',[owner,f.id,s,client,d.confirmationToken,name]).then(r=>r.rows[0].value);
    const before=(await db.query('select * from af_fighters where id in ($1,$2) order by id',[second.id,third.id])).rows;
    await assert.rejects(prepare(other),/authentication-required/);
    const foreign=(await db.query('select to_jsonb(af_register_character_profile($1,$2,$3,null)) value',[other,crypto.randomUUID(),profile])).rows[0].value;
    await assert.rejects(prepare(owner,foreign.id),/not-found/);
    let d=await prepare();
    assert.equal(d.stage,'confirmation-required'); assert.equal(d.ownerId,owner);
    assert.equal(d.effects.retainPrivatePackageAndHistory,true);
    assert.equal((await prepare()).confirmationToken,d.confirmationToken);
    await assert.rejects(remove({...d,confirmationToken:crypto.randomUUID()}),/invalid-deletion-confirmation/);
    await assert.rejects(remove(d,'Another name'),/deletion-name-mismatch/);
    await assert.rejects(remove(d,d.confirmName,crypto.randomUUID()),/authentication-required/);
    const secondSession=crypto.randomUUID();
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)',[secondSession,owner,client,'openid email profile']);
    await assert.rejects(remove(d,d.confirmName,secondSession),/invalid-deletion-confirmation/);
    await db.query('update af_fighters set profile=profile||$1 where id=$2',[{description:'Changed after confirmation'},f.id]);
    await assert.rejects(remove(d),/fighter-changed/);
    const old=d; d=await prepare(); assert.notEqual(d.confirmationToken,old.confirmationToken);
    await assert.rejects(remove(old),/invalid-deletion-confirmation/);
    await db.query("update af_fighter_deletions set expires_at=now()-interval '1 second' where token=$1",[d.confirmationToken]);
    await assert.rejects(remove(d),/deletion-confirmation-expired/);
    d=await prepare();
    await db.exec('update auth.oauth_consents set revoked_at=now()');
    await assert.rejects(remove(d),/authentication-required/);
    await db.exec('update auth.oauth_consents set revoked_at=null');
    await db.exec('set role authenticated');
    await assert.rejects(prepare(),/permission denied/);
    await assert.rejects(remove(d),/permission denied/);
    await assert.rejects(db.query('select * from af_fighter_deletions'),/permission denied/);
    await db.exec('reset role; set role service_role');
    const result=await remove(d);
    assert.equal(result.stage,'deleted'); assert.equal(result.fighterSlotReleased,true);
    await db.exec('reset role');
    await db.query("update af_fighter_deletions set expires_at=now()-interval '1 second' where token=$1",[d.confirmationToken]);
    assert.deepEqual(await remove(d),result);
    assert.equal((await prepare()).stage,'deleted');
    const row=(await db.query('select * from af_fighters where id=$1',[f.id])).rows[0];
    assert.ok(row.deleted_at); assert.equal(row.account_slot,null);
    assert.equal(row.runtime_approved,false); assert.equal(row.duel_approved,false);
    assert.equal(row.review_state,'rejected'); assert.equal(row.profile.name,profile.name);
    const audit=(await db.query('select snapshot from af_fighter_deletions where token=$1',[d.confirmationToken])).rows[0];
    assert.equal(audit.snapshot.worldMembership.fighter_id,f.id);
    assert.equal((await db.query('select * from af_world_fighters where fighter_id=$1',[f.id])).rows.length,0);
    await assert.rejects(db.query('update af_fighters set deleted_at=null,account_slot=1 where id=$1',[f.id]),/fighter-deleted/);
    assert.deepEqual((await db.query('select * from af_fighters where id in ($1,$2) order by id',[second.id,third.id])).rows,before);
    const replacement=await create(); assert.equal(replacement.account_slot,f.account_slot);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
    assert.equal((await db.query('select id from af_fighters where id=$1',[f.id])).rows.length,0);
    assert.equal((await db.query('select id from af_fighters')).rows.length,3);
    await db.exec('reset role; set role anon');
    assert.equal((await db.query('select id from af_public_character_profiles where id=$1',[f.id])).rows.length,0);
  } finally { await db.close(); }
});

test('deleting a registered fighter preserves its package and duel record, and allows a replacement upload',async()=>{
  const db=await migratedDatabase();
  try {
    const owner=crypto.randomUUID(),session=crypto.randomUUID(),client=crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1)',[owner]);
    await db.query('insert into af_creators(owner_id) values($1)',[owner]);
    await db.query('insert into auth.oauth_clients(id) values($1)',[client]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)',[session,owner,client,'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)',[owner,client,'openid email profile']);
    const text=JSON.stringify(example),hash=await sha256(new TextEncoder().encode(text)),bytes=example.assets.reduce((n,a)=>n+a.bytes,0);
    const upload=()=>db.query('select to_jsonb(af_create_submission($1,$2,$3,$4,$5)) value',[owner,crypto.randomUUID(),text,hash,bytes]).then(r=>r.rows[0].value);
    const s=await upload();
    for(const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)',['ai-fighter-beta',`${owner}/${s.id}/${a.id}.webp`,{size:a.bytes}]);
    await db.query('select af_submit($1,$2)',[owner,s.id]);
    const claim=(await db.query('select to_jsonb(af_claim($1)) value',[s.id])).rows[0].value;
    const done=(await db.query('select to_jsonb(af_finish($1,$2,$3,true,$4)) value',[s.id,claim.lease_token,hash,
      {validatorVersion:VALIDATOR_VERSION,stage:'bytes-hashes-and-full-decode',errors:[]}])).rows[0].value;
    const profile={name:'Test rival',description:'Test only',portrait:'/art/character-profiles/test-v1.webp',color:'#ffeebb'};
    const rival=(await db.query('select to_jsonb(af_register_character_profile($1,$2,$3,null)) value',[owner,crypto.randomUUID(),profile])).rows[0].value;
    await db.query('select af_register_character_profile($1,$2,$3,null)',[owner,crypto.randomUUID(),profile]);
    await assert.rejects(upload(),/fighter-quota/);
    await db.query(`insert into af_duels(request_key,a,b,hash_a,hash_b,seed,engine,completed_at,winner,result)
      values($1,$2,$3,$4,$4,7,'test-v1',now(),$2,'{"winner":0}')`,[crypto.randomUUID(),done.fighter_id,rival.id,hash]);
    const history=(await db.query('select * from af_duels')).rows;
    const d=(await db.query('select af_prepare_fighter_deletion($1,$2,$3,$4) value',[owner,done.fighter_id,session,client])).rows[0].value;
    await db.query('select af_delete_owned_fighter($1,$2,$3,$4,$5,$6)',[owner,done.fighter_id,session,client,d.confirmationToken,d.confirmName]);
    assert.deepEqual((await db.query('select * from af_duels')).rows,history);
    assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,example.assets.length);
    assert.equal((await db.query('select manifest_text from af_submissions where id=$1',[s.id])).rows[0].manifest_text,text);
    assert.equal((await db.query('select * from af_duel_rankings() where id=$1',[done.fighter_id])).rows.length,0);
    assert.equal((await upload()).status,'uploading');
  } finally { await db.close(); }
});
