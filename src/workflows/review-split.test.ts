/**
 * `plugin/workflows/review-split.js`: the second opinion on a big change set, split across
 * review tracks. One senior engineer per track on the tier D46 gives the change set (`sonnet`
 * at `high`, or `opus` at `xhigh` for a risky one), a second one to refute every finding on the
 * same tier, and the verified findings merged and ranked. Every launch takes the editing tools
 * away, and every launch is a literal the agent guard allows (`scripts.test.ts` proves it for
 * each shipped script and the guard the plugin ships).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GatewayConfig } from "../gateway/config";
import { type GuardContext, judgeWorkflow } from "../hooks/agent-guard";
import { REVIEW_MODE_MARKER } from "../hooks/review-record";
import { loadScriptParser } from "../hooks/script-parser";
import { TASK_TOOL, taskToolId } from "../tasks/words";
import { recordsReview } from "../workflow/reviews";
import { workflowDefaults } from "../workflow/schema";
import type { AgentCall } from "./script-runner";
import { runScript } from "./script-runner";

// The guard's bundle loads its script parser in its entry; this file judges a script too.
loadScriptParser();

const REVIEW_SPLIT = join(import.meta.dir, "..", "..", "plugin", "workflows", "review-split.js");
const NO_ENV = {} as Record<string, string | undefined>;
const REVIEWER = "cc-smart-dev-kit:senior-engineer";
/** The kit's task tools that write: a reviewer reports, it never changes the task ledger. */
const TASK_WRITES = ["create", "update", "done", "note", "delete", "take"] as const;
/**
 * The tools each launch takes away: the tracks share one checkout, so none edits a file; an agent
 * a track started would send it a notice the review record counts as a later prompt; and none
 * writes the task ledger, which the lead owns.
 */
const NO_EDITS = [
  "Edit",
  "Write",
  "NotebookEdit",
  "Agent",
  ...TASK_WRITES.map((operation) => taskToolId(TASK_TOOL[operation])),
];

/** A finding, as a reviewer's schema returns it. */
function finding(title: string, severity = "warning", file = "src/a.ts", line = 1) {
  return {
    confidence: "high",
    file,
    fix: "check the value before the call",
    line,
    missingGuard: "nothing checks the value",
    outcome: "the call throws",
    severity,
    title,
    trigger: "a call with an empty value",
  };
}

/** The label a call carries: the script writes `review: <track>` and `refute: <file>`. */
function labelOf(call: AgentCall): string {
  return String(call.options.label ?? "");
}

const isReview = (call: AgentCall): boolean => labelOf(call).startsWith("review:");
const isRefute = (call: AgentCall): boolean => labelOf(call).startsWith("refute:");

/** A review answer with the given findings, and a refuter that confirms everything. */
const answers =
  (findings: unknown[], verdict = "confirmed") =>
  (call: AgentCall) =>
    isReview(call)
      ? { coverage: "read src/a.ts", findings, hunches: [] }
      : { evidence: "src/a.ts:1", reason: "checked", verdict };

