/** The workflow settings: the schema, the resolution order, the switches, and the auto-merge rule. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cliPaths } from "../cli/paths";
import { statuslineSetting } from "../cli/setup";
import { ccSmartDevKitConfigSchema } from "../project/config";
import { hookEnv } from "../testing/hooks";
import { hold, updateFiles } from "../update/state";
import { autoMergeAllowed } from "./auto-merge";
import { resolveWorkflow } from "./resolve";
import {
  parseWorkflowValue,
  setWorkflowValue,
  unsetWorkflowValue,
  workflowSchema,
  workflowValue,
} from "./schema";

function pathsFor(env: Record<string, string>) {
  return cliPaths(env);
}

/** Writes the person's own defaults file and returns its path. */
function writePersonal(env: Record<string, string>, value: unknown): string {
  const paths = pathsFor(env);
  mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
  writeFileSync(paths.workflowConfigFile, `${JSON.stringify(value, null, 2)}\n`);
  return paths.workflowConfigFile;
}

/** Writes Claude Code's settings.json and returns its path. */
function writeSettings(env: Record<string, string>, value: unknown): string {
  const paths = pathsFor(env);
  mkdirSync(dirname(paths.settingsFile), { recursive: true });
  writeFileSync(paths.settingsFile, `${JSON.stringify(value, null, 2)}\n`);
  return paths.settingsFile;
}

describe("the workflow schema", () => {
  test("an empty object is every field left out", () => {
    expect(workflowSchema.parse({})).toEqual({});
  });

  test("an unknown field is refused", () => {
    const parsed = workflowSchema.safeParse({ autoCommits: true });
    expect(parsed.success).toBe(false);
  });

  test("usagePercent is 1-100 and a whole number", () => {
    expect(workflowSchema.safeParse({ alerts: { usagePercent: 0 } }).success).toBe(false);
    expect(workflowSchema.safeParse({ alerts: { usagePercent: 101 } }).success).toBe(false);
    expect(workflowSchema.safeParse({ alerts: { usagePercent: 84.5 } }).success).toBe(false);
    expect(workflowSchema.safeParse({ alerts: { usagePercent: 80 } }).success).toBe(true);
  });

  test("alerts.events refuses an unknown event, an empty list, and a doubled one", () => {
    expect(workflowSchema.safeParse({ alerts: { events: ["done"] } }).success).toBe(false);
    expect(workflowSchema.safeParse({ alerts: { events: [] } }).success).toBe(false);
    expect(workflowSchema.safeParse({ alerts: { events: ["question", "question"] } }).success).toBe(
      false,
    );
    expect(workflowSchema.safeParse({ alerts: { events: ["finished", "failed"] } }).success).toBe(
      true,
    );
  });
});

describe("one value, as a person types it", () => {
  test("a boolean is true or false, and nothing else", () => {
    expect(parseWorkflowValue("autoMerge", "true")).toEqual({ ok: true, value: true });
    expect(parseWorkflowValue("autoMerge", "false")).toEqual({ ok: true, value: false });
    expect(parseWorkflowValue("autoMerge", "yes")).toEqual({
      ok: false,
      why: "autoMerge is true or false",
    });
  });

  test("an enum names its words", () => {
    expect(parseWorkflowValue("openPr", "draft")).toEqual({ ok: true, value: "draft" });
    expect(parseWorkflowValue("openPr", "auto")).toEqual({
      ok: false,
      why: "openPr is one of off, draft, ready",
    });
    expect(parseWorkflowValue("mergeMethod", "squash")).toEqual({ ok: true, value: "squash" });
  });

  test("the usage percent is a whole number 1-100", () => {
    expect(parseWorkflowValue("alerts.usagePercent", "90")).toEqual({ ok: true, value: 90 });
    expect(parseWorkflowValue("alerts.usagePercent", "0")).toEqual({
      ok: false,
      why: "alerts.usagePercent is a whole number 1-100",
    });
    expect(parseWorkflowValue("alerts.usagePercent", "lots")).toEqual({
      ok: false,
      why: "alerts.usagePercent is a whole number 1-100",
    });
  });

  test("the events are read from a comma list, without doubles", () => {
    expect(parseWorkflowValue("alerts.events", "needs-you,question")).toEqual({
      ok: true,
      value: ["needs-you", "question"],
    });
    expect(parseWorkflowValue("alerts.events", "finished finished")).toEqual({
      ok: true,
      value: ["finished"],
    });
    expect(parseWorkflowValue("alerts.events", "done")).toEqual({
      ok: false,
      why: "alerts.events: unknown done (one of needs-you, question, finished, failed)",
    });
    expect(parseWorkflowValue("alerts.events", " ")).toEqual({
      ok: false,
      why: "alerts.events is a list of needs-you, question, finished, failed",
    });
  });
});

