import { expect, test } from "bun:test";
import { taskCloseStep, taskDropStep } from "./words";

test("a work task and a deploy task close and drop through the kit's tools", () => {
  for (const ref of ["#12", "prod-20261117-144503"]) {
    expect(taskCloseStep(ref)).toContain(`\`task_done\` with task "${ref}" and evidence`);
    expect(taskDropStep(ref)).toContain(`\`task_done\` with task "${ref}", outcome "dropped"`);
  }
  // Anything else is a task on Claude Code's own list.
  expect(taskCloseStep("3")).toBe('`TaskUpdate` with status "completed"');
});
