/**
 * WorktreeCreate: the worktree Claude Code asks for (`claude -w <name>`, EnterWorktree with
 * a name, a subagent's `isolation: "worktree"`).
 *
 * A WorktreeCreate hook replaces Claude Code's own creation in every project, and a hook
 * that prints no folder makes the creation fail (proved live: `docs/claude-code-contract.md`).
 * So the plugin cannot step aside for a project that never opted in: it does Claude Code's
 * default itself there.
 *
 * - **With `worktrees` in anymodel.json** (a session's worktree): the folder
 *   `<parent of the main checkout>/<prefix><name, every / a ->` on the branch `<name>`.
 *   An existing worktree of that branch is entered again (unless another running session
 *   works in it). Otherwise an existing branch is checked out, or a new one is cut from
 *   `origin/<base>` right after `git fetch origin <base>`; a failed fetch refuses, because a
 *   new branch starts only from the latest base. Then the project's `setup` runs inside.
 * - **Without it, and for every subagent** (`agent-<hex>`): Claude Code's default shape,
 *   `<main checkout>/.claude/worktrees/<name, every / a +>` on the branch
 *   `worktree-<same>`, from the base `worktree.baseRef` names: the remote's default branch
 *   (`"fresh"`, the default) or the asking checkout's HEAD (`"head"`). No setup.
 * - Both copy the files `.worktreeinclude` names (gitignored files only), which Claude Code
 *   no longer does once a hook makes the worktree.
 *
 * stdout is the folder and nothing else. A failure exits 1 with the reason on stderr.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AnymodelConfig } from "../project/config";
import { gitEnv } from "../project/resolve";
import {
  hasRef,
  isInside,
  type ListedWorktree,
  listWorktrees,
  noPromptEnv,
  runGit,
  samePath,
} from "./git";
import type { HookResult } from "./io";
import type { Env, HookContext } from "./run";
import { liveSessions, type SessionRecord } from "./sessions";

/** How long the project's setup command may run; the hook's own timeout is 600 s. */
export const SETUP_TIMEOUT_MS = 540_000;
/** The fetch of the base branch, for a configured worktree. */
const BASE_FETCH_TIMEOUT_MS = 30_000;
/** Claude Code's own fetch of the default branch is capped at five seconds. */
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
/** Claude Code fetches the default branch when the repo was not fetched for a day. */
const FETCH_AGE_MS = 24 * 60 * 60 * 1000;
/** Written into a configured worktree's git folder once its setup finished. */
export const SETUP_MARKER = "anymodel-setup-done";

/** Claude Code names a subagent's worktree `agent-<hex>` (seen live). */
export function isSubagentName(name: string): boolean {
  return /^agent-[0-9a-f]+$/.test(name);
}

/** The base of a default-shape worktree, from Claude Code's `worktree.baseRef` setting. */
export type BaseRef = "fresh" | "head";

/**
 * `worktree.baseRef` from the first of `files` that sets it (pass them highest precedence
 * first: local, project, user). Anything but "head" is "fresh", Claude Code's default.
 */
export function readBaseRef(files: string[]): BaseRef {
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { worktree?: { baseRef?: unknown } };
      const value = parsed?.worktree?.baseRef;
      if (value === "head" || value === "fresh") return value;
    } catch {
      // Claude Code cannot read this file either.
    }
  }
  return "fresh";
}

/** Why `name` cannot name a worktree, or null when it can. */
export function badName(name: string): string | null {
  if (name.trim() === "") return "the worktree name is empty";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses.
  if (/[\u0000-\u001f\u007f]/.test(name)) return "the worktree name has a control character";
  if (name.startsWith("-")) return `the worktree name "${name}" starts with "-"`;
  if (name.split(/[\\/]/).some((part) => part === "." || part === "..")) {
    return `the worktree name "${name}" has a "." or ".." part`;
  }
  return null;
}

