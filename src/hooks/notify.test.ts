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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { writeLead } from "../crew/store";
import { makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { awayStateFile, setAvailable, setUnavailable } from "../user-away/state";
import type { AlertEvent } from "../workflow/schema";
import { inBackgroundSession } from "./background-session";
import {
  AGENT_VIEW_MATCHER,
  AGENT_VIEW_TYPES,
  type Alert,
  ASK_MARK_MS,
  agentViewKey,
  DEFAULT_NOTIFY_CONFIG,
  farEndIsWarp,
  isSsh,
  isWarpTerminal,
  NOTIFY_MATCHER,
  NOTIFY_TYPES,
  type NotifyDeps,
  notifyHook,
  notifySequence,
  PLUGIN_NOTIFY_TYPES,
  readNotifyConfig,
  runtimeDir,
  terminalRoute,
  versionAtLeast,
  WAIT_END_EVENTS,
  warpAgentSequence,
  warpEventOf,
  warpPluginOn,
  warpShowsIt,
} from "./notify";
import { stopFailureWillAlert } from "./stop-failure";
import { decodedToastText } from "./windows-toast";

const ENTRY = join(import.meta.dir, "..", "entries", "notify.ts");
const ROOT = join(import.meta.dir, "..", "..");

/** The hooks.json entry for the notify bundle: which events and matchers wire it, and the mode. */
function wiredNotify(): Array<{ event: string; matcher: null | string; mode: string }> {
  const file = JSON.parse(readFileSync(join(ROOT, "plugin", "hooks", "hooks.json"), "utf8")) as {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  };
  const wired: Array<{ event: string; matcher: null | string; mode: string }> = [];
  for (const [event, groups] of Object.entries(file.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        // The handlers are shell form: the bundle and the mode both sit in the command string.
        const mode = /--missing=(ask|quiet)\b/.exec(handler.command)?.[1];
        if (mode !== undefined && handler.command.includes("/dist/notify.js")) {
          wired.push({ event, matcher: group.matcher ?? null, mode: `--missing=${mode}` });
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

/**
 * The gateway, set up: `~/.config/cc-smart-dev-kit/gateway.json` exists (mode 600, or the
 * loader refuses it). Only its existence matters to the two StopFailure hooks.
 */
function gatewaySetUp(env: Record<string, string>): void {
  const file = cliPaths(env).gatewayConfigFile;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ aliases: {}, backends: {}, port: 20100, slots: {}, version: 1 }),
    { mode: 0o600 },
  );
}

/** The hook input at the plan's usage limit, as Claude Code sends it. */
function limitInput(env: Record<string, string>): Record<string, unknown> {
  return {
    cwd: join(env.HOME ?? "", "rel-ssh"),
    error: "rate_limit",
    hook_event_name: "StopFailure",
    last_assistant_message: "You've hit your limit · resets 3pm",
    session_id: "s-5",
  };
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
): { deps: NotifyDeps; runs: string[][]; session: string[]; tty: string[]; asked: string[][] } {
  const runs: string[][] = [];
  const session: string[] = [];
  const tty: string[] = [];
  const asked: string[][] = [];
  const deps: NotifyDeps = {
    env,
    nowMs: Date.now(),
    paths: cliPaths(env),
    platform: "linux",
    run: (argv) => runs.push(argv),
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
    // The short programs the hook runs itself (the Do Not Disturb check, the probe that a
    // click can be waited for): recorded, and answered with nothing — the same answer as a
    // machine with neither `xfconf-query` nor a `notify-send` that lists the two flags.
    capture: (run) => {
      asked.push(run.argv);
      return { exitCode: 0, stdout: "", timedOut: false };
    },
    // No launcher by default: the desktop alert stays a direct `notify-send`, as it always
    // was. A worker test passes the path setup would write.
    launcher: null,
    writeSessionTerminal: (sequence) => {
      session.push(sequence);
      return true;
    },
    writeTerminal: (sequence) => {
      tty.push(sequence);
      return true;
    },
    ...overrides,
  };
  return { deps, runs, session, tty, asked };
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

  test("Windows: the same alert as a PowerShell toast, urgent for a permission prompt, and no sound of ours", () => {
    const { env } = machine({}, ["powershell"]);
    const { deps, runs } = setup(env, { platform: "win32" });
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
    );
    // One program: the toast. Windows plays the sound of its own notification, so nothing
    // of ours runs beside it; the alert's words ride in the encoded script, not the argv.
    expect(runs).toHaveLength(1);
    expect(runs[0]?.slice(0, 4)).toEqual([
      join(env.PATH, "powershell"),
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    const script = Buffer.from(runs[0]?.[4] ?? "", "base64").toString("utf16le");
    expect(decodedToastText(script, "title")).toBe("Claude needs you · rel-ssh");
    expect(decodedToastText(script, "body")).toBe("Claude needs your permission to use Bash");
    expect(script).toContain('<toast scenario="reminder">');
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

  test("a stop hook that made Claude continue fires Stop again: one alert, at the end", () => {
    const { env, home } = machine();
    const { deps, runs } = setup(env);
    notifyHook(stopInput(home), "Stop", deps);
    // The first stop is the turn's end: the alert went out.
    expect(runs.length).toBeGreaterThan(0);
    const shown = runs.length;
    // The continued turn's stop carries `stop_hook_active`: no second alert for one turn.
    notifyHook(stopInput(home, { stop_hook_active: true }), "Stop", deps);
    expect(runs.length).toBe(shown);
  });

  test("the stop verify-gate will block: the finished alert waits for the stop that ends the turn", () => {
    const made = machine();
    const home = made.home;
    // The fake machine's PATH holds only the fake notifier and sound: this test's project
    // lookup needs the real git, in a throwaway repo of its own.
    const env = {
      ...made.env,
      PATH: `${dirname(Bun.which("git") ?? "/usr/bin/git")}:${made.env.PATH}`,
    };
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { checks: { fast: "bun run check" } });
    // A changed file and no run of the check: verify-gate blocks this stop.
    const file = transcript(
      [
        {
          message: {
            content: [
              {
                id: "toolu_edit",
                input: { file_path: "src/a.ts" },
                name: "Edit",
                type: "tool_use",
              },
            ],
          },
          type: "assistant",
        },
      ],
      home,
    );
    const first = { ...stopInput(home, { transcript_path: file }), cwd: repo };
    const { deps, runs } = setup(env);
    notifyHook(first, "Stop", deps);
    // The turn goes on with the check: this stop is no "finished".
    expect(runs).toEqual([]);
    notifyHook({ ...first, stop_hook_active: true }, "Stop", deps);
    // The check ran (or the reminder was already given): this is the real end.
    expect(runs.length).toBeGreaterThan(0);
  });

  test("the stop lead-notes will block: the finished alert waits for the stop that ends the turn", async () => {
    const made = machine();
    const env = {
      ...made.env,
      PATH: `${dirname(Bun.which("git") ?? "/usr/bin/git")}:${made.env.PATH}`,
    };
    const repo = makeRepo();
    const session = "11111111-2222-3333-4444-555555555555";
    await writeLead(
      cliPaths(env).stateDir,
      { cwd: repo, name: "LEAD app plan", plan: "plan", repo, sessionId: session, tag: "app" },
      Date.now(),
    );
    // A lead whose task is still in progress, and a last message that only promises the next step.
    const tasks = join(cliPaths(env).claudeConfigDir, "tasks", session);
    mkdirSync(tasks, { recursive: true });
    writeFileSync(
      join(tasks, "1.json"),
      JSON.stringify({ id: "1", subject: "Merge the wave", status: "in_progress" }),
    );
    const first = {
      ...stopInput(made.home, { last_assistant_message: "Next I'll push the PRs." }),
      cwd: repo,
    };
    const { deps, runs } = setup(env);
    notifyHook(first, "Stop", deps);
    // lead-notes continues this turn: it is no "finished".
    expect(runs).toEqual([]);
    notifyHook({ ...first, stop_hook_active: true }, "Stop", deps);
    expect(runs.length).toBeGreaterThan(0);
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

  test("a question the hooks deny while the person is away raises no alert; it does again once they are back, or when the state cannot be read", async () => {
    const { env } = machine();
    const question = {
      cwd: join(env.HOME, "rel-ssh"),
      hook_event_name: "PreToolUse",
      session_id: "s-9",
      tool_input: { questions: [{ question: "Which branch?", type: "text" }] },
      tool_name: "AskUserQuestion",
    };
    const stateDir = cliPaths(env).stateDir;
    await setUnavailable(stateDir, Date.now(), null);
    const away = setup(env);
    notifyHook(question, "PreToolUse", away.deps);
    expect(away.runs).toEqual([]);

    writeFileSync(awayStateFile(stateDir), "{ nope");
    const unreadable = setup(env);
    notifyHook(question, "PreToolUse", unreadable.deps);
    expect(unreadable.runs.length).toBe(2);

    rmSync(awayStateFile(stateDir));
    await setAvailable(stateDir);
    const back = setup(env);
    notifyHook({ ...question, session_id: "s-10" }, "PreToolUse", back.deps);
    expect(back.runs.length).toBe(2);
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

  test("a stop at the plan's limit, with a desktop and the gateway set up: the StopFailure hook's alert", () => {
    const { env } = machine();
    gatewaySetUp(env);
    const { deps, runs } = setup(env);
    notifyHook(limitInput(env), "StopFailure", deps);
    expect(runs).toEqual([]);
  });

  test("Windows: that same stop is still the StopFailure hook's toast, and only one alert", () => {
    const { env } = machine({}, ["powershell"]);
    gatewaySetUp(env);
    const { deps, runs } = setup(env, { platform: "win32" });
    notifyHook(limitInput(env), "StopFailure", deps);
    expect(runs).toEqual([]);
  });

  test("the same stop with no gateway set up: no stop-failure alert, so the notifier shows it", () => {
    const { bin, env } = machine();
    const { deps, runs } = setup(env);
    notifyHook(limitInput(env), "StopFailure", deps);
    expect(runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/dialog-warning.oga"],
      [
        join(bin, "notify-send"),
        "--urgency=critical",
        "Claude stopped · rel-ssh",
        "You've hit your limit · resets 3pm",
      ],
    ]);
  });

  test("with the gateway set up but no desktop, over SSH: the notifier's own route, as OSC 777", () => {
    const { env } = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    gatewaySetUp(env);
    const { deps, runs, tty } = setup(env);
    // StopFailure's answer is not read by Claude Code, so its route is the terminal itself
    // (`/dev/tty`), the same one every other StopFailure alert of this hook takes.
    expect(notifyHook(limitInput(env), "StopFailure", deps)).toEqual({});
    expect(runs).toEqual([]);
    expect(tty).toEqual([
      "\u001b]777;notify;Claude stopped · rel-ssh;You've hit your limit · resets 3pm\u0007",
    ]);
  });

  test("a short rate limit is no plan limit: the stop-failure hook stays out, and the notifier shows it", () => {
    const { env } = machine();
    gatewaySetUp(env);
    const { deps, runs } = setup(env);
    notifyHook(
      {
        ...limitInput(env),
        last_assistant_message:
          "API Error: Server is temporarily limiting requests (not your usage limit)",
      },
      "StopFailure",
      deps,
    );
    expect(runs.length).toBe(2);
    expect(runs[1]?.[3]).toBe(
      "API Error: Server is temporarily limiting requests (not your usage limit)",
    );
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
    expect(warpShowsIt("Notification", { notification_type: "agent_completed" })).toBe(false);
    expect(warpShowsIt("Notification", { notification_type: "elicitation_dialog" })).toBe(false);
    expect(warpShowsIt("Notification", { notification_type: "permission_prompt" })).toBe(true);
  });

  test("without the plugin (or outside Warp): the normal alert", () => {
    const { env } = machine({ TERM_PROGRAM: "WarpTerminal" });
    const { deps, runs } = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs.length).toBe(2);
    expect(runs[1]?.[1]).not.toBe("--urgency=critical");
  });
});

describe("agent view: the sessions the list shows", () => {
  /** The list's own input for agent view's alert: its session, its folder, the message. */
  function agentInput(home: string, type: string, message: string): Record<string, unknown> {
    return {
      cwd: join(home, "my-app"),
      hook_event_name: "Notification",
      message,
      notification_type: type,
      session_id: "list-1",
    };
  }

  test("a finished and a failed session: the message, no session name, the moment's urgency and sound", () => {
    const { bin, env, home } = machine();
    const finished = setup(env);
    notifyHook(
      agentInput(home, "agent_completed", "my-app finished"),
      "Notification",
      finished.deps,
    );
    expect(finished.runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-logout.oga"],
      [join(bin, "notify-send"), "Claude finished", "my-app finished"],
    ]);
    const failed = setup(env);
    notifyHook(agentInput(home, "agent_completed", "my-app failed"), "Notification", failed.deps);
    expect(failed.runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/dialog-warning.oga"],
      [join(bin, "notify-send"), "--urgency=critical", "Claude stopped", "my-app failed"],
    ]);
    // An empty message falls back to the moment's own sentence.
    const empty = setup(env);
    notifyHook(agentInput(home, "agent_completed", ""), "Notification", empty.deps);
    expect(empty.runs[1]).toEqual([
      join(bin, "notify-send"),
      "Claude finished",
      "A background session finished.",
    ]);
  });

  test("over SSH, plain far end: the exact OSC 777, titled without the list's folder", () => {
    const { env, home } = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    const finished = setup(env);
    expect(
      notifyHook(
        agentInput(home, "agent_completed", "my-app finished"),
        "Notification",
        finished.deps,
      ),
    ).toEqual({});
    expect(finished.tty).toEqual(["\u001b]777;notify;Claude finished;my-app finished\u0007"]);
    const failed = setup(env);
    expect(
      notifyHook(agentInput(home, "agent_completed", "my-app failed"), "Notification", failed.deps),
    ).toEqual({});
    expect(failed.tty).toEqual(["\u001b]777;notify;Claude stopped;my-app failed\u0007"]);
  });

  test("the list never writes a hook's terminalSequence: its own device carries the alert", () => {
    // Claude Code 2.1.302's list reads the field but has no writer for it, so a field answer
    // would be lost. With a version that would pick the field for any other alert, agent
    // view's alerts still go to a device: `/dev/tty`, else the list's own pty — never both.
    const { env, home } = machine({
      CLAUDE_CODE_VERSION: "2.1.302",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    expect(terminalRoute("Notification", env, "agent_completed")).toBe("device-then-field");
    expect(terminalRoute("Notification", env, "agent_needs_input")).toBe("device-then-field");
    expect(terminalRoute("Notification", env, "permission_prompt")).toBe("field");
    const waiting = setup(env, { writeTerminal: () => false });
    expect(
      notifyHook(
        agentInput(home, "agent_needs_input", "my-app needs your input"),
        "Notification",
        waiting.deps,
      ),
    ).toEqual({});
    expect(waiting.tty).toEqual([]);
    expect(waiting.session).toEqual([
      "\u001b]777;notify;Claude needs you;my-app needs your input\u0007",
    ]);
    // No device at all (a host without `/proc`): the field still carries it — a session's own
    // `agent_needs_input` (a teammate's setup question) has it written out. One write only.
    const nowhere = setup(env, { writeSessionTerminal: () => false, writeTerminal: () => false });
    expect(
      notifyHook(
        agentInput(home, "agent_needs_input", "Teammate setup needs your input"),
        "Notification",
        nowhere.deps,
      ),
    ).toEqual({
      stdout:
        '{"terminalSequence":"\\u001b]777;notify;Claude needs you;Teammate setup needs your input\\u0007"}',
    });
    // Every other alert on the device route still ends there: no field for StopFailure.
    const failure = setup(env, { writeSessionTerminal: () => false, writeTerminal: () => false });
    expect(
      notifyHook(
        { cwd: join(home, "my-app"), error: "overloaded_error", session_id: "s-1" },
        "StopFailure",
        failure.deps,
      ),
    ).toEqual({});
  });

  test("on the desktop, each background session keeps its own alert", () => {
    // The list's session is the same for all of them: the key adds the session the message
    // names, so B's "finished" never closes A's "needs your input".
    const a = agentViewKey("list-1", "fix-login needs your input: Which branch?");
    expect(agentViewKey("list-1", "fix-login needs your input")).toBe(a);
    expect(agentViewKey("list-1", "fix-login finished")).toBe(a);
    expect(agentViewKey("list-1", "fix-login failed")).toBe(a);
    expect(agentViewKey("list-1", "add-search finished")).not.toBe(a);
    expect(agentViewKey("list-2", "fix-login finished")).not.toBe(a);
    expect(a).toStartWith("list-1-");
    expect(a).toMatch(/^[A-Za-z0-9-]+$/);
  });

  test("no label and no question mark: the input is the list's, not the background session's", () => {
    const { bin, env, home, runtime } = machine();
    // Both would label an ordinary alert: the transcript's name and the folder.
    const file = transcript([{ customTitle: "the list", type: "user" }], home);
    const mark = join(runtime, "cc-smart-dev-kit-notify-asked-list-1");
    writeFileSync(mark, "1\n");
    const waiting = setup(env);
    notifyHook(
      {
        ...agentInput(home, "agent_needs_input", "my-app needs your input: Which branch?"),
        transcript_path: file,
      },
      "Notification",
      waiting.deps,
    );
    expect(waiting.runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-login.oga"],
      [
        join(bin, "notify-send"),
        "--urgency=critical",
        "Claude needs you",
        "my-app needs your input: Which branch?",
      ],
    ]);
    // A permission prompt for the same marked session is the wait already alerted about.
    const prompt = setup(env);
    notifyHook(
      {
        hook_event_name: "Notification",
        message: "Claude needs your permission",
        notification_type: "permission_prompt",
        session_id: "list-1",
      },
      "Notification",
      prompt.deps,
    );
    expect(prompt.runs).toEqual([]);
  });
});

describe("Warp's agent format over SSH", () => {
  /** An alert as `alertFor` hands it over: only the moment and the body matter here. */
  function alertOf(moment: AlertEvent, body: string): Alert {
    return { body, critical: false, moment, sound: null, title: "Claude" };
  }

  const INPUT = {
    cwd: "/home/user/my-app",
    error: "overloaded_error",
    notification_type: "permission_prompt",
    session_id: "s-1",
  };
  const PREFIX = "\u001b]777;notify;warp://cli-agent;";

  test("the far end is Warp: LC_TERMINAL, a named terminal, or the person's fallback", () => {
    const plain = DEFAULT_NOTIFY_CONFIG;
    const fallback = { ...DEFAULT_NOTIFY_CONFIG, sshWarp: true };
    expect(farEndIsWarp({ TERM_PROGRAM: "WarpTerminal" }, plain)).toBe(true);
    expect(
      farEndIsWarp({ WARP_CLI_AGENT_PROTOCOL_VERSION: "1", WARP_CLIENT_VERSION: "v1" }, plain),
    ).toBe(true);
    // A terminal that names itself decides: VS Code says vscode, whatever the client sent.
    expect(farEndIsWarp({ LC_TERMINAL: "WarpTerminal", TERM_PROGRAM: "vscode" }, plain)).toBe(
      false,
    );
    // tmux's own TERM_PROGRAM says nothing about the far end, so LC_TERMINAL decides.
    expect(farEndIsWarp({ LC_TERMINAL: "WarpTerminal", TERM_PROGRAM: "tmux" }, plain)).toBe(true);
    // LC_TERMINAL names another client (iTerm2 sends it too): not Warp, whatever the fallback.
    expect(farEndIsWarp({ LC_TERMINAL: "iTerm2" }, fallback)).toBe(false);
    expect(farEndIsWarp({ LC_TERMINAL: "warpterminal" }, plain)).toBe(true);
    expect(farEndIsWarp({}, fallback)).toBe(true);
    expect(farEndIsWarp({}, plain)).toBe(false);
  });

  test("the three events: the exact JSON, in the one key order", () => {
    expect(warpAgentSequence(alertOf("finished", "the body"), INPUT)).toBe(
      `${PREFIX}{"v":1,"agent":"claude","event":"stop","session_id":"s-1","cwd":"/home/user/my-app","project":"my-app","response":"the body"}\u0007`,
    );
    expect(warpAgentSequence(alertOf("failed", "the body"), INPUT)).toBe(
      `${PREFIX}{"v":1,"agent":"claude","event":"stop_failure","session_id":"s-1","cwd":"/home/user/my-app","project":"my-app","response":"the body","error_type":"overloaded_error"}\u0007`,
    );
    // Warp shows `error_type` as a prefix of the text, so an input that names no error leaves
    // the key out entirely: an `agent_completed` failure has none, and "unknown" would show.
    for (const noError of [
      { ...INPUT, error: undefined },
      { ...INPUT, error: "" },
      { ...INPUT, error: 7 },
    ]) {
      expect(warpAgentSequence(alertOf("failed", "the body"), noError)).toBe(
        `${PREFIX}{"v":1,"agent":"claude","event":"stop_failure","session_id":"s-1","cwd":"/home/user/my-app","project":"my-app","response":"the body"}\u0007`,
      );
    }
    expect(warpAgentSequence(alertOf("needs-you", "the body"), INPUT)).toBe(
      `${PREFIX}{"v":1,"agent":"claude","event":"permission_request","session_id":"s-1","cwd":"/home/user/my-app","project":"my-app","summary":"the body"}\u0007`,
    );
    // Every wait and question takes `permission_request`, the one event Warp showed a popup
    // for: `agent_needs_input` gave only a tab badge (proved live on Windows Warp, 2026-10-19).
    for (const notification_type of ["worker_permission_prompt", "agent_needs_input"]) {
      expect(
        warpAgentSequence(alertOf("needs-you", "the body"), { ...INPUT, notification_type }),
      ).toBe(
        `${PREFIX}{"v":1,"agent":"claude","event":"permission_request","session_id":"s-1","cwd":"/home/user/my-app","project":"my-app","summary":"the body"}\u0007`,
      );
    }
    expect(warpAgentSequence(alertOf("question", "the body"), {})).toBe(
      `${PREFIX}{"v":1,"agent":"claude","event":"permission_request","session_id":"","cwd":"","project":"","summary":"the body"}\u0007`,
    );
  });

  test("the mapping: finished → stop, failed → stop_failure, every wait and question → permission_request", () => {
    // One mapping, one home (`warpEventOf`). `agent_needs_input` is never sent: Warp showed
    // only a tab badge for it and no popup.
    expect(
      ["needs-you", "question", "finished", "failed"].map(
        (moment) => `${moment}: ${warpEventOf(alertOf(moment as Alert["moment"], "the body"))}`,
      ),
    ).toEqual([
      "needs-you: permission_request",
      "question: permission_request",
      "finished: stop",
      "failed: stop_failure",
    ]);
  });

  test("exactly one ESC and one BEL: the sequence is a single notification", () => {
    const sequence = warpAgentSequence(alertOf("finished", "the body"), INPUT);
    expect([...sequence].filter((char) => char === "\u001b")).toHaveLength(1);
    expect([...sequence].filter((char) => char === "\u0007")).toHaveLength(1);
  });

  test("through the hook's field: stdout is the Warp sequence, and sshBell adds no second BEL", () => {
    const { env } = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      DISPLAY: "",
      LC_TERMINAL: "WarpTerminal",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    writeConfig(env, { sshBell: true });
    const sequence =
      '\u001b]777;notify;warp://cli-agent;{"v":1,"agent":"claude","event":"stop","session_id":"11111111-2222-3333-4444-555555555555","cwd":"","project":"","response":"Claude finished its turn."}\u0007';
    const result = run(
      { hook_event_name: "Stop", session_id: "11111111-2222-3333-4444-555555555555" },
      env,
    );
    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `{"terminalSequence":${JSON.stringify(sequence)}}`,
    });
    expect([...sequence].filter((char) => char === "\u0007")).toHaveLength(1);
  });

  test("a Warpified list with Warp's plugin on: Stop stays quiet, agent_completed goes out in Warp's format", () => {
    const { env, home } = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
      TERM_PROGRAM: "WarpTerminal",
    });
    warpPlugin(env);
    const stop = setup(env);
    expect(notifyHook(stopInput(home), "Stop", stop.deps)).toEqual({});
    expect(stop.runs).toEqual([]);
    expect(stop.tty).toEqual([]);

    const done = setup(env);
    const result = notifyHook(
      {
        cwd: join(home, "my-app"),
        hook_event_name: "Notification",
        message: "my-app finished",
        notification_type: "agent_completed",
        session_id: "list-3",
      },
      "Notification",
      done.deps,
    );
    const sequence = `\u001b]777;notify;warp://cli-agent;{"v":1,"agent":"claude","event":"stop","session_id":"list-3","cwd":"${join(home, "my-app")}","project":"my-app","response":"my-app finished"}\u0007`;
    expect(result).toEqual({});
    expect(done.tty).toEqual([sequence]);
    expect(done.runs).toEqual([]);
  });
});

