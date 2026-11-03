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
import { jobRouteFrom, resolveJobRoute, resolveWorkflow } from "./resolve";
import {
  isPersonalFileSwitch,
  PERSONAL_FILE_SWITCH_NAMES,
  parseWorkflowValue,
  personalWorkflowSchema,
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
  test("2.0 removed the crew: an old project or personal crew object loads and is ignored", () => {
    const env = hookEnv();
    const crew = { enabled: true, max: 0, futureKey: "ignored" };
    writePersonal(env, { crew });
    const config = ccSmartDevKitConfigSchema.parse({ workflow: { crew } });
    expect(resolveWorkflow(pathsFor(env), config)).not.toHaveProperty("crew");
  });

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

  test("D67: GitHub Issues are off by default, with the three labels", () => {
    const resolved = resolveWorkflow(pathsFor(hookEnv()), null);
    expect(resolved.issues).toEqual({
      allowPublic: { source: "default", value: false },
      enabled: { source: "default", value: false },
      fixedLabel: { source: "default", value: "fixed-unreleased" },
      foundLabel: { source: "default", value: "kit:found" },
      readyLabel: { source: "default", value: "kit:ready" },
      watch: { source: "default", value: false },
      watchMinutes: { source: "default", value: 5 },
    });
  });

  test("GI4: the watch is off by default, even with the issue switch on", () => {
    const env = hookEnv();
    const file = pathsFor(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ issues: { enabled: true } }));
    const { issues } = resolveWorkflow(pathsFor(env), null);
    expect(issues.enabled.value).toBe(true);
    expect(issues.watch).toEqual({ source: "default", value: false });
  });

  test("GI4: watch and watchMinutes resolve field by field; the minutes have a floor of 2", () => {
    const project = ccSmartDevKitConfigSchema.parse({
      workflow: { issues: { watch: true, watchMinutes: 2 } },
    });
    const { issues } = resolveWorkflow(pathsFor(hookEnv()), project);
    expect(issues.watch).toEqual({ source: "project", value: true });
    expect(issues.watchMinutes).toEqual({ source: "project", value: 2 });
    const parse = (watchMinutes: unknown) =>
      ccSmartDevKitConfigSchema.safeParse({ workflow: { issues: { watchMinutes } } }).success;
    expect(parse(1)).toBe(false);
    expect(parse(0)).toBe(false);
    expect(parse(2.5)).toBe(false);
    expect(parse(1441)).toBe(false);
    expect(parse(1440)).toBe(true);
  });

  test("D67: the project's issues fields win field by field over the person's", () => {
    const env = hookEnv();
    const file = pathsFor(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ issues: { enabled: true, foundLabel: "mine" } }));
    const project = ccSmartDevKitConfigSchema.parse({
      workflow: { issues: { foundLabel: "theirs" } },
    });
    const { issues } = resolveWorkflow(pathsFor(env), project);
    expect(issues.enabled).toEqual({ source: "personal", value: true });
    expect(issues.foundLabel).toEqual({ source: "project", value: "theirs" });
  });

  test("GI4: the three labels differ in one file, a label left out standing as its default", () => {
    const parse = (issues: unknown) =>
      ccSmartDevKitConfigSchema.safeParse({ workflow: { issues } }).success;
    expect(parse({ foundLabel: "a", fixedLabel: "b", readyLabel: "c" })).toBe(true);
    // The default ready label is kit:ready, the default found label kit:found.
    expect(parse({ foundLabel: "kit:ready" })).toBe(false);
    expect(parse({ fixedLabel: "KIT:Ready" })).toBe(false);
    expect(parse({ readyLabel: "fixed-unreleased", fixedLabel: "fixed-unreleased" })).toBe(false);
    expect(parse({ readyLabel: "kit:found" })).toBe(false);
    expect(parse({ fixedLabel: "kit:found" })).toBe(false);
    const clash = ccSmartDevKitConfigSchema.safeParse({
      workflow: { issues: { foundLabel: "x", fixedLabel: "X" } },
    });
    expect(clash.success ? "" : clash.error.message).toContain(
      "issues.foundLabel and issues.fixedLabel are both x",
    );
  });

  test("D67: the schema refuses a label GitHub would split, and an unknown issues field", () => {
    const parse = (issues: unknown) =>
      ccSmartDevKitConfigSchema.safeParse({ workflow: { issues } }).success;
    expect(parse({ enabled: true, readyLabel: "kit:ready" })).toBe(true);
    expect(parse({ foundLabel: "a,b" })).toBe(false);
    expect(parse({ foundLabel: "" })).toBe(false);
    expect(parse({ foundLabel: "x".repeat(51) })).toBe(false);
    expect(parse({ everything: true })).toBe(false);
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
  test("sessionNames and jobRoute read the project's value when the project sets one", () => {
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

// The person's machine-wide default for the job queue's route, and the project's own value over it.
describe("switches.jobRoute: the person's default, and the project wins", () => {
  const project = (route?: boolean) =>
    ccSmartDevKitConfigSchema.parse(route === undefined ? {} : { jobs: { route } });
  const resolve = (personal: unknown, config: ReturnType<typeof project> | null) => {
    const env = hookEnv();
    if (personal !== undefined) writePersonal(env, personal);
    return resolveWorkflow(pathsFor(env), config).switches.jobRoute;
  };

  test("off when nobody says otherwise", () => {
    expect(resolve(undefined, null)).toEqual({ value: false, source: "default" });
    expect(resolve({}, project())).toEqual({ value: false, source: "default" });
  });

  test("the person's default is every project's, and with no project at all", () => {
    const personal = { switches: { jobRoute: true } };
    expect(resolve(personal, null)).toEqual({ value: true, source: "personal" });
    expect(resolve(personal, project())).toEqual({ value: true, source: "personal" });
    // A project that sets other jobs fields but not the route leaves the person's default.
    const kindsOnly = ccSmartDevKitConfigSchema.parse({
      jobs: { kinds: { e2e: { match: [{ script: "e2e" }] } } },
    });
    expect(resolve(personal, kindsOnly)).toEqual({ value: true, source: "personal" });
    expect(resolve({ switches: { jobRoute: false } }, project())).toEqual({
      value: false,
      source: "personal",
    });
  });

  test("the project's value wins, in both directions", () => {
    expect(resolve({ switches: { jobRoute: true } }, project(false))).toEqual({
      value: false,
      source: "project",
    });
    expect(resolve({ switches: { jobRoute: false } }, project(true))).toEqual({
      value: true,
      source: "project",
    });
    expect(resolve(undefined, project(true))).toEqual({ value: true, source: "project" });
  });

  test("one function decides it, for the whole resolution and for the hook", () => {
    const personal = personalWorkflowSchema.parse({ switches: { jobRoute: true } });
    expect(jobRouteFrom(personal, null)).toEqual({ value: true, source: "personal" });
    expect(jobRouteFrom(personal, project(false))).toEqual({ value: false, source: "project" });
    expect(jobRouteFrom({}, null)).toEqual({ value: false, source: "default" });
    const env = hookEnv();
    writePersonal(env, { switches: { jobRoute: true } });
    expect(resolveJobRoute(pathsFor(env), project(false))).toEqual({
      value: false,
      source: "project",
    });
    expect(resolveJobRoute(pathsFor(env), null)).toEqual({ value: true, source: "personal" });
  });

  // A hook must not fail on a broken file: the project's value and the default stand.
  test("a personal file that cannot be used leaves the project's value and the default", () => {
    const env = hookEnv();
    const paths = pathsFor(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, "{not json");
    expect(resolveJobRoute(paths, project(true))).toEqual({ value: true, source: "project" });
    expect(resolveJobRoute(paths, null)).toEqual({ value: false, source: "default" });
    // The whole resolution still says the file is wrong, as it always did.
    expect(() => resolveWorkflow(paths, null)).toThrow(/not valid JSON/);
  });

  test("only the person's file has the switches group, and only for jobRoute", () => {
    expect(personalWorkflowSchema.safeParse({ switches: { jobRoute: true } }).success).toBe(true);
    expect(personalWorkflowSchema.safeParse({ switches: {} }).success).toBe(true);
    for (const bad of [
      { switches: { jobRoute: "yes" } },
      { switches: { sessionNames: true } },
      { switches: { statusLine: true } },
      { switches: { updateHold: true } },
    ]) {
      expect(personalWorkflowSchema.safeParse(bad).success).toBe(false);
    }
    // A project's workflow object has none: its `jobs.route` is its own copy of the choice.
    expect(workflowSchema.safeParse({ switches: { jobRoute: true } }).success).toBe(false);
    expect(
      ccSmartDevKitConfigSchema.safeParse({ workflow: { switches: { jobRoute: true } } }).success,
    ).toBe(false);
    // The names the writer lets into the person's file are the fields its schema has.
    expect([...PERSONAL_FILE_SWITCH_NAMES]).toEqual(["jobRoute"]);
    expect(isPersonalFileSwitch("switches.jobRoute")).toBe(true);
    for (const key of ["switches.sessionNames", "switches.statusLine", "autoCommit"]) {
      expect(isPersonalFileSwitch(key)).toBe(false);
    }
  });

  test("a value is typed true or false", () => {
    expect(parseWorkflowValue("switches.jobRoute", "true")).toEqual({ ok: true, value: true });
    expect(parseWorkflowValue("switches.jobRoute", "false")).toEqual({ ok: true, value: false });
    expect(parseWorkflowValue("switches.jobRoute", "maybe")).toEqual({
      ok: false,
      why: "switches.jobRoute is true or false",
    });
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
