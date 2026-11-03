/**
 * The drift guard for the `requires` floor. An older plugin reads a project's file strictly, so
 * a field or a hook name it does not know makes it refuse the whole file. The floor
 * (`requiresFloor`) makes it say "update" instead, but only for what a since-table lists.
 *
 * These tests fail the day a schema key or a hook name lands without a floor. The two lists
 * below are written by hand, from the git history of the schema and the plugin version of each
 * release (the audit is in the change that added this file): `ACCEPTED_BY_0_5_2` is what the
 * 0.5.2 plugin already took, which is the floor of every file; `FIRST_ACCEPTED_IN` is the rest,
 * each with the first release that took it. Adding a key means adding it to one of them, and for
 * `FIRST_ACCEPTED_IN` the since-table entry too.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { VERSION } from "../build-info";
import {
  ccSmartDevKitConfigSchema,
  JOB_KIND_KEYS_SINCE,
  OWN_HOOK_NAMES_SINCE,
  PLUGIN_HOOK_NAMES,
  RETIRED_HOOK_NAMES,
  UNSWITCHABLE_HOOK_NAMES,
  WORKTREE_PREFIX_OPTIONAL_SINCE,
} from "./config";
import { requiresFloor } from "./init";

/** Every key the 0.5.2 plugin accepted, by its dotted path (`*` is a kind's name in `jobs.kinds`). */
const ACCEPTED_BY_0_5_2 = [
  "requires",
  "worktrees",
  "worktrees.base",
  "worktrees.guardMainFolder",
  "worktrees.bases",
  "protectedBranches",
  "sessionNames",
  "instructions",
  "autoMode",
  "ownHooks",
  "jobs",
  "jobs.route",
  "jobs.kinds",
  "jobs.kinds.*.gb",
  "jobs.kinds.*.filesGb",
  "jobs.kinds.*.maxFiles",
  "jobs.kinds.*.printOnly",
  "jobs.kinds.*.skipWords",
  "jobs.kinds.*.valuedFlags",
  "jobs.kinds.*.workers",
  "jobs.kinds.*.match",
  "jobs.kinds.*.match.tool",
  "jobs.kinds.*.match.sub",
  "jobs.kinds.*.match.flags",
  "jobs.kinds.*.match.argIncludes",
  "jobs.kinds.*.match.valued",
  "jobs.kinds.*.match.script",
  "jobs.kinds.*.about",
  "workflow",
  "workflow.autoCommit",
  "workflow.autoPush",
  "workflow.openPr",
  "workflow.autoMerge",
  "workflow.mergeMethod",
  "workflow.deleteBranch",
  "workflow.reviewBeforePush",
  "workflow.reviewAgents",
  "workflow.clearWorktreeAfterMerge",
  "workflow.alerts",
  "workflow.alerts.events",
  "workflow.alerts.sound",
  "workflow.alerts.usagePercent",
];

/** Every key that came after 0.5.2, with the release that first took it. */
const FIRST_ACCEPTED_IN: Record<string, string> = {
  "worktrees.autoClean": "1.0.0",
  "worktrees.rebuildable": "1.9.0",
  "workflow.fixesAfterReview": "1.0.0",
  "workflow.fixesAfterReview.lines": "1.0.0",
  "workflow.fixesAfterReview.files": "1.0.0",
  "workflow.fixesAfterReview.percent": "1.0.0",
  "workflow.crew": "0.5.2",
  checks: "1.1.0",
  "checks.fast": "1.1.0",
  "workflow.issues": "1.4.0",
  "workflow.issues.enabled": "1.4.0",
  "workflow.issues.allowPublic": "1.4.0",
  "workflow.issues.watch": "1.4.0",
  "workflow.issues.watchMinutes": "1.4.0",
  "workflow.issues.foundLabel": "1.4.0",
  "workflow.issues.fixedLabel": "1.4.0",
  "workflow.issues.readyLabel": "1.4.0",
  "jobs.kinds.*.noSlotForFiles": "1.5.0",
  "jobs.kinds.*.light": "1.8.0",
  tasks: "1.10.0",
  "tasks.dir": "1.10.0",
  "tasks.staleDays": "1.10.0",
  "tasks.releaseBranch": "1.10.0",
  "tasks.legacyFolders": "1.10.0",
};

