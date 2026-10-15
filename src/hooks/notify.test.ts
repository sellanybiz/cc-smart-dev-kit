/**
 * The notifier hook (`notify.ts`): one desktop notification per event, through the machine's
 * own notifier — and silence inside Warp, on an idle wait, and with no notifier at all.
 * The fake notifier is a small script on PATH that logs its call, as the tests here run the
 * entry as a subprocess too.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { isWarp, type NotifyDeps, noticeFor, notifyHook } from "./notify";

const ENTRY = join(import.meta.dir, "..", "entries", "notify.ts");

/** A fake `notify-send` first on PATH; each call is logged, so the test asserts it exactly. */
function machine(
  notifiers: string[] = ["notify-send"],
  env: Record<string, string> = {},
): { env: Record<string, string>; log: () => string[] } {
  const home = tempDir("notify");
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const logFile = join(home, "notify.log");
  for (const name of notifiers) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${logFile}'\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const read = () =>
    readFileSync(logFile, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  return {
    env: { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, PATH: bin, TERM: "xterm", ...env },
    log: read,
  };
}

/** The hook, as Claude Code runs it: the JSON on stdin. */
function run(
  input: unknown,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const guard = subprocessGuard();
  const result = Bun.spawnSync([process.execPath, ...guard.args, ENTRY], {
    env: { ...env, ...guard.env },
    stdin: Buffer.from(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("what is notified", () => {
  test("a permission prompt: one notify-send, the message as the body", async () => {
    const { env, log } = machine();
    const result = run(
      {
        hook_event_name: "Notification",
        message: "Claude needs your permission to use Bash",
        notification_type: "permission_prompt",
        title: "Claude Code",
      },
      env,
    );
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    await Bun.sleep(300); // the notifier starts detached from the hook
    expect(log()).toEqual(["notify-send Claude Code Claude needs your permission to use Bash"]);
  });

  test("the turn's end: one notification with fixed, neutral words", () => {
    const { env } = machine();
    const seen: string[][] = [];
    const deps: NotifyDeps = {
      env,
      platform: "linux",
      run: (argv) => seen.push(argv),
      which: (command) => (command === "notify-send" ? "/usr/bin/notify-send" : null),
    };
    expect(notifyHook({ hook_event_name: "Stop" }, "Stop", deps)).toEqual({});
    expect(seen).toEqual([["/usr/bin/notify-send", "Claude Code", "Claude finished its turn."]]);
  });

  test("an idle wait is not notified: the finished turn already told the person", () => {
    expect(
      noticeFor(
        {
          hook_event_name: "Notification",
          message: "Claude is waiting",
          notification_type: "idle_prompt",
        },
        "Notification",
        {},
      ),
    ).toBeNull();
  });

  test("inside Warp: nothing (Warp's own plugin notifies), for either event", () => {
    const env = { TERM_PROGRAM: "WarpTerminal" };
    expect(isWarp(env)).toBe(true);
    expect(noticeFor({ hook_event_name: "Stop" }, "Stop", env)).toBeNull();
    expect(
      noticeFor({ message: "x", notification_type: "permission_prompt" }, "Notification", env),
    ).toBeNull();
    const seen: string[][] = [];
    const result = notifyHook({ hook_event_name: "Stop" }, "Stop", {
      env,
      platform: "linux",
      run: (argv) => seen.push(argv),
      which: () => "/usr/bin/notify-send",
    });
    expect(result).toEqual({});
    expect(seen).toEqual([]);
  });

  test("with no notifier on PATH: silent, and a quiet session", () => {
    const seen: string[][] = [];
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const result = notifyHook({ hook_event_name: "Stop" }, "Stop", {
        env: {},
        platform,
        run: (argv) => seen.push(argv),
        which: () => null,
      });
      expect(result).toEqual({});
    }
    expect(seen).toEqual([]);
  });

  test("macOS: osascript, with the words in the script", () => {
    const seen: string[][] = [];
    notifyHook({ hook_event_name: "Stop" }, "Stop", {
      env: {},
      platform: "darwin",
      run: (argv) => seen.push(argv),
      which: (command) => (command === "osascript" ? "/usr/bin/osascript" : null),
    });
    expect(seen).toEqual([
      [
        "/usr/bin/osascript",
        "-e",
        'display notification "Claude finished its turn." with title "Claude Code"',
      ],
    ]);
  });

  test("another event, another notification type, or no JSON: nothing", () => {
    expect(noticeFor({ hook_event_name: "SessionStart" }, "SessionStart", {})).toBeNull();
    expect(
      noticeFor({ message: "m", notification_type: "auth_success" }, "Notification", {}),
    ).toBeNull();
    expect(noticeFor(null, "Notification", {})).toBeNull();
    expect(noticeFor({ message: "m" }, "Notification", {})).toBeNull();
  });

  test("a long message is one line, capped; a missing one gets the type's own words", () => {
    const long = noticeFor(
      { message: `${"a".repeat(300)}\nmore`, notification_type: "agent_needs_input" },
      "Notification",
      {},
    );
    expect(long?.body).toEndWith("…");
    expect(long?.body.length).toBe(180);
    expect(long?.body).not.toContain("\n");
    expect(noticeFor({ notification_type: "permission_prompt" }, "Notification", {})?.body).toBe(
      "Claude is waiting for your permission.",
    );
  });

  test("the entry with no notifier on PATH shows nothing and stays quiet", () => {
    const home = tempDir("notify-empty");
    const result = run(
      { hook_event_name: "Stop" },
      { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, PATH: home, TERM: "xterm" },
    );
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("the entry with input that is not JSON: one line, exit 0", () => {
    const guard = subprocessGuard();
    const home = tempDir("notify-bad");
    const result = Bun.spawnSync([process.execPath, ...guard.args, ENTRY], {
      env: { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, PATH: home, ...guard.env },
      stdin: Buffer.from("not json"),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("anymodel notify: the hook input is not JSON\n");
  });
});
