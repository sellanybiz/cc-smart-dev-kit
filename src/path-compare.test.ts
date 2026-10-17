import { describe, expect, test } from "bun:test";
import { win32 } from "node:path";
import { isInside, isStrictlyInside, samePath } from "./path-compare";

describe("isInside: the one path test", () => {
  test("a folder, a file in it, a sibling with the same start, and `..`", () => {
    expect(isInside("/home/user/app", "/home/user/app", false)).toBe(true);
    expect(isInside("/home/user/app/src/x.ts", "/home/user/app", false)).toBe(true);
    expect(isInside("/home/user/app-wt-x", "/home/user/app", false)).toBe(false);
    expect(isInside("/home/user/app/../app-wt-x", "/home/user/app", false)).toBe(false);
    expect(isInside("/home/user/app/", "/home/user/app", false)).toBe(true);
  });

  test("ST-6: a Windows path, written with `\\`, is inside its Windows folder", () => {
    // What `realpathSync` gives on Windows: backslashes all the way. The old test
    // (`file.startsWith(`${root}/`)`) never matched it.
    const root = win32.join("C:\\Users\\me\\.claude", "cc-smart-dev-kit", "instructions");
    const file = win32.join(root, "core.md");
    expect(file.startsWith(`${root}/`)).toBe(false);
    expect(isInside(file, root, true)).toBe(true);
    expect(isInside(win32.join(root, "optin", "worktrees.md"), root, true)).toBe(true);
    // Windows compares folder names without case; `..` is resolved there too.
    expect(
      isInside("c:\\users\\ME\\.claude\\cc-smart-dev-kit\\instructions\\core.md", root, true),
    ).toBe(true);
    expect(isInside(`${root}\\..\\instructions-old\\core.md`, root, true)).toBe(false);
    expect(isInside(`${root}-old\\core.md`, root, true)).toBe(false);
    // Case counts where the host's folders are case-sensitive.
    expect(
      isInside("C:\\USERS\\me\\.claude\\cc-smart-dev-kit\\instructions\\core.md", root, false),
    ).toBe(false);
  });

  test("samePath and isStrictlyInside", () => {
    expect(samePath("C:\\Users\\me\\x\\", "c:\\users\\me\\X", true)).toBe(true);
    expect(isStrictlyInside("/state/a/b", "/state", false)).toBe(true);
    expect(isStrictlyInside("/state", "/state", false)).toBe(false);
    expect(isStrictlyInside("C:\\state\\a", "C:\\state", true)).toBe(true);
    expect(isStrictlyInside("/elsewhere/a", "/state", false)).toBe(false);
  });
});
