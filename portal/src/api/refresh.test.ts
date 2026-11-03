import { expect, test } from "bun:test";
import type { RefreshOn } from "./hooks";
import {
  GATEWAY_CARD_REFRESH,
  NEEDS_REFRESH,
  OVERVIEW_REFRESH,
  PROJECT_REFRESH,
  TASKS_REFRESH,
  WORK_REFRESH,
  WORKFLOW_CARD_REFRESH,
  WORKTREES_REFRESH,
} from "./refresh";
import type { LiveMessage } from "./stream";

function refresh(on: RefreshOn, event: LiveMessage): boolean {
  return typeof on === "function" ? on(event) : on.includes(event.name);
}
const result = (action: string): LiveMessage => ({
  name: "action",
  data: { action, lines: [], ok: true },
});

test("task writes refresh tasks without refreshing unrelated project cards", () => {
  const event: LiveMessage = { name: "tasks", data: { at: 1 } };
  expect(refresh(TASKS_REFRESH, event)).toBe(true);
  for (const on of [PROJECT_REFRESH, WORKFLOW_CARD_REFRESH, GATEWAY_CARD_REFRESH]) {
    expect(refresh(on, event)).toBe(false);
  }
});

test("project results refresh project cards and task files", () => {
  for (const on of [PROJECT_REFRESH, WORKFLOW_CARD_REFRESH, GATEWAY_CARD_REFRESH, TASKS_REFRESH]) {
    expect(refresh(on, result("project.write"))).toBe(true);
  }
  expect(refresh(GATEWAY_CARD_REFRESH, result("slot.save"))).toBe(true);
  expect(refresh(WORKFLOW_CARD_REFRESH, result("slot.save"))).toBe(false);
});

test("session and worktree results refresh only their resources", () => {
  expect(refresh(WORK_REFRESH, result("sessions.rm"))).toBe(true);
  expect(refresh(WORKTREES_REFRESH, result("worktrees.clean"))).toBe(true);
  expect(refresh(OVERVIEW_REFRESH, result("sessions.rm"))).toBe(false);
  expect(refresh(NEEDS_REFRESH, { name: "doctor", data: null })).toBe(true);
});
