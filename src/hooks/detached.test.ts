/**
 * Starting a program that must outlive the process that starts it (`detached.ts`): the argv
 * each system gets — Linux and macOS unchanged, Windows behind the `cmd /c start` trampoline
 * (oven-sh/bun#31603) with every argument quoted for cmd.exe — that the program really
 * starts, and that a program which will not start is one line, never a throw.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { cmdArgument, detachedArgv, startDetached, windowsRun, windowsStart } from "./detached";

/** Waits for `check` to say yes, up to `timeoutMs`; false when it never does. */
async function until(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(20);
  return check();
}

describe("detachedArgv", () => {
  test("Linux and macOS keep the argv unchanged", () => {
    const argv = ["/home/u/.bun/bin/bun", "/p/dist/update-check.js", "--background"];
    expect(detachedArgv("linux", argv)).toEqual(argv);
    expect(detachedArgv("darwin", argv)).toEqual(argv);
  });

  test("Windows: cmd, the switches, and one command line with every argument quoted", () => {
    const argv = [
      "C:\\Users\\u\\.bun\\bin\\bun.exe",
      "--no-env-file",
      "C:\\p\\dist\\update-check.js",
      "--background",
    ];
    expect(detachedArgv("win32", argv)).toEqual([
      "cmd",
      "/d",
      "/s",
      "/v:off",
      "/c",
      String.raw`"start "" /b "C:\Users\u\.bun\bin\bun.exe" "--no-env-file" "C:\p\dist\update-check.js" "--background""`,
    ]);
  });

  test("the line cmd.exe reads once the spawner joins it: one quoted word per argument", () => {
    // A path with a space, a folder with a `&`, a `^`, a `!` and parentheses: cmd.exe reads
    // none of them as its own, because each argument is one quoted word. `/s` strips exactly
    // the outer pair, and what is left is `start "" /b …`.
    const argv = ["C:\\Program Files\\Bun & Co\\bun.exe", "--flag=(x)", "C:\\a^b\\!run"];
    expect(detachedArgv("win32", argv).join(" ")).toBe(
      String.raw`cmd /d /s /v:off /c "start "" /b "C:\Program Files\Bun & Co\bun.exe" "--flag=(x)" "C:\a^b\!run""`,
    );
  });

  test("a run of backslashes at the end of an argument is doubled", () => {
    // The program's own reader (the C runtime) takes `\"` as a quote: without the doubling,
    // a path ending in `\` would lose the quote that closes it.
    expect(cmdArgument("C:\\dir\\")).toEqual({ ok: true, text: String.raw`"C:\dir\\"` });
    expect(cmdArgument("plain")).toEqual({ ok: true, text: '"plain"' });
    expect(cmdArgument("")).toEqual({ ok: true, text: '""' });
  });

  test("an argument cmd.exe has no way to carry: no argv at all, and the reason", () => {
    const cases: Array<[string, string]> = [
      ["C:\\a%b\\bun.exe", "a % is read as a variable name, inside double quotes too"],
      ['C:\\a"b', 'a " would end the quoted argument'],
      ["C:\\a\nb\\x.exe", "a line break ends the command line"],
    ];
    for (const [argument, reason] of cases) {
      expect(cmdArgument(argument)).toEqual({ ok: false, reason });
      expect(windowsStart([argument])).toEqual({ argument, ok: false, reason });
      expect(detachedArgv("win32", [argument])).toEqual([]);
    }
    expect(windowsStart([])).toEqual({
      argument: "",
      ok: false,
      reason: "there is no program to start",
    });
  });

  test("windowsRun: the same quoting, with no start trampoline: cmd waits for the .cmd", () => {
    const argv = ["C:\\Program Files\\nodejs\\claude.cmd", "--bg", "-w", "crew-K-x", "do it; now"];
    expect(windowsRun(argv)).toEqual({
      argv: [
        "cmd",
        "/d",
        "/s",
        "/v:off",
        "/c",
        String.raw`""C:\Program Files\nodejs\claude.cmd" "--bg" "-w" "crew-K-x" "do it; now""`,
      ],
      ok: true,
    });
    expect(windowsRun(["C:\\a%b\\claude.cmd"])).toEqual({
      argument: "C:\\a%b\\claude.cmd",
      ok: false,
      reason: "a % is read as a variable name, inside double quotes too",
    });
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
    expect(errors[0]).toContain("cmd");
  });

  test("Windows: an argument cmd.exe cannot carry is one line, and nothing runs", () => {
    const errors: string[] = [];
    startDetached("win32", ["C:\\Users\\100%\\bun.exe", "--background"], {
      onError: (message) => errors.push(message),
    });
    expect(errors).toEqual([
      // The refusal, not a spawn that failed: `cmd` is not started at all.
      'cannot run "C:\\Users\\100%\\bun.exe" through cmd.exe: a % is read as a variable name, inside double quotes too; nothing was started',
    ]);
  });

  test("Windows: the refusal stays one line when the argument holds a line break", () => {
    const errors: string[] = [];
    startDetached("win32", ["C:\\a\nb\\x.exe"], {
      onError: (message) => errors.push(message),
    });
    expect(errors).toEqual([
      'cannot run "C:\\a b\\x.exe" through cmd.exe: a line break ends the command line; nothing was started',
    ]);
  });
});
