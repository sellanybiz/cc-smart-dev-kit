/**
 * The deploy-skill block (D8): the section `project init` keeps in the project's own deploy
 * skill, its text in `deploy-block.ts`. This is its finder, planner and writer; `doctor` asks
 * `staleBlocks` whether a block still matches the text.
 *
 * It is a separate part from `planProjectInit` on purpose: the portal plans and writes the
 * project's files through that, and it must never write a skill. `project-init.ts` composes
 * the two.
 *
 * - **Find** (`findDeploySkills`): a file that already holds the deploy block anywhere under
 *   `.claude/skills/` (the block is decided: it is updated in place; a skill that only shows the
 *   markers in a code fence, or whose block is something else, is not one), else a
 *   `.claude/skills/<name>/SKILL.md` whose folder name or front matter `name` has "deploy" in it.
 * - **Plan** (`planDeploySkill`): pure of writes. The text around the block stays byte for
 *   byte, in LF, CRLF and mixed files. A real path outside the checkout is refused (a skill linked
 *   in from a plugin or a dotfiles repo is not the project's to change), and a broken marker
 *   pair is named, never written to.
 * - **Write** (`applyDeploySkill`): a backup and an atomic write, never `changed.json`, so
 *   `restore` never touches a project file (the reason is in `init.ts`'s header). The file is
 *   read again just before the rename; a change while init ran aborts that write.
 * - **A project with no deploy skill** (`planNewDeploySkill`): a new
 *   `.claude/skills/deploy/SKILL.md` from the starter text (`deploy-block.ts`). Its write
 *   creates the folders and the file exclusively, so a file that appeared since the plan is
 *   never overwritten. A new file has nothing to back up, and like every project file it is
 *   not in `changed.json`: `restore` leaves it alone.
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setFileMode } from "../setup/file-mode";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  renderManagedMarkdown,
  renderWithoutBlock,
} from "../setup/managed-markdown";
import { atomicWrite, backupFile, fileMode, realTarget } from "../setup/write";
import { deployBlockBody, deploySkillStarter } from "./deploy-block";
import { readFrontmatterHeader } from "./frontmatter";
import type { ProjectInitWrite } from "./init";

const SKILLS_DIR = [".claude", "skills"];
const SKILL_FILE = "SKILL.md";
/** How deep under `.claude/skills/` a file holding the marker is looked for. */
const MARKER_SEARCH_DEPTH = 4;

/** Where the files are: the checkout's skills folder. */
function skillsFolder(root: string): string {
  return join(root, ...SKILLS_DIR);
}

/**
 * A sentence when `.claude/skills` is a link that leaves the checkout, else null: it is not
 * searched (a skills folder linked in from a dotfiles repo is not the project's to change), and
 * "no deploy skill found" would be the wrong thing to say about it.
 */
export function skillsFolderLink(root: string): string | null {
  const folder = skillsFolder(root);
  if (!existsSync(folder) || isInside(realTarget(root), realTarget(folder))) return null;
  return `${shownPath(root, folder)} is a link outside this checkout: not searched`;
}

