/**
 * @unihodl/agent-sdk — Agent Handoff SDK for UNIHODL
 *
 * The decision-continuity protocol for human-to-agent and agent-to-agent
 * work transfer. Pass a UNIHODL resume token to any AI agent and the agent
 * receives the human's open tabs, scroll positions, video timestamps,
 * AI-tagged decision thread, partial conclusions, and intended next step.
 *
 * Spec: https://unihodl.app/sdk/spec
 *
 * @example Quickstart
 *   import { Client } from "@unihodl/agent-sdk";
 *   import Anthropic from "@anthropic-ai/sdk";
 *
 *   const uh = new Client({ apiKey: process.env.UNIHODL_API_KEY! });
 *   const claude = new Anthropic();
 *
 *   const ctx = await uh.sessions.hydrate("ses_8f3aZ91b", {
 *     audience: "claude.anthropic.com",
 *     scopes: ["read:context", "read:reasoning"],
 *   });
 *
 *   const resp = await claude.messages.create({
 *     model: "claude-sonnet-4-7",
 *     max_tokens: 2048,
 *     system: ctx.asSystemPrompt(),
 *     messages: [{ role: "user", content: "Continue Sarah's research." }],
 *   });
 */

export const SDK_VERSION = "0.2.1";

const DEFAULT_BASE_URL = "https://www.unihodl.app/api";

export type Scope =
  | "read:context"
  | "read:reasoning"
  | "read:redacted"
  | "read:transcript"
  | "write:notes"
  | "write:next_step"
  | "session:hand_off";

export type ReasoningNodeKind =
  | "observation"
  | "partial_conclusion"
  | "decision_stance"
  | "blocker"
  | "question"
  | "next_step"
  | "reference";

export interface ReasoningNode {
  id: string;
  kind: ReasoningNodeKind;
  text: string;
  evidence?: string[];
  supports?: string[];
  depends_on?: string[];
  confidence?: number;
}

export interface ResumeTab {
  url: string;
  title: string;
  scroll_y_pct?: number;
  selected_text?: string;
  tab_role?: string;
}

export interface ResumeMedia {
  kind: "video" | "audio" | "image";
  url: string;
  timestamp_s?: number;
  transcript_anchor?: string;
}

export interface ResumeContext {
  session_id: string;
  version: string;
  captured_at: string;
  title: string;
  summary: string;
  tabs: ResumeTab[];
  media: ResumeMedia[];
  reasoning_thread: ReasoningNode[];
  ai_tags: string[];
  redactions: { field: string; reason: string }[];
}

export interface ClientOptions {
  /** API key starting with uh_test_ or uh_live_. */
  apiKey: string;
  /** Override the API base URL. Default: https://www.unihodl.app/api */
  baseUrl?: string;
  /** Custom fetch (e.g., for retries, telemetry). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface MintTokenInput {
  session_id: string;
  audience: string;
  scopes: Scope[];
  ttl_seconds?: number;
  max_hydrations?: number;
  redaction_policy?: string;
}

export interface MintTokenResult {
  token: string;
  jti: string;
  expires_at: string;
  audience: string;
  scopes: Scope[];
  session_id: string;
  mode: "sandbox" | "live";
}

export interface HydrateOptions {
  /** If omitted, the SDK mints a one-shot token using the API key. */
  token?: string;
  audience?: string;
  scopes?: Scope[];
  ttl_seconds?: number;
  /** "json" returns a HydratedContext object; "prompt-ready" returns text. */
  format?: "json" | "prompt-ready";
}

export class UnihodlError extends Error {
  code: string;
  status: number;
  audit_id?: string;
  hint?: string;
  constructor(opts: {
    code: string;
    status: number;
    message: string;
    audit_id?: string;
    hint?: string;
  }) {
    super(opts.message);
    this.name = "UnihodlError";
    this.code = opts.code;
    this.status = opts.status;
    this.audit_id = opts.audit_id;
    this.hint = opts.hint;
  }
}

export class HydratedContext {
  constructor(public readonly raw: ResumeContext) {}

