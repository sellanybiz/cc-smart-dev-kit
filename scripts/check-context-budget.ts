/**
 * The context budget: what the plugin puts into every session before the person types.
 *
 * Two parts, each with its own budget, because different work trims them:
 *
 * - **Always-on**: the names and descriptions of the plugin's skills and agents, as
 *   `claude plugin details` counts them for the copy in `plugin/`. Every session carries
 *   them, used or not (code.claude.com/docs/en/plugins/measure), except user-only skills.
 *   Claude Code 2.1.325 (2026-11-16) counts disable-model-invocation skills here, but a
 *   live request capture proved their descriptions never reach the model. Subtract their
 *   per-component always-on rows; count `< 20` as 20 to stay conservative.
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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 * performance-budget, one more always-on skill: 2,720. Its seven vendored skills are user-only
 * and left out (see the header).
 */
export const ALWAYS_ON: Budget = { max: 2_720, target: 2_000 };

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

/** Rounded CLI rows, not the on-invoke column. Unknown formats fail rather than undercount. */
export function parseComponentCosts(output: string): Map<string, number> {
  const table = /^Per-component[^\n]*\n([\s\S]*?)(?:\n[ \t]*\n|(?![\s\S]))/m.exec(output)?.[1];
  if (!table) throw new Error("cannot read the Per-component table of `claude plugin details`");
  const costs = new Map<string, number>();
  for (const row of table.split("\n")) {
    if (row.trim() === "" || /^\s*component\s+always-on\s+on-invoke\s*$/.test(row)) continue;
    const match = /^\s*(\S+)\s+(?:~?([\d,.]+)(k)?|<\s*(\d+))\s+(?:~?[\d,.]+k?|<\s*\d+)\s*$/.exec(
      row,
    );
    if (!match?.[1]) throw new Error(`cannot read component row: ${row.trim()}`);
    const value =
      match[4] !== undefined
        ? Number(match[4])
        : Math.ceil(Number((match[2] ?? "").replaceAll(",", "")) * (match[3] ? 1000 : 1));
    if (!Number.isFinite(value) || costs.has(match[1]))
      throw new Error(`invalid component row: ${row.trim()}`);
    costs.set(match[1], value);
  }
  if (costs.size === 0) throw new Error("empty Per-component table");
  return costs;
}

export function subtractUserOnlySkills(
  alwaysOn: number,
  costs: ReadonlyMap<string, number>,
  names: readonly string[],
): number {
  let removed = 0;
  for (const name of names) {
    const cost = costs.get(name);
    if (cost === undefined)
      throw new Error(`user-only skill missing from Per-component table: ${name}`);
    removed += cost;
  }
  if (removed > alwaysOn) throw new Error("user-only cost exceeds Always-on total");
  return alwaysOn - removed;
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

/** `claude plugin details` for the copy in `plugin/`, never an installed one. */
function readDetails(repo: string): Details & { userOnlyCount: number } {
  const run = spawnSync(
    "claude",
    ["--plugin-dir", join(repo, "plugin"), "plugin", "details", PLUGIN],
    { encoding: "utf8" },
  );
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(
      `\`claude plugin details\` failed: ${run.error?.message ?? run.stderr.trim()}. Is Claude Code installed?`,
    );
  }
  const details = parseDetails(run.stdout);
  if (!details.source.endsWith("@inline")) {
    throw new Error(
      `\`claude plugin details\` read ${details.source}, not the copy in plugin/ (@inline)`,
    );
  }
  const names = userOnlySkills(repo);
  return {
    ...details,
    alwaysOn: subtractUserOnlySkills(details.alwaysOn, parseComponentCosts(run.stdout), names),
    userOnlyCount: names.length,
  };
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
