import { describe, expect, test } from "bun:test";
import { beginRun, ownsProgress } from "./action-runs";

describe("whose progress line a running action's line is", () => {
  test("a lone run of an action owns the action's lines", () => {
    const end = beginRun("project.gateway.profile");
    expect(ownsProgress("project.gateway.profile")).toBe(true);
    end();
  });

  test("two runs of the same action at once: a line could be either one's, so neither shows it", () => {
    const first = beginRun("project.gateway.profile");
    const second = beginRun("project.gateway.profile");
    expect(ownsProgress("project.gateway.profile")).toBe(false);
    first();
    expect(ownsProgress("project.gateway.profile")).toBe(true);
    second();
  });

  test("another action's run does not share the line", () => {
    const one = beginRun("slot.save");
    const other = beginRun("slot.test");
    expect(ownsProgress("slot.save")).toBe(true);
    expect(ownsProgress("slot.test")).toBe(true);
    one();
    other();
  });

  test("ending a run twice counts once, so a late result cannot free another run's place", () => {
    const first = beginRun("slot.mode");
    const second = beginRun("slot.mode");
    first();
    first();
    // `second` is still running, alone: it owns the lines.
    expect(ownsProgress("slot.mode")).toBe(true);
    const third = beginRun("slot.mode");
    expect(ownsProgress("slot.mode")).toBe(false);
    second();
    third();
  });
});
