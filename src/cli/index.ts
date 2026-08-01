import 'dotenv/config';
import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';

function printHelp(): void {
  console.log(`
agent-connect — universal middleware between messaging platforms and AI coding agents

Usage:
  agent-connect init      Interactively scaffold .env, projects.json, and an example app
  agent-connect doctor    Check installed agent CLIs, Redis connectivity, and platform tokens
  agent-connect --help    Show this message
`);
}

async function main(): Promise<void> {
  const [, , command] = process.argv;

  switch (command) {
    case 'init':
      await runInit();
      return;
    case 'doctor':
      await runDoctor();
      return;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      return;
    default:
      console.error(`Unknown command "${command}". Run "agent-connect --help" for usage.`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
