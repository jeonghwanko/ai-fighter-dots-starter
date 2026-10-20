import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { apiRequest, createRemoteClient, validProjectUrl } from '../api/client.mjs';
import { readPrivateConfig, createPrivateConfig } from '../api/private-config.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
export async function startConnection(configPath, { url, permissions = ['fighter:read'] } = {}) {
  if (!validProjectUrl(url)) throw new Error('invalid-project-url');
  let config;
  try {
    config = await readPrivateConfig(configPath);
    if (config.kind !== 'agent-connection' || config.url !== url || !config.requestId || !config.code
      || JSON.stringify(config.requested) !== JSON.stringify(permissions)) throw new Error('connection-config-conflict');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = { kind: 'agent-connection', url, clientId: 'ai-fighter-stdio', resource: `${url}/functions/v1/ai-fighter`,
      agentToken: `afg_${randomBytes(32).toString('hex')}`, code: randomBytes(16).toString('hex'), requestId: randomUUID(), requested: permissions };
    // Persist before sending so a lost response retries the same request and credential.
    await createPrivateConfig(configPath, config);
  }
  const result = await apiRequest(url, config.agentToken, 'connections/start', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: config.requestId,
      clientId: config.clientId, tokenHash: digest(config.agentToken), codeHash: digest(config.code), permissions: config.requested }) });
  return { ...result, code: config.code };
}
export async function connectionCommand(configPath, command) {
  if (!['status', 'cancel'].includes(command)) throw new Error('invalid-connection-command');
  const remote = await createRemoteClient(configPath);
  return remote.request(`connections/${command}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
}
