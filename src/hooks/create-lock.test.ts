/**
 * The lock one worktree creation holds (`create-lock.ts`): a second create of the same
 * branch at the same time is refused, one whose process is gone is taken over, and the file
 * is removed when the body ends, whether it succeeded or threw.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tempDir } from "../testing/temp";
import { CreateBusyError, createLockFile, withCreateLock } from "./create-lock";

/** A git dir to put the lock in. */
const gitDir = () => tempDir("common-git-dir");

/** A lock file as another process would leave it. */
function held(commonDir: string, branch: string, pid: number): string {
  const file = createLockFile(commonDir, branch);
  writeFileSync(
    file,
    JSON.stringify({
      pid,
      startTime: null,
      session: "s",
      startedAt: "2026-01-01T00:00:00.000Z",
      token: "theirs",
    }),
  );
  return file;
}

/** A pid no process has. */
function deadPid(): number {
  for (let pid = 999_999; pid > 100_000; pid--) {
    try {
      process.kill(pid, 0);
    } catch {
      return pid;
    }
  }
  throw new Error("no free pid");
}

describe("withCreateLock", () => {
  test("a second create of the same branch is refused while the first holds it", () => {
    const dir = gitDir();
    const refused = withCreateLock(dir, "fix/x", "session-a", () => {
      let ran = false;
      try {
        withCreateLock(dir, "fix/x", "session-b", () => {
          ran = true;
        });
      } catch (error) {
        expect(error).toBeInstanceOf(CreateBusyError);
        const file = createLockFile(dir, "fix/x");
        expect((error as Error).message).toBe(
          `another cc-smart-dev-kit process (pid ${process.pid}, session session-a, started ${JSON.parse(readFileSync(file, "utf8")).startedAt}) ` +
            `is making the worktree for this branch right now. Wait for it, then ask again; if that process is gone, remove ${file}.`,
        );
      }
      return ran;
    });
    expect(refused).toBe(false);
  });

  test("another branch is not blocked by it", () => {
    const dir = gitDir();
    const both = withCreateLock(dir, "fix/x", null, () =>
      withCreateLock(dir, "fix/y", null, () => "both ran"),
    );
    expect(both).toBe("both ran");
  });

  test("the file goes when the body ends, and when it throws", () => {
    const dir = gitDir();
    const file = createLockFile(dir, "fix/x");
    expect(withCreateLock(dir, "fix/x", null, () => existsSync(file))).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(() =>
      withCreateLock(dir, "fix/x", null, () => {
        throw new Error("the create failed");
      }),
    ).toThrow("the create failed");
    expect(existsSync(file)).toBe(false);
    // And the lock can be taken again.
    expect(withCreateLock(dir, "fix/x", null, () => "again")).toBe("again");
  });

  test("a lock whose process is gone is taken over", () => {
    const dir = gitDir();
    const file = held(dir, "fix/x", deadPid());
    expect(withCreateLock(dir, "fix/x", null, () => "ran")).toBe("ran");
    expect(existsSync(file)).toBe(false);
  });

  test("a lock file that cannot be read is refused, not taken over", () => {
    const dir = gitDir();
    writeFileSync(createLockFile(dir, "fix/x"), "{ half written");
    expect(() => withCreateLock(dir, "fix/x", null, () => "ran")).toThrow(CreateBusyError);
  });

  test("the file name is a hash: a branch name cannot escape the git dir", () => {
    const file = createLockFile("/repo/.git", "../../etc/passwd");
    expect(dirname(file)).toBe("/repo/.git");
    expect(file).toMatch(/\/cc-smart-dev-kit-create-[0-9a-f]{16}\.lock$/);
    expect(createLockFile("/repo/.git", "fix/x")).not.toBe(createLockFile("/repo/.git", "fix/y"));
  });
});
