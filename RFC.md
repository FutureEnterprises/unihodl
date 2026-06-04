# RFC 0001 — Resume Tokens: a protocol for human→agent context handoff

**Status:** Draft · **Version:** 0.1 · **License:** CC BY 4.0 (spec) / MIT (reference impl)
**Discussion:** https://github.com/FutureEnterprises/unihodl-sdk/issues

> A Resume Token is a signed, scoped, revocable, audited bearer of a *human's*
> working context — the tabs, scroll positions, media timestamps, and reasoning
> thread they had in their head — so an AI agent (or a teammate, or their future
> self) can resume mid-thought instead of starting cold.

The agent-memory category is well-funded but it standardizes *agent-generated*
memory. Nothing standardizes the **human's live working context** crossing into
an agent. That handoff is the gap this RFC fills. MCP standardized transport;
Resume Tokens standardize the *human-context payload* that rides it.

---

## 1. Goals

1. **Portable.** One token hydrates the same context into any agent (Claude,
   ChatGPT, Gemini, Cursor, LangGraph, …) or any human.
2. **Safe by construction.** Scoped, time-boxed, hydration-capped, revocable, and
   redacted server-side *before* an agent ever sees a byte it isn't entitled to.
3. **Auditable.** Every mint / hydrate / revoke / handoff is an immutable record.
4. **Boring crypto.** Asymmetric signatures, public JWKS, no bespoke primitives.

Non-goals: replacing MCP (we ride it), agent-to-agent memory (Mem0/Letta/Cognee
own that), or storing model state.

## 2. The token

A Resume Token is a JWT signed with **EdDSA (Ed25519)**. The public key is
published at `/.well-known/jwks.json` so any party can verify offline.

```jsonc
{
  "iss": "https://unihodl.app",
  "sub": "wks_<workspace>:usr_<user>",   // delegator principal
  "aud": "claude.anthropic.com",          // the single intended agent/audience
  "jti": "rt_…",                          // unique id — the revocation handle
  "iat": 1780000000,
  "nbf": 1780000000,
  "exp": 1780000600,                      // TTL-capped (default 1h, max 24h)
  "scope": ["read:context", "read:reasoning"],
  "session_id": "ses_…",                  // the context this token unlocks
  "redaction_policy": "default-strict",
  "max_hydrations": 5,                     // defense-in-depth replay cap
  "delegator": null,                       // set on a human→human handoff
  "nonce": null                            // present iff a write scope is granted
}
```

### 2.1 Scopes

| Scope | Grants |
|---|---|
| `read:context` | tabs, media, ai_tags |
| `read:reasoning` | the reasoning thread (observations, stance, blockers, next step) |
| `read:transcript` | media transcript anchors |
| `read:redacted` | fields the policy would otherwise strip (audited) |
| `write:notes` | append an agent-authored note |
| `write:next_step` | propose the next step back to the human |
| `session:hand_off` | mint a downstream token (delegation) |

A hydrate **must** carry `read:context` or `read:reasoning`. Scope determines
the payload slice: `read:context`-only strips reasoning; `read:reasoning`-only
strips tabs/media. The agent never receives what it didn't ask for.

## 3. Lifecycle

```
mint ──► hydrate (×N ≤ max_hydrations, until exp) ──► revoke
                  │
                  └─ every call: signature ✓ → not-revoked ✓ → audience ✓ →
                     scope ✓ → rate-limit ✓ → redact → audit-log → return
```

- **Mint** `POST /v1/resume_tokens` (auth: API key). Verifies the session
  belongs to the workspace, then signs.
- **Hydrate** `POST /v1/sessions/{id}/hydrate` (auth: the resume token). Returns
  the `ResumeContext` as JSON or `prompt-ready` text.
- **Revoke** `POST /v1/resume_tokens/{jti}/revoke` (auth: API key). Idempotent;
  adds `jti` to a revocation list checked on every hydrate.
- **Handoff** `POST /v1/sessions/{id}/handoff` — mints a downstream token for a
  new audience; requires step-up confirmation from the human.

## 4. The payload — `ResumeContext`

```ts
interface ResumeContext {
  session_id: string;
  version: string;
  captured_at: string;       // ISO 8601
  title: string;
  summary: string;
  tabs: { url; title; scroll_y_pct?; selected_text?; tab_role? }[];
  media: { kind: "video"|"audio"|"image"; url; timestamp_s?; transcript_anchor? }[];
  reasoning_thread: {
    id; kind: "observation"|"partial_conclusion"|"decision_stance"|
              "blocker"|"question"|"next_step"|"reference";
    text; evidence?; supports?; depends_on?; confidence?;
  }[];
  ai_tags: string[];
  redactions: { field; reason }[];   // what was withheld, and why
}
```

`prompt-ready` format renders this as a structured natural-language system
prompt ("What they concluded / Where they lean / Open blockers / Intended next
step / Sources") — drop-in for any model's system slot.

## 5. Security model

- **Redaction is server-side and pre-serialization.** A policy strips sensitive
  fields before the response is built; the agent cannot request around it
  without an audited `read:redacted` scope.
- **Replay-bounded:** `max_hydrations` + `exp` + the revocation list.
- **Single-audience:** `aud` binds a token to one agent; cross-audience reuse
  fails verification.
- **No key in the client:** hydration auth is the short-lived resume token, not
  the long-lived API key.
- **Every access is a record** (`jti`, audience, scopes, fields removed,
  payload fingerprint) — never the unredacted body.

## 6. Reference implementation

- `@unihodl/agent-sdk` (TypeScript) and `unihodl-agent` (Python) — clients.
- `@unihodl/mcp-server` — exposes `resume` / `list_sessions` to any MCP agent.
- Live JWKS: `https://www.unihodl.app/.well-known/jwks.json`
- Zero-setup sandbox: `npx -y @unihodl/mcp-server` with
  `UNIHODL_API_KEY=uh_test_sandbox_demo_key_v0`, then `resume ses_8f3aZ91b`.

## 7. Open questions (for discussion)

1. Should `aud` support multiple audiences for fan-out handoffs?
2. A standard `revocation_endpoint` discovery doc (à la OAuth) for cross-vendor revoke?
3. A content-addressed `session_id` so identical context dedupes across providers?
4. Should `reasoning_thread` adopt an existing argumentation schema (e.g. AIF)?

We're proposing this as an open standard, not a moat. Issues and PRs welcome —
the goal is for *every* agent framework to accept a Resume Token, the way every
framework now speaks MCP.
