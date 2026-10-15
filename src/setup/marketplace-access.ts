import { existsSync, readFileSync } from "node:fs";

/** How to reach a marketplace, from Claude Code's `plugins/known_marketplaces.json`. */
export type MarketplaceSource =
  | { kind: "missing" }
  | { kind: "git"; urls: string[] }
  | { kind: "http"; url: string }
  | { kind: "local"; path: string }
  | { kind: "unknown"; type: string };

/** The longest a single access check may take. */
export const ACCESS_TIMEOUT_MS = 10_000;

/**
 * Reads where a known marketplace comes from. A `github` source gives two git URLs, SSH and
 * HTTPS; the one Claude Code prefers (`CLAUDE_CODE_PLUGIN_PREFER_HTTPS`) comes first.
 */
export function marketplaceSource(
  knownMarketplacesFile: string,
  name: string,
  env: Record<string, string | undefined> = process.env,
): MarketplaceSource {
  if (!existsSync(knownMarketplacesFile)) return { kind: "missing" };
  let known: unknown;
  try {
    known = JSON.parse(readFileSync(knownMarketplacesFile, "utf8"));
  } catch {
    return { kind: "missing" };
  }
  const entry = (known as Record<string, { source?: Record<string, unknown> }> | null)?.[name];
  const source = entry?.source;
  if (!source || typeof source.source !== "string") return { kind: "missing" };

  const text = (key: string) => (typeof source[key] === "string" ? (source[key] as string) : null);
  switch (source.source) {
    case "github": {
      const repo = text("repo");
      if (!repo) return { kind: "unknown", type: "github without repo" };
      const ssh = `git@github.com:${repo}.git`;
      const https = `https://github.com/${repo}.git`;
      const preferHttps = Boolean(env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS);
      return { kind: "git", urls: preferHttps ? [https, ssh] : [ssh, https] };
    }
    case "git": {
      const url = text("url");
      return url ? { kind: "git", urls: [url] } : { kind: "unknown", type: "git without url" };
    }
    case "url": {
      const url = text("url");
      return url ? { kind: "http", url } : { kind: "unknown", type: "url without url" };
    }
    case "directory":
    case "file": {
      const path = text("path");
      return path
        ? { kind: "local", path }
        : { kind: "unknown", type: `${source.source} without path` };
    }
    default:
      return { kind: "unknown", type: source.source };
  }
}

/**
 * True when `git ls-remote` can read the repo: the same access Claude Code needs to update.
 * Never asks for a password (GIT_TERMINAL_PROMPT=0, ssh BatchMode), and gives up after the timeout.
 */
export function canReadGitRemote(url: string): { ok: boolean; detail: string } {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_SSH_COMMAND ??= "ssh -o BatchMode=yes -o ConnectTimeout=8";
  try {
    const result = Bun.spawnSync(["git", "ls-remote", url, "HEAD"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: ACCESS_TIMEOUT_MS,
    });
    if (result.exitCode === 0) return { ok: true, detail: "" };
    const lines = result.stderr.toString().trim().split("\n");
    const detail = result.signalCode ? "timed out" : (lines.at(-1) ?? "").trim();
    return { ok: false, detail: detail || `git exited with ${result.exitCode}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** True when an HTTP marketplace URL answers with a success status. */
export async function canReadHttp(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ACCESS_TIMEOUT_MS) });
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
