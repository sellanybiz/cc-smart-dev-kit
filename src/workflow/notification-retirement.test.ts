import { expect, test } from "bun:test";
import { personalWorkflowSchema, WORKFLOW_KEYS, workflowSchema } from "./schema";

test("retired notification keys are discarded while status-line usage remains", () => {
  const alerts = { events: ["finished"], sound: true, usagePercent: 91 };
  expect(workflowSchema.parse({ alerts })).toEqual({ alerts: { usagePercent: 91 } });
  expect(personalWorkflowSchema.parse({ alerts })).toEqual({ alerts: { usagePercent: 91 } });
  expect(WORKFLOW_KEYS).not.toContain("alerts.events");
  expect(WORKFLOW_KEYS).not.toContain("alerts.sound");
  expect(workflowSchema.safeParse({ alerts: { other: true } }).success).toBe(false);
});
