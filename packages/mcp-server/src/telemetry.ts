/**
 * Anonymous, count-only telemetry for @unihodl/mcp-server.
 *
 * What we send: an event name ("mcp_start"), the package version, and a
 * RANDOM instance id generated locally and cached in ~/.unihodl/instance.
 *
 * What we NEVER send: your API key, session ids, URLs, tabs, reasoning, any
 * session content, your username, machine name, or any other PII. The instance
 * id is not derived from your machine or account — delete the file and it
 * resets. Its only purpose is a distinct-install count.
 *
 * Opt out completely with either:
 *   UNIHODL_TELEMETRY=0   (or false/off/no)
 *   DO_NOT_TRACK=1        (the cross-tool standard)
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const TELEMETRY_URL =
  process.env.UNIHODL_TELEMETRY_URL ?? "https://www.unihodl.app/api/telemetry";

function optedOut(): boolean {
  const t = (process.env.UNIHODL_TELEMETRY ?? "").toLowerCase();
  if (t === "0" || t === "false" || t === "off" || t === "no") return true;
  if ((process.env.DO_NOT_TRACK ?? "") === "1") return true;
  return false;
}

function instanceId(): string {
  try {
    const file = join(homedir(), ".unihodl", "instance");
    try {
      const existing = readFileSync(file, "utf8").trim();
      if (existing) return existing;
    } catch {
      // not created yet — fall through and create it
    }
    mkdirSync(join(homedir(), ".unihodl"), { recursive: true });
    const id = randomUUID();
    writeFileSync(file, id, { mode: 0o600 });
    return id;
  } catch {
    return "anon";
  }
}

/**
 * Fire-and-forget. Never blocks startup, never throws, capped at 1.5s.
 * Safe to call before the MCP transport connects.
 */
export function recordEvent(event: string, version: string): void {
  if (optedOut()) return;
  try {
    const body = JSON.stringify({ event, version, instance: instanceId() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    void fetch(TELEMETRY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  } catch {
    // telemetry must never affect the server
  }
}
