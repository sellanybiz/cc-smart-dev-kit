import { describe, expect, test } from "bun:test";
import {
  CREW_PAGE_REFRESH,
  CREW_REFRESH,
  GATEWAY_CARD_REFRESH,
  PROJECT_REFRESH,
  TASKS_REFRESH,
  WORKFLOW_CARD_REFRESH,
} from "./refresh";
import type { LiveMessage } from "./stream";

const crewEvent = { name: "crew", data: { kind: "step" } } as unknown as LiveMessage;
const tasksEvent: LiveMessage = { name: "tasks", data: { at: 1 } };
const resultOf = (action: string): LiveMessage =>
  ({ name: "action", data: { action, lines: [], ok: true } }) as unknown as LiveMessage;
const lineOf = (action: string): LiveMessage =>
  ({ name: "action", data: { action, line: "working" } }) as unknown as LiveMessage;
const asFunction = (on: typeof PROJECT_REFRESH) => {
  if (typeof on !== "function") throw new Error("these refreshes are functions");
  return on;
};

describe("a project's cards read again only for what changes them", () => {
  test("the project page follows a crew event: its branch verdicts depend on one", () => {
    expect(asFunction(PROJECT_REFRESH)(crewEvent)).toBe(true);
    expect(asFunction(PROJECT_REFRESH)(resultOf("crew.stop"))).toBe(true);
  });

  test("the Workflow card ignores a crew event: the committed policy does not change with one", () => {
    const refresh = asFunction(WORKFLOW_CARD_REFRESH);
    expect(refresh(crewEvent)).toBe(false);
    expect(refresh(resultOf("crew.stop"))).toBe(false);
    // What does change it: a project action's or a workflow setting's result.
    expect(refresh(resultOf("project.workflow.propose"))).toBe(true);
    expect(refresh(resultOf("workflow.set"))).toBe(true);
    // A progress line is not a result.
    expect(refresh(lineOf("project.workflow.propose"))).toBe(false);
  });

  test("the Gateway card ignores a crew event, and follows the actions that change a gateway", () => {
    const refresh = asFunction(GATEWAY_CARD_REFRESH);
    expect(refresh(crewEvent)).toBe(false);
    expect(refresh(resultOf("crew.stop"))).toBe(false);
    expect(refresh(resultOf("project.gateway.set"))).toBe(true);
    expect(refresh(resultOf("project.gateway.profile"))).toBe(true);
    expect(refresh(resultOf("slot.save"))).toBe(true);
    expect(refresh(resultOf("switch"))).toBe(true);
    expect(refresh(lineOf("project.gateway.set"))).toBe(false);
  });

  test("the Tasks tab follows the work store, a crew session and a project result", () => {
    const refresh = asFunction(TASKS_REFRESH);
    expect(refresh(tasksEvent)).toBe(true);
    expect(refresh(crewEvent)).toBe(true);
    expect(refresh(resultOf("crew.rm"))).toBe(true);
    expect(refresh(resultOf("project.write"))).toBe(true);
    // A slot change or a progress line changes no task.
    expect(refresh(resultOf("slot.save"))).toBe(false);
    expect(refresh(lineOf("crew.rm"))).toBe(false);
  });
});

describe("Work and a crew page", () => {
  test("a crew page reads its phase's subtasks again when the work store changes; Work does not", () => {
    expect(asFunction(CREW_PAGE_REFRESH)(tasksEvent)).toBe(true);
    expect(asFunction(CREW_PAGE_REFRESH)(crewEvent)).toBe(true);
    expect(asFunction(CREW_REFRESH)(tasksEvent)).toBe(false);
    expect(asFunction(CREW_REFRESH)(crewEvent)).toBe(true);
  });
});