describe("the review-split workflow", () => {
  test("one reviewer per track with no editing tools, on sonnet at high for an ordinary change set", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: {
        base: "main",
        intent: "adds the response cache",
        tracks: ["state and timing", "access and money"],
      },
    });
    expect(run.phases).toEqual(["Review", "Refute"]);
    const reviews = run.calls.filter(isReview);
    expect(reviews.map(labelOf)).toEqual(["review: state and timing", "review: access and money"]);
    for (const call of reviews) {
      expect(call.options).toMatchObject({
        agentType: REVIEWER,
        disallowedTools: NO_EDITS,
        effort: "high",
        model: "sonnet",
      });
      expect(typeof call.options.schema).toBe("object");
    }
    const prompt = reviews[0]?.prompt ?? "";
    expect(prompt).toContain("Change no file");
    expect(prompt).toContain(
      "\n\nEnd by calling the StructuredOutput tool; never end with plain text.",
    );
    expect(prompt).toContain("`git diff main...HEAD`");
    expect(prompt).toContain("adds the response cache");
    expect(prompt).toContain("Your track: state and timing");
    expect(prompt).toContain("hunches");
    expect(prompt).toContain("A design finding's missing guard is the rule it breaks.");
  });

  test("a risky change set runs every launch on opus at xhigh: the reviewers and the refuters", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("A")]),
      args: { base: "main", risky: true, tracks: ["craft"] },
    });
    expect(run.calls.length).toBe(2);
    for (const call of run.calls) {
      expect(call.options).toMatchObject({
        agentType: REVIEWER,
        disallowedTools: NO_EDITS,
        effort: "xhigh",
        model: "opus",
      });
    }
  });

  test("a second reviewer refutes each finding, with the finding in its brief", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("A")]),
      args: { base: "main", tracks: ["craft"] },
    });
    const refute = run.calls.find(isRefute);
    expect(refute?.options).toMatchObject({
      agentType: REVIEWER,
      disallowedTools: NO_EDITS,
      effort: "high",
      label: "refute: src/a.ts",
      model: "sonnet",
    });
    expect(typeof refute?.options.schema).toBe("object");
    expect(refute?.prompt).toContain('"title": "A"');
    expect(refute?.prompt).toContain("Refute one finding");
    expect(refute?.prompt).toContain("missing guard");
    expect(refute?.prompt).toContain("A design finding's missing guard is the rule it breaks.");
    expect(refute?.prompt).toContain(
      "A project convention or sibling files with that shape refute it.",
    );
  });

  test("two tracks that prove the same finding get one refuter, not two", async () => {
    let reviews = 0;
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => {
        if (!isReview(call)) return { reason: "checked", verdict: "confirmed" };
        reviews += 1;
        return { findings: [finding("Double charge on retry")], hunches: [] };
      },
      args: { base: "main", tracks: ["state and timing", "access and money"] },
    });
    expect(reviews).toBe(2);
    expect(run.calls.filter(isRefute).length).toBe(1);
    expect(run.logs.join("\n")).toContain("2 finding(s) reported, 1 distinct; 1 refuted");
  });

  test("only a confirmed finding reaches the report, and the most severe comes first", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) =>
        isReview(call)
          ? {
              findings: [
                finding("Stale cache key"),
                finding("A missing tenant id", "critical", "src/b.ts", 9),
              ],
              hunches: [],
            }
          : { reason: "checked", verdict: "confirmed" },
      args: { base: "main", tracks: ["state and timing"] },
    });
    const report = String(run.result);
    expect(report).toContain("[CRITICAL] A missing tenant id — src/b.ts:9");
    expect(report).toContain("[WARNING] Stale cache key — src/a.ts:1");
    expect(report.indexOf("A missing tenant id")).toBeLessThan(report.indexOf("Stale cache key"));
  });

  test("a refuted finding is dropped and counted; an unproven one is listed under Hunches with why", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => {
        if (isReview(call)) {
          return {
            findings: [
              finding("kept"),
              finding("dropped refuted"),
              finding("not settled", "critical", "src/c.ts", 4),
            ],
            hunches: ["maybe B"],
          };
        }
        if (call.prompt.includes('"title": "kept"')) {
          return { reason: "checked", verdict: "confirmed" };
        }
        if (call.prompt.includes('"title": "dropped refuted"')) {
          return { reason: "a validator stops it", verdict: "refuted" };
        }
        return { reason: "the caller is in another repo", verdict: "unproven" };
      },
      args: { base: "main", tracks: ["craft"] },
    });
    const report = String(run.result);
    expect(report).toContain(
      "## Findings (1, most severe first)\n\n1. [WARNING] kept — src/a.ts:1",
    );
    expect(report).not.toContain("dropped refuted");
    expect(report).toContain("1 of 3 checked finding(s) were refuted, and are not listed.");
    expect(report).toContain(
      "1 of 3 checked finding(s) were left unproven: they are listed under Hunches.",
    );
    expect(report).toContain(
      "## Hunches (unproven, never findings)\n\n- [CRITICAL] not settled — src/c.ts:4 (unproven: the caller is in another repo)\n  trigger: a call with an empty value\n  fix: check the value before the call\n- maybe B",
    );
  });

  test("a refuter that returns nothing leaves its finding unproven under Hunches, not dropped", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) =>
        isReview(call) ? { findings: [finding("no answer", "warning", "src/q.ts", 2)] } : null,
      args: { base: "main", tracks: ["craft"] },
    });
    const report = String(run.result);
    expect(report).toContain(
      "- [WARNING] no answer — src/q.ts:2 (unproven: the refuter returned no answer)\n  trigger:",
    );
    expect(report).not.toContain("were refuted");
  });

  test("no checked finding confirmed, some unproven: the headline sends the reader to Hunches", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("A"), finding("B", "critical", "src/b.ts", 2)], "unproven"),
      args: { base: "main", tracks: ["craft"] },
    });
    const report = String(run.result);
    expect(report).toContain(
      "Tier: ordinary (`sonnet` at `high`) · tracks: 1 · written for: what its commits and the diff say it does\nNo checked finding was confirmed; 2 are listed under Hunches.\n## Hunches",
    );
    expect(report).not.toContain("survived refutation");
    expect(report).not.toContain("were left unproven");
  });

  test("none confirmed, some unproven and some past the budget: the headline names both", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("A"), finding("B", "suggestion", "src/b.ts", 2)], "unproven"),
      args: { base: "main", budget: 1, tracks: ["craft"] },
    });
    expect(String(run.result)).toContain(
      "No checked finding was confirmed; 1 is listed under Hunches. The unchecked ones are listed below.",
    );
  });

  test("the caller's budget caps the findings refuted", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("A"), finding("B"), finding("C")]),
      args: { base: "main", budget: 2, tracks: ["craft"] },
    });
    expect(run.calls.filter(isRefute).length).toBe(2);
    expect(run.logs.join("\n")).toContain("3 finding(s) reported, 3 distinct; 2 refuted");
  });

  test("more findings than the budget: the most severe are refuted, the rest come back unchecked", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([
        finding("w1", "warning", "src/w1.ts", 1),
        finding("s1", "suggestion", "src/s1.ts", 2),
        finding("c1", "critical", "src/c1.ts", 3),
        finding("w2", "warning", "src/w2.ts", 4),
      ]),
      args: { base: "main", budget: 2, tracks: ["craft"] },
    });
    expect(run.calls.filter(isRefute).map(labelOf)).toEqual([
      "refute: src/c1.ts",
      "refute: src/w1.ts",
    ]);
    const report = String(run.result);
    expect(report).toContain("## Unchecked (2, not refuted: check them or run again)");
    expect(report).toContain("- [WARNING] w2 — src/w2.ts:4");
    expect(report).toContain("- [SUGGESTION] s1 — src/s1.ts:2");
    expect(report).toContain("2 of 4 distinct finding(s) refuted against the code; 2 not refuted");
    expect(run.logs.join("\n")).toContain("2 refuted against the code, 2 not");
  });

  test("a critical finding in the last track is refuted even when an earlier track fills the budget", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => {
        if (!isReview(call)) return { reason: "checked", verdict: "confirmed" };
        return labelOf(call) === "review: busy"
          ? {
              findings: [1, 2, 3, 4].map((n) =>
                finding(`busy ${n}`, "suggestion", `src/busy${n}.ts`),
              ),
            }
          : { findings: [finding("the critical one", "critical", "src/last.ts", 7)] };
      },
      args: { base: "main", budget: 2, tracks: ["busy", "last"] },
    });
    const refuted = run.calls.filter(isRefute).map(labelOf);
    expect(refuted).toContain("refute: src/last.ts");
    expect(String(run.result)).toContain("[CRITICAL] the critical one — src/last.ts:7");
    expect(String(run.result)).toContain("## Unchecked (3,");
  });

  test("a finding without a line is listed unchecked by its file alone", async () => {
    const lineless = { ...finding("no line", "suggestion", "src/n.ts"), line: undefined };
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("first", "critical"), lineless]),
      args: { base: "main", budget: 1, tracks: ["craft"] },
    });
    expect(String(run.result)).toContain("- [SUGGESTION] no line — src/n.ts\n");
  });

  test("every checked finding refuted but some unchecked: the report does not read as clean", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("A"), finding("B", "suggestion", "src/b.ts")], "refuted"),
      args: { base: "main", budget: 1, tracks: ["craft"] },
    });
    const report = String(run.result);
    expect(report).toContain("No checked finding survived refutation");
    expect(report).not.toContain("No finding survived refutation.");
    expect(report).toContain("- [SUGGESTION] B — src/b.ts:1");
  });

  test("nothing past the budget: no unchecked section", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([finding("A")]),
      args: { base: "main", tracks: ["craft"] },
    });
    expect(String(run.result)).not.toContain("Unchecked");
  });

  test("a string argument is refused with one line that names the expected object, and no agent starts", async () => {
    const calls: unknown[] = [];
    const attempt = runScript(REVIEW_SPLIT, {
      answer: (call) => {
        calls.push(call);
        return null;
      },
      args: '{"base":"main","risky":true}',
    });
    await expect(attempt).rejects.toThrow(/review-split refused its arguments \(got a string/);
    await expect(attempt).rejects.toThrow(/Pass one object: \{ base\?: string/);
    await attempt.catch((error: Error) => expect(error.message.includes("\n")).toBe(false));
    expect(calls).toEqual([]);
  });

  test("an unknown key is refused, and the message names it", async () => {
    await expect(
      runScript(REVIEW_SPLIT, { args: { base: "main", risk: true, tracks: ["craft"] } }),
    ).rejects.toThrow(/unknown key "risk"/);
  });

  test("a wrong type is refused, and the message names the key", async () => {
    const bad: Array<[string, unknown]> = [
      ["risky", "true"],
      ["budget", "12"],
      ["budget", 0],
      ["budget", 2.5],
      ["tracks", "craft"],
      ["tracks", [1]],
      ["base", 5],
      ["head", ["x"]],
      ["folder", {}],
      ["intent", false],
    ];
    for (const [key, value] of bad) {
      await expect(
        runScript(REVIEW_SPLIT, { args: { base: "main", [key]: value } }),
      ).rejects.toThrow(new RegExp(`"${key}" must be`));
    }
  });

  test("a null, an array or a number is refused too; the object runs as before", async () => {
    for (const args of [null, ["main"], 12]) {
      await expect(runScript(REVIEW_SPLIT, { args })).rejects.toThrow(
        /review-split refused its arguments/,
      );
    }
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: {
        base: "main",
        budget: 3,
        folder: "/tmp/x",
        head: "HEAD",
        intent: "adds a cache",
        risky: true,
        tracks: ["craft"],
      },
    });
    expect(run.calls.filter(isReview).length).toBe(1);
    expect(run.calls[0]?.options).toMatchObject({ effort: "xhigh", model: "opus" });
  });

  test("its literal agentType matches the schema default for the merge guard", () => {
    const script = readFileSync(REVIEW_SPLIT, "utf8");
    const launches = judgeWorkflow(
      script,
      { config: null, gatewayOn: false, sessionModel: null },
      NO_ENV,
    );
    expect(launches.length).toBe(4);
    expect(workflowDefaults.reviewAgents[0]).toBe(REVIEWER);
    for (const launch of launches) {
      expect(launch.launch.agentType).toBe(REVIEWER);
      expect(recordsReview(launch.launch.agentType ?? "", workflowDefaults.reviewAgents)).toBe(
        true,
      );
    }
  });

  test("every track brief carries the review marker alone on a line; no refuter brief does", async () => {
    const hasMarker = (call: AgentCall): boolean =>
      call.prompt.split(/\r?\n/).some((line) => line === REVIEW_MODE_MARKER);
    for (const risky of [false, true]) {
      const run = await runScript(REVIEW_SPLIT, {
        answer: answers([finding("A"), finding("B", "critical", "src/b.ts", 2)]),
        args: { base: "main", risky, tracks: ["state and timing", "access and money"] },
      });
      const reviews = run.calls.filter(isReview);
      const refuters = run.calls.filter(isRefute);
      expect(reviews.length).toBe(2);
      expect(refuters.length).toBe(2);
      expect(reviews.map(hasMarker)).toEqual([true, true]);
      expect(refuters.map(hasMarker)).toEqual([false, false]);
    }
  });

  test("run by hand with no args: one track over the branch's change, twelve findings, sonnet", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers(Array.from({ length: 20 }, (_, index) => finding(`F${index}`))),
    });
    const reviews = run.calls.filter(isReview);
    expect(reviews.map(labelOf)).toEqual([
      "review: every review dimension and edge-case axis that applies to this change",
    ]);
    expect(reviews[0]?.prompt).toContain("the change on this branch");
    expect(reviews[0]?.options.model).toBe("sonnet");
    expect(run.calls.filter(isRefute).length).toBe(12);
    expect(String(run.result)).toContain("# Second opinion - the change on this branch");
  });

  test("the hunches and the coverage reach the report, apart from the findings", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) =>
        isReview(call)
          ? {
              coverage: "read src/a.ts, not src/b.ts",
              findings: [finding("A")],
              hunches: ["maybe B"],
            }
          : { reason: "checked", verdict: "confirmed" },
      args: { base: "main", tracks: ["craft"] },
    });
    const report = String(run.result);
    expect(report).toContain("## Hunches (unproven, never findings)");
    expect(report).toContain("- maybe B");
    expect(report).toContain("track 1 (craft): read src/a.ts, not src/b.ts");
  });

  test("with the gateway on and an affordable worker slot, the guard still allows every launch", () => {
    const workerBackend: GatewayConfig = {
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com",
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
      modelSlots: {},
      port: 20100,
      slots: { "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"] },
      timeouts: { firstByteMs: 60_000 },
      version: 1,
    };
    const context: GuardContext = { config: workerBackend, gatewayOn: true, sessionModel: null };
    const script = readFileSync(REVIEW_SPLIT, "utf8");
    // The ordinary and the risky launch sets: each allowed, on a plain machine and behind the slot.
    expect(judgeWorkflow(script, context, NO_ENV).map((one) => one.verdict.decision)).toEqual([
      "allow",
      "allow",
      "allow",
      "allow",
    ]);
  });
});

