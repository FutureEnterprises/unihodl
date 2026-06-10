#!/usr/bin/env node
/**
 * @unihodl/mcp-server — Model Context Protocol server for UNIHODL.
 *
 * Lets any MCP-capable agent (Claude Desktop, Cursor, Cline, Continue,
 * etc.) read UNIHODL sessions and resume human work mid-thought.
 *
 * Install:
 *   npm install -g @unihodl/mcp-server
 *
 * Add to Claude Desktop config (~/Library/Application Support/Claude/
 * claude_desktop_config.json):
 *
 *   {
 *     "mcpServers": {
 *       "unihodl": {
 *         "command": "npx",
 *         "args": ["-y", "@unihodl/mcp-server"],
 *         "env": { "UNIHODL_API_KEY": "uh_test_sandbox_demo_key_v0" }
 *       }
 *     }
 *   }
 *
 * Tools advertised:
 *   - resume      — fetch a UNIHODL session as Resume Context
 *   - list_sessions — list recent sessions in the workspace
 *
 * Resources:
 *   - unihodl://session/{id} — direct session URI
 *
 * Spec: https://unihodl.app/sdk/spec#api
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, type Scope } from "@unihodl/agent-sdk";
import { recordEvent } from "./telemetry.js";

const SERVER_NAME = "unihodl";
const SERVER_VERSION = "0.2.3";

const apiKey = process.env.UNIHODL_API_KEY;
if (!apiKey) {
  // Stderr only — stdout is reserved for MCP framing.
  console.error(
    "[unihodl/mcp-server] UNIHODL_API_KEY env not set. " +
      "Configure in your MCP client's env block. " +
      "Sandbox key: uh_test_sandbox_demo_key_v0",
  );
  process.exit(1);
}

const baseUrl = process.env.UNIHODL_API_URL ?? "https://www.unihodl.app/api";
const audience = process.env.UNIHODL_AUDIENCE ?? "mcp.unihodl.app";

const uh = new Client({ apiKey, baseUrl });

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {}, resources: {} } },
);

// ── Tools ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "resume",
      description:
        "Fetch a UNIHODL session as Resume Context — the human's open tabs, " +
        "scroll positions, video timestamps, AI-tagged decision thread, " +
        "partial conclusions, and intended next step. Read-only and " +
        "idempotent: it never modifies the session. Use it when you have a " +
        "session_id (from list_sessions or the user) and need the human's " +
        "working context before continuing their task; to discover sessions " +
        "instead, use list_sessions. Returns a prompt-ready text block by " +
        "default, or the raw Resume Context object with format 'json'. " +
        "Errors: a malformed session_id is rejected before any network " +
        "call; an unknown, expired, or revoked session returns an error " +
        "message stating the reason.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            pattern: "^ses_[A-Za-z0-9]+$",
            description:
              "UNIHODL session id in the form ses_<alphanumeric>, e.g. " +
              "'ses_8f3aZ91b'. Obtain one from list_sessions or from the " +
              "user. Ids that do not match the pattern are rejected " +
              "without a network call.",
          },
          format: {
            type: "string",
            enum: ["prompt-ready", "json"],
            default: "prompt-ready",
            description:
              "'prompt-ready' (default): a structured natural-language " +
              "block ready to inject directly into model context. " +
              "'json': the raw Resume Context object for programmatic " +
              "use (schema: https://www.unihodl.app/sdk/spec).",
          },
        },
        required: ["session_id"],
        additionalProperties: false,
      },
      annotations: {
        title: "Resume a UNIHODL session",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    {
      name: "list_sessions",
      description:
        "List sessions in the workspace the configured API key can read, " +
        "newest first, with cursor pagination. Read-only, no side effects. " +
        "Returns {sessions: [{session_id, title, summary, captured_at, " +
        "ai_tags}], next_cursor}. Pass any session_id to the resume tool " +
        "for the full context; pass next_cursor back as `cursor` to fetch " +
        "the next page (null means no more pages). Use this to discover " +
        "what the human was working on when you do not already have a " +
        "session_id — if you have one, call resume directly. Sandbox keys " +
        "see the demo workspace. Errors: a malformed cursor or since value " +
        "returns an error stating the expected format.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            minimum: 1,
            maximum: 50,
            default: 10,
            description:
              "Maximum number of sessions to return, between 1 and 50. " +
              "Values outside the range are clamped rather than rejected.",
          },
          cursor: {
            type: "string",
            description:
              "Opaque pagination cursor from a previous response's " +
              "next_cursor. Omit to start from the newest session. " +
              "Malformed cursors are rejected with an error.",
          },
          since: {
            type: "string",
            format: "date-time",
            description:
              "Only return sessions captured at or after this ISO 8601 " +
              "timestamp, e.g. '2026-06-01T00:00:00Z'.",
          },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          sessions: {
            type: "array",
            description: "Sessions, newest first.",
            items: {
              type: "object",
              properties: {
                session_id: { type: "string" },
                title: { type: "string" },
                summary: { type: ["string", "null"] },
                captured_at: { type: "string", format: "date-time" },
                ai_tags: { type: "array", items: { type: "string" } },
              },
              required: ["session_id", "title", "captured_at"],
            },
          },
          next_cursor: {
            type: ["string", "null"],
            description:
              "Pass back as `cursor` to fetch the next page; null when " +
              "there are no more pages.",
          },
        },
        required: ["sessions", "next_cursor"],
      },
      annotations: {
        title: "List UNIHODL sessions",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "resume") {
    const sessionId = (args?.session_id ?? "") as string;
    if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) {
      return {
        content: [
          {
            type: "text",
            text: "Error: session_id must match ^ses_[A-Za-z0-9]+$.",
          },
        ],
        isError: true,
      };
    }

    const scopes: Scope[] = ["read:context", "read:reasoning"];
    const fmt = (args?.format ?? "prompt-ready") as "json" | "prompt-ready";

    try {
      const ctx = await uh.sessions.hydrate(sessionId, {
        audience,
        scopes,
        format: fmt,
      });
      if (fmt === "prompt-ready") {
        return {
          content: [{ type: "text", text: ctx.asSystemPrompt() }],
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(ctx.raw, null, 2) },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text", text: `UNIHODL error: ${msg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "list_sessions") {
    const rawLimit = Number(args?.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(50, Math.trunc(rawLimit)))
      : 10;
    const cursor =
      typeof args?.cursor === "string" && args.cursor ? args.cursor : undefined;
    const since =
      typeof args?.since === "string" && args.since ? args.since : undefined;
    try {
      const result = await uh.sessions.list({ limit, cursor, since });
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `UNIHODL error: ${msg}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ── Resources ────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "unihodl://session/ses_8f3aZ91b",
      name: "Demo session — GraphQL migration",
      description: "Sandbox session showing the full Resume Context shape.",
      mimeType: "application/vnd.unihodl.context+json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  const m = uri.match(/^unihodl:\/\/session\/(ses_[A-Za-z0-9]+)$/);
  if (!m) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }
  const ctx = await uh.sessions.hydrate(m[1], {
    audience,
    scopes: ["read:context", "read:reasoning"],
    format: "json",
  });
  return {
    contents: [
      {
        uri,
        mimeType: "application/vnd.unihodl.context+json",
        text: JSON.stringify(ctx.raw, null, 2),
      },
    ],
  };
});

// ── Wire it up ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

// Anonymous, count-only install ping. No PII, no keys, no session data.
// Opt out: UNIHODL_TELEMETRY=0 or DO_NOT_TRACK=1. See telemetry.ts.
recordEvent("mcp_start", SERVER_VERSION);

console.error(
  `[unihodl/mcp-server] v${SERVER_VERSION} ready on stdio (audience=${audience})`,
);
