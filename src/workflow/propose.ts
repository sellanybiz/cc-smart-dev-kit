/**
 * `workflow propose`: one workflow setting of a project, changed through a pull request (D57).
 *
 * The project's `.claude/cc-smart-dev-kit.json` is committed and shared, and the merge guard
 * reads the review gate from the file committed on the base (`origin/<base>`): a change to it
 * counts once it is merged, never from a session's own checkout. So a change is never a write
 * in the project's main checkout. It is a small pull request:
 *
 *   1. the project and its `worktrees.base`;
 *   2. `gh` (installed, and logged in), `git fetch origin <base>`, and the base's own copy of
 *      the project's file — every step that can fail cheaply runs before a branch exists;
 *   3. the value **as the base commits it** (`resolveWorkflow` over the file at `origin/<base>`,
 *      the same resolver `workflow show` reads) — a value the base already has, or an `--unset`
 *      of one it does not set, stops here with one line and no branch. This checkout's
 *      working copy is never the comparison: an uncommitted edit here is not a policy;
 *   4. a branch and a worktree cut from `origin/<base>`, named `worktree-workflow-<setting>-
 *      <YYYYMMDD>` (a second change the same day takes `-2`), under the repository's
 *      `.claude/worktrees/` — Claude Code's own layout, so the plugin's auto-clean removes it
 *      after the merge;
 *   5. the one value, written by **the same writer `workflow set --project` uses**
 *      (`writeProjectSetting`: it validates the value, raises `requires`, and refuses a
 *      setting that is not the project's) — never a second writer. The worktree is a checkout
 *      of the base, so the write lands in the branch's own file and the main checkout's file is
 *      never touched; a write that does not show up in the worktree's own `git status` is
 *      refused before anything is committed;
 *   6. the commit (the person's git identity, a message naming the setting and both values),
 *      the push, and `gh pr create` into the base with a short body saying what changed and
 *      that it counts once merged;
 *   7. the pull request's URL, or with `--json` `{ url, branch, worktree, setting, from, to }`.
 *
 * **Nothing is left half-made.** A step that fails after the branch exists removes the
 * worktree, the branch and — when the push already went out — the branch on origin, and the one
 * line says what is left if any of that fails.
 *
 * **A crew session never runs it** (D24): the command pushes a branch and opens a pull request,
 * in children no hook sees, and a crew session does neither — it commits on its own branch and
 * its lead does the rest.
 *
 * **Inside Claude Code a review-gate key (`REVIEW_GATE_KEYS`) is refused** before this module
 * runs (`commands.ts`, as `workflow set` refuses it there). Outside Claude Code — the portal,
 * a terminal — every key is allowed: the pull-request review *is* the gate.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { CREW_QUESTION_STEP, crewIdOf } from "../crew/session";
import { runGit } from "../hooks/git";
import {
  type Checkout,
  CONFIG_PATH,
  loadProjectConfig,
  locateCheckout,
  readCommittedConfig,
} from "../project/resolve";
import { GH_TIMEOUT_MS, type GhRunner, ghMissing, spawnGh } from "./merge-check";
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

/** Git's words (in English, `LC_ALL=C`) when `worktree add` finds its name taken: a branch or a folder. */
const NAME_TAKEN = /already exists/;

/**
 * …and when it is the **branch** name that is taken (`fatal: a branch named 'x' already
 * exists`): git made nothing, and that branch is another run's. A taken **folder** (`fatal:
 * '<path>' already exists`) is another run's too, but git makes the new branch before it looks
 * at the folder and leaves it — that one is this attempt's. Both proved by hand on git 2.53.
 */
const BRANCH_TAKEN = /a branch named/;

/** What a `gh` on this machine can do right now. */
export type GhLoginState = "in" | "missing" | "out";

/**
 * Whether a pull request can be opened from `folder`, in three words: `missing` (no `gh` on the
 * PATH), `out` (gh cannot read this repository on GitHub: it is not logged in, there is no
 * network, or `origin` is not a GitHub repository), and `in`. The one call is `gh repo view`,
 * read-only, which finds the repository's own host from its remote — so a GitHub Enterprise
 * project is judged by its own login, never github.com's. Only whether gh answered is kept:
 * nothing it prints is shown.
 */
export async function ghLoginState(
  folder: string,
  env: Env,
  run: GhRunner = spawnGh,
  timeoutMs: number = GH_TIMEOUT_MS,
): Promise<GhLoginState> {
  if (ghMissing(env)) return "missing";
  const answer = await run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    env,
    folder,
    timeoutMs,
  });
  return answer === null ? "out" : "in";
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
  /** How long `gh pr create` may take; `GH_CREATE_TIMEOUT_MS` unless a test shortens it. */
  createTimeoutMs?: number;
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

