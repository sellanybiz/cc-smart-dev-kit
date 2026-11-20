/**
 * D16: the workflow settings that cannot work together. One pure function, so every place
 * that shows or writes a setting (`workflow show`, `workflow set`, `project init`, the
 * portal) names the same conflict in the same words, with the fix.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { COMMAND } from "../build-info/names";
import { cliPaths } from "../cli/paths";
import { hookEnv } from "../testing/hooks";
import { clashesOf, clashLines, workflowClashes } from "./clashes";
import { resolveWorkflow } from "./resolve";

/** The one clash each pair gives, written out by hand from D16. */
const OPEN_PR_WITHOUT_PUSH = {
  fix: `turn allowPush on (\`${COMMAND} workflow set allowPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`)`,
  line: "openPr opens a pull request, but allowPush is off: a session does not push, and that pull request needs the push, so it waits for you every time",
  setting: "openPr" as const,
};

const DRAFT_WITH_MERGE = {
  fix: `set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn allowMerge off (\`${COMMAND} workflow set allowMerge false\`)`,
  line: "openPr is draft and allowMerge is on: a draft pull request is never merged, so allowMerge never acts on the pull request a session opens",
  setting: "openPr" as const,
};

describe("D16: the settings that cannot work together", () => {
  test("D16: the defaults work together, and name no clash", () => {
    expect(workflowClashes({ allowMerge: false, allowPush: false, openPr: "off" })).toEqual([]);
    // Everything on, with an integration base: nothing waits for a person by surprise.
    expect(workflowClashes({ allowMerge: true, allowPush: true, openPr: "ready" })).toEqual([]);
    // A draft pull request with allowPush on and no allowMerge is a plain choice.
    expect(workflowClashes({ allowMerge: false, allowPush: true, openPr: "draft" })).toEqual([]);
  });

  test("D16: openPr on with allowPush off names the push it waits for, and both fixes", () => {
    expect(workflowClashes({ allowMerge: false, allowPush: false, openPr: "ready" })).toEqual([
      OPEN_PR_WITHOUT_PUSH,
    ]);
    expect(workflowClashes({ allowMerge: false, allowPush: false, openPr: "draft" })).toEqual([
      OPEN_PR_WITHOUT_PUSH,
    ]);
  });

  test("allowMerge on with no integration base is no clash: it merges into the default branch", () => {
    expect(workflowClashes({ allowMerge: true, allowPush: true, openPr: "off" })).toEqual([]);
  });

  test("D16: allowMerge on with openPr draft names the pull request that never merges", () => {
    expect(workflowClashes({ allowMerge: true, allowPush: true, openPr: "draft" })).toEqual([
      DRAFT_WITH_MERGE,
    ]);
  });

  test("D16: each clash is named once, with its fix, in the order a person reads them", () => {
    const lines = clashLines(
      workflowClashes({ allowMerge: true, allowPush: false, openPr: "draft" }),
    );
    expect(lines).toEqual([
      `! ${OPEN_PR_WITHOUT_PUSH.line}. Fix: ${OPEN_PR_WITHOUT_PUSH.fix}.`,
      `! ${DRAFT_WITH_MERGE.line}. Fix: ${DRAFT_WITH_MERGE.fix}.`,
    ]);
    // Each line names its setting once, and its own fix, never another clash's.
    expect(lines[0]).toContain("allowPush is off");
    expect(lines[1]).toContain("draft pull request is never merged");
  });

  test("D16: clashesOf reads the resolved values", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(
      paths.workflowConfigFile,
      `${JSON.stringify({ allowMerge: true, allowPush: true, openPr: "draft" }, null, 2)}\n`,
    );
    // Only the draft pull request is a clash.
    expect(clashesOf(resolveWorkflow(paths, { worktrees: { base: "integration" } }))).toEqual([
      DRAFT_WITH_MERGE,
    ]);
    // The same settings with no project: the same clash.
    expect(clashesOf(resolveWorkflow(paths, null))).toEqual([DRAFT_WITH_MERGE]);
  });
});
