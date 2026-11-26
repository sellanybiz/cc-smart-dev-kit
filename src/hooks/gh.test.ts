import { describe, expect, spyOn, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { cleanGitEnv, tempDir } from "../testing/temp";
import { type GhCall, ghMissing, ghSpawnOptions, runGhSync } from "./gh";

describe("the options every gh call starts with", () => {
  test("no console window on Windows, piped streams, the call's time limit and folder", () => {
    expect(ghSpawnOptions({ env: { PATH: "/bin" }, folder: "/repo", timeoutMs: 1_234 })).toEqual({
      cwd: "/repo",
      env: { PATH: "/bin" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 1_234,
      windowsHide: true,
    });
  });

  test("no folder: gh runs where the process runs, so no cwd is set", () => {
    expect(ghSpawnOptions({ env: {}, timeoutMs: 1_000 })).not.toHaveProperty("cwd");
  });

  test("runGhSync spawns gh with them, and no stdin", () => {
    const spawned = spyOn(Bun, "spawnSync");
    try {
      const call = {
        env: { PATH: tempDir("no-gh") },
        folder: tempDir("gh-folder"),
        timeoutMs: 500,
      };
      runGhSync(["alias", "list"], call);
      expect(spawned.mock.calls).toEqual([
        [["gh", "alias", "list"], { ...ghSpawnOptions(call), stdin: "ignore" }],
      ]);
    } finally {
      spawned.mockRestore();
    }
  });
});

describe.skipIf(process.platform === "win32")("runGhSync: how a gh call ended", () => {
  /** A call to a fake `gh` that runs `script`, with the system's own basics on PATH. */
  function call(script: string, timeoutMs = 5_000): GhCall {
    const bin = tempDir("gh-sync-bin");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const env = { ...cleanGitEnv(), PATH: `${bin}${delimiter}/usr/bin${delimiter}/bin` };
    return { env, folder: tempDir("gh-sync-folder"), timeoutMs };
  }

  test("exit 0 is ok, with stdout as gh printed it and stderr trimmed", () => {
    expect(runGhSync(["pr", "view"], call('echo "  [1]  "; echo " note " >&2'))).toEqual({
      code: 0,
      err: "note",
      kind: "ok",
      out: "  [1]  \n",
    });
  });

  test("another exit is failed, and names no signal", () => {
    expect(runGhSync(["pr", "view"], call('echo "no pull request" >&2; exit 1'))).toEqual({
      code: 1,
      err: "no pull request",
      kind: "failed",
      out: "",
    });
  });

  test("the time running out is a timeout; another signal is gh dying", () => {
    expect(runGhSync(["pr", "view"], call("exec sleep 30", 300))).toMatchObject({
      code: null,
      kind: "timeout",
      signal: "SIGTERM",
    });
    expect(runGhSync(["pr", "view"], call("kill -9 $$"))).toMatchObject({
      code: null,
      kind: "failed",
      signal: "SIGKILL",
    });
  });

  test("no gh on PATH is missing; a spawn that failed for another reason is not", () => {
    const none = { env: { PATH: tempDir("no-gh") }, folder: tempDir("gh-sync-folder") };
    expect(ghMissing(none.env)).toBe(true);
    expect(runGhSync(["pr", "view"], { ...none, timeoutMs: 1_000 })).toMatchObject({
      code: null,
      kind: "missing",
      out: "",
    });
    const gone = { ...call("exit 0"), folder: join(tempDir("gh-sync-gone"), "gone") };
    expect(ghMissing(gone.env)).toBe(false);
    const notStarted = runGhSync(["pr", "view"], gone);
    expect(notStarted).toMatchObject({ code: null, kind: "failed", out: "" });
    expect(notStarted.signal).toBeUndefined();
  });
});