/** Why the prefix cannot be used, or null: it must stay one folder name beside the repo. */
export function badPrefix(prefix: string): string | null {
  return /[\\/]/.test(prefix) || prefix === "." || prefix === ".."
    ? `worktrees.prefix "${prefix}" must be part of a folder name, with no "/" or "\\"`
    : null;
}

/** The folder of a configured worktree: beside the main checkout. */
export function configuredFolder(mainCheckout: string, prefix: string, name: string): string {
  return join(dirname(mainCheckout), `${prefix}${name.replace(/[\\/]/g, "-")}`);
}

/** Claude Code's own shape: `/` becomes `+` in the folder and the branch (seen live). */
export function defaultShape(repoRoot: string, name: string): { folder: string; branch: string } {
  const safe = name.replace(/\//g, "+");
  return { folder: join(repoRoot, ".claude", "worktrees", safe), branch: `worktree-${safe}` };
}

class Refusal extends Error {}

function git(cwd: string, args: string[], env: Env, timeoutMs?: number): string {
  const run = runGit(cwd, args, env, timeoutMs);
  if (!run.ok) {
    const reason =
      run.err
        .split("\n")
        .filter((line) => line.trim() !== "")
        .at(-1) ?? "";
    throw new Refusal(`\`git ${args.join(" ")}\` failed: ${reason}`);
  }
  return run.out;
}

function checkBranchName(repo: string, branch: string, env: Env): void {
  if (!runGit(repo, ["check-ref-format", "--branch", branch], env).ok) {
    throw new Refusal(`"${branch}" is not a valid branch name`);
  }
}

/** The repo's `FETCH_HEAD` is younger than a day. */
function fetchedRecently(commonDir: string): boolean {
  try {
    return Date.now() - statSync(join(commonDir, "FETCH_HEAD")).mtimeMs < FETCH_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * The commit a default-shape worktree starts from, as Claude Code picks it: with "fresh",
 * the remote's default branch (`origin/HEAD`), fetched when the repo was not fetched for a
 * day (at most 5 s, never asking for a password); with "head", or with no remote or no
 * `origin/HEAD` to be had, the asking checkout's HEAD.
 */
export function defaultBase(
  repo: string,
  commonDir: string,
  askingCheckout: string,
  baseRef: BaseRef,
  env: Env,
): string {
  const head = () => git(askingCheckout, ["rev-parse", "--verify", "HEAD^{commit}"], env);
  if (baseRef === "head" || !runGit(repo, ["remote", "get-url", "origin"], env).ok) return head();
  const quiet = noPromptEnv(env);
  const originHead = () =>
    runGit(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], env);
  let known = originHead();
  if (!known.ok) {
    runGit(repo, ["remote", "set-head", "origin", "--auto"], quiet, DEFAULT_FETCH_TIMEOUT_MS);
    known = originHead();
  }
  if (!known.ok) return head();
  const branch = known.out.replace(/^origin\//, "");
  if (!fetchedRecently(commonDir)) {
    runGit(repo, ["fetch", "--quiet", "origin", branch], quiet, DEFAULT_FETCH_TIMEOUT_MS);
  }
  const ref = `refs/remotes/origin/${branch}`;
  return hasRef(repo, ref, env)
    ? git(repo, ["rev-parse", "--verify", `${ref}^{commit}`], env)
    : head();
}

/**
 * Copies the gitignored files `.worktreeinclude` names from `source` into `target`, the way
 * Claude Code does for the worktrees it makes itself: `.gitignore` syntax, and only files
 * that are also gitignored, so a tracked file is never copied. A file already in `target`
 * stays. Returns the copied paths.
 */
export function copyWorktreeInclude(source: string, target: string, env: Env): string[] {
  const includeFile = join(source, ".worktreeinclude");
  if (!existsSync(includeFile)) return [];
  const listed = runGit(
    source,
    ["ls-files", "-z", "--others", "--ignored", `--exclude-from=${includeFile}`],
    env,
    60_000,
  );
  if (!listed.ok || listed.out === "") return [];
  const candidates = listed.out.split("\0").filter((path) => path !== "");
  const ignored = Bun.spawnSync(["git", "check-ignore", "-z", "--stdin"], {
    cwd: source,
    env: gitEnv(env),
    stdin: Buffer.from(`${candidates.join("\0")}\0`),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  // check-ignore exits 1 when nothing is ignored.
  const copied: string[] = [];
  for (const path of ignored.stdout.toString().split("\0")) {
    if (path === "" || existsSync(join(target, path))) continue;
    mkdirSync(dirname(join(target, path)), { recursive: true });
    copyFileSync(join(source, path), join(target, path));
    copied.push(path);
  }
  return copied;
}

/** Runs the project's setup in a new worktree; throws with its last lines when it fails. */
export function runSetup(folder: string, setup: string[], env: Env): void {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(setup, {
      cwd: folder,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: SETUP_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Refusal(
      `the setup command \`${setup.join(" ")}\` could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.exitCode === 0) return;
  const said = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`
    .trim()
    .split("\n")
    .slice(-15)
    .join("\n");
  const how = result.signalCode
    ? `timed out after ${SETUP_TIMEOUT_MS / 1000} s`
    : `exited ${result.exitCode}`;
  throw new Refusal(
    `the setup command \`${setup.join(" ")}\` ${how} in ${folder}; the worktree stays, and entering it again runs setup again${said === "" ? "" : `\n${said}`}`,
  );
}

function setupMarker(folder: string, env: Env): string {
  return join(git(folder, ["rev-parse", "--absolute-git-dir"], env), SETUP_MARKER);
}

export type ReuseDecision =
  | { kind: "reuse"; folder: string }
  | { kind: "create" }
  | { kind: "refuse"; why: string };

/**
 * Whether a configured worktree request enters an existing worktree. Found by its branch,
 * in any folder, else by the planned folder. Refused: the main checkout's own branch; a
 * planned folder on another branch; a worktree that is locked, or whose folder is gone; one
 * another running session works in (two sessions must not share a folder); and any existing
 * one when the session records cannot be read (`sessions` null).
 */
export function reuseDecision(params: {
  worktrees: ListedWorktree[];
  branch: string;
  folder: string;
  sessions: SessionRecord[] | null;
  askingSession: string | null;
  folderExists: (path: string) => boolean;
}): ReuseDecision {
  const { worktrees, branch, folder, sessions, askingSession, folderExists } = params;
  const [main, ...others] = worktrees;
  if (main?.branch === branch) {
    return {
      kind: "refuse",
      why: `${branch} is the main checkout's branch; name a branch of its own for this work`,
    };
  }
  const found =
    others.find((worktree) => worktree.branch === branch) ??
    others.find((worktree) => samePath(worktree.path, folder));
  if (found === undefined) return { kind: "create" };
  if (found.branch !== null && found.branch !== branch) {
    return { kind: "refuse", why: `${found.path} is on ${found.branch}, not ${branch}` };
  }
  if (found.locked) {
    return {
      kind: "refuse",
      why: `${found.path} is locked (\`git worktree unlock ${found.path}\` once it is safe)`,
    };
  }
  if (found.prunable || !folderExists(found.path)) {
    return {
      kind: "refuse",
      why: `${found.path} is still listed but its folder is gone: run \`git worktree prune\`, then ask again`,
    };
  }
  if (sessions === null) {
    return {
      kind: "refuse",
      why: `the running sessions' records cannot be read, so it is unknown whether another session works in ${found.path}`,
    };
  }
  const other = sessions.find(
    (session) => session.sessionId !== askingSession && isInside(session.cwd, found.path),
  );
  if (other !== undefined) {
    return {
      kind: "refuse",
      why: `the running session "${other.name}" (process ${other.pid}) works in ${found.path}; two sessions must not share a folder`,
    };
  }
  return { kind: "reuse", folder: found.path };
}

type Worktrees = NonNullable<AnymodelConfig["worktrees"]>;

function createConfigured(context: HookContext, name: string, worktrees: Worktrees): string {
  const { env, paths, project, input } = context;
  const main = project.mainCheckout;
  if (main === null) throw new Refusal("the repo has no main checkout (a bare repo)");
  const prefixProblem = badPrefix(worktrees.prefix);
  if (prefixProblem !== null) throw new Refusal(prefixProblem);
  const branch = name;
  checkBranchName(main, branch, env);
  const folder = configuredFolder(main, worktrees.prefix, name);

  let sessions: SessionRecord[] | null;
  try {
    sessions = liveSessions(paths.claudeConfigDir);
  } catch {
    sessions = null;
  }
  const decision = reuseDecision({
    worktrees: listWorktrees(main, env),
    branch,
    folder,
    sessions,
    askingSession: typeof input.session_id === "string" ? input.session_id : null,
    folderExists: existsSync,
  });
  if (decision.kind === "refuse") throw new Refusal(decision.why);

  let target = folder;
  if (decision.kind === "reuse") {
    target = decision.folder;
  } else {
    if (existsSync(folder))
      throw new Refusal(`${folder} exists and is not a worktree of this repo`);
    const fetched = runGit(
      main,
      ["fetch", "--quiet", "origin", worktrees.base],
      noPromptEnv(env),
      BASE_FETCH_TIMEOUT_MS,
    );
    if (hasRef(main, `refs/heads/${branch}`, env)) {
      git(main, ["worktree", "add", "--quiet", folder, branch], env);
    } else if (hasRef(main, `refs/remotes/origin/${branch}`, env)) {
      git(
        main,
        ["worktree", "add", "--quiet", "--track", "-b", branch, folder, `origin/${branch}`],
        env,
      );
    } else if (fetched.ok) {
      git(
        main,
        [
          "worktree",
          "add",
          "--quiet",
          "--no-track",
          "-b",
          branch,
          folder,
          `origin/${worktrees.base}`,
        ],
        env,
      );
    } else {
      throw new Refusal(
        `\`git fetch origin ${worktrees.base}\` failed (${fetched.err || "no reason given"}): a new branch starts only from the latest ${worktrees.base}`,
      );
    }
    copyWorktreeInclude(main, folder, env);
  }

  // Also for a worktree entered again: a setup that failed last time left no marker.
  const marker = setupMarker(target, env);
  if (worktrees.setup !== undefined && !existsSync(marker)) {
    runSetup(target, worktrees.setup, env);
    writeFileSync(marker, "");
  }
  return target;
}

function createDefault(context: HookContext, name: string): string {
  const { env, paths, project } = context;
  const repo = project.mainCheckout ?? project.root;
  const { folder, branch } = defaultShape(repo, name);
  checkBranchName(repo, branch, env);
  const listed = listWorktrees(repo, env);
  if (existsSync(folder)) {
    if (listed.some((worktree) => samePath(worktree.path, folder))) return folder;
    throw new Refusal(`${folder} exists and is not a worktree of this repo`);
  }
  if (hasRef(repo, `refs/heads/${branch}`, env)) {
    git(repo, ["worktree", "add", "--quiet", folder, branch], env);
  } else {
    const settings = [project.root, ...(repo === project.root ? [] : [repo])].flatMap((root) => [
      join(root, ".claude", "settings.local.json"),
      join(root, ".claude", "settings.json"),
    ]);
    const base = defaultBase(
      repo,
      project.commonDir,
      project.root,
      readBaseRef([...settings, paths.settingsFile]),
      env,
    );
    git(repo, ["worktree", "add", "--quiet", "--no-track", "-b", branch, folder, base], env);
  }
  copyWorktreeInclude(project.root, folder, env);
  return folder;
}

export function worktreeCreate(context: HookContext): HookResult {
  const name = typeof context.input.name === "string" ? context.input.name : "";
  try {
    const problem = badName(name);
    if (problem !== null) throw new Refusal(problem);
    const worktrees = context.project.config?.worktrees;
    const folder =
      worktrees !== undefined && !isSubagentName(name)
        ? createConfigured(context, name, worktrees)
        : createDefault(context, name);
    return { stdout: folder };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stderr: `worktree not created: ${reason}` };
  }
}
