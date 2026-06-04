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
const SERVER_VERSION = "0.2.1";

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
        "Resume a UNIHODL session — fetch the human's open tabs, scroll " +
        "positions, video timestamps, the AI-tagged decision thread, " +
        "partial conclusions, and intended next step. Returns the full " +
        "Resume Context. Call this before any other tool when given a " +
        "session_id.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            pattern: "^ses_[A-Za-z0-9]+$",
            description: "The UNIHODL session id (e.g., ses_8f3aZ91b).",
          },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: ["tabs", "media", "reasoning_thread", "ai_tags"],
            },
            description:
              "Which sections of the Resume Context to include. " +
              "Default: all.",
          },
          format: {
            type: "string",
            enum: ["json", "prompt-ready"],
            description:
              "Wire format. 'prompt-ready' returns a structured " +
              "natural-language block. 'json' returns the raw " +
              "Resume Context.",
          },
        },
        required: ["session_id"],
      },
    },
    {
      name: "list_sessions",
      description:
        "List recent UNIHODL sessions in the current workspace. " +
        "Useful when the agent needs to discover what the human has " +
        "been working on without a specific session_id.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            minimum: 1,
            maximum: 50,
            description: "Max sessions to return. Default 10.",
          },
        },
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

    const includeRaw = args?.include as string[] | undefined;
    const scopes: Scope[] = ["read:context", "read:reasoning"];
    if (includeRaw?.includes("ai_tags")) {
      // ai_tags ride along with read:context
    }
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
    // v0 sandbox stub: returns the canned demo session. Live listing
    // lands in v1.1 once /v1/sessions index endpoint is wired.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessions: [
                {
                  session_id: "ses_8f3aZ91b",
                  title: "GraphQL migration for API v3",
                  captured_at: "2026-05-05T22:14:08Z",
                },
              ],
              note: "Live session listing lands in v1.1. See https://unihodl.app/sdk/roadmap.",
            },
            null,
            2,
          ),
        },
      ],
    };
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
