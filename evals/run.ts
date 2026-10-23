/**
 * Runs the eval suite in `evals/cases/` against the plugin in `plugin/`, and compares a run
 * with the saved baseline. `claude plugin eval` does the work; this script holds the flags,
 * so every tier runs the same way on a laptop, in CI and in the release skill.
 *
 *   bun evals/run.ts <gate|watch|fast|strong|full> [--without <name>]... [--model <id>]
 *                    [--route direct|settings] [--max-cost-usd <usd>] [--case <glob>]
 *                    [--concurrency <n>] [--without-needs-shell] [--keep-temp]
 *                    [--save-baseline]
 *   bun evals/run.ts compare <baseline.json> <run.json>
 *
 * WHAT IT TESTS. A copy of `plugin/` in `evals/under-test/plugin` (git ignores it), with
 * two changes: its manifest drops `dependencies`, because an eval run installs nothing and
 * Claude Code refuses to load a plugin whose companion plugins are missing; and
 * `--without <name>` removes one skill, one agent, or (`core`) the general instructions, to
 * measure what that piece adds. The test-only plugin in `evals/` loads core.md
 * (`evals/harness/load-instructions.ts`).
 *
 * WHICH MODEL. A tier names its own model (Haiku, except `strong`): a case that needs a
 * stronger model lives in `strong`, so its tier and baseline stay per model. `--route direct`
 * (the default) sends every run to Anthropic: an eval run takes `ANTHROPIC_BASE_URL` from the
 * person's `~/.claude/settings.json`, so with the gateway on, a run would be answered by
 * whatever that slot's chain names, and the scores would measure that model. `--route
 * settings` keeps the person's own route. `--model` overrides the tier's model everywhere.
 *
 * THE TIERS (each case.yaml's `tags`), three runs a case:
 *   gate    the cases today's plugin passes; a case below PASS_SHARE fails the run.
 *   watch   the cases a planned change should fix, or that need what this machine may lack
 *           (`needs-shell`: Claude Code's Bash sandbox); scored, never failing.
 *   fast    gate and watch together, deterministic graders only: the baseline a change is
 *           compared with (`evals/baseline/<tier>-<model>.json`).
 *   strong  the cases that need a stronger model than Haiku, on Sonnet 5.5: the same
 *           threshold as gate, its own baseline.
 *   full    every Haiku case against the no-plugin baseline, the judge graders too; the
 *           strong cases run in their own tier.
 * A watch case that a change makes pass in a fast run moves to gate in the same change.
 *
 * NESTED RUNS. A run started from a Claude Code session's shell is nested: the run's own OS
 * sandbox cannot nest in the session's, so every Bash call fails and every `needs-shell` case
 * would score void. The runner detects the session (`CLAUDECODE` and the other markers) and
 * refuses the run with one line; `--without-needs-shell` runs the other cases only. A nested
 * run never saves a baseline, and its summary names the cases it skipped.
 *
 * THE COST CAP. The suite checks `--max-cost-usd` only before it launches a run, with up to
 * `--concurrency` runs in flight. The runner lowers the ceiling it passes by the runs that may
 * already be in flight, each counted at a reserve (the highest cost per run in the tier's
 * baseline, else a fixed reserve), so the total stays within one run's cost of the cap. The
 * summary names what the cap skipped.
 *
 * One run at a time per checkout: every run rebuilds `evals/under-test`.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

export const EVALS = import.meta.dir;
const REPO = join(EVALS, "..");
/**
 * The folder the runner owns: the copy under test, and a filtered run's cases. Its name is
 * plain on purpose: `claude plugin eval` refuses an `--eval-dir` whose folder names start
 * with anything but a letter or digit.
 */
export const UNDER_TEST_DIR = join(EVALS, "under-test");
/** Where the copy under test goes; every case.yaml's `plugins` points at it. */
export const UNDER_TEST = join(UNDER_TEST_DIR, "plugin");
/** The test-only plugin every case loads (core.md); a filtered run names it absolutely. */
export const HARNESS = join(EVALS, "harness");
const CASES = join(EVALS, "cases");
/**
 * A run that takes only some cases gets a copy here, because the suite filters by tag or by
 * one glob and cannot exclude: the copy's `plugins` paths are made absolute.
 */
