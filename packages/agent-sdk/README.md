# @unihodl/agent-sdk

The TypeScript SDK for the **UNIHODL Agent Handoff SDK** — the
decision-continuity protocol for human-to-agent and agent-to-agent work
transfer.

Pass a UNIHODL resume token to any AI agent. The agent receives the
human's open tabs, scroll positions, video timestamps, AI-tagged
decision thread, partial conclusions, and intended next step — not just
a list of links. It can pick up the work mid-thought.

**Spec:** https://unihodl.app/sdk/spec
**Roadmap & open gaps:** https://unihodl.app/sdk/roadmap

## Install

```bash
npm install @unihodl/agent-sdk
# or
pnpm add @unihodl/agent-sdk
```

## Quickstart

```ts
import { Client } from "@unihodl/agent-sdk";
import Anthropic from "@anthropic-ai/sdk";

const uh = new Client({ apiKey: process.env.UNIHODL_API_KEY! });
const claude = new Anthropic();

// Hydrate the session into a structured Resume Context.
const ctx = await uh.sessions.hydrate("ses_8f3aZ91b", {
  audience: "claude.anthropic.com",
  scopes: ["read:context", "read:reasoning"],
});

const resp = await claude.messages.create({
  model: "claude-sonnet-4-7",
  max_tokens: 2048,
  system: ctx.asSystemPrompt(),
  messages: [
    { role: "user", content: "Continue Sarah's research on API v3." },
  ],
});
```

## API

### `new Client({ apiKey, baseUrl?, fetch? })`

Construct an SDK client. Send `uh_test_*` for sandbox or `uh_live_*`
for production.

### `client.resume_tokens.create({ session_id, audience, scopes, ... })`

Mint a scoped resume token bound to a session and audience. Returns
the signed JWT.

### `client.sessions.hydrate(sessionId, opts?)`

Hydrate a session into a `HydratedContext`. If `opts.token` is
omitted, the SDK mints a one-shot token first.

`HydratedContext.asSystemPrompt()` renders the prompt-ready text block
described in spec §6 — drop it directly into a Claude `system` prompt
or a Gemini `system_instruction`.

## Status

This is **v0.1.0** — public preview matching spec v1.0. Known gaps are
tracked publicly at https://unihodl.app/sdk/roadmap.

## License

MIT — see [LICENSE](./LICENSE).
