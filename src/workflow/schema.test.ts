/** The slop audit cadence setting: its default, what a file and a typed value may hold. */
import { describe, expect, test } from "bun:test";
import {
  POLICY_KEYS,
  parseWorkflowValue,
  setWorkflowValue,
  workflowDefaults,
  workflowSchema,
  workflowValue,
} from "./schema";

describe("slopAudit.everyPlans", () => {
  test("it defaults to every 5 plans and is one of the policy keys", () => {
    expect(workflowDefaults.slopAudit.everyPlans).toBe(5);
    expect(POLICY_KEYS).toContain("slopAudit.everyPlans");
  });

  test("a file may hold a whole number from 0, and nothing else in the group", () => {
    expect(workflowSchema.parse({ slopAudit: { everyPlans: 0 } })).toEqual({
      slopAudit: { everyPlans: 0 },
    });
    expect(workflowSchema.parse({})).toEqual({});
    for (const bad of [-1, 2.5, "3", null]) {
      expect(workflowSchema.safeParse({ slopAudit: { everyPlans: bad } }).success).toBe(false);
    }
    expect(workflowSchema.safeParse({ slopAudit: { often: 1 } }).success).toBe(false);
  });

  test("a typed value is digits, 0 turns the cadence off, and the refusal says the rule", () => {
    expect(parseWorkflowValue("slopAudit.everyPlans", "0")).toEqual({ ok: true, value: 0 });
    expect(parseWorkflowValue("slopAudit.everyPlans", " 12 ")).toEqual({ ok: true, value: 12 });
    for (const bad of ["-1", "1.5", "often", ""]) {
      expect(parseWorkflowValue("slopAudit.everyPlans", bad)).toEqual({
        ok: false,
        why: "slopAudit.everyPlans is a whole number, 0 or more",
      });
    }
  });

  test("it reads and writes as a group field", () => {
    const set = setWorkflowValue({}, "slopAudit.everyPlans", 3);
    expect(set).toEqual({ slopAudit: { everyPlans: 3 } });
    expect(workflowValue(set, "slopAudit.everyPlans")).toBe(3);
  });
});
