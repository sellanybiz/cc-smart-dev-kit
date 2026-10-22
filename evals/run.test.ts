/**
 * The eval runner: the copy under test, the summary a baseline keeps, the comparison, and
 * the shape every case must have. It never runs Claude Code. Expected values are written by
 * hand; a plugin fixture is built in a temp folder.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../src/testing/temp";
import {
  caseTags,
  compare,
  EVALS,
  evalArgs,
  prepare,
  type RunSummary,
  summarize,
  TIERS,
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
      { model: "a-model", pluginVersion: "1.2.3", tier: "fast", without: [] },
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

describe("the tiers and the cases", () => {
  test("the direct route sends the runs to Anthropic; the settings route adds nothing", () => {
    const base = {
      caseGlob: null,
      concurrency: 1,
      keepTemp: false,
      maxCostUsd: null,
      model: "a-model",
      saveBaseline: false,
      without: [],
    };
    const gate = TIERS.gate;
    if (gate === undefined) throw new Error("no gate tier");
    const direct = evalArgs(gate, { ...base, route: "direct" }, "/out");
    expect(direct.slice(0, 2)).toEqual([
      "--settings",
      '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}',
    ]);
    expect(direct).toContain("--tag");
    const own = evalArgs(gate, { ...base, route: "settings" }, "/out");
    expect(own).not.toContain("--settings");
    expect(own.slice(0, 3)).toEqual(["plugin", "eval", "."]);
  });

  test("every case is in exactly one tier and tests the copy with the harness", () => {
    const cases = join(EVALS, "cases");
    const tags = caseTags(cases);
    const names = readdirSync(cases).filter((name) => existsSync(join(cases, name, "case.yaml")));
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const name of names) {
      const tiers = (tags[name] ?? []).filter((tag) => ["gate", "watch", "judge"].includes(tag));
      expect({ name, tiers: tiers.length }).toEqual({ name, tiers: 1 });
      const yaml = readFileSync(join(cases, name, "case.yaml"), "utf8");
      expect({ name, plugins: /^plugins: (.*)$/m.exec(yaml)?.[1] }).toEqual({
        name,
        plugins: '["../../.under-test/plugin", "../../harness"]',
      });
    }
  });
});
