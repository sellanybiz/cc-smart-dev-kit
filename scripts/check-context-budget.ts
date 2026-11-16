/**
 * The context budget: what the plugin puts into every session before the person types.
 *
 * Two parts, each with its own budget, because different work trims them:
 *
 * - **Always-on**: the names and descriptions of the plugin's skills and agents, as
 *   `claude plugin details` counts them for the copy in `plugin/`. Every session carries
 *   them, used or not (code.claude.com/docs/en/plugins/measure), except user-only skills.
 *   Claude Code 2.1.325 (2026-11-16) counts disable-model-invocation skills here, but a
 *   live request capture proved their descriptions never reach the model. So the check
 *   measures a temporary copy of `plugin/` without those skill folders: an exact figure,
 *   where subtracting the rounded per-component rows came out about 46 tokens too low.
 * - **core.md**: `plugin/instructions/core.md`, which `setup` imports into every session's
 *   CLAUDE.md. `plugin details` does not count it, so this check estimates it.
 *
 * Each budget is today's figure with a little room: it fails when the figure grows past
 * it, so a new description or rule has to pay for itself by trimming another. A change that
 * trims a part lowers its budget to the new figure in the same commit, so the saving cannot
 * creep back. The target is where the trims are heading; the check prints the distance.
 *
 *   bun scripts/check-context-budget.ts
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { PLUGIN } from "../src/build-info/names";

export const CORE_MD = "plugin/instructions/core.md";

export interface Budget {
  /** Over this, the check fails. */
  max: number;
  /** Where the trims are heading; shown, never failing. */
  target: number;
}

/**
 * Always-on tokens. 3,133 at 0.5.0; about 3,515 at 2.1.1; about 2,626 at 2.2.0, after its
 * description trims and with three more agents. The target is the line where Claude Code's
 * plugin browser highlights a plugin's per-turn cost as heavy: 2,000 tokens. The code-structure
 * rename trimmed the always-on figure to 2,690. 4.10.0 split react-best-practices out of
 * performance-budget, one more always-on skill: 2,766, measured on a copy without the user-only skills. Its seven vendored skills are user-only
 * and left out (see the header).
 */
export const ALWAYS_ON: Budget = { max: 2_766, target: 2_000 };

/**
 * core.md tokens, estimated. About 3,300 at 0.5.0 (189 lines); about 2,300 at 1.1.0, after
 * its trim to 128 lines; about 2,298 at 2.2.0 (126 lines). The target is still roughly
 * 1,900 tokens. The code-structure wording trimmed it to about 2,345.
 */
export const CORE: Budget = { max: 2_345, target: 1_900 };

/**
 * Characters per token for the core.md estimate: about four for English prose. The check
 * watches a trend, so the estimate only has to be the same rule every time.
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface Details {
  alwaysOn: number;
  source: string;
}

/**
 * Reads the always-on figure and the source line from `claude plugin details` output.
 * Output it cannot read is an error, never a pass: a changed format must be noticed.
 */
export function parseDetails(output: string): Details {
  const alwaysOn = /^\s*Always-on:\s*~?([\d,]+)\s*tok/m.exec(output);
  const source = /^\s*Source:\s*(\S+)/m.exec(output);
  if (alwaysOn?.[1] === undefined || source?.[1] === undefined) {
    throw new Error(
      "cannot read the Always-on or the Source line of `claude plugin details`; its output format may have changed",
    );
  }
  return { alwaysOn: Number(alwaysOn[1].replaceAll(",", "")), source: source[1] };
}

/** Only frontmatter controls visibility; body text never opts a skill out of the budget. */
export function userOnlySkills(repo: string): string[] {
  const folder = join(repo, "plugin/skills");
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const file = join(folder, entry.name, "SKILL.md");
      if (!existsSync(file)) return [];
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
      return /^disable-model-invocation:\s*true\s*$/m.test(frontmatter) ? [entry.name] : [];
    })
    .sort();
}

/**
 * Copies a plugin folder to `dest`, leaving out the named skill folders (and everything in
 * them), so `plugin details` on the copy counts exactly what Claude sees.
 */
export function copyWithoutSkills(
  pluginDir: string,
  dest: string,
  skills: readonly string[],
): void {
  const left = new Set(skills.map((name) => join("skills", name)));
  cpSync(pluginDir, dest, {
    recursive: true,
    filter: (source) => {
      const path = relative(pluginDir, source);
      return ![...left].some((skill) => path === skill || path.startsWith(`${skill}${sep}`));
    },
  });
}

export interface BudgetResult {
  lines: string[];
  ok: boolean;
}

function line(name: string, value: number, budget: Budget): { ok: boolean; text: string } {
  const ok = value <= budget.max;
  const toTarget = value > budget.target ? `, ${value - budget.target} above the target` : "";
  const text = ok
    ? `${name}: ~${value} tokens (budget ${budget.max}, target ${budget.target}${toTarget}).`
    : `${name}: ~${value} tokens, over its ${budget.max}-token budget. Every session carries it: trim it, or move text into a skill that loads only when used.`;
  return { ok, text };
}

export function checkBudget(alwaysOn: number, coreTokens: number, userOnlyCount = 0): BudgetResult {
  const parts = [line("Always-on", alwaysOn, ALWAYS_ON), line(CORE_MD, coreTokens, CORE)];
  if (userOnlyCount > 0 && parts[0]) {
    parts[0].text += ` (${userOnlyCount} user-only skills left out: Claude never sees them).`;
  }
  return {
    lines: [
      ...parts.map((part) => part.text),
      `Every session starts with ~${alwaysOn + coreTokens} tokens from the plugin.`,
    ],
    ok: parts.every((part) => part.ok),
  };
}

/** `claude plugin details` for the copy in `plugin/` without its user-only skills. */
function readDetails(repo: string): Details & { userOnlyCount: number } {
  const names = userOnlySkills(repo);
  const copy = mkdtempSync(join(tmpdir(), "context-budget-"));
  try {
    const pluginCopy = join(copy, "plugin");
    copyWithoutSkills(join(repo, "plugin"), pluginCopy, names);
    const run = spawnSync("claude", ["--plugin-dir", pluginCopy, "plugin", "details", PLUGIN], {
      encoding: "utf8",
    });
    if (run.error !== undefined || run.status !== 0) {
      throw new Error(
        `\`claude plugin details\` failed: ${run.error?.message ?? run.stderr.trim()}. Is Claude Code installed?`,
      );
    }
    const details = parseDetails(run.stdout);
    if (!details.source.endsWith("@inline")) {
      throw new Error(
        `\`claude plugin details\` read ${details.source}, not the copy of plugin/ (@inline)`,
      );
    }
    return { ...details, userOnlyCount: names.length };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const repo = join(import.meta.dir, "..");
  try {
    const details = readDetails(repo);
    const core = estimateTokens(readFileSync(join(repo, CORE_MD), "utf8"));
    const result = checkBudget(details.alwaysOn, core, details.userOnlyCount);
    for (const text of result.lines) (result.ok ? console.log : console.error)(text);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(
      `check-context-budget: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
