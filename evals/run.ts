/**
 * Runs the eval suite in `evals/cases/` against the plugin in `plugin/`, and compares a run
 * with the saved baseline. `claude plugin eval` does the work; this script holds the flags,
 * so every tier runs the same way on a laptop, in CI and in the release skill.
 *
 *   bun evals/run.ts <gate|watch|fast|full> [--without <name>]... [--model <id>]
 *                    [--route direct|settings] [--max-cost-usd <usd>] [--case <glob>]
 *                    [--concurrency <n>] [--keep-temp] [--save-baseline]
 *   bun evals/run.ts compare <baseline.json> <run.json>
 *
 * WHAT IT TESTS. A copy of `plugin/` in `evals/.under-test/plugin` (git ignores it), with
 * two changes: its manifest drops `dependencies`, because an eval run installs nothing and
 * Claude Code refuses to load a plugin whose companion plugins are missing; and
 * `--without <name>` removes one skill, one agent, or (`core`) the general instructions, to
 * measure what that piece adds. The test-only plugin in `evals/` loads core.md
 * (`evals/harness/load-instructions.ts`).
 *
 * WHICH MODEL. `--route direct` (the default) sends every run to Anthropic: an eval run takes
 * `ANTHROPIC_BASE_URL` from the person's `~/.claude/settings.json`, so with the gateway on, a
 * haiku or sonnet run would be answered by whatever that slot's chain names, and the scores
 * would measure that model. `--route settings` keeps the person's own route.
 *
 * THE TIERS (each case.yaml's `tags`), three runs a case:
 *   gate   the cases today's plugin passes; a case below PASS_SHARE fails the run.
 *   watch  the cases a planned change should fix, or that need what this machine may lack
 *          (`needs-shell`: Claude Code's Bash sandbox); scored, never failing.
 *   fast   gate and watch together, deterministic graders only: the baseline a change is
 *          compared with (`evals/baseline/<tier>-<model>.json`).
 *   full   every case against the no-plugin baseline, the judge graders too.
 * A watch case that a change makes pass in a fast run moves to gate in the same change.
 *
 * One run at a time per checkout: every run rebuilds `evals/.under-test`.
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
/** Where the copy under test goes; every case.yaml's `plugins` points at it. */
export const UNDER_TEST = join(EVALS, ".under-test", "plugin");
const CASES = join(EVALS, "cases");
const RESULTS = join(EVALS, "results");
const BASELINE = join(EVALS, "baseline");

/** The agent under test: the smallest Claude, pinned so a model rollout is not read as a plugin change. */
export const MODEL = "claude-haiku-5-5";
/** The judge for `llm` graders (the full tier only). */
export const JUDGE_MODEL = "claude-sonnet-5-5";
/** Where `--route direct` sends the runs. */
const ANTHROPIC_API = "https://api.anthropic.com";

/**
 * The tools every run may use beyond the read-only set. Bash runs in Claude Code's OS
 * sandbox (writes only in the run's workspace, no home folder, no network); Edit and Write
 * only under the workspace.
 */
export const ALLOW_TOOLS = ["Edit(./**)", "Write(./**)", "Bash"];

