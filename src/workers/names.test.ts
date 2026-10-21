/**
 * The names of lead and worker sessions (D26), and the clean session name every session's
 * title goes through (moved here from `src/hooks/session-name.ts`).
 */
import { describe, expect, test } from "bun:test";
import {
  cleanSessionName,
  isNameTag,
  isPhase,
  leadName,
  NAME_VIEW,
  roleOf,
  withoutListRef,
  workerName,
  workerTag,
} from "./names";

describe("cleanSessionName", () => {
  test.each([
    ["Fix the login page", "Fix the login page"],
    ["  two\tspaces  \nsecond line", "two spaces"],
    ["\u001b]0;evil\u0007title", "]0;evil title"],
    ["\u009bx", "x"],
    ["   ", null],
    ["x".repeat(70), "x".repeat(60)],
  ])("cleanSessionName(%j) is %j", (raw, expected) => {
    expect(cleanSessionName(raw)).toBe(expected);
  });

  test("never splits an emoji at the cut", () => {
    expect(cleanSessionName(`${"a".repeat(59)}😀😀`)).toBe(`${"a".repeat(59)}😀`);
  });
});

describe("D26: the names", () => {
  test("D26: a lead is LEAD <tag> <plan>", () => {
    expect(leadName("my-app", "master-plan")).toBe("LEAD my-app master-plan");
  });

  test("D26: a worker is W <tag> <phase> <slug>; a hand-off's next worker adds 2, 3", () => {
    expect(workerName("my-app", "W1a", "launcher")).toBe("W my-app W1a launcher");
    expect(workerName("my-app", "W1a", "launcher", 1)).toBe("W my-app W1a launcher");
    expect(workerName("my-app", "W1a", "launcher", 2)).toBe("W my-app W1a launcher 2");
    expect(workerName("my-app", "W1a", "launcher", 3)).toBe("W my-app W1a launcher 3");
  });

  test("D26: ASCII only, no brackets or quotes, never a trailing ]", () => {
    expect(workerName("my-app", "K", 'fix "the" [login] page]')).toBe(
      "W my-app K fix-the-login-page",
    );
    expect(leadName("Ünïcödé app", "plan [v2]")).toBe("LEAD Unicode-app plan-v2");
    expect(workerName("my-app", "K", "it's done']")).toBe("W my-app K it-s-done");
  });

  test("D26: the tag is the main checkout's folder name, or workflow.workers.tag", () => {
    expect(workerTag("/home/user/my-app", undefined)).toBe("my-app");
    expect(workerTag("/home/user/my-app/", null)).toBe("my-app");
    expect(workerTag("/home/user/My App ü", undefined)).toBe("My-App-u");
    expect(workerTag("/home/user/my-app", "kit")).toBe("kit");
    expect(workerTag("/home/user/a-very-long-folder-name-here", undefined)).toBe("a-very-long");
  });

  test("D26: a folder name that leaves no tag asks for workflow.workers.tag", () => {
    expect(() => workerTag("/home/user/日本", undefined)).toThrow(
      '"日本" leaves no tag for a lead\'s or a worker\'s name: set workflow.workers.tag (1-12 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--")',
    );
  });

  test("D26: truncation at 24 and at 60 keeps role and phase", () => {
    const worker = workerName(
      "a-very-long-folder-name-here",
      "D17b",
      "the-review-that-counts-for-its-fix-commits-after-it",
    );
    expect(worker).toBe("W a-very-long D17b the-review-that-counts-for-its-fix-commit");
    expect(worker.length).toBe(60);
    expect(cleanSessionName(worker)).toBe(worker);
    expect(worker.slice(0, NAME_VIEW)).toBe("W a-very-long D17b the-r");
    expect(roleOf(worker.slice(0, NAME_VIEW))).toBe("worker");

    const next = workerName(
      "a-very-long-folder-name-here",
      "D17b",
      "the-review-that-counts-for-its-fix-commits-after-it",
      2,
    );
    expect(next).toBe("W a-very-long D17b the-review-that-counts-for-its-fix-comm 2");
    expect(cleanSessionName(next)).toBe(next);

    const lead = leadName(
      "a-very-long-folder-name-here",
      "the master plan for the safety and workers release of the kit",
    );
    // The 43 characters left end on the "-" after "workers", which a cut never keeps.
    expect(lead).toBe("LEAD a-very-long the-master-plan-for-the-safety-and-workers");
    expect(lead.length).toBe(59);
    expect(lead.slice(0, NAME_VIEW)).toBe("LEAD a-very-long the-mas");
    expect(roleOf(lead.slice(0, NAME_VIEW))).toBe("lead");
  });

  test("D26: a cut never leaves a separator at the end", () => {
    // 60 - "W my-app K ".length = 49: the 49th character of the slug is a "-".
    const name = workerName("my-app", "K", `${"a".repeat(48)}-tail`);
    expect(name).toBe(`W my-app K ${"a".repeat(48)}`);
  });

  test("D26: a phase is short and clean, or the name is refused", () => {
    expect(isPhase("W1a")).toBe(true);
    expect(isPhase("L1a.1")).toBe(true);
    expect(isPhase("E1a-E1b")).toBe(true);
    for (const bad of ["", "W 1a", "D17a-D17b", "-K", "K]", "Kü", "a--b"]) {
      expect(isPhase(bad)).toBe(false);
    }
    expect(() => workerName("my-app", "W 1a", "launcher")).toThrow(
      'the phase "W 1a" cannot be part of a name: a phase is 1-8 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"',
    );
  });

  test("D26: an empty part, or a hand-off number that is not 2 or more, is refused", () => {
    expect(() => workerName("my-app", "K", "!!!")).toThrow(
      'the slug "!!!" has no letter or digit a name can keep',
    );
    expect(() => leadName("my-app", "[]")).toThrow(
      'the plan "[]" has no letter or digit a name can keep',
    );
    expect(() => leadName("日本", "plan")).toThrow(
      'the tag "日本" has no letter or digit a name can keep',
    );
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => workerName("my-app", "K", "x", bad)).toThrow(
        `a hand-off number is a whole number of 2 or more, not ${bad}`,
      );
    }
  });

  test("D26: a tag in workflow.workers.tag must already be clean", () => {
    expect(isNameTag("my-app")).toBe(true);
    expect(isNameTag("kit.v2")).toBe(true);
    for (const bad of ["", "My App", "a--b", "-x", "x-", "x".repeat(13), "ü", "x]"]) {
      expect(isNameTag(bad)).toBe(false);
    }
  });
});