const FILTERED_CASES = join(UNDER_TEST_DIR, "cases");
/**
 * The copy's folder before it got a plain name. No run reads it now, and the runner owns it,
 * so a run removes it instead of leaving a stale copy on the machine.
 */
const LEGACY_UNDER_TEST = join(EVALS, ".under-test");
const RESULTS = join(EVALS, "results");
const BASELINE = join(EVALS, "baseline");

/**
 * The agent under test: the smallest Claude, pinned so a model rollout is not read as a
 * plugin change.
 */
export const MODEL = "claude-haiku-5-5";
/** The stronger Claude: the judge for `llm` graders (full only), and the `strong` tier's model. */
export const SONNET_MODEL = "claude-sonnet-5-5";
/** Where `--route direct` sends the runs. */
const ANTHROPIC_API = "https://api.anthropic.com";

/**
 * The tools every run may use beyond the read-only set. Bash runs in Claude Code's OS
 * sandbox (writes only in the run's workspace, no home folder, no network); Edit and Write
 * only under the workspace.
 */
export const ALLOW_TOOLS = ["Edit(./**)", "Write(./**)", "Bash"];

/**
 * What one run is counted at when the cap counts the runs in flight, and the tier's baseline
 * has no higher cost per run. An estimate: the suite checks the ceiling only before it
 * launches a run, so the cap can overrun by the runs in flight, and this keeps that to about
 * one run's cost.
 */
export const RUN_RESERVE_USD = 0.25;

export interface Tier {
  ablation: "none" | "with-without";
  /** The judge graders cost money; only the full tier runs them. */
  judge: boolean;
  maxCostUsd: number;
  /** The model every case in this tier runs on; `--model` overrides it. */
  model: string;
  runs: number;
  /** Cases with one of these tags run in another tier, on that tier's model. */
  skipTags: string[];
  /** Empty: every case. */
  tags: string[];
  /** A case below this fails the run. */
  threshold: number;
}

/**
 * A case passes when it held in two runs of three. One run of a skill trigger is noise: on
 * the pinned model, a trigger that held in two of three single runs misses about one run in
 * three, so a one-run gate would fail pull requests at random.
 */
export const PASS_SHARE = 0.66;

export const TIERS: Record<string, Tier> = {
  gate: {
    ablation: "none",
    judge: false,
    maxCostUsd: 1,
    model: MODEL,
    runs: 3,
    skipTags: [],
    tags: ["gate"],
    threshold: PASS_SHARE,
  },
  watch: {
    ablation: "none",
    judge: false,
    maxCostUsd: 1,
    model: MODEL,
    runs: 3,
    skipTags: [],
    tags: ["watch"],
    threshold: 0,
  },
  fast: {
    ablation: "none",
    judge: false,
    maxCostUsd: 2,
    model: MODEL,
    runs: 3,
    skipTags: [],
    tags: ["gate", "watch"],
    threshold: 0,
  },
  strong: {
    ablation: "none",
    judge: false,
    maxCostUsd: 3,
    model: SONNET_MODEL,
    runs: 3,
    skipTags: [],
    tags: ["strong"],
    threshold: PASS_SHARE,
  },
  full: {
    ablation: "with-without",
    judge: true,
    maxCostUsd: 15,
    model: MODEL,
    runs: 3,
    skipTags: ["strong"],
    tags: [],
    threshold: PASS_SHARE,
  },
};

/** Variables that describe the session this script may run in; no eval run should see them. */
const SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
];

/**
 * The markers Claude Code leaves in the environment of a session's shell. Any one of them
 * means this run is nested, and a nested run's sandbox cannot nest in the session's.
 */
export const NESTED_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_ENTRYPOINT",
] as const;

/** The first marker Claude Code set in `env`, or null when this is not a nested run. */
export function nestedSession(env: Record<string, string | undefined>): null | string {
  return NESTED_MARKERS.find((name) => (env[name] ?? "") !== "") ?? null;
}

/**
 * Builds the copy under test: `plugin/` without its `dependencies`, and without each piece
 * `without` names. A name that is no skill, agent or `core` is an error, so a typo never
 * measures the whole plugin under a wrong label.
 */
