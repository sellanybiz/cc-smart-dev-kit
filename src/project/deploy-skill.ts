/**
 * The deploy-skill block (D8): the section `project init` keeps in the project's own deploy
 * skill, its text in `deploy-block.ts`. This is its finder, planner and writer; `doctor` asks
 * `staleBlocks` whether a block still matches the text.
 *
 * It is a separate part from `planProjectInit` on purpose: the portal plans and writes the
 * project's files through that, and it must never write a skill. `project-init.ts` composes
 * the two.
 *
 * - **Find** (`findDeploySkills`): a file that already holds the kit's marker anywhere under
 *   `.claude/skills/` (the block is decided: it is updated in place), else a
 *   `.claude/skills/<name>/SKILL.md` whose folder name or front matter `name` has "deploy" in it.
 * - **Plan** (`planDeploySkill`): pure of writes. The text around the block stays byte for
 *   byte, in LF and in CRLF files. A real path outside the checkout is refused (a skill linked
 *   in from a plugin or a dotfiles repo is not the project's to change), and a broken marker
 *   pair is named, never written to.
 * - **Write** (`applyDeploySkill`): a backup and an atomic write, never `changed.json`, so
 *   `restore` never touches a project file (the reason is in `init.ts`'s header). The file is
 *   read again just before the rename; a change while init ran aborts that write.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  renderManagedMarkdown,
  renderWithoutBlock,
} from "../setup/managed-markdown";
import { atomicWrite, backupFile, fileMode, realTarget } from "../setup/write";
import { deployBlockBody } from "./deploy-block";
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

/** True when `real` is the checkout's real root or a path under it. */
function isInside(realRoot: string, real: string): boolean {
  const rel = relative(realRoot, real);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** A path from the project's root, as a person reads it (`/` on every system). */
function shownPath(root: string, file: string): string {
  return relative(root, file).split("\\").join("/");
}

/** The text of a file with its CRLF line breaks made LF; whether every break was CRLF. */
function lineBreaksOf(text: string): { lf: string; crlf: boolean } {
  const lf = text.replace(/\r\n/g, "\n");
  return { lf, crlf: lf !== text && !/\n/.test(text.replace(/\r\n/g, "")) };
}

/** The folder name or the front matter `name` of a `<skills>/<folder>/SKILL.md` has "deploy" in it. */
function namesDeploy(file: string): boolean {
  if (basename(join(file, "..")).toLowerCase().includes("deploy")) return true;
  const header = readFrontmatterHeader(file);
  if (header === null) return false;
  let name: unknown;
  try {
    name = (Bun.YAML.parse(header) as { name?: unknown } | null)?.name;
  } catch {
    // A skill with unreadable front matter has no name to match; its folder name was checked.
    return false;
  }
  return typeof name === "string" && name.toLowerCase().includes("deploy");
}

/** Every `SKILL.md` under `folder`, to `depth` folders down; a folder is visited once. */
function skillFilesUnder(folder: string, depth: number, seen = new Set<string>()): string[] {
  const real = realTarget(folder);
  if (seen.has(real) || !existsSync(folder) || !statSync(folder).isDirectory()) return [];
  seen.add(real);
  const found: string[] = [];
  if (existsSync(join(folder, SKILL_FILE))) found.push(join(folder, SKILL_FILE));
  if (depth === 0) return found;
  for (const entry of readdirSync(folder).sort()) {
    if (entry !== "node_modules")
      found.push(...skillFilesUnder(join(folder, entry), depth - 1, seen));
  }
  return found;
}

/** What `findDeploySkills` found, each file as a path under the project's root. */
export interface DeploySkillsFound {
  /** Files that already hold the kit's marker: the block is there, and is kept current. */
  holders: string[];
  /** Files that name a deploy skill and hold no marker yet: where a block may go. */
  named: string[];
}

/** The project's deploy skills (see the header). A file outside the checkout is still listed: the plan refuses it by name. */
export function findDeploySkills(root: string): DeploySkillsFound {
  const holders: string[] = [];
  const named: string[] = [];
  const top = skillsFolder(root);
  for (const file of skillFilesUnder(top, MARKER_SEARCH_DEPTH)) {
    if (readFileSync(file, "utf8").includes(BLOCK_BEGIN)) holders.push(file);
    else if (relative(top, file).split(/[\\/]/).length === 2 && namesDeploy(file)) named.push(file);
  }
  return { holders, named };
}

/** One file's change, as the plan shows it and `applyDeploySkill` writes it. */
export interface DeploySkillPlan {
  file: string;
  /** The file as a person reads its path: from the project's root. */
  shown: string;
  /**
   * `add`: a new block; `update`: the block's text changed; `remove`: the block goes; `none`:
   * the file is already right; `refused`: it cannot be changed (`problem` says why).
   */
  action: "add" | "update" | "remove" | "none" | "refused";
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
function blockLines(lf: string): string[] {
  const start = lf.indexOf(BLOCK_BEGIN);
  if (start === -1) return [];
  const end = lf.indexOf(BLOCK_END);
  return lf
    .slice(start + BLOCK_BEGIN.length, end)
    .split("\n")
    .slice(1, -1);
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
    return refused(root, file, `${shown} is a link to ${real}, outside this checkout: not changed`);
  }
  if (!existsSync(real) || !statSync(real).isFile()) {
    return refused(root, file, `${shown} is not a file`);
  }
  const before = readFileSync(real, "utf8");
  // A file whose every line break is CRLF is worked on as LF and written back as CRLF, so the
  // text around the block stays byte for byte. A mixed file is left as it is.
  const { lf, crlf } = lineBreaksOf(before);
  let next: string;
  try {
    next =
      mode === "write"
        ? renderManagedMarkdown(lf, deployBlockBody(), shown)
        : renderWithoutBlock(lf, shown);
  } catch (error) {
    return refused(root, file, error instanceof Error ? error.message : String(error), before);
  }
  const had = lf.includes(BLOCK_BEGIN);
  const action = next === lf ? "none" : mode === "remove" ? "remove" : had ? "update" : "add";
  const was = blockLines(lf);
  const is = blockLines(next);
  return {
    file,
    shown,
    action,
    before,
    text: crlf ? next.replace(/\n/g, "\r\n") : next,
    changed: next !== lf,
    diff: [
      ...linesOnlyIn(was, is).map((line) => `- ${line}`),
      ...linesOnlyIn(is, was).map((line) => `+ ${line}`),
    ],
    problem: null,
  };
}

/**
 * Writes one planned change: backup, then an atomic write that first reads the file again and
 * aborts (throws, the file untouched) when it is not the text the plan was made from. Null
 * when the plan changes nothing. `dryRun` writes nothing.
 */
export function applyDeploySkill(
  root: string,
  plan: DeploySkillPlan,
  options: { stateDir: string; dryRun?: boolean },
): ProjectInitWrite | null {
  if (!plan.changed) return null;
  const real = realTarget(plan.file);
  if (!isInside(realTarget(root), real)) {
    throw new Error(`${plan.shown} is a link to ${real}, outside this checkout: not changed`);
  }
  if (options.dryRun === true) return { file: plan.file, created: false, backup: null };
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
}

/**
 * The deploy skills whose block differs from `deployBlockBody()` (what `doctor` warns about,
 * with the fix `project init`). A file with no block is not listed: a project that has no
 * block has not chosen one.
 */
export function staleBlocks(root: string): StaleBlock[] {
  const stale: StaleBlock[] = [];
  for (const file of findDeploySkills(root).holders) {
    const plan = planDeploySkill(root, file, "write");
    if (plan.action === "refused") stale.push({ file, shown: plan.shown, why: plan.problem ?? "" });
    else if (plan.changed)
      stale.push({ file, shown: plan.shown, why: "the block's text is out of date" });
  }
  return stale;
}
