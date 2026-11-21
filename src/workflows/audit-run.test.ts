/**
 * `plugin/workflows/audit-run.js`: the run the `audit` skill starts. One read-only auditor per
 * track on `sonnet` at `high` (breadth: D46 keeps `opus` at `xhigh` for the judgment), a second
 * auditor on `opus` at `xhigh` to refute every finding, and one writer on `sonnet` at `medium`,
 * each on literal model and effort. The auditors and the verifiers take the editing tools away on each launch.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TASK_TOOL, taskToolId } from "../tasks/words";
import type { AgentCall } from "./script-runner";
import { runScript } from "./script-runner";

const AUDIT_RUN = join(import.meta.dir, "..", "..", "plugin", "workflows", "audit-run.js");
/** The kit's task tools that write: an auditor reports, it never changes the task ledger. */
const TASK_WRITES = ["create", "update", "done", "note", "delete", "take"] as const;
/**
 * The tools each auditor and verifier launch takes away: the tracks share one checkout, an agent
 * a track started would escape the run's budget, and the task ledger belongs to the lead.
 */
const NO_EDITS = [
  "Edit",
  "Write",
  "NotebookEdit",
  "Agent",
  ...TASK_WRITES.map((operation) => taskToolId(TASK_TOOL[operation])),
];

/** One finding, as an auditor's schema returns it. */
function finding(title: string) {
  return {
    file: "src/a.ts",
    line: 1,
    missingGuard: "nothing checks the value",
    outcome: "the call throws",
    severity: "warning",
    title,
    trigger: "a call with an empty value",
  };
}

/** The label a call carries: the script writes `audit: <track>` for auditors. */
function labelOf(call: AgentCall): string {
  return String(call.options.label ?? "");
}

const isAudit = (call: AgentCall): boolean => labelOf(call).startsWith("audit:");
const isVerify = (call: AgentCall): boolean => labelOf(call) === "verify";
const isReport = (call: AgentCall): boolean => labelOf(call) === "report";

