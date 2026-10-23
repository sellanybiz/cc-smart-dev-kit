/**
 * `workflow propose`: one workflow setting of a project, changed through a pull request (D57).
 *
 * The project's `.claude/cc-smart-dev-kit.json` is committed and shared, and the merge guard
 * reads the review gate from the file committed on the base (`origin/<base>`): a change to it
 * counts once it is merged, never from a session's own checkout. So a change is never a write
 * in the project's main checkout. It is a small pull request:
 *
 *   1. the project and its `worktrees.base`;
 *   2. `git fetch origin <base>` and the base's own copy of the project's file — a file that is
 *      not committed there has nothing to propose into;
 *   3. the value **as the base commits it** (`resolveWorkflow` over that file, the same resolver
 *      `workflow show` reads; only a value the project's own file sets counts) — one the base
 *      already has, or an `--unset` of one it does not set, stops here with one line and no
 *      branch. This checkout's working copy is never the comparison: an uncommitted edit here is
 *      not a policy, and the person's own defaults are never put in a pull request;
 *   4. `gh` (installed, and able to read this repository) — no pull request, no branch;
 *   5. a branch and a worktree cut from `origin/<base>`, in Claude Code's own layout: the folder
 *      `.claude/worktrees/workflow-<setting>-<YYYYMMDD>` (a second change the same day takes
 *      `-2`) on the branch `worktree-<folder name>`, so the plugin's auto-clean removes it after
 *      the merge;
 *   6. the one value, written by **the same writer `workflow set --project` uses**
 *      (`writeProjectSetting`: it validates the value, raises `requires`, and refuses a
 *      setting that is not the project's) — never a second writer. The worktree is a checkout
 *      of the base, so the write lands in the branch's own file; that it exists there is checked
 *      before the write (the writer would otherwise fall back to the main checkout's file), and
 *      the worktree's own `git status` must show the change before anything is committed;
 *   7. the commit (the person's git identity, a message naming the setting and both values),
 *      the push, and `gh pr create` into the base with a short body saying what changed and
 *      that it counts once merged;
 *   8. the pull request's URL, or with `--json` `{ url, branch, worktree, setting, from, to }`.
 *
 * **Nothing is left half-made.** A step that fails after the branch exists removes the
 * worktree, the branch and — when the push already went out — the branch on origin, and the one
 * line says what is left if any of that fails. Two exceptions, both to avoid destroying what may
 * be someone else's: a `gh pr create` that does not answer in time leaves the pushed branch (the
 * pull request may exist), and a name another proposal took between the check and the add is
 * skipped for the next free one, never reused.
 *
 * **A crew session never runs it** (D24): the command pushes a branch and opens a pull request,
 * in children no hook sees, and a crew session does neither. Like `CLAUDECODE`'s, the check is a
 * courtesy a command can drop (`env -u`); the guards deny the session's own `git push` and
 * `gh pr create` lines either way.
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
import { parseWorktreeList, runGit } from "../hooks/git";
import { samePath } from "../path-compare";
import {
  type Checkout,
  CONFIG_PATH,
  loadProjectConfig,
  locateCheckout,
  readCommittedConfig,
} from "../project/resolve";
import { GH_TIMEOUT_MS, type GhRunner, ghMissing, spawnGh } from "./merge-check";
import { type ResolvedWorkflow, resolvedValueOf, resolveWorkflow } from "./resolve";
import { isProjectKey, showValue, type WorkflowKey } from "./schema";
import { writeProjectSetting } from "./write";

type Env = Record<string, string | undefined>;

/** How long `git fetch` and `ls-remote` may take: a network call to the remote. */
const FETCH_TIMEOUT_MS = 60_000;

/** How long a checkout of a big tree may take (`crew start` waits as long for the same call). */
const WORKTREE_TIMEOUT_MS = 60_000;

/** How long the commit and the push may take: a hook of the project's own may run. */
const COMMIT_TIMEOUT_MS = 120_000;
const PUSH_TIMEOUT_MS = 120_000;

/** A local git call that reads or writes a ref: milliseconds, never a hang. */
const QUICK_GIT_TIMEOUT_MS = 10_000;

/** How long `gh pr create` may take: a write, so longer than a read — see `createPullRequest`. */
const GH_CREATE_TIMEOUT_MS = 60_000;