export function prepare(source: string, target: string, without: string[]): void {
  rmSync(target, { force: true, recursive: true });
  cpSync(source, target, { recursive: true });
  const manifestFile = join(target, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
  delete manifest.dependencies;
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const name of without) {
    const skill = join(target, "skills", name);
    const agent = join(target, "agents", `${name}.md`);
    if (name === "core") writeFileSync(join(target, "instructions", "core.md"), "");
    else if (existsSync(skill)) rmSync(skill, { recursive: true });
    else if (existsSync(agent)) rmSync(agent);
    else throw new Error(`--without ${name}: no skill, agent or "core" has that name`);
  }
}

/**
 * Builds the eval dir for a run that takes only some cases: a copy of each named case under
 * `under-test/cases`, its `plugins` made absolute, because the copy no longer sits two
 * folders below `evals/`. The source cases are never touched.
 */
export function prepareCases(source: string, target: string, names: string[]): void {
  rmSync(target, { force: true, recursive: true });
  for (const name of names) {
    const copy = join(target, name);
    cpSync(join(source, name), copy, { recursive: true });
    const file = join(copy, "case.yaml");
    const yaml = readFileSync(file, "utf8");
    if (!/^plugins:.*$/m.test(yaml)) throw new Error(`${name}: case.yaml has no plugins line`);
    writeFileSync(
      file,
      yaml.replace(/^plugins:.*$/m, `plugins: ${JSON.stringify([UNDER_TEST, HARNESS])}`),
    );
  }
}

