/**
 * A folder only its owner can read (`ensurePrivateDir`): what it makes, and what it says when an
 * existing folder is shared.
 *
 * Off Windows the mode decides, and a shared folder is tightened with one line saying so. On
 * Windows the mode says nothing (a folder reports 0o40777 there whatever its ACL says), so the
 * profile's ACL is trusted: nothing is tightened and nothing is said — a "made it yours only
 * (700)" line there would claim a change that changed nothing.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { ensurePrivateDir } from "./private-dir";

/** Windows makes the modes up: these assertions need POSIX. */
const NO_POSIX_MODES = process.platform === "win32";

/** A temp folder to work in, and the lines `ensurePrivateDir` said. */
function said(): { lines: string[]; say: (line: string) => void } {
  const lines: string[] = [];
  return { lines, say: (line: string) => lines.push(line) };
}

describe("ensurePrivateDir", () => {
  test("a folder that is not there: made, and nothing is said", () => {
    const dir = join(tempDir("private-dir"), "output");
    const { lines, say } = said();
    ensurePrivateDir(dir, say, "linux");
    expect(existsSync(dir)).toBe(true);
    expect(lines).toEqual([]);
  });

  test.skipIf(NO_POSIX_MODES)("the folder it makes is 0700", () => {
    const dir = join(tempDir("private-dir"), "output");
    ensurePrivateDir(dir, () => undefined, "linux");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  test.skipIf(NO_POSIX_MODES)(
    "a folder others can read: tightened to 0700, with one line saying so",
    () => {
      const dir = join(tempDir("private-dir"), "output");
      mkdirSync(dir, { recursive: true });
      chmodSync(dir, 0o755);
      const { lines, say } = said();
      ensurePrivateDir(dir, say, "linux");
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(lines).toEqual([
        `${dir} was readable by other users (mode 755): made it yours only (700)`,
      ]);
    },
  );

  test("on Windows a shared-looking folder is left alone, and nothing is said", () => {
    // 0o755 is what a folder looks like on Windows too (0o40777, or 0o40755 read-only), whatever
    // its ACL says, so the bits cannot decide there: the profile's ACL is what protects it.
    const dir = join(tempDir("private-dir"), "output");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    const before = statSync(dir).mode;
    const { lines, say } = said();
    ensurePrivateDir(dir, say, "win32");
    expect(lines).toEqual([]);
    expect(statSync(dir).mode).toBe(before);
    // The same folder off Windows is tightened: the Windows answer is what left it alone, not a
    // check that stopped working.
    ensurePrivateDir(dir, say, "linux");
    expect(lines.join("\n")).toContain("was readable by other users");
  });
});
