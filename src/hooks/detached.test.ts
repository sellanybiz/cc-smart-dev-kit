/**
 * Starting a program that must outlive the process that starts it (`detached.ts`): the argv
 * each system gets — Linux and macOS unchanged, Windows behind the `cmd /c start`
 * trampoline (oven-sh/bun#31603) — that the program really starts, and that a program that
 * will not start is one line, never a throw.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { detachedArgv, startDetached } from "./detached";

/** Waits for `check` to say yes, up to `timeoutMs`; false when it never does. */
async function until(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(20);
  return check();
}

describe("detachedArgv", () => {
  test("Linux and macOS keep the argv; Windows gets the cmd /c start trampoline", () => {
    const argv = ["/home/u/.bun/bin/bun", "/p/dist/update-check.js", "--background"];
    expect(detachedArgv("linux", argv)).toEqual(argv);
    expect(detachedArgv("darwin", argv)).toEqual(argv);
    expect(
      detachedArgv("win32", [
        "C:\\Users\\u\\.bun\\bin\\bun.exe",
        "--no-env-file",
        "C:\\dist\\update-check.js",
        "--background",
      ]),
    ).toEqual([
      "cmd",
      "/c",
      "start",
      "",
      "/b",
      "C:\\Users\\u\\.bun\\bin\\bun.exe",
      "--no-env-file",
      "C:\\dist\\update-check.js",
      "--background",
    ]);
  });
});

describe("startDetached", () => {
  test("Linux: the program runs, and starting it reports nothing", async () => {
    const dir = tempDir("detached");
    const marker = join(dir, "ran");
    const errors: string[] = [];
    startDetached(
      "linux",
      [process.execPath, "-e", `await Bun.write(${JSON.stringify(marker)}, "ran")`],
      { onError: (message) => errors.push(message) },
    );
    expect(await until(() => existsSync(marker))).toBe(true);
    expect(readFileSync(marker, "utf8")).toBe("ran");
    expect(errors).toEqual([]);
  });

  test("Linux: a program that is not there is one line, never a throw", async () => {
    const errors: string[] = [];
    startDetached("linux", ["/no/such/program/here"], {
      onError: (message) => errors.push(message),
    });
    expect(await until(() => errors.length > 0)).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("/no/such/program/here");
  });

  test("Windows: a program that will not start is one line, never a throw", () => {
    const errors: string[] = [];
    // The trampoline's `cmd` is not here (this test is not on Windows), so the start fails
    // the way a missing program fails there: one line through `onError`.
    startDetached("win32", ["definitely-not-a-program"], {
      onError: (message) => errors.push(message),
    });
    expect(errors).toHaveLength(1);
  });
});