describe("setting one field of an object", () => {
  test("a nested field keeps its group's other fields", () => {
    const before = { alerts: { sound: true, usagePercent: 70 } };
    expect(setWorkflowValue(before, "alerts.usagePercent", 90)).toEqual({
      alerts: { sound: true, usagePercent: 90 },
    });
  });

  test("unsetting the last field of a group drops the group", () => {
    expect(unsetWorkflowValue({ alerts: { sound: true } }, "alerts.sound")).toEqual({});
  });

  test("unsetting one of two keeps the other", () => {
    expect(
      unsetWorkflowValue({ alerts: { sound: true, usagePercent: 70 } }, "alerts.sound"),
    ).toEqual({
      alerts: { usagePercent: 70 },
    });
  });

  test("a value is read back the way it was written", () => {
    expect(workflowValue({ autoMerge: true }, "autoMerge")).toBe(true);
    expect(workflowValue({ alerts: { usagePercent: 70 } }, "alerts.usagePercent")).toBe(70);
    expect(workflowValue({}, "alerts.usagePercent")).toBeUndefined();
  });
});

describe("resolveWorkflow: the order", () => {
  test("nothing set anywhere: every value is the built-in default, said as such", () => {
    const env = hookEnv();
    const resolved = resolveWorkflow(pathsFor(env), null);
    expect(resolved.autoCommit).toEqual({ value: false, source: "default" });
    expect(resolved.autoPush).toEqual({ value: false, source: "default" });
    expect(resolved.openPr).toEqual({ value: "off", source: "default" });
    expect(resolved.autoMerge).toEqual({ value: false, source: "default" });
    expect(resolved.mergeMethod).toEqual({ value: "merge", source: "default" });
    expect(resolved.deleteBranch).toEqual({ value: false, source: "default" });
    expect(resolved.reviewBeforePush).toEqual({ value: true, source: "default" });
    expect(resolved.clearWorktreeAfterMerge).toEqual({ value: false, source: "default" });
    expect(resolved.alerts.events).toEqual({
      value: ["needs-you", "question", "finished", "failed"],
      source: "default",
    });
    expect(resolved.alerts.sound).toEqual({ value: false, source: "default" });
    expect(resolved.alerts.usagePercent).toEqual({ value: 85, source: "default" });
  });

  test("the person's file sets a value, and says so", () => {
    const env = hookEnv();
    writePersonal(env, { autoCommit: true, alerts: { sound: true, usagePercent: 70 } });
    const resolved = resolveWorkflow(pathsFor(env), null);
    expect(resolved.autoCommit).toEqual({ value: true, source: "personal" });
    expect(resolved.alerts.sound).toEqual({ value: true, source: "personal" });
    expect(resolved.alerts.usagePercent).toEqual({ value: 70, source: "personal" });
    expect(resolved.alerts.events.source).toBe("default");
  });

  test("the project wins field by field, and only where it says something", () => {
    const env = hookEnv();
    writePersonal(env, { autoCommit: true, openPr: "ready", alerts: { sound: true } });
    const config = ccSmartDevKitConfigSchema.parse({
      workflow: { openPr: "draft", alerts: { usagePercent: 60 } },
    });
    const resolved = resolveWorkflow(pathsFor(env), config);
    expect(resolved.autoCommit).toEqual({ value: true, source: "personal" });
    expect(resolved.openPr).toEqual({ value: "draft", source: "project" });
    expect(resolved.alerts.sound).toEqual({ value: true, source: "personal" });
    expect(resolved.alerts.usagePercent).toEqual({ value: 60, source: "project" });
  });

  test("a broken personal file throws, naming the file and the field", () => {
    const env = hookEnv();
    const file = writePersonal(env, { autoCommit: "yes" });
    expect(() => resolveWorkflow(pathsFor(env), null)).toThrow(
      `Invalid ${file}: autoCommit: Invalid input: expected boolean, received string`,
    );
  });

  test("a personal file that is not JSON throws, naming the file", () => {
    const env = hookEnv();
    const paths = pathsFor(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, "{not json");
    expect(() => resolveWorkflow(paths, null)).toThrow(/not valid JSON/);
  });
});

