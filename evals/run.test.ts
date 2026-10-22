/**
 * The eval runner: the copy under test, the cases a tier picks, the model and cost plan, and
 * the summary a baseline keeps. It never runs Claude Code and never launches the suite.
 * Expected values are written by hand; fixtures are built in a temp folder.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../src/testing/temp";
import {
  caseTags,
  compare,
  costCeiling,
  EVALS,
  evalArgs,
  HARNESS,
  MODEL,
  matchesGlob,
  maySaveBaseline,
  nestedSession,
  type Options,
  parseOptions,
  planRun,
  prepare,
  prepareCases,
  type RunSummary,
  runReserve,
  SONNET_MODEL,
  selectedCases,
  summarize,
  TIERS,
  UNDER_TEST,
} from "./run";

/** A small plugin: a manifest with dependencies, one skill, one agent, core.md. */
function fixturePlugin(): string {
  const root = join(tempDir("eval-plugin"), "plugin");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", "plan-task"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });
  mkdirSync(join(root, "instructions"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "my-plugin", version: "1.2.3", dependencies: [{ name: "other" }] }),
  );
  writeFileSync(join(root, "skills", "plan-task", "SKILL.md"), "---\nname: plan-task\n---\n");
  writeFileSync(join(root, "agents", "reviewer.md"), "---\nname: reviewer\n---\n");
  writeFileSync(join(root, "instructions", "core.md"), "# Core\n");
  return root;
}

/** Two cases with a `plugins:` line, as every real case has. */
function fixtureCases(): string {
  const root = join(tempDir("eval-cases"), "cases");
  for (const name of ["one", "two"]) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(
      join(root, name, "case.yaml"),
      `name: ${name}\ntags: [gate]\nplugins: ["../../.under-test/plugin", "../../harness"]\n`,
    );
    writeFileSync(join(root, name, "scaffold.sh"), "#!/bin/sh\n");
  }
  return root;
}

