/** The workflow settings: the schema, the resolution order, the switches, and the auto-merge rule. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cliPaths } from "../cli/paths";
import { ccSmartDevKitConfigSchema } from "../project/config";
import { statuslineSetting } from "../setup/statusline";
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

  test("D34: workflow.crew takes the switch, the limits, the tag and what to keep, and nothing else", () => {
    const every = {
      crew: {
        enabled: true,
        handoffPercent: 70,
        idleStopMinutes: 10,
        keep: ["plugin:acme-tools@acme", "server:sequential-thinking"],
        max: 4,
        maxOpus: 2,
        maxHours: 4,
        memoryGb: 0.5,
        quietMinutes: 20,
        softHours: 1.5,
        tag: "my-app",
      },
    };
    expect(workflowSchema.parse(every)).toEqual(every);
    const refused = (crew: Record<string, unknown>) => workflowSchema.safeParse({ crew }).success;
    expect(refused({ count: 3 })).toBe(false);
    expect(refused({ enabled: "yes" })).toBe(false);
    // A keep entry is `plugin:<id>` or `server:<name>`, and nothing else: an unknown shape is
    // refused where the file is read, not at the next `crew start`.
    expect(refused({ keep: "plugin:acme-tools@acme" })).toBe(false);
    for (const bad of [
      ["widget"],
      ["plugin:"],
      ["plugin:acme-tools"],
      ["plugin:@acme"],
      ["server:"],
      ["server:Sequential-Thinking"],
      ["server:two words"],
      ["PLUGIN:acme-tools@acme"],
    ]) {
      expect(`${bad.join(",")}: ${refused({ keep: bad })}`).toBe(`${bad.join(",")}: false`);
    }
    for (const [field, bad] of [
      ["max", 0],
      ["max", 1.5],
      ["maxOpus", 0],
      ["maxOpus", 2.5],
      ["idleStopMinutes", 0],
      ["quietMinutes", -1],
      ["handoffPercent", 0],
      ["handoffPercent", 101],
      ["softHours", 0],
      ["maxHours", -2],
      ["memoryGb", 0],
      ["tag", "My App"],
      ["tag", "a-very-long-tag"],
      ["tag", "kit]"],
      ["tag", ""],
    ] as const) {
      expect(`${field}=${bad}: ${refused({ [field]: bad })}`).toBe(`${field}=${bad}: false`);
    }
  });

  test("D17: fixesAfterReview takes lines, files and percent, each a whole number 0 or more", () => {
    expect(workflowSchema.parse({ fixesAfterReview: { files: 0, lines: 0, percent: 0 } })).toEqual({
      fixesAfterReview: { files: 0, lines: 0, percent: 0 },
    });
    expect(workflowSchema.parse({ fixesAfterReview: { percent: 150 } })).toEqual({
      fixesAfterReview: { percent: 150 },
    });
    for (const fixes of [{ lines: -1 }, { files: 2.5 }, { percent: "20" }, { bytes: 1 }]) {
      expect(workflowSchema.safeParse({ fixesAfterReview: fixes }).success).toBe(false);
    }
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

  test("D34: the crew sessions' numbers, each with its own range", () => {
    expect(parseWorkflowValue("crew.enabled", "true")).toEqual({ ok: true, value: true });
    expect(parseWorkflowValue("crew.max", "3")).toEqual({ ok: true, value: 3 });
    expect(parseWorkflowValue("crew.max", "0")).toEqual({
      ok: false,
      why: "crew.max is a whole number, 1 or more",
    });
    expect(parseWorkflowValue("crew.idleStopMinutes", "2.5")).toEqual({
      ok: false,
      why: "crew.idleStopMinutes is a whole number, 1 or more",
    });
    expect(parseWorkflowValue("crew.maxOpus", "1")).toEqual({ ok: true, value: 1 });
    expect(parseWorkflowValue("crew.maxOpus", "0")).toEqual({
      ok: false,
      why: "crew.maxOpus is a whole number, 1 or more",
    });
    expect(parseWorkflowValue("crew.perLead", "4")).toEqual({ ok: true, value: 4 });
    expect(parseWorkflowValue("crew.perLead", "0")).toEqual({
      ok: false,
      why: "crew.perLead is a whole number, 1 or more",
    });
    expect(parseWorkflowValue("crew.perLeadOpus", "2")).toEqual({ ok: true, value: 2 });
    expect(parseWorkflowValue("crew.usagePercent", "85")).toEqual({ ok: true, value: 85 });
    expect(parseWorkflowValue("crew.usagePercent", "101")).toEqual({
      ok: false,
      why: "crew.usagePercent is a whole number 1-100",
    });
    expect(parseWorkflowValue("crew.handoffPercent", "70")).toEqual({ ok: true, value: 70 });
    expect(parseWorkflowValue("crew.handoffPercent", "101")).toEqual({
      ok: false,
      why: "crew.handoffPercent is a whole number 1-100",
    });
    expect(parseWorkflowValue("crew.softHours", "1.5")).toEqual({ ok: true, value: 1.5 });
    expect(parseWorkflowValue("crew.memoryGb", "0")).toEqual({
      ok: false,
      why: "crew.memoryGb is a number above 0",
    });
    expect(parseWorkflowValue("crew.maxHours", "four")).toEqual({
      ok: false,
      why: "crew.maxHours is a number above 0",
    });
  });

  test("D26: the crew sessions' tag is refused unless it is already clean", () => {
    expect(parseWorkflowValue("crew.tag", "kit")).toEqual({ ok: true, value: "kit" });
    expect(parseWorkflowValue("crew.tag", "My App")).toEqual({
      ok: false,
      why: 'crew.tag is 1-12 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"',
    });
  });

  test("crew.keep is a comma list of plugin:<id> and server:<name>, without doubles", () => {
    expect(
      parseWorkflowValue("crew.keep", "plugin:acme-tools@acme, server:sequential-thinking"),
    ).toEqual({ ok: true, value: ["plugin:acme-tools@acme", "server:sequential-thinking"] });
    expect(parseWorkflowValue("crew.keep", "server:playwright server:playwright")).toEqual({
      ok: true,
      value: ["server:playwright"],
    });
    expect(parseWorkflowValue("crew.keep", "widget")).toEqual({
      ok: false,
      why: 'crew.keep: unknown widget (an entry is "plugin:<id>" or "server:<name>")',
    });
    expect(parseWorkflowValue("crew.keep", "")).toEqual({
      ok: false,
      why: 'crew.keep is a list of "plugin:<id>" or "server:<name>"',
    });
  });

  test("D17: the limits after a review are whole numbers, 0 or more", () => {
    expect(parseWorkflowValue("fixesAfterReview.lines", "0")).toEqual({ ok: true, value: 0 });
    expect(parseWorkflowValue("fixesAfterReview.percent", "150")).toEqual({ ok: true, value: 150 });
    expect(parseWorkflowValue("fixesAfterReview.files", "-1")).toEqual({
      ok: false,
      why: "fixesAfterReview.files is a whole number, 0 or more",
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

  test("D34, D35, D37: crew sessions are off by default, with the lead's limits; D17's limits 200/10/20", () => {
    const resolved = resolveWorkflow(pathsFor(hookEnv()), null);
    expect(resolved.crew).toEqual({
      enabled: { value: false, source: "default" },
      handoffPercent: { value: 70, source: "default" },
      idleStopMinutes: { value: 10, source: "default" },
      keep: { value: [], source: "default" },
      max: { value: 24, source: "default" },
      maxOpus: { value: null, source: "default" },
      maxHours: { value: 4, source: "default" },
      memoryGb: { value: 2, source: "default" },
      perLead: { value: 4, source: "default" },
      perLeadOpus: { value: 2, source: "default" },
      quietMinutes: { value: 20, source: "default" },
      softHours: { value: 2, source: "default" },
      tag: { value: null, source: "default" },
      usagePercent: { value: 85, source: "default" },
    });
    expect(resolved.fixesAfterReview).toEqual({
      files: { value: 10, source: "default" },
      lines: { value: 200, source: "default" },
      percent: { value: 20, source: "default" },
    });
  });

  test("D34: the person's switch is every project's default; a project's value wins, field by field", () => {
    const env = hookEnv();
    writePersonal(env, {
      fixesAfterReview: { lines: 50 },
      crew: { enabled: true, keep: ["server:sequential-thinking"], max: 2, tag: "mine" },
    });
    const config = ccSmartDevKitConfigSchema.parse({
      workflow: {
        fixesAfterReview: { files: 0 },
        crew: { keep: ["plugin:acme-tools@acme"], max: 3 },
      },
    });
    const resolved = resolveWorkflow(pathsFor(env), config);
    expect(resolved.crew.enabled).toEqual({ value: true, source: "personal" });
    expect(resolved.crew.max).toEqual({ value: 3, source: "project" });
    // A list is one value: the project's list wins whole, never merged entry by entry.
    expect(resolved.crew.keep).toEqual({
      value: ["plugin:acme-tools@acme"],
      source: "project",
    });
    expect(resolved.crew.tag).toEqual({ value: "mine", source: "personal" });
    expect(resolved.crew.quietMinutes).toEqual({ value: 20, source: "default" });
    expect(resolved.fixesAfterReview).toEqual({
      files: { value: 0, source: "project" },
      lines: { value: 50, source: "personal" },
      percent: { value: 20, source: "default" },
    });
    const off = ccSmartDevKitConfigSchema.parse({ workflow: { crew: { enabled: false } } });
    expect(resolveWorkflow(pathsFor(env), off).crew.enabled).toEqual({
      value: false,
      source: "project",
    });
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
    expect(autoMergeAllowed(resolved, project({ base: "dev" }), "dev", "main")).toBe(false);
  });

  test("on, into the integration base, nothing special about it: yes", () => {
    const resolved = resolvedWith(true);
    expect(autoMergeAllowed(resolved, project({ base: "dev" }), "dev", "main")).toBe(true);
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
    const config = project({ base: "dev" });
    expect(autoMergeAllowed(resolved, config, "main", "main")).toBe(false);
    expect(autoMergeAllowed(resolved, config, "release/1.0", "main")).toBe(false);
  });

  test("the repository's default branch always asks the person", () => {
    const resolved = resolvedWith(true);
    const config = project({ base: "main" });
    expect(autoMergeAllowed(resolved, config, "main", "main")).toBe(false);
  });

  test("a base another family of branches feeds always asks the person", () => {
    const resolved = resolvedWith(true);
    const config = project({ base: "dev", bases: { "release/": "dev" } });
    expect(autoMergeAllowed(resolved, config, "dev", "main")).toBe(false);
  });

  test("the integration base may itself be protected: it is the one branch this writes to", () => {
    const resolved = resolvedWith(true);
    const config = project({
      base: "dev",
      bases: { "hotfix/": "main", "release/": "main" },
    });
    const withProtection = ccSmartDevKitConfigSchema.parse({
      ...config,
      protectedBranches: ["main", "dev"],
    });
    expect(autoMergeAllowed(resolved, withProtection, "dev", "main")).toBe(true);
  });
});
