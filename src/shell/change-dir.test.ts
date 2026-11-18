/** Where a `cd` goes, as the git guard, the main-folder guard and the session-escape guard read it. */
import { describe, expect, test } from "bun:test";
import { FolderTracker, movedTo, shellTargetPath } from "./change-dir";
import { shellSteps } from "./command";

describe("movedTo on Windows: Git Bash names the drive C: as /c", () => {
  const win = { platform: "win32" as const };

  test("/c alone is the drive's root, /c/x a folder on it", () => {
    expect(shellTargetPath("/c", "win32")).toBe("C:/");
    expect(shellTargetPath("/c/", "win32")).toBe("C:/");
    expect(movedTo("cd", "D:\\work", ["/c"], win)).toBe("C:\\");
    expect(movedTo("cd", "D:\\work", ["/c/Users/me"], win)).toBe("C:\\Users\\me");
    expect(movedTo("cd", "D:\\work", ["sub"], win)).toBe("D:\\work\\sub");
  });

  test("a longer first folder is no drive, and PowerShell has no such names", () => {
    expect(shellTargetPath("/config/x", "win32")).toBe("/config/x");
    expect(shellTargetPath("/c", "win32", "powershell")).toBe("/c");
    expect(shellTargetPath("/c", "linux")).toBe("/c");
  });

  test("a folder the shell works out when the line runs cannot be followed", () => {
    expect(movedTo("cd", "/code/app", ["$DIR"])).toBeNull();
    expect(movedTo("cd", "/code/app", ["wt*"])).toBeNull();
    expect(movedTo("cd", "/code/app", ["~/x"])).toBeNull();
    expect(movedTo("popd", "/code/app", [])).toBeNull();
  });
});

describe("FolderTracker: a cd inside a group ends at its close", () => {
  /** The folder each command of `line` runs in, from `/code/app` (the empty pieces left out). */
  function folders(line: string): [string, string | null][] {
    const tracker = new FolderTracker("/code/app");
    return shellSteps(line).flatMap((step): [string, string | null][] => {
      const folder = tracker.enter(step.subshell);
      const words = step.text.trim().split(/\s+/);
      if (words[0] === "cd") tracker.moveTo(movedTo("cd", folder, words.slice(1)));
      return step.text.trim() === "" ? [] : [[step.text.trim(), folder]];
    });
  }

  test("groups side by side each start where the line is", () => {
    expect(folders("(cd /tmp); (touch b); touch c")).toEqual([
      ["cd /tmp", "/code/app"],
      ["touch b", "/code/app"],
      ["touch c", "/code/app"],
    ]);
  });

  test("a group inside a group starts where its group is, and gives it back", () => {
    expect(folders("(cd /tmp; (cd /var; touch a); touch b); touch c")).toEqual([
      ["cd /tmp", "/code/app"],
      ["cd /var", "/tmp"],
      ["touch a", "/var"],
      ["touch b", "/tmp"],
      ["touch c", "/code/app"],
    ]);
  });
});