const BASE: Options = {
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

const NO_MARKERS = { HOME: "/home/user" };

/** The tiers a case may belong to; it must be exactly one. */
const CASE_TIERS = ["gate", "watch", "judge", "strong"];

function summary(scores: Record<string, number>): RunSummary {
  return {
    schema: 1,
    tier: "fast",
    model: "a-model",
    pluginVersion: "1.2.3",
    without: [],
    claudeVersion: "1.0.0",
    costUsd: 0,
    partial: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    cap: { ceilingUsd: 0, limitUsd: 0, reserveUsd: 0 },
    nested: null,
    skipped: [],
    cases: Object.entries(scores).map(([name, score]) => ({
      name,
      tags: ["gate"],
      runs: 3,
      score,
      costUsd: 0,
      errors: [],
      graders: {},
    })),
  };
}

describe("prepare", () => {
  test("copies the plugin without its dependencies, the rest unchanged", () => {
    const source = fixturePlugin();
    const target = join(tempDir("eval-target"), "plugin");
    prepare(source, target, []);
    expect(JSON.parse(readFileSync(join(target, ".claude-plugin", "plugin.json"), "utf8"))).toEqual(
      {
        name: "my-plugin",
        version: "1.2.3",
      },
    );
    expect(existsSync(join(target, "skills", "plan-task", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(target, "instructions", "core.md"), "utf8")).toBe("# Core\n");
    // The source keeps its dependencies: only the copy changes.
    expect(readFileSync(join(source, ".claude-plugin", "plugin.json"), "utf8")).toContain("other");
  });

  test("--without removes a skill, an agent, or empties core.md", () => {
    const source = fixturePlugin();
    const target = join(tempDir("eval-target"), "plugin");
    prepare(source, target, ["plan-task", "reviewer", "core"]);
    expect(existsSync(join(target, "skills", "plan-task"))).toBe(false);
    expect(existsSync(join(target, "agents", "reviewer.md"))).toBe(false);
    expect(readFileSync(join(target, "instructions", "core.md"), "utf8")).toBe("");
  });

  test("a --without name that is no piece of the plugin is an error", () => {
    const target = join(tempDir("eval-target"), "plugin");
    expect(() => prepare(fixturePlugin(), target, ["plan-tsak"])).toThrow(
      '--without plan-tsak: no skill, agent or "core" has that name',
    );
  });
});

describe("prepareCases", () => {
  test("copies only the named cases, with the plugins paths made absolute", () => {
    const source = fixtureCases();
    const target = join(tempDir("eval-filtered"), "cases");
    prepareCases(source, target, ["one"]);
    expect(readdirSync(target)).toEqual(["one"]);
    expect(existsSync(join(target, "one", "scaffold.sh"))).toBe(true);
    const yaml = readFileSync(join(target, "one", "case.yaml"), "utf8");
    expect(yaml).toContain(`plugins: ${JSON.stringify([UNDER_TEST, HARNESS])}`);
    // The source case is untouched.
    expect(readFileSync(join(source, "one", "case.yaml"), "utf8")).toContain(
      'plugins: ["../../.under-test/plugin", "../../harness"]',
    );
    expect(readdirSync(source).sort()).toEqual(["one", "two"]);
  });

  test("a case with no plugins line is an error, never a silently untested copy", () => {
    const source = fixtureCases();
    writeFileSync(join(source, "two", "case.yaml"), "name: two\ntags: [gate]\n");
    const target = join(tempDir("eval-filtered"), "cases");
    expect(() => prepareCases(source, target, ["two"])).toThrow(
      "two: case.yaml has no plugins line",
    );
  });
});

describe("the cases and the tiers", () => {
  test("every case is in exactly one tier and tests the copy with the harness", () => {
    const cases = join(EVALS, "cases");
    const tags = caseTags(cases);
    const names = readdirSync(cases).filter((name) => existsSync(join(cases, name, "case.yaml")));
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const name of names) {
      const tiers = (tags[name] ?? []).filter((tag) => CASE_TIERS.includes(tag));
      expect({ name, tiers: tiers.length }).toEqual({ name, tiers: 1 });
      const yaml = readFileSync(join(cases, name, "case.yaml"), "utf8");
      expect({ name, plugins: /^plugins: (.*)$/m.exec(yaml)?.[1] }).toEqual({
        name,
        plugins: '["../../.under-test/plugin", "../../harness"]',
      });
    }
  });

  test("the crew cases that need Sonnet are in strong, and full leaves them to it", () => {
    const tags = caseTags(join(EVALS, "cases"));
    const strong = Object.keys(tags)
      .filter((name) => (tags[name] ?? []).includes("strong"))
      .sort();
    expect(strong).toEqual(["lead-starts-the-whole-plan", "phase-to-crew"]);
    expect(TIERS.strong?.model).toBe(SONNET_MODEL);
    expect(TIERS.strong?.tags).toEqual(["strong"]);
    // fast stays one model, so its baseline stays one model's: the crew cases left it.
    expect(TIERS.fast?.tags).toEqual(["gate", "watch"]);
    expect(TIERS.full?.skipTags).toEqual(["strong"]);
  });

  test("selectedCases follows the tier's tags, the skip tags, and one glob", () => {
    const tags = {
      "a-gate": ["gate"],
      "b-watch": ["watch"],
      "c-shell": ["watch", "needs-shell"],
      "d-strong": ["strong"],
    };
    const fast = TIERS.fast;
    const full = TIERS.full;
    if (fast === undefined || full === undefined) throw new Error("no fast or full tier");
    expect(selectedCases(fast, null, tags)).toEqual(["a-gate", "b-watch", "c-shell"]);
    expect(selectedCases(fast, "*-shell", tags)).toEqual(["c-shell"]);
    expect(selectedCases(full, null, tags)).toEqual(["a-gate", "b-watch", "c-shell"]);
    expect(selectedCases(full, "a-*", tags)).toEqual(["a-gate"]);
  });
});

describe("the nested session", () => {
  test("any session marker means a nested run; a plain environment is not one", () => {
    expect(nestedSession(NO_MARKERS)).toBeNull();
    expect(nestedSession({ CLAUDECODE: "1" })).toBe("CLAUDECODE");
    expect(nestedSession({ CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "abc" })).toBe(
      "CLAUDE_CODE_SESSION_ID",
    );
    expect(nestedSession({ CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe("CLAUDE_CODE_ENTRYPOINT");
  });

  test("a nested fast run refuses the needs-shell cases with one line, and runs none of them", () => {
    const tags = { "a-gate": ["gate"], "b-shell": ["watch", "needs-shell"] };
    expect(() => planRun("fast", tier("fast"), BASE, { CLAUDECODE: "1" }, tags)).toThrow(
      /nested in a Claude Code session \(CLAUDECODE is set\).*needs-shell case\(s\) would score void.*--without-needs-shell/,
    );
  });

  test("--without-needs-shell runs the other cases and says which it left out", () => {
    const tags = { "a-gate": ["gate"], "b-shell": ["watch", "needs-shell"] };
    const plan = planRun(
      "fast",
      tier("fast"),
      { ...BASE, withoutNeedsShell: true },
      { CLAUDECODE: "1" },
      tags,
    );
    expect(plan.cases).toEqual(["a-gate"]);
    expect(plan.skippedShell).toEqual(["b-shell"]);
    expect(plan.nested).toBe("CLAUDECODE");
    expect(plan.evalDir).not.toBe(join(EVALS, "cases"));
    expect(maySaveBaseline(plan)).toBe(false);
  });

  test("a nested run never saves a baseline, even one with no shell case", () => {
    const tags = { "a-gate": ["gate"], "d-strong": ["strong"] };
    const outside = planRun("gate", tier("gate"), BASE, NO_MARKERS, tags);
    expect(outside.nested).toBeNull();
    expect(maySaveBaseline(outside)).toBe(true);
    const nested = planRun("gate", tier("gate"), BASE, { CLAUDECODE: "1" }, tags);
    expect(nested.cases).toEqual(["a-gate"]);
    expect(maySaveBaseline(nested)).toBe(false);
  });

  test("every case left needs a shell is refused, not run as an empty suite", () => {
    const tags = { "b-shell": ["watch", "needs-shell"] };
    expect(() =>
      planRun("watch", tier("watch"), { ...BASE, withoutNeedsShell: true }, NO_MARKERS, tags),
    ).toThrow("every case it selects needs the shell");
  });
});

describe("the model and the cost cap", () => {
  test("a tier runs its own model; --model overrides it; strong runs Sonnet", () => {
    const options = { ...BASE, route: "settings" as const };
    const haiku = evalArgs(tier("fast"), options, "/out", {
      ceilingUsd: 2,
      evalDir: join(EVALS, "cases"),
      model: MODEL,
    });
    expect(haiku.slice(0, 3)).toEqual(["plugin", "eval", "."]);
    expect(haiku[haiku.indexOf("--model") + 1]).toBe(MODEL);
    const strong = planRun("strong", tier("strong"), options, NO_MARKERS, {
      "d-strong": ["strong"],
    });
    expect(strong.model).toBe(SONNET_MODEL);
    const override = planRun(
      "strong",
      tier("strong"),
      { ...options, model: "another-model" },
      NO_MARKERS,
      { "d-strong": ["strong"] },
    );
    expect(override.model).toBe("another-model");
  });

  test("the direct route sends the runs to Anthropic; the settings route adds nothing", () => {
    const plan = { ceilingUsd: 1, evalDir: join(EVALS, "cases"), model: "a-model" };
    const direct = evalArgs(tier("gate"), { ...BASE, route: "direct" }, "/out", plan);
    expect(direct.slice(0, 2)).toEqual([
      "--settings",
      '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}',
    ]);
    expect(direct).toContain("--tag");
    const own = evalArgs(tier("gate"), { ...BASE, route: "settings" }, "/out", plan);
    expect(own).not.toContain("--settings");
    expect(own.slice(0, 3)).toEqual(["plugin", "eval", "."]);
  });

  test("the ceiling counts the runs in flight at the reserve", () => {
    expect(costCeiling(2, 1, 0.25)).toBe(2);
    expect(costCeiling(2, 4, 0.25)).toBe(1.25);
    expect(costCeiling(3, 3, 0.5)).toBe(2);
    expect(costCeiling(0.5, 4, 0.25)).toBe(0);
  });

  test("the reserve is the highest cost per run in the baseline, never below the fixed one", () => {
    const one = (name: string, costUsd: number, runs: number) => ({
      name,
      tags: ["gate"],
      runs,
      score: 1,
      costUsd,
      errors: [],
      graders: {},
    });
    const baseline: RunSummary = {
      ...summary({}),
      cases: [one("a", 0.9, 3), one("b", 0.01, 3)],
    };
    expect(runReserve(["a", "b"], baseline)).toBe(0.3);
    expect(runReserve(["b"], baseline)).toBe(0.25);
    expect(runReserve(["a"], null)).toBe(0.25);
    // A run count of zero cannot be divided by, and never wins.
    expect(runReserve(["a"], { ...baseline, cases: [one("a", 9, 0)] })).toBe(0.25);
  });

  test("the plan passes the lowered ceiling, and refuses a cap that cannot hold a run", () => {
    const tags = { "a-gate": ["gate"] };
    const plan = planRun("test-tier", tier("gate"), { ...BASE, concurrency: 4 }, NO_MARKERS, tags);
    expect(plan.ceilingUsd).toBe(0.25);
    expect(plan.limitUsd).toBe(1);
    expect(plan.reserveUsd).toBe(0.25);
    const args = evalArgs(tier("gate"), { ...BASE, concurrency: 4 }, "/out", plan);
    expect(args[args.indexOf("--max-cost-usd") + 1]).toBe("0.25");
    expect(() =>
      planRun(
        "test-tier",
        tier("gate"),
        { ...BASE, concurrency: 4, maxCostUsd: 0.5 },
        NO_MARKERS,
        tags,
      ),
    ).toThrow(/cap cannot hold 3 run\(s\) in flight at the \$0.25 reserve/);
  });
});

describe("summarize and compare", () => {
  test("a summary counts each grader's passing runs, and names no folder of the machine", () => {
    const home = process.env.HOME ?? "/home/user";
    const run = (error: null | string, a: boolean, b: boolean) => ({
      costUsd: 0.25,
      turns: 3,
      error,
      graders: [
        { name: "a", passed: a },
        { name: "b", passed: b },
      ],
    });
    const failed = `failed in ${home}/x and /tmp/claude-eval-AbC123/out`;
    const result = summarize(
      {
        claudeVersion: "1.0.0",
        costUsd: 0.75,
        partial: false,
        startedAt: "2026-01-01T00:00:00.000Z",
        cases: [
          {
            name: "one",
            aggregates: { score: 0.5 },
            arms: {
              with: [run(failed, true, false), run(null, true, true), run(failed, false, false)],
            },
          },
        ],
      },
      {
        cap: { ceilingUsd: 1.25, limitUsd: 2, reserveUsd: 0.25 },
        model: "a-model",
        nested: null,
        pluginVersion: "1.2.3",
        runs: 3,
        selected: ["one"],
        skippedShell: [],
        tier: "fast",
        without: [],
      },
      { one: ["gate"] },
    );
    expect(result.cases).toEqual([
      {
        name: "one",
        tags: ["gate"],
        runs: 3,
        score: 0.5,
        costUsd: 0.75,
        errors: ["failed in ~/x and <run>/out"],
        graders: { a: 2, b: 1 },
      },
    ]);
    expect(result.cap).toEqual({ ceilingUsd: 1.25, limitUsd: 2, reserveUsd: 0.25 });
    expect(result.nested).toBeNull();
    expect(result.skipped).toEqual([]);
  });

  test("a partial run records the runs the cap stopped and the cases it never started", () => {
    const result = summarize(
      {
        claudeVersion: "1.0.0",
        costUsd: 0.5,
        partial: true,
        startedAt: "2026-01-01T00:00:00.000Z",
        cases: [
          {
            name: "started",
            aggregates: { score: 0.5 },
            arms: {
              with: [
                {
                  costUsd: 0.25,
                  turns: 3,
                  error: null,
                  graders: [{ name: "a", passed: true }],
                },
              ],
            },
          },
        ],
      },
      {
        cap: { ceilingUsd: 1.25, limitUsd: 2, reserveUsd: 0.25 },
        model: "a-model",
        nested: "CLAUDECODE",
        pluginVersion: "1.2.3",
        runs: 3,
        selected: ["started", "never-started"],
        skippedShell: ["shell"],
        tier: "fast",
        without: [],
      },
      { started: ["gate"], "never-started": ["gate"], shell: ["watch", "needs-shell"] },
    );
    expect(result.partial).toBe(true);
    expect(result.nested).toBe("CLAUDECODE");
    expect(result.skipped).toEqual([
      { case: "started", reason: "cost-cap", runs: 2 },
      { case: "never-started", reason: "cost-cap", runs: 3 },
      { case: "shell", reason: "needs-shell", runs: 3 },
    ]);
  });

  test("compare lists the cases that lost score; a new case is never worse", () => {
    const { changes, worse } = compare(
      summary({ kept: 1, dropped: 1, raised: 0 }),
      summary({ kept: 1, dropped: 0.5, raised: 1, added: 0 }),
    );
    expect(worse.map((change) => change.name)).toEqual(["dropped"]);
    expect(changes.find((change) => change.name === "added")).toEqual({
      name: "added",
      before: null,
      after: 0,
    });
  });
});

/** A tier that exists: the test fails loudly if a tier is renamed away. */
function tier(name: string) {
  const found = TIERS[name];
  if (found === undefined) throw new Error(`no ${name} tier`);
  return found;
}

describe("the options", () => {
  test("no --model leaves the tier's model alone; the shell flag is off by default", () => {
    expect(parseOptions([])).toEqual({
      caseGlob: null,
      concurrency: 1,
      keepTemp: false,
      maxCostUsd: null,
      model: null,
      route: "direct",
      saveBaseline: false,
      without: [],
      withoutNeedsShell: false,
    });
    expect(parseOptions(["--model", "x", "--without-needs-shell"]).model).toBe("x");
    expect(parseOptions(["--without-needs-shell"]).withoutNeedsShell).toBe(true);
  });

  test("a bad concurrency or cost is a clear error, never a run with a NaN cap", () => {
    expect(() => parseOptions(["--concurrency", "0"])).toThrow(
      "--concurrency is a whole number from 1 to 8",
    );
    expect(() => parseOptions(["--concurrency", "9"])).toThrow(
      "--concurrency is a whole number from 1 to 8",
    );
    expect(() => parseOptions(["--concurrency", "two"])).toThrow(
      "--concurrency is a whole number from 1 to 8",
    );
    expect(() => parseOptions(["--max-cost-usd", "abc"])).toThrow(
      "--max-cost-usd is a positive number",
    );
    expect(() => parseOptions(["--max-cost-usd", "0"])).toThrow(
      "--max-cost-usd is a positive number",
    );
  });
});

describe("matchesGlob", () => {
  test("matches whole names, with * and ? only, as the suite does", () => {
    expect(matchesGlob("lead-*", "lead-starts-the-whole-plan")).toBe(true);
    expect(matchesGlob("*-crew", "phase-to-crew")).toBe(true);
    expect(matchesGlob("phase?to?crew", "phase-to-crew")).toBe(true);
    expect(matchesGlob("phase-to-crew", "phase-to-crew-extra")).toBe(false);
    expect(matchesGlob("phase.to.crew", "phaseXtoXcrew")).toBe(false);
    expect(matchesGlob("a+b", "a+b")).toBe(true);
  });
});
