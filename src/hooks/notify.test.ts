/**
 * The notifier hook (`notify.ts`): one alert per event, on the route that fits the machine —
 * the desktop's own notifier, the SSH terminal as OSC 777 — and silence where an alert
 * belongs to someone else (Warp's plugin), is a repeat (a question's permission prompt, a
 * turn another session started, the same error twice), or has nowhere to go.
 *
 * The fake notifier is a small script on PATH that logs its call, as the tests here run the
 * entry as a subprocess too. The mark and failed files go into the temp folder the `HOME`
 * points at (`XDG_RUNTIME_DIR`), never the real one.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import {
  ASK_MARK_MS,
  isSsh,
  isWarpTerminal,
  type NotifyDeps,
  notifyHook,
  notifySequence,
  readNotifyConfig,
  runtimeDir,
  terminalRoute,
  versionAtLeast,
  WAIT_END_EVENTS,
  warpPluginOn,
  warpShowsIt,
} from "./notify";

const ENTRY = join(import.meta.dir, "..", "entries", "notify.ts");
const ROOT = join(import.meta.dir, "..", "..");

/** The hooks.json entry for the notify bundle: which events and matchers wire it. */
function wiredNotify(): Array<{ event: string; matcher: null | string; args: string[] }> {
  const file = JSON.parse(readFileSync(join(ROOT, "plugin", "hooks", "hooks.json"), "utf8")) as {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ args: string[] }> }>>;
  };
  const wired: Array<{ event: string; matcher: null | string; args: string[] }> = [];
  for (const [event, groups] of Object.entries(file.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        if (handler.args[1]?.endsWith("/dist/notify.js") === true) {
          wired.push({ event, matcher: group.matcher ?? null, args: handler.args });
        }
      }
    }
  }
  return wired;
}

