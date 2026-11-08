/**
 * Reading the alert settings where a hook runs: once, cheaply, and never a failure. A file
 * the reader cannot use is dropped — every value that can still be read stays (the project's
 * over the person's over the built-in default) — with one line for stderr.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { alertsAt } from "./alerts";
import { personalWorkflowFile } from "./resolve";

/** The person's own workflow file, written with `value`. */
function writePersonal(env: Record<string, string>, value: unknown): void {
  const file = personalWorkflowFile(cliPaths(env));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

describe("where the alerts come from", () => {
  test("nothing set anywhere: every value is the built-in default", () => {
    const env = hookEnv();
    const here = alertsAt(cliPaths(env), tempDir("not-git"), env);
    expect(here.problem).toBeNull();
    expect(here.alerts.usagePercent).toEqual({ value: 85, source: "default" });
  });

  test("the person's own file: its values say they are the person's", () => {
    const env = hookEnv();
    writePersonal(env, {
      alerts: { events: ["finished", "failed"], sound: true, usagePercent: 70 },
    });
    const here = alertsAt(cliPaths(env), tempDir("not-git"), env);
    expect(here.problem).toBeNull();
    expect(here.alerts.usagePercent).toEqual({ value: 70, source: "personal" });
  });

  test("a project's file wins, field by field, over the person's", () => {
    const env = hookEnv();
    const repo = makeRepo();
    writePersonal(env, { alerts: { events: ["finished"], sound: true, usagePercent: 70 } });
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      requires: ">=0.4",
      workflow: { alerts: { events: ["needs-you"], usagePercent: 90 } },
    });
    const here = alertsAt(cliPaths(env), repo, env);
    expect(here.problem).toBeNull();
    expect(here.alerts.usagePercent).toEqual({ value: 90, source: "project" });
  });

  test("a repo that never opted in: the person's file and the defaults", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const here = alertsAt(cliPaths(env), repo, env);
    expect(here.problem).toBeNull();
    expect(here.alerts.usagePercent).toEqual({ value: 85, source: "default" });
  });
});

describe("a folder that is no project: no line at all", () => {
  test("a hook input with no cwd: the person's file and the defaults", () => {
    const env = hookEnv();
    writePersonal(env, { alerts: { usagePercent: 70 } });
    const here = alertsAt(cliPaths(env), null, env);
    expect(here.problem).toBeNull();
  });

  test("a cwd that is not a folder, and one not in git: silent, not a failure", () => {
    const env = hookEnv();
    const missing = join(tempDir("gone"), "not-here");
    expect(alertsAt(cliPaths(env), missing, env).problem).toBeNull();
    expect(alertsAt(cliPaths(env), tempDir("not-git"), env).problem).toBeNull();
  });
});

describe("a file it cannot use: what can be read, and one line", () => {
  test("a broken project file: the defaults, and the line names the file", () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktree: {} });
    const here = alertsAt(cliPaths(env), repo, env);
    expect(here.problem).toContain("cc-smart-dev-kit.json: worktree: unknown field");
    expect(here.problem).toStartWith(
      "cc-smart-dev-kit: the alerts use the settings that can be read (",
    );
  });

  test("a broken personal file: the defaults, and the line names the file", () => {
    const env = hookEnv();
    const file = personalWorkflowFile(cliPaths(env));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    const here = alertsAt(cliPaths(env), tempDir("not-git"), env);
    expect(here.alerts.usagePercent.value).toBe(85);
    expect(here.problem).toContain(`Invalid ${file}: not valid JSON`);
  });

  test("a broken personal file keeps the PROJECT's alerts: only the person's values are lost", () => {
    // The project's `workflow.alerts` is the team's decision, so a broken personal file
    // drops the person's values and never the project's (`resolve.ts`: a hook keeps the
    // project's). Only the value the personal file alone held falls to the built-in default.
    const env = hookEnv();
    const repo = makeRepo();
    const file = personalWorkflowFile(cliPaths(env));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      requires: ">=0.4",
      workflow: { alerts: { events: ["needs-you"], usagePercent: 90 } },
    });
    const here = alertsAt(cliPaths(env), repo, env);
    expect(here.problem).toContain(`Invalid ${file}: not valid JSON`);
    expect(here.alerts.usagePercent).toEqual({ value: 90, source: "project" });
  });

  test("a project file that needs a newer plugin: the defaults, and the line says so", () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=99", fieldFromTheFuture: true });
    const here = alertsAt(cliPaths(env), repo, env);
    expect(here.problem).toContain("cc-smart-dev-kit.json");
  });
});