/**
 * The longest a run can take, from its own step limits: the `gh` read, the fetch, two `ls-remote`
 * and two `worktree add` (a name taken once), the commit, the push, `gh pr create`, and then the
 * take-back (a worktree removal, the remote branch's deletion, a few local ref calls), plus the
 * process's own start. A caller that runs the command in a child gives it **at least this**, so
 * the command's own limits always fire — and its take-back always runs — before the child is
 * ended from outside (the portal's action, `src/portal/actions.ts`).
 */
export const PROPOSE_WORST_CASE_MS =
  GH_TIMEOUT_MS +
  FETCH_TIMEOUT_MS +
  2 * FETCH_TIMEOUT_MS +
  2 * WORKTREE_TIMEOUT_MS +
  COMMIT_TIMEOUT_MS +
  PUSH_TIMEOUT_MS +
  GH_CREATE_TIMEOUT_MS +
  WORKTREE_TIMEOUT_MS +
  PUSH_TIMEOUT_MS +
  8 * QUICK_GIT_TIMEOUT_MS +
  30_000;

/**
 * The line a caller shows when it ended the child at `PROPOSE_WORST_CASE_MS` anyway: the run may
 * have stopped anywhere, so the line says where to look.
 */
export function proposeTimeoutLine(setting: string): string {
  return `workflow propose did not answer in time, so it may have left a worktree and a branch behind (the folder .claude/worktrees/workflow-${setting.replace(/[^A-Za-z0-9]+/g, "-")}-…) or opened the pull request: look at the project's pull requests and at \`git worktree list\` before running it again.`;
}

/** How many names a taken branch may push the new one to before the command gives up. */
const NAME_TRIES = 50;

/** Git's words (in English, `LC_ALL=C`) when `worktree add` finds its name taken: a branch or a folder. */
const NAME_TAKEN = /already exists/i;

/**
 * …and when it is the **branch** name that is taken (`fatal: a branch named 'x' already
 * exists`; git before 2.35 capitalized it, hence the `i`): git made nothing, and that branch is
 * another run's. A taken **folder** (`fatal: '<path>' already exists`) is another run's too, but
 * git makes the new branch before it looks at the folder and leaves it — that one is this
 * attempt's. Both proved by hand on git 2.53.
 */
const BRANCH_TAKEN = /a branch named/i;

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
  /** The clock the folder name's day comes from (UTC); a test moves it. */
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

/** The day a name carries, in UTC so every machine names the same day the same way. */
function dayStamp(now: number): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

