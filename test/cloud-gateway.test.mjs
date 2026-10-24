import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {cloudGateway,PUBLIC_RESOURCE,DOMAIN_CHALLENGE} from '../worker/cloud-gateway.mjs';
async function serverFor(fetcher,run) {
  const server=createServer(async(req,res)=>{if(!await cloudGateway(req,res,fetcher)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port)}finally{await new Promise(resolve=>server.close(resolve));}
}
test('public gateway forwards only the fixed MCP endpoint and bounded protocol headers, without cookies or wake credentials',async()=>{
  const calls=[];
  await serverFor(async(url,options)=>{calls.push({url,options});return new Response('{"ok":true}',{headers:{'content-type':'application/json','set-cookie':'must-not-forward'}})},async base=>{
    const response=await fetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer oauth-token',cookie:'private=secret','x-ai-fighter-time':'123','x-oddbout-public-resource':'https://evil.test','content-type':'application/json'},body:'{"jsonrpc":"2.0"}'});
    assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp');
    assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.get('cookie'),null);
    assert.equal(calls[0].options.headers.get('x-ai-fighter-time'),null);
    assert.equal(calls[0].options.headers.get('authorization'),'Bearer oauth-token');
    assert.equal(calls[0].options.headers.get('x-oddbout-public-resource'),PUBLIC_RESOURCE);
    assert.equal((await fetch(base+'/mcp?url=https://evil.test')).status,404);
    assert.equal(calls.length,1);
    assert.equal(await (await fetch(base+'/.well-known/openai-apps-challenge')).text(),DOMAIN_CHALLENGE);
    assert.equal(calls.length,1);
  });
});
test('oversized requests and upstream failures do not leak OAuth tokens or return success',async()=>{
  let calls=0;
  await serverFor(async()=>{calls++;throw new Error('Bearer private-token')},async base=>{
    const oversized=await fetch(base+'/mcp',{method:'POST',body:'x'.repeat(65537)});
    assert.equal(oversized.status,413);assert.equal(calls,0);
    const failed=await fetch(base+'/mcp',{method:'POST',body:'{}'});
    assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('private-token'));
  });
});