/** The `ownHooks` names the 0.5.2 plugin accepted, the retired and the unswitchable ones too. */
const HOOK_NAMES_ACCEPTED_BY_0_5_2 = [
  "git-guard",
  "merge-guard",
  "main-folder-guard",
  "message-guard",
  "agent-guard",
  "fable-session",
  "after-merge",
  "review-record",
  "worktree-leftovers",
  "session-name",
  "serena-root",
  "job-route",
];

/** The `ownHooks` names that came after 0.5.2, with the release that first took each. */
const HOOK_NAME_FIRST_ACCEPTED_IN: Record<string, string> = {
  "subagent-background": "1.0.0",
  "crew-role": "1.0.0",
  "lead-notes": "1.0.0",
  "verify-gate": "1.1.0",
  "agent-usage": "1.1.0",
  "tier-view": "1.3.0",
  "task-start": "1.10.0",
  "keep-going": "2.0.0",
  "builder-finish": "2.0.0",
};

/** Every key of a schema, by dotted path. A record's keys are a person's, so they show as `*`. */
function keyPaths(schema: z.ZodType, prefix = ""): string[] {
  if (schema instanceof z.ZodOptional) return keyPaths(schema.unwrap() as z.ZodType, prefix);
  if (schema instanceof z.ZodArray) return keyPaths(schema.element as z.ZodType, prefix);
  if (schema instanceof z.ZodRecord) return keyPaths(schema.valueType as z.ZodType, `${prefix}.*`);
  if (schema instanceof z.ZodUnion) {
    return (schema.options as z.ZodType[]).flatMap((option) => keyPaths(option, prefix));
  }
  if (!(schema instanceof z.ZodObject)) return [];
  return Object.entries(schema.shape).flatMap(([key, child]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return [path, ...keyPaths(child as z.ZodType, path)];
  });
}

/** A project file that sets only the key at `path` (a record's `*` is a kind named `my-kind`). */
function fileWith(path: string): Record<string, unknown> {
  const file: Record<string, unknown> = {};
  let level = file;
  const segments = path.split(".").map((segment) => (segment === "*" ? "my-kind" : segment));
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) level[segment] = true;
    else {
      const next: Record<string, unknown> = {};
      level[segment] = next;
      level = next;
    }
  });
  return file;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

describe("the schema's keys, against the floor", () => {
  const current = uniqueSorted(keyPaths(ccSmartDevKitConfigSchema));

  test("every key the schema has is in the 0.5.2 list or the first-accepted list", () => {
    const known = uniqueSorted([...ACCEPTED_BY_0_5_2, ...Object.keys(FIRST_ACCEPTED_IN)]);
    // A new key shows here. Find the release that first takes it, add it to
    // `FIRST_ACCEPTED_IN`, and give it a since-table entry in `src/project/config.ts`.
    expect(current.filter((path) => !known.includes(path))).toEqual([]);
    // A key taken out of the schema leaves its entry here.
    expect(known.filter((path) => !current.includes(path))).toEqual([]);
  });

  test("the two lists do not share a key", () => {
    expect(
      Object.keys(FIRST_ACCEPTED_IN).filter((path) => ACCEPTED_BY_0_5_2.includes(path)),
    ).toEqual([]);
  });

  test("a file with a key of the 0.5.2 plugin asks for no more than 0.5.2", () => {
    for (const path of ACCEPTED_BY_0_5_2) {
      expect({ path, floor: requiresFloor(fileWith(path)).version }).toEqual({
        path,
        floor: WORKTREE_PREFIX_OPTIONAL_SINCE,
      });
    }
  });

  test("a file with a later key asks for the release that first took it", () => {
    for (const [path, since] of Object.entries(FIRST_ACCEPTED_IN)) {
      expect({ path, floor: requiresFloor(fileWith(path)).version }).toEqual({
        path,
        floor: since,
      });
    }
  });
});

