import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type CcSmartDevKitConfig,
  loadCcSmartDevKitConfig,
  parseCcSmartDevKitConfig,
  readOwnHooks,
} from "./config";
import { gitEnv } from "./git-env";

export interface Project {
  /** The top folder of the checkout `cwd` is in (a linked worktree's own folder). */
  root: string;
  /** The shared `.git` folder of every worktree of this repo. */
  commonDir: string;
  /** True inside a linked worktree (`git worktree add`), false in the main checkout. */
  isWorktree: boolean;
  /** The main checkout's folder, or null for a bare repo. */
  mainCheckout: string | null;
  /** `<root>/.claude/cc-smart-dev-kit.json`, else `<mainCheckout>/.claude/cc-smart-dev-kit.json`, else null. */
  config: CcSmartDevKitConfig | null;
  /** The file `config` was read from; null when there is none. */
  configFile: string | null;
}

export interface ResolveOptions {
  /** The plugin version to check `requires` against. Default: this build's version. */
  pluginVersion?: string;
  /** The environment git runs with (PATH finds git). Default: process.env. */
  env?: Record<string, string | undefined>;
}

/** `rev-parse --path-format` came in git 2.31. */
export const MIN_GIT_VERSION = "2.31.0";

type Git = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

/**
 * Each git call here may take this long. A hook resolves its project first, and a guard's
 * own timeout is 10 s (`.claude/rules/hooks.md` § Timeouts); these calls take milliseconds.
 */
export const RESOLVE_GIT_TIMEOUT_MS = 5_000;

/** What a machine with no git at all is told, instead of the spawner's own words. */
export const GIT_NOT_FOUND =
  "git was not found, so this project's own values cannot be read. Install git, then try again.";

function gitIn(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number = RESOLVE_GIT_TIMEOUT_MS,
): Git {
  return (args) => {
    try {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs,
        // A hook or a crew command may run with no console of its own on Windows.
        windowsHide: true,
      });
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      // No git on this machine's PATH at all — on Windows without Git for Windows, or in a
      // container. The spawner's own words for it (`Executable not found in $PATH: "git"`)
      // reach a portal page, where they read as a crash rather than as a fact to act on. A
      // folder that is gone, or anything else that throws here, is re-thrown as it is.
      throw /not found in \$PATH|ENOENT/.test(why) ? new Error(GIT_NOT_FOUND) : error;
    }
  };
}

