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
 * that fails. A push that failed or was ended may still have landed, so it is taken back the
 * same way, and the delete's own answer says whether anything was there. Two exceptions, both to
 * avoid destroying what may be someone else's: a `gh pr create` that does not answer in time,
 * or is ended by any other signal, leaves the pushed branch (the pull request may exist), and a
 * name another proposal took between the check and the push is skipped for the next free one,
 * never reused.
 */
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { messageOf } from "../error-message";
import { commitArgs, commitIn, runGit, runGitBytes } from "../hooks/git";
import {
  type Checkout,
  CONFIG_PATH,
  loadProjectConfig,
  locateCheckout,
  RESOLVE_GIT_TIMEOUT_MS,
  readCommittedFile,
} from "../project/resolve";
import { worktreeBranch } from "../worktrees/paths";
import { GH_TIMEOUT_MS, type GhRunner, ghMissing, runGh, spawnGh } from "./merge-check";
import { type ResolvedWorkflow, resolvedValueOf, resolveWorkflow } from "./resolve";
import { isProjectKey, PERSONAL_ONLY_REASONS, showValue, type WorkflowKey } from "./schema";
import { editProjectSetting, type ProjectEdit, requiresRaiseText } from "./write";

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

/** The trees on the way to the project's file: `treeWith` lists and rebuilds one at each level. */
const TREE_LEVELS = CONFIG_PATH.split("/").length;

/**
 * The local git calls one run makes at most, each held to `QUICK_GIT_TIMEOUT_MS`, in the order it
 * makes them: the base's commit, the committed file's three reads (`readCommittedFile`), the
 * blob, a listing and a `mktree` per tree level, `commit.gpgSign`, the push URL, and the local
 * branch list once per name pick (twice, when a name is taken once).
 */
const QUICK_GIT_CALLS = 1 + 3 + 1 + 2 * TREE_LEVELS + 1 + 1 + 2;

/**
 * The longest a run can take, from its own step limits, in the order the run meets them: finding
 * the checkout (`rev-parse`, and `worktree list` from a worktree), the fetch, the `gh` read, the
 * commit, then up to two name picks and pushes (an `ls-remote` and a push each, when a name is
 * taken once), `gh pr create`, the take-back (the remote branch's leased deletion), every quick
 * local call, and the process's own start. A caller that runs the command in a child gives it
 * **at least this**, so the command's own limits always fire — and its take-back always runs —
 * before the child is ended from outside (the portal's action, `src/portal/actions.ts`).
 */
export const PROPOSE_WORST_CASE_MS =
  2 * RESOLVE_GIT_TIMEOUT_MS +
  FETCH_TIMEOUT_MS +
  GH_TIMEOUT_MS +
  COMMIT_TIMEOUT_MS +
  2 * (FETCH_TIMEOUT_MS + PUSH_TIMEOUT_MS) +
  GH_CREATE_TIMEOUT_MS +
  PUSH_TIMEOUT_MS +
  QUICK_GIT_CALLS * QUICK_GIT_TIMEOUT_MS +
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

/** The day a name carries, in UTC so every machine names the same day the same way. */
function dayStamp(now: number): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

/**
 * The branches at `pushUrl` (where the push goes, a separate `pushurl` included) whose name
 * starts with `prefix`, in **one** network call: a teammate's proposal of the same setting the
 * same day is skipped before the push. A call that cannot answer (no network) counts as none —
 * the push's lease still refuses a taken name — and the run keeps its one bound on the network
 * (`FETCH_TIMEOUT_MS`).
 */
