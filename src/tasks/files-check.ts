/**
 * How a plan's files are compared with another plan's (D2, D3), and what an overlap says. The
 * committed `plans.mergeFiles` list takes no part in an overlap, inside the committed
 * `plans.appendOnly` folders only the same file overlaps, and the file system may ignore case. All
 * three are read from git, so a caller reads them **before** it takes the write lock
 * (`writeWork`) and passes them in: `reservePlan` as `ignore`, `appendOnly` and `caseFold`,
 * `task_update` as `filesCheck`.
 *
 * An overlap never refuses. After the write, `warnOverlaps` gives the caller's answer one line
 * for each, and saves the same text as an `Overlap:` note on both plans, once.
 */
import { COMMAND } from "../build-info/names";
import { runGit, runGitRaw } from "../hooks/git";
import type { Env } from "../hooks/run";
import { generatedChecks, generatedIn, openBaseOnlyGit } from "../project/generated";
import type { Checkout } from "../project/locate";
import { locateCheckout } from "../project/resolve";
import { shellWord } from "../shell/quote";
import { resolvePlanFiles } from "../workflow/resolve";
import { baseBranch } from "../worktrees/command";
import { TASK_TOOL } from "./words";
import type { WorkDb } from "./work/db";
import { type FileOverlap, planLead } from "./work/queries";
import { addNotesOnce, type FilesCheck, label, type PlanOverlap } from "./work/store";
import type { Who, WorkTask } from "./work/types";

/** The files a base marks generated (`GENERATED_ATTRIBUTE`) among some shared paths. */
export interface BaseGenerated {
  /** The base they were read from: `origin/<base>`. */
  ref: string;
  /** The marked files, in path order; a folder entry is read as the files it holds there. */
  files: string[];
}

/**
 * Which of `paths` the base marks generated, or null when that cannot be read (no base ref, or a
 * git older than 2.40). It runs git: call it only for an overlap, and after the write lock.
 */
export type GeneratedReader = (paths: readonly string[]) => BaseGenerated | null;

/** A `FilesCheck` with what the warning after the write needs (`warnOverlaps`). */
export interface OverlapCheck extends FilesCheck {
  /**
   * Why `ignore` may be short (`resolvePlanFiles`): the warning says it, since a merge file that
   * could not be read may be what the overlap is about, and then it prints no propose line.
   */
  reason?: string | null;
  /** Left out, the warning names no generated file. */
  generated?: GeneratedReader;
}

export interface PlanFilesCheck extends OverlapCheck {
  /** `plans.appendOnly` as committed on `origin/<base>`; empty when none could be read. */
  appendOnly: readonly string[];
  /** Why the committed lists are empty or short (`resolvePlanFiles`), for the caller to show; null when whole. */
  reason: string | null;
}

/**
 * The check for the checkout `cwd` is in. `plans.mergeFiles` and `plans.appendOnly` come only
 * from the committed copy on `origin/<base>`, in one read (`resolvePlanFiles`), never from the
 * working copy, so a session cannot widen either by editing a file. A folder outside git has no
 * lists, compares with case, and names no generated file.
 *
 * `resolvePlanFiles` does not throw: lists it cannot read (no base, no ref, no file, a bad
 * entry) come back empty or short with a `reason`, so more paths count as overlaps, and the
 * warning that follows says why (`OverlapCheck.reason`). An unreadable `core.ignorecase` reads as
 * false (paths compare with case). Only locating the checkout and reading the project's own
 * file (`locateCheckout`, `baseBranch`) can throw, and that fails the call.
 */
export function planFilesCheck(cwd: string, env: Env = process.env): PlanFilesCheck {
  const checkout = locateCheckout(cwd, { env });
  if (checkout === null) return { ignore: [], appendOnly: [], caseFold: false, reason: null };
  const base = baseBranch(checkout, env, checkout.root).base;
  const committed = resolvePlanFiles(checkout, base, { env });
  return {
    ignore: committed.files,
    appendOnly: committed.appendOnly,
    caseFold: ignoresCase(checkout.root, env),
    reason: committed.reason,
    generated: (paths) => baseGenerated(checkout, base, paths, env),
  };
}

/**
 * Whether the checkout at `root` compares paths without case (`core.ignorecase`). A setting git
 * cannot read is false: paths then compare with case.
 */
export function ignoresCase(root: string, env: Env = process.env): boolean {
  const ignorecase = runGit(root, ["config", "--type=bool", "core.ignorecase"], env);
  return ignorecase.ok && ignorecase.out === "true";
}

/**
 * Which of `paths` commit `origin/<base>` marks generated, from that commit's own
 * `.gitattributes` alone (`src/project/generated.ts`), never a local attribute file. A folder
 * entry is read as the files the base holds in it. Null when the base ref is not in the checkout,
 * or git cannot read the marks (older than 2.40): the warning is then plain.
 */