export interface Tier {
  ablation: "none" | "with-without";
  /** The judge graders cost money; only the full tier runs them. */
  judge: boolean;
  maxCostUsd: number;
  runs: number;
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
    runs: 3,
    tags: ["gate"],
    threshold: PASS_SHARE,
  },
  watch: { ablation: "none", judge: false, maxCostUsd: 1, runs: 3, tags: ["watch"], threshold: 0 },
  fast: {
    ablation: "none",
    judge: false,
    maxCostUsd: 2,
    runs: 3,
    tags: ["gate", "watch"],
    threshold: 0,
  },
  full: {
    ablation: "with-without",
    judge: true,
    maxCostUsd: 15,
    runs: 3,
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

export interface RunSummary {
  cases: CaseSummary[];
  claudeVersion: string;
  costUsd: number;
  model: string;
  partial: boolean;
  pluginVersion: string;
  schema: 1;
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
  meta: { model: string; pluginVersion: string; tier: string; without: string[] },
  tags: Record<string, string[]>,
): RunSummary {
  return {
    schema: 1,
    ...meta,
    claudeVersion: aggregate.claudeVersion,
    costUsd: aggregate.costUsd,
    partial: aggregate.partial,
    startedAt: aggregate.startedAt,
    cases: aggregate.cases.map((one) => {
      const graders: Record<string, number> = {};
      for (const run of one.arms.with) {
        for (const grader of run.graders) {
          graders[grader.name] = (graders[grader.name] ?? 0) + (grader.passed ? 1 : 0);
        }
      }
      const errors = one.arms.with.flatMap((run) => (run.error == null ? [] : [scrub(run.error)]));
      return {
        name: one.name,
        tags: tags[one.name] ?? [],
        runs: one.arms.with.length,
        score: one.aggregates.score,
        costUsd: one.arms.with.reduce((sum, run) => sum + run.costUsd, 0),
        errors: [...new Set(errors)],
        graders,
      };
    }),
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

export interface Options {
  caseGlob: null | string;
  /** Runs at once (1 to 8); they share the account's rate limit. */
  concurrency: number;
  /** Keep each run's workspace and trace, for reading what a case did. */
  keepTemp: boolean;
  maxCostUsd: null | number;
  model: string;
  route: "direct" | "settings";
  saveBaseline: boolean;
  without: string[];
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    caseGlob: null,
    concurrency: 1,
    keepTemp: false,
    maxCostUsd: null,
    model: MODEL,
    route: "direct",
    saveBaseline: false,
    without: [],
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
    else if (flag === "--concurrency") options.concurrency = Number(value());
    else if (flag === "--max-cost-usd") options.maxCostUsd = Number(value());
    else if (flag === "--route") {
      const route = value();
      if (route !== "direct" && route !== "settings")
        throw new Error("--route is direct or settings");
      options.route = route;
    } else throw new Error(`unknown option ${flag}`);
  }
  return options;
}

/** The `claude` command line for one tier. */
export function evalArgs(tier: Tier, options: Options, outputDir: string): string[] {
  const args: string[] = [];
  if (options.route === "direct") {
    args.push("--settings", JSON.stringify({ env: { ANTHROPIC_BASE_URL: ANTHROPIC_API } }));
  }
  args.push("plugin", "eval", ".", "--eval-dir", relative(REPO, CASES));
  args.push("--trust-plugin", "--scaffold", "--no-publish");
  args.push("--model", options.model, "--runs", String(tier.runs), "--ablation", tier.ablation);
  args.push("--threshold", String(tier.threshold));
  args.push("--max-cost-usd", String(options.maxCostUsd ?? tier.maxCostUsd));
  args.push("--output-dir", outputDir);
  if (tier.judge) args.push("--judge-model", JUDGE_MODEL);
  if (options.caseGlob !== null) args.push("--case", options.caseGlob);
  if (options.keepTemp) args.push("--keep-temp");
  if (options.concurrency > 1) args.push("--concurrency", String(options.concurrency));
  if (tier.tags.length > 0) args.push("--tag", ...tier.tags);
  args.push("--allow-tools", ...ALLOW_TOOLS);
  return args;
}

function runTier(name: string, tier: Tier, options: Options): number {
  prepare(join(REPO, "plugin"), UNDER_TEST, options.without);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join(RESULTS, `${name}-${stamp}`);
  mkdirSync(outputDir, { recursive: true });
  const env = { ...process.env };
  for (const variable of SESSION_VARIABLES) delete env[variable];
  console.log(
    `Tier ${name}: model ${options.model}, route ${options.route}${options.without.length > 0 ? `, without ${options.without.join(", ")}` : ""}`,
  );
  const run = spawnSync("claude", evalArgs(tier, options, outputDir), {
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
      model: options.model,
      pluginVersion: String(manifest.version),
      tier: name,
      without: options.without,
    },
    caseTags(CASES),
  );
  const summaryFile = join(outputDir, "summary.json");
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Summary: ${relative(REPO, summaryFile)} (cost $${summary.costUsd.toFixed(4)})`);
  // One baseline per tier and model: a run is only compared with runs of the same model.
  const baselineFile = join(BASELINE, `${name}-${options.model}.json`);
  if (options.saveBaseline) {
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
