import { startConnection, connectionCommand } from '../auth/agent-connection.mjs';

const [command, configPath, url, permission = 'read'] = process.argv.slice(2);
try {
  if (!configPath || !['start', 'status', 'cancel'].includes(command) || !['read', 'submit'].includes(permission))
    throw new Error('usage: npm run connect -- start|status|cancel /private/agent.json [https://PROJECT.supabase.co] [read|submit]');
  const result = command === 'start' ? await startConnection(configPath, {
    url, permissions: permission === 'submit' ? ['fighter:read', 'fighter:submit'] : ['fighter:read'],
  }) : await connectionCommand(configPath, command);
  // Pairing code is for the human, not a bearer credential. Never print the agent token.
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(/^[a-z0-9-]+$/.test(error.message) || error.message.startsWith('usage:') ? error.message : 'connection-command-failed');
  process.exitCode = 1;
}