function baseGenerated(
  checkout: Checkout,
  base: string,
  paths: readonly string[],
  env: Env,
): BaseGenerated | null {
  const ref = `origin/${base}`;
  const commit = runGit(
    checkout.root,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}^{commit}`],
    env,
  );
  if (!commit.ok) return null;
  const files = new Set(paths.filter((path) => !path.endsWith("/")));
  const folders = paths.filter((path) => path.endsWith("/"));
  if (folders.length > 0) {
    const listed = runGitRaw(
      checkout.root,
      ["ls-tree", "-r", "-z", "--name-only", commit.out, "--", ...folders],
      env,
    );
    if (!listed.ok) return null;
    for (const path of listed.out.split("\0")) if (path !== "") files.add(path);
  }
  const isolated = openBaseOnlyGit(checkout.commonDir, commit.out);
  try {
    const marked = new Set<string>();
    for (const args of generatedChecks(commit.out, [...files])) {
      const attrs = runGit(checkout.root, args, env, undefined, isolated.env);
      if (!attrs.ok) return null;
      for (const path of generatedIn(attrs.out)) marked.add(path);
    }
    return { ref, files: [...marked].sort() };
  } finally {
    isolated.remove();
  }
}

/** How every overlap note starts, so a later session finds it among a plan's notes. */
const OVERLAP_NOTE = "Overlap:";

/** The paths two plans share: of two paths that touch, the inner one (a file, or the inner folder). */
function sharedPath(overlap: FileOverlap): string {
  return overlap.path.length >= overlap.other.length ? overlap.path : overlap.other;
}

/** True when `file` is `path`, or sits in the folder `path`. */
function within(file: string, path: string): boolean {
  return file === path || (path.endsWith("/") && file.startsWith(path));
}

/** A plan's lead, in words: its reservation's session, else the session that owns its task. */
function leadWords(plan: WorkTask): string | null {
  const lead = planLead(plan);
  if (lead?.sessionId) return `#${plan.number} session ${lead.sessionId}`;
  return lead?.pid ? `#${plan.number} process ${lead.pid}` : null;
}

/**
 * The note for an overlap of files, and the head that makes it once per pair and path set: the two
 * plans in number order and the paths they share, each path from the lower plan's list with the
 * higher plan's beside it when they differ (`src/b/ (src/b/x.ts)`). Then the leads, the rule for
 * the plan that merges second, a list that was not read in full, and the base's generated files
 * among the shared paths with the ready `workflow propose` line.
 */
function overlapNote(
  overlap: PlanOverlap,
  marks: BaseGenerated | null,
  check: OverlapCheck,
): { head: string; text: string } {
  const flip = overlap.plan.number > overlap.other.number;
  const [low, high] = flip ? [overlap.other, overlap.plan] : [overlap.plan, overlap.other];
  const shown = overlap.overlaps.map(({ path, other }) => {
    const [mine, theirs] = flip ? [other, path] : [path, other];
    return mine === theirs ? mine : `${mine} (${theirs})`;
  });
  const head = `${OVERLAP_NOTE} ${label(low)} and ${label(high)} share ${[...new Set(shown)].sort().join(", ")}.`;
  const leads = [low, high].map(leadWords).filter((words) => words !== null);
  // A plan closed but still reserved holds its files until its pull request settles.
  const settling = [low, high]
    .filter((plan) => plan.status === "done")
    .map(
      (plan) =>
        `${label(plan)} is done, not released: \`${COMMAND} herdr plans\` releases it when its pull request merges.`,
    );
  const parts = [
    head,
    ...(leads.length > 0 ? [`Leads: ${leads.join("; ")}.`] : []),
    ...settling,
    "Both may run at once: the plan that merges second rebases onto the first one's merged code (or merges it in, once pushed), resolves the conflicts, reruns the full check, and names the other plan and these files in its pull request.",
  ];
  if (check.reason)
    parts.push(
      `plans.mergeFiles was not read in full, so a merge file may count: ${check.reason}.`,
    );
  const regions = overlap.overlaps.map(sharedPath);
  const generated = (marks?.files ?? []).filter((file) =>
    regions.some((path) => within(file, path)),
  );
  if (marks !== null && generated.length > 0) {
    const named = `${marks.ref} marks ${generated.join(", ")} generated`;
    const list = [...new Set([...check.ignore, ...generated])].join(",");
    parts.push(
      check.reason
        ? `${named}; no propose line, since the current plans.mergeFiles is not known in full.`
        : `${named}: \`${COMMAND} workflow propose plans.mergeFiles ${shellWord(list)}\` opens the pull request that leaves them out of every overlap once the person merges it.`,
    );
  }
  return { head, text: parts.join(" ") };
}

/** The line for two plans that cannot be compared, since `unlisted`, one of them, lists no file. */
function unlistedLine({ plan, other }: PlanOverlap, unlisted: WorkTask): string {
  const rival = unlisted.id === plan.id ? other : plan;
  return `Overlap unknown: ${label(unlisted)} has no file list, so it cannot be compared with ${label(rival)}: set its files (${TASK_TOOL.update} on #${unlisted.number} with files).`;
}

/**
 * What a write's overlaps (`FilesCheck.found`) say, after the write lock: one line for each pair
 * and path set, for the caller's answer. The same text is saved as an `Overlap:` note on both
 * plans, once (`addNotesOnce`, by its head), so a later or another session sees it; a wider or
 * other set of shared paths is a new note. Plans that cannot be compared (no file list) get a
 * line and no note. The base's generated marks are read only here, only when files overlap.
 */
export function warnOverlaps(
  db: WorkDb,
  found: readonly PlanOverlap[],
  check: OverlapCheck,
  who: Who,
  now: number,
): string[] {
  const regions = [...new Set(found.flatMap((overlap) => overlap.overlaps.map(sharedPath)))].sort();
  const marks = regions.length > 0 && check.generated ? check.generated(regions) : null;
  const lines: string[] = [];
  const notes: { taskIds: string[]; head: string; text: string }[] = [];
  for (const overlap of found) {
    if (overlap.unlisted !== null) {
      const line = unlistedLine(overlap, overlap.unlisted);
      if (!lines.includes(line)) lines.push(line);
      continue;
    }
    const note = overlapNote(overlap, marks, check);
    if (notes.some((one) => one.head === note.head)) continue;
    notes.push({ taskIds: [overlap.plan.id, overlap.other.id], ...note });
    lines.push(note.text);
  }
  if (notes.length > 0) {
    const saved = addNotesOnce(db, notes, who, now);
    if (!saved.ok) lines.push(`The ${OVERLAP_NOTE} notes were not saved: ${saved.why}`);
  }
  return lines;
}
