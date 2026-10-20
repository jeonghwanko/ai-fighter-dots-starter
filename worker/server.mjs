import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validProjectUrl } from '../api/client.mjs';
import { runWithConfig } from './run.mjs';

/** HTTP-triggered worker. Supabase owns the durable queue and five-minute leases. */
export function createWorkerServer({ wakeToken, run, log = console.log }) {
  if (!/^[a-f0-9]{64}$/.test(wakeToken ?? '')) throw new Error('invalid-wake-token');
  const expected = Buffer.from(`Bearer ${wakeToken}`);
  let active = null, stopping = false, requested = false;
  async function drain() {
    do {
      requested = false;
      try {
        while (!stopping) {
          const result = await run();
          // Never log credentials, signed URLs or package contents.
          log(JSON.stringify({ stage: result.stage, submissionId: result.submissionId }));
          if (result.stage === 'idle' || result.stage === 'retry-later') break;
        }
      } catch {
        log(JSON.stringify({ stage: 'retry-later' }));
      }
    } while (requested && !stopping);
  }
  const server = createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') {
      return reply(stopping ? 503 : 200, { ok: !stopping });
    }
    if (req.method !== 'POST' || req.url !== '/wake') return reply(404, { ok: false });
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply(401, { ok: false });
    }
    if (stopping) return reply(503, { ok: false });
    req.resume(); // No user-supplied job payload; claim only from the authenticated queue.
    requested = true;
    if (!active) active = drain().finally(() => { active = null; });
    reply(202, { ok: true });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return {
    server,
    async stop() {
      stopping = true;
      server.close();
      server.closeIdleConnections();
      await active;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = { url: process.env.AI_FIGHTER_PROJECT_URL, workerToken: process.env.AI_FIGHTER_WORKER_TOKEN };
  if (!validProjectUrl(config.url) || !/^afw_[a-f0-9]{64}$/.test(config.workerToken ?? '')) {
    throw new Error('invalid-worker-config');
  }
  const app = createWorkerServer({
    wakeToken: process.env.AI_FIGHTER_WAKE_TOKEN,
    run: () => runWithConfig(config),
  });
  app.server.listen(Number(process.env.PORT ?? 10000), '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.stop(); });
}
