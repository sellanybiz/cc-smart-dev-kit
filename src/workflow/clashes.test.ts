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
  fix: `turn autoPush on (\`${COMMAND} workflow set autoPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`)`,
  line: "openPr opens a pull request, but autoPush is off: the git guard asks before the push that pull request needs, so it waits for you every time",
  setting: "openPr" as const,
};

const MERGE_WITHOUT_BASE = {
  fix: `name the integration base in .claude/cc-smart-dev-kit.json ("worktrees": {"base": "<branch>"}), or turn autoMerge off (\`${COMMAND} workflow set autoMerge false\`)`,
  line: "autoMerge is on, but the project names no integration base (worktrees.base), so the merge guard asks before every merge",
  setting: "autoMerge" as const,
};

const DRAFT_WITH_MERGE = {
  fix: `set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn autoMerge off (\`${COMMAND} workflow set autoMerge false\`)`,
  line: "openPr is draft and autoMerge is on: a draft pull request is never merged, so autoMerge never acts on the pull request a session opens",
  setting: "openPr" as const,
};

describe("D16: the settings that cannot work together", () => {
  test("D16: the defaults work together, and name no clash", () => {
    expect(
      workflowClashes({ autoMerge: false, autoPush: false, base: "integration", openPr: "off" }),
    ).toEqual([]);
    // Everything on, with an integration base: nothing waits for a person by surprise.
    expect(
      workflowClashes({ autoMerge: true, autoPush: true, base: "integration", openPr: "ready" }),
    ).toEqual([]);
    // A draft pull request with autoPush on and no autoMerge is a plain choice.
    expect(
      workflowClashes({ autoMerge: false, autoPush: true, base: null, openPr: "draft" }),
    ).toEqual([]);
  });

  test("D16: openPr on with autoPush off names the push it waits for, and both fixes", () => {
    expect(
      workflowClashes({ autoMerge: false, autoPush: false, base: "integration", openPr: "ready" }),
    ).toEqual([OPEN_PR_WITHOUT_PUSH]);
    expect(
      workflowClashes({ autoMerge: false, autoPush: false, base: "integration", openPr: "draft" }),
    ).toEqual([OPEN_PR_WITHOUT_PUSH]);
  });

  test("D16: autoMerge on with no integration base names the branch it needs, and both fixes", () => {
    expect(workflowClashes({ autoMerge: true, autoPush: true, base: null, openPr: "off" })).toEqual(
      [MERGE_WITHOUT_BASE],
    );
  });

  test("D16: autoMerge on with openPr draft names the pull request that never merges", () => {
    expect(
      workflowClashes({ autoMerge: true, autoPush: true, base: "integration", openPr: "draft" }),
    ).toEqual([DRAFT_WITH_MERGE]);
  });

  test("D16: each clash is named once, with its fix, in the order a person reads them", () => {
    const lines = clashLines(
      workflowClashes({ autoMerge: true, autoPush: false, base: null, openPr: "draft" }),
    );
    expect(lines).toEqual([
      `! ${OPEN_PR_WITHOUT_PUSH.line}. Fix: ${OPEN_PR_WITHOUT_PUSH.fix}.`,
      `! ${MERGE_WITHOUT_BASE.line}. Fix: ${MERGE_WITHOUT_BASE.fix}.`,
      `! ${DRAFT_WITH_MERGE.line}. Fix: ${DRAFT_WITH_MERGE.fix}.`,
    ]);
    // Each line names its setting once, and its own fix, never another clash's.
    expect(lines[0]).toContain("autoPush is off");
    expect(lines[1]).toContain("names no integration base");
    expect(lines[2]).toContain("draft pull request is never merged");
  });

  test("D16: clashesOf reads the resolved values and the project's integration base", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(
      paths.workflowConfigFile,
      `${JSON.stringify({ autoMerge: true, autoPush: true, openPr: "draft" }, null, 2)}\n`,
    );
    // A project with an integration base: only the draft pull request is a clash.
    expect(
      clashesOf(resolveWorkflow(paths, { worktrees: { base: "integration" } }), "integration"),
    ).toEqual([DRAFT_WITH_MERGE]);
    // The same settings with no base: autoMerge has no branch it may merge into.
    expect(clashesOf(resolveWorkflow(paths, null), null)).toEqual([
      MERGE_WITHOUT_BASE,
      DRAFT_WITH_MERGE,
    ]);
  });
});