/**
 * True when nothing of this repository holds `name`: no local branch, no worktree folder, and no
 * branch on origin (a teammate's proposal of the same setting the same day, which only the push
 * would otherwise find). `ls-remote --exit-code` exits 0 for a match, 2 for none; a call that
 * cannot answer (no network) counts as free — the push says it, with its own line.
 */
function nameFree(repo: string, name: string, env: Env): boolean {
  const branch = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (branch.ok) return false;
  if (existsSync(join(repo, ".claude", "worktrees", name))) return false;
  const remote = runGit(
    repo,
    ["ls-remote", "--exit-code", "--heads", "origin", name],
    env,
    FETCH_TIMEOUT_MS,
  );
  return !remote.ok;
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
 * Removes a worktree **only when git lists it**: a folder that merely holds the name (another
 * run's, or a person's) is never removed. Answers the failure's own words, or null.
 */
function removeOwnWorktree(repo: string, worktree: string, env: Env): null | string {
  const listed = runGit(repo, ["worktree", "list", "--porcelain"], env, QUICK_GIT_TIMEOUT_MS);
  if (!listed.ok || !listed.out.includes(`worktree ${worktree}\n`)) return null;
  const removed = runGit(
    repo,
    ["worktree", "remove", "--force", worktree],
    env,
    WORKTREE_TIMEOUT_MS,
  );
  return removed.ok ? null : `the worktree ${worktree} (${lastLine(removed.err)})`;
}

/**
 * Removes what a failed step made: the worktree, the branch, and — when the push already went
 * out — the branch on origin. Only called after the worktree was made (so both are this run's).
 * Answers the tail of the failure's line: nothing left, or what is.
 */
function takeBack(
  repo: string,
  worktree: string,
  branch: string,
  pushed: boolean,
  env: Env,
): string {
  const left: string[] = [];
  const worktreeProblem = removeOwnWorktree(repo, worktree, env);
  if (worktreeProblem !== null) left.push(worktreeProblem);
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

/** How long `gh pr create` may take: a write, so longer than a read — see `createPullRequest`. */
const GH_CREATE_TIMEOUT_MS = 60_000;

/** What `gh pr create` answered: the pull request's URL, why it was refused, or that it timed out. */
type Created = { ok: true; url: string } | { ok: false; timedOut: boolean; why: string };

/** The URL in `gh pr create`'s output, or null when it printed none. */
function urlIn(text: string): string | null {
  const found = /https:\/\/\S+\/pull\/\d+/.exec(text);
  return found === null ? null : found[0];
}

/**
 * `gh pr create` in the worktree, with its own stderr kept for the refusal's line. A **timeout
 * is its own answer**: GitHub may have made the pull request just before the call was ended, and
 * taking the pushed branch back then would close it — so the caller leaves everything as it is.
 */
async function createPullRequest(
  worktree: string,
  env: Env,
  args: string[],
  timeoutMs: number,
): Promise<Created> {
  try {
    const child = Bun.spawn(["gh", ...args], {
      cwd: worktree,
      env: env as Record<string, string>,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      windowsHide: true,
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (child.signalCode !== null) return { ok: false, timedOut: true, why: "no answer in time" };
    if (code !== 0) return { ok: false, timedOut: false, why: lastLine(err) };
    const url = urlIn(out);
    return url === null
      ? { ok: false, timedOut: false, why: `gh printed no pull request URL (${lastLine(out)})` }
      : { ok: true, url };
  } catch (error) {
    return { ok: false, timedOut: false, why: reasonOf(error) };
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

  // A crew session never pushes and never opens a pull request (D24): its own `git push` and
  // `gh pr create` are denied by the guards, but this command makes both in children no hook
  // sees — so it refuses first, with the step a crew session really has.
  if (crewIdOf(context.env) !== null) {
    return fail(
      `${COMMAND} workflow propose cannot run in a crew session: it pushes a branch and opens a pull request, and a crew session never pushes (D24). ${CREW_QUESTION_STEP}`,
    );
  }

  // 1. The project and the base its change goes into.
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
    return fail(`${repo} has no ${CONFIG_PATH}: run \`${COMMAND} project init\` there first.`);
  }
  const base = loaded.config.worktrees?.base;
  if (base === undefined) {
    return fail(
      `${repo} names no worktrees.base, so a change has no branch to go into: run \`${COMMAND} project init\` there.`,
    );
  }

  // 2. The base as it is now, and its own copy of the project's file: the value this changes
  //    is the one committed there, and a file that is not committed has nothing to propose into.
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

  // 3. The value **as the base commits it**, never this checkout's working copy: an uncommitted
  //    edit here must not read as "already set", and a change that counts is one to the base.
  //    A value that is already there needs no pull request, and no gh to say so.
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(context.paths, committed.config);
  } catch (error) {
    return fail(reasonOf(error));
  }
  const current = resolvedValueOf(resolved, key);
  if (value === undefined) {
    if (current.source !== "project") {
      context.print(`= ${key} was not set in ${CONFIG_PATH}; no branch or pull request was made.`);
      return 0;
    }
  } else if (current.source === "project" && Bun.deepEquals(current.value, value, true)) {
    context.print(
      `= ${key} = ${saidValue(key, value)} in ${CONFIG_PATH} (already set); no branch or pull request was made.`,
    );
    return 0;
  }

  // 4. gh, before anything is made: no pull request can be opened without it, so no branch.
  const login = await ghLoginState(repo, context.env);
  if (login === "missing") {
    return fail(
      "gh is not installed, so no pull request can be opened: install GitHub's CLI from https://cli.github.com, then run `gh auth login`.",
    );
  }
  if (login === "out") {
    return fail(
      "gh cannot read this repository on GitHub (it is not logged in, there is no network, or origin is not a GitHub repository): run `gh auth status` to see which, then try again.",
    );
  }

  // 5. The branch and the worktree, cut from origin/<base>.
  const wanted = `worktree-workflow-${settingSlug(key)}-${dayStamp(now())}`;
  let branch = freeName(repo, wanted, context.env);
  let worktree = join(repo, ".claude", "worktrees", branch);
  // In English, so a name another run took is read by git's own words, whatever the locale.
  const add = (): ReturnType<typeof runGit> =>
    runGit(
      repo,
      ["worktree", "add", "-b", branch, worktree, `origin/${base}`],
      context.env,
      WORKTREE_TIMEOUT_MS,
      { LC_ALL: "C" },
    );
  // What a refused add leaves that is this run's. A taken **branch name** made nothing, and that
  // branch is another run's: never touched. A taken **folder** is the other run's too, but git
  // makes the new branch before it looks at the folder and leaves it — that branch is this
  // attempt's, and `takeBack` removes only it and a worktree git itself lists.
  const refused = (err: string): string =>
    BRANCH_TAKEN.test(err) ? "" : takeBack(repo, worktree, branch, false, context.env);
  let added = add();
  if (!added.ok && NAME_TAKEN.test(added.err)) {
    // A name another proposal took between the check and the add: one more free name, once.
    refused(added.err);
    branch = freeName(repo, wanted, context.env);
    worktree = join(repo, ".claude", "worktrees", branch);
    added = add();
  }
  if (!added.ok) {
    return fail(`git worktree add failed: ${lastLine(added.err)}${refused(added.err)}`);
  }
  // The worktree is a checkout of the base, so it holds the base's own file. The check is the
  // guard against the writer falling back to the main checkout's working copy: that file is
  // never written by a proposal.
  if (!existsSync(join(worktree, CONFIG_PATH))) {
    return fail(
      `the new worktree has no ${CONFIG_PATH}${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }

  // 6. The one value, by the writer `workflow set --project` uses, inside the branch's checkout.
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

  // 7. The commit (the person's identity), the push, and the pull request.
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
  const pushed = runGit(worktree, ["push", "-u", "origin", branch], context.env, PUSH_TIMEOUT_MS);
  if (!pushed.ok) {
    return fail(
      `git push -u origin ${branch} failed: ${lastLine(pushed.err)}. Check that you may push to this repository, then try again${takeBack(repo, worktree, branch, false, context.env)}`,
    );
  }
  const created = await createPullRequest(
    worktree,
    context.env,
    [
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
    ],
    context.createTimeoutMs ?? GH_CREATE_TIMEOUT_MS,
  );
  if (!created.ok) {
    if (created.timedOut) {
      // Not taken back: the pull request may already exist, and the pushed branch is its head.
      return fail(
        `gh pr create did not answer in time, so the pull request may be open: look at ${repo}'s pull requests on GitHub before running this again. The branch ${branch} is pushed, from ${worktree}.`,
      );
    }
    return fail(
      `gh pr create failed: ${created.why}. Check that gh is logged in (\`gh auth login\`) and that your account may open a pull request on this repository, then try again${takeBack(repo, worktree, branch, true, context.env)}`,
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
  context.print(`+ ${branch} (${relative(repo, worktree)}), cut from origin/${base} and pushed`);
  context.print(`+ pull request into ${base}: ${created.url}`);
  return 0;
}
