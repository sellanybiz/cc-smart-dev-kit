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
import { recordsReview } from "../workflow/reviews";
import { workflowDefaults } from "../workflow/schema";
import type { AgentCall } from "./script-runner";
import { runScript } from "./script-runner";

const REVIEW_SPLIT = join(import.meta.dir, "..", "..", "plugin", "workflows", "review-split.js");
const NO_ENV = {} as Record<string, string | undefined>;
const REVIEWER = "cc-smart-dev-kit:senior-engineer";
/** The tools each launch takes away: the tracks share one checkout. */
const NO_EDITS = ["Edit", "Write", "NotebookEdit"];

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
    expect(prompt).toContain("`git diff main...HEAD`");
    expect(prompt).toContain("adds the response cache");
    expect(prompt).toContain("Your track: state and timing");
    expect(prompt).toContain("hunches");
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
      "## Hunches (unproven, never findings)\n\n- [CRITICAL] not settled — src/c.ts:4 (unproven: the caller is in another repo)\n- maybe B",
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
      "- [WARNING] no answer — src/q.ts:2 (unproven: the refuter returned no answer)",
    );
    expect(report).not.toContain("were refuted");
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
