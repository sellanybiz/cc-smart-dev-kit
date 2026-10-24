import { describe, expect, test } from "bun:test";
import { appliedEdit, shownDraft } from "./applied-edit";

describe("a form after Apply: what it shows until the page's answer is read again", () => {
  const OLD = { state: "default" };
  const NEW = { state: "off" };
  const fromAnswer = (answer: { state: string }) => ({ ...answer });

  test("no edit shows the answer", () => {
    expect(shownDraft(null, OLD, fromAnswer)).toEqual({ state: "default" });
  });

  test("an edit being typed shows the edit, whatever the answer", () => {
    expect(shownDraft({ applied: false, draft: NEW }, OLD, fromAnswer)).toEqual(NEW);
  });

  test("an applied edit keeps showing what was applied while the answer is the old one", () => {
    const edit = appliedEdit({ applied: false, draft: NEW }, OLD);
    expect(shownDraft(edit, OLD, fromAnswer)).toEqual(NEW);
  });

  test("once a new answer is read, the form shows it and not the applied edit", () => {
    const edit = appliedEdit({ applied: false, draft: NEW }, OLD);
    const read = { state: "off" };
    expect(shownDraft(edit, read, fromAnswer)).toEqual({ state: "off" });
    // A different answer than the edit's (the command wrote something else): the answer wins.
    expect(shownDraft(edit, { state: "on" }, fromAnswer)).toEqual({ state: "on" });
  });

  test("nothing applied when there was no edit", () => {
    expect(appliedEdit(null, OLD)).toBeNull();
  });
});
