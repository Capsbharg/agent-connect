# Slack + Claude (minimal)

The smallest possible `agent-connect` app: Slack in, Claude Code out. Six lines, all configuration lives in `.env`.

## Run it

From the repository root, build the package once:

```bash
npm install
npm run build
```

Then, from this directory:

```bash
npm install
cp ../../.env.example .env              # fill in SLACK_* and (optionally) CLAUDE_* values
cp ../../projects.example.json projects.json   # point at a real project directory
npm start
```

Mention the bot in Slack (or DM it), run `use <project>`, then give it a task — see the repo root README's [Example Walkthrough](../../README.md#example-walkthrough).
