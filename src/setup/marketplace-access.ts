import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * How to reach a marketplace, from Claude Code's `plugins/known_marketplaces.json`. A git
 * source may name a `ref` (a branch or tag) that Claude Code follows instead of the
 * default branch.
 */
export type MarketplaceSource =
  | { kind: "missing" }
  | { kind: "git"; ref?: string; urls: string[] }
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
  const ref = text("ref");
  const withRef = ref ? { ref } : {};
  switch (source.source) {
    case "github": {
      const repo = text("repo");
      if (!repo) return { kind: "unknown", type: "github without repo" };
      const ssh = `git@github.com:${repo}.git`;
      const https = `https://github.com/${repo}.git`;
      const preferHttps = Boolean(env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS);
      return { kind: "git", urls: preferHttps ? [https, ssh] : [ssh, https], ...withRef };
    }
    case "git": {
      const url = text("url");
      return url
        ? { kind: "git", urls: [url], ...withRef }
        : { kind: "unknown", type: "git without url" };
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

/**
 * The words that name the first cause below, where the fix is the HTTPS form of the same
 * marketplace. The two installers carry the same sentence in their own lines (install.sh's
 * `failed`, install.ps1's `Stop-Failed`): a shell script cannot import this file, so
 * `scripts/install.test.ts` keeps the three in step.
 */
export const SSH_REFUSED_WORDS = "SSH to GitHub was refused";

/**
 * The two lines that finish a repository the GitHub account cannot read. `%s` is
 * `<owner>/<repo>`: each installer carries the same lines with its own spelling of the
 * repository in that place, and `scripts/install.test.ts` keeps the three in step.
 */
export const REPO_ACCESS_FIX_LINES = [
  "ask the repository's owner for read access",
  "accept the invitation at https://github.com/%s/invitations",
] as const;

/** The two fix lines with the repository in them (`scripts/install.test.ts` reads the two above). */
export function repoAccessFixLines(repo: string): string[] {
  return REPO_ACCESS_FIX_LINES.map((line) => line.replace("%s", repo));
}

/**
 * Which of the two causes a failed marketplace read names, when its own words say so. Both
 * were seen live on 2026-10-17, while two team machines were moved:
 * - `ssh-refused`: ssh to GitHub was refused — no SSH key on the machine, or port 22 blocked.
 *   The same marketplace adds fine over HTTPS.
 * - `cannot-see`: the GitHub account may not read the repository — a private repository and no
 *   invitation. No retry helps until its owner grants access.
 * Anything else is `unknown`, and the caller keeps the words it always had.
 */
export type GitFailureCause = "ssh-refused" | "cannot-see" | "unknown";

export function gitFailureCause(detail: string): GitFailureCause {
  if (/permission denied \(publickey\)|host key verification failed/i.test(detail)) {
    return "ssh-refused";
  }
  // git's own summary line follows either failure. A repository the account cannot see prints
  // it too, and "Repository not found" beside it is access, not ssh.
  if (/could not read from remote repository/i.test(detail)) {
    return /repository not found/i.test(detail) ? "cannot-see" : "ssh-refused";
  }
  if (/repository not found|could not resolve to a repository/i.test(detail)) return "cannot-see";
  return "unknown";
}

/**
 * `<owner>/<repo>` for a GitHub git URL — the scp-like form (`git@github.com:o/r.git`) or an
 * `ssh://` / `https://` one, with or without user info before the host. Null for any other URL, and then a fix cannot name the repository.
 */
export function githubRepoInUrl(url: string): string | null {
  // The user info before the host (`https://user@…`, `https://x-access-token:<token>@…`) is
  // skipped and never returned: it may hold a credential.
  const match =
    /^(?:git@github\.com[:/]|(?:ssh|https?):\/\/(?:[^/\s]+@)?github\.com[:/])(.+?)\/*$/i.exec(url);
  if (!match?.[1]) return null;
  const repo = match[1].replace(/\.git$/, "");
  return /^[^/]+\/[^/]+$/.test(repo) ? repo : null;
}

/**
 * What to do about a marketplace that cannot be read, for one of the two causes a person can
 * act on. Empty for `unknown`: the caller keeps its own words. `repo` is `<owner>/<repo>` when
 * the marketplace's source names one, and null when it does not (a `git` source on another
 * host, say).
 *
 * The fix lines are the installers' own words (see `REPO_ACCESS_FIX_LINES`).
 */
export function marketplaceAccessAdvice(cause: GitFailureCause, repo: string | null): string {
  if (cause === "ssh-refused") {
    return repo === null
      ? `${SSH_REFUSED_WORDS}: check your SSH key for that host, or add the marketplace over an HTTPS URL.`
      : `${SSH_REFUSED_WORDS}: add the marketplace over HTTPS instead. ` +
          `Run: claude plugin marketplace add https://github.com/${repo}.git`;
  }
  if (cause === "cannot-see") {
    const lines = repo === null ? [REPO_ACCESS_FIX_LINES[0]] : repoAccessFixLines(repo);
    return `The GitHub account cannot read the repository: ${lines.join(", then ")}.`;
  }
  return "";
}

/** Schemes whose user part may be a token (`https://<token>@host/…`), so all of it is hidden. */
export const TOKEN_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);

/**
 * A URL that is safe to print: no password or token, no query string, no fragment.
 * - `https://user:pass@host/x` and `https://token@host/x` → `https://***@host/x`
 * - `ssh://git:pass@host/x` → `ssh://git:***@host/x` (an ssh user name alone is kept)
 * - `…?token=abc` → `…?***`
 * - `…/mcp#token=abc` → `…/mcp` (a fragment is dropped: a token put there is worth hiding too)
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
  const hash = result.indexOf("#");
  if (hash >= 0) result = result.slice(0, hash);
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

/** A git read that failed: `detail` is its last line, `output` everything it said (both redacted). */
export interface GitReadFailure {
  detail: string;
  ok: false;
  output: string;
}

/**
 * True when `git ls-remote` can read the repo: the same access Claude Code needs to update.
 * Never asks for a password (GIT_TERMINAL_PROMPT=0), and gives up after the timeout.
 * Ssh BatchMode is added only when the user has no ssh command of their own: GIT_SSH_COMMAND
 * wins over core.sshCommand, so setting it would hide the one their access needs.
 * The detail and the output are redacted: neither ever shows a password or token.
 *
 * `detail` is git's LAST line — what a one-line message prints. `output` is the whole of what
 * git said, because the line that names the failure ("Permission denied (publickey)", "Repository
 * not found") is usually ABOVE the last one: `gitFailureCause` reads it (live, 2026-10-17).
 */
export function canReadGitRemote(
  url: string,
  baseEnv: Record<string, string | undefined> = process.env,
): { ok: true; detail: "" } | GitReadFailure {
  const result = lsRemote(url, "HEAD", baseEnv);
  return result.ok ? { ok: true, detail: "" } : result;
}

/**
 * `canReadGitRemote`, awaited: the same question, the same words, spawned with `Bun.spawn`.
 * The portal's doctor pass asks it on every Machine page load (`canReadGitRemote` is
 * `Bun.spawnSync`), and `git ls-remote` waits for a remote host — up to
 * `ACCESS_TIMEOUT_MS` — so a page load must never freeze on it (`.claude/rules/portal.md`).
 */
export async function canReadGitRemoteAsync(
  url: string,
  baseEnv: Record<string, string | undefined> = process.env,
): Promise<{ ok: true; detail: "" } | GitReadFailure> {
  const result = await lsRemoteAsync(url, "HEAD", baseEnv);
  return result.ok ? { ok: true, detail: "" } : result;
}

/**
 * The environment for git reading a remote: never asks for a password, and ssh in batch
 * mode unless the user has an ssh command of their own (see `canReadGitRemote`).
 */
export function gitAccessEnv(
  baseEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseEnv, GIT_TERMINAL_PROMPT: "0" };
  if (!hasOwnSshCommand(env)) env.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  return env;
}

/**
 * The commit a remote's `ref` points at (`git ls-remote <url> <ref>`), or why it could not
 * be read, redacted. For an annotated tag it is the commit the tag points at (the `^{}`
 * line). Same access rules as `canReadGitRemote`.
 */
export function gitRemoteHead(
  url: string,
  ref: string,
  baseEnv: Record<string, string | undefined> = process.env,
): { detail: string; ok: false } | { ok: true; sha: string } {
  const result = lsRemote(url, ref, baseEnv);
  if (!result.ok) return { detail: result.detail, ok: false };
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields): fields is [string, string] => fields.length === 2);
  const line = lines.find(([, name]) => name.endsWith("^{}")) ?? lines[0];
  if (line === undefined || !/^[0-9a-f]{40,64}$/.test(line[0])) {
    return { detail: `the remote has no ${ref}`, ok: false };
  }
  return { ok: true, sha: line[0] };
}