/** A machine for the hook: a temp HOME, fake programs on PATH, both state files' folder. */
function machine(env: Record<string, string> = {}, programs: string[] = ["notify-send", "paplay"]) {
  const home = tempDir("notify");
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  for (const name of programs) {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\necho "${name} $*" >> '${join(home, "notify.log")}'\n`,
    );
    chmodSync(join(bin, name), 0o755);
  }
  const runtime = join(home, "run");
  mkdirSync(runtime, { recursive: true });
  const full = {
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DISPLAY: ":0",
    HOME: home,
    PATH: bin,
    TERM: "xterm",
    XDG_RUNTIME_DIR: runtime,
    ...env,
  };
  return { bin, env: full, home, runtime };
}

/** The settings file the routes read: `~/.claude/cc-smart-dev-kit/notify.json`. */
function writeConfig(env: Record<string, string>, config: unknown): void {
  const file = cliPaths(env).notifyConfigFile;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(config));
}

/** Warp's own plugin, on and installed, in the Claude config folder this env names. */
function warpPlugin(env: Record<string, string>): void {
  const paths = cliPaths(env);
  mkdirSync(paths.claudeConfigDir, { recursive: true });
  writeFileSync(
    paths.settingsFile,
    JSON.stringify({ enabledPlugins: { "warp@claude-code-warp": true } }),
  );
  mkdirSync(join(paths.claudeConfigDir, "plugins"), { recursive: true });
  writeFileSync(
    paths.installedPluginsFile,
    JSON.stringify({ plugins: { "warp@claude-code-warp": [{ version: "2.4.0" }] } }),
  );
}

/** The hook with recording deps: `runs` are the detached programs, `tty` the sequences. */
function setup(
  env: Record<string, string>,
  overrides: Partial<NotifyDeps> = {},
): { deps: NotifyDeps; runs: string[][]; tty: string[] } {
  const runs: string[][] = [];
  const tty: string[] = [];
  const deps: NotifyDeps = {
    env,
    nowMs: Date.now(),
    paths: cliPaths(env),
    platform: "linux",
    run: (argv) => runs.push(argv),
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
    writeTerminal: (sequence) => {
      tty.push(sequence);
      return true;
    },
    ...overrides,
  };
  return { deps, runs, tty };
}

/** A transcript, one JSON entry per line, written where the hook reads it. */
function transcript(lines: Array<Record<string, unknown>>, home: string): string {
  const file = join(home, "session.jsonl");
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
}

function stopInput(home: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd: join(home, "rel-ssh"),
    hook_event_name: "Stop",
    session_id: "11111111-2222-3333-4444-555555555555",
    ...extra,
  };
}

/** The entry, as Claude Code runs it: the JSON on stdin, the environment as given. */
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

describe("what is notified, and with which words", () => {
  test("a permission prompt: notify-send, the session's name in the title, urgent, with the sound", () => {
    const { bin, env } = machine();
    const { deps, runs } = setup(env);
    expect(
      notifyHook(
        {
          cwd: join(env.HOME, "rel-ssh"),
          hook_event_name: "Notification",
          message: "Claude needs your permission to use Bash",
          notification_type: "permission_prompt",
          session_id: "11111111-2222-3333-4444-555555555555",
        },
        "Notification",
        deps,
      ),
    ).toEqual({});
    expect(runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-login.oga"],
      [
        join(bin, "notify-send"),
        "--urgency=critical",
        "Claude needs you · rel-ssh",
        "Claude needs your permission to use Bash",
      ],
    ]);
  });

  test("the turn's end: the last answer as the body, the session's name, no urgency, the other sound", () => {
    const { bin, env, home } = machine();
    const file = transcript(
      [
        { message: { content: [{ text: "an older answer", type: "text" }] }, type: "assistant" },
        {
          message: { content: [{ text: "I finished the work.", type: "text" }] },
          type: "assistant",
        },
      ],
      home,
    );
    const { deps, runs } = setup(env);
    notifyHook(stopInput(home, { transcript_path: file }), "Stop", deps);
    expect(runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-logout.oga"],
      [join(bin, "notify-send"), "Claude finished · rel-ssh", "I finished the work."],
    ]);
  });

  test("a session named with /rename carries that name, over its folder", () => {
    const { env, home } = machine();
    const file = transcript(
      [
        { customTitle: "the ssh alerts", type: "user" },
        { message: { content: [{ text: "done", type: "text" }] }, type: "assistant" },
      ],
      home,
    );
    const { deps, runs } = setup(env);
    notifyHook(stopInput(home, { transcript_path: file }), "Stop", deps);
    expect(runs[1]?.[1]).toBe("Claude finished · the ssh alerts");
  });

  test("a stop hook that made Claude continue fires Stop again: one alert", () => {
    const { env, home } = machine();
    const { deps, runs } = setup(env);
    notifyHook(stopInput(home, { stop_hook_active: true }), "Stop", deps);
    expect(runs).toEqual([]);
  });

  test("a turn another session started: nothing; a human prompt into it, or a helper agent: the alert", () => {
    const { env, home } = machine();
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{ type: "user", turnOrigin: "peer" }, false],
      [{ origin: { senderTaskId: null }, turnOrigin: "peer" }, false], // no senderTaskId: a peer
      [{ origin: { senderTaskId: "abc" }, turnOrigin: "peer" }, true],
      [{ attachment: { humanTurn: true }, turnOrigin: "peer" }, true],
      [{ turnOrigin: "user" }, true],
      [{ isCompactSummary: true, turnOrigin: "peer" }, true], // passed over; nothing else found
    ];
    for (const [entry, alerts] of cases) {
      const file = transcript([entry], home);
      const { deps, runs } = setup(env);
      notifyHook(stopInput(home, { transcript_path: file }), "Stop", deps);
      expect(runs.length > 0).toBe(alerts);
    }
  });

  test("a question: the words, the mark, and the permission prompt beside it stays quiet", () => {
    const { bin, env } = machine();
    const first = setup(env);
    notifyHook(
      {
        cwd: join(env.HOME, "rel-ssh"),
        hook_event_name: "PreToolUse",
        session_id: "s-1",
        tool_input: { questions: [{ question: "Which branch?", type: "text" }] },
        tool_name: "AskUserQuestion",
      },
      "PreToolUse",
      first.deps,
    );
    expect(first.runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-login.oga"],
      [
        join(bin, "notify-send"),
        "--urgency=critical",
        "Claude asks you · rel-ssh",
        "Which branch?",
      ],
    ]);
    // The companion permission prompt (about six seconds later) is the same wait.
    const second = setup(env);
    notifyHook(
      {
        hook_event_name: "Notification",
        message: "Claude needs your permission to use AskUserQuestion",
        notification_type: "permission_prompt",
        session_id: "s-1",
      },
      "Notification",
      second.deps,
    );
    expect(second.runs).toEqual([]);
    // Answered (PostToolUse) or refused (PostToolUseFailure) or a new prompt: the mark goes.
    for (const event of WAIT_END_EVENTS) {
      const third = setup(env);
      notifyHook(
        { hook_event_name: event, session_id: "s-1", tool_name: "AskUserQuestion" },
        event,
        third.deps,
      );
      expect(third.runs).toEqual([]);
      const fourth = setup(env);
      notifyHook(
        {
          hook_event_name: "Notification",
          message: "Claude needs your permission",
          notification_type: "permission_prompt",
          session_id: "s-1",
        },
        "Notification",
        fourth.deps,
      );
      expect(fourth.runs.length).toBe(2);
      // Put the mark back for the next event of the loop.
      const again = setup(env);
      notifyHook(
        {
          hook_event_name: "PreToolUse",
          session_id: "s-1",
          tool_input: { question: "Which branch?" },
          tool_name: "AskUserQuestion",
        },
        "PreToolUse",
        again.deps,
      );
    }
  });

  test("a mark older than ten minutes does not hide a later permission prompt", () => {
    const { env, runtime } = machine();
    const mark = join(runtime, "cc-smart-dev-kit-notify-asked-s-2");
    writeFileSync(mark, "1\n");
    const old = new Date(Date.now() - ASK_MARK_MS - 60_000);
    utimesSync(mark, old, old);
    const { deps, runs } = setup(env);
    notifyHook(
      {
        hook_event_name: "Notification",
        message: "Claude needs your permission",
        notification_type: "permission_prompt",
        session_id: "s-2",
      },
      "Notification",
      deps,
    );
    expect(runs.length).toBe(2);
  });

  test("a plan for OK: its own words", () => {
    const { env } = machine();
    const { deps, runs } = setup(env);
    notifyHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "s-3",
        tool_input: { plan: "# the plan" },
        tool_name: "ExitPlanMode",
      },
      "PreToolUse",
      deps,
    );
    expect(runs[1]?.slice(1)).toEqual([
      "--urgency=critical",
      "Claude asks you",
      "A plan is ready for your OK",
    ]);
  });

  test("a stopped turn: the error text, once per error until a turn ends well", () => {
    const { bin, env } = machine();
    const input = {
      cwd: join(env.HOME, "rel-ssh"),
      error: "overloaded_error",
      hook_event_name: "StopFailure",
      last_assistant_message: "API Error: Overloaded",
      session_id: "s-4",
    };
    const first = setup(env);
    notifyHook(input, "StopFailure", first.deps);
    expect(first.runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/dialog-warning.oga"],
      [
        join(bin, "notify-send"),
        "--urgency=critical",
        "Claude stopped · rel-ssh",
        "API Error: Overloaded",
      ],
    ]);
    // The same error again: nothing (a limit makes every turn fail alike).
    const second = setup(env);
    notifyHook(input, "StopFailure", second.deps);
    expect(second.runs).toEqual([]);
    // Another error: the alert.
    const third = setup(env);
    notifyHook({ ...input, error: "authentication_error" }, "StopFailure", third.deps);
    expect(third.runs.length).toBe(2);
    // A turn that ends well clears the record: the same error alerts again.
    const fourth = setup(env);
    notifyHook(stopInput(env.HOME, { session_id: "s-4" }), "Stop", fourth.deps);
    const fifth = setup(env);
    notifyHook({ ...input, error: "authentication_error" }, "StopFailure", fifth.deps);
    expect(fifth.runs.length).toBe(2);
  });

  test("the usage limit is the StopFailure hook's alert: never two for one stop", () => {
    const { env } = machine();
    const { deps, runs } = setup(env);
    notifyHook(
      {
        error: "rate_limit",
        hook_event_name: "StopFailure",
        last_assistant_message: "You've hit your limit · resets 3pm",
        session_id: "s-5",
      },
      "StopFailure",
      deps,
    );
    expect(runs).toEqual([]);
  });

  test("an idle wait, another notification type, another event, or no JSON: nothing", () => {
    const { env } = machine();
    for (const [input, event] of [
      [{ notification_type: "idle_prompt" }, "Notification"],
      [{ message: "m", notification_type: "auth_success" }, "Notification"],
      [{ hook_event_name: "SessionStart" }, "SessionStart"],
      [{ hook_event_name: "Stop" }, "PostToolUse"],
      [null, "Stop"],
    ] as Array<[unknown, string]>) {
      const { deps, runs } = setup(env);
      expect(notifyHook(input, event, deps)).toEqual({});
      expect(runs).toEqual([]);
    }
  });

  test("not Claude Code in a terminal: nothing (the desktop app and the VS Code extension show their own)", () => {
    const { env, home } = machine({ CLAUDE_CODE_ENTRYPOINT: "sdk-cli" });
    const { deps, runs } = setup(env);
    notifyHook(stopInput(home), "Stop", deps);
    expect(runs).toEqual([]);
    const vs = setup(machine({ CLAUDE_CODE_ENTRYPOINT: "vscode" }).env);
    notifyHook(stopInput(home), "Stop", vs.deps);
    expect(vs.runs).toEqual([]);
  });

  test("a long or multi-line message is one line, controls gone, capped", () => {
    const { env } = machine();
    const { deps, runs } = setup(env);
    notifyHook(
      {
        hook_event_name: "Notification",
        message: `${"a".repeat(300)}\nmore\u0007\u001b]0;x`,
        notification_type: "agent_needs_input",
      },
      "Notification",
      deps,
    );
    const body = runs.at(-1)?.[3] ?? "";
    expect(body.length).toBe(180);
    expect(body).toEndWith("…");
    expect(body).not.toContain("\n");
    expect(body).not.toContain("\u001b");
    expect(body).not.toContain("\u0007");
  });
});

describe("Warp: its own plugin shows the alert, ours plays the sound", () => {
  test("TERM_PROGRAM, or the WARP_ pair a background session keeps", () => {
    expect(isWarpTerminal({ TERM_PROGRAM: "WarpTerminal" })).toBe(true);
    expect(
      isWarpTerminal({ WARP_CLI_AGENT_PROTOCOL_VERSION: "1", WARP_CLIENT_VERSION: "v1" }),
    ).toBe(true);
    expect(isWarpTerminal({ TERM_PROGRAM: "xterm-256color" })).toBe(false);
    expect(isWarpTerminal({ WARP_CLI_AGENT_PROTOCOL_VERSION: "1" })).toBe(false);
  });

  test("with the plugin on: sound only for what Warp shows, and ours for a question or a waiting agent", () => {
    const { bin, env } = machine({ TERM_PROGRAM: "WarpTerminal" });
    warpPlugin(env);
    expect(warpPluginOn(cliPaths(env).claudeConfigDir)).toBe(true);

    const stop = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", stop.deps);
    expect(stop.runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-logout.oga"],
    ]);

    const prompt = setup(env);
    notifyHook(
      { message: "Claude needs your permission", notification_type: "permission_prompt" },
      "Notification",
      prompt.deps,
    );
    expect(prompt.runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-login.oga"],
    ]);

    const waiting = setup(env);
    notifyHook(
      { message: "An agent is waiting", notification_type: "agent_needs_input", session_id: "w-1" },
      "Notification",
      waiting.deps,
    );
    expect(waiting.runs.length).toBe(2);
    expect(waiting.runs[1]?.[1]).toBe("--urgency=critical");

    expect(warpShowsIt("Stop", {})).toBe(true);
    expect(warpShowsIt("PreToolUse", { tool_name: "AskUserQuestion" })).toBe(true);
    expect(warpShowsIt("Notification", { notification_type: "agent_needs_input" })).toBe(false);
    expect(warpShowsIt("Notification", { notification_type: "elicitation_dialog" })).toBe(false);
  });

  test("without the plugin (or outside Warp): the normal alert", () => {
    const { env } = machine({ TERM_PROGRAM: "WarpTerminal" });
    const { deps, runs } = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs.length).toBe(2);
    expect(runs[1]?.[1]).not.toBe("--urgency=critical");
  });
});

describe("the SSH terminal route", () => {
  test("no DISPLAY, over SSH: OSC 777 through the hook's terminalSequence, and no desktop call", () => {
    const { env } = machine({
      CLAUDE_CODE_VERSION: "2.1.301 (Claude Code)",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000 10.0.0.1 22",
    });
    const { deps, runs, tty } = setup(env);
    const result = notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs).toEqual([]);
    expect(tty).toEqual([]);
    expect(result).toEqual({
      stdout:
        '{"terminalSequence":"\\u001b]777;notify;Claude finished · rel-ssh;Claude finished its turn.\\u0007"}',
    });
  });

  test("SSH_TTY alone counts; no SSH and no desktop: nothing", () => {
    expect(isSsh({ SSH_TTY: "/dev/pts/0" })).toBe(true);
    expect(isSsh({ DISPLAY: "" })).toBe(false);
    const { env } = machine({ DISPLAY: "", SSH_CONNECTION: "" });
    const { deps, runs, tty } = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs).toEqual([]);
    expect(tty).toEqual([]);
  });

  test("a DISPLAY over SSH is a desktop: the notifier shows it there", () => {
    const { env } = machine({ DISPLAY: "localhost:10.0", SSH_CONNECTION: "10.0.0.2 51000" });
    const { deps, runs, tty } = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs.length).toBe(2);
    expect(tty).toEqual([]);
  });

  test("inside tmux: the field carries the bare sequence (Claude Code wraps it itself); /dev/tty gets the wrapper", () => {
    // Claude Code writes the field to the session's terminal, wrapped for tmux itself, and
    // its allowlist drops a wrapped sequence (proved live on 2.1.301): ours must be bare.
    const { env, home } = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
      TMUX: "/tmp/tmux-1001/default,1234,0",
    });
    const { deps } = setup(env);
    expect(notifyHook(stopInput(home), "Stop", deps).stdout).toBe(
      '{"terminalSequence":"\\u001b]777;notify;Claude finished · rel-ssh;Claude finished its turn.\\u0007"}',
    );
    // An older Claude Code, whose hook writes /dev/tty itself: the wrapper is ours, once.
    const older = setup({ ...env, CLAUDE_CODE_VERSION: "2.1.140" });
    expect(notifyHook(stopInput(home), "Stop", older.deps)).toEqual({});
    expect(older.tty).toEqual([
      "\u001bPtmux;\u001b\u001b]777;notify;Claude finished · rel-ssh;Claude finished its turn.\u0007\u001b\\",
    ]);
    // A version the environment does not name: /dev/tty first (wrapped), then the bare field.
    const unknown = setup({ ...env, CLAUDE_CODE_VERSION: "" }, { writeTerminal: () => false });
    expect(notifyHook(stopInput(home), "Stop", unknown.deps).stdout).toBe(
      '{"terminalSequence":"\\u001b]777;notify;Claude finished · rel-ssh;Claude finished its turn.\\u0007"}',
    );
  });

  test("a Claude Code known to be too old writes /dev/tty; with no terminal, nothing", () => {
    const { env } = machine({
      CLAUDE_CODE_VERSION: "2.1.140",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    const { deps, runs, tty } = setup(env);
    expect(notifyHook(stopInput(env.HOME), "Stop", deps)).toEqual({});
    expect(runs).toEqual([]);
    expect(tty).toEqual([
      "\u001b]777;notify;Claude finished · rel-ssh;Claude finished its turn.\u0007",
    ]);
    // An event whose answer Claude Code does not read (StopFailure): /dev/tty only.
    const failed = setup(env);
    expect(
      notifyHook(
        { cwd: join(env.HOME, "rel-ssh"), error: "overloaded_error", session_id: "s-9" },
        "StopFailure",
        failed.deps,
      ),
    ).toEqual({});
    expect(failed.tty).toHaveLength(1);
    // A version the environment does not name: /dev/tty first, and nothing else when it
    // works.
    const { env: unnamed } = machine({ DISPLAY: "", SSH_CONNECTION: "10.0.0.2 51000" });
    const unnamedDeps = setup(unnamed);
    expect(notifyHook(stopInput(unnamed.HOME), "Stop", unnamedDeps.deps)).toEqual({});
    expect(unnamedDeps.tty).toHaveLength(1);
  });

  test("a version the environment does not name, and no terminal at all: the field carries it", () => {
    // What Claude Code 2.1.301 really gives a hook: no CLAUDE_CODE_VERSION, and no
    // controlling terminal (proved live: /dev/tty fails with ENXIO).
    const { env } = machine({ DISPLAY: "", SSH_CONNECTION: "10.0.0.2 51000" });
    const { deps } = setup(env, { writeTerminal: () => false });
    expect(notifyHook(stopInput(env.HOME), "Stop", deps)).toEqual({
      stdout:
        '{"terminalSequence":"\\u001b]777;notify;Claude finished · rel-ssh;Claude finished its turn.\\u0007"}',
    });
  });

  test("in Warp over SSH: nothing (Warp's plugin emits its own)", () => {
    const { env } = machine({
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
      TERM_PROGRAM: "WarpTerminal",
    });
    warpPlugin(env);
    const { deps, runs, tty } = setup(env);
    expect(notifyHook(stopInput(env.HOME), "Stop", deps)).toEqual({});
    expect(runs).toEqual([]);
    expect(tty).toEqual([]);
  });

  test("a version at least 2.1.141, and one below it", () => {
    expect(versionAtLeast("2.1.141", "2.1.141")).toBe(true);
    expect(versionAtLeast("claude 2.1.301 (Claude Code)", "2.1.141")).toBe(true);
    expect(versionAtLeast("2.2.0", "2.1.141")).toBe(true);
    expect(versionAtLeast("2.1.140", "2.1.141")).toBe(false);
    expect(versionAtLeast("", "2.1.141")).toBe(false);
    expect(versionAtLeast(undefined, "2.1.141")).toBe(false);
    expect(terminalRoute("Stop", { CLAUDE_CODE_VERSION: "2.1.301" })).toBe("field");
    expect(terminalRoute("Notification", { CLAUDE_CODE_VERSION: "2.1.301" })).toBe("field");
    expect(terminalRoute("Stop", { CLAUDE_CODE_VERSION: "2.1.100" })).toBe("tty");
    expect(terminalRoute("Stop", {})).toBe("field-if-no-tty");
    expect(terminalRoute("StopFailure", { CLAUDE_CODE_VERSION: "2.1.301" })).toBe("tty");
  });

  test("a semicolon in the title cannot shift the body: the title's becomes a comma", () => {
    // The OSC's fields are split on `;` and the body is the last one, so a `;` in the title
    // would push the body into the title on the terminal that reads them.
    expect(notifySequence("Claude asks you · fix; then ship", "the body; and more")).toBe(
      "\u001b]777;notify;Claude asks you · fix, then ship;the body; and more\u0007",
    );
  });

  test("the settings: the desktop sound off, the SSH bell on", () => {
    const { env } = machine();
    writeConfig(env, { desktopSound: false, sshBell: true });
    const desktop = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", desktop.deps);
    expect(desktop.runs).toEqual([
      [join(env.PATH, "notify-send"), "Claude finished · rel-ssh", "Claude finished its turn."],
    ]);

    const ssh = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    writeConfig(ssh.env, { sshBell: true });
    const overSsh = setup(ssh.env);
    const result = notifyHook(stopInput(ssh.env.HOME), "Stop", overSsh.deps);
    expect(result.stdout).toEndWith(
      'Claude finished · rel-ssh;Claude finished its turn.\\u0007\\u0007"}',
    );
  });

  test("the settings file: its two keys, and the defaults for anything else", () => {
    const home = tempDir("notify-config");
    const file = join(home, "notify.json");
    expect(readNotifyConfig(file)).toEqual({ desktopSound: true, sshBell: false });
    writeFileSync(file, "not json");
    expect(readNotifyConfig(file)).toEqual({ desktopSound: true, sshBell: false });
    writeFileSync(file, JSON.stringify({ desktopSound: "no", sshBell: 1 }));
    expect(readNotifyConfig(file)).toEqual({ desktopSound: true, sshBell: false });
    writeFileSync(file, JSON.stringify({ desktopSound: false, sshBell: true }));
    expect(readNotifyConfig(file)).toEqual({ desktopSound: false, sshBell: true });
    expect(runtimeDir({ XDG_RUNTIME_DIR: "/run/user/1001" })).toBe("/run/user/1001");
  });

  test("with no paplay on PATH: the alert, and no sound", () => {
    const { env } = machine({}, ["notify-send"]);
    const { deps, runs } = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs.length).toBe(1);
    expect(runs[0]?.[0]).toEndWith("notify-send");
  });
});

describe("the entry, as Claude Code runs it", () => {
  test("the SSH route: the JSON answer with the sequence, nothing else", () => {
    const { env } = machine({
      CLAUDE_CODE_VERSION: "2.1.301 (Claude Code)",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000 10.0.0.1 22",
      TERM_PROGRAM: "xterm",
    });
    const result = run(
      { hook_event_name: "Stop", session_id: "11111111-2222-3333-4444-555555555555" },
      env,
    );
    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout:
        '{"terminalSequence":"\\u001b]777;notify;Claude finished;Claude finished its turn.\\u0007"}',
    });
  });

  test("the desktop route: one notify-send, detached", async () => {
    const { env } = machine();
    const result = run(
      {
        hook_event_name: "Notification",
        message: "Claude needs your permission to use Bash",
        notification_type: "permission_prompt",
        session_id: "11111111-2222-3333-4444-555555555555",
      },
      env,
    );
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
    await Bun.sleep(300); // the notifier starts detached from the hook
    const log = readFileSync(join(env.HOME, "notify.log"), "utf8").split("\n").filter(Boolean);
    expect(log).toContain(
      "notify-send --urgency=critical Claude needs you Claude needs your permission to use Bash",
    );
  });

  test("with no notifier and no SSH: silent, and a quiet session", () => {
    const home = tempDir("notify-empty");
    const result = run(
      { hook_event_name: "Stop" },
      {
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        HOME: home,
        PATH: home,
        TERM: "xterm",
        XDG_RUNTIME_DIR: home,
      },
    );
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
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
    expect(result.stderr.toString()).toBe("cc-smart-dev-kit notify: the hook input is not JSON\n");
  });
});

describe("hooks.json wires what this hook handles", () => {
  test("one handler per event, quiet mode, and the matchers match the code's own lists", () => {
    const wired = wiredNotify();
    expect(wired.map(({ event, matcher }) => `${event} ${matcher ?? ""}`).sort()).toEqual(
      [
        "Notification permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|worker_permission_prompt",
        "PostToolUse AskUserQuestion|ExitPlanMode",
        "PostToolUseFailure AskUserQuestion|ExitPlanMode",
        "PreToolUse AskUserQuestion|ExitPlanMode",
        "Stop ",
        "StopFailure ",
        "UserPromptSubmit ",
      ].sort(),
    );
    for (const { args } of wired) {
      expect(args[0]).toBe("--missing=quiet");
    }
  });
});