/** The lines a round-2 prompt carries. */
const ROUND_TWO_LINES = [
  "This is round 2.",
  "Report each round 1 finding in `priorStatus` as fixed, not_fixed or worse, with the evidence",
  "copying its title and its file and line exactly as the report gives them",
  "Check that the fixes broke nothing around them.",
  "Report what round 1 missed in the change set, at the same evidence bar.",
];
const SPEC_TRACK = "spec compliance";
/** What every track reads when the run has a plan. */
const PLAN_LINES = [
  "Read the plan file `.claude/plans/the-plan.md` first.",
  "Judge your track against the plan's decisions and edge cases as well as against the code.",
];
/** What only the spec track does: the point-by-point check. */
const SPEC_LINES = [
  "each Decision and each Edge case",
  "met, or failed with file:line",
  "task_list",
  "task_get",
  "A step done only in name is a spec failure",
];
/** A coverage long enough to count as evidence. */
const SOLID_COVERAGE = "read src/a.ts and src/b.ts; ran bun test src/a.test.ts: 4 pass, 0 fail";

describe("the review-split spec track and round-2 mode", () => {
  test("spec adds exactly one spec track, after the given tracks, and only that track gets the point-by-point check", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: {
        base: "main",
        spec: ".claude/plans/the-plan.md",
        tracks: ["state and timing", "access and money"],
      },
    });
    const reviews = run.calls.filter(isReview);
    expect(reviews.map(labelOf)).toEqual([
      "review: state and timing",
      "review: access and money",
      `review: ${SPEC_TRACK}`,
    ]);
    for (const call of reviews.slice(0, 2)) {
      for (const line of SPEC_LINES) expect(call.prompt).not.toContain(line);
    }
    const spec = reviews[2];
    expect(spec?.prompt).toContain(`Your track: ${SPEC_TRACK}`);
    for (const line of SPEC_LINES) expect(spec?.prompt).toContain(line);
    expect(spec?.options).toMatchObject({
      agentType: REVIEWER,
      disallowedTools: NO_EDITS,
      effort: "high",
      model: "sonnet",
    });
    expect(String(run.result)).toContain("tracks: 3");
  });

  test("with spec, every track prompt names the plan file and judges against its decisions; without it none does", async () => {
    const withSpec = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: {
        base: "main",
        spec: ".claude/plans/the-plan.md",
        tracks: ["state and timing", "access and money"],
      },
    });
    const planned = withSpec.calls.filter(isReview);
    expect(planned.length).toBe(3);
    for (const call of planned) {
      for (const line of PLAN_LINES) expect(call.prompt).toContain(line);
    }
    const without = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", tracks: ["state and timing"] },
    });
    for (const call of without.calls.filter(isReview)) {
      expect(call.prompt).not.toContain("the plan's decisions");
      expect(call.prompt).not.toContain("plan file");
    }
  });

  test("with spec and prior together, the spec track has both parts and the others have the plan and round-2 parts", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: {
        base: "main",
        prior: "round 1 report",
        spec: ".claude/plans/the-plan.md",
        tracks: ["craft"],
      },
    });
    const [craft, spec] = run.calls.filter(isReview);
    for (const call of [craft, spec]) {
      for (const line of [...PLAN_LINES, ...ROUND_TWO_LINES]) {
        expect(call?.prompt).toContain(line);
      }
    }
    for (const line of SPEC_LINES) {
      expect(spec?.prompt).toContain(line);
      expect(craft?.prompt).not.toContain(line);
    }
  });

  test("the spec track is the one the script adds, wherever a named track sits or what it is called", async () => {
    // Claude Code calls a stage as (prevResult, originalItem, index): a script that reads the
    // index from the second argument never marks the spec track. Position and name must not matter.
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", spec: ".claude/plans/the-plan.md", tracks: [SPEC_TRACK, "craft"] },
    });
    const reviews = run.calls.filter(isReview);
    expect(reviews.map(labelOf)).toEqual([
      `review: ${SPEC_TRACK}`,
      "review: craft",
      `review: ${SPEC_TRACK}`,
    ]);
    const hasSpecLines = reviews.map((call) =>
      SPEC_LINES.every((line) => call.prompt.includes(line)),
    );
    expect(hasSpecLines).toEqual([false, false, true]);
  });

  test("the spec track finds the plan's tasks by the slug in the plan file's name", async () => {
    const cases: Array<[string, string]> = [
      [".claude/plans/archive/2026-11-20-plan-review-rounds.md", "plan-review-rounds"],
      [".claude/plans/2026-01-02-fix-the-thing.md", "fix-the-thing"],
      [".claude/plans/no-date-plan.md", "no-date-plan"],
      [".claude\\plans\\2026-03-04-win-plan.md", "win-plan"],
    ];
    for (const [spec, slug] of cases) {
      const run = await runScript(REVIEW_SPLIT, {
        answer: answers([]),
        args: { base: "main", spec, tracks: ["craft"] },
      });
      const [craft, specTrack] = run.calls.filter(isReview);
      expect(specTrack?.prompt).toContain(
        `call task_list with scope "plan" and plan "${slug}", then task_get on each phase and step it lists`,
      );
      expect(specTrack?.prompt).toContain("The plan file lists no task ids");
      expect(craft?.prompt).not.toContain("task_list");
    }
  });

  test("spec alone, with no given tracks, runs the default track and the spec track on the risky tier", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", risky: true, spec: ".claude/plans/the-plan.md" },
    });
    const reviews = run.calls.filter(isReview);
    expect(reviews.length).toBe(2);
    expect(labelOf(reviews[1] as AgentCall)).toBe(`review: ${SPEC_TRACK}`);
    for (const call of reviews) {
      expect(call.options).toMatchObject({ effort: "xhigh", model: "opus" });
    }
  });

  test("a spec failure is a finding with the same schema, and it is refuted like any other", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) =>
        isReview(call)
          ? {
              coverage: SOLID_COVERAGE,
              findings: labelOf(call).endsWith(SPEC_TRACK) ? [finding("Decision 2 not met")] : [],
            }
          : { reason: "checked", verdict: "confirmed" },
      args: { base: "main", spec: ".claude/plans/the-plan.md", tracks: ["craft"] },
    });
    expect(run.calls.filter(isRefute).length).toBe(1);
    expect(String(run.result)).toContain("[WARNING] Decision 2 not met — src/a.ts:1");
  });

  test("prior makes it round 2: every track prompt carries the round-2 lines and the report", async () => {
    const prior = "## Findings (1)\n\n1. [WARNING] Stale key — src/a.ts:1";
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: {
        base: "main",
        prior,
        spec: ".claude/plans/the-plan.md",
        tracks: ["state and timing", "access and money"],
      },
    });
    const reviews = run.calls.filter(isReview);
    expect(reviews.length).toBe(3);
    for (const call of reviews) {
      for (const line of ROUND_TWO_LINES) expect(call.prompt).toContain(line);
      expect(call.prompt).toContain("`priorStatus`");
      expect(call.prompt).toContain(prior);
    }
  });

  test("without prior no prompt carries a round-2 line, and the report has no Round 1 section", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => (isReview(call) ? { coverage: SOLID_COVERAGE, findings: [] } : null),
      args: { base: "main", tracks: ["craft"] },
    });
    for (const call of run.calls.filter(isReview)) {
      for (const line of ROUND_TWO_LINES) expect(call.prompt).not.toContain(line);
      expect(call.prompt).not.toContain("priorStatus");
    }
    expect(String(run.result)).not.toContain("Round 1 findings");
  });

  test("the report lists each round 1 finding with its status and evidence, the worst status winning", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => {
        if (!isReview(call)) return { reason: "checked", verdict: "confirmed" };
        return labelOf(call) === "review: state"
          ? {
              coverage: SOLID_COVERAGE,
              findings: [],
              priorStatus: [
                { evidence: "src/a.ts:5 now checks it", status: "fixed", title: "Stale key" },
                { evidence: "src/b.ts:9 still throws", status: "not_fixed", title: "Empty tenant" },
              ],
            }
          : {
              coverage: SOLID_COVERAGE,
              findings: [],
              priorStatus: [
                { evidence: "src/a.ts:5 breaks src/c.ts:2", status: "worse", title: "stale key" },
              ],
            };
      },
      args: { base: "main", prior: "round 1 report", tracks: ["state", "access"] },
    });
    const report = String(run.result);
    expect(report).toContain("## Round 1 findings");
    expect(report).toContain("- [WORSE] stale key — src/a.ts:5 breaks src/c.ts:2");
    expect(report).toContain("- [NOT FIXED] Empty tenant — src/b.ts:9 still throws");
    expect(report).not.toContain("[FIXED]");
  });

  test("prior with no status returned says so, so a silent round 2 is visible", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", prior: "no findings", tracks: ["craft"] },
    });
    expect(String(run.result)).toContain(
      "## Round 1 findings\n\nNo track reported a status for a round 1 finding.",
    );
  });

  test("round 2 makes the spec track answerable for every round 1 finding and the others judge their own area", async () => {
    const withSpec = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", prior: "round 1 report", spec: "plan.md", tracks: ["craft", "access"] },
    });
    const [craft, access, spec] = withSpec.calls.filter(isReview);
    expect(spec?.prompt).toContain("You judge every finding in the report");
    for (const call of [craft, access]) {
      expect(call?.prompt).not.toContain("You judge every finding in the report");
      expect(call?.prompt).toContain(
        `Judge the findings that lie in your own track's area; the ${SPEC_TRACK} track judges every finding in the report.`,
      );
    }
    // With no spec, the first named track is the one.
    const noSpec = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", prior: "round 1 report", tracks: ["craft", "access"] },
    });
    const [first, second] = noSpec.calls.filter(isReview);
    expect(first?.prompt).toContain("You judge every finding in the report");
    expect(second?.prompt).toContain("the craft track judges every finding in the report");
    // A lone track judges everything and names no other.
    const alone = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", prior: "round 1 report", tracks: ["craft"] },
    });
    const only = alone.calls.find(isReview);
    expect(only?.prompt).toContain("You judge every finding in the report");
    expect(only?.prompt).not.toContain("track judges every finding");
  });

  test("round 1 statuses merge by title and file:line: one finding is one line, the worst status winning", async () => {
    const prior = [
      "## Findings (2, most severe first)",
      "",
      "1. [CRITICAL] The spec track never gets its spec instructions — plugin/workflows/review-split.js:177",
      "   trigger: a call",
      "2. [WARNING] Stale key — src/a.ts:5",
      "",
      "## Unchecked (1, not refuted: check them or run again)",
      "",
      "- [SUGGESTION] Stale key — src/b.ts:9",
    ].join("\n");
    const status = (
      title: string,
      file: string,
      line: number,
      state: string,
      evidence: string,
    ) => ({
      evidence,
      file,
      line,
      status: state,
      title,
    });
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => {
        if (!isReview(call)) return null;
        // Two tracks word the same finding differently: its place, not its wording, is the key.
        if (labelOf(call) === "review: craft") {
          return {
            coverage: SOLID_COVERAGE,
            findings: [],
            priorStatus: [
              status(
                "The spec track never gets spec instructions",
                "plugin/workflows/review-split.js",
                177,
                "fixed",
                "the stage reads the item",
              ),
              status("Stale key", "src/a.ts", 5, "fixed", "src/a.ts:5 checks it"),
            ],
          };
        }
        return {
          coverage: SOLID_COVERAGE,
          findings: [],
          priorStatus: [
            status(
              "The spec track never gets its spec instructions",
              "plugin/workflows/review-split.js",
              177,
              "worse",
              "it still reads the index",
            ),
          ],
        };
      },
      args: { base: "main", prior, tracks: ["craft", "access"] },
    });
    const report = String(run.result);
    const section = report.slice(report.indexOf("## Round 1 findings"));
    // One finding, judged fixed by one track and worse by another: one line, the worse.
    expect(section).toContain(
      "- [WORSE] The spec track never gets its spec instructions — it still reads the index",
    );
    expect(section.match(/spec instructions/g)?.length).toBe(1);
    expect(section).toContain("- [FIXED] Stale key — src/a.ts:5 checks it");
    // The same title at another place is another finding, and no track judged it.
    expect(section).toContain("- [NOT JUDGED] Stale key — src/b.ts:9");
    expect(section.match(/Stale key/g)?.length).toBe(2);
  });

  test("a round 1 finding no track judged is listed as not judged, not dropped", async () => {
    const prior = "1. [WARNING] Empty tenant — src/b.ts:9\n2. [SUGGESTION] Old name — docs/x.md";
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", prior, tracks: ["craft"] },
    });
    const report = String(run.result);
    const section = report.slice(report.indexOf("## Round 1 findings"));
    expect(section).toContain("- [NOT JUDGED] Empty tenant — src/b.ts:9");
    expect(section).toContain("- [NOT JUDGED] Old name — docs/x.md");
    expect(section).not.toContain("No track reported a status");
  });

  test("a status that matches no listed round 1 finding is still shown", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) =>
        isReview(call)
          ? {
              coverage: SOLID_COVERAGE,
              findings: [],
              priorStatus: [
                {
                  evidence: "src/z.ts:3 gone",
                  file: "src/z.ts",
                  line: 3,
                  status: "fixed",
                  title: "Odd one",
                },
              ],
            }
          : null,
      args: { base: "main", prior: "1. [WARNING] Listed — src/a.ts:1", tracks: ["craft"] },
    });
    const report = String(run.result);
    expect(report).toContain("- [NOT JUDGED] Listed — src/a.ts:1");
    expect(report).toContain("- [FIXED] Odd one — src/z.ts:3 gone");
  });

  test("a non-string spec or prior is refused, and no agent starts", async () => {
    const calls: unknown[] = [];
    const bad: Array<[string, unknown]> = [
      ["spec", 5],
      ["spec", ["plan.md"]],
      ["prior", { findings: [] }],
      ["prior", true],
    ];
    for (const [key, value] of bad) {
      await expect(
        runScript(REVIEW_SPLIT, {
          answer: (call) => {
            calls.push(call);
            return null;
          },
          args: { base: "main", [key]: value },
        }),
      ).rejects.toThrow(new RegExp(`"${key}" must be a string`));
    }
    expect(calls).toEqual([]);
  });

  test("an old call gets no spec track and no round-2 text, and the usage line names the new keys", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: answers([]),
      args: { base: "main", tracks: ["craft"] },
    });
    const reviews = run.calls.filter(isReview);
    expect(reviews.map(labelOf)).toEqual(["review: craft"]);
    const prompt = reviews[0]?.prompt ?? "";
    expect(prompt).not.toContain("plan file");
    expect(prompt).not.toContain("round 2");
    await expect(runScript(REVIEW_SPLIT, { args: { risk: true } })).rejects.toThrow(
      /spec\?: string, prior\?: string/,
    );
  });
});