/** True when `real` is the checkout's real root or a path under it. */
function isInside(realRoot: string, real: string): boolean {
  const rel = relative(realRoot, real);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** A path from the project's root, as a person reads it (`/` on every system). */
export function shownPath(root: string, file: string): string {
  return relative(root, file).split("\\").join("/");
}

/** True when every line break in the text is CRLF (and there is at least one). */
function isCrlf(text: string): boolean {
  return text.includes("\r\n") && !/\n/.test(text.replace(/\r\n/g, ""));
}

/** An opening or closing line of a fenced code block: three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Where the kit's markers stand in a file: whether any is inside a fenced code block (a docs
 * skill that shows the markers as an example), and the line right after the first begin marker
 * outside a fence (the first line of the block's text), or null.
 */
function markerPlaces(text: string): { inFence: boolean; firstBodyLine: string | null } {
  let fence: string | null = null;
  let inFence = false;
  let firstBodyLine: string | null = null;
  let afterBegin = false;
  for (const line of text.split(/\r?\n/)) {
    if (afterBegin) {
      firstBodyLine = line.trim();
      afterBegin = false;
    }
    const opens = FENCE_LINE.exec(line)?.[1];
    if (fence !== null) {
      if (
        opens !== undefined &&
        opens[0] === fence[0] &&
        opens.length >= fence.length &&
        line.trim() === opens
      ) {
        fence = null;
      }
    } else if (opens !== undefined) {
      fence = opens;
      continue;
    }
    const hasMarker = line.includes(BLOCK_BEGIN) || line.includes(BLOCK_END);
    if (hasMarker && fence !== null) inFence = true;
    // A begin marker counts only at the start of its line: an indented example of the block
    // (in a list or an indented code block) is shown, not kept.
    else if (line.startsWith(BLOCK_BEGIN) && firstBodyLine === null) afterBegin = true;
  }
  return { inFence, firstBodyLine };
}

/** The first line of the deploy block's text: what tells it from another cc-smart-dev-kit block. */
function deployBlockHeading(): string {
  return deployBlockBody().split("\n")[0] ?? "";
}

/** True when the file holds the kit's deploy block: its markers, outside a code fence, round that heading. */
function holdsDeployBlock(text: string): boolean {
  return markerPlaces(text).firstBodyLine === deployBlockHeading();
}

/** The folder name or the front matter `name` of a `<skills>/<folder>/SKILL.md` has one of `words` in it. */
function namesAny(file: string, words: readonly string[]): boolean {
  const has = (text: string) => words.some((word) => text.toLowerCase().includes(word));
  if (has(basename(join(file, "..")))) return true;
  const header = readFrontmatterHeader(file);
  if (header === null) return false;
  let name: unknown;
  try {
    name = (Bun.YAML.parse(header) as { name?: unknown } | null)?.name;
  } catch {
    // A skill with unreadable front matter has no name to match; its folder name was checked.
    return false;
  }
  return typeof name === "string" && has(name);
}

/** True for a `<skills>/<folder>/SKILL.md`: a skill one folder down, as a person names it. */
function isTopSkill(top: string, file: string): boolean {
  return relative(top, file).split(/[\\/]/).length === 2;
}

/** Every `SKILL.md` under `folder`, to `depth` folders down; a folder is visited once. */
function skillFilesUnder(
  folder: string,
  depth: number,
  realRoot: string,
  seen = new Set<string>(),
): string[] {
  const real = realTarget(folder);
  if (seen.has(real) || !existsSync(folder) || !statSync(folder).isDirectory()) return [];
  seen.add(real);
  const found: string[] = [];
  if (existsSync(join(folder, SKILL_FILE))) found.push(join(folder, SKILL_FILE));
  // A folder linked in from outside the checkout is looked at, never walked: the plan refuses
  // its skill by name, and a link to a big tree costs nothing.
  if (depth === 0 || !isInside(realRoot, real)) return found;
  for (const entry of readdirSync(folder).sort()) {
    if (entry !== "node_modules") {
      found.push(...skillFilesUnder(join(folder, entry), depth - 1, realRoot, seen));
    }
  }
  return found;
}

/** What `findDeploySkills` found, each file as a path under the project's root. */
export interface DeploySkillsFound {
  /** Files that already hold the kit's deploy block: it is kept current. */
  holders: string[];
  /** Files that name a deploy skill and hold no block yet: where a block may go. */
  named: string[];
}

/**
 * The project's deploy skills (see the header). A file outside the checkout is still listed:
 * the plan refuses it by name. Another skill that carries the kit's markers (a docs skill that
 * shows them in a code fence, a block with other text) is not a holder.
 */
export function findDeploySkills(root: string): DeploySkillsFound {
  const holders: string[] = [];
  const named: string[] = [];
  const top = skillsFolder(root);
  for (const file of skillFilesUnder(top, MARKER_SEARCH_DEPTH, realTarget(root))) {
    if (holdsDeployBlock(readFileSync(file, "utf8"))) holders.push(file);
    else if (isTopSkill(top, file) && namesAny(file, ["deploy"])) named.push(file);
  }
  return { holders, named };
}

/** One file's change, as the plan shows it and `applyDeploySkill` writes it. */
export interface DeploySkillPlan {
  file: string;
  /** The file as a person reads its path: from the project's root. */
  shown: string;
  /**
   * `create`: a new skill file, starter text and block; `add`: a new block; `update`: the
   * block's text changed; `remove`: the block goes; `none`: the file is already right;
   * `refused`: it cannot be changed (`problem` says why).
   */
  action: "create" | "add" | "update" | "remove" | "none" | "refused";
  /** The file as read, the exact text the write compares with just before it renames. */
  before: string;
  /** What the file will hold. */
  text: string;
  changed: boolean;
  /** The block's changed lines as `- <line>` then `+ <line>`; the text around it is never listed. */
  diff: string[];
  problem: string | null;
}

function refused(root: string, file: string, problem: string, before = ""): DeploySkillPlan {
  return {
    file,
    shown: shownPath(root, file),
    action: "refused",
    before,
    text: before,
    changed: false,
    diff: [],
    problem,
  };
}

/** The lines between the markers of a file whose markers `renderManagedMarkdown` has proved. */
function blockLines(text: string): string[] {
  const start = text.indexOf(BLOCK_BEGIN);
  if (start === -1) return [];
  const end = text.indexOf(BLOCK_END);
  return text
    .slice(start + BLOCK_BEGIN.length, end)
    .split(/\r?\n/)
    .slice(1, -1);
}

/** Why a link, or a path, leaves the checkout; the link's target is named when the path is a link. */
function outsideMessage(root: string, file: string, real: string): string {
  const shown = shownPath(root, file);
  const link = real === resolve(file) ? "" : ` (a link to ${real})`;
  return `${shown} is outside this checkout${link}: not changed`;
}

/** The lines `from` has and `other` does not, counting repeats: what a change adds or takes away. */
function linesOnlyIn(from: string[], other: string[]): string[] {
  const left = new Map<string, number>();
  for (const line of other) left.set(line, (left.get(line) ?? 0) + 1);
  return from.filter((line) => {
    const count = left.get(line) ?? 0;
    if (count > 0) left.set(line, count - 1);
    return count === 0 && line.trim() !== "";
  });
}

/**
 * What the file would be with the block put in (`mode: "write"`) or taken out (`"remove"`).
 * Never throws for a file it cannot change: the answer is `refused`, with the reason, so the
 * rest of `project init` goes on.
 */
export function planDeploySkill(
  root: string,
  file: string,
  mode: "write" | "remove",
): DeploySkillPlan {
  const shown = shownPath(root, file);
  const real = realTarget(file);
  if (!isInside(realTarget(root), real)) {
    return refused(root, file, outsideMessage(root, file, real));
  }
  if (!existsSync(real) || !statSync(real).isFile()) {
    return refused(root, file, `${shown} is not a file`);
  }
  const before = readFileSync(real, "utf8");
  // A file whose every line break is CRLF is worked on as LF and written back as CRLF, so the
  // text around the block stays byte for byte. Any other file, mixed endings included, is
  // worked on as it is: the markers are found by position, and only the block's own text
  // (written with LF) is new.
  const crlf = isCrlf(before);
  const work = crlf ? before.replace(/\r\n/g, "\n") : before;
  let next: string;
  try {
    next =
      mode === "write"
        ? renderManagedMarkdown(work, deployBlockBody(), shown)
        : renderWithoutBlock(work, shown);
  } catch (error) {
    return refused(root, file, error instanceof Error ? error.message : String(error), before);
  }
  const had = work.includes(BLOCK_BEGIN);
  if (had) {
    // Only the deploy block is ours to change: a block with other text, or markers shown in a
    // code fence as an example, belong to something else.
    const places = markerPlaces(work);
    if (places.inFence) {
      return refused(
        root,
        file,
        `${shown} shows the cc-smart-dev-kit markers inside a code block: not changed`,
        before,
      );
    }
    if (places.firstBodyLine !== deployBlockHeading()) {
      return refused(
        root,
        file,
        `${shown} has a cc-smart-dev-kit block that is not the deploy block: not changed`,
        before,
      );
    }
  }
  const action = next === work ? "none" : mode === "remove" ? "remove" : had ? "update" : "add";
  const was = blockLines(work);
  const is = blockLines(next);
  return {
    file,
    shown,
    action,
    before,
    text: crlf ? next.replace(/\n/g, "\r\n") : next,
    changed: next !== work,
    diff: [
      ...linesOnlyIn(was, is).map((line) => `- ${line}`),
      ...linesOnlyIn(is, was).map((line) => `+ ${line}`),
    ],
    problem: null,
  };
}

/** The only place a new deploy skill goes, from the project's root. */
const NEW_SKILL_PATH = [...SKILLS_DIR, "deploy", SKILL_FILE];

/** A command file that answers /deploy: a `deploy*.md` anywhere under `.claude/commands`. */
const DEPLOY_COMMAND_FILE = /^deploy.*\.md$/i;
/** How deep under `.claude/commands/` a command is looked for. */
const COMMANDS_SEARCH_DEPTH = 4;
/** A skill that names one of these may already hold the project's deploy steps. */
const DEPLOY_LIKE_WORDS = ["release", "ship"];

/** The first `deploy*.md` under `folder` (sorted, links followed, `depth` folders down), or null. */
function deployCommandUnder(folder: string, depth: number): string | null {
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) return null;
  for (const entry of readdirSync(folder).sort()) {
    const path = join(folder, entry);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat?.isFile() === true && DEPLOY_COMMAND_FILE.test(entry)) return path;
    if (stat?.isDirectory() === true && depth > 0 && entry !== "node_modules") {
      const found = deployCommandUnder(path, depth - 1);
      if (found !== null) return found;
    }
  }
  return null;
}

