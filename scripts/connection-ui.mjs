import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { validProjectUrl } from '../api/client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function createConnectionUI({ url, publishableKey, port = 8791 }) {
  if (!validProjectUrl(url) || typeof publishableKey !== 'string' || !publishableKey.startsWith('sb_publishable_'))
    throw new Error('public-config-required');
  const origin = `http://127.0.0.1:${port}`;
  const files = { '/': ['connect/index.html', 'text/html'], '/app.mjs': ['connect/app.mjs', 'text/javascript'],
    '/style.css': ['connect/style.css', 'text/css'], '/owner-client.mjs': ['auth/owner-client.mjs', 'text/javascript'],
    '/supabase.js': ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'text/javascript'] };
  return createServer(async (req, res) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${url}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` };
    // Loopback only, fixed Host and same-origin requests prevent DNS rebinding/local config reads.
    if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)
      || req.method !== 'GET') { res.writeHead(403, headers); res.end(); return; }
    try {
      const route = new URL(req.url, origin).pathname;
      if (route === '/config.json') {
        res.writeHead(200, { ...headers, 'content-type': 'application/json' }); res.end(JSON.stringify({ url, publishableKey })); return;
      }
      const file = files[route];
      if (!file) { res.writeHead(404, headers); res.end(); return; }
      const bytes = await readFile(path.join(root, file[0]));
      res.writeHead(200, { ...headers, 'content-type': file[1] }); res.end(bytes);
    } catch { res.writeHead(500, headers); res.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [url, publishableKey] = process.argv.slice(2);
    const server = createConnectionUI({ url, publishableKey });
    server.listen(8791, '127.0.0.1', () => console.log('Open http://127.0.0.1:8791/ on your own computer to sign in and approve.'));
  } catch { console.error('public-config-required: use a project URL and sb_publishable_ key'); process.exitCode = 1; }
}
