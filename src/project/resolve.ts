import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CcConfig, loadCcConfig } from "./config";

export interface Project {
  /** The top folder of the checkout `cwd` is in (a linked worktree's own folder). */
  root: string;
  /** The shared `.git` folder of every worktree of this repo. */
  commonDir: string;
  /** True inside a linked worktree (`git worktree add`), false in the main checkout. */
  isWorktree: boolean;
  /** The main checkout's folder, or null for a bare repo. */
  mainCheckout: string | null;
  /** `<root>/.claude/cc.json`, else `<mainCheckout>/.claude/cc.json`, else null. */
  config: CcConfig | null;
}

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

function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !REPO_SELECTING_GIT_VARS.includes(key)) env[key] = value;
  }
  return env;
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: gitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** The first `worktree` entry of `git worktree list --porcelain` is the main checkout. */
function findMainCheckout(cwd: string): string | null {
  const list = git(cwd, ["worktree", "list", "--porcelain"]);
  if (!list.ok) throw new Error(`git worktree list failed in ${cwd}: ${list.stderr.trim()}`);
  const [firstEntry = ""] = list.stdout.split("\n\n");
  const lines = firstEntry.split("\n");
  if (lines.includes("bare")) return null;
  const pathLine = lines.find((line) => line.startsWith("worktree "));
  return pathLine ? realpathSync(pathLine.slice("worktree ".length)) : null;
}

/**
 * Finds the git project `cwd` is in, and its cc.json.
 * Returns null outside git. Throws CcVersionError when the project needs another plugin
 * version, and CcConfigError when a cc.json is invalid.
 */
export function resolveProject(
  cwd: string,
  options: { pluginVersion?: string } = {},
): Project | null {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`resolveProject: ${cwd} is not a folder`);
  }
  const revParse = git(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir",
  ]);
  if (!revParse.ok) return null;
  const [top, gitDir, common] = revParse.stdout.trim().split("\n");
  // A bare repo has no top level: there is no checkout to work in.
  if (!top || !gitDir || !common) return null;

  const root = realpathSync(top);
  const commonDir = realpathSync(common);
  const isWorktree = realpathSync(gitDir) !== commonDir;
  const mainCheckout = isWorktree ? findMainCheckout(cwd) : root;

  const own = join(root, ".claude", "cc.json");
  let config = loadCcConfig(own, options.pluginVersion);
  if (config === null && mainCheckout !== null && mainCheckout !== root) {
    config = loadCcConfig(join(mainCheckout, ".claude", "cc.json"), options.pluginVersion);
  }
  return { root, commonDir, isWorktree, mainCheckout, config };
}
