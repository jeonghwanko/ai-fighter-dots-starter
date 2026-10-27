// First-party HTTPS entry point for the same ODDBOUT MCP resource server.
// No admin key, arbitrary URL forwarding, cookies or payload logging.
export const LEGACY_PUBLIC_RESOURCE = 'https://ai-fighter-validator.onrender.com/mcp';
export const PUBLIC_RESOURCE = 'https://mcp.oddbout.com/mcp';
const UPSTREAM = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp';
export const DOMAIN_CHALLENGE = 'c8ZJAeo0-MPwQFn6nJQ1rcg_qzCq_kxMyIcZJksSfrM';
export const BRANDED_DOMAIN_CHALLENGE = 'v4qUmFhpjDn1BF6ilHvAVROEnUfTK5XJMumPWkOK8PY';
export async function cloudGateway(req, res, fetcher = fetch) {
  const route = req.url;
  if (!['/mcp', '/mcp/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/openai-apps-challenge'].includes(route)) return false;
  const reply = (status, body, type = 'application/json') => { res.writeHead(status, {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(body); };
  if (route === '/.well-known/openai-apps-challenge') {
    const challenge = req.headers.host === 'mcp.oddbout.com' ? BRANDED_DOMAIN_CHALLENGE : DOMAIN_CHALLENGE;
    reply(req.method === 'GET' ? 200 : 405, req.method === 'GET' ? challenge : '', 'text/plain'); return true;
  }
  if (!['POST','GET','OPTIONS'].includes(req.method)) { reply(405,'{}'); return true; }
  try {
    const resource = req.headers.host === 'mcp.oddbout.com' ? PUBLIC_RESOURCE : LEGACY_PUBLIC_RESOURCE;
    const headers = new Headers({'x-oddbout-public-resource':resource});
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
