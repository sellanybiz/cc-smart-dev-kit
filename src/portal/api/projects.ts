import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { COMMAND } from "../../build-info";
import type { CliPaths } from "../../cli/paths";
import { GUARD_GIT_TIMEOUT_MS, parseWorktreeList, runGitAsync, samePath } from "../../hooks/git";
import type { Env } from "../../hooks/run";
import { type CcSmartDevKitConfig, loadCcSmartDevKitConfig } from "../../project/config";
import { CONFIG_PATH, locateCheckoutAsync } from "../../project/resolve";
import { sessionWorkFolderTimes } from "../../sessions/command";
import { withLock } from "../../setup/lock";
import { atomicWrite } from "../../setup/write";
import { checkoutOfAsync } from "../../update/retired-repos";
import {
  type MergeVerdict as CheckVerdict,
  checkPullRequest,
  defaultBranchOf,
  GH_TIMEOUT_MS,
  type GhRunner,
  ghMissing,
  type MergeWorld,
  spawnGh,
} from "../../workflow/merge-check";
import { type GhLoginState, ghLoginState } from "../../workflow/propose";
import { type GateRead, resolvedValueOf, resolveGateAsync } from "../../workflow/resolve";
import { isProjectKey, showValue, WORKFLOW_KEYS } from "../../workflow/schema";
import { projectCardData, projectFiles } from "../facts";
import type { PageDataDeps } from "../page-data";
import type {
  ProjectAnswer,
  ProjectBranch,
  ProjectSummary,
  ProjectsAnswer,
  ProjectWorkflowAnswer,
} from "./types";
import { mergeVerdictOf } from "./work";

/** How many hex characters of the root's hash name a project: short, stable, one helper. */
export const PROJECT_ID_HEX = 12;

/** One project's id: a short hash of its main checkout's root. */
export function projectId(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, PROJECT_ID_HEX);
}

/** How long one project's branch answer is kept: about a minute, in the server's memory. */
export const PROJECT_BRANCHES_CACHE_MS = 60_000;

/** One deadline for a whole page's branches: past it a verdict is `late`, never a guess. */
export const PROJECT_BRANCHES_DEADLINE_MS = 8_000;

/** How long the list itself is kept: the page, a project's page and an action share one scan. */
export const PROJECTS_LIST_CACHE_MS = 10_000;

/** How many pull request verdicts one page reads at once: enough to overlap, never a flood of gh. */
export const PROJECT_VERDICTS_AT_ONCE = 4;

/**
 * How many of the list's projects have their git reads run at once. Each project runs up to
 * two git children (its worktree list, and the status of its two files), so a home with many
 * projects never starts a hundred git processes together.
 */
export const PROJECT_GIT_AT_ONCE = 8;

/**
 * Runs `read` over `items`, at most `atOnce` at a time, and answers in the items' own order:
 * a slow read never holds up the others, and the cap keeps the children from flooding.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  atOnce: number,
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      if (index >= items.length) return;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      answers[index] = await read(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, () => worker()));
  return answers;
}

/** What the list and one page are read from: the portal's own paths, folder, clock and gh. */
export interface ProjectsWorld {
  /** The folder the portal was started in: the row that is `current`. */
  cwd: string;
  env: Env;
  now: () => number;
  paths: CliPaths;
  /** How gh runs (`spawnGh` in use, a test's fake otherwise). */
  gh?: GhRunner;
}

/** The world a `PageDataDeps` gives: the portal's context, and the folder it runs in. */
export function projectsWorldOf(deps: PageDataDeps): ProjectsWorld {
  return {
    cwd: deps.action.cwd,
    env: deps.action.portal.env,
    now: deps.action.portal.now,
    paths: deps.action.portal.paths,
  };
}

/** The state file's shape: the roots the person added, and the schema version that wrote it. */
interface AddedProjects {
  roots: string[];
  version: number;
}

const ADDED_VERSION = 1;

/**
 * The roots the person added to the page, in the order they were added. A file that is
 * missing, not JSON, or not the shape above is no list: nothing was added there. Never throws.
 */