describe("D26: roleOf", () => {
  test("D26: a lead and a worker, a hand-off's next worker too", () => {
    expect(roleOf("LEAD my-app master-plan")).toBe("lead");
    expect(roleOf("W my-app W1a launcher")).toBe("worker");
    expect(roleOf("W my-app W1a launcher 2")).toBe("worker");
  });

  test("D26: a person's own name has no role", () => {
    for (const name of [
      "Fix the login page",
      "LEADER board",
      "LEAD",
      "W",
      "Wrap up",
      "w my-app K x",
      "lead my-app plan",
      "W my-app K x 2 more",
      "",
    ]) {
      expect(`${name}: ${roleOf(name)}`).toBe(`${name}: null`);
    }
  });

  test("D26: a name ending in ]: ListAgents' [ref] is read past, any other ] is not ours", () => {
    expect(roleOf("W my-app K contracts [3f2a]")).toBe("worker");
    expect(roleOf("LEAD my-app master-plan [a1]")).toBe("lead");
    expect(roleOf("W my-app K contracts]")).toBeNull();
    expect(roleOf("LEAD my-app plan]")).toBeNull();
  });

  test("withoutListRef drops the [ref] ListAgents prints after a name, and nothing else", () => {
    expect(withoutListRef("W my-app K x [ref]")).toBe("W my-app K x");
    expect(withoutListRef("  my session  ")).toBe("my session");
    expect(withoutListRef("a [b] c")).toBe("a [b] c");
  });
});
