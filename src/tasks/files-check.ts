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
import { COMMAND, PLUGIN } from "../build-info/names";
import { commitArgs, commitIn, runGit, runGitRaw } from "../hooks/git";
import type { Env } from "../hooks/run";
import { readGenerated } from "../project/generated";
import type { Checkout } from "../project/locate";
import { locateCheckout } from "../project/resolve";
import { shellWord } from "../shell/quote";
import { resolvePlanFiles } from "../workflow/resolve";
import { baseBranch } from "../worktrees/command";
import { TASK_TOOL } from "./words";
import type { WorkDb } from "./work/db";
import { type FileOverlap, filesOverlap, planLead, settledBy } from "./work/queries";
import {
  addNotesOnce,
  type FilesCheck,
  label,
  type NoteOnce,
  type PlanOverlap,
} from "./work/store";
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
  const commit = commitIn(runGit(checkout.root, commitArgs(`refs/remotes/${ref}`), env));
  if (commit === null) return null;
  const files = new Set(paths.filter((path) => !path.endsWith("/")));
  const folders = paths.filter((path) => path.endsWith("/"));
  if (folders.length > 0) {
    const listed = runGitRaw(
      checkout.root,
      ["ls-tree", "-r", "-z", "--name-only", commit, "--", ...folders],
      env,
    );
    if (!listed.ok) return null;
    for (const path of listed.out.split("\0")) if (path !== "") files.add(path);
  }
  const marked = readGenerated(checkout.commonDir, commit, [...files], env);
  return marked === null ? null : { ref, files: [...marked].sort() };
}

/** How every overlap note starts, so a later session finds it among a plan's notes. */
const OVERLAP_NOTE = "Overlap:";

/**
 * About how many characters one list of paths may take in a note; the rest are counted. A folder
 * can hold thousands of generated files, and a note longer than `NOTE_LIMIT` is never saved.
 */
const NOTE_LIST_CHARS = 2_000;

/** `items` joined with ", ", the first always shown, the ones past `NOTE_LIST_CHARS` counted. */
function cappedList(items: readonly string[]): string {
  let shown = 0;
  let size = 0;
  for (const item of items) {
    if (shown > 0 && size + item.length > NOTE_LIST_CHARS) break;
    shown += 1;
    size += item.length + 2;
  }
  const listed = items.slice(0, shown).join(", ");
  return shown < items.length ? `${listed} and ${items.length - shown} more` : listed;
}

/** The paths two plans share: of two paths that touch, the inner one (a file, or the inner folder). */
function sharedPath(overlap: FileOverlap): string {
  return overlap.path.length >= overlap.other.length ? overlap.path : overlap.other;
}

/** A plan's lead, in words: its reservation's session, else the session that owns its task. */
function leadWords(plan: WorkTask): string | null {
  const lead = planLead(plan);
  if (lead?.sessionId) return `#${plan.number} session ${lead.sessionId}`;
  return lead?.pid ? `#${plan.number} process ${lead.pid}` : null;
}

/**
 * Two plans and the paths they share, in number order, each path from the lower plan's list with
 * the higher plan's beside it when they differ: `#1 "a" and #2 "b" share src/b/ (src/b/x.ts)`.
 * `overlaps` holds `plan`'s paths first (`filesOverlap(plan's list, other's list)`).
 */
export function overlapSummary(
  plan: WorkTask,
  other: WorkTask,
  overlaps: readonly FileOverlap[],
): string {
  const flip = plan.number > other.number;
  const [low, high] = flip ? [other, plan] : [plan, other];
  const shown = overlaps.map(({ path, other: theirs }) => {
    const [mine, them] = flip ? [theirs, path] : [path, theirs];
    return mine === them ? mine : `${mine} (${them})`;
  });
  return `${label(low)} and ${label(high)} share ${cappedList([...new Set(shown)].sort())}`;
}

/**
 * What the note says of the base's generated files among the shared paths: the ready
 * `workflow propose` line when listing them in `plans.mergeFiles` would settle every shared path
 * that holds them. It would not for a folder both plans list (a merge file settles only its own
 * path, `settledBy`), so that gets the two ways that do.
 */
function generatedWords(
  overlap: PlanOverlap,
  marks: BaseGenerated,
  generated: readonly string[],
  check: OverlapCheck,
): string {
  const named = `${marks.ref} marks ${cappedList(generated)} generated`;
  if (check.reason)
    return `${named}; no propose line, since the current plans.mergeFiles is not known in full.`;
  const proposed = [...new Set([...check.ignore, ...generated])];
  const left = filesOverlap(...overlap.lists, { ...check, ignore: proposed }).map(sharedPath);
  const folders = left.filter((path) => generated.some((file) => settledBy([path], file)));
  if (folders.length > 0)
    return `${named}, but a merge file does not settle a folder both plans list (${cappedList([...new Set(folders)].sort())}): narrow that folder entry to the files the plan changes, or put the folder itself in plans.mergeFiles.`;
  const list = proposed.join(",");
  if (list.length > NOTE_LIST_CHARS)
    return `${named}: too many for one propose line, so put the folder that holds them in plans.mergeFiles.`;
  return `${named}: \`${COMMAND} workflow propose plans.mergeFiles ${shellWord(list)}\` opens the pull request that leaves them out of every overlap once the person merges it.`;
}

/**
 * The note for an overlap of files, and its head (`overlapSummary`), which makes it once per pair
 * and path set. Then the leads, a pointer to the catch-up rule, a list that was not read in full,
 * and the base's generated files among the shared paths (`generatedWords`).
 */
function overlapNote(
  overlap: PlanOverlap,
  marks: BaseGenerated | null,
  check: OverlapCheck,
): { head: string; text: string } {
  const head = `${OVERLAP_NOTE} ${overlapSummary(overlap.plan, overlap.other, overlap.overlaps)}.`;
  const pair = [overlap.plan, overlap.other].sort((a, b) => a.number - b.number);
  const leads = pair.map(leadWords).filter((words) => words !== null);
  // A plan closed but still reserved holds its files until its pull request settles.
  const settling = pair
    .filter((plan) => plan.status === "done")
    .map(
      (plan) =>
        `${label(plan)} is done, not released: \`${COMMAND} herdr plans\` releases it when its pull request merges.`,
    );
  const parts = [
    head,
    ...(leads.length > 0 ? [`Leads: ${leads.join("; ")}.`] : []),
    ...settling,
    `Both may run at once; the plan that merges second catches up (\`/${PLUGIN}:build\` § 6, An overlapping plan).`,
  ];
  if (check.reason)
    parts.push(
      `plans.mergeFiles was not read in full, so a merge file may count: ${check.reason}.`,
    );
  const regions = overlap.overlaps.map(sharedPath);
  const generated = marks === null ? [] : marks.files.filter((file) => settledBy(regions, file));
  if (marks !== null && generated.length > 0)
    parts.push(generatedWords(overlap, marks, generated, check));
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
 * It never throws: it runs after the write committed, and an overlap never refuses.
 */
export function warnOverlaps(
  db: WorkDb,
  found: readonly PlanOverlap[],
  check: OverlapCheck,
  who: Who,
  now: number,
): string[] {
  const regions = [...new Set(found.flatMap((overlap) => overlap.overlaps.map(sharedPath)))].sort();
  const lines: string[] = [];
  let marks: BaseGenerated | null = null;
  // The write has landed: a reader that fails leaves the warning plain, never the answer an error.
  if (regions.length > 0 && check.generated)
    try {
      marks = check.generated(regions);
    } catch (error) {
      lines.push(
        `The generated files could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  const notes: NoteOnce[] = [];
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