/** The skills, one folder down, whose name says release or ship, as paths from the root. */
function deployLikeSkills(root: string): string[] {
  const top = skillsFolder(root);
  return skillFilesUnder(top, 1, realTarget(root))
    .filter((file) => isTopSkill(top, file) && namesAny(file, DEPLOY_LIKE_WORDS))
    .map((file) => shownPath(root, file));
}

/**
 * The plan for a deploy skill the project does not have: the starter text as a new
 * `.claude/skills/deploy/SKILL.md`, every non-blank line shown as a `+` line. Or a note, and no
 * plan, when the file must not be made: `.claude/skills` is linked out of the checkout, a
 * `.claude/commands/deploy*.md` already answers /deploy (Claude Code gives a skill precedence
 * over a command of the same name, so a new skill would silently replace it), something is
 * already at that path (a file, a folder, a link, even a dangling one: it is never overwritten),
 * its real place is outside the checkout, or its folders cannot be made. A skill whose name says
 * release or ship may hold the project's deploy steps: the plan stands, with a note naming it.
 * Writes nothing.
 */
export function planNewDeploySkill(
  root: string,
): { plan: DeploySkillPlan; notes: string[] } | { note: string } {
  const linked = skillsFolderLink(root);
  if (linked !== null) return { note: linked };
  const file = join(root, ...NEW_SKILL_PATH);
  const shown = shownPath(root, file);
  const command = deployCommandUnder(join(root, ".claude", "commands"), COMMANDS_SEARCH_DEPTH);
  if (command !== null) {
    return {
      note: `${shownPath(root, command)} already answers /deploy: no skill created; --deploy-skill <path> names a skill to add the section to`,
    };
  }
  try {
    if (lstatSync(file, { throwIfNoEntry: false }) !== undefined) {
      return {
        note: `${shown} already exists: not overwritten; --deploy-skill <path> names the deploy skill`,
      };
    }
    if (!isInside(realTarget(root), realTarget(file))) {
      return { note: `${shown} would be outside this checkout: not created` };
    }
  } catch (error) {
    // A file where a folder should be (ENOTDIR), a link loop: the path cannot be made.
    const why = error instanceof Error ? error.message : String(error);
    return { note: `${shown} cannot be created (${why})` };
  }
  const text = deploySkillStarter();
  return {
    notes: deployLikeSkills(root).map(
      (path) =>
        `${path} may already hold this project's deploy steps; --deploy-skill ${path} adds the section there instead`,
    ),
    plan: {
      file,
      shown,
      action: "create",
      before: "",
      text,
      changed: true,
      diff: text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => `+ ${line}`),
      problem: null,
    },
  };
}

