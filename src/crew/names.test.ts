/**
 * The names of lead and crew sessions (D26), and the clean session name every session's
 * title goes through (moved here from `src/hooks/session-name.ts`).
 */
import { describe, expect, test } from "bun:test";
import {
  cleanSessionName,
  crewName,
  crewTag,
  isNameTag,
  isPhase,
  isSlug,
  leadName,
  NAME_VIEW,
  roleOf,
  SLUG_RULE,
  withoutListRef,
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

  test("D26: a crew session is C <tag> <plan> <phase> <slug>; a hand-off's next adds 2, 3", () => {
    expect(crewName("my-app", "master-plan", "W1a", "launcher")).toBe(
      "C my-app master-plan W1a launcher",
    );
    expect(crewName("my-app", "master-plan", "W1a", "launcher", 1)).toBe(
      "C my-app master-plan W1a launcher",
    );
    expect(crewName("my-app", "master-plan", "W1a", "launcher", 2)).toBe(
      "C my-app master-plan W1a launcher 2",
    );
    expect(crewName("my-app", "master-plan", "W1a", "launcher", 3)).toBe(
      "C my-app master-plan W1a launcher 3",
    );
  });

  test("D26: a long plan is cut, the phase stays whole, the hand-off number stays", () => {
    // The plan "the-master-plan-for-the-whole-release" is cut at MAX_CREW_PLAN (16), and the
    // cut leaves "the-master-plan-" with its separator dropped. The head is then
    // "C my-app the-master-plan B6b " (29 characters), which leaves 29 for the slug and 2 for
    // the hand-off number: the slug is cut, the number and the phase are not.
    const name = crewName(
      "my-app",
      "the-master-plan-for-the-whole-release",
      "B6b",
      "portal-live-and-the-review-that-follows",
      2,
    );
    expect(name).toBe("C my-app the-master-plan B6b portal-live-and-the-review-th 2");
    expect(name.length).toBe(60);
    expect(name.endsWith(" 2")).toBe(true);
    expect(name).toContain(" B6b ");
    // Two crew sessions of one phase never share a name, however the slug is cut.
    expect(
      crewName(
        "my-app",
        "the-master-plan-for-the-whole-release",
        "B6b",
        "portal-live-and-the-review-that-follows",
        3,
      ),
    ).not.toBe(name);
  });

  test("D26: ASCII only, no brackets or quotes, never a trailing ]", () => {
    expect(crewName("my-app", "plan", "K", 'fix "the" [login] page]')).toBe(
      "C my-app plan K fix-the-login-page",
    );
    expect(leadName("Ünïcödé app", "plan [v2]")).toBe("LEAD Unicode-app plan-v2");
    expect(crewName("my-app", "plan", "K", "it's done']")).toBe("C my-app plan K it-s-done");
  });

  test("D26: the tag is the main checkout's folder name, or workflow.crew.tag", () => {
    expect(crewTag("/home/user/my-app", undefined)).toBe("my-app");
    expect(crewTag("/home/user/my-app/", null)).toBe("my-app");
    expect(crewTag("/home/user/My App ü", undefined)).toBe("My-App-u");
    expect(crewTag("/home/user/my-app", "kit")).toBe("kit");
    expect(crewTag("/home/user/a-very-long-folder-name-here", undefined)).toBe("a-very-long");
  });

  test("D26: a folder name that leaves no tag asks for workflow.crew.tag", () => {
    expect(() => crewTag("/home/user/日本", undefined)).toThrow(
      '"日本" leaves no tag for a lead\'s or a crew session\'s name: set workflow.crew.tag (1-12 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--")',
    );
  });

  test("D26: truncation at 24 and at 60 keeps the role, and the tag and plan after it", () => {
    const crew = crewName(
      "a-very-long-folder-name-here",
      "master-plan",
      "D17b",
      "the-review-that-counts-for-its-fix-commits-after-it",
    );
    expect(crew).toBe("C a-very-long master-plan D17b the-review-that-counts-for-it");
    expect(crew.length).toBe(60);
    expect(cleanSessionName(crew)).toBe(crew);
    expect(crew.slice(0, NAME_VIEW)).toBe("C a-very-long master-pla");
    expect(roleOf(crew.slice(0, NAME_VIEW))).toBe("crew");

    const next = crewName(
      "a-very-long-folder-name-here",
      "master-plan",
      "D17b",
      "the-review-that-counts-for-its-fix-commits-after-it",
      2,
    );
    expect(next).toBe("C a-very-long master-plan D17b the-review-that-counts-for 2");
    expect(cleanSessionName(next)).toBe(next);

    const lead = leadName(
      "a-very-long-folder-name-here",
      "the master plan for the safety of our crew release of the kit",
    );
    // The 43 characters left end on the "-" after "crew", which a cut never keeps.
    expect(lead).toBe("LEAD a-very-long the-master-plan-for-the-safety-of-our-crew");
    expect(lead.length).toBe(59);
    expect(lead.slice(0, NAME_VIEW)).toBe("LEAD a-very-long the-mas");
    expect(roleOf(lead.slice(0, NAME_VIEW))).toBe("lead");
  });

  test("D26: a cut never leaves a separator at the end", () => {
    // 60 - "C my-app plan K ".length = 44: the slug's 44th character is the "-" after 43 a's.
    const name = crewName("my-app", "plan", "K", `${"a".repeat(43)}-tail`);
    expect(name).toBe(`C my-app plan K ${"a".repeat(43)}`);
  });

  test("D26: a phase is short and clean, or the name is refused", () => {
    expect(isPhase("W1a")).toBe(true);
    expect(isPhase("L1a.1")).toBe(true);
    expect(isPhase("E1a-E1b")).toBe(true);
    for (const bad of ["", "W 1a", "D17a-D17b", "-K", "K]", "Kü", "a--b"]) {
      expect(isPhase(bad)).toBe(false);
    }
    expect(() => crewName("my-app", "plan", "W 1a", "launcher")).toThrow(
      'the phase "W 1a" cannot be part of a name: a phase is 1-8 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"',
    );
  });

  test("D26: an empty part, or a hand-off number that is not 2 or more, is refused", () => {
    expect(() => crewName("my-app", "plan", "K", "!!!")).toThrow(
      'the slug "!!!" has no letter or digit a name can keep',
    );
    expect(() => crewName("my-app", "[]", "K", "x")).toThrow(
      'the plan "[]" has no letter or digit a name can keep',
    );
    expect(() => leadName("my-app", "[]")).toThrow(
      'the plan "[]" has no letter or digit a name can keep',
    );
    expect(() => leadName("日本", "plan")).toThrow(
      'the tag "日本" has no letter or digit a name can keep',
    );
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => crewName("my-app", "plan", "K", "x", bad)).toThrow(
        `a hand-off number is a whole number of 2 or more, not ${bad}`,
      );
    }
  });

  test("D26: a slug is clean and at most 32 characters, or crew start refuses it", () => {
    expect(isSlug("portal-live")).toBe(true);
    expect(isSlug("v1.2_fix")).toBe(true);
    expect(isSlug("x".repeat(32))).toBe(true);
    for (const bad of ["", "portal live", "a--b", "-x", "x-", "x".repeat(33), "ü", "x]"]) {
      expect(isSlug(bad)).toBe(false);
    }
    expect(SLUG_RULE).toBe(
      '1-32 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"',
    );
  });

  test("D26: a tag in workflow.crew.tag must already be clean", () => {
    expect(isNameTag("my-app")).toBe(true);
    expect(isNameTag("kit.v2")).toBe(true);
    for (const bad of ["", "My App", "a--b", "-x", "x-", "x".repeat(13), "ü", "x]"]) {
      expect(isNameTag(bad)).toBe(false);
    }
  });
});

