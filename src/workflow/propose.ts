/**
 * `workflow propose`: one workflow setting of a project, changed through a pull request (D57).
 *
 * The project's `.claude/cc-smart-dev-kit.json` is committed and shared, and merge-check
 * reads the review gate from the file committed on the base (`origin/<base>`): a change to it
 * counts once it is merged, never from a session's own checkout. So a change is never a write
 * in the project's main checkout. It is a small pull request:
 *
 *   1. the project and its `worktrees.base`;
 *   2. `git fetch origin <base>`, then **one** commit (`origin/<base>` as the fetch left it) and
 *      the project's file in it, exactly as committed — a file that is not committed there has
 *      nothing to propose into. Every later step reads this commit and this text only;
 *   3. the value **as the base commits it** (`resolveWorkflow` over that file, the same resolver
 *      `workflow show` reads; only a value the project's own file sets counts) — one the base
 *      already has, or an `--unset` of one it does not set, stops here with one line and no
 *      branch. This checkout's working copy is never the comparison: an uncommitted edit here is
 *      not a policy, and the person's own defaults are never put in a pull request;
 *   4. `gh` (installed, and able to read this repository) — no pull request, no branch;
 *   5. the one value applied to that text by **the same step `workflow set --project` writes
 *      with** (`editProjectSetting`: it validates the value, raises `requires`, and refuses a
 *      setting that is not the project's) — never a second writer;
 *   6. the commit, made with git plumbing in the main checkout's own repository: the new text as
 *      a blob (`hash-object -w --stdin`, so no clean filter changes a byte), the `.claude` tree
 *      and the root tree with that one entry replaced (`mktree`), and `commit-tree` on the base
 *      (the person's git identity; `-S` when `commit.gpgSign` is on, since `commit-tree` does not
 *      read it). No worktree, no checkout and no index: the person's working copy is never
 *      touched, and none of the project's git hooks runs — a hook that needs the project's
 *      installed packages cannot stop it, and the review and CI are its gate (`MADE_WITHOUT_HOOKS`);
 *   7. the push to a new branch `worktree-workflow-<setting>-<YYYYMMDD>` (a second change the same
 *      day takes `-2`), with `--no-verify` and an empty lease, so a name that is already on
 *      origin is refused, never overwritten; then `gh pr create` into the base with a short body
 *      saying what changed, that it counts once merged, and how the commit was made;
 *   8. the pull request's URL, or with `--json` one `ProposedJson` line.
 *
 * **Nothing is left half-made.** A step that fails after the push removes the branch from origin
 * again — only while it still holds this run's commit — and the one line says what is left if
 * that fails. A push that failed or was ended is asked about on origin before the line says
 * nothing is left. Two exceptions, both to avoid destroying what may be someone else's: a
 * `gh pr create` that does not answer in time leaves the pushed branch (the pull request may
 * exist), and a name another proposal took between the check and the push is skipped for the
 * next free one, never reused.
 */
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { runGit, runGitRaw } from "../hooks/git";
import { type CcSmartDevKitConfig, parseCcSmartDevKitConfig } from "../project/config";
import { type Checkout, CONFIG_PATH, loadProjectConfig, locateCheckout } from "../project/resolve";
import { worktreeBranch } from "../worktrees/paths";
import { GH_TIMEOUT_MS, type GhRunner, ghMissing, spawnGh } from "./merge-check";
import { type ResolvedWorkflow, resolvedValueOf, resolveWorkflow } from "./resolve";
import { isProjectKey, PERSONAL_ONLY_REASONS, showValue, type WorkflowKey } from "./schema";
import { editProjectSetting, type ProjectEdit } from "./write";

type Env = Record<string, string | undefined>;

/** How long `git fetch` and `ls-remote` may take: a network call to the remote. */
const FETCH_TIMEOUT_MS = 60_000;

/** How long `commit-tree` may take: with `-S`, git waits for the person's signing program. */
const COMMIT_TIMEOUT_MS = 120_000;

/** How long a push may take: a network call, and the remote's own hooks. */
const PUSH_TIMEOUT_MS = 120_000;

/** A local git call that reads or writes an object or a ref: milliseconds, never a hang. */
const QUICK_GIT_TIMEOUT_MS = 10_000;

/** How long `gh pr create` may take: a write, so longer than a read — see `createPullRequest`. */
const GH_CREATE_TIMEOUT_MS = 60_000;

