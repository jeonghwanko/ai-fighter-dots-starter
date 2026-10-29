// The same device-login flow as the CLI, exposed directly to VM agents. No shell or tokens in tool output.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { checkLogin } from './creation-readiness.mjs';
import { readProject } from './connection-readiness.mjs';
import { connectionAction } from '../api/connection-errors.mjs';
import { defaultSessionPath, pendingDeviceLoginPath, startDeviceLogin, waitDeviceLogin } from '../scripts/login.mjs';
import { creatorPage, PUBLIC_CREATOR_PAGE } from './creator-handoff.mjs';
import { errorCode } from './error-code.mjs';

const kitRoot = fileURLToPath(new URL('../', import.meta.url));
const instruction = '링크를 열어 본인 Google 계정으로 로그인하고, 본인이 시작한 요청의 코드와 화면의 코드가 같은지 확인해 승인하세요. 콜백 주소나 토큰을 대화로 보내지 마세요.';

export function connectionHandler({ remote, root = kitRoot, sessionPath = defaultSessionPath(), probe,
  start = startDeviceLogin, wait = waitDeviceLogin, page = PUBLIC_CREATOR_PAGE } = {}) {
  let busy = false;
  const status = () => checkLogin({ root, sessionPath, probe, remoteActive: Boolean(remote), request: remote?.request });
  const preview = async () => {
    const pending = JSON.parse(await readFile(pendingDeviceLoginPath(sessionPath), 'utf8'));
    const project = await readProject(root);
    if (!project || pending.url !== project.origin || pending.publishableKey !== project.publishableKey
      || !/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(pending.userCode ?? '')
      || !Number.isFinite(Date.parse(pending.expiresAt)) || Date.parse(pending.expiresAt) <= Date.now())
      throw new Error('pending-device-login-invalid');
    return { status: 'awaiting-approval', verificationUrl: `${creatorPage(page).href}#device=${pending.userCode}`,
      userCode: pending.userCode, expiresAt: pending.expiresAt, instruction, nextTool: { name: 'connect_oddbout', arguments: { action: 'wait' } } };
  };
  return async ({ action = 'status' } = {}) => {
    if (busy) return { ok: false, stage: 'oddbout-connection', code: 'connection-in-progress' };
    busy = true;
    try {
      const current = await status();
      if (current.status === 'connected') return { ok: true, stage: 'oddbout-connection', data: current };
      if (action === 'status') return { ok: true, stage: 'oddbout-connection', data: current };
      if (!['available', 'awaiting-approval'].includes(current.action.status))
        return { ok: false, stage: 'oddbout-connection', code: 'connection-not-ready', data: current };
      if (action === 'start') {
        if (current.action.status === 'available') {
          const project = await readProject(root);
          await start({ sessionPath, argv: ['--url', project.origin, '--key', project.publishableKey], page, log: () => {} });
        }
        // Repeated start returns the original public link, never a second request or device secret.
        return { ok: true, stage: 'oddbout-connection', data: await preview() };
      }
      if (action !== 'wait') throw new Error('invalid-connection-action');
      if (current.action.status !== 'awaiting-approval')
        return { ok: false, stage: 'oddbout-connection', code: 'connection-not-started', data: current };
      await preview(); // A pending file from another project must not be redeemed into this workspace.
      try { await wait({ sessionPath, timeoutSeconds: 0, log: () => {} }); }
      catch (error) {
        if (error.message === 'device-login-pending')
          return { ok: true, stage: 'oddbout-connection', data: { ...await preview(), retryAfterSeconds: error.retryAfterSeconds ?? 5 } };
        throw error;
      }
      // File existence is not account verification. Check the authenticated API after redemption.
      return { ok: true, stage: 'oddbout-connection', data: await status() };
    } catch (error) {
      const code = errorCode(error, 'connection-failed');
      return { ok: false, stage: 'oddbout-connection', code, data: { nextAction: connectionAction(code) } };
    } finally { busy = false; }
  };
}

export function registerConnectionTool(server, { respond, outputSchema, ...options }) {
  const handle = connectionHandler(options);
  server.registerTool('connect_oddbout', {
    description: 'Connect this workspace to the current user’s ODDBOUT account without shell commands or an MCP restart. '
      + 'Use start only when the user requested connection or registration. Give verificationUrl and userCode to the user; they sign in with Google and approve the matching code. '
      + 'Repeated start resumes the existing request. Use wait after approval; it checks once and returns immediately if still pending (respect retryAfterSeconds). '
      + 'status is read-only. Never open/approve the link on behalf of the user, request callback tokens, bypass a network block, or generate/upload anything to test access.',
    inputSchema: { action: z.enum(['status', 'start', 'wait']).default('status') }, outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async args => respond(await handle(args)));
}
