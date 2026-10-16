import { describe, expect, test } from "bun:test";
import { openUrlCandidates, openUrlOnDesktop } from "./open-url";

const URL = "http://127.0.0.1:27655/abc";

describe("opening a URL on the person's desktop", () => {
  test("Windows: cmd.exe's own start, with the empty title it takes first", () => {
    expect(openUrlCandidates("win32", URL)).toEqual([["cmd.exe", "/c", "start", "", URL]]);
    // The program is named in full: a bare `cmd` is not a file name on Windows.
    expect(openUrlCandidates("win32", URL)[0][0]).toBe("cmd.exe");
  });

  test("macOS: open", () => {
    expect(openUrlCandidates("darwin", URL)).toEqual([["open", URL]]);
  });

  test("Linux: xdg-open, then gio open", () => {
    expect(openUrlCandidates("linux", URL)).toEqual([
      ["xdg-open", URL],
      ["gio", "open", URL],
    ]);
  });

  test("the first program the machine has is the one that runs", () => {
    const started: string[][] = [];
    const program = openUrlOnDesktop("linux", URL, {
      which: (name) => (name === "gio" ? "/usr/bin/gio" : null),
      spawn: (argv) => {
        started.push(argv);
      },
    });
    expect(program).toBe("gio");
    expect(started).toEqual([["gio", "open", URL]]);
  });

  test("Windows starts cmd.exe, which is always there", () => {
    const started: string[][] = [];
    const program = openUrlOnDesktop("win32", URL, {
      which: (name) => (name === "cmd.exe" ? "C:\\Windows\\System32\\cmd.exe" : null),
      spawn: (argv) => {
        started.push(argv);
      },
    });
    expect(program).toBe("cmd.exe");
    expect(started).toEqual([["cmd.exe", "/c", "start", "", URL]]);
  });

  test("a program that cannot start: the next candidate is tried", () => {
    const tried: string[] = [];
    const program = openUrlOnDesktop("linux", URL, {
      which: () => "/usr/bin/whatever",
      spawn: (argv) => {
        tried.push(argv[0] ?? "");
        if (argv[0] === "xdg-open") throw new Error("no desktop");
      },
    });
    expect(program).toBe("gio");
    expect(tried).toEqual(["xdg-open", "gio"]);
  });

  test("nothing to open it with: null, and never a throw", () => {
    const started: string[][] = [];
    const program = openUrlOnDesktop("linux", URL, {
      which: () => null,
      spawn: (argv) => {
        started.push(argv);
      },
    });
    expect(program).toBeNull();
    expect(started).toEqual([]);
  });
});
