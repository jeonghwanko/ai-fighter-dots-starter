// First-party HTTPS entry point for the same ODDBOUT MCP resource server.
// No admin key, arbitrary URL forwarding, cookies or payload logging.
export const PUBLIC_RESOURCE = 'https://ai-fighter-validator.onrender.com/mcp';
const UPSTREAM = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp';
export const DOMAIN_CHALLENGE = 'k2Mb-EnfNcN-w-vF9YxesesOJ9YXPd6aREXPz9I0PuU';
export async function cloudGateway(req, res, fetcher = fetch) {
  const route = req.url;
  if (!['/mcp', '/mcp/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/openai-apps-challenge'].includes(route)) return false;
  const reply = (status, body, type = 'application/json') => { res.writeHead(status, {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(body); };
  if (route === '/.well-known/openai-apps-challenge') {
    reply(req.method === 'GET' ? 200 : 405, req.method === 'GET' ? DOMAIN_CHALLENGE : '', 'text/plain'); return true;
  }
  if (!['POST','GET','OPTIONS'].includes(req.method)) { reply(405,'{}'); return true; }
  try {
    const headers = new Headers({'x-oddbout-public-resource':PUBLIC_RESOURCE});
    for (const name of ['authorization','content-type','accept','mcp-protocol-version','origin']) if (typeof req.headers[name] === 'string') headers.set(name,req.headers[name]);
    const chunks=[]; let bytes=0;
    for await (const part of req) { bytes += part.length; if (bytes > 65536) { reply(413,'{"error":"body_limit"}'); return true; } chunks.push(part); }
    const path = route === '/mcp' ? '' : '/.well-known/oauth-protected-resource';
    const response = await fetcher(UPSTREAM+path,{method:req.method,headers,redirect:'error',signal:AbortSignal.timeout(30000),...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
    const responseHeaders = {'cache-control':'no-store','x-content-type-options':'nosniff'};
    for (const name of ['content-type','www-authenticate','allow','access-control-allow-origin','access-control-allow-methods','access-control-allow-headers','access-control-expose-headers']) if(response.headers.has(name)) responseHeaders[name]=response.headers.get(name);
    res.writeHead(response.status,responseHeaders);
    for await (const part of response.body ?? []) res.write(part);
    res.end();
  } catch { if(!res.headersSent) reply(502,'{"error":"mcp_upstream_unavailable"}'); else res.end(); }
  return true;
}