function remoteBranches(repo: string, pushUrl: string, prefix: string, env: Env): Set<string> {
  const listed = runGit(
    repo,
    ["ls-remote", "--heads", pushUrl, `${prefix}*`],
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

/**
 * This repository's own branches whose name starts with `prefix`, in one local call. A list that
 * cannot be read counts as none: the push's lease still guards the name on origin.
 */
function localBranches(repo: string, prefix: string, env: Env): string[] {
  const listed = runGit(
    repo,
    ["for-each-ref", "--format=%(refname:lstrip=2)", `refs/heads/${prefix}*`],
    env,
    QUICK_GIT_TIMEOUT_MS,
  );
  return listed.ok ? listed.out.split("\n").filter((name) => name !== "") : [];
}

/**
 * The first free branch name from `wanted` on: the same day's second change is `-2`, then `-3`.
 * A name is taken when origin or this repository has it, each asked once, or when it is in
 * `refused` (a name the push was refused under, which the listing may not show: a listing that
 * cannot answer shows none). Null when all `NAME_TRIES` are taken.
 * The `worktree-` prefix stays though no worktree is made: proposals pushed before the plumbing
 * commit carry it, so one prefix finds every proposal of a day and keeps the count going across
 * both.
 */
function freeBranch(
  repo: string,
  pushUrl: string,
  wanted: string,
  env: Env,
  refused: ReadonlySet<string> = new Set(),
): string | null {
  const first = worktreeBranch(wanted);
  const taken = remoteBranches(repo, pushUrl, first, env);
  for (const name of [...localBranches(repo, first, env), ...refused]) taken.add(name);
  if (!taken.has(first)) return first;
  for (let count = 2; count <= NAME_TRIES; count += 1) {
    const branch = worktreeBranch(`${wanted}-${count}`);
    if (!taken.has(branch)) return branch;
  }
  return null;
}

/** The bytes a tree entry's name is matched by: names are bytes, and a path's part is UTF-8. */
const encoder = new TextEncoder();

/** One entry of `git ls-tree -z`, `<mode> <type> <id>\t<name>`: the header read, the rest bytes. */
interface TreeEntry {
  mode: string;
  type: string;
  id: string;
  /** The name exactly as git holds it: any bytes but NUL and `/`, not always UTF-8. */
  name: Uint8Array;
  /** The whole entry as git listed it, without its NUL. */
  bytes: Uint8Array;
}

/** The entries of one tree, kept as bytes, or git's reason it could not list them. */
function treeEntries(repo: string, tree: string, env: Env): TreeEntry[] | { why: string } {
  const listed = runGitBytes(repo, ["ls-tree", "-z", tree], env, QUICK_GIT_TIMEOUT_MS);
  if (!listed.ok) return { why: lastLine(listed.err) };
  const entries: TreeEntry[] = [];
  let start = 0;
  for (let end = listed.out.indexOf(0); end !== -1; end = listed.out.indexOf(0, start)) {
    const bytes = listed.out.subarray(start, end);
    const tab = bytes.indexOf(0x09);
    // The header is ASCII: a mode, a type and an id.
    const [mode = "", type = "", id = ""] = new TextDecoder()
      .decode(bytes.subarray(0, tab))
      .split(" ");
    entries.push({ mode, type, id, name: bytes.subarray(tab + 1), bytes });
    start = end + 1;
  }
  return entries;
}

/** `a` and `b` hold the same bytes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * `tree` with the blob at `path` replaced by `blob`: one `mktree` per folder on the way,
 * innermost first. Only that one entry's id changes; every other entry goes back to git byte for
 * byte, so a name that is not UTF-8 keeps its name, and the file keeps its own mode. A symbolic
 * link at `path` is refused: the commit could only replace the link, never change what it points
 * to. `--missing`: the entries come from trees that exist, and a partial clone need not hold
 * their blobs. Answers the new tree's id, or what went wrong.
 */
function treeWith(
  repo: string,
  tree: string,
  path: string[],
  blob: string,
  env: Env,
): string | { why: string } {
  const [name = "", ...rest] = path;
  const entries = treeEntries(repo, tree, env);
  if (!Array.isArray(entries)) return entries;
  const wanted = encoder.encode(name);
  const at = entries.find((entry) => sameBytes(entry.name, wanted));
  const isFile = rest.length === 0;
  if (at === undefined || at.type !== (isFile ? "blob" : "tree") || at.mode === "120000") {
    return { why: `${name} is not a plain ${isFile ? "file" : "folder"} on the base` };
  }
  const id = isFile ? blob : treeWith(repo, at.id, rest, blob, env);
  if (typeof id !== "string") return id;
  const header = encoder.encode(`${at.mode} ${at.type} ${id}\t`);
  const nul = new Uint8Array([0]);
  const parts = entries.flatMap((entry) =>
    entry === at ? [header, entry.name, nul] : [entry.bytes, nul],
  );
  const made = runGitBytes(
    repo,
    ["mktree", "-z", "--missing"],
    env,
    QUICK_GIT_TIMEOUT_MS,
    Buffer.concat(parts),
  );
  return made.ok
    ? new TextDecoder().decode(made.out).trim()
    : { why: `git mktree failed: ${lastLine(made.err)}` };
}

/**
 * What `git push --porcelain` said of `ref`: its flag (`*` new, `-` deleted, `!` refused, …) and
 * its summary (`[rejected] (stale info)`); null when it printed no line for it (git stopped
 * first). The line, not the exit code, says what happened to the ref: a push can land and still
 * exit non-zero, when something after the ref update fails.
 */
function pushedRef(out: string, ref: string): { flag: string; summary: string } | null {
  for (const line of out.split("\n")) {
    const [flag = "", refs, summary = ""] = line.split("\t");
    if (refs?.endsWith(`:${ref}`)) return { flag, summary };
  }
  return null;
}

/** The lease refused the update: origin's ref is not what the lease expected. */
const LEASE_REFUSED = "(stale info)";

/** What the push answered: the branch is origin's now, the name was taken, or it failed. */
type Pushed = { ok: true } | { ok: false; taken: boolean; why: string };

/**
 * `sha` pushed as the new branch `branch` on origin. `--no-verify`: the project's own pre-push
 * hook needs what a session may not have, and the review and CI are this commit's gate. The
 * empty lease (`refs/heads/<branch>:` with no value) lets the push create the branch only: a name
 * that exists on origin is refused (`[rejected] (stale info)` in the porcelain line), never
 * overwritten. Each run's commit is its own (`Proposal-Id`), so a lease only ever matches this
 * run's push. In English (`LC_ALL=C`), so the line reads the same in any locale.
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
  const line = pushedRef(pushed.out, ref);
  if (line?.flag === "*") return { ok: true };
  if (line?.flag === "!" && line.summary.includes(LEASE_REFUSED)) {
    return { ok: false, taken: true, why: `${branch} is already on origin` };
  }
  return { ok: false, taken: false, why: line?.summary ?? lastLine(pushed.err) };
}

/** What a take-back left: what is still there, and whether it deleted a pushed branch. */
interface TakenBack {
  deleted: boolean;
  left: string[];
}

/**
 * Removes this run's branch from origin, **only while it holds this run's commit**: the delete
 * leases the branch at `sha`, so a branch another run pushed under the name is never deleted. It
 * goes where the push went (a separate `pushurl` included), and a push that failed or was ended
 * may still have landed, so the delete is always sent and its porcelain line says what was there:
 * `-` deleted; refused at the lease, so origin never held this run's commit there; anything else
 * may have left it. `--no-verify` for the same reason as the push.
 */
function takeBack(repo: string, branch: string, sha: string, env: Env): TakenBack {
  const ref = `refs/heads/${branch}`;
  const gone = runGit(
    repo,
    ["push", "--no-verify", "--porcelain", `--force-with-lease=${ref}:${sha}`, "origin", `:${ref}`],
    env,
    PUSH_TIMEOUT_MS,
    { LC_ALL: "C" },
  );
  const line = pushedRef(gone.out, ref);
  if (line?.flag === "-") return { deleted: true, left: [] };
  if (line?.flag === "!" && line.summary.includes(LEASE_REFUSED)) {
    return { deleted: false, left: [] };
  }
  return {
    deleted: false,
    left: [`maybe the branch ${branch} on origin (${line?.summary ?? lastLine(gone.err)})`],
  };
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
    ...(raised === null ? [] : [`It also raises ${requiresRaiseText(raised)}.`]),
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
 * `gh pr create` in the project, with its own stderr kept for the refusal's line. **An end by a
 * signal is its own answer**, a timeout or gh dying alike: GitHub may have made the pull request
 * just before the call was ended, and taking the pushed branch back then would close it — so the
 * caller leaves everything as it is. A gh that never started made nothing, so it is a refusal.
 */
async function createPullRequest(
  repo: string,
  env: Env,
  args: string[],
  timeoutMs: number,
): Promise<Created> {
  const { err, kind, out, signal } = await runGh(args, { env, folder: repo, timeoutMs });
  if (kind === "timeout") return { ok: false, timedOut: true, why: "did not answer in time" };
  if (signal !== undefined) return { ok: false, timedOut: true, why: `was stopped by ${signal}` };
  if (kind !== "ok") return { ok: false, timedOut: false, why: lastLine(err) };
  const url = urlIn(out);
  return url === null
    ? { ok: false, timedOut: false, why: `gh printed no pull request URL (${lastLine(out)})` }
    : { ok: true, url };
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
    return fail(messageOf(error));
  }
  if (checkout === null) {
    return fail(`${context.folder} is not in a git project: run this inside the project.`);
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  let loaded: ReturnType<typeof loadProjectConfig>;
  try {
    loaded = loadProjectConfig(checkout);
  } catch (error) {
    return fail(messageOf(error));
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
  // Every later read of the base is of this one commit: a fetch in another process cannot give
  // the run two.
  const baseCommit = runGit(
    repo,
    commitArgs(`refs/remotes/origin/${base}`),
    context.env,
    QUICK_GIT_TIMEOUT_MS,
  );
  const baseSha = commitIn(baseCommit);
  if (baseSha === null) {
    return fail(`origin/${base} is not known here after the fetch: ${lastLine(baseCommit.err)}.`);
  }
  let committed: ReturnType<typeof readCommittedFile>;
  try {
    committed = readCommittedFile(checkout, base, {
      commit: baseSha,
      env: context.env,
      timeoutMs: QUICK_GIT_TIMEOUT_MS,
    });
  } catch (error) {
    return fail(messageOf(error));
  }
  if (!committed.found) {
    return fail(
      `origin/${base} has no ${CONFIG_PATH}: commit the project's file to ${base} and push it first — a change counts once it is merged.`,
    );
  }
  const { text: baseText, where } = committed;

  // 3. The value **as the base commits it**, never this checkout's working copy: an uncommitted
  //    edit here must not read as "already set", and a change that counts is one to the base.
  //    A value that is already there needs no pull request, and no gh to say so. Only a value
  //    the project's own file holds is ever a `from`: the person's defaults stay private.
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(context.paths, committed.config);
  } catch (error) {
    return fail(messageOf(error));
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
    return fail(messageOf(error));
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
      // This run's own id, so two runs of one proposal in one second never make one commit: a
      // lease at this run's commit then matches only this run's push.
      "-m",
      `Proposal-Id: ${crypto.randomUUID()}`,
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
  const allTaken = `all ${NAME_TRIES} branch names for ${key} today (${worktreeBranch(wanted)} to ${worktreeBranch(`${wanted}-${NAME_TRIES}`)}) are taken, here or on origin: delete the proposal branches you no longer need, then run it again. Nothing was pushed.`;
  const pushUrl = runGit(
    repo,
    ["remote", "get-url", "--push", "origin"],
    context.env,
    QUICK_GIT_TIMEOUT_MS,
  );
  if (!pushUrl.ok) {
    return fail(
      `git remote get-url --push origin failed: ${lastLine(pushUrl.err)}. Check the origin remote (\`git remote -v\`), then try again. Nothing was pushed.`,
    );
  }
  let branch = freeBranch(repo, pushUrl.out, wanted, context.env);
  if (branch === null) return fail(allTaken);
  let pushed = pushBranch(repo, sha, branch, context.env);
  if (!pushed.ok && pushed.taken) {
    // A name another proposal pushed between the check and the push: one more free name, once.
    const refused = branch;
    branch = freeBranch(repo, pushUrl.out, wanted, context.env, new Set([refused]));
    if (branch === null) return fail(allTaken);
    pushed = pushBranch(repo, sha, branch, context.env);
    if (!pushed.ok && pushed.taken) {
      return fail(
        `the branch names ${refused} and ${branch} were both taken on origin while this proposal ran: other proposals of ${key} are being pushed now. Nothing was pushed; run it again in a moment.`,
      );
    }
  }
  if (!pushed.ok) {
    return fail(
      `git push origin ${branch} failed: ${pushed.why}. Check that you may push to this repository, then try again${tailOf(takeBack(repo, branch, sha, context.env))}`,
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
        `gh pr create ${created.why}, so the pull request may be open: look at ${repo}'s pull requests on GitHub before running this again. The branch ${branch} is pushed.`,
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
    context.print(`+ ${CONFIG_PATH}: ${requiresRaiseText(edit.raised)}`);
  }
  context.print(`+ ${branch}, cut from origin/${base} and pushed`);
  context.print(`! ${MADE_WITHOUT_HOOKS}`);
  context.print(`+ pull request into ${base}: ${created.url}`);
  return 0;
}