/**
 * Creates the new file of a `create` plan: its folders, then the file, exclusively (`wx`), so
 * a file that appeared since the plan is never overwritten. Mode 0644, as a skill is shared.
 */
function createDeploySkill(plan: DeploySkillPlan, real: string): void {
  mkdirSync(dirname(real), { recursive: true });
  let fd: number;
  try {
    fd = openSync(real, "wx", 0o644);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${plan.shown} already exists: nothing was written to it. Run it again.`);
    }
    throw error;
  }
  // This call made the file, so only this call may remove it: half a file is worse than none.
  let written = false;
  try {
    writeFileSync(fd, plan.text);
    written = true;
  } finally {
    closeSync(fd);
    if (!written) unlinkSync(real);
  }
  // The open's mode passes through the umask: set the bits asked for.
  setFileMode(real, 0o644);
}

/**
 * Writes one planned change: backup, then an atomic write that first reads the file again and
 * aborts (throws, the file untouched) when it is not the text the plan was made from. A
 * `create` plan makes the new file instead (`createDeploySkill`, no backup: nothing was there).
 * Null when the plan changes nothing. `dryRun` writes nothing.
 */
export function applyDeploySkill(
  root: string,
  plan: DeploySkillPlan,
  options: { stateDir: string; dryRun?: boolean },
): ProjectInitWrite | null {
  if (!plan.changed) return null;
  const real = realTarget(plan.file);
  if (!isInside(realTarget(root), real)) {
    throw new Error(outsideMessage(root, plan.file, real));
  }
  const created = plan.action === "create";
  if (options.dryRun === true) return { file: plan.file, created, backup: null };
  if (created) {
    createDeploySkill(plan, real);
    return { file: plan.file, created: true, backup: null };
  }
  const unchanged = (): void => {
    if (!existsSync(real) || readFileSync(real, "utf8") !== plan.before) {
      throw new Error(
        `${plan.shown} changed while project init ran: nothing was written to it. Run it again.`,
      );
    }
  };
  unchanged();
  const backup = backupFile(options.stateDir, real);
  atomicWrite(real, plan.text, fileMode(real) ?? 0o644, unchanged);
  return { file: plan.file, created: false, backup };
}

/** A file whose block no longer matches the current text, or whose markers are broken. */
export interface StaleBlock {
  file: string;
  shown: string;
  why: string;
  /**
   * What fixes it: `init` (`project init` rewrites the block), or `by-hand` (broken markers,
   * or a file outside the checkout: init refuses to write those, so the person must).
   */
  fix: "init" | "by-hand";
}

/**
 * The deploy skills whose block differs from `deployBlockBody()` (what `doctor` warns about).
 * A file with no block is not listed: a project that has no block has not chosen one.
 */
export function staleBlocks(root: string): StaleBlock[] {
  const stale: StaleBlock[] = [];
  for (const file of findDeploySkills(root).holders) {
    const plan = planDeploySkill(root, file, "write");
    if (plan.action === "refused") {
      stale.push({ file, shown: plan.shown, why: plan.problem ?? "", fix: "by-hand" });
    } else if (plan.changed) {
      stale.push({ file, shown: plan.shown, why: "the block's text is out of date", fix: "init" });
    }
  }
  return stale;
}