describe("the ownHooks names, against the floor", () => {
  const ownHooks = ccSmartDevKitConfigSchema.shape.ownHooks.unwrap().element.options as string[];

  test("every name the schema takes is in the 0.5.2 list or the first-accepted list", () => {
    const known = [...HOOK_NAMES_ACCEPTED_BY_0_5_2, ...Object.keys(HOOK_NAME_FIRST_ACCEPTED_IN)];
    // A new hook shows here: find the release that ships it, add it to
    // `HOOK_NAME_FIRST_ACCEPTED_IN`, and to `OWN_HOOK_NAMES_SINCE` in `src/project/config.ts`.
    expect(ownHooks.filter((name) => !known.includes(name)).sort()).toEqual([]);
    expect(known.filter((name) => !ownHooks.includes(name)).sort()).toEqual([]);
  });

  test("the names the schema takes are the plugin's, the retired and the unswitchable ones", () => {
    expect(uniqueSorted(ownHooks)).toEqual(
      uniqueSorted([...PLUGIN_HOOK_NAMES, ...RETIRED_HOOK_NAMES, ...UNSWITCHABLE_HOOK_NAMES]),
    );
  });

  test("a name of the 0.5.2 plugin asks for no more than 0.5.2", () => {
    for (const name of HOOK_NAMES_ACCEPTED_BY_0_5_2) {
      expect({ name, floor: requiresFloor({ ownHooks: [name] }).version }).toEqual({
        name,
        floor: WORKTREE_PREFIX_OPTIONAL_SINCE,
      });
    }
  });

  test("a later name asks for the release that first took it", () => {
    for (const [name, since] of Object.entries(HOOK_NAME_FIRST_ACCEPTED_IN)) {
      expect({ name, floor: requiresFloor({ ownHooks: [name] }).version }).toEqual({
        name,
        floor: since,
      });
    }
  });
});

describe("worktrees.rebuildable", () => {
  test("accepts relative patterns for ignored files and folders", () => {
    expect(
      ccSmartDevKitConfigSchema.parse({
        requires: ">=1.9",
        worktrees: { base: "main", rebuildable: [".tool-cache/", "*.cache"] },
      }).worktrees?.rebuildable,
    ).toEqual([".tool-cache/", "*.cache"]);
  });

  test.each([
    "/abs",
    "../x",
    "",
    "a/../x",
    "C:\\cache",
    "\\\\server\\cache",
    "a\\b",
    "./x",
    "a/./x",
    ".",
    "*",
    "**",
    "**/*",
    "*/",
    "?/[!]{,}",
    ".*",
    "*.*",
    "**/.*",
  ])("refuses unsafe rebuildable pattern %j", (pattern) => {
    expect(
      ccSmartDevKitConfigSchema.safeParse({
        worktrees: { base: "main", rebuildable: [pattern] },
      }).success,
    ).toBe(false);
  });
});

describe("tasks", () => {
  test("accepts the folder, the stale age, the release branch and the old notes folders", () => {
    const tasks = {
      dir: "docs/tasks",
      staleDays: 14,
      releaseBranch: "main",
      legacyFolders: [".claude/db-notes", ".claude/prod-notes"],
    };
    expect(ccSmartDevKitConfigSchema.parse({ requires: ">=1.10", tasks }).tasks).toEqual(tasks);
    expect(ccSmartDevKitConfigSchema.parse({ tasks: {} }).tasks).toEqual({});
  });

  test.each([
    { dir: "/abs" },
    { dir: "../x" },
    { dir: "a/../x" },
    { dir: "./x" },
    { dir: "a\\b" },
    { dir: "" },
    { dir: "." },
    { legacyFolders: ["../notes"] },
    { legacyFolders: [""] },
    { staleDays: 0 },
    { staleDays: 1.5 },
    { releaseBranch: " " },
    { folder: "x" },
  ])("refuses %j", (tasks) => {
    expect(ccSmartDevKitConfigSchema.safeParse({ tasks }).success).toBe(false);
  });

  test("a file that sets it needs 1.10.0", () => {
    expect(requiresFloor({ tasks: { dir: ".claude/tasks" } }).version).toBe("1.10.0");
  });
});

describe("the since-tables", () => {
  test("each entry names a real release: a plain version, not newer than this build", () => {
    const versions = [
      ...Object.values(OWN_HOOK_NAMES_SINCE),
      ...Object.values(JOB_KIND_KEYS_SINCE),
    ];
    for (const since of versions) {
      expect(since).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Bun.semver.order(since, VERSION)).toBeLessThanOrEqual(0);
    }
  });
});
