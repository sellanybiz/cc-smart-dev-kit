/**
 * Is there a newer cc-smart-dev-kit? Two looks, cheapest first:
 *
 *   1. The marketplace's remote head (`git ls-remote <source> <ref or HEAD>`, which needs
 *      no gh and never asks for a password) against the head of Claude Code's local copy
 *      (`installLocation` in known_marketplaces.json). Different: the copy is behind, and
 *      `claude plugin marketplace update` would bring new commits.
 *   2. The installed version (installed_plugins.json) against the version in the copy.
 *      Lower: Claude Code refreshed the catalog but did not install the update (the
 *      auto-update bug this module works around).
 *
 * A marketplace that is not a git repo (a folder, a URL) gets only the second look.
 * `remotePluginVersion` reads the version in the remote head itself, for
 * `cc-smart-dev-kit update --check`, without touching Claude Code's copy.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKETPLACE, PLUGIN } from "../build-info";
import { isOlder } from "../build-info/semver";
import type { CliPaths } from "../cli/paths";
import { gitEnv } from "../project/git-env";
import { findUserInstall } from "../setup/installed-plugins";
import {
  gitAccessEnv,
  gitRemoteHead,
  marketplaceCopyVersion,
  marketplaceInstallLocation,
  marketplaceSource,
  pluginFolderIn,
  redactUrl,
  redactUrlsIn,
} from "../setup/marketplace-access";

type Env = Record<string, string | undefined>;

/** The longest one git step may take. */
const GIT_TIMEOUT_MS = 20_000;

export type UpdateStatus =
  /** No user-scope install of the plugin: nothing to update. */
  | { kind: "not-installed" }
  /** The marketplace is not added, or has no local copy. */
  | { kind: "no-marketplace"; detail: string }
  /** The remote could not be read. */
  | { detail: string; kind: "unreachable" }
  | { installed: string; kind: "up-to-date" }
  | {
      kind: "behind";
      /** The installed version (null: not recorded). */
      installed: null | string;
      /** The version in Claude Code's copy of the marketplace (null: unreadable). */
      inCopy: null | string;
      /** The copy is behind the remote: a marketplace refresh brings new commits. */
      catalogBehind: boolean;
      /**
       * For a git marketplace: the URL that answered and its head. The URL may carry
       * credentials: print it only through `redactUrl`.
       */
      remote: null | { head: string; ref: string; url: string };
    };

/** The commit a local git folder is on, or null when it is not a git checkout. */
function localHead(folder: string, env: Env): null | string {
  try {
    const result = Bun.spawnSync(["git", "-C", folder, "rev-parse", "HEAD"], {
      env: gitEnv(env),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: GIT_TIMEOUT_MS,
    });
    const head = result.stdout.toString().trim();
    return result.exitCode === 0 && /^[0-9a-f]{40,64}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

/** Looks for a newer version; reads the network only for a git marketplace (one ls-remote). */
export function checkForUpdate(paths: CliPaths, env: Env): UpdateStatus {
  const install = findUserInstall(paths.installedPluginsFile);
  if (install === null) return { kind: "not-installed" };
  const source = marketplaceSource(paths.knownMarketplacesFile, MARKETPLACE, env);
  if (source.kind === "missing") {
    return { detail: `the ${MARKETPLACE} marketplace is not added`, kind: "no-marketplace" };
  }
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  if (location === null) {
    return {
      detail: `the ${MARKETPLACE} marketplace has no local copy`,
      kind: "no-marketplace",
    };
  }
  const inCopy = marketplaceCopyVersion(location, PLUGIN).version;

  let remote: null | { head: string; ref: string; url: string } = null;
  let catalogBehind = false;
  if (source.kind === "git") {
    const ref = source.ref ?? "HEAD";
    const failures: string[] = [];
    for (const url of source.urls) {
      const head = gitRemoteHead(url, ref, env);
      if (head.ok) {
        remote = { head: head.sha, ref, url };
        break;
      }
      failures.push(`${redactUrl(url)}: ${head.detail}`);
    }
    if (remote === null) return { detail: failures.join("; "), kind: "unreachable" };
    // A copy whose head cannot be read proves nothing about the remote: only the versions
    // below decide then. Read as "behind", every check said so, and the background check
    // refreshed the marketplace every hour for nothing.
    const local = localHead(location, env);
    catalogBehind = local !== null && local !== remote.head;
  }

  if (catalogBehind || isOlder(install.version, inCopy)) {
    return {
      catalogBehind,
      inCopy,
      installed: install.version,
      kind: "behind",
      remote,
    };
  }
  return { installed: install.version ?? "(no version)", kind: "up-to-date" };
}

/**
 * The plugin version at the remote's head, read without touching Claude Code's copy: a
 * shallow fetch of that one commit into a temp bare repo, then its marketplace manifest
 * and the plugin's manifest. `url` is the real URL (with any credentials it needs); every
 * message is redacted.
 */
export function remotePluginVersion(
  url: string,
  ref: string,
  baseEnv: Env,
): { detail: string; ok: false } | { ok: true; version: string } {
  const env = gitAccessEnv(gitEnv(baseEnv));
  const dir = mkdtempSync(join(tmpdir(), "cc-smart-dev-kit-update-check-"));
  const git = (args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: GIT_TIMEOUT_MS,
    });
    return {
      ok: result.exitCode === 0,
      stderr: redactUrlsIn(result.stderr.toString().trim().split("\n").at(-1) ?? ""),
      stdout: result.stdout.toString(),
    };
  };
  try {
    const init = git(["init", "-q", "--bare", dir]);
    if (!init.ok) return { detail: `git init: ${init.stderr}`, ok: false };
    const fetch = git(["-C", dir, "fetch", "-q", "--depth", "1", "--no-tags", url, ref]);
    if (!fetch.ok) return { detail: fetch.stderr || "git fetch failed", ok: false };
    const marketplace = git(["-C", dir, "show", "FETCH_HEAD:.claude-plugin/marketplace.json"]);
    const folder = (marketplace.ok && pluginFolderIn(marketplace.stdout, PLUGIN)) || "plugin";
    const manifest = git(["-C", dir, "show", `FETCH_HEAD:${folder}/.claude-plugin/plugin.json`]);
    if (!manifest.ok) return { detail: `no ${folder}/.claude-plugin/plugin.json`, ok: false };
    const version = (JSON.parse(manifest.stdout) as { version?: unknown } | null)?.version;
    return typeof version === "string"
      ? { ok: true, version }
      : { detail: `no version in ${folder}/.claude-plugin/plugin.json`, ok: false };
  } catch (error) {
    return {
      detail: redactUrlsIn(error instanceof Error ? error.message : String(error)),
      ok: false,
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}