/** Throws when git is older than MIN_GIT_VERSION. An unreadable version passes. */
function requireGitVersion(git: Git): void {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(git(["--version"]).stdout);
  if (!match) return;
  const version = `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
  if (Bun.semver.order(version, MIN_GIT_VERSION) < 0) {
    throw new Error(`git 2.31 or newer is needed; you have git ${version}. Update git.`);
  }
}

/** The first `worktree` entry of `git worktree list --porcelain` is the main checkout. */
function findMainCheckout(git: Git, cwd: string): string | null {
  const list = git(["worktree", "list", "--porcelain"]);
  if (!list.ok) throw new Error(`git worktree list failed in ${cwd}: ${list.stderr.trim()}`);
  const [firstEntry = ""] = list.stdout.split("\n\n");
  const lines = firstEntry.split("\n");
  if (lines.includes("bare")) return null;
  const pathLine = lines.find((line) => line.startsWith("worktree "));
  if (!pathLine) return null;
  const path = pathLine.slice("worktree ".length);
  if (!existsSync(path) || lines.some((line) => line.startsWith("prunable"))) {
    throw new Error(
      `The main checkout of the repo at ${cwd} is missing: ${path} was moved or deleted. ` +
        'If you moved it, run "git worktree repair" in its new folder.',
    );
  }
  return realpathSync(path);
}

/** Where a checkout is, without its cc-smart-dev-kit.json: what a hook needs before it reads the file. */
export type Checkout = Omit<Project, "config" | "configFile">;

/**
 * Finds the git checkout `cwd` is in, reading no cc-smart-dev-kit.json. Returns null outside git or
 * in a bare repo. Throws when git is older than 2.31 or the main checkout is missing.
 * A hook calls it first, then `ownHooksOf`, so a hook the project runs as its own copy stays
 * silent even when the cc-smart-dev-kit.json is broken.
 */
export function locateCheckout(cwd: string, options: ResolveOptions = {}): Checkout | null {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`resolveProject: ${cwd} is not a folder`);
  }
  const git = gitIn(cwd, gitEnv(options.env ?? process.env));
  const revParse = git([
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir",
  ]);
  const [top, gitDir, common] = revParse.stdout.trim().split("\n");
  // git before 2.31 does not know --path-format: it fails, or prints the option back.
  if (!revParse.ok || top?.startsWith("--")) {
    requireGitVersion(git);
    if (revParse.ok) {
      throw new Error(
        "git did not understand rev-parse --path-format: git 2.31 or newer is needed.",
      );
    }
    return null; // outside git
  }
  // A bare repo has no top level: there is no checkout to work in.
  if (!top || !gitDir || !common) return null;

  const root = realpathSync(top);
  const commonDir = realpathSync(common);
  const isWorktree = realpathSync(gitDir) !== commonDir;
  const mainCheckout = isWorktree ? findMainCheckout(git, cwd) : root;
  return { root, commonDir, isWorktree, mainCheckout };
}

/**
 * The plugin hooks the project runs as its own copy (`ownHooks`), read on their own from the
 * same cc-smart-dev-kit.json `loadProjectConfig` reads. Never throws: empty when there is no file,
 * or it cannot be read.
 */
export function ownHooksOf(checkout: Checkout): string[] {
  const { root, mainCheckout } = checkout;
  const own = readOwnHooks(join(root, ".claude", "cc-smart-dev-kit.json"));
  if (own !== null) return own;
  if (mainCheckout === null || mainCheckout === root) return [];
  return readOwnHooks(join(mainCheckout, ".claude", "cc-smart-dev-kit.json")) ?? [];
}

/**
 * Reads the cc-smart-dev-kit.json of a located checkout: its own, else the main checkout's, and the
 * file it came from. Throws CcSmartDevKitVersionError when the project needs another plugin
 * version, and CcSmartDevKitConfigError when a cc-smart-dev-kit.json is invalid.
 */
export function loadProjectConfig(checkout: Checkout, pluginVersion?: string): Project {
  const { root, mainCheckout } = checkout;
  const own = join(root, ".claude", "cc-smart-dev-kit.json");
  let config = loadCcSmartDevKitConfig(own, pluginVersion);
  let configFile = config === null ? null : own;
  if (config === null && mainCheckout !== null && mainCheckout !== root) {
    const main = join(mainCheckout, ".claude", "cc-smart-dev-kit.json");
    config = loadCcSmartDevKitConfig(main, pluginVersion);
    configFile = config === null ? null : main;
  }
  return { ...checkout, config, configFile };
}

/** Where the project's file sits inside a commit. */
export const CONFIG_PATH = ".claude/cc-smart-dev-kit.json";

/** What `readCommittedConfig` found on one branch: the file, or why there is none to read. */
export type CommittedConfig =
  | { found: true; config: CcSmartDevKitConfig; where: string }
  | { found: false; why: string; where: string };

export interface CommittedOptions {
  /** The environment git runs with. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** How long each git call may take. Default: `RESOLVE_GIT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The plugin version to check `requires` against. Default: this build's version. */
  pluginVersion?: string;
}

/**
 * The project's cc-smart-dev-kit.json **as committed on `origin/<branch>`**: read with git alone
 * (`rev-parse`, then `cat-file`), never the working copy of any checkout, so a session cannot
 * change what it says by editing a file. Nothing is fetched: the ref is as fresh as the last
 * fetch, so a policy change counts once it is pushed and fetched.
 *
 * `found: false` when the ref is not there (no `origin`, a branch never fetched, a fork) or the
 * commit has no such file: the caller asks the person rather than guess. A committed file that
 * cannot be used throws as `loadProjectConfig` does (CcSmartDevKitVersionError for a `requires`
 * this plugin does not meet, CcSmartDevKitConfigError for invalid text), naming `where`.
 */
export function readCommittedConfig(
  checkout: Checkout,
  branch: string,
  options: CommittedOptions = {},
): CommittedConfig {
  const ref = `origin/${branch}`;
  const where = `${ref}:${CONFIG_PATH}`;
  const git = gitIn(checkout.root, gitEnv(options.env ?? process.env), options.timeoutMs);
  const commit = git(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}^{commit}`]);
  if (!commit.ok) {
    return {
      found: false,
      where,
      why: `${ref} is not known in this repository (no origin, or the branch was never fetched)`,
    };
  }
  const blob = git(["rev-parse", "--verify", "--quiet", `${commit.stdout.trim()}:${CONFIG_PATH}`]);
  if (!blob.ok) return { found: false, where, why: `${ref} has no ${CONFIG_PATH} committed` };
  const text = git(["cat-file", "blob", blob.stdout.trim()]);
  if (!text.ok) return { found: false, where, why: `git could not read ${where}` };
  return {
    found: true,
    where,
    config: parseCcSmartDevKitConfig(text.stdout, where, options.pluginVersion),
  };
}

/**
 * Finds the git project `cwd` is in, and its cc-smart-dev-kit.json.
 * Returns null outside git. Throws when git is older than 2.31 or the main checkout is
 * missing, CcSmartDevKitVersionError when the project needs another plugin version, and CcSmartDevKitConfigError
 * when a cc-smart-dev-kit.json is invalid.
 */
export function resolveProject(cwd: string, options: ResolveOptions = {}): Project | null {
  const checkout = locateCheckout(cwd, options);
  return checkout === null ? null : loadProjectConfig(checkout, options.pluginVersion);
}
