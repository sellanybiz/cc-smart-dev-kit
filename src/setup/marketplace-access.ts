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

/** The ssh command doctor uses when the user has none of their own: never asks, gives up soon. */
export const BATCH_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=8";

/** Schemes whose user part may be a token (`https://<token>@host/…`), so all of it is hidden. */
const TOKEN_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);

/**
 * A URL that is safe to print: no password or token, no query string.
 * - `https://user:pass@host/x` and `https://token@host/x` → `https://***@host/x`
 * - `ssh://git:pass@host/x` → `ssh://git:***@host/x` (an ssh user name alone is kept)
 * - `…?token=abc` → `…?***`
 * An scp-like address (`git@host:org/repo.git`) has a user name only, and is kept.
 */
export function redactUrl(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/is.exec(url);
  let result = url;
  if (match) {
    const [, scheme = "", authority = "", rest = ""] = match;
    const at = authority.lastIndexOf("@");
    if (at >= 0) {
      const userinfo = authority.slice(0, at);
      const host = authority.slice(at + 1);
      const colon = userinfo.indexOf(":");
      const safeUser = TOKEN_SCHEMES.has(scheme.toLowerCase())
        ? "***"
        : colon >= 0
          ? `${userinfo.slice(0, colon)}:***`
          : userinfo;
      result = `${scheme}://${safeUser}@${host}${rest}`;
    }
  }
  const query = result.indexOf("?");
  return query >= 0 ? `${result.slice(0, query)}?***` : result;
}

/** `text` with every URL in it redacted (redactUrl), for a line from git or a server. */
export function redactUrlsIn(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, (url) => redactUrl(url));
}

/** True when the user has an ssh command of their own: GIT_SSH_COMMAND, GIT_SSH or core.sshCommand. */
export function hasOwnSshCommand(env: Record<string, string | undefined>): boolean {
  if (env.GIT_SSH_COMMAND || env.GIT_SSH) return true;
  try {
    const result = Bun.spawnSync(["git", "config", "--get", "core.sshCommand"], {
      env,
      stdout: "pipe",
      stderr: "ignore",
      timeout: ACCESS_TIMEOUT_MS,
    });
    return result.exitCode === 0 && result.stdout.toString().trim() !== "";
  } catch {
    return false;
  }
}

/**
 * True when `git ls-remote` can read the repo: the same access Claude Code needs to update.
 * Never asks for a password (GIT_TERMINAL_PROMPT=0), and gives up after the timeout.
 * Ssh BatchMode is added only when the user has no ssh command of their own: GIT_SSH_COMMAND
 * wins over core.sshCommand, so setting it would hide the one their access needs.
 * The detail is redacted: it never shows a password or token.
 */
export function canReadGitRemote(
  url: string,
  baseEnv: Record<string, string | undefined> = process.env,
): { ok: boolean; detail: string } {
  const env: Record<string, string | undefined> = { ...baseEnv, GIT_TERMINAL_PROMPT: "0" };
  if (!hasOwnSshCommand(env)) env.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  try {
    const result = Bun.spawnSync(["git", "ls-remote", url, "HEAD"], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: ACCESS_TIMEOUT_MS,
    });
    if (result.exitCode === 0) return { ok: true, detail: "" };
    const lines = result.stderr.toString().trim().split("\n");
    const detail = result.signalCode ? "timed out" : (lines.at(-1) ?? "").trim();
    return { ok: false, detail: redactUrlsIn(detail) || `git exited with ${result.exitCode}` };
  } catch (error) {
    return {
      ok: false,
      detail: redactUrlsIn(error instanceof Error ? error.message : String(error)),
    };
  }
}

/** True when an HTTP marketplace URL answers with a success status. The detail is redacted. */
export async function canReadHttp(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ACCESS_TIMEOUT_MS) });
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: redactUrlsIn(error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Where Claude Code keeps its local copy of a marketplace (`installLocation` in
 * known_marketplaces.json), or null when it is not recorded.
 */
export function marketplaceInstallLocation(
  knownMarketplacesFile: string,
  name: string,
): string | null {
  if (!existsSync(knownMarketplacesFile)) return null;
  try {
    const known = JSON.parse(readFileSync(knownMarketplacesFile, "utf8")) as Record<
      string,
      { installLocation?: unknown } | null
    > | null;
    const location = known?.[name]?.installLocation;
    return typeof location === "string" && location !== "" ? location : null;
  } catch {
    return null;
  }
}