describe("the audit-run workflow", () => {
  test("the task ledger's write tools are denied in the auditor and verifier launches, the reads are not", async () => {
    // Everything the task server writes comes from its own list: a new write tool fails here.
    const reads = ["list", "get", "search"];
    const writes = Object.keys(TASK_TOOL).filter((operation) => !reads.includes(operation));
    expect([...writes].sort()).toEqual([...TASK_WRITES].sort());
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) return { findings: [finding("A")], hunches: [], coverage: "read" };
        if (isVerify(call)) return { reason: "checked", verdict: "confirmed" };
        return "the report";
      },
      args: { question: "q", target: "src", tracks: ["one"] },
    });
    // The report writer may write its report, but never the ledger.
    const reportDenied = run.calls.find(isReport)?.options.disallowedTools as string[];
    for (const operation of writes) {
      expect(reportDenied).toContain(taskToolId(TASK_TOOL[operation as keyof typeof TASK_TOOL]));
    }
    expect(reportDenied).not.toContain("Write");
    const launches = run.calls.filter((call) => isAudit(call) || isVerify(call));
    expect(launches.length).toBe(2);
    for (const call of launches) {
      const denied = call.options.disallowedTools as string[];
      for (const operation of writes) {
        expect(denied).toContain(taskToolId(TASK_TOOL[operation as keyof typeof TASK_TOOL]));
      }
      for (const operation of reads) {
        expect(denied).not.toContain(taskToolId(TASK_TOOL[operation as keyof typeof TASK_TOOL]));
      }
    }
  });

  test("one auditor per track, on sonnet at high, with no editing tools: then verify, then report", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => (isAudit(call) ? { findings: [], hunches: [], coverage: "read" } : null),
      args: { question: "missing auth checks", target: "src/hooks", tracks: ["access", "state"] },
    });
    expect(run.phases).toEqual(["Audit", "Verify", "Report"]);
    const audits = run.calls.filter(isAudit);
    expect(audits.map(labelOf)).toEqual(["audit: access", "audit: state"]);
    for (const call of audits) {
      expect(call.options).toMatchObject({
        agentType: "cc-smart-dev-kit:auditor",
        disallowedTools: NO_EDITS,
        effort: "high",
        model: "sonnet",
      });
      expect(typeof call.options.schema).toBe("object");
    }
    expect(audits[0]?.prompt).toContain("src/hooks");
    expect(audits[0]?.prompt).toContain("missing auth checks");
    expect(audits[0]?.prompt).toContain("Your track: access");
    expect(audits[0]?.prompt).toContain("A design finding's missing guard is the rule it breaks.");
  });

  test("a second auditor refutes each finding: opus at xhigh, read-only, the finding in the brief", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) return { findings: [finding("A")], hunches: [], coverage: "read" };
        if (isVerify(call))
          return { evidence: "src/a.ts:1", reason: "checked", verdict: "confirmed" };
        return "the report";
      },
      args: { question: "q", target: "src", tracks: ["one"] },
    });
    const verify = run.calls.find(isVerify);
    expect(verify?.options).toMatchObject({
      agentType: "cc-smart-dev-kit:auditor",
      disallowedTools: NO_EDITS,
      effort: "xhigh",
      label: "verify",
      model: "opus",
    });
    expect(typeof verify?.options.schema).toBe("object");
    expect(verify?.prompt).toContain('"title": "A"');
    expect(verify?.prompt).toContain("refute");
    expect(verify?.prompt).toContain("A design finding's missing guard is the rule it breaks.");
    expect(verify?.prompt).toContain(
      "A project convention or sibling files with that shape refute it.",
    );
  });

  test("the caller's budget caps the findings verified, so a run costs what the person agreed to", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) {
          return { findings: [finding("A"), finding("B"), finding("C")], hunches: [] };
        }
        if (isVerify(call)) return { reason: "checked", verdict: "confirmed" };
        return "the report";
      },
      args: { budget: 2, question: "q", target: "src", tracks: ["one"] },
    });
    expect(run.calls.filter(isVerify).length).toBe(2);
    expect(run.logs.join("\n")).toContain(
      "3 finding(s) reported; 2 verified against the code, 1 not",
    );
  });

  test("only a confirmed finding reaches the writer as a finding; a refuted one does not reach it", async () => {
    let verified = 0;
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) return { findings: [finding("kept"), finding("dropped")], hunches: [] };
        if (isVerify(call)) {
          verified += 1;
          return { reason: "checked", verdict: verified === 1 ? "confirmed" : "refuted" };
        }
        return "the report";
      },
      args: { question: "q", target: "src", tracks: ["one"] },
    });
    const report = run.calls.find(isReport);
    expect(report?.prompt).toContain('"title": "kept"');
    expect(report?.prompt).not.toContain("dropped");
  });

  test("an unproven finding, or one the verifier did not answer, goes to the writer as a hunch with why", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) {
          return {
            findings: [
              { ...finding("not settled"), severity: "critical" },
              { ...finding("no answer"), file: "src/b.ts", line: 7 },
            ],
            hunches: ["maybe B"],
          };
        }
        if (isVerify(call)) {
          return call.prompt.includes('"title": "not settled"')
            ? { reason: "the caller is in another repo", verdict: "unproven" }
            : null;
        }
        return "the report";
      },
      args: { question: "q", target: "src", tracks: ["one"] },
    });
    const prompt = run.calls.find(isReport)?.prompt ?? "";
    expect(prompt).toContain(
      'Hunches:\n[\n  "[CRITICAL] not settled — src/a.ts:1 (unproven: the caller is in another repo); trigger: a call with an empty value; missing guard: nothing checks the value",\n  "[WARNING] no answer — src/b.ts:7 (unproven: the verifier returned no answer); trigger: a call with an empty value; missing guard: nothing checks the value",\n  "maybe B"\n]',
    );
    expect(prompt).toContain("Confirmed findings:\n[]");
  });

  test("one writer on sonnet at medium, writing the findings file when the caller names it", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) {
          return { coverage: "read src/a.ts", findings: [finding("A")], hunches: ["maybe B"] };
        }
        if (isVerify(call)) return { reason: "checked", verdict: "confirmed" };
        return "the report";
      },
      args: {
        findingsPath: ".claude/audits/2026-10-22-hooks.md",
        question: "q",
        target: "src",
        tracks: ["one"],
      },
    });
    const report = run.calls.find(isReport);
    expect(report?.options).toEqual({
      agentType: "cc-smart-dev-kit:builder",
      // Its file tools stay (it writes the report); the ledger's write tools do not.
      disallowedTools: NO_EDITS.filter((tool) => tool.startsWith("mcp__")),
      effort: "medium",
      label: "report",
      model: "sonnet",
    });
    expect(report?.prompt).toContain(".claude/audits/2026-10-22-hooks.md");
    expect(report?.prompt).toContain("maybe B");
    expect(report?.prompt).toContain("read src/a.ts");
    expect(run.result).toBe("the report");
  });

  test("run by hand with no args: one track, twelve findings, the report returned", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) {
          return {
            findings: Array.from({ length: 20 }, (_, index) => finding(`F${index}`)),
            hunches: [],
          };
        }
        if (isVerify(call)) return { reason: "checked", verdict: "confirmed" };
        return "the report";
      },
    });
    const audits = run.calls.filter(isAudit);
    expect(audits.map(labelOf)).toEqual(["audit: the whole target"]);
    expect(audits[0]?.prompt).toContain("this repository");
    expect(run.calls.filter(isVerify).length).toBe(12);
    const report = run.calls.find(isReport);
    expect(report?.prompt).toContain("Return the whole report");
    expect(run.result).toBe("the report");
  });

  test("more findings than the budget: the most severe are verified, the rest go to the writer unchecked", async () => {
    const at = (title: string, severity: string, file: string) => ({
      ...finding(title),
      file,
      severity,
    });
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) {
          return {
            findings: [
              at("s1", "suggestion", "src/s1.ts"),
              at("w1", "warning", "src/w1.ts"),
              at("c1", "critical", "src/c1.ts"),
            ],
            hunches: [],
          };
        }
        if (isVerify(call)) return { reason: "checked", verdict: "confirmed" };
        return "the report";
      },
      args: { budget: 2, question: "q", target: "src", tracks: ["one"] },
    });
    const verified = run.calls.filter(isVerify).map((call) => call.prompt);
    expect(verified.length).toBe(2);
    expect(verified.some((prompt) => prompt.includes('"title": "c1"'))).toBe(true);
    expect(verified.some((prompt) => prompt.includes('"title": "w1"'))).toBe(true);
    const report = run.calls.find(isReport);
    expect(report?.prompt).toContain("Unchecked findings (1, not verified:");
    expect(report?.prompt).toContain("- [SUGGESTION] s1 — src/s1.ts:1");
    expect(run.logs.join("\n")).toContain("2 verified against the code, 1 not");
  });

  test("a critical finding in the last track is verified even when an earlier track fills the budget", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) => {
        if (isAudit(call)) {
          return labelOf(call) === "audit: busy"
            ? {
                findings: [1, 2, 3].map((n) => ({
                  ...finding(`busy ${n}`),
                  severity: "suggestion",
                })),
              }
            : { findings: [{ ...finding("the critical one"), severity: "critical" }] };
        }
        if (isVerify(call)) return { reason: "checked", verdict: "confirmed" };
        return "the report";
      },
      args: { budget: 1, question: "q", target: "src", tracks: ["busy", "last"] },
    });
    const verified = run.calls.filter(isVerify);
    expect(verified.length).toBe(1);
    expect(verified[0]?.prompt).toContain('"title": "the critical one"');
  });

  test("nothing past the budget: the writer is told there is nothing unchecked", async () => {
    const run = await runScript(AUDIT_RUN, {
      answer: (call) =>
        isAudit(call) ? { findings: [finding("A")] } : { reason: "x", verdict: "confirmed" },
      args: { question: "q", target: "src", tracks: ["one"] },
    });
    expect(run.calls.find(isReport)?.prompt).toContain("Unchecked findings: none");
  });

  test("a string argument is refused with one line that names the expected object, and no agent starts", async () => {
    const calls: unknown[] = [];
    const attempt = runScript(AUDIT_RUN, {
      answer: (call) => {
        calls.push(call);
        return null;
      },
      args: '{"target":"src"}',
    });
    await expect(attempt).rejects.toThrow(/audit-run refused its arguments \(got a string/);
    await expect(attempt).rejects.toThrow(/Pass one object: \{ target\?: string/);
    await attempt.catch((error: Error) => expect(error.message.includes("\n")).toBe(false));
    expect(calls).toEqual([]);
  });

  test("an unknown key or a wrong type is refused, and the message names the key", async () => {
    await expect(runScript(AUDIT_RUN, { args: { path: "x", target: "src" } })).rejects.toThrow(
      /unknown key "path"/,
    );
    const bad: Array<[string, unknown]> = [
      ["budget", "12"],
      ["budget", -1],
      ["tracks", "one"],
      ["target", 1],
      ["question", null],
      ["findingsPath", 3],
    ];
    for (const [key, value] of bad) {
      await expect(runScript(AUDIT_RUN, { args: { [key]: value } })).rejects.toThrow(
        new RegExp(`"${key}" must be`),
      );
    }
    for (const args of [null, ["src"], 12]) {
      await expect(runScript(AUDIT_RUN, { args })).rejects.toThrow(
        /audit-run refused its arguments/,
      );
    }
  });
});
