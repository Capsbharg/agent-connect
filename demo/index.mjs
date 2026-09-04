import { AgentConnect } from '@capsbharg/agent-connect';
import { ConsoleAdapter } from './consoleAdapter.mjs';
import { EchoAgent } from './echoAgent.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const consoleAdapter = new ConsoleAdapter();

const app = new AgentConnect({
  messaging: [consoleAdapter],
  agents: [new EchoAgent()],
  projectsConfigPath: new URL('./projects.json', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  ),
});

await app.start();
console.log(
  '=== AgentConnect demo started (console adapter, in-memory queue/storage, echo agent) ===',
);

await consoleAdapter.simulateMessage('help');
await consoleAdapter.simulateMessage('projects');
await consoleAdapter.simulateMessage('use demo');
await consoleAdapter.simulateMessage('current');
await consoleAdapter.simulateMessage('Implement JWT authentication');
await sleep(1000);
await consoleAdapter.simulateMessage('status');

await sleep(300);
await app.stop();
console.log('\n=== demo finished, AgentConnect stopped ===');