describe("a background session leaves its alerts to agent view", () => {
  const JOB = "/home/user/.claude/jobs/abc";

  test("inBackgroundSession reads CLAUDE_JOB_DIR, and nothing else", () => {
    expect(inBackgroundSession({ CLAUDE_JOB_DIR: JOB })).toBe(true);
    expect(inBackgroundSession({ CLAUDE_JOB_DIR: "" })).toBe(false);
    expect(inBackgroundSession({})).toBe(false);
    expect(inBackgroundSession({ CLAUDE_CODE_SESSION_KIND: "bg" })).toBe(false);
  });

  test("with a desktop and a notifier: nothing runs, nothing is written, the answer is empty", () => {
    const { env, home } = machine({ CLAUDE_JOB_DIR: JOB });
    const { deps, runs, session, tty } = setup(env);
    expect(notifyHook(stopInput(home), "Stop", deps)).toEqual({});
    expect(runs).toEqual([]);
    expect(tty).toEqual([]);
    expect(session).toEqual([]);
    // Not even the question's mark: a question writes one in any other session, and here
    // the hook returned before it wrote anything.
    const asked = setup(env);
    expect(
      notifyHook(
        {
          hook_event_name: "PreToolUse",
          session_id: "list-1",
          tool_input: { questions: [{ question: "Which branch?" }] },
          tool_name: "AskUserQuestion",
        },
        "PreToolUse",
        asked.deps,
      ),
    ).toEqual({});
    expect(asked.runs).toEqual([]);
    expect(existsSync(join(runtimeDir(env), "cc-smart-dev-kit-notify-asked-list-1"))).toBe(false);

    const result = run(
      {
        cwd: home,
        hook_event_name: "Notification",
        message: "Claude needs your permission to use Bash",
        notification_type: "permission_prompt",
        session_id: "list-1",
      },
      env,
    );
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
    expect(existsSync(join(home, "notify.log"))).toBe(false);
  });

  test("over SSH too: no terminal sequence, and no usage-limit alert", () => {
    const { env, home } = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      CLAUDE_JOB_DIR: JOB,
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    const { deps, runs, tty } = setup(env);
    expect(notifyHook(stopInput(home), "Stop", deps)).toEqual({});
    expect(runs).toEqual([]);
    expect(tty).toEqual([]);
    expect(notifyHook(limitInput(env), "StopFailure", deps)).toEqual({});
    expect(runs).toEqual([]);
  });

  test("the usage-limit alert's own hook says it will not alert, so the notifier is not the second", () => {
    const { env } = machine();
    gatewaySetUp(env);
    const deps = {
      env,
      nowMs: Date.now(),
      paths: cliPaths(env),
      platform: "linux" as const,
      which: (command: string) => Bun.which(command, { PATH: env.PATH ?? "" }),
    };
    expect(stopFailureWillAlert(limitInput(env), deps)).toBe(true);
    expect(
      stopFailureWillAlert(limitInput(env), { ...deps, env: { ...env, CLAUDE_JOB_DIR: JOB } }),
    ).toBe(false);
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
    const { deps, session } = setup(env, { writeTerminal: () => false });
    expect(notifyHook(stopInput(env.HOME), "Stop", deps)).toEqual({
      stdout:
        '{"terminalSequence":"\\u001b]777;notify;Claude finished · rel-ssh;Claude finished its turn.\\u0007"}',
    });
    // This event's answer is read: the session's own device is never also written to.
    expect(session).toEqual([]);
  });

  test("an event whose answer is not read, and no /dev/tty: the session's own device carries it", () => {
    // StopFailure on 2.1.301: Claude Code ignores its output, and the hook has no
    // controlling terminal, so `/dev/tty` fails. The pty Claude Code is attached to is the
    // route that works (proved live), wrapped for tmux here: tmux receives it as pane output.
    const { env } = machine({
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
      TMUX: "/tmp/tmux-1001/default,1234,0",
    });
    const { deps, runs, session, tty } = setup(env, { writeTerminal: () => false });
    expect(
      notifyHook(
        {
          cwd: join(env.HOME, "rel-ssh"),
          error: "overloaded_error",
          last_assistant_message: "API Error: Overloaded",
          session_id: "s-9",
        },
        "StopFailure",
        deps,
      ),
    ).toEqual({});
    expect(runs).toEqual([]);
    expect(tty).toEqual([]);
    expect(session).toEqual([
      "\u001bPtmux;\u001b\u001b]777;notify;Claude stopped · rel-ssh;API Error: Overloaded\u0007\u001b\\",
    ]);
    // With a `/dev/tty` that works (an older Claude Code gives the hook one), that is the
    // route, and the device is never written to as well: one alert.
    const onTty = setup(env);
    notifyHook(
      { cwd: join(env.HOME, "rel-ssh"), error: "authentication_error", session_id: "s-10" },
      "StopFailure",
      onTty.deps,
    );
    expect(onTty.tty).toHaveLength(1);
    expect(onTty.session).toEqual([]);
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

  test("the settings file: its three keys, and the defaults for anything else", () => {
    const home = tempDir("notify-config");
    const file = join(home, "notify.json");
    expect(readNotifyConfig(file)).toEqual({ desktopSound: true, sshBell: false, sshWarp: false });
    writeFileSync(file, "not json");
    expect(readNotifyConfig(file)).toEqual({ desktopSound: true, sshBell: false, sshWarp: false });
    writeFileSync(file, JSON.stringify({ desktopSound: "no", sshBell: 1, sshWarp: "yes" }));
    expect(readNotifyConfig(file)).toEqual({ desktopSound: true, sshBell: false, sshWarp: false });
    writeFileSync(file, JSON.stringify({ desktopSound: false, sshBell: true, sshWarp: true }));
    expect(readNotifyConfig(file)).toEqual({ desktopSound: false, sshBell: true, sshWarp: true });
    // The fallback is off unless the file says exactly true: it changes how every SSH alert goes.
    writeFileSync(file, JSON.stringify({ sshWarp: false }));
    expect(readNotifyConfig(file).sshWarp).toBe(false);
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

describe("the Linux desktop worker: a click can be waited for", () => {
  const LAUNCHER = "/home/user/.local/bin/cc-smart-dev-kit";

  /** A fake program on PATH that answers every call with one line: `true`, a help text. */
  function fakeAnswer(bin: string, name: string, answer: string): void {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(answer)}\n`);
    chmodSync(join(bin, name), 0o755);
  }

  /** A fake `notify-send` whose `--help` lists the two flags the click wait needs. */
  function notifySendWithActions(bin: string, home: string): void {
    writeFileSync(
      join(bin, "notify-send"),
      [
        "#!/bin/sh",
        `[ "$1" = "--help" ] && { printf '%s\\n' "-A, --action=[NAME=]Text" "-w, --wait" "-t, --expire-time=TIME"; exit 0; }`,
        `echo "notify-send $*" >> '${join(home, "notify.log")}'`,
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "notify-send"), 0o755);
  }

  test("the bus is there and the launcher is installed: the alert goes to the worker, with the session's window", () => {
    const { env } = machine({ DISPLAY: ":0", TERM_PROGRAM: "vscode", WINDOWID: "12345" }, [
      "gdbus",
      "xdotool",
      "notify-send",
      "paplay",
    ]);
    const { deps, runs } = setup(env, { launcher: LAUNCHER });
    notifyHook(
      {
        cwd: join(env.HOME, "my-app"),
        hook_event_name: "Notification",
        message: "Claude needs your permission to use Bash",
        notification_type: "permission_prompt",
        session_id: "s-1",
      },
      "Notification",
      deps,
    );
    // The sound, then the worker — never the notification itself as well: one sender.
    expect(runs[0]?.[1]).toEndWith("service-login.oga");
    expect(runs[1]?.slice(0, 2)).toEqual([LAUNCHER, "alert-worker"]);
    expect(JSON.parse(runs[1]?.[2] ?? "")).toEqual({
      body: "Claude needs your permission to use Bash",
      critical: true,
      kind: "notify",
      session: "s-1",
      title: "Claude needs you · my-app",
      window: { folder: "my-app", name: "my-app", program: "vscode", windowId: "12345" },
    });
    // The hook itself never runs notify-send: the worker is the one that shows the alert.
    expect(runs.filter((argv) => argv[0]?.endsWith("notify-send"))).toEqual([]);
  });

  test("no launcher (setup never ran): the direct notification stays, no worker", () => {
    const { bin, env } = machine({ DISPLAY: ":0" }, ["gdbus", "xdotool", "notify-send", "paplay"]);
    const { deps, runs } = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-logout.oga"],
      [join(bin, "notify-send"), "Claude finished · rel-ssh", "Claude finished its turn."],
    ]);
  });

  test("only a notify-send that cannot do the two flags: the direct notification stays", () => {
    const { bin, env } = machine({ DISPLAY: ":0" }, ["notify-send", "paplay"]);
    const { asked, deps, runs } = setup(env, { launcher: LAUNCHER });
    notifyHook(stopInput(env.HOME), "Stop", deps);
    // The probe read its help: no `--action`, so there is no click to wait for.
    expect(asked).toContainEqual([join(bin, "notify-send"), "--help"]);
    expect(runs).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-logout.oga"],
      [join(bin, "notify-send"), "Claude finished · rel-ssh", "Claude finished its turn."],
    ]);
  });

  test("no gdbus, but a notify-send whose help lists the flags: the worker runs", () => {
    const { bin, env } = machine({ DISPLAY: ":0" }, ["notify-send", "paplay"]);
    notifySendWithActions(bin, env.HOME);
    const { deps, runs } = setup(env, {
      launcher: LAUNCHER,
      // The probe a real hook makes: it runs `notify-send --help` and reads the flags.
      capture: (run) => ({
        exitCode: 0,
        stdout: run.argv.includes("--help") ? "-A, --action=[NAME=]Text\n-w, --wait\n" : "",
        timedOut: false,
      }),
    });
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs.map((argv) => argv.slice(0, 2))).toEqual([
      [join(bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-logout.oga"],
      [LAUNCHER, "alert-worker"],
    ]);
  });

  test("a Wayland session with no DISPLAY is a desktop too", () => {
    const { env } = machine({ DISPLAY: "", WAYLAND_DISPLAY: "wayland-0" }, [
      "gdbus",
      "xdotool",
      "notify-send",
      "paplay",
    ]);
    const { deps, runs } = setup(env, { launcher: LAUNCHER });
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs[1]?.slice(0, 2)).toEqual([LAUNCHER, "alert-worker"]);
  });

  test("Do Not Disturb: an ordinary alert's sound stays off; an urgent one sounds anyway", () => {
    const { bin, env } = machine({ DISPLAY: ":0" }, ["notify-send", "paplay"]);
    fakeAnswer(bin, "xfconf-query", "true");
    // What the hook's own call reads: the fake answers the XFCE setting, as the real one does.
    const asked: string[][] = [];
    const reading = (answer: string) => (run: { argv: string[] }) => {
      asked.push(run.argv);
      return {
        exitCode: 0,
        stdout: run.argv[0]?.endsWith("xfconf-query") === true ? `${answer}\n` : "",
        timedOut: false,
      };
    };
    // An ordinary alert (a finished turn): the sound is silenced.
    const dnd = setup(env, { capture: reading("true") });
    notifyHook(stopInput(env.HOME), "Stop", dnd.deps);
    expect(dnd.runs).toEqual([
      [join(bin, "notify-send"), "Claude finished · rel-ssh", "Claude finished its turn."],
    ]);
    expect(asked).toContainEqual([
      join(bin, "xfconf-query"),
      "-c",
      "xfce4-notifyd",
      "-p",
      "/do-not-disturb",
    ]);
    // An urgent alert (a question): it sounds anyway, as XFCE shows those under DND too.
    const urgent = setup(env, { capture: reading("true") });
    notifyHook(
      {
        cwd: join(env.HOME, "rel-ssh"),
        hook_event_name: "PreToolUse",
        session_id: "s-1",
        tool_input: { question: "Which branch?" },
        tool_name: "AskUserQuestion",
      },
      "PreToolUse",
      urgent.deps,
    );
    expect(urgent.runs[0]?.[1]).toEndWith("service-login.oga");
    // DND off: the sound plays for an ordinary alert as always.
    const off = setup(env, { capture: reading("false") });
    notifyHook(stopInput(env.HOME), "Stop", off.deps);
    expect(off.runs[0]?.[1]).toEndWith("service-logout.oga");
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

describe("the workflow's alert settings", () => {
  /** The person's own workflow file, written where the hook reads it: `alerts` set as given. */
  function writeAlerts(env: Record<string, string>, alerts: unknown): void {
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ alerts }, null, 2)}\n`);
  }

  /** The input and event of one of the four alert moments, at a folder that is no project. */
  function moment(
    which: "failed" | "finished" | "needs-you" | "question",
    home: string,
    /** The session: a `StopFailure` alerts once per error per session, so a second run needs a new one. */
    session = "s-1",
  ): { event: string; input: Record<string, unknown> } {
    if (which === "needs-you") {
      return {
        event: "Notification",
        input: {
          cwd: join(home, "rel-ssh"),
          hook_event_name: "Notification",
          message: "Claude needs your permission to use Bash",
          notification_type: "permission_prompt",
          session_id: session,
        },
      };
    }
    if (which === "question") {
      return {
        event: "PreToolUse",
        input: {
          cwd: join(home, "rel-ssh"),
          hook_event_name: "PreToolUse",
          session_id: session,
          tool_input: { questions: [{ question: "Which branch?", type: "text" }] },
          tool_name: "AskUserQuestion",
        },
      };
    }
    if (which === "failed") {
      return {
        event: "StopFailure",
        input: {
          cwd: join(home, "rel-ssh"),
          error: "server_error",
          hook_event_name: "StopFailure",
          last_assistant_message: "The turn ended with an error",
          session_id: session,
        },
      };
    }
    return { event: "Stop", input: stopInput(home) };
  }

  test.each([
    ["needs-you", "permission_prompt"],
    ["question", "AskUserQuestion"],
    ["finished", "Stop"],
    ["failed", "StopFailure"],
  ] as const)("%s: shown when it is in alerts.events", (kind) => {
    const all = ["needs-you", "question", "finished", "failed"];
    const { env } = machine();
    // Every moment but this one: only this moment is left to alert.
    writeAlerts(env, { events: all.filter((event) => event !== kind) });
    const { event, input } = moment(kind, env.HOME);
    const off = setup(env);
    expect(notifyHook(input, event, off.deps)).toEqual({});
    expect(off.runs).toEqual([]);

    writeAlerts(env, { events: all });
    const on = setup(env);
    const second = moment(kind, env.HOME, "s-2");
    notifyHook(second.input, event, on.deps);
    // The desktop route runs the notifier and stays silent itself, so the alert is the run.
    expect(on.runs.length).toBeGreaterThan(0);
  });

  test("agent view's finished or failed alert is the moment its message names, and alerts.events decides", () => {
    const { env } = machine();
    const input = {
      cwd: join(env.HOME, "my-app"),
      hook_event_name: "Notification",
      message: "my-app finished",
      notification_type: "agent_completed",
      session_id: "list-2",
    };
    writeAlerts(env, { events: ["needs-you", "question", "failed"] });
    const hiddenFinished = setup(env);
    expect(notifyHook(input, "Notification", hiddenFinished.deps)).toEqual({});
    expect(hiddenFinished.runs).toEqual([]);

    writeAlerts(env, { events: ["needs-you", "question", "finished"] });
    const hiddenFailed = setup(env);
    expect(
      notifyHook({ ...input, message: "my-app failed" }, "Notification", hiddenFailed.deps),
    ).toEqual({});
    expect(hiddenFailed.runs).toEqual([]);

    // The moment the person kept still alerts.
    writeAlerts(env, { events: ["finished"] });
    const shown = setup(env);
    notifyHook(input, "Notification", shown.deps);
    expect(shown.runs.length).toBe(2);
  });

  test("a question left out: the permission prompt that follows it still alerts", () => {
    const { env } = machine();
    writeAlerts(env, { events: ["needs-you", "finished", "failed"] });
    const question = setup(env);
    expect(notifyHook(moment("question", env.HOME).input, "PreToolUse", question.deps)).toEqual({});
    expect(question.runs).toEqual([]);
    // Six seconds later Claude Code raises the permission prompt for the same wait: the
    // question's mark went with its suppressed alert, so this one is shown.
    const prompt = setup(env);
    notifyHook(
      {
        cwd: join(env.HOME, "rel-ssh"),
        hook_event_name: "Notification",
        message: "Claude needs your permission to use AskUserQuestion",
        notification_type: "permission_prompt",
        session_id: "s-1",
      },
      "Notification",
      prompt.deps,
    );
    expect(prompt.runs.length).toBe(2);
  });

  test("alerts.events off for every moment: nothing is shown, and no file is needed", () => {
    const { env } = machine();
    writeAlerts(env, { events: ["finished"] });
    const { deps, runs } = setup(env);
    expect(notifyHook(moment("needs-you", env.HOME).input, "Notification", deps)).toEqual({});
    expect(runs).toEqual([]);
  });

  test("a broken workflow file: today's alert, and one line on stderr", () => {
    const { env } = machine();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    const { deps, runs } = setup(env);
    const result = notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs.length).toBe(2); // the sound and the notification, as always
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit: the alerts use the settings that can be read (Invalid ",
    );
    expect(result.stdout).toBeUndefined();
  });

  test("alerts.sound on: the Linux players, paplay first and canberra-gtk-play without it", () => {
    const withPaplay = machine();
    writeAlerts(withPaplay.env, { sound: true });
    writeConfig(withPaplay.env, { desktopSound: false });
    const first = setup(withPaplay.env);
    notifyHook(stopInput(withPaplay.env.HOME), "Stop", first.deps);
    expect(first.runs).toEqual([
      [join(withPaplay.bin, "paplay"), "/usr/share/sounds/freedesktop/stereo/service-logout.oga"],
      [
        join(withPaplay.bin, "notify-send"),
        "Claude finished · rel-ssh",
        "Claude finished its turn.",
      ],
    ]);

    const noPaplay = machine({}, ["notify-send", "canberra-gtk-play"]);
    writeAlerts(noPaplay.env, { sound: true });
    writeConfig(noPaplay.env, { desktopSound: false });
    const second = setup(noPaplay.env);
    notifyHook(stopInput(noPaplay.env.HOME), "Stop", second.deps);
    expect(second.runs[0]).toEqual([
      join(noPaplay.bin, "canberra-gtk-play"),
      "-i",
      "service-logout",
    ]);
  });

  test("alerts.sound on, macOS: afplay of the moment's system sound", () => {
    const { bin, env } = machine({}, ["osascript", "afplay"]);
    writeAlerts(env, { sound: true });
    // notify.json's own sound off, so only `alerts.sound` can be the reason afplay runs.
    writeConfig(env, { desktopSound: false });
    const { deps, runs } = setup(env, { platform: "darwin" });
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs[0]).toEqual([join(bin, "afplay"), "/System/Library/Sounds/Pop.aiff"]);
    expect(runs[1]?.[0]).toBe(join(bin, "osascript"));
  });

  test("alerts.sound on, Windows: the toast's own sound, nothing else started", () => {
    const { bin, env } = machine({}, ["powershell"]);
    writeAlerts(env, { sound: true });
    const { deps, runs } = setup(env, { platform: "win32" });
    notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.[0]).toBe(join(bin, "powershell"));
  });

  test("alerts.sound on, over SSH: the terminal bell, where notify.json's sshBell is off", () => {
    const { env } = machine({
      CLAUDE_CODE_VERSION: "2.1.301",
      DISPLAY: "",
      SSH_CONNECTION: "10.0.0.2 51000",
    });
    writeAlerts(env, { sound: true });
    const { deps } = setup(env);
    const result = notifyHook(stopInput(env.HOME), "Stop", deps);
    expect(result.stdout).toEndWith('Claude finished its turn.\\u0007\\u0007"}');
  });

  test("alerts.sound off: the alert, the freedesktop sound as always, and no afplay", () => {
    const { env } = machine({}, ["notify-send", "paplay", "canberra-gtk-play", "afplay"]);
    writeAlerts(env, { sound: false });
    const linux = setup(env);
    notifyHook(stopInput(env.HOME), "Stop", linux.deps);
    // notify.json's desktopSound is on by default: the freedesktop sound, then the alert.
    expect(linux.runs).toHaveLength(2);
    expect(linux.runs[0]?.[1]).toBe("/usr/share/sounds/freedesktop/stereo/service-logout.oga");

    const darwin = setup(env, { platform: "darwin" });
    notifyHook(stopInput(env.HOME), "Stop", darwin.deps);
    expect(darwin.runs).toEqual([]);
  });
});

describe("hooks.json wires what this hook handles", () => {
  test("the two matchers are each one home, and the code accepts their union", () => {
    // A session's own process gets the plugin's four types; agent view's two run from the
    // user-level hook setup writes. The code accepts both, so either wiring answers the same.
    expect([...PLUGIN_NOTIFY_TYPES]).toEqual([
      "permission_prompt",
      "elicitation_dialog",
      "elicitation_url_dialog",
      "worker_permission_prompt",
    ]);
    expect([...AGENT_VIEW_TYPES]).toEqual(["agent_needs_input", "agent_completed"]);
    expect([...NOTIFY_TYPES]).toEqual([...PLUGIN_NOTIFY_TYPES, ...AGENT_VIEW_TYPES]);
    expect(NOTIFY_MATCHER).toBe(
      "permission_prompt|elicitation_dialog|elicitation_url_dialog|worker_permission_prompt",
    );
    expect(AGENT_VIEW_MATCHER).toBe("agent_needs_input|agent_completed");
  });

  test("one handler per event, quiet mode, and the matchers match the code's own lists", () => {
    const wired = wiredNotify();
    expect(wired.map(({ event, matcher }) => `${event} ${matcher ?? ""}`).sort()).toEqual(
      [
        `Notification ${NOTIFY_MATCHER}`,
        "PostToolUse AskUserQuestion|ExitPlanMode",
        "PostToolUseFailure AskUserQuestion|ExitPlanMode",
        "PreToolUse AskUserQuestion|ExitPlanMode",
        "Stop ",
        "StopFailure ",
        "UserPromptSubmit ",
      ].sort(),
    );
    for (const { mode } of wired) {
      // The notifier is not a guard: with no bun it is quiet, one line on stderr.
      expect(mode).toBe("--missing=quiet");
    }
  });
});
