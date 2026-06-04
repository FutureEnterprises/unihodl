# @unihodl/mcp-server

MCP server for the **UNIHODL Agent Handoff SDK**.

Lets any MCP-capable agent (Claude Desktop, Cursor, Cline, Continue, …)
read UNIHODL sessions and resume human work mid-thought.

**Spec:** https://unihodl.app/sdk/spec
**Roadmap & open gaps:** https://unihodl.app/sdk/roadmap

## Install (Claude Desktop)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "unihodl": {
      "command": "npx",
      "args": ["-y", "@unihodl/mcp-server"],
      "env": {
        "UNIHODL_API_KEY": "uh_test_sandbox_demo_key_v0"
      }
    }
  }
}
```

Restart Claude Desktop. The `unihodl/resume` and `unihodl/list_sessions`
tools will appear in the tool palette.

## Tools

### `resume`

Resume a UNIHODL session — fetch the human's open tabs, scroll
positions, video timestamps, the AI-tagged decision thread, partial
conclusions, and intended next step.

```json
{
  "name": "resume",
  "arguments": {
    "session_id": "ses_8f3aZ91b",
    "format": "prompt-ready"
  }
}
```

### `list_sessions`

List recent UNIHODL sessions in the workspace. Useful when the agent
needs to discover what the human has been working on.

## Resources

`unihodl://session/{id}` — direct URI for any session in the workspace.

## Status

This is **v0.2.1** — public preview matching spec v1.0. Full session
indexing (`list_sessions`) and write-side mutations land in v1.1 —
see https://unihodl.app/sdk/roadmap.

## Telemetry

On startup the server sends a single **anonymous, count-only** ping so we can
measure active installs. It includes only: an event name (`mcp_start`), the
package version, and a random id cached in `~/.unihodl/instance` (not derived
from your machine or account — delete it and it resets).

It **never** sends your API key, session ids, URLs, tabs, reasoning, or any
other content or PII.

Opt out completely:

```bash
UNIHODL_TELEMETRY=0   # or DO_NOT_TRACK=1
```

## License

MIT