/** A setting as a name's part: `crew.perLead` is `crew-perLead`. */
function settingSlug(key: WorkflowKey): string {
  return key.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Where one proposal lives, in Claude Code's own layout: the folder `.claude/worktrees/<name>`
 * on the branch `worktree-<name>`.
 */
interface Place {
  branch: string;
  name: string;
  worktree: string;
}

function placeOf(repo: string, name: string): Place {
  return {
    branch: `worktree-${name}`,
    name,
    worktree: join(repo, ".claude", "worktrees", name),
  };
}

/**
 * The branches of `origin` whose name starts with `prefix`, in **one** network call: a
 * teammate's proposal of the same setting the same day would otherwise be found only by the
 * push. A call that cannot answer (no network) counts as none — the push says it, with its own
 * line — and the run keeps its one bound on the network (`FETCH_TIMEOUT_MS`).
 */
function remoteBranches(repo: string, prefix: string, env: Env): Set<string> {
  const listed = runGit(
    repo,
    ["ls-remote", "--heads", "origin", `${prefix}*`],
    env,
    FETCH_TIMEOUT_MS,
  );
  if (!listed.ok) return new Set();
  const names = new Set<string>();
  for (const line of listed.out.split("\n")) {
    const ref = line.trim().split(/\s+/)[1];
    if (ref?.startsWith("refs/heads/")) names.add(ref.slice("refs/heads/".length));
  }
  return names;
}

/** True when nothing of this repository holds the place: no local branch, no worktree folder
 * (both cheap), and no branch of `taken` on origin. */
function placeFree(repo: string, place: Place, env: Env, taken: ReadonlySet<string>): boolean {
  if (taken.has(place.branch)) return false;
  const local = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${place.branch}`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (local.ok) return false;
  return !existsSync(place.worktree);
}

/** The first free place from `wanted` on: the same day's second change is `-2`, then `-3`. */
function freePlace(repo: string, wanted: string, env: Env): Place {
  const taken = remoteBranches(repo, `worktree-${wanted}`, env);
  const first = placeOf(repo, wanted);
  if (placeFree(repo, first, env, taken)) return first;
  for (let count = 2; count <= NAME_TRIES; count += 1) {
    const place = placeOf(repo, `${wanted}-${count}`);
    if (placeFree(repo, place, env, taken)) return place;
  }
  return first;
}

/**
 * Removes a worktree **only when git lists it**: a folder that merely holds the name (another
 * run's, or a person's) is never removed. Paths are compared as places (`samePath`), because git
 * prints `C:/…` where `join` gives `C:\…`. Answers the failure's own words, or null.
 */
function removeOwnWorktree(repo: string, worktree: string, env: Env): null | string {
  const listed = runGit(repo, ["worktree", "list", "--porcelain"], env, QUICK_GIT_TIMEOUT_MS);
  if (!listed.ok) return `the worktree ${worktree} (git could not list the worktrees)`;
  if (!parseWorktreeList(listed.out).some((one) => samePath(one.path, worktree))) return null;
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
 * out — the branch on origin. Answers what could not be removed, each in words; empty when
 * nothing is left. `onlyAt` limits the local branch to one still at that commit: a branch a refused
 * `worktree add` may have left must be the untouched cut from the base, never one that has since
 * been committed on.
 */
function takeBack(
  repo: string,
  place: Place,
  pushed: boolean,
  env: Env,
  onlyAt?: string,
): string[] {
  const left: string[] = [];
  const worktreeProblem = removeOwnWorktree(repo, place.worktree, env);
  if (worktreeProblem !== null) left.push(worktreeProblem);
  const tip = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${place.branch}`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (tip.ok && (onlyAt === undefined || tip.out === onlyAt)) {
    const deleted = runGit(repo, ["branch", "-D", place.branch], env, QUICK_GIT_TIMEOUT_MS);
    if (!deleted.ok) left.push(`the branch ${place.branch} (${lastLine(deleted.err)})`);
  }
  if (pushed) {
    const gone = runGit(repo, ["push", "origin", "--delete", place.branch], env, PUSH_TIMEOUT_MS);
    if (!gone.ok) left.push(`the branch ${place.branch} on origin (${lastLine(gone.err)})`);
  }
  return left;
}

/** The end of a failure's line: what was taken back, or what is left. */
function tailOf(left: string[]): string {
  return left.length === 0
    ? "; the worktree and the branch were removed again; nothing was left behind"
    : `; what is left: ${left.join("; ")}`;
}

/**
 * A value as a line says it: an unset one is `(unset)`. Only ever a value the **project's own
 * file** holds (`from`), or the one proposed — never the person's own default, which no pull
 * request should publish.
 */
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

  // A setting the project's own file cannot hold has nothing to propose: the writer would refuse
  // it only after a fetch, a `gh` call, a branch and a worktree.
  if (!isProjectKey(key)) {
    return fail(
      `${key} is your own setting, not the project's, so there is nothing to propose: it is per person, per machine — change it with \`${COMMAND} workflow set ${key} <value>\`.`,
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

  // 2. The base as it is now, and its own copy of the project's file: the value this changes is
  //    the one committed there, and a file that is not committed has nothing to propose into.
  //    The refspec is explicit, so a single-branch clone updates `origin/<base>` too.
  const fetched = runGit(
    repo,
    ["fetch", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`],
    context.env,
    FETCH_TIMEOUT_MS,
  );
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
  //    A value that is already there needs no pull request, and no gh to say so. Only a value
  //    the project's own file holds is ever a `from`: the person's defaults stay private.
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(context.paths, committed.config);
  } catch (error) {
    return fail(reasonOf(error));
  }
  const current = resolvedValueOf(resolved, key);
  const from = current.source === "project" ? current.value : undefined;
  if (value === undefined) {
    if (from === undefined) {
      context.print(`= ${key} was not set in ${CONFIG_PATH}; no branch or pull request was made.`);
      return 0;
    }
  } else if (from !== undefined && Bun.deepEquals(from, value, true)) {
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
  const wanted = `workflow-${settingSlug(key)}-${dayStamp(now())}`;
  const baseSha = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `origin/${base}^{commit}`],
    context.env,
    QUICK_GIT_TIMEOUT_MS,
  ).out;
  let place = freePlace(repo, wanted, context.env);
  // In English, so a name another run took is read by git's own words, whatever the locale.
  const add = (): ReturnType<typeof runGit> =>
    runGit(
      repo,
      ["worktree", "add", "-b", place.branch, place.worktree, `origin/${base}`],
      context.env,
      WORKTREE_TIMEOUT_MS,
      { LC_ALL: "C" },
    );
  // What a refused add leaves that is this run's. A taken **branch name** made nothing, and that
  // branch is another run's: never touched. A taken **folder** is the other run's too, but git
  // makes the new branch before it looks at the folder and leaves it — that branch is this
  // attempt's, and goes only while it is still the untouched cut from the base.
  const refused = (err: string): string[] =>
    BRANCH_TAKEN.test(err) ? [] : takeBack(repo, place, false, context.env, baseSha);
  let added = add();
  if (!added.ok && NAME_TAKEN.test(added.err)) {
    // A name another proposal took between the check and the add: one more free name, once.
    const left = refused(added.err);
    if (left.length > 0) {
      context.print(`! the first attempt left behind: ${left.join("; ")}`);
    }
    place = freePlace(repo, wanted, context.env);
    added = add();
  }
  if (!added.ok) {
    const left = refused(added.err);
    return fail(
      `git worktree add failed: ${lastLine(added.err)}${left.length === 0 ? ". Nothing was committed or pushed." : `; what is left: ${left.join("; ")}`}`,
    );
  }
  const { branch, worktree } = place;
  // The worktree is a checkout of the base, so it holds the base's own file. The check is the
  // guard against the writer falling back to the main checkout's working copy: that file is
  // never written by a proposal.
  if (!existsSync(join(worktree, CONFIG_PATH))) {
    return fail(
      `the new worktree has no ${CONFIG_PATH}${tailOf(takeBack(repo, place, false, context.env))}`,
    );
  }

  // 6. The one value, by the writer `workflow set --project` uses, inside the branch's checkout.
  try {
    writeProjectSetting(worktree, key, value, context.env);
  } catch (error) {
    return fail(`${reasonOf(error)}${tailOf(takeBack(repo, place, false, context.env))}`);
  }
  const status = runGit(worktree, ["status", "--porcelain"], context.env, QUICK_GIT_TIMEOUT_MS);
  if (!status.ok || !status.out.includes(CONFIG_PATH)) {
    return fail(
      `the change did not land in the new worktree's own ${CONFIG_PATH}${tailOf(takeBack(repo, place, false, context.env))}`,
    );
  }

  // 7. The commit (the person's identity), the push, and the pull request.
  const title = titleOf(key, from, value);
  const staged = runGit(worktree, ["add", "--", CONFIG_PATH], context.env, QUICK_GIT_TIMEOUT_MS);
  if (!staged.ok) {
    return fail(
      `git add failed: ${lastLine(staged.err)}${tailOf(takeBack(repo, place, false, context.env))}`,
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
      `git commit failed: ${lastLine(commit.err)}. The project's own commit hooks run in the new worktree; check them and your git name and email (\`git config user.name\`), then try again${tailOf(takeBack(repo, place, false, context.env))}`,
    );
  }
  const pushed = runGit(worktree, ["push", "-u", "origin", branch], context.env, PUSH_TIMEOUT_MS);
  if (!pushed.ok) {
    return fail(
      `git push -u origin ${branch} failed: ${lastLine(pushed.err)}. Check that you may push to this repository, and the project's own push hooks, then try again${tailOf(takeBack(repo, place, false, context.env))}`,
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
      bodyOf(key, from, value, base),
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
      `gh pr create failed: ${created.why}. Check that gh is logged in (\`gh auth login\`) and that your account may open a pull request on this repository, then try again${tailOf(takeBack(repo, place, true, context.env))}`,
    );
  }

  if (options.json) {
    context.print(
      JSON.stringify({
        branch,
        from: from ?? null,
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
