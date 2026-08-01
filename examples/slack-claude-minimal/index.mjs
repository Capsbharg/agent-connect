import { AgentConnect } from '@capsbharg/agent-connect';

// Reads everything (which platforms/agents to enable, Redis vs in-memory,
// security allowlists) from environment variables — see .env.example at the
// repo root, or run `npx @capsbharg/agent-connect init` to generate one interactively.
const app = AgentConnect.fromEnv();

process.on('SIGINT', () => void app.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void app.stop().then(() => process.exit(0)));

await app.start();