  /**
   * Render the Resume Context as a structured natural-language block
   * suitable for direct injection as a system prompt.
   */
  asSystemPrompt(): string {
    // If the API already rendered prompt-ready text (hydrate with
    // format: "prompt-ready" returns text/x-unihodl-prompt), `raw` is that
    // string — return it as-is instead of re-formatting.
    if (typeof (this.raw as unknown) === "string") {
      return this.raw as unknown as string;
    }
    const ctx = this.raw;
    // Sections may be absent under scope filtering (e.g. a token without
    // read:reasoning omits reasoning_thread) — degrade gracefully.
    const thread = ctx.reasoning_thread ?? [];
    const tabs = ctx.tabs ?? [];
    const media = ctx.media ?? [];
    const lines: string[] = [];
    lines.push(
      `## CONTEXT (UNIHODL session ${ctx.session_id} · ${(ctx.captured_at ?? "").slice(0, 10)})\n`,
    );
    lines.push(`The user is researching: "${ctx.title}."\n`);

    const concl = thread.filter(
      (n) => n.kind === "observation" || n.kind === "partial_conclusion",
    );
    if (concl.length) {
      lines.push("What they have concluded:");
      for (const n of concl) {
        const conf =
          n.confidence !== undefined
            ? ` (confidence ${n.confidence.toFixed(2)})`
            : "";
        lines.push(`  • ${n.text}${conf}`);
      }
      lines.push("");
    }

    const stance = thread.find((n) => n.kind === "decision_stance");
    if (stance) {
      lines.push("Where they currently lean:");
      lines.push(`  → ${stance.text}\n`);
    }

    const blockers = thread.filter((n) => n.kind === "blocker");
    if (blockers.length) {
      lines.push("Open blockers:");
      for (const b of blockers) lines.push(`  ! ${b.text}`);
      lines.push("");
    }

    const next = thread.find((n) => n.kind === "next_step");
    if (next) {
      lines.push("Intended next step:");
      lines.push(`  → ${next.text}\n`);
    }

    if (tabs.length || media.length) {
      lines.push(
        `Sources they consulted (${tabs.length} tabs, ${media.length} video):`,
      );
      tabs.forEach((t, i) => {
        lines.push(`  [${i + 1}] ${t.url} — ${t.title}`);
      });
      media.forEach((m) => {
        lines.push(`  [v] ${m.url}`);
      });
      lines.push("");
    }

    lines.push("Continue from here.");
    return lines.join("\n");
  }

  /** Same as asSystemPrompt(); kept for snake-case parity with the Python SDK. */
  as_system_prompt(): string {
    return this.asSystemPrompt();
  }
}

class ResumeTokensApi {
  constructor(private readonly client: Client) {}

