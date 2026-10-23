/**
 * `workflow propose`: one workflow setting of a project, changed through a pull request (D57).
 *
 * The project's `.claude/cc-smart-dev-kit.json` is committed and shared, and the merge guard
 * reads the review gate from the file committed on the base (`origin/<base>`): a change to it
 * counts once it is merged, never from a session's own checkout. So a change is never a write
 * in the project's main checkout. It is a small pull request:
 *
 *   1. the project, its `worktrees.base`, and the value it holds now (`resolveWorkflow`, the
 *      same resolver `workflow show` reads) — a value the project already has, or an `--unset`
 *      of one it does not set, stops here with one line and no branch;
 *   2. `git fetch origin <base>`, so the branch starts from the base as it is now;
 *   3. a branch and a worktree cut from `origin/<base>`, named `worktree-workflow-<setting>-
 *      <YYYYMMDD>` (a second change the same day takes `-2`), under the repository's
 *      `.claude/worktrees/` — Claude Code's own layout, so the plugin's auto-clean removes it
 *      after the merge;
 *   4. the one value, written by **the same writer `workflow set --project` uses**
 *      (`writeProjectSetting`: it validates the value, raises `requires`, and refuses a
 *      setting that is not the project's) — never a second writer. The worktree is a checkout
 *      of the base, so the write lands in the branch's own file and the main checkout's file is
 *      never touched; a write that does not show up in the worktree's own `git status` is
 *      refused before anything is committed;
 *   5. the commit (the person's git identity, a message naming the setting and both values),
 *      the push, and `gh pr create` into the base with a short body saying what changed and
 *      that it counts once merged;
 *   6. the pull request's URL, or with `--json` `{ url, branch, worktree, setting, from, to }`.
 *
 * **Nothing is left half-made.** Every step that can fail cheaply (the project, the value, gh,
 * the fetch, the base's own file) runs before the branch exists. A step that fails after it
 * removes the worktree, the branch and — when the push already went out — the branch on
 * origin, and the one line says what is left if any of that fails.
 *
 * **Inside Claude Code a review-gate key (`REVIEW_GATE_KEYS`) is refused** before this module
 * runs (`commands.ts`, as `workflow set` refuses it there). Outside Claude Code — the portal,
 * a terminal — every key is allowed: the pull-request review *is* the gate.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { runGit } from "../hooks/git";
import {
  type Checkout,
  CONFIG_PATH,
  loadProjectConfig,
  locateCheckout,
  readCommittedConfig,
} from "../project/resolve";
import { type GhRunner, GH_TIMEOUT_MS, ghMissing, spawnGh } from "./merge-check";
import { type ResolvedWorkflow, resolvedValueOf, resolveWorkflow } from "./resolve";
import { showValue, type WorkflowKey } from "./schema";
import { writeProjectSetting } from "./write";

type Env = Record<string, string | undefined>;

/** How long `git fetch` may take: a network call to the remote. */
const FETCH_TIMEOUT_MS = 60_000;

/** How long a checkout of a big tree may take (`crew start` waits as long for the same call). */
const WORKTREE_TIMEOUT_MS = 60_000;

/** How long the commit and the push may take: a hook of the project's own may run. */
const COMMIT_TIMEOUT_MS = 120_000;
const PUSH_TIMEOUT_MS = 120_000;

/** A read-only or local git call: milliseconds, never a hang. */
const QUICK_GIT_TIMEOUT_MS = 10_000;

/** How many names a taken branch may push the new one to before the command gives up. */
const NAME_TRIES = 50;

/** What a `gh` on this machine can do right now. */
export type GhLoginState = "in" | "missing" | "out";

/**
 * Whether `gh` is installed and logged in, in three words. `gh api user` is the one call that
 * answers it without writing anything: its own login name on stdout when the token works, and
 * nothing when it does not. A key never leaves gh: only whether it answered is kept.
 */
