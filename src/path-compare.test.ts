import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join, win32 } from "node:path";
import {
  isInside,
  isInsideOnDisk,
  isStrictlyInside,
  sameFolderOnDisk,
  samePath,
} from "./path-compare";
import { tempDir } from "./testing/temp";

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

describe("isInsideOnDisk and sameFolderOnDisk: one folder, two spellings", () => {
  // On Windows a folder can be spelled with an 8.3 short name and with its long one; here a link
  // gives the same folder a second spelling the text test cannot see through.
  function world() {
    const base = tempDir("path-on-disk");
    const real = join(base, "real");
    mkdirSync(join(real, "src", "deep"), { recursive: true });
    const alias = join(base, "alias");
    symlinkSync(real, alias, "dir");
    const other = join(base, "other");
    mkdirSync(other);
    return { alias, other, real };
  }

  test("a folder under the other spelling is inside; the text test alone says no", () => {
    const { alias, real } = world();
    expect(isInside(join(alias, "src", "deep"), real)).toBe(false);
    expect(isInsideOnDisk(join(alias, "src", "deep"), real)).toBe(true);
    expect(isInsideOnDisk(alias, real)).toBe(true);
  });

  test("a folder elsewhere is not inside; a folder that does not exist compares by text", () => {
    const { other, real } = world();
    expect(isInsideOnDisk(other, real)).toBe(false);
    expect(isInsideOnDisk(join(real, "src"), join(other, "missing"))).toBe(false);
    expect(isInsideOnDisk(join(real, "missing", "x"), real)).toBe(true);
  });

  test("the same folder under two spellings is the same; a folder and its child are not", () => {
    const { alias, other, real } = world();
    expect(sameFolderOnDisk(alias, real)).toBe(true);
    expect(sameFolderOnDisk(join(alias, "src"), join(real, "src"))).toBe(true);
    expect(sameFolderOnDisk(join(alias, "src"), real)).toBe(false);
    expect(sameFolderOnDisk(other, real)).toBe(false);
    expect(sameFolderOnDisk(join(real, "missing"), join(other, "missing"))).toBe(false);
  });
});