describe("the review-split strict rules", () => {
  test("every track prompt, in both rounds, tells the reviewer to prove by running and to fill coverage", async () => {
    for (const extra of [{}, { prior: "round 1 report", spec: ".claude/plans/the-plan.md" }]) {
      const run = await runScript(REVIEW_SPLIT, {
        answer: answers([]),
        args: { base: "main", tracks: ["craft", "access"], ...extra },
      });
      const reviews = run.calls.filter(isReview);
      expect(reviews.length).toBeGreaterThanOrEqual(2);
      for (const call of reviews) {
        expect(call.prompt).toContain(
          "Where a claim can be proved by running something, run it and quote the command and its output in the finding's `trigger` or `outcome`",
        );
        expect(call.prompt).toContain("Reading the code is not enough.");
        expect(call.prompt).toContain("scratch files go in your scratchpad");
        expect(call.prompt).toContain("Change no file of the project");
        expect(call.prompt).toContain("A track with no findings still fills `coverage`");
        expect(call.prompt).toContain('a bare "clean" is not evidence');
      }
    }
  });

  test("every track prompt tells the reviewer to run every command in the foreground", async () => {
    for (const extra of [{}, { prior: "round 1 report", spec: ".claude/plans/the-plan.md" }]) {
      const run = await runScript(REVIEW_SPLIT, {
        answer: answers([]),
        args: { base: "main", tracks: ["craft", "access"], ...extra },
      });
      for (const call of run.calls.filter(isReview)) {
        expect(call.prompt).toContain(
          "Run every command in the foreground: no run_in_background, no Monitor",
        );
      }
    }
  });

  test("the task ledger's write tools are denied in every launch, the reads are not", async () => {
    // Everything the task server writes comes from its own list: a new write tool fails here.
    const reads = ["list", "get", "search"];
    const writes = Object.keys(TASK_TOOL).filter((operation) => !reads.includes(operation));
    expect([...writes].sort()).toEqual([...TASK_WRITES].sort());
    for (const risky of [false, true]) {
      const run = await runScript(REVIEW_SPLIT, {
        answer: answers([finding("A")]),
        args: { base: "main", risky, tracks: ["craft"] },
      });
      expect(run.calls.length).toBe(2);
      for (const call of run.calls) {
        const denied = call.options.disallowedTools as string[];
        expect(denied).toEqual(NO_EDITS);
        for (const operation of reads) {
          expect(denied).not.toContain(taskToolId(TASK_TOOL[operation as keyof typeof TASK_TOOL]));
        }
      }
    }
  });

  test("a track that returned no answer says so, and the report does not read as clean", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) =>
        isReview(call) && labelOf(call) === "review: craft"
          ? null
          : { coverage: SOLID_COVERAGE, findings: [] },
      args: { base: "main", tracks: ["craft", "access"] },
    });
    const report = String(run.result);
    expect(report).toContain("track 1 (craft) returned no answer");
    expect(report).toContain("Incomplete review: 1 of 2 track(s) returned no answer (craft)");
    expect(report).not.toContain("No finding survived refutation.");
    expect(report).toContain("No finding survived refutation in the tracks that answered.");
  });

  test("every track answering leaves no incomplete line", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => (isReview(call) ? { coverage: SOLID_COVERAGE, findings: [] } : null),
      args: { base: "main", tracks: ["craft"] },
    });
    expect(String(run.result)).not.toContain("Incomplete review");
    expect(String(run.result)).toContain("No finding survived refutation.");
  });

  test("coverage is a required field of a reviewer's answer", async () => {
    const run = await runScript(REVIEW_SPLIT, { answer: answers([]), args: { base: "main" } });
    const schema = run.calls.find(isReview)?.options.schema as { required: string[] };
    expect(schema.required).toEqual(["findings", "coverage"]);
  });

  test("a track with no findings and a vague or empty coverage is shown as giving no evidence", async () => {
    const run = await runScript(REVIEW_SPLIT, {
      answer: (call) => {
        if (!isReview(call)) return null;
        const label = labelOf(call);
        if (label === "review: vague") return { coverage: "clean", findings: [] };
        if (label === "review: empty") return { coverage: "", findings: [] };
        if (label === "review: silent") return null;
        if (label === "review: busy") return { coverage: "ok", findings: [finding("A")] };
        return { coverage: SOLID_COVERAGE, findings: [] };
      },
      args: { base: "main", tracks: ["vague", "empty", "silent", "busy", "solid"] },
    });
    const report = String(run.result);
    expect(report).toContain("track 1 (vague) gave no evidence of coverage");
    expect(report).toContain("track 2 (empty) gave no evidence of coverage");
    expect(report).toContain("track 3 (silent) returned no answer");
    expect(report).not.toContain("track 3 (silent) gave no evidence");
    expect(report).not.toContain("track 4 (busy) gave no evidence");
    expect(report).not.toContain("track 5 (solid) gave no evidence");
    expect(report).toContain("track 5 (solid): read src/a.ts and src/b.ts; ran bun test");
  });
});