export function readAddedProjects(paths: CliPaths): string[] {
  let text: string;
  try {
    text = readFileSync(paths.portalProjectsFile, "utf8");
  } catch {
    // No file yet: no folder was added.
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const roots = (parsed as { roots?: unknown }).roots;
  if (!Array.isArray(roots)) return [];
  return roots.filter((one): one is string => typeof one === "string" && one.trim() !== "");
}

/** Writes the added roots whole, atomically, under the state folder's own rules (0600). */
function writeAddedProjects(paths: CliPaths, roots: string[]): void {
  const file = paths.portalProjectsFile;
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  const value: AddedProjects = { roots, version: ADDED_VERSION };
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

/**
 * Adds one main checkout root to the list file, or says it is already there. The read and the
 * write run under the state folder's lock, so two clicks (or another action) never drop one.
 */
export async function addProjectRoot(
  paths: CliPaths,
  root: string,
): Promise<{ added: boolean; roots: string[] }> {
  const result = await withLock(
    paths.stateDir,
    () => {
      const roots = readAddedProjects(paths);
      if (roots.includes(root)) return { added: false, roots };
      const next = [...roots, root];
      writeAddedProjects(paths, next);
      return { added: true, roots: next };
    },
    { waitMs: 10_000 },
  );
  // A new root is a new row: the page's next look must not be the list kept before it.
  if (result.added) forgetProjectsList();
  return result;
}

/** One project the list found: its main checkout, where it came from, and when it was used. */
interface FoundProject {
  /** The newest session record of it or its worktrees (ms); 0 when no session names it. */
  lastWrite: number;
  root: string;
  source: ProjectSummary["source"];
}

/**
 * Every repository the person works in, newest use first: the session records' folders (a
 * worktree folded into its main checkout) plus the person's added folders. Folders that are
 * gone or not in git are skipped.
 */
async function foundProjects(
  world: ProjectsWorld,
): Promise<{ found: FoundProject[]; records: number }> {
  const worked = sessionWorkFolderTimes(world.paths.projectsDir);
  const byRoot = new Map<string, FoundProject>();
  // A few folders at a time: one checkout read each, never one after another, and never all
  // of them at once on a machine with many projects (`PROJECT_GIT_AT_ONCE`).
  await mapLimit(worked, PROJECT_GIT_AT_ONCE, async ({ folder, lastWrite }) => {
    const checkout = await checkoutOfAsync(folder, world.env);
    if (checkout === null) return;
    const known = byRoot.get(checkout.main);
    byRoot.set(checkout.main, {
      lastWrite: Math.max(known?.lastWrite ?? 0, lastWrite),
      root: checkout.main,
      source: "sessions",
    });
  });
  const added = readAddedProjects(world.paths);
  await mapLimit(added, PROJECT_GIT_AT_ONCE, async (folder) => {
    const checkout = await checkoutOfAsync(folder, world.env);
    if (checkout === null) return;
    const known = byRoot.get(checkout.main);
    // A folder that is also a session's stays one row; the session records are the first
    // source, so they name it, and its newest use is theirs.
    if (known !== undefined) return;
    byRoot.set(checkout.main, { lastWrite: 0, root: checkout.main, source: "added" });
  });
  return { found: [...byRoot.values()], records: worked.length };
}

/** One `git worktree list --porcelain` read: its linked worktrees, the main checkout not counted. */
async function linkedWorktrees(root: string, env: Env): Promise<null | number> {
  const listed = await runGitAsync(root, ["worktree", "list", "--porcelain"], env);
  if (!listed.ok) return null;
  return parseWorktreeList(listed.out).filter((one) => !samePath(one.path, root)).length;
}

/**
 * True when either of the project's two files (the setup file and Claude Code's settings)
 * differs from HEAD or is not committed at all; false when both are clean; null when git
 * could not tell. A project with neither file is false: there is nothing uncommitted.
 */
async function uncommittedProject(root: string, env: Env): Promise<null | boolean> {
  const files = projectFiles(root);
  const status = await runGitAsync(
    root,
    [
      "--no-optional-locks",
      "status",
      "--porcelain",
      "--",
      relative(root, files.config),
      relative(root, files.settings),
    ],
    env,
  );
  return status.ok ? status.out !== "" : null;
}

/** One project's row: its two file facts, its worktrees and its newest use. */
async function summaryOf(
  found: FoundProject,
  world: ProjectsWorld,
  currentRoot: null | string,
): Promise<ProjectSummary> {
  const files = projectFiles(found.root);
  const set = existsSync(files.config);
  // The two git reads of one project run together, never one after the other.
  const [worktrees, uncommitted] = await Promise.all([
    linkedWorktrees(found.root, world.env),
    uncommittedProject(found.root, world.env),
  ]);
  return {
    configFile: set ? files.config : null,
    current: currentRoot !== null && samePath(found.root, currentRoot),
    id: projectId(found.root),
    lastUsed: found.lastWrite > 0 ? new Date(found.lastWrite).toISOString() : null,
    name: basename(found.root),
    root: found.root,
    set,
    source: found.source,
    uncommitted,
    worktrees,
  };
}

/** The list `/api/projects` sends: the rows, and why it is short when it is. */
export interface ProjectList {
  note: null | string;
  projects: ProjectSummary[];
}

/** Why the list holds only the added folders: Claude Code has no session records here. */
export const NO_SESSION_RECORDS =
  "Claude Code has saved no session records on this machine yet, so this list holds only the folders you added.";

/** One kept list, and when it was read. */
interface KeptList {
  at: number;
  list: ProjectList;
}

/** The server's own memory of the list (`PROJECTS_LIST_CACHE_MS`), by what it answers for. */
const keptLists = new Map<string, KeptList>();

/** The scans still running, by the same key: a second look at once waits for the same one. */
const readingLists = new Map<string, Promise<KeptList>>();

/**
 * Changes when the kept list is dropped. A scan that started before the drop keeps nothing
 * when it ends: a `project.add` or a `project.write` is never undone by a read already running.
 */
let listGeneration = 0;

/**
 * What one kept list answers for: the folder it calls `current`, the paths it reads, and the
 * PATH its git children run with. Two worlds that differ in any of them get two lists.
 */
function projectsListKey(world: ProjectsWorld): string {
  return [
    world.cwd,
    world.paths.stateDir,
    world.paths.projectsDir,
    world.paths.portalProjectsFile,
    world.env.PATH ?? "",
  ].join("\u0000");
}

/** Forgets the kept list: a project added, a project file written, or a test that moves the clock. */
export function forgetProjectsList(): void {
  listGeneration += 1;
  keptLists.clear();
  readingLists.clear();
}

/**
 * Every project the person works in, newest use first, and why the list may be short. Kept for
 * `PROJECTS_LIST_CACHE_MS`: the list page, a project's page and the `project.*` actions share
 * one scan, and two looks at once share the scan already running.
 */
export async function projectsList(world: ProjectsWorld): Promise<ProjectList> {
  const key = projectsListKey(world);
  const at = world.now();
  const kept = keptLists.get(key);
  if (kept !== undefined && at - kept.at < PROJECTS_LIST_CACHE_MS) return kept.list;
  let reading = readingLists.get(key);
  if (reading === undefined) {
    const generation = listGeneration;
    const scan = scanProjects(world).then((list) => {
      const answer = { at, list };
      if (generation === listGeneration) keptLists.set(key, answer);
      return answer;
    });
    reading = scan;
    readingLists.set(key, scan);
    // The caller gets a failed scan; this chain only clears the entry (and only its own).
    scan
      .finally(() => {
        if (readingLists.get(key) === scan) readingLists.delete(key);
      })
      .catch(() => undefined);
  }
  return (await reading).list;
}

/** One scan of every repository: the answer `projectsList` keeps. */
async function scanProjects(world: ProjectsWorld): Promise<ProjectList> {
  const { found, records } = await foundProjects(world);
  const here = await checkoutOfAsync(world.cwd, world.env);
  const currentRoot = here?.main ?? null;
  // A few projects at a time (`PROJECT_GIT_AT_ONCE`): each reads its worktrees and its files.
  const projects = await mapLimit(found, PROJECT_GIT_AT_ONCE, (one) =>
    summaryOf(one, world, currentRoot),
  );
  projects.sort(
    (a, b) =>
      (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") ||
      a.name.localeCompare(b.name) ||
      a.root.localeCompare(b.root),
  );
  return { note: records === 0 ? NO_SESSION_RECORDS : null, projects };
}

/** One open pull request, from `gh pr list --json` (the facts a verdict starts from). */
export interface OpenPullRequest {
  base: string;
  draft: boolean;
  head: string;
  number: number;
  title: null | string;
}

/** The open pull requests from `gh pr list`'s JSON, or null when it is not the shape asked for. */
export function parseOpenPullRequests(json: string): null | OpenPullRequest[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const pullRequests: OpenPullRequest[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) return null;
      const { baseRefName, headRefName, isDraft, number, title } = entry as Record<string, unknown>;
      if (typeof baseRefName !== "string" || typeof headRefName !== "string") return null;
      if (typeof number !== "number") return null;
      pullRequests.push({
        base: baseRefName,
        draft: isDraft === true,
        head: headRefName,
        number,
        title: typeof title === "string" ? title : null,
      });
    }
    return pullRequests;
  } catch {
    return null;
  }
}

/** One project's branch answer, and when it was read. */
export interface ProjectBranches {
  branches: ProjectBranch[];
  checkedAt: string;
  note: null | string;
}

/** What one read of a project's branches cost the person's patience, kept for a minute. */
interface KeptBranches {
  at: number;
  branches: ProjectBranch[];
  note: null | string;
}

/** The server's own memory of the branch answers, by project id (`PROJECT_BRANCHES_CACHE_MS`). */
const keptBranches = new Map<string, KeptBranches>();

/** The reads still running, by project id: a second look at once waits for the same one. */
const readingBranches = new Map<string, Promise<KeptBranches>>();

/** Forgets every kept branch answer: a test that moves the clock or changes gh's answers. */
export function forgetProjectBranches(): void {
  keptBranches.clear();
  readingBranches.clear();
}

export async function projectBranches(
  world: ProjectsWorld,
  project: ProjectSummary,
): Promise<ProjectBranches> {
  const at = world.now();
  const kept = keptBranches.get(project.id);
  if (kept !== undefined && at - kept.at < PROJECT_BRANCHES_CACHE_MS) {
    return {
      branches: kept.branches,
      checkedAt: new Date(kept.at).toISOString(),
      note: kept.note,
    };
  }
  let reading = readingBranches.get(project.id);
  if (reading === undefined) {
    reading = readBranches(world, project, at).then((read) => {
      const answer = { at, branches: read.branches, note: read.note };
      // A read the deadline cut short holds "not read yet": keeping it a minute would hide
      // the real answer, so only a read that finished in time is kept.
      if (world.now() < at + PROJECT_BRANCHES_DEADLINE_MS) {
        keptBranches.set(project.id, answer);
      }
      return answer;
    });
    readingBranches.set(project.id, reading);
    // The caller below gets a failed read; this chain only clears the entry, so its own copy
    // of the failure is not a second, unhandled one.
    reading.finally(() => readingBranches.delete(project.id)).catch(() => undefined);
  }
  const read = await reading;
  return { branches: read.branches, checkedAt: new Date(read.at).toISOString(), note: read.note };
}

/** The answer for the branches that could not be read: a verdict is never a guess. */
function unreadVerdict(number: null | number, what: string): CheckVerdict {
  return { kind: "unread", number, what };
}

async function readBranches(
  world: ProjectsWorld,
  project: ProjectSummary,
  at: number,
): Promise<{ branches: ProjectBranch[]; note: null | string }> {
  const deadline = at + PROJECT_BRANCHES_DEADLINE_MS;
  const timeFor = (limitMs: number): number => Math.min(limitMs, deadline - world.now());
  const gh = world.gh ?? spawnGh;
  const notes: string[] = [];

  // gh's open pull requests. A missing or failing gh is a soft note: the project settings
  // and the card are still worth showing (the rule: a page works without what it cannot read).
  let pullRequests: OpenPullRequest[] = [];
  if (timeFor(GH_TIMEOUT_MS) <= 0) {
    notes.push("the time to read this project's branches ran out");
  } else if (world.gh === undefined && ghMissing(world.env)) {
    notes.push("gh is not installed, so the open pull requests cannot be read");
  } else {
    const out = await gh(["pr", "list", "--json", "number,headRefName,baseRefName,title,isDraft"], {
      env: world.env,
      folder: project.root,
      timeoutMs: timeFor(GH_TIMEOUT_MS),
    });
    const parsed = out === null ? null : parseOpenPullRequests(out);
    if (parsed === null) {
      notes.push("gh could not list this project's open pull requests");
    } else {
      pullRequests = parsed;
    }
  }

  // The folder can have gone since it was listed: the branches are then not read at all, with
  // the reason, rather than throwing at the page.
  let checkout: Awaited<ReturnType<typeof locateCheckoutAsync>> = null;
  try {
    checkout = await locateCheckoutAsync(project.root, { env: world.env });
  } catch {
    checkout = null;
  }
  let mergeWorld: MergeWorld | null = null;
  if (checkout !== null) {
    // One policy read per branch for the whole page, under the one deadline.
    const gates = new Map<string, Promise<GateRead | "late">>();
    const gateOf = (branch: string): Promise<GateRead | "late"> => {
      const known = gates.get(branch);
      if (known !== undefined) return known;
      const read = (async (): Promise<GateRead | "late"> => {
        const left = timeFor(GUARD_GIT_TIMEOUT_MS);
        if (left <= 0) return "late";
        return await resolveGateAsync(world.paths, checkout, branch, {
          env: world.env,
          timeoutMs: left,
        });
      })();
      gates.set(branch, read);
      return read;
    };
    mergeWorld = {
      checkout,
      env: world.env,
      folder: project.root,
      gateOf,
      gh,
      paths: world.paths,
      timeFor,
    };
  }

  // One default branch for the whole page. It is asked here, before the verdicts run together:
  // `checkPullRequest` reads this map, and concurrent misses would each ask gh once. The key is
  // `checkPullRequest`'s own: the empty string is this folder's repository, as `repo: null` asks.
  const defaultBranches = new Map<string, string | null>();
  if (mergeWorld !== null && pullRequests.length > 0) {
    const left = timeFor(GH_TIMEOUT_MS);
    if (left > 0) {
      defaultBranches.set("", await defaultBranchOf(project.root, world.env, null, left, gh));
    }
  }

  // The pull requests' verdicts run a few at a time (`PROJECT_VERDICTS_AT_ONCE`), all under the
  // page's one deadline, and keep gh's own order.
  const branches = await mapLimit(
    pullRequests,
    PROJECT_VERDICTS_AT_ONCE,
    async (pullRequest): Promise<ProjectBranch> => {
      const verdict =
        mergeWorld === null
          ? unreadVerdict(pullRequest.number, "this project's folder is not in a git checkout")
          : await checkPullRequest(
              mergeWorld,
              { ref: String(pullRequest.number), repo: null },
              defaultBranches,
            );
      // A verdict gh never answered because the page's clock ran out is "not read yet", never
      // "gh could not read it": the deadline is the page's own.
      const cut =
        verdict.kind === "unread" && timeFor(GH_TIMEOUT_MS) <= 0
          ? { kind: "late" as const, number: verdict.number, what: verdict.what }
          : verdict;
      return {
        base: pullRequest.base,
        branch: pullRequest.head,
        draft: pullRequest.draft,
        kind: "pr",
        number: pullRequest.number,
        title: pullRequest.title,
        verdict: mergeVerdictOf(cut),
      };
    },
  );

  if (notes.length === 0 && branches.some((one) => one.verdict.kind === "late")) {
    notes.push("the time to read every verdict ran out, so some are not read yet");
  }
  return { branches, note: notes.length === 0 ? null : notes.join("; ") };
}

/**
 * `/api/projects/<id>`: one project's page, or a plain refusal for an unknown id. The card is
 * the same `projectCardData` the Machine page draws, for this project's root; the branches
 * come from the one reader above (`projectBranches`).
 */
export async function projectAnswerFor(
  deps: PageDataDeps,
  id: string,
): Promise<ProjectAnswer | { error: string }> {
  const world = projectsWorldOf(deps);
  const list = await projectsList(world);
  const project = list.projects.find((one) => one.id === id);
  if (project === undefined) {
    return { error: `no project has the id "${id}"; the list on /api/projects names them` };
  }
  const branches = await projectBranches(world, project);
  return {
    branches: branches.branches,
    branchesNote: branches.note,
    card: await projectCardData(
      deps.action.portal,
      project.root,
      deps.projectDefaults,
      deps.workflow,
    ),
    checkedAt: branches.checkedAt,
    project,
  };
}

/**
 * The root a `project.*` action names by id, or null when the list has no such project. The
 * id is looked up in the server's own list: a path from a request is never used.
 */
export async function projectRootById(world: ProjectsWorld, id: string): Promise<null | string> {
  const list = await projectsList(world);
  return list.projects.find((one) => one.id === id)?.root ?? null;
}

// ── A project's workflow settings (D57) ─────────────────────────────────────────

/** How long one `gh` login answer is kept: about a minute, as a project's branches are. */
export const PROJECT_GH_LOGIN_CACHE_MS = 60_000;

/** The gh login answers kept, by project root. */
const keptGhLogins = new Map<string, { at: number; state: GhLoginState }>();

/** Forgets the kept gh login answers: a test moves its fake gh between reads. */
export function forgetGhLogin(): void {
  keptGhLogins.clear();
}

/**
 * Whether a pull request can be opened from `root` now, asked of `gh` at most once a minute:
 * the project's page and the Workflow card read one answer, and a login made meanwhile shows
 * at the next minute at the latest.
 */
export async function ghLoginOf(world: ProjectsWorld, root: string): Promise<GhLoginState> {
  const now = world.now();
  const kept = keptGhLogins.get(root);
  if (kept !== undefined && now - kept.at < PROJECT_GH_LOGIN_CACHE_MS) return kept.state;
  const state = await ghLoginState(root, world.env, world.gh ?? spawnGh);
  keptGhLogins.set(root, { at: now, state });
  return state;
}

/** A project's own file, read from its root: a plain file read, never a git child. */
function configAt(
  root: string,
): { ok: true; base: null | string; config: CcSmartDevKitConfig } | { ok: false; why: string } {
  try {
    const config = loadCcSmartDevKitConfig(join(root, CONFIG_PATH));
    return config === null
      ? {
          ok: false,
          why: `${root} has no ${CONFIG_PATH} yet: set it up with \`${COMMAND} project init\` there.`,
        }
      : { ok: true, base: config.worktrees?.base ?? null, config };
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * `GET /api/projects/<id>/workflow` (D57): every workflow setting a project's own file can hold
 * (`isProjectKey`), with its value and where that value came from, plus the base a change's pull
 * request would go into and whether `gh` can open one now.
 *
 * **The values are the base's, not the checkout's.** A proposal changes the file committed on
 * `origin/<worktrees.base>` — the file merge-check reads, and the one `workflow propose`
 * compares against — so the answer is `resolveGateAsync` (the gate's own non-blocking reader:
 * `readCommittedConfigAsync` + `resolveWorkflow`) over that file, then `resolvedValueOf` (the
 * map `workflow show` prints through). An uncommitted edit in the person's checkout, or another
 * branch's file, is never shown as the project's policy. The ref is as fresh as the last fetch
 * (nothing is fetched for a read): after a merge on GitHub the card shows the old value until
 * the checkout fetches, as the gate itself does.
 *
 * A project with no file, no base, or no committed file on it, or a file or a personal
 * `workflow.json` that cannot be read, is a `note` and no settings: a page is never shown a
 * `default` for a value the project really sets.
 */
export async function projectWorkflowAnswerFor(
  deps: PageDataDeps,
  id: string,
): Promise<ProjectWorkflowAnswer | { error: string }> {
  const world = projectsWorldOf(deps);
  const list = await projectsList(world);
  const project = list.projects.find((one) => one.id === id);
  if (project === undefined) {
    return { error: `no project has the id "${id}"; the list on /api/projects names them` };
  }
  const gh = await ghLoginOf(world, project.root);
  // The working copy names the base (as `workflow show`'s gate lines read it) and says whether
  // the project is set up at all; what the settings are comes from the committed file below.
  const own = configAt(project.root);
  if (!own.ok) return { base: null, gh, note: own.why, settings: [] };
  const { base } = own;
  if (base === null) {
    return {
      base,
      gh,
      note: `${project.root} names no worktrees.base, so a change has no branch to go into: run \`${COMMAND} project init\` there.`,
      settings: [],
    };
  }
  try {
    const checkout = await locateCheckoutAsync(project.root, { env: world.env });
    if (checkout === null) {
      return { base, gh, note: `${project.root} is not in a git checkout.`, settings: [] };
    }
    const read = await resolveGateAsync(world.paths, checkout, base, { env: world.env });
    if (!read.ok) return { base, gh, note: read.why, settings: [] };
    return {
      base,
      gh,
      note: null,
      settings: WORKFLOW_KEYS.filter(isProjectKey).map((key) => {
        const resolved = resolvedValueOf(read.gate.resolved, key);
        // What `workflow show` prints for an unset key that something stands in for; any other
        // key prints its plain value, and the card words that one itself.
        const unsetWords = resolved.value === null ? showValue(key, null) : "null";
        return unsetWords === "null" ? { key, ...resolved } : { key, ...resolved, unsetWords };
      }),
    };
  } catch (error) {
    // A broken workflow.json of the person's own, or git that cannot run: a note, as the
    // Settings page shows one — never defaults.
    return {
      base,
      gh,
      note: error instanceof Error ? error.message : String(error),
      settings: [],
    };
  }
}

/** `/api/projects`: the current card, every row, and why the list may be short (B8). */
export async function projectsAnswerFor(deps: PageDataDeps): Promise<ProjectsAnswer> {
  const current = await projectCardData(
    deps.action.portal,
    deps.action.cwd,
    deps.projectDefaults,
    deps.workflow,
  );
  const list = await projectsList(projectsWorldOf(deps));
  return { current, note: list.note, projects: list.projects };
}