describe("the switches: the setting that already exists", () => {
  test("sessionNames and jobRoute are the project's, with the project's value", () => {
    const env = hookEnv();
    const off = resolveWorkflow(pathsFor(env), ccSmartDevKitConfigSchema.parse({}));
    expect(off.switches.sessionNames).toEqual({ value: false, source: "default" });
    expect(off.switches.jobRoute).toEqual({ value: false, source: "default" });
    const on = resolveWorkflow(
      pathsFor(env),
      ccSmartDevKitConfigSchema.parse({ sessionNames: true, jobs: { route: true } }),
    );
    expect(on.switches.sessionNames).toEqual({ value: true, source: "project" });
    expect(on.switches.jobRoute).toEqual({ value: true, source: "project" });
  });

  test("statusLine is on only when it is cc-smart-dev-kit's own", () => {
    const env = hookEnv();
    const paths = pathsFor(env);
    expect(resolveWorkflow(paths, null).switches.statusLine).toEqual({
      value: false,
      source: "default",
    });
    writeSettings(env, { statusLine: { command: "my-own-status", type: "command" } });
    expect(resolveWorkflow(paths, null).switches.statusLine).toEqual({
      value: false,
      source: "default",
    });
    writeSettings(env, { statusLine: statuslineSetting(paths) });
    expect(resolveWorkflow(paths, null).switches.statusLine).toEqual({
      value: true,
      source: "personal",
    });
  });

  test("updateHold is the hold file behind `update --hold`", () => {
    const env = hookEnv();
    const paths = pathsFor(env);
    expect(resolveWorkflow(paths, null).switches.updateHold).toEqual({
      value: false,
      source: "default",
    });
    hold(updateFiles(paths.stateDir), 1_700_000_000_000);
    expect(resolveWorkflow(paths, null).switches.updateHold).toEqual({
      value: true,
      source: "personal",
    });
    expect(readFileSync(updateFiles(paths.stateDir).hold, "utf8")).toBe("2023-11-14T22:13:20Z\n");
  });
});

describe("autoMergeAllowed", () => {
  const env = hookEnv();
  const paths = pathsFor(env);
  const resolvedWith = (autoMerge: boolean) =>
    resolveWorkflow(paths, ccSmartDevKitConfigSchema.parse({ workflow: { autoMerge } }));
  const project = (worktrees: Record<string, unknown>) =>
    ccSmartDevKitConfigSchema.parse({ worktrees });

  test("off: never, whatever the branches are", () => {
    const resolved = resolvedWith(false);
    expect(
      autoMergeAllowed(resolved, project({ base: "dev", prefix: "a-wt-" }), "dev", "main"),
    ).toBe(false);
  });

  test("on, into the integration base, nothing special about it: yes", () => {
    const resolved = resolvedWith(true);
    expect(
      autoMergeAllowed(resolved, project({ base: "dev", prefix: "a-wt-" }), "dev", "main"),
    ).toBe(true);
  });

  test("no worktrees, or no base: no integration base to merge into", () => {
    const resolved = resolvedWith(true);
    expect(autoMergeAllowed(resolved, null, "dev", "main")).toBe(false);
    expect(autoMergeAllowed(resolved, ccSmartDevKitConfigSchema.parse({}), "dev", "main")).toBe(
      false,
    );
  });

  test("a pull request into another branch is never merged by itself", () => {
    const resolved = resolvedWith(true);
    const config = project({ base: "dev", prefix: "a-wt-" });
    expect(autoMergeAllowed(resolved, config, "main", "main")).toBe(false);
    expect(autoMergeAllowed(resolved, config, "release/1.0", "main")).toBe(false);
  });

  test("the repository's default branch always asks the person", () => {
    const resolved = resolvedWith(true);
    const config = project({ base: "main", prefix: "a-wt-" });
    expect(autoMergeAllowed(resolved, config, "main", "main")).toBe(false);
  });

  test("a base another family of branches feeds always asks the person", () => {
    const resolved = resolvedWith(true);
    const config = project({ base: "dev", prefix: "a-wt-", bases: { "release/": "dev" } });
    expect(autoMergeAllowed(resolved, config, "dev", "main")).toBe(false);
  });

  test("the integration base may itself be protected: it is the one branch this writes to", () => {
    const resolved = resolvedWith(true);
    const config = project({
      base: "dev",
      prefix: "a-wt-",
      bases: { "hotfix/": "main", "release/": "main" },
    });
    const withProtection = ccSmartDevKitConfigSchema.parse({
      ...config,
      protectedBranches: ["main", "dev"],
    });
    expect(autoMergeAllowed(resolved, withProtection, "dev", "main")).toBe(true);
  });
});