function lsRemote(
  url: string,
  ref: string,
  baseEnv: Record<string, string | undefined>,
): { ok: true; stdout: string } | GitReadFailure {
  const env = gitAccessEnv(baseEnv);
  try {
    const result = Bun.spawnSync(["git", "ls-remote", url, ref], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: ACCESS_TIMEOUT_MS,
    });
    if (result.exitCode === 0) return { ok: true, stdout: result.stdout.toString() };
    return lsRemoteFailure(result.exitCode, Boolean(result.signalCode), result.stderr.toString());
  } catch (error) {
    return lsRemoteUnspawned(error);
  }
}

/**
 * `lsRemote`, awaited (`Bun.spawn`): the same argv, environment, timeout, parse and words.
 * One home for both readers: only the spawn differs, which is the one thing a caller off the
 * server's event loop cannot share.
 */
async function lsRemoteAsync(
  url: string,
  ref: string,
  baseEnv: Record<string, string | undefined>,
): Promise<{ ok: true; stdout: string } | GitReadFailure> {
  const env = gitAccessEnv(baseEnv);
  try {
    const child = Bun.spawn(["git", "ls-remote", url, ref], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: ACCESS_TIMEOUT_MS,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    // A signal ended it (the timeout kill is SIGTERM): the sync reader's own "timed out".
    const timedOut = child.signalCode !== null;
    if (!timedOut && code === 0) return { ok: true, stdout };
    return lsRemoteFailure(timedOut ? null : code, timedOut, stderr);
  } catch (error) {
    return lsRemoteUnspawned(error);
  }
}

/**
 * What a `git ls-remote` that did not answer says, in the readers' own words: redacted, the
 * LAST line as the detail, and everything git said as the output (`gitFailureCause` reads it).
 */
function lsRemoteFailure(
  exitCode: null | number,
  timedOut: boolean,
  stderrText: string,
): GitReadFailure {
  const said = redactUrlsIn(stderrText.trim());
  const detail = timedOut ? "timed out" : (said.split("\n").at(-1) ?? "").trim();
  const output = said || `git exited with ${exitCode}`;
  return {
    detail: detail || `git exited with ${exitCode}`,
    ok: false,
    output,
  };
}

/** What a `git ls-remote` that could not be started at all says, in the readers' own words. */
function lsRemoteUnspawned(error: unknown): GitReadFailure {
  const said = redactUrlsIn(error instanceof Error ? error.message : String(error));
  return { detail: said, ok: false, output: said };
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
  const location = knownMarketplaceEntry(knownMarketplacesFile, name)?.installLocation;
  return typeof location === "string" && location !== "" ? location : null;
}

/**
 * The `autoUpdate` Claude Code keeps for a marketplace in known_marketplaces.json: what its
 * `/plugin` toggle wrote, or what a session start copied there from the settings
 * (`docs/claude-code-contract.md`). Undefined when it is not recorded as a boolean.
 */
export function marketplaceAutoUpdate(
  knownMarketplacesFile: string,
  name: string,
): boolean | undefined {
  const autoUpdate = knownMarketplaceEntry(knownMarketplacesFile, name)?.autoUpdate;
  return typeof autoUpdate === "boolean" ? autoUpdate : undefined;
}

/** One marketplace's entry in known_marketplaces.json; null when the file or the entry cannot be read. */
function knownMarketplaceEntry(
  knownMarketplacesFile: string,
  name: string,
): Record<string, unknown> | null {
  if (!existsSync(knownMarketplacesFile)) return null;
  try {
    const known = JSON.parse(readFileSync(knownMarketplacesFile, "utf8")) as Record<
      string,
      unknown
    > | null;
    const entry = known?.[name];
    return typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Where the plugin's folder is inside a marketplace: its `source` in the marketplace's
 * `.claude-plugin/marketplace.json` (`"./plugin"`), without the leading `./`. Null when
 * the text is not such a manifest, or names the plugin with another kind of source.
 */
export function pluginFolderIn(marketplaceJson: string, plugin: string): null | string {
  try {
    const manifest = JSON.parse(marketplaceJson) as { plugins?: unknown } | null;
    const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
    const entry = plugins.find(
      (candidate): candidate is { name: string; source: unknown } =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { name?: unknown }).name === plugin,
    );
    if (typeof entry?.source !== "string") return null;
    const folder = entry.source.replace(/^\.\//, "").replace(/\/+$/, "");
    return folder === "" || folder.split("/").includes("..") ? null : folder;
  } catch {
    return null;
  }
}

/**
 * The plugin version in a marketplace's local copy (`installLocation`): the `version` of
 * the plugin manifest in the folder the marketplace names for `plugin` (`plugin/` when it
 * names none). `manifest` is where it looked; `version` is null when it cannot be read.
 */
export function marketplaceCopyVersion(
  location: string,
  plugin: string,
): { manifest: string; version: null | string } {
  let folder = "plugin";
  try {
    folder =
      pluginFolderIn(
        readFileSync(join(location, ".claude-plugin", "marketplace.json"), "utf8"),
        plugin,
      ) ?? folder;
  } catch {
    // No marketplace manifest there: the plugin's usual folder.
  }
  const manifest = join(location, folder, ".claude-plugin", "plugin.json");
  try {
    const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown } | null)
      ?.version;
    return { manifest, version: typeof version === "string" ? version : null };
  } catch {
    return { manifest, version: null };
  }
}