export async function ghLoginState(
  folder: string,
  env: Env,
  run: GhRunner = spawnGh,
  timeoutMs: number = GH_TIMEOUT_MS,
): Promise<GhLoginState> {
  if (ghMissing(env)) return "missing";
  const login = await run(["api", "user", "--jq", ".login"], { env, folder, timeoutMs });
  return login === null ? "out" : "in";
}

/** Everything one `workflow propose` run is given. */
export interface ProposeContext {
  paths: CliPaths;
  env: Env;
  /** The folder to find the project in: `--folder`, else the folder the command runs in. */
  folder: string;
  print: (line: string) => void;
  error: (line: string) => void;
  /** The clock the branch name's day comes from (UTC); a test moves it. */
  now?: () => number;
}

/** One message as a person reads it: the last line of a child's own words, never all of it. */
function lastLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.at(-1) ?? "no reason given";
}

/** An error as one sentence. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The day a branch name carries, in UTC so every machine names the same day the same way. */
function dayStamp(now: number): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

/** A setting as a branch name's part: `crew.perLead` is `crew-perLead`. */
function settingSlug(key: WorkflowKey): string {
  return key.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** True when no branch and no worktree of this repository holds `name`. */
function nameFree(repo: string, name: string, env: Env): boolean {
  const branch = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (branch.ok) return false;
  return !existsSync(join(repo, ".claude", "worktrees", name));
}

/** The first free name from `wanted` on: the same day's second change is `-2`, then `-3`. */
function freeName(repo: string, wanted: string, env: Env): string {
  if (nameFree(repo, wanted, env)) return wanted;
  for (let count = 2; count <= NAME_TRIES; count += 1) {
    const name = `${wanted}-${count}`;
    if (nameFree(repo, name, env)) return name;
  }
  return wanted;
}

/**
 * Removes what a failed step made: the worktree, the branch, and — when the push already went
 * out — the branch on origin. Answers the tail of the failure's line: nothing left, or what is.
 */
function takeBack(
  repo: string,
  worktree: string,
  branch: string,
  pushed: boolean,
  env: Env,
): string {
  const left: string[] = [];
  if (existsSync(worktree)) {
    const removed = runGit(
      repo,
      ["worktree", "remove", "--force", worktree],
      env,
      WORKTREE_TIMEOUT_MS,
    );
    if (!removed.ok) left.push(`the worktree ${worktree} (${lastLine(removed.err)})`);
  }
  const exists = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (exists.ok) {
    const deleted = runGit(repo, ["branch", "-D", branch], env, QUICK_GIT_TIMEOUT_MS);
    if (!deleted.ok) left.push(`the branch ${branch} (${lastLine(deleted.err)})`);
  }
  if (pushed) {
    const gone = runGit(repo, ["push", "origin", "--delete", branch], env, PUSH_TIMEOUT_MS);
    if (!gone.ok) left.push(`the branch ${branch} on origin (${lastLine(gone.err)})`);
  }
  return left.length === 0
    ? "; the worktree and the branch were removed again; nothing was left behind"
    : `; what is left: ${left.join("; ")}`;
}

/** A value as a line says it: an unset one is `(unset)`. */
function saidValue(key: WorkflowKey, value: unknown): string {
  return value === undefined ? "(unset)" : showValue(key, value);
}

/** The pull request's title: the setting, and both values. */
function titleOf(key: WorkflowKey, from: unknown, to: unknown): string {
  return `workflow: ${key} ${saidValue(key, from)} → ${saidValue(key, to)}`;
}

/** The pull request's body: what changed, and why it counts only once merged. */
function bodyOf(key: WorkflowKey, from: unknown, to: unknown, base: string): string {
  return [
    `Updated by \`${COMMAND} workflow propose\`: the project's workflow setting ${key}, from ${saidValue(key, from)} to ${saidValue(key, to)}.`,
    `It counts once this pull request is merged into ${base}: the merge guard reads the review gate from the file committed on the base, and a session's own checkout never counts.`,
  ].join("\n");
}

/** What `gh pr create` answered: the pull request's URL, or why it was refused. */
type Created =
  | { ok: true; url: string }
  | { ok: false; why: string };

/** The URL in `gh pr create`'s output, or null when it printed none. */
function urlIn(text: string): string | null {
  const found = /https:\/\/\S+\/pull\/\d+/.exec(text);
  return found === null ? null : found[0];
}

/** `gh pr create` in the worktree, with its own stderr kept for the refusal's line. */
async function createPullRequest(
  worktree: string,
  env: Env,
  args: string[],
): Promise<Created> {
  try {
    const child = Bun.spawn(["gh", ...args], {
      cwd: worktree,
      env: env as Record<string, string>,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: GH_TIMEOUT_MS,
      windowsHide: true,
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) return { ok: false, why: lastLine(err) };
    const url = urlIn(out);
    return url === null
      ? { ok: false, why: `gh printed no pull request URL (${lastLine(out)})` }
      : { ok: true, url };
  } catch (error) {
    return { ok: false, why: reasonOf(error) };
  }
}

/**
 * One setting of the project found at `context.folder`, changed through a pull request.
 * Answers the command's exit code: 0 done (or nothing to do), 1 a step refused or failed.
 * A wrong setting or value is refused before this runs (`commands.ts`, `parseWorkflowValue`).
 */
export async function proposeWorkflow(
  context: ProposeContext,
  key: WorkflowKey,
  value: unknown,
  options: { json: boolean },
): Promise<number> {
  const now = context.now ?? Date.now;
  const fail = (line: string): number => {
    context.error(line);
    return 1;
  };

  // 1. The project, its base, and the value it holds now.
  let checkout: Checkout | null;
  try {
    checkout = locateCheckout(context.folder, { env: context.env });
  } catch (error) {
    return fail(reasonOf(error));
  }
  if (checkout === null) {
    return fail(`${context.folder} is not in a git project: run this inside the project.`);
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  let loaded: ReturnType<typeof loadProjectConfig>;
  try {
    loaded = loadProjectConfig(checkout);
  } catch (error) {
    return fail(reasonOf(error));
  }
  if (loaded.config === null) {
    return fail(
      `${repo} has no ${CONFIG_PATH}: run \`${COMMAND} project init\` there first.`,
    );
  }
  const base = loaded.config.worktrees?.base;
  if (base === undefined) {
    return fail(
      `${repo} names no worktrees.base, so a change has no branch to go into: run \`${COMMAND} project init\` there.`,
    );
  }
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(context.paths, loaded.config);
  } catch (error) {
    return fail(reasonOf(error));
  }
  const current = resolvedValueOf(resolved, key);
  if (value === undefined) {
    if (current.source !== "project") {
      context.print(
        `= ${key} was not set in ${CONFIG_PATH}; no branch or pull request was made.`,
      );
      return 0;
    }
  } else if (current.source === "project" && Bun.deepEquals(current.value, value, true)) {
    context.print(
      `= ${key} = ${saidValue(key, value)} in ${CONFIG_PATH} (already set); no branch or pull request was made.`,
    );
    return 0;
  }

  // 2. gh, before anything is made: no pull request, no change.
  const login = await ghLoginState(repo, context.env);
  if (login === "missing") {
    return fail(
      "gh is not installed, so no pull request can be opened: install GitHub's CLI from https://cli.github.com, then run `gh auth login`.",
    );
  }
  if (login === "out") {
    return fail("gh is not logged in: run `gh auth login`, then try again.");
  }

  // 3. The base as it is now, and its own copy of the project's file: the change counts once
  //    merged, so a file that is not committed there has nothing to propose into.
  const fetched = runGit(repo, ["fetch", "origin", base], context.env, FETCH_TIMEOUT_MS);
  if (!fetched.ok) {
    return fail(
      `git fetch origin ${base} failed: ${lastLine(fetched.err)}. Check the network and that origin has ${base}, then try again.`,
    );
  }
  let committed: ReturnType<typeof readCommittedConfig>;
  try {
    committed = readCommittedConfig(checkout, base, { env: context.env });
  } catch (error) {
    return fail(reasonOf(error));
  }
  if (!committed.found) {
    return fail(
      `origin/${base} has no ${CONFIG_PATH}: commit the project's file to ${base} and push it first — a change counts once it is merged.`,
    );
  }

  // 4. The branch and the worktree, cut from origin/<base>.
  const branch = freeName(
    repo,
    `worktree-workflow-${settingSlug(key)}-${dayStamp(now())}`,
    context.env,
  );
  const worktree = join(repo, ".claude", "worktrees", branch);
  const added = runGit(
    repo,
    ["worktree", "add", "-b", branch, worktree, `origin/${base}`],
    context.env,
    WORKTREE_TIMEOUT_MS,
  );
  if (!added.ok) {
    return fail(
      `git worktree add failed: ${lastLine(added.err)}${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }
  // The worktree is a checkout of the base, so it holds the base's own file. The check is the
  // guard against the writer falling back to the main checkout's working copy: that file is
  // never written by a proposal.
  if (!existsSync(join(worktree, CONFIG_PATH))) {
    return fail(
      `the new worktree has no ${CONFIG_PATH}${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }

  // 5. The one value, by the writer `workflow set --project` uses, inside the branch's checkout.
  try {
    writeProjectSetting(worktree, key, value, context.env);
  } catch (error) {
    return fail(`${reasonOf(error)}${takeBack(repo, worktree, branch, false, context.env)}`);
  }
  const status = runGit(worktree, ["status", "--porcelain"], context.env, QUICK_GIT_TIMEOUT_MS);
  if (!status.ok || !status.out.includes(CONFIG_PATH)) {
    return fail(
      `the change did not land in the new worktree's own ${CONFIG_PATH}${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }

  // 6. The commit (the person's identity), the push, and the pull request.
  const title = titleOf(key, current.value, value);
  const staged = runGit(worktree, ["add", "--", CONFIG_PATH], context.env, QUICK_GIT_TIMEOUT_MS);
  if (!staged.ok) {
    return fail(
      `git add failed: ${lastLine(staged.err)}${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }
  const commit = runGit(
    worktree,
    ["commit", "-m", title, "--", CONFIG_PATH],
    context.env,
    COMMIT_TIMEOUT_MS,
  );
  if (!commit.ok) {
    return fail(
      `git commit failed: ${lastLine(commit.err)}. Check your git name and email (\`git config user.name\`), then try again${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }
  const pushed = runGit(
    worktree,
    ["push", "-u", "origin", branch],
    context.env,
    PUSH_TIMEOUT_MS,
  );
  if (!pushed.ok) {
    return fail(
      `git push -u origin ${branch} failed: ${lastLine(pushed.err)}. Check that you may push to this repository, then try again${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }
  const created = await createPullRequest(worktree, context.env, [
    "pr",
    "create",
    "--base",
    base,
    "--head",
    branch,
    "--title",
    title,
    "--body",
    bodyOf(key, current.value, value, base),
  ]);
  if (!created.ok) {
    return fail(
      `gh pr create failed: ${created.why}. Check that gh is logged in to the account that owns this repository, then try again${takeBack(repo, worktree, branch, true, context.env)}`,
    );
  }

  if (options.json) {
    context.print(
      JSON.stringify({
        branch,
        from: current.value,
        setting: key,
        to: value ?? null,
        url: created.url,
        worktree,
      }),
    );
    return 0;
  }
  context.print(`+ ${key} = ${saidValue(key, value)} in ${CONFIG_PATH}`);
  context.print(
    `+ ${branch} (${relative(repo, worktree)}), cut from origin/${base} and pushed`,
  );
  context.print(`+ pull request into ${base}: ${created.url}`);
  return 0;
}
