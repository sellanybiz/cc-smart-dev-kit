import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { type AnymodelConfig, loadAnymodelConfig } from "./config";

export interface Project {
  /** The top folder of the checkout `cwd` is in (a linked worktree's own folder). */
  root: string;
  /** The shared `.git` folder of every worktree of this repo. */
  commonDir: string;
  /** True inside a linked worktree (`git worktree add`), false in the main checkout. */
  isWorktree: boolean;
  /** The main checkout's folder, or null for a bare repo. */
  mainCheckout: string | null;
  /** `<root>/.claude/anymodel.json`, else `<mainCheckout>/.claude/anymodel.json`, else null. */
  config: AnymodelConfig | null;
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

/**
 * Git variables that would point git at another repo than `cwd`.
 * A git hook sets some of them, so we drop them: we always resolve from `cwd`.
 */
const REPO_SELECTING_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
];

function gitEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !REPO_SELECTING_GIT_VARS.includes(key)) env[key] = value;
  }
  return env;
}

type Git = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

function gitIn(cwd: string, env: Record<string, string>): Git {
  return (args) => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
    return {
      ok: result.exitCode === 0,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
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

/**
 * Finds the git project `cwd` is in, and its anymodel.json.
 * Returns null outside git. Throws when git is older than 2.31 or the main checkout is
 * missing, AnymodelVersionError when the project needs another plugin version, and AnymodelConfigError
 * when an anymodel.json is invalid.
 */
export function resolveProject(cwd: string, options: ResolveOptions = {}): Project | null {
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

  const own = join(root, ".claude", "anymodel.json");
  let config = loadAnymodelConfig(own, options.pluginVersion);
  let configFile = config === null ? null : own;
  if (config === null && mainCheckout !== null && mainCheckout !== root) {
    const main = join(mainCheckout, ".claude", "anymodel.json");
    config = loadAnymodelConfig(main, options.pluginVersion);
    configFile = config === null ? null : main;
  }
  return { root, commonDir, isWorktree, mainCheckout, config, configFile };
}
