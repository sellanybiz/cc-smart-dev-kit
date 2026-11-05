/**
 * `plugin/workflows/research-sweep.js`: the run the `research-first` skill starts for a question
 * with several sources. One `researcher` per angle on `sonnet` at `high` (the guard allows it on
 * any tier), one `researcher` per claim on `opus` at `high` to refute it at the cited source, all
 * allowed by the agent guard. The script returns the verified claims, the
 * refuted ones, the unproven ones and the ones past the budget; it never drops a claim.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GatewayConfig } from "../gateway/config";
import { type GuardContext, judgeWorkflow } from "../hooks/agent-guard";
import { loadScriptParser } from "../hooks/script-parser";
import type { AgentCall } from "./script-runner";
import { runScript } from "./script-runner";

// The guard's bundle loads its script parser in its entry; this file judges a script too.
loadScriptParser();

const SWEEP = join(import.meta.dir, "..", "..", "plugin", "workflows", "research-sweep.js");
const NO_ENV = {} as Record<string, string | undefined>;

/** One claim, as a researcher's schema returns it. */
function claim(text: string, weight: "decisive" | "supporting" = "decisive") {
  return {
    asOf: "v2.1",
    claim: text,
    quote: "the docs say so",
    source: "https://example.com/docs",
    weight,
  };
}

const labelOf = (call: AgentCall): string => String(call.options.label ?? "");
const isResearch = (call: AgentCall): boolean => labelOf(call).startsWith("research:");
const isRefute = (call: AgentCall): boolean => labelOf(call).startsWith("refute:");

const CONFIRMED = { quote: "found it", reason: "the page says so", verdict: "confirmed" };