describe("D26: roleOf", () => {
  test("D26: a lead and a crew session, a hand-off's next crew session too", () => {
    expect(roleOf("LEAD my-app master-plan")).toBe("lead");
    expect(roleOf("C my-app master-plan W1a launcher")).toBe("crew");
    expect(roleOf("C my-app master-plan W1a launcher 2")).toBe("crew");
  });

  test("1.1.2: a crew name written before the plan became part of it is still crew", () => {
    // Crew records written by 1.1.1 and earlier keep `C <tag> <phase> <slug>`: records are
    // never renamed, so every reader must read both shapes.
    expect(roleOf("C my-app W1a launcher")).toBe("crew");
    expect(roleOf("C my-app W1a launcher 2")).toBe("crew");
    expect(roleOf("C my-app W1a")).toBe("crew");
    // A name cut short by a narrow list, in either shape, still starts as one of ours.
    expect(roleOf("C my-app master-plan")).toBe("crew");
    expect(roleOf("C my-app master-plan W1a")).toBe("crew");
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
      "C my-app K x 2 more",
      "",
    ]) {
      expect(`${name}: ${roleOf(name)}`).toBe(`${name}: null`);
    }
  });

  test("D26: a name ending in ]: ListAgents' [ref] is read past, any other ] is not ours", () => {
    expect(roleOf("C my-app K contracts [3f2a]")).toBe("crew");
    expect(roleOf("LEAD my-app master-plan [a1]")).toBe("lead");
    expect(roleOf("C my-app K contracts]")).toBeNull();
    expect(roleOf("LEAD my-app plan]")).toBeNull();
  });

  test("withoutListRef drops the [ref] ListAgents prints after a name, and nothing else", () => {
    expect(withoutListRef("C my-app K x [ref]")).toBe("C my-app K x");
    expect(withoutListRef("  my session  ")).toBe("my session");
    expect(withoutListRef("a [b] c")).toBe("a [b] c");
  });
});
