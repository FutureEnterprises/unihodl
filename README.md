# UNIHODL — Agent Handoff SDK & MCP Server

**The handoff layer for the agentic web.** Capture a human's working session —
open tabs, scroll positions, video timestamps, and reasoning thread — and hand it
to any AI agent as a **signed, scoped, revocable Resume Token**. Your agent picks
up exactly where the human left off instead of starting cold.

This is the open-source SDK + MCP server + protocol spec. The browser extension,
web app, and product live separately at **[unihodl.app](https://www.unihodl.app)**.

```bash
# Zero-setup demo — no signup, sandbox key, real API:
npx -y @unihodl/mcp-server
#   env: UNIHODL_API_KEY=uh_test_sandbox_demo_key_v0
# then ask your agent:  resume ses_8f3aZ91b
```

## What's here

| Package | What it is | Install |
|---|---|---|
| [`@unihodl/mcp-server`](packages/mcp-server) | MCP server — gives Claude Desktop, Cursor, Cline, etc. a `resume` tool | `npx -y @unihodl/mcp-server` |
| [`@unihodl/agent-sdk`](packages/agent-sdk) | TypeScript client — mint tokens, hydrate sessions | `npm i @unihodl/agent-sdk` |
| [`unihodl-agent`](packages/agent-sdk-py) | Python client | `pip install unihodl-agent` |
| [`RFC.md`](RFC.md) | The open Resume Token protocol spec | — |

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "unihodl": {
      "command": "npx",
      "args": ["-y", "@unihodl/mcp-server"],
      "env": { "UNIHODL_API_KEY": "uh_test_sandbox_demo_key_v0" }
    }
  }
}
```

Restart Claude. The `resume` and `list_sessions` tools appear. Ask it to
`resume ses_8f3aZ91b` and it receives the human's conclusions, open blockers, and
intended next step — then continues the work.

## Why it exists

Agent memory is well-funded, but it standardizes *agent-generated* memory. Nothing
standardizes the **human's live working context** crossing into an agent — the 15
tabs, the half-formed decision, the thing you were about to do next. That handoff
is the protocol. See **[RFC.md](RFC.md)** for the token design (EdDSA-signed,
scope-filtered, TTL-capped, revocable, audited).

We're proposing Resume Tokens as an **open standard** — issues and PRs welcome.
The goal is for every agent framework to accept a Resume Token, the way every
framework now speaks MCP.

## Get a live key

Free for 10,000 hydrations/month at **[unihodl.app/developers](https://www.unihodl.app/developers)**.
Verify your key against the live API: `https://www.unihodl.app/.well-known/jwks.json`.

## License

MIT — see [LICENSE](LICENSE).