describe("the research-sweep workflow", () => {
  test("one researcher per angle on sonnet at high, with the question and the schema's shape in the brief", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) =>
        isResearch(call) ? { claims: [], coverage: "read", openQuestions: [] } : null,
      args: {
        angles: ["the current docs", "the issue tracker"],
        question: "how does X cut a stream",
      },
    });
    expect(run.phases).toEqual(["Research", "Refute"]);
    const research = run.calls.filter(isResearch);
    expect(research.map(labelOf)).toEqual([
      "research: the current docs",
      "research: the issue tracker",
    ]);
    for (const call of research) {
      expect(call.options).toMatchObject({
        agentType: "cc-smart-dev-kit:researcher",
        effort: "high",
        model: "sonnet",
      });
      expect(typeof call.options.schema).toBe("object");
      expect(call.prompt).toContain("how does X cut a stream");
      // The researcher's own report shape gives way to the brief's: the brief must say so.
      expect(call.prompt).toContain("Answer in this run's schema, not in your usual report.");
      expect(call.prompt).toContain("sources that disagree, go in `openQuestions`");
    }
    expect(research[0]?.prompt).toContain("Your angle: the current docs");
    expect(run.calls.filter(isRefute).length).toBe(0);
  });

  test("one refuter per claim on opus at high, with the claim and its source in the brief", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => {
        if (isResearch(call)) {
          return { claims: [claim("A is true"), claim("B is true")], openQuestions: [] };
        }
        return CONFIRMED;
      },
      args: { angles: ["docs"], question: "q" },
    });
    const refuters = run.calls.filter(isRefute);
    expect(refuters.length).toBe(2);
    for (const call of refuters) {
      expect(call.options).toMatchObject({
        agentType: "cc-smart-dev-kit:researcher",
        effort: "high",
        model: "opus",
      });
      expect(typeof call.options.schema).toBe("object");
      expect(call.prompt).toContain("https://example.com/docs");
    }
    expect(refuters[0]?.prompt).toContain('"claim": "A is true"');
    expect(refuters[1]?.prompt).toContain('"claim": "B is true"');
  });

  test("a verified claim keeps its source and the quote the refuter found", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => (isResearch(call) ? { claims: [claim("A is true")] } : CONFIRMED),
      args: { angles: ["docs"], question: "q" },
    });
    const result = run.result as { verified: Array<Record<string, unknown>> };
    expect(result.verified).toEqual([
      {
        asOf: "v2.1",
        claim: "A is true",
        quote: "found it",
        reason: "the page says so",
        source: "https://example.com/docs",
        weight: "decisive",
      },
    ]);
  });

  test("a refuted claim is returned with why, never among the verified", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => {
        if (isResearch(call)) return { claims: [claim("kept"), claim("wrong")] };
        return call.prompt.includes('"claim": "wrong"')
          ? { quote: "the page says the opposite", reason: "removed in v3", verdict: "refuted" }
          : CONFIRMED;
      },
      args: { angles: ["docs"], question: "q" },
    });
    const result = run.result as {
      verified: Array<{ claim: string }>;
      refuted: Array<{ claim: string; reason: string }>;
    };
    expect(result.verified.map((one) => one.claim)).toEqual(["kept"]);
    expect(result.refuted).toHaveLength(1);
    expect(result.refuted[0]).toMatchObject({ claim: "wrong", reason: "removed in v3" });
  });

  test("a refuter that proves nothing, or returns nothing, leaves the claim unproven, not dropped", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => {
        if (isResearch(call)) return { claims: [claim("one"), claim("two")] };
        return call.prompt.includes('"claim": "one"')
          ? { reason: "the page is gone", verdict: "unproven" }
          : null;
      },
      args: { angles: ["docs"], question: "q" },
    });
    const result = run.result as {
      verified: unknown[];
      refuted: unknown[];
      unproven: Array<{ claim: string; reason: string }>;
    };
    expect(result.verified).toEqual([]);
    expect(result.refuted).toEqual([]);
    expect(result.unproven.map((one) => one.claim)).toEqual(["one", "two"]);
    expect(result.unproven[0]?.reason).toBe("the page is gone");
    expect(result.unproven[1]?.reason).toContain("no answer");
  });

  test("the budget caps the refuters, decisive claims first; the rest come back unchecked", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => {
        if (isResearch(call)) {
          return {
            claims: [
              claim("S1", "supporting"),
              claim("D1"),
              claim("S2", "supporting"),
              claim("D2"),
            ],
          };
        }
        return CONFIRMED;
      },
      args: { angles: ["docs"], budget: 3, question: "q" },
    });
    expect(run.calls.filter(isRefute).length).toBe(3);
    expect(run.logs.join("\n")).toContain("4 claim(s) reported; 3 checked");
    const result = run.result as {
      verified: Array<{ claim: string }>;
      unchecked: Array<{ claim: string; source: string }>;
    };
    expect(result.verified.map((one) => one.claim)).toEqual(["D1", "D2", "S1"]);
    expect(result.unchecked.map((one) => one.claim)).toEqual(["S2"]);
    expect(result.unchecked[0]?.source).toBe("https://example.com/docs");
  });

  test("run with no budget: twelve claims are checked, the rest unchecked", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) =>
        isResearch(call)
          ? { claims: Array.from({ length: 15 }, (_, index) => claim(`C${index}`)) }
          : CONFIRMED,
      args: { angles: ["docs"], question: "q" },
    });
    expect(run.calls.filter(isRefute).length).toBe(12);
    expect((run.result as { unchecked: unknown[] }).unchecked).toHaveLength(3);
  });

  test("open questions and each angle's coverage come back; an angle with no report is named, not lost", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => {
        if (!isResearch(call)) return CONFIRMED;
        return labelOf(call).endsWith("docs")
          ? { claims: [], coverage: "read the changelog", openQuestions: ["does v3 change it?"] }
          : null;
      },
      args: { angles: ["docs", "issues"], question: "q" },
    });
    const result = run.result as {
      openQuestions: string[];
      coverage: string[];
    };
    expect(result.openQuestions).toEqual([
      "does v3 change it?",
      'The researcher for the angle "issues" returned no usable report.',
    ]);
    expect(result.coverage).toEqual(["angle 1 (docs): read the changelog"]);
  });

  test("the budget spreads over the angles: one angle's many decisive claims do not take it all", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => {
        if (!isResearch(call)) return CONFIRMED;
        return labelOf(call).endsWith("one")
          ? { claims: [claim("one-1"), claim("one-2"), claim("one-3")] }
          : { claims: [claim("two-1"), claim("two-2")] };
      },
      args: { angles: ["one", "two"], budget: 3, question: "q" },
    });
    const result = run.result as {
      verified: Array<{ claim: string }>;
      unchecked: Array<{ claim: string }>;
    };
    expect(result.verified.map((one) => one.claim)).toEqual(["one-1", "two-1", "one-2"]);
    expect(result.unchecked.map((one) => one.claim)).toEqual(["two-2", "one-3"]);
  });

  test("a refuted claim keeps the researcher's quote when the refuter gives none", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) =>
        isResearch(call)
          ? { claims: [claim("wrong")] }
          : { reason: "removed in v3", verdict: "refuted" },
      args: { angles: ["docs"], question: "q" },
    });
    const result = run.result as { refuted: Array<{ quote: string }> };
    expect(result.refuted[0]?.quote).toBe("the docs say so");
  });

  test("a report without a claims list is named as a lost angle, not skipped", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => (isResearch(call) ? { coverage: "prose only" } : CONFIRMED),
      args: { angles: ["docs"], question: "q" },
    });
    expect((run.result as { openQuestions: string[] }).openQuestions).toEqual([
      'The researcher for the angle "docs" returned no usable report.',
    ]);
  });

  test("the question and the optional context reach every researcher", async () => {
    const run = await runScript(SWEEP, {
      answer: (call) => (isResearch(call) ? { claims: [] } : null),
      args: { angles: ["a", "b"], context: "the router is Bun", question: "q?" },
    });
    for (const call of run.calls.filter(isResearch)) {
      expect(call.prompt).toContain("the router is Bun");
    }
  });

  describe("a bad argument is refused at the start, before any agent starts", () => {
    const good = { angles: ["docs"], question: "q" };
    const refused: Array<[string, unknown, string]> = [
      ["a string", "how does X work", "research-sweep needs an object"],
      ["no argument", undefined, "research-sweep needs an object"],
      ["null", null, "research-sweep needs an object"],
      ["an array", ["docs"], "research-sweep needs an object"],
      ["no question", { angles: ["docs"] }, "`question`"],
      ["an empty question", { ...good, question: "  " }, "`question`"],
      ["no angles", { question: "q" }, "`angles`"],
      ["an empty angle list", { ...good, angles: [] }, "`angles`"],
      ["angles as a string", { ...good, angles: "docs" }, "`angles`"],
      ["a blank angle", { ...good, angles: ["docs", ""] }, "`angles`"],
      ["a non-string angle", { ...good, angles: [3] }, "`angles`"],
      [
        "nine angles",
        { ...good, angles: Array.from({ length: 9 }, (_, i) => `a${i}`) },
        "at most 8",
      ],
      ["a repeated angle", { ...good, angles: ["docs", " docs"] }, "repeat"],
      ["a budget past forty", { ...good, budget: 41 }, "from 1 to 40"],
      ["a zero budget", { ...good, budget: 0 }, "`budget`"],
      ["a string budget", { ...good, budget: "3" }, "`budget`"],
      ["a fractional budget", { ...good, budget: 1.5 }, "`budget`"],
      ["a non-string context", { ...good, context: 4 }, "`context`"],
      ["a misspelt field", { ...good, angle: ["docs"] }, "`angle`"],
    ];
    for (const [name, args, message] of refused) {
      test(name, async () => {
        const calls: AgentCall[] = [];
        await expect(
          runScript(SWEEP, {
            answer: (call) => {
              calls.push(call);
              return null;
            },
            args,
          }),
        ).rejects.toThrow(message);
        expect(calls).toEqual([]);
      });
    }
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
    const script = readFileSync(SWEEP, "utf8");
    expect(judgeWorkflow(script, context, NO_ENV).map((one) => one.verdict.decision)).toEqual([
      "allow",
      "allow",
    ]);
  });
});
