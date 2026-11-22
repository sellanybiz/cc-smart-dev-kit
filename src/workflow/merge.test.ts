import { describe, expect, test } from "bun:test";
import type { CcSmartDevKitConfig } from "../project/config";
import { jobRouteFrom, leadHintFrom, mergeWorkflows, type WorkflowSource } from "./merge";
import * as resolved from "./resolve";
import type { PersonalWorkflow, Workflow } from "./schema";

/**
 * The merge is the one home of these decisions, and `resolve.ts` re-exports it. Each table row is
 * written by hand from the order in `resolve.ts`'s header (the project over the person over the
 * default), not computed by the code under test.
 */

const withRoute = (route: boolean): CcSmartDevKitConfig => ({ jobs: { route } });

describe("jobRouteFrom: the project's jobs.route, else the person's default, else off", () => {
  const table: [string, PersonalWorkflow, CcSmartDevKitConfig | null, boolean, WorkflowSource][] = [
    ["nothing set", {}, null, false, "default"],
    ["a project file with no jobs", {}, {}, false, "default"],
    ["the person turns it on", { switches: { jobRoute: true } }, null, true, "personal"],
    ["the person turns it off", { switches: { jobRoute: false } }, null, false, "personal"],
    ["the project turns it on", {}, withRoute(true), true, "project"],
    [
      "the project beats the person's on",
      { switches: { jobRoute: true } },
      withRoute(false),
      false,
      "project",
    ],
    [
      "the project beats the person's off",
      { switches: { jobRoute: false } },
      withRoute(true),
      true,
      "project",
    ],
    [
      "a project with no route leaves the person's",
      { switches: { jobRoute: true } },
      { jobs: {} },
      true,
      "personal",
    ],
  ];
  for (const [name, personal, project, value, source] of table) {
    test(name, () => expect(jobRouteFrom(personal, project)).toEqual({ value, source }));
  }
});

describe("leadHintFrom: the person's value, else on", () => {
  test("nothing set is on, from the default", () => {
    expect(leadHintFrom({})).toEqual({ value: true, source: "default" });
  });
  test("the person turns it off", () => {
    expect(leadHintFrom({ switches: { leadHint: false } })).toEqual({
      value: false,
      source: "personal",
    });
  });
  test("a person's jobRoute leaves the hint on", () => {
    expect(leadHintFrom({ switches: { jobRoute: true } })).toEqual({
      value: true,
      source: "default",
    });
  });
});

describe("mergeWorkflows: the project's fields over the person's, a group's fields too", () => {
  test("a field only the person sets stays", () => {
    const personal: Workflow = { allowCommit: true, mergeMethod: "squash" };
    expect(mergeWorkflows(personal, { allowPush: true })).toEqual({
      allowCommit: true,
      mergeMethod: "squash",
      allowPush: true,
    });
  });
  test("the project wins a field both set", () => {
    expect(mergeWorkflows({ mergeMethod: "squash" }, { mergeMethod: "rebase" })).toEqual({
      mergeMethod: "rebase",
    });
  });
  test("a group merges field by field", () => {
    const personal: Workflow = {
      fixesAfterReview: { lines: 5, files: 2 },
      issues: { enabled: false },
      alerts: { usagePercent: 70 },
      plans: { maxPhases: 4 },
    };
    const project: Workflow = {
      fixesAfterReview: { files: 9 },
      issues: { foundLabel: "found" },
      plans: { maxPhases: 6 },
    };
    expect(mergeWorkflows(personal, project)).toEqual({
      fixesAfterReview: { lines: 5, files: 9 },
      issues: { enabled: false, foundLabel: "found" },
      alerts: { usagePercent: 70 },
      plans: { maxPhases: 6 },
    });
  });
  test("two empty objects stay empty, with no group invented", () => {
    expect(mergeWorkflows({}, {})).toEqual({});
  });
});

describe("resolve.ts keeps these names importable from the merge's one home", () => {
  test("the same functions", () => {
    expect(resolved.jobRouteFrom).toBe(jobRouteFrom);
    expect(resolved.leadHintFrom).toBe(leadHintFrom);
  });
});