/**
 * The longest a run can take, from its own step limits: the `gh` read, the fetch, two `ls-remote`
 * and two pushes (a name taken once), the commit, `gh pr create`, and then the take-back (an
 * `ls-remote` and the remote branch's deletion), a few local object and ref calls, plus the
 * process's own start. A caller that runs the command in a child gives it **at least this**, so
 * the command's own limits always fire — and its take-back always runs — before the child is
 * ended from outside (the portal's action, `src/portal/actions.ts`).
 */
export const PROPOSE_WORST_CASE_MS =
  GH_TIMEOUT_MS +
  FETCH_TIMEOUT_MS +
  2 * FETCH_TIMEOUT_MS +
  COMMIT_TIMEOUT_MS +
  2 * PUSH_TIMEOUT_MS +
  GH_CREATE_TIMEOUT_MS +
  FETCH_TIMEOUT_MS +
  PUSH_TIMEOUT_MS +
  10 * QUICK_GIT_TIMEOUT_MS +
  30_000;

/** A setting as a name's part: `alerts.sound` is `alerts-sound`. */
function settingSlug(key: string): string {
  return key.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The line a caller shows when it ended the child at `PROPOSE_WORST_CASE_MS` anyway: the run may
 * have stopped anywhere, so the line says where to look.
 */
export function proposeTimeoutLine(setting: string): string {
  return `workflow propose did not answer in time, so it may have pushed a branch (${worktreeBranch(`workflow-${settingSlug(setting)}`)}-…) or opened the pull request: look at the project's pull requests and its branches on origin before running it again.`;
}

/** How many names a taken branch may push the new one to before the command gives up. */
const NAME_TRIES = 50;

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

/**
 * What a proposal's commit is not: it is made by git plumbing, so none of the project's own git
 * hooks ran on it. Said in the command's output, the pull request's body and the portal's card.
 */
export const MADE_WITHOUT_HOOKS =
  "The commit was made without the project's git hooks: a line a hook adds (such as a sign-off) is missing, and a clean filter on the file did not run. The review and CI are its gate.";

/**
 * The one line `--json` prints when the pull request is open, and nothing else: the contract the
 * portal reads (`src/portal/actions.ts`). An unset value is `null`. On any refusal no JSON is
 * printed, so a URL never comes out of a failure.
 */
export interface ProposedJson {
  branch: string;
  from: unknown;
  setting: WorkflowKey;
  to: unknown;
  url: string;
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

/** The day a name carries, in UTC so every machine names the same day the same way. */
function dayStamp(now: number): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

/**
 * The branches of `origin` whose name starts with `prefix`, in **one** network call: a
 * teammate's proposal of the same setting the same day is skipped before the push. A call that
 * cannot answer (no network) counts as none — the push's lease still refuses a taken name — and
 * the run keeps its one bound on the network (`FETCH_TIMEOUT_MS`).
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

/** True when neither this repository nor origin (`taken`) has a branch of that name. */
function nameFree(repo: string, branch: string, env: Env, taken: ReadonlySet<string>): boolean {
  if (taken.has(branch)) return false;
  return !runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  ).ok;
}

/**
 * The first free branch name from `wanted` on: the same day's second change is `-2`, then `-3`.
 * The `worktree-` prefix stays though no worktree is made: proposals pushed before the
 * plumbing commit carry it, so one prefix finds every proposal of a day and keeps the count
 * going across both.
 */
function freeBranch(repo: string, wanted: string, env: Env): string {
  const first = worktreeBranch(wanted);
  const taken = remoteBranches(repo, first, env);
  if (nameFree(repo, first, env, taken)) return first;
  for (let count = 2; count <= NAME_TRIES; count += 1) {
    const branch = worktreeBranch(`${wanted}-${count}`);
    if (nameFree(repo, branch, env, taken)) return branch;
  }
  return first;
}

/**
 * `origin/<base>`'s commit and the project file's text in it, exactly as committed (no trim, no
 * filter); `text` null when that commit has no such file. Everything a run reads of the base —
 * the value it changes, the text it edits, the parent and the trees of its commit — comes from
 * this one commit, so a fetch in another process cannot mix two. A file that is not a plain
 * file there — a symbolic link, a folder — is refused: the commit could only replace the link,
 * never change what it points to.
 */
function baseFile(
  repo: string,
  base: string,
  env: Env,
): { sha: string; text: string | null } | { why: string } {
  const commit = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}^{commit}`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (!commit.ok) return { why: `origin/${base} is not known here` };
  const entry = runGitRaw(
    repo,
    ["ls-tree", "-z", commit.out, "--", CONFIG_PATH],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (!entry.ok) return { why: lastLine(entry.err) };
  if (entry.out === "") return { sha: commit.out, text: null };
  const blob = /^100(?:644|755) blob ([0-9a-f]+)\t/.exec(entry.out)?.[1];
  if (blob === undefined) return { why: "it is not a plain file there" };
  const text = runGitRaw(repo, ["cat-file", "blob", blob], env, QUICK_GIT_TIMEOUT_MS);
  return text.ok ? { sha: commit.out, text: text.out } : { why: lastLine(text.err) };
}

/** One entry of `git ls-tree -z`: `<mode> <type> <id>\t<name>`. */
interface TreeEntry {
  mode: string;
  type: string;
  id: string;
  name: string;
}

/** The entries of one tree, or git's reason it could not list them. */
function treeEntries(repo: string, tree: string, env: Env): TreeEntry[] | { why: string } {
  const listed = runGitRaw(repo, ["ls-tree", "-z", tree], env, QUICK_GIT_TIMEOUT_MS);
  if (!listed.ok) return { why: lastLine(listed.err) };
  return listed.out
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode = "", type = "", id = ""] = entry.slice(0, tab).split(" ");
      return { mode, type, id, name: entry.slice(tab + 1) };
    });
}

/**
 * `tree` with the blob at `path` replaced by `blob`, every other entry — and the file's own
 * mode — as it was: one `mktree` per folder on the way, innermost first. `--missing`: the entries
 * come from trees that exist, and a partial clone need not hold their blobs. Answers the new
 * tree's id, or what went wrong.
 */
function treeWith(
  repo: string,
  tree: string,
  path: string[],
  blob: string,
  env: Env,
): string | { why: string } {
  const [name, ...rest] = path;
  const entries = treeEntries(repo, tree, env);
  if (!Array.isArray(entries)) return entries;
  const at = entries.find((entry) => entry.name === name);
  if (at === undefined || at.type !== (rest.length === 0 ? "blob" : "tree")) {
    return { why: `${name} is not where the base holds it` };
  }
  const id = rest.length === 0 ? blob : treeWith(repo, at.id, rest, blob, env);
  if (typeof id !== "string") return id;
  const text = entries
    .map((entry) => {
      const entryId = entry === at ? id : entry.id;
      return `${entry.mode} ${entry.type} ${entryId}\t${entry.name}\0`;
    })
    .join("");
  const made = runGit(repo, ["mktree", "-z", "--missing"], env, QUICK_GIT_TIMEOUT_MS, {}, text);
  return made.ok ? made.out : { why: `git mktree failed: ${lastLine(made.err)}` };
}

/** What the push answered: the branch is origin's now, the name was taken, or it failed. */
type Pushed = { ok: true } | { ok: false; taken: boolean; why: string };

/**
 * `sha` pushed as the new branch `branch` on origin. `--no-verify`: the project's own pre-push
 * hook needs what a session may not have, and the review and CI are this commit's gate. The
 * empty lease (`refs/heads/<branch>:` with no value) lets the push create the branch only: a name
 * that exists on origin is refused (`[rejected] (stale info)` in the porcelain line), never
 * overwritten. In English (`LC_ALL=C`), so the line reads the same in any locale.
 */
function pushBranch(repo: string, sha: string, branch: string, env: Env): Pushed {
  const ref = `refs/heads/${branch}`;
  const pushed = runGit(
    repo,
    ["push", "--no-verify", "--porcelain", `--force-with-lease=${ref}:`, "origin", `${sha}:${ref}`],
    env,
    PUSH_TIMEOUT_MS,
    { LC_ALL: "C" },
  );
  if (pushed.ok) return { ok: true };
  const line = pushed.out.split("\n").find((one) => one.startsWith("!\t") && one.includes(ref));
  if (line?.includes("(stale info)")) {
    return { ok: false, taken: true, why: `${branch} is already on origin` };
  }
  const said = line?.split("\t")[2];
  return { ok: false, taken: false, why: said ?? lastLine(pushed.err) };
}

/** What a take-back left: what is still there, and whether it deleted a pushed branch. */
interface TakenBack {
  deleted: boolean;
  left: string[];
}

/**
 * Removes this run's branch from origin, **only while it holds this run's commit**: a push that
 * failed or was ended may still have landed, so origin is asked first (`ls-remote`), and the
 * delete leases the branch at `sha` — a branch another run pushed under the name is never
 * deleted. `--no-verify` for the same reason as the push.
 */
function takeBack(repo: string, branch: string, sha: string, env: Env): TakenBack {
  const ref = `refs/heads/${branch}`;
  const listed = runGit(repo, ["ls-remote", "origin", ref], env, FETCH_TIMEOUT_MS);
  if (!listed.ok) {
    return {
      deleted: false,
      left: [`maybe the branch ${branch} on origin (git could not ask: ${lastLine(listed.err)})`],
    };
  }
  if (!listed.out.split("\n").some((line) => line.startsWith(`${sha}\t`))) {
    return { deleted: false, left: [] };
  }
  const gone = runGit(
    repo,
    ["push", "--no-verify", `--force-with-lease=${ref}:${sha}`, "origin", `:${ref}`],
    env,
    PUSH_TIMEOUT_MS,
  );
  return gone.ok
    ? { deleted: true, left: [] }
    : { deleted: false, left: [`the branch ${branch} on origin (${lastLine(gone.err)})`] };
}

/** The end of a failure's line: what was taken back, or what is left. */
function tailOf(back: TakenBack): string {
  if (back.left.length > 0) return `; what is left: ${back.left.join("; ")}`;
  return back.deleted
    ? "; the pushed branch was deleted from origin again; nothing was left behind"
    : "; nothing was left behind";
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

/** A raised `requires`, as the output and the body say it. */
function raisedLine(raised: NonNullable<ProjectEdit["raised"]>): string {
  return `requires ${JSON.stringify(raised.from ?? null)} -> ${JSON.stringify(raised.to)}`;
}

/** The pull request's body: what changed, why it counts only once merged, and how it was made. */
function bodyOf(
  key: WorkflowKey,
  from: unknown,
  to: unknown,
  base: string,
  raised: ProjectEdit["raised"],
): string {
  return [
    `Updated by \`${COMMAND} workflow propose\`: the project's workflow setting ${key}, from ${saidValue(key, from)} to ${saidValue(key, to)}.`,
    ...(raised === null
      ? []
      : [`It also raises ${raisedLine(raised)}: the file's fields need it.`]),
    `It counts once this pull request is merged into ${base}: merge-check reads the review gate from the file committed on the base, and a session's own checkout never counts.`,
    MADE_WITHOUT_HOOKS,
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
 * `gh pr create` in the project, with its own stderr kept for the refusal's line. A **timeout
 * is its own answer**: GitHub may have made the pull request just before the call was ended, and
 * taking the pushed branch back then would close it — so the caller leaves everything as it is.
 */
async function createPullRequest(
  repo: string,
  env: Env,
  args: string[],
  timeoutMs: number,
): Promise<Created> {
  try {
    const child = Bun.spawn(["gh", ...args], {
      cwd: repo,
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

/** The commit's options for signing: `-S` when `commit.gpgSign` is on, which `commit-tree` ignores. */
function signing(repo: string, env: Env): { sign: boolean } | { why: string } {
  const read = runGit(repo, ["config", "--type=bool", "commit.gpgSign"], env, QUICK_GIT_TIMEOUT_MS);
  // 1: the setting is not there, so commits are not signed.
  if (read.ok || read.code === 1) return { sign: read.ok && read.out === "true" };
  return { why: lastLine(read.err) };
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

  // A setting the project's own file cannot hold has nothing to propose: the writer would refuse
  // it only after a fetch and a `gh` call.
  if (!isProjectKey(key)) {
    return fail(
      `${key} is your own setting, not the project's, so there is nothing to propose: ${PERSONAL_ONLY_REASONS[key]} — change it with \`${COMMAND} workflow set ${key} <value>\`.`,
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
  const where = `origin/${base}:${CONFIG_PATH}`;
  const read = baseFile(repo, base, context.env);
  if ("why" in read) return fail(`git could not read ${where}: ${read.why}.`);
  if (read.text === null) {
    return fail(
      `origin/${base} has no ${CONFIG_PATH}: commit the project's file to ${base} and push it first — a change counts once it is merged.`,
    );
  }
  const { sha: baseSha, text: baseText } = read;
  let committed: CcSmartDevKitConfig;
  try {
    committed = parseCcSmartDevKitConfig(baseText, where);
  } catch (error) {
    return fail(reasonOf(error));
  }

  // 3. The value **as the base commits it**, never this checkout's working copy: an uncommitted
  //    edit here must not read as "already set", and a change that counts is one to the base.
  //    A value that is already there needs no pull request, and no gh to say so. Only a value
  //    the project's own file holds is ever a `from`: the person's defaults stay private.
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(context.paths, committed);
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

  // 5. The one value, applied to the same commit's text by the step `workflow set --project`
  //    writes with.
  let edit: ProjectEdit;
  try {
    edit = editProjectSetting(baseText, where, key, value);
  } catch (error) {
    return fail(reasonOf(error));
  }
  if (!edit.changed) {
    context.print(`${edit.line}; no branch or pull request was made.`);
    return 0;
  }

  // 6. The commit, by git plumbing: no worktree, no index, none of the project's hooks.
  const title = titleOf(key, from, value);
  const hashed = runGit(
    repo,
    ["hash-object", "-w", "--stdin"],
    context.env,
    QUICK_GIT_TIMEOUT_MS,
    {},
    edit.text,
  );
  if (!hashed.ok) {
    return fail(
      `git hash-object failed: ${lastLine(hashed.err)}. Nothing was committed or pushed.`,
    );
  }
  const tree = treeWith(repo, baseSha, CONFIG_PATH.split("/"), hashed.out, context.env);
  if (typeof tree !== "string") {
    return fail(`git could not build the tree for ${where}: ${tree.why}. Nothing was pushed.`);
  }
  const signed = signing(repo, context.env);
  if ("why" in signed) {
    return fail(
      `git could not read commit.gpgSign: ${signed.why}. Fix that setting, then try again. Nothing was pushed.`,
    );
  }
  const commit = runGit(
    repo,
    [
      "commit-tree",
      ...(signed.sign ? ["-S"] : []),
      tree,
      "-p",
      baseSha,
      "-m",
      title,
      "-m",
      MADE_WITHOUT_HOOKS,
    ],
    context.env,
    COMMIT_TIMEOUT_MS,
  );
  if (!commit.ok) {
    return fail(
      `git commit-tree failed: ${lastLine(commit.err)}. Check your git name and email (\`git config user.name\`, \`git config user.email\`)${signed.sign ? " and that git can sign your commits (commit.gpgSign is on)" : ""}, then try again. Nothing was pushed.`,
    );
  }
  const sha = commit.out;

  // 7. The push to a new branch, then the pull request.
  const wanted = `workflow-${settingSlug(key)}-${dayStamp(now())}`;
  let branch = freeBranch(repo, wanted, context.env);
  let pushed = pushBranch(repo, sha, branch, context.env);
  if (!pushed.ok && pushed.taken) {
    // A name another proposal pushed between the check and the push: one more free name, once.
    branch = freeBranch(repo, wanted, context.env);
    pushed = pushBranch(repo, sha, branch, context.env);
  }
  if (!pushed.ok) {
    const tail = pushed.taken
      ? "; nothing was left behind"
      : tailOf(takeBack(repo, branch, sha, context.env));
    return fail(
      `git push origin ${branch} failed: ${pushed.why}. Check that you may push to this repository, then try again${tail}`,
    );
  }
  const created = await createPullRequest(
    repo,
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
      bodyOf(key, from, value, base, edit.raised),
    ],
    context.createTimeoutMs ?? GH_CREATE_TIMEOUT_MS,
  );
  if (!created.ok) {
    if (created.timedOut) {
      // Not taken back: the pull request may already exist, and the pushed branch is its head.
      return fail(
        `gh pr create did not answer in time, so the pull request may be open: look at ${repo}'s pull requests on GitHub before running this again. The branch ${branch} is pushed.`,
      );
    }
    return fail(
      `gh pr create failed: ${created.why}. Check that gh is logged in (\`gh auth login\`) and that your account may open a pull request on this repository, then try again${tailOf(takeBack(repo, branch, sha, context.env))}`,
    );
  }

  if (options.json) {
    const proposed: ProposedJson = {
      branch,
      from: from ?? null,
      setting: key,
      to: value ?? null,
      url: created.url,
    };
    context.print(JSON.stringify(proposed));
    return 0;
  }
  context.print(`+ ${key} = ${saidValue(key, value)} in ${CONFIG_PATH}`);
  if (edit.raised !== null) {
    context.print(`+ ${raisedLine(edit.raised)} in ${CONFIG_PATH} (the file's fields need it)`);
  }
  context.print(`+ ${branch}, cut from origin/${base} and pushed`);
  context.print(`! ${MADE_WITHOUT_HOOKS}`);
  context.print(`+ pull request into ${base}: ${created.url}`);
  return 0;
}
