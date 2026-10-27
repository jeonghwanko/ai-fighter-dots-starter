import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {cloudGateway,PUBLIC_RESOURCE,LEGACY_PUBLIC_RESOURCE,DOMAIN_CHALLENGE,BRANDED_DOMAIN_CHALLENGE} from '../worker/cloud-gateway.mjs';
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
    assert.equal(calls[0].options.headers.get('x-oddbout-public-resource'),LEGACY_PUBLIC_RESOURCE);
    assert.equal((await fetch(base+'/mcp?url=https://evil.test')).status,404);
    assert.equal(calls.length,1);
    await new Promise((resolve,reject)=>{
      const req=request(base+'/mcp',{method:'POST',headers:{host:'mcp.oddbout.com'}},res=>{res.resume();res.on('end',resolve)});
      req.on('error',reject);req.end('{}');
    });
    assert.equal(calls[1].options.headers.get('x-oddbout-public-resource'),PUBLIC_RESOURCE);
    assert.equal(await (await fetch(base+'/.well-known/openai-apps-challenge')).text(),DOMAIN_CHALLENGE);
    const brandedProof=await new Promise((resolve,reject)=>{
      const req=request(base+'/.well-known/openai-apps-challenge',{headers:{host:'mcp.oddbout.com'}},res=>{let body='';res.on('data',part=>body+=part);res.on('end',()=>resolve(body))});
      req.on('error',reject);req.end();
    });
    assert.equal(brandedProof,BRANDED_DOMAIN_CHALLENGE);
    assert.equal(calls.length,2);
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
async function streamingServer(fetcher,options,run) {
  const server=createServer(async(req,res)=>{if(!await cloudGateway(req,res,fetcher,options)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port)}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const events=(count,gapMs,signal)=>new ReadableStream({async start(controller){
  for(let i=0;i<count;i++){await new Promise(r=>setTimeout(r,gapMs));if(signal?.aborted){controller.error(new Error('aborted'));return;}controller.enqueue(new TextEncoder().encode(`data: ${i}\n\n`));}
  controller.close();}});
test('a streamed MCP response may outlast the header timeout; only the wait for headers is bounded',async()=>{
  await streamingServer(async(url,options)=>new Response(events(4,60,options.signal),{headers:{'content-type':'text/event-stream'}}),{headerTimeoutMs:50,totalTimeoutMs:5000},async base=>{
    const response=await fetch(base+'/mcp',{method:'POST',body:'{}'});
    assert.equal(response.status,200);
    assert.equal((await response.text()).match(/data: /g).length,4,'all four events arrived although the stream took longer than the header timeout');
  });
  await streamingServer(async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')))),{headerTimeoutMs:50,totalTimeoutMs:5000},async base=>{
    assert.equal((await fetch(base+'/mcp',{method:'POST',body:'{}'})).status,502,'no headers in time');
  });
});
test('a client that goes away stops the upstream request',async()=>{
  let upstream;
  await streamingServer(async(url,options)=>{upstream=options.signal;return new Response(events(50,40,options.signal),{headers:{'content-type':'text/event-stream'}});},{headerTimeoutMs:1000,totalTimeoutMs:10000},async base=>{
    const client=new AbortController();
    const response=await fetch(base+'/mcp',{method:'POST',body:'{}',signal:client.signal});
    const reader=response.body.getReader(); await reader.read();
    client.abort();
    await new Promise(r=>setTimeout(r,200));
    assert.equal(upstream.aborted,true);
  });
});