/** The `tags:` list of each case, read from its case.yaml (written as `tags: [a, b]`). */
export function caseTags(casesFolder: string): Record<string, string[]> {
  const tags: Record<string, string[]> = {};
  for (const name of readdirSync(casesFolder)) {
    const file = join(casesFolder, name, "case.yaml");
    if (!existsSync(file)) continue;
    const line = /^tags:\s*\[(.*)\]\s*$/m.exec(readFileSync(file, "utf8"));
    tags[name] = (line?.[1] ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
  }
  return tags;
}

/** The suite's own glob: `*` matches any run of characters, `?` one, everything else literal. */
export function matchesGlob(glob: string, name: string): boolean {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(name);
}

/**
 * The cases a tier runs: its tags (any one, as the suite filters), the `--case` glob, and
 * without the cases another tier owns (`skipTags`).
 */
export function selectedCases(
  tier: Tier,
  caseGlob: null | string,
  tags: Record<string, string[]>,
): string[] {
  return Object.keys(tags)
    .filter((name) => {
      const own = tags[name] ?? [];
      if (tier.skipTags.some((tag) => own.includes(tag))) return false;
      if (tier.tags.length > 0 && !tier.tags.some((tag) => own.includes(tag))) return false;
      return caseGlob === null || matchesGlob(caseGlob, name);
    })
    .sort();
}

/**
 * A run's cost when the cap counts the runs in flight: the highest cost per run among the
 * cases in the tier's baseline, or the fixed reserve when the history has none higher.
 */
export function runReserve(cases: string[], baseline: null | RunSummary): number {
  let reserve = RUN_RESERVE_USD;
  for (const one of baseline?.cases ?? []) {
    if (!cases.includes(one.name) || one.runs <= 0) continue;
    reserve = Math.max(reserve, one.costUsd / one.runs);
  }
  return reserve;
}

/**
 * The ceiling the suite sees, so the cap holds within one run's cost: it checks the ceiling
 * only before it launches a run, and up to `concurrency - 1` other runs are in flight then.
 * Each of those is counted at `reserveUsd`.
 */
export function costCeiling(limitUsd: number, concurrency: number, reserveUsd: number): number {
  return Math.max(0, limitUsd - Math.max(0, concurrency - 1) * reserveUsd);
}

export interface CaseSummary {
  costUsd: number;
  /** Why a run ended abnormally, once per distinct reason. */
  errors: string[];
  /** For each grader, the runs it passed in. */
  graders: Record<string, number>;
  name: string;
  runs: number;
  /** The mean run score. */
  score: number;
  tags: string[];
}

/** The cost cap as the runner applied it. */
export interface CapSummary {
  /** The ceiling the suite saw, after the runs in flight were counted. */
  ceilingUsd: number;
  /** The cap the person set: `--max-cost-usd`, or the tier's. */
  limitUsd: number;
  /** What each run in flight was counted at. */
  reserveUsd: number;
}

/** A run the suite did not start, and why. */
export interface SkippedRuns {
  case: string;
  reason: "cost-cap" | "needs-shell";
  runs: number;
}

export interface RunSummary {
  cap: CapSummary;
  cases: CaseSummary[];
  claudeVersion: string;
  costUsd: number;
  model: string;
  /** The session marker when the run was nested in a Claude Code session, else null. */
  nested: null | string;
  partial: boolean;
  pluginVersion: string;
  schema: 1;
  /** What the run left out: the runs the cap stopped, and the cases a nested run skipped. */
  skipped: SkippedRuns[];
  startedAt: string;
  tier: string;
  without: string[];
}

interface Aggregate {
  cases: {
    aggregates: { score: number };
    arms: {
      with: {
        costUsd: number;
        error: null | string;
        graders: { name: string; passed: boolean }[];
        turns: number;
      }[];
    };
    name: string;
  }[];
  claudeVersion: string;
  costUsd: number;
  partial: boolean;
  startedAt: string;
}

export interface SummaryMeta {
  cap: CapSummary;
  model: string;
  nested: null | string;
  pluginVersion: string;
  /** The runs the tier asked each case for. */
  runs: number;
  /** The cases the run asked for, so one the suite never started is recorded too. */
  selected: string[];
  /** The cases a `--without-needs-shell` run left out, by name. */
  skippedShell: string[];
  tier: string;
  without: string[];
}

/** Drops the folders of this machine from a text, so a saved summary names no machine. */
function scrub(text: string): string {
  const home = process.env.HOME ?? "";
  let out = text.split(REPO).join("<repo>");
  if (home !== "") out = out.split(home).join("~");
  return out.replace(/\/tmp\/claude-eval-\w+/g, "<run>");
}

/** The part of `claude plugin eval`'s result a baseline keeps: scores and verdicts, no paths. */
export function summarize(
  aggregate: Aggregate,
  meta: SummaryMeta,
  tags: Record<string, string[]>,
): RunSummary {
  const skipped: SkippedRuns[] = [];
  const cases = aggregate.cases.map((one) => {
    const graders: Record<string, number> = {};
    for (const run of one.arms.with) {
      for (const grader of run.graders) {
        graders[grader.name] = (graders[grader.name] ?? 0) + (grader.passed ? 1 : 0);
      }
    }
    const errors = one.arms.with.flatMap((run) => (run.error == null ? [] : [scrub(run.error)]));
    const missing = meta.runs - one.arms.with.length;
    if (missing > 0) skipped.push({ case: one.name, reason: "cost-cap", runs: missing });
    return {
      name: one.name,
      tags: tags[one.name] ?? [],
      runs: one.arms.with.length,
      score: one.aggregates.score,
      costUsd: one.arms.with.reduce((sum, run) => sum + run.costUsd, 0),
      errors: [...new Set(errors)],
      graders,
    };
  });
  const started = new Set(cases.map((one) => one.name));
  for (const name of meta.selected) {
    // A partial run can stop before a case starts; silence would read as a case that passed.
    if (aggregate.partial && !started.has(name)) {
      skipped.push({ case: name, reason: "cost-cap", runs: meta.runs });
    }
  }
  for (const name of meta.skippedShell) {
    skipped.push({ case: name, reason: "needs-shell", runs: meta.runs });
  }
  return {
    schema: 1,
    model: meta.model,
    pluginVersion: meta.pluginVersion,
    tier: meta.tier,
    without: meta.without,
    claudeVersion: aggregate.claudeVersion,
    costUsd: aggregate.costUsd,
    partial: aggregate.partial,
    startedAt: aggregate.startedAt,
    cap: meta.cap,
    nested: meta.nested,
    skipped,
    cases,
  };
}

export interface Change {
  after: number;
  before: null | number;
  name: string;
}

/** Each case's score against the baseline; `worse` lists the cases that lost score. */
export function compare(
  baseline: RunSummary,
  current: RunSummary,
): {
  changes: Change[];
  worse: Change[];
} {
  const before = new Map(baseline.cases.map((one) => [one.name, one.score]));
  const changes = current.cases.map((one) => ({
    name: one.name,
    before: before.get(one.name) ?? null,
    after: one.score,
  }));
  return {
    changes,
    worse: changes.filter((change) => change.before !== null && change.after < change.before),
  };
}

function printCompare(baseline: RunSummary, current: RunSummary): boolean {
  const { changes, worse } = compare(baseline, current);
  console.log(`\nAgainst the baseline (${baseline.startedAt}, ${baseline.model}):`);
  for (const change of changes) {
    const was = change.before === null ? "new" : change.before.toFixed(2);
    const mark = worse.includes(change) ? "  WORSE" : "";
    console.log(`  ${change.name.padEnd(44)} ${was} -> ${change.after.toFixed(2)}${mark}`);
  }
  console.log(worse.length === 0 ? "No case got worse." : `${worse.length} case(s) got worse.`);
  return worse.length === 0;
}

function readSummary(file: string): RunSummary {
  return JSON.parse(readFileSync(file, "utf8")) as RunSummary;
}

/** The baseline of one tier and model, or null when none was saved for them. */
function readBaseline(tier: string, model: string): null | RunSummary {
  const file = join(BASELINE, `${tier}-${model}.json`);
  return existsSync(file) ? readSummary(file) : null;
}

export interface Options {
  caseGlob: null | string;
  /** Runs at once (1 to 8); they share the account's rate limit. */
  concurrency: number;
  /** Keep each run's workspace and trace, for reading what a case did. */
  keepTemp: boolean;
  maxCostUsd: null | number;
  /** Null: the tier's own model. */
  model: null | string;
  route: "direct" | "settings";
  saveBaseline: boolean;
  without: string[];
  /** Run without the cases that need Claude Code's Bash sandbox. */
  withoutNeedsShell: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = {
    caseGlob: null,
    concurrency: 1,
    keepTemp: false,
    maxCostUsd: null,
    model: null,
    route: "direct",
    saveBaseline: false,
    without: [],
    withoutNeedsShell: false,
  };
  for (let at = 0; at < args.length; at++) {
    const flag = args[at];
    const value = () => {
      const next = args[++at];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--without") options.without.push(value());
    else if (flag === "--model") options.model = value();
    else if (flag === "--case") options.caseGlob = value();
    else if (flag === "--save-baseline") options.saveBaseline = true;
    else if (flag === "--keep-temp") options.keepTemp = true;
    else if (flag === "--without-needs-shell") options.withoutNeedsShell = true;
    else if (flag === "--concurrency") {
      options.concurrency = Number(value());
      if (
        !Number.isInteger(options.concurrency) ||
        options.concurrency < 1 ||
        options.concurrency > 8
      )
        throw new Error("--concurrency is a whole number from 1 to 8");
    } else if (flag === "--max-cost-usd") {
      options.maxCostUsd = Number(value());
      if (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0)
        throw new Error("--max-cost-usd is a positive number");
    } else if (flag === "--route") {
      const route = value();
      if (route !== "direct" && route !== "settings")
        throw new Error("--route is direct or settings");
      options.route = route;
    } else throw new Error(`unknown option ${flag}`);
  }
  return options;
}

/** What one run of a tier does, decided before anything is copied or launched. */
export interface RunPlan {
  /** The cases to run, in name order. */
  cases: string[];
  ceilingUsd: number;
  /** The eval dir the suite reads: `evals/cases`, or a filtered copy. */
  evalDir: string;
  limitUsd: number;
  model: string;
  nested: null | string;
  reserveUsd: number;
  skippedShell: string[];
}

/**
 * Plans a tier's run: which cases, on which model, under which ceiling. Throws with the
 * reason when the run must not start: no case selected, a nested run whose shell cases would
 * score void, or a cap that cannot hold the runs in flight.
 */
export function planRun(
  tierName: string,
  tier: Tier,
  options: Options,
  env: Record<string, string | undefined>,
  tags: Record<string, string[]>,
): RunPlan {
  const selected = selectedCases(tier, options.caseGlob, tags);
  if (selected.length === 0) throw new Error(`${tierName}: no case is in this tier`);
  const nested = nestedSession(env);
  const shell = selected.filter((name) => (tags[name] ?? []).includes("needs-shell"));
  if (nested !== null && shell.length > 0 && !options.withoutNeedsShell) {
    throw new Error(
      `this run is nested in a Claude Code session (${nested} is set), whose shell cannot nest: ${shell.length} needs-shell case(s) would score void. Run the tier from a normal terminal, or pass --without-needs-shell to run the other cases only.`,
    );
  }
  const cases = options.withoutNeedsShell
    ? selected.filter((name) => !shell.includes(name))
    : selected;
  if (cases.length === 0) {
    throw new Error(
      `${tierName}: every case it selects needs the shell, so --without-needs-shell leaves none`,
    );
  }
  const model = options.model ?? tier.model;
  const limitUsd = options.maxCostUsd ?? tier.maxCostUsd;
  const reserveUsd = runReserve(cases, readBaseline(tierName, model));
  const ceilingUsd = costCeiling(limitUsd, options.concurrency, reserveUsd);
  if (ceilingUsd <= 0) {
    throw new Error(
      `the $${limitUsd.toFixed(2)} cap cannot hold ${options.concurrency - 1} run(s) in flight at the $${reserveUsd.toFixed(2)} reserve. Raise --max-cost-usd or lower --concurrency.`,
    );
  }
  const filtered = shell.length > 0 && options.withoutNeedsShell;
  return {
    cases,
    ceilingUsd,
    evalDir: filtered || tier.skipTags.length > 0 ? FILTERED_CASES : CASES,
    limitUsd,
    model,
    nested,
    reserveUsd,
    skippedShell: filtered ? shell : [],
  };
}

/** The `claude` command line for one tier. */
export function evalArgs(
  tier: Tier,
  options: Options,
  outputDir: string,
  plan: { ceilingUsd: number; evalDir: string; model: string },
): string[] {
  const args: string[] = [];
  if (options.route === "direct") {
    args.push("--settings", JSON.stringify({ env: { ANTHROPIC_BASE_URL: ANTHROPIC_API } }));
  }
  args.push("plugin", "eval", ".", "--eval-dir", relative(REPO, plan.evalDir));
  args.push("--trust-plugin", "--scaffold", "--no-publish");
  args.push("--model", plan.model, "--runs", String(tier.runs), "--ablation", tier.ablation);
  args.push("--threshold", String(tier.threshold));
  args.push("--max-cost-usd", String(plan.ceilingUsd));
  args.push("--output-dir", outputDir);
  if (tier.judge) args.push("--judge-model", SONNET_MODEL);
  if (options.caseGlob !== null) args.push("--case", options.caseGlob);
  if (options.keepTemp) args.push("--keep-temp");
  if (options.concurrency > 1) args.push("--concurrency", String(options.concurrency));
  if (tier.tags.length > 0) args.push("--tag", ...tier.tags);
  args.push("--allow-tools", ...ALLOW_TOOLS);
  return args;
}

/** A nested run never becomes a baseline: its sandbox is not the one a tier runs in. */
export function maySaveBaseline(plan: RunPlan): boolean {
  return plan.nested === null;
}

/** Prints what the run left out, so a summary never hides a skipped case. */
function printSkipped(summary: RunSummary): void {
  const forCap = summary.skipped.filter((one) => one.reason === "cost-cap");
  const shell = summary.skipped.filter((one) => one.reason === "needs-shell");
  if (summary.partial) {
    console.log(
      forCap.length > 0
        ? `Partial run: the cost cap or the suite stopped it; skipped ${forCap.length} case(s).`
        : "Partial run: the suite stopped before every case finished; no case was left unstarted.",
    );
  }
  if (forCap.length > 0) {
    const list = forCap.map((one) => `${one.case} (${one.runs} run(s))`).join(", ");
    console.log(`Skipped for the cap: ${list}`);
  }
  if (shell.length > 0) {
    console.log(`Skipped, needs a shell: ${shell.map((one) => one.case).join(", ")}`);
  }
}

function runTier(name: string, tier: Tier, options: Options): number {
  const tags = caseTags(CASES);
  const plan = planRun(name, tier, options, process.env, tags);
  const cap =
    plan.ceilingUsd < plan.limitUsd
      ? `, cap $${plan.limitUsd.toFixed(2)} (the suite stops at $${plan.ceilingUsd.toFixed(2)}: ${options.concurrency - 1} run(s) in flight × $${plan.reserveUsd.toFixed(2)} reserve)`
      : `, cap $${plan.limitUsd.toFixed(2)}`;
  console.log(
    `Tier ${name}: model ${plan.model}, route ${options.route}${cap}${options.without.length > 0 ? `, without ${options.without.join(", ")}` : ""}`,
  );
  // The copy's folder before it got a plain name: nothing reads it, and the runner owns it.
  rmSync(LEGACY_UNDER_TEST, { force: true, recursive: true });
  prepare(join(REPO, "plugin"), UNDER_TEST, options.without);
  const filtered = plan.evalDir !== CASES;
  try {
    if (filtered) prepareCases(CASES, plan.evalDir, plan.cases);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = join(RESULTS, `${name}-${stamp}`);
    mkdirSync(outputDir, { recursive: true });
    const env = { ...process.env };
    for (const variable of SESSION_VARIABLES) delete env[variable];
    const run = spawnSync("claude", evalArgs(tier, options, outputDir, plan), {
      cwd: REPO,
      env,
      stdio: "inherit",
    });
    const aggregateFile = join(outputDir, "aggregate-result.json");
    if (!existsSync(aggregateFile)) {
      console.error(`No result was written (${aggregateFile}).`);
      return run.status ?? 1;
    }
    const manifest = JSON.parse(
      readFileSync(join(UNDER_TEST, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const summary = summarize(
      JSON.parse(readFileSync(aggregateFile, "utf8")) as Aggregate,
      {
        cap: {
          ceilingUsd: plan.ceilingUsd,
          limitUsd: plan.limitUsd,
          reserveUsd: plan.reserveUsd,
        },
        model: plan.model,
        nested: plan.nested,
        pluginVersion: String(manifest.version),
        runs: tier.runs,
        selected: plan.cases,
        skippedShell: plan.skippedShell,
        tier: name,
        without: options.without,
      },
      tags,
    );
    const summaryFile = join(outputDir, "summary.json");
    writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Summary: ${relative(REPO, summaryFile)} (cost $${summary.costUsd.toFixed(4)})`);
    printSkipped(summary);
    // One baseline per tier and model: a run is only compared with runs of the same model.
    const baselineFile = join(BASELINE, `${name}-${plan.model}.json`);
    const save = options.saveBaseline && maySaveBaseline(plan);
    if (options.saveBaseline && !save) {
      console.error(
        `evals: no baseline saved: this run is nested in a Claude Code session (${plan.nested} is set). Run it from a normal terminal.`,
      );
    }
    if (save) {
      mkdirSync(BASELINE, { recursive: true });
      writeFileSync(baselineFile, `${JSON.stringify(summary, null, 2)}\n`);
      // The baseline is committed, so it takes the repo's JSON format, or `bun run lint` fails.
      const format = spawnSync(
        join(REPO, "node_modules", ".bin", "biome"),
        ["format", "--write", baselineFile],
        {
          cwd: REPO,
          encoding: "utf8",
        },
      );
      if (format.status !== 0) {
        console.error(
          `Could not format the baseline (${format.error?.message ?? format.stderr.trim()}): run bun run format.`,
        );
      }
      console.log(`Saved as the baseline: ${relative(REPO, baselineFile)}`);
    } else if (existsSync(baselineFile)) {
      printCompare(readSummary(baselineFile), summary);
    }
    return run.status ?? 1;
  } finally {
    if (filtered) rmSync(plan.evalDir, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "compare") {
      const [baselineFile, runFile] = rest;
      if (baselineFile === undefined || runFile === undefined) {
        throw new Error("compare needs <baseline.json> <run.json>");
      }
      process.exitCode = printCompare(readSummary(baselineFile), readSummary(runFile)) ? 0 : 1;
    } else {
      const tier = command === undefined ? undefined : TIERS[command];
      if (command === undefined || tier === undefined) {
        throw new Error(`the tier is one of: ${Object.keys(TIERS).join(", ")}, or compare`);
      }
      process.exitCode = runTier(command, tier, parseOptions(rest));
    }
  } catch (error) {
    console.error(`evals: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