  async create(input: MintTokenInput): Promise<MintTokenResult> {
    return this.client.fetchJson("/v1/resume_tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /** Revoke a resume token before exp. Idempotent. */
  async revoke(
    jti: string,
    reason?: string,
  ): Promise<{ revoked: true; jti: string; reason: string | null }> {
    return this.client.fetchJson(
      `/v1/resume_tokens/${encodeURIComponent(jti)}/revoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
  }
}

class SessionsApi {
  constructor(private readonly client: Client) {}

  /**
   * Hydrate a session into a Resume Context. If `token` is omitted,
   * the SDK mints a one-shot resume token using the API key first.
   */
  async hydrate(
    sessionId: string,
    opts: HydrateOptions = {},
  ): Promise<HydratedContext> {
    let token = opts.token;
    if (!token) {
      const minted = await this.client.resume_tokens.create({
        session_id: sessionId,
        audience: opts.audience ?? "sdk.unihodl.app",
        scopes: opts.scopes ?? ["read:context", "read:reasoning"],
        ttl_seconds: opts.ttl_seconds ?? 600,
        max_hydrations: 1,
      });
      token = minted.token;
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    };
    if (opts.format === "prompt-ready") {
      headers["x-unihodl-format"] = "prompt-ready";
    }

    const ctx = await this.client.fetchJson<ResumeContext>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/hydrate`,
      { method: "POST", headers },
    );
    return new HydratedContext(ctx);
  }

  /**
   * List sessions in the API key's workspace, newest first.
   * Keyset-paginated: pass `cursor` from a previous result to fetch the
   * next page. Auth via API key. Returns metadata only.
   */
  async list(
    opts: { limit?: number; cursor?: string; since?: string } = {},
  ): Promise<{
    sessions: Array<{
      session_id: string;
      title: string;
      summary: string | null;
      captured_at: string;
      ai_tags: string[];
    }>;
    next_cursor: string | null;
  }> {
    const qs = new URLSearchParams();
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.since) qs.set("since", opts.since);
    const suffix = qs.size ? `?${qs.toString()}` : "";
    return this.client.fetchJson(`/v1/sessions${suffix}`, { method: "GET" });
  }

  /** Get session metadata. Auth via API key. Does not return content. */
  async get(sessionId: string): Promise<{
    session_id: string;
    workspace_id: string;
    title: string;
    summary: string | null;
    captured_at: string;
    ai_tags: string[];
    total_hydrations: number;
  }> {
    return this.client.fetchJson(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET" },
    );
  }

  /** Append an agent-authored note. Requires write:notes scope on the resume token. */
  async appendNote(
    sessionId: string,
    body: string,
    opts: { token: string },
  ): Promise<{ note_id: number; created_at: string }> {
    return this.client.fetchJson(
      `/v1/sessions/${encodeURIComponent(sessionId)}/notes`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body }),
      },
    );
  }

  /**
   * Transfer a session to another principal. Requires step-up auth — pass
   * the UNIX timestamp of the human's recent in-app confirmation.
   */
  async handoff(
    sessionId: string,
    input: {
      audience: string;
      scopes: Scope[];
      step_up_timestamp: number;
      ttl_seconds?: number;
      delegator_user_id?: string;
    },
  ): Promise<MintTokenResult & { handoff_url: string }> {
    return this.client.fetchJson(
      `/v1/sessions/${encodeURIComponent(sessionId)}/handoff`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-unihodl-stepup": String(input.step_up_timestamp),
        },
        body: JSON.stringify({
          audience: input.audience,
          scopes: input.scopes,
          ttl_seconds: input.ttl_seconds,
          delegator_user_id: input.delegator_user_id,
        }),
      },
    );
  }

  /**
   * Capture a session from a non-extension source (e.g., a CLI or VS Code
   * plugin pushing into the SDK directly).
   */
  async capture(payload: {
    session_id: string;
    title: string;
    summary?: string;
    tabs?: ResumeTab[];
    media?: ResumeMedia[];
    reasoning_thread?: ReasoningNode[];
    ai_tags?: string[];
  }): Promise<{ session_id: string; fingerprint: string; captured_at: string }> {
    return this.client.fetchJson("/v1/hodl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
}

export class Client {
  readonly resume_tokens: ResumeTokensApi;
  readonly sessions: SessionsApi;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) {
      throw new Error("@unihodl/agent-sdk: apiKey is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.resume_tokens = new ResumeTokensApi(this);
    this.sessions = new SessionsApi(this);
  }

  /** @internal */
  async fetchJson<T = unknown>(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      ...(init.headers ?? {}),
    };
    const resp = await this._fetch(`${this.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body,
    });

    if (!resp.ok) {
      let body: { error?: { code: string; message: string; audit_id?: string; hint?: string } } = {};
      try {
        body = await resp.json();
      } catch {
        // ignore; fall through to generic error
      }
      const err = body.error ?? {
        code: "http_error",
        message: `HTTP ${resp.status}`,
      };
      throw new UnihodlError({
        code: err.code,
        status: resp.status,
        message: err.message,
        audit_id: err.audit_id,
        hint: err.hint,
      });
    }

    const ct = resp.headers.get("content-type") ?? "";
    if (ct.includes("json")) {
      return (await resp.json()) as T;
    }
    return (await resp.text()) as unknown as T;
  }
}

/** Default export for `import unihodl from "@unihodl/agent-sdk"` ergonomics. */
export default Client;
