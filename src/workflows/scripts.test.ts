/**
 * The workflow scripts the plugin ships (`plugin/workflows/*.js`) — the rules every one of them
 * follows, whatever it orchestrates. The audit skill starts `audit-run`; its own behaviour is
 * `audit-run.test.ts`.
 *
 * **The guard judges every launch** (`.claude/rules/hooks.md`, `docs/design.md` § The agent
 * guard): a workflow's `agent(...)` calls run inside the tool and fire no hook, so the guard
 * reads the script and refuses a launch whose model or effort it cannot read. A shipped script
 * must therefore pass the guard as it is written — and the guard the plugin ships, not only the
 * source: `plugin/dist/agent-guard.js` runs on a PreToolUse input of the same script, the way
 * Claude Code calls it.
 *
 * **Claude Code runs the script as a function body**, with top-level `await` and `return`, and
 * throws on `Date.now()`, `Math.random()` and a no-argument `new Date()` (a run must replay). A
 * test here runs every script against the fakes in `script-runner.ts`: no subagent starts.
 */
import { describe, expect, test } from "bun:test";

import { basename, join } from "node:path";
import { type GuardContext, judgeWorkflow, readWorkflowScript } from "../hooks/agent-guard";
import { workflowMetaName } from "../hooks/agent-guard-workflows";
import { hookEnv } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { readScript, runScript, shippedScripts } from "./script-runner";

const ROOT = join(import.meta.dir, "..", "..");
const DIST_GUARD = join(ROOT, "plugin", "dist", "agent-guard.js");

/** Claude Code's settings point at no gateway, and the opus chain is Claude: the strictest allowance. */
const NO_GATEWAY: GuardContext = { config: null, gatewayOn: false, sessionModel: null };
const NO_ENV = {} as Record<string, string | undefined>;

/** Every shipped script with its text and its file name. */
const scripts = shippedScripts().map((file) => ({
  file,
  name: basename(file, ".js"),
  script: readScript(file),
}));

/** A PreToolUse `Workflow` input, as Claude Code builds one for an inline script. */
function workflowInput(script: string, cwd: string): string {
  return JSON.stringify({
    cwd,
    hook_event_name: "PreToolUse",
    session_id: "workflow-test",
    tool_input: { script },
    tool_name: "Workflow",
  });
}

/** Runs the guard bundle the plugin ships on an input, as Claude Code runs it. */
function runDistGuard(input: string): { exitCode: number; stdout: string; stderr: string } {
  const guard = subprocessGuard();
  // `process.execPath`: the bun running the suite, which the repo needs; PATH may hold another.
  const result = Bun.spawnSync([process.execPath, ...guard.args, DIST_GUARD], {
    env: { ...hookEnv(), ...guard.env },
    stderr: "pipe",
    stdin: Buffer.from(input),
    stdout: "pipe",
  });
  return {
    exitCode: result.exitCode ?? -1,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

describe("every shipped workflow script", () => {
  test("at least one ships, and each has a meta the guard and Claude Code can read", () => {
    expect(scripts.length).toBeGreaterThan(0);
    for (const { name, script } of scripts) {
      // Claude Code loads `<plugin>:<meta.name>` and the guard finds the file by it.
      expect(workflowMetaName(script)).toBe(name);
    }
  });

  test("the guard reads every launch: a literal model, effort and agent type", () => {
    for (const { file, script } of scripts) {
      const launches = readWorkflowScript(script);
      expect(launches.length).toBeGreaterThan(0);
      for (const launch of launches) {
        // A model or effort held in a variable is refused by the guard; a shipped script never
        // hides one. `agentType` may be left out (a plain subagent), a model may not.
        expect({ file, model: launch.model === null, effort: launch.effort === null }).toEqual({
          effort: false,
          file,
          model: false,
        });
      }
    }
  });

  test("the guard allows every launch of every script", () => {
    for (const { file, script } of scripts) {
      const verdicts = judgeWorkflow(script, NO_GATEWAY, NO_ENV).map((one) => one.verdict.decision);
      expect({ decisions: verdicts, file }).toEqual({
        decisions: verdicts.map(() => "allow"),
        file,
      });
    }
  });

  test("the guard the plugin ships allows them too: no ask, no deny, exit 0", () => {
    const env = hookEnv();
    for (const { file, script } of scripts) {
      const run = runDistGuard(workflowInput(script, env.HOME ?? ""));
      // An allowed Workflow answers nothing: the guard speaks only to ask or to deny.
      expect({ file, ...run }).toEqual({ exitCode: 0, file, stderr: "", stdout: "" });
    }
    // The harness can see a decision, so the empty answer above is an allow, not a bundle that
    // never judged: one launch at the opus tier's asking effort asks.
    const canary = [
      "export const meta = { name: 'canary', description: 'the dist guard answers' }",
      "await agent('do it', { model: 'opus', effort: 'max' })",
    ].join("\n");
    const run = runDistGuard(workflowInput(canary, env.HOME ?? ""));
    const answer = JSON.parse(run.stdout || "{}").hookSpecificOutput ?? {};
    expect(run.exitCode).toBe(0);
    expect(answer.permissionDecision).toBe("ask");
    expect(answer.permissionDecisionReason).toContain("opus");
  });

  test("every script runs with the workflow globals, and with no args at all", async () => {
    for (const { file } of scripts) {
      const run = await runScript(file);
      expect(run.calls.length).toBeGreaterThan(0);
      expect(run.phases.length).toBeGreaterThan(0);
    }
  });

  test("no script reads the clock or the dice: a run must replay", () => {
    for (const { file, script } of scripts) {
      // Claude Code makes these throw inside a script (a relaunch repeats every call).
      expect({ clock: /Date\.now\(|Math\.random\(|new Date\(\)/.test(script), file }).toEqual({
        clock: false,
        file,
      });
    }
  });
});
