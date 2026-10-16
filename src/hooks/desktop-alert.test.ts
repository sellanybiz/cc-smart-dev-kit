/**
 * The Linux desktop extras (`desktop-alert.ts`): the worker that waits for a click on the
 * alert, raises the session's window, closes the alert on the minute and keeps one alert
 * per session on screen; and the Do-Not-Disturb check the hook makes before a sound.
 *
 * Nothing here touches a real desktop: every program is a fake the test answers for
 * (`Runner`), the bus signal monitor is a fake `Watch`, the minute is a `sleep` the test
 * resolves, and the record file lives in a temp folder (`testing.md`).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { tempDir } from "../testing/temp";
import {
  ALERT_SCREEN_MS,
  actionOf,
  busCallArgv,
  canWaitForClick,
  closeCallArgv,
  closedReasonOf,
  type DesktopAlertDeps,
  desktopTools,
  dndOn,
  escapedMarkup,
  gvariantString,
  hasDesktop,
  NOTIFY_ALERT_KIND,
  type NotifyWorkerAlert,
  notifiedId,
  notifyCallArgv,
  notifySendAlertArgv,
  notifySendCapabilities,
  notifyWorkerAlert,
  parseNotifyWorkerAlert,
  raiseArgv,
  runDesktopAlert,
  serverCapabilities,
  shownStateFile,
  type Watch,
  type Watched,
} from "./desktop-alert";
import type { Run, Runner } from "./stop-failure";

/** The tools every desktop test pretends are installed, by their names on PATH. */
function toolsWhich(names: string[]): (command: string) => null | string {
  return (command) => (names.includes(command) ? `/usr/bin/${command}` : null);
}

/** A fake runner: it answers each call in turn, and every call is recorded. */
function fakeRunner(
  answers: Array<{ exitCode?: null | number; stdout?: string; timedOut?: boolean }>,
) {
  const runs: Run[] = [];
  const run: Runner = (one) => {
    runs.push(one);
    const answer = answers[runs.length - 1] ?? { exitCode: 0, stdout: "" };
    return {
      exitCode: answer.exitCode === undefined ? 0 : answer.exitCode,
      stdout: answer.stdout ?? "",
      timedOut: answer.timedOut ?? false,
    };
  };
  return { run, runs };
}

/** A watcher that hands its scripted lines over at once, and records that it was stopped. */
function watching(lines: string[]): { stopped: () => boolean; watch: Watch } {
  let stopped = false;
  const watch: Watch = (_argv, onLine) => {
    for (const line of lines) onLine(line);
    return {
      stop: () => {
        stopped = true;
      },
    } satisfies Watched;
  };
  return { stopped: () => stopped, watch };
}

/** What every run needs besides the runner and the watcher. */
function baseDeps(
  stateDir: string,
): Pick<DesktopAlertDeps, "nowMs" | "screenMs" | "stateDir" | "which"> {
  return {
    nowMs: () => Date.now(),
    screenMs: ALERT_SCREEN_MS,
    stateDir,
    which: toolsWhich(["gdbus", "notify-send", "xdotool", "xfconf-query"]),
  };
}

/** The alert one notification carries; a test changes what it needs. */
const ALERT: NotifyWorkerAlert = {
  body: "Claude needs your permission to use Bash",
  critical: true,
  kind: NOTIFY_ALERT_KIND,
  session: "s-1",
  title: "Claude needs you · my-app",
  window: { folder: "my-app", name: "", program: "xterm", windowId: "12345" },
};

/** A watcher line as `gdbus monitor` prints it. */
function actionLine(id: number, action: string): string {
  return `/org/freedesktop/Notifications: org.freedesktop.Notifications.ActionInvoked (uint32 ${id}, '${action}')`;
}

function closedLine(id: number, reason: number): string {
  return `/org/freedesktop/Notifications: org.freedesktop.Notifications.NotificationClosed (uint32 ${id}, uint32 ${reason})`;
}

/** The capabilities answer, and a `Notify` answer with id 42. */
const BUS_ANSWERS = [{ stdout: "(['body', 'actions'],)\n" }, { stdout: "(uint32 42,)\n" }];

/**
 * A reader for the one shape this code writes — a single-quoted GVariant string — following
 * GLib's "GVariant Text Format" § Strings. It is here so the round trip is checked on a
 * machine without GLib's Python bindings; `readsWithGlib` below checks the same values
 * against GLib's own parser where it is installed.
 *
 * It reads the two escapes `gvariantString` writes (`\\` and `\'`) and **nothing else**:
 * any other backslash escape is the sign that the text is not the text that went in, so that
 * too gives null.
 */
function readsGvariantString(text: string): null | string {
  if (text.length < 2 || !text.startsWith("'") || !text.endsWith("'")) return null;
  const inner = text.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i += 1) {
    const character = inner[i] ?? "";
    if (character !== "\\") {
      out += character;
      continue;
    }
    const next = inner[i + 1];
    if (next !== "\\" && next !== "'") return null;
    out += next;
    i += 1;
  }
  return out;
}

/**
 * GLib's own parser, one answer per text: the decoded value, or null where GLib refuses the
 * text. The texts go in as one JSON argument — never inside the Python source — and all of
 * them are parsed in that one process.
 */
const GLIB_READER = [
  "import json, sys",
  "from gi.repository import GLib",
  "answers = []",
  "for text in json.loads(sys.argv[1]):",
  "    try:",
  "        value = GLib.Variant.parse(GLib.VariantType.new('s'), text, None, None)",
  "        answers.append(value.unpack())",
  "    except Exception:",
  "        answers.append(None)",
  "sys.stdout.write(json.dumps(answers))",
].join("\n");

/** True when this machine's Python has GLib: the real parser can be asked (else no test). */
function hasGlib(): boolean {
  try {
    return (
      Bun.spawnSync(["python3", "-I", "-c", "from gi.repository import GLib"], {
        stderr: "ignore",
        stdout: "ignore",
      }).exitCode === 0
    );
  } catch {
    // No python3 on this machine at all: there is no parser to ask.
    return false;
  }
}

/** GLib's answers for `texts` (null where it refuses one), or null when there is no GLib. */
function glibReads(texts: string[]): null | (null | string)[] {
  const result = Bun.spawnSync(["python3", "-I", "-c", GLIB_READER, JSON.stringify(texts)], {
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const parsed: unknown = JSON.parse(result.stdout.toString());
  if (!Array.isArray(parsed)) return null;
  const answers: (null | string)[] = [];
  for (const one of parsed) {
    if (one !== null && typeof one !== "string") return null;
    answers.push(one);
  }
  return answers;
}

/** The words the escaping must carry exactly: the three the doubled quote broke, and more. */
const GVARIANT_TEXTS = [
  "Claude's turn",
  "C:\\new",
  "a trailing backslash \\",
  "don’t",
  "a & b <tag>",
  'a "quoted" word',
  "line one\nline two",
  "a\ttab",
  "100% sure",
  "🎉 é ünïcode",
];

describe("the windows the alert raises", () => {
  it("the terminal's own window id: windowactivate of that id", () => {
    const tools = desktopTools(toolsWhich(["xdotool"]));
    const { run } = fakeRunner([]);
    expect(
      raiseArgv({ folder: "", name: "", program: "xterm", windowId: "12345" }, tools, run),
    ).toEqual(["/usr/bin/xdotool", "windowactivate", "12345"]);
  });

  it("VS Code: the window whose title names the folder, else the first, never a helper window", () => {
    const tools = desktopTools(toolsWhich(["xdotool"]));
    const { run, runs } = fakeRunner([
      { stdout: "10\n11\n12\n" },
      { stdout: "app.ts - other-app - Visual Studio Code" },
      { stdout: "app.ts - my-app - Visual Studio Code" },
      { stdout: "hidden helper" },
    ]);
    expect(
      raiseArgv({ folder: "my-app", name: "", program: "vscode", windowId: "9" }, tools, run),
    ).toEqual(["/usr/bin/xdotool", "windowactivate", "11"]);
    // The walk: the class search, then one title per window.
    expect(runs.map((one) => one.argv)).toEqual([
      ["/usr/bin/xdotool", "search", "--class", "^(code|com\\.microsoft\\.vscode)$"],
      ["/usr/bin/xdotool", "getwindowname", "10"],
      ["/usr/bin/xdotool", "getwindowname", "11"],
      ["/usr/bin/xdotool", "getwindowname", "12"],
    ]);
  });

  it("VS Code with no window naming the folder: the first one; and a failed walk runs once more", () => {
    const tools = desktopTools(toolsWhich(["xdotool"]));
    const first = fakeRunner([
      { stdout: "10\n" },
      { stdout: "app.ts - other-app - Visual Studio Code" },
    ]);
    expect(
      raiseArgv({ folder: "my-app", name: "", program: "vscode", windowId: "" }, tools, first.run),
    ).toEqual(["/usr/bin/xdotool", "windowactivate", "10"]);
    // xdotool stops on BadWindow when a window closes while it walks: one retry, exactly.
    const retry = fakeRunner([
      { exitCode: 1, stdout: "" },
      { stdout: "20\n" },
      { stdout: "app.ts - my-app - Visual Studio Code" },
    ]);
    expect(
      raiseArgv({ folder: "my-app", name: "", program: "vscode", windowId: "" }, tools, retry.run),
    ).toEqual(["/usr/bin/xdotool", "windowactivate", "20"]);
    expect(retry.runs).toHaveLength(3);
  });

  it("Warp: the window whose title names the session, else the first; WINDOWID is not used", () => {
    const tools = desktopTools(toolsWhich(["xdotool"]));
    const { run } = fakeRunner([
      { stdout: "30\n31\n" },
      { stdout: "Warp — something else" },
      { stdout: "Warp — my-app" },
    ]);
    expect(
      raiseArgv(
        { folder: "my-app", name: "my-app", program: "WarpTerminal", windowId: "9" },
        tools,
        run,
      ),
    ).toEqual(["/usr/bin/xdotool", "windowactivate", "31"]);
  });

  it("no xdotool, or no window to name: nothing", () => {
    const { run } = fakeRunner([]);
    expect(
      raiseArgv(
        { folder: "", name: "", program: "xterm", windowId: "12345" },
        desktopTools(toolsWhich([])),
        run,
      ),
    ).toBeNull();
    expect(
      raiseArgv(
        { folder: "", name: "", program: "xterm", windowId: "" },
        desktopTools(toolsWhich(["xdotool"])),
        run,
      ),
    ).toBeNull();
  });
});

describe("what the worker sends to the notification server", () => {
  it("the Notify call: the words, the two buttons, the urgency, and the server's own expiry", () => {
    const argv = notifyCallArgv("/usr/bin/gdbus", ALERT, true);
    expect(argv).toEqual([
      "/usr/bin/gdbus",
      "call",
      "--session",
      "--dest",
      "org.freedesktop.Notifications",
      "--object-path",
      "/org/freedesktop/Notifications",
      "--method",
      "org.freedesktop.Notifications.Notify",
      // `--` before the arguments: the expiry is `-1`, which gdbus would read as an option.
      "--",
      "'cc-smart-dev-kit'",
      "0",
      "'utilities-terminal'",
      "'Claude needs you · my-app'",
      "'Claude needs your permission to use Bash'",
      "['default', 'Open', 'dismiss', 'Dismiss']",
      "{'urgency': <byte 2>}",
      "-1",
    ]);
    // An ordinary alert is urgency 1; a server without the actions capability gets none.
    expect(notifyCallArgv("/usr/bin/gdbus", { ...ALERT, critical: false }, false).at(-2)).toBe(
      "{'urgency': <byte 1>}",
    );
    expect(notifyCallArgv("/usr/bin/gdbus", ALERT, false).at(-3)).toBe("[]");
  });

  it("a quote or markup in the words cannot change the call", () => {
    // The format has no doubled quote: `\` and `'` are escaped the C way, `\` first.
    expect(gvariantString("it's <b>bold</b>")).toBe("'it\\'s <b>bold</b>'");
    expect(gvariantString("C:\\new")).toBe("'C:\\\\new'");
    expect(gvariantString("a trailing \\")).toBe("'a trailing \\\\'");
    expect(gvariantString("plain")).toBe("'plain'");
    expect(gvariantString("")).toBe("''");
    expect(escapedMarkup("a & b <tag>")).toBe("a &amp; b &lt;tag&gt;");
    const argv = notifyCallArgv("/usr/bin/gdbus", { ...ALERT, body: "a & b <tag>" }, true);
    expect(argv.at(-4)).toBe("'a &amp; b &lt;tag&gt;'");
  });

  it("the words come back exactly: a quote, a backslash, a control character, an emoji", () => {
    for (const text of GVARIANT_TEXTS) {
      expect(readsGvariantString(gvariantString(text))).toBe(text);
    }
  });

  it.skipIf(!hasGlib())("GLib's own parser reads back exactly what went in", () => {
    const answers = glibReads([
      ...GVARIANT_TEXTS.map((text) => gvariantString(text)),
      // What this code used to write, which is no escape in this format at all: GLib refuses
      // the first whole ("8:expected end of input", the notification that never showed),
      // reads the second as `C:` and a line break, and leaves the third unterminated.
      "'Claude''s turn'",
      "'C:\\new'",
      "'trailing\\'",
    ]);
    expect(answers?.slice(0, GVARIANT_TEXTS.length)).toEqual(GVARIANT_TEXTS);
    expect(answers?.slice(GVARIANT_TEXTS.length)).toEqual([null, "C:\new", null]);
  });

  it("the answers: the server's capabilities, the notification id, and the signals", () => {
    const { run } = fakeRunner([{ stdout: "(['body', 'body-markup', 'actions'],)\n" }]);
    expect(serverCapabilities("/usr/bin/gdbus", run)).toEqual(["body", "body-markup", "actions"]);
    const failed = fakeRunner([{ exitCode: 1, stdout: "" }]);
    expect(serverCapabilities("/usr/bin/gdbus", failed.run)).toBeNull();

    expect(notifiedId({ exitCode: 0, stdout: "(uint32 42,)\n" })).toBe(42);
    expect(notifiedId({ exitCode: 0, stdout: "(uint32 42,)" })).toBe(42);
    expect(notifiedId({ exitCode: 1, stdout: "(uint32 42,)" })).toBeNull();
    expect(notifiedId({ exitCode: 0, stdout: "()" })).toBeNull();

    expect(actionOf(actionLine(42, "default"), 42)).toBe("default");
    expect(actionOf(actionLine(42, "dismiss"), 42)).toBe("dismiss");
    expect(actionOf(actionLine(41, "default"), 42)).toBeNull();
    expect(actionOf(closedLine(42, 2), 42)).toBeNull();
    expect(closedReasonOf(closedLine(42, 2), 42)).toBe(2);
    expect(closedReasonOf(closedLine(42, 1), 42)).toBe(1);
    expect(closedReasonOf(closedLine(41, 2), 42)).toBeNull();
    expect(closedReasonOf(actionLine(42, "default"), 42)).toBeNull();

    expect(busCallArgv("/usr/bin/gdbus", "GetCapabilities", [])).toContain(
      "org.freedesktop.Notifications.GetCapabilities",
    );
    expect(closeCallArgv("/usr/bin/gdbus", 7).at(-1)).toBe("7");
  });

  it("the notify-send alert: the two buttons, the urgency, and the flags its help listed", () => {
    expect(
      notifySendAlertArgv(
        "/usr/bin/notify-send",
        ALERT,
        { actions: true, expire: true, wait: true },
        60_000,
      ),
    ).toEqual([
      "/usr/bin/notify-send",
      "--app-name=cc-smart-dev-kit",
      "--icon=utilities-terminal",
      "--urgency=critical",
      "--action=default=Open",
      "--action=dismiss=Dismiss",
      "--expire-time=60000",
      "--wait",
      "Claude needs you · my-app",
      "Claude needs your permission to use Bash",
    ]);
    // A help without the flags adds none of them (and the caller will not take this route).
    expect(
      notifySendAlertArgv(
        "/usr/bin/notify-send",
        { ...ALERT, critical: false },
        { actions: false, expire: false, wait: false },
        60_000,
      ),
    ).toEqual([
      "/usr/bin/notify-send",
      "--app-name=cc-smart-dev-kit",
      "--icon=utilities-terminal",
      "--urgency=normal",
      "--action=default=Open",
      "--action=dismiss=Dismiss",
      "Claude needs you · my-app",
      "Claude needs your permission to use Bash",
    ]);
  });

  it("the help text says which flags this notify-send has", () => {
    expect(
      notifySendCapabilities("-A, --action=[NAME=]Text\n-w, --wait\n-t, --expire-time=TIME\n"),
    ).toEqual({
      actions: true,
      expire: true,
      wait: true,
    });
    expect(notifySendCapabilities("Usage: notify-send [OPTION…] <SUMMARY> [BODY]\n")).toEqual({
      actions: false,
      expire: false,
      wait: false,
    });
    // The probe a worker or hook makes: gdbus alone is enough; without it, the help decides.
    const { run, runs } = fakeRunner([]);
    expect(canWaitForClick(desktopTools(toolsWhich(["gdbus"])), run)).toBe(true);
    expect(runs).toEqual([]);
    const withSend = fakeRunner([{ stdout: "--action --wait\n" }]);
    expect(canWaitForClick(desktopTools(toolsWhich(["notify-send"])), withSend.run)).toBe(true);
    const without = fakeRunner([{ stdout: "Usage: notify-send\n" }]);
    expect(canWaitForClick(desktopTools(toolsWhich(["notify-send"])), without.run)).toBe(false);
    expect(canWaitForClick(desktopTools(toolsWhich([])), run)).toBe(false);
  });
});

describe("the worker waits for the click", () => {
  it("the Open button: the window is raised, and the record goes", async () => {
    const stateDir = tempDir("desktop-alert");
    const { run, runs } = fakeRunner(BUS_ANSWERS);
    const { stopped, watch } = watching([actionLine(42, "default")]);
    const outcome = await runDesktopAlert(ALERT, {
      ...baseDeps(stateDir),
      capture: run,
      sleep: never,
      watch,
    });
    expect(outcome).toBe("raised");
    expect(runs.map((one) => one.argv)).toEqual([
      busCallArgv("/usr/bin/gdbus", "GetCapabilities", []),
      notifyCallArgv("/usr/bin/gdbus", ALERT, true),
      ["/usr/bin/xdotool", "windowactivate", "12345"],
    ]);
    // The monitor watched our notification, and was ended with the wait.
    expect(stopped()).toBe(true);
    // The record is gone: this session has nothing on screen now.
    expect(() => readFileSync(shownStateFile(stateDir, "s-1"), "utf8")).toThrow();
  });

  it("a click anywhere on the popup raises too (closed reason 2); Dismiss, and the expiry, do not", async () => {
    const stateDir = tempDir("desktop-alert");
    const clicked = watching([closedLine(42, 2)]);
    const { run } = fakeRunner(BUS_ANSWERS);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: run,
        sleep: never,
        watch: clicked.watch,
      }),
    ).toBe("raised");

    const dismissed = watching([actionLine(42, "dismiss")]);
    const dismissedRun = fakeRunner(BUS_ANSWERS);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: dismissedRun.run,
        sleep: never,
        watch: dismissed.watch,
      }),
    ).toBe("shown");
    expect(dismissedRun.runs.map((one) => one.argv[0])).toEqual([
      "/usr/bin/gdbus",
      "/usr/bin/gdbus",
    ]);

    // The server's own expiry (reason 1): the alert is in the centre already, nothing raises.
    const expired = watching([closedLine(42, 1)]);
    const expiredRun = fakeRunner(BUS_ANSWERS);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: expiredRun.run,
        sleep: never,
        watch: expired.watch,
      }),
    ).toBe("shown");
    expect(expiredRun.runs).toHaveLength(2);

    // Another notification's signals are not ours.
    const other = watching([actionLine(41, "default")]);
    const otherRun = fakeRunner(BUS_ANSWERS);
    await runDesktopAlert(ALERT, {
      ...baseDeps(stateDir),
      capture: otherRun.run,
      sleep: atOnce,
      watch: other.watch,
    });
    expect(otherRun.runs.map((one) => one.argv[0])).toEqual([
      "/usr/bin/gdbus",
      "/usr/bin/gdbus",
      "/usr/bin/gdbus",
    ]);
    expect(otherRun.runs[2]?.argv.at(-1)).toBe("42");
  });

  it("the minute: the alert is closed by a call, and nothing is raised", async () => {
    const stateDir = tempDir("desktop-alert");
    const { run, runs } = fakeRunner(BUS_ANSWERS);
    const silent = watching([]);
    const outcome = await runDesktopAlert(ALERT, {
      ...baseDeps(stateDir),
      capture: run,
      sleep: atOnce,
      watch: silent.watch,
    });
    expect(outcome).toBe("shown");
    expect(silent.stopped()).toBe(true);
    expect(runs.map((one) => one.argv)).toEqual([
      busCallArgv("/usr/bin/gdbus", "GetCapabilities", []),
      notifyCallArgv("/usr/bin/gdbus", ALERT, true),
      closeCallArgv("/usr/bin/gdbus", 42),
    ]);
  });

  it("one alert per session: the previous notification is closed first, and the new id is recorded", async () => {
    const stateDir = tempDir("desktop-alert");
    const record = shownStateFile(stateDir, "s-1");
    writeFileSync(record, "41\n");
    // The capabilities answer, the close of the previous one, then the `Notify` answer.
    const { run, runs } = fakeRunner([
      { stdout: "(['body', 'actions'],)\n" },
      {},
      { stdout: "(uint32 42,)\n" },
    ]);
    const seen: string[] = [];
    const watch: Watch = (_argv, onLine) => {
      // The wait starts after the record was written: read it from inside.
      seen.push(readFileSync(record, "utf8"));
      for (const line of [actionLine(42, "default")]) onLine(line);
      return { stop: () => undefined };
    };
    expect(
      await runDesktopAlert(ALERT, { ...baseDeps(stateDir), capture: run, sleep: never, watch }),
    ).toBe("raised");
    expect(runs.map((one) => one.argv)).toEqual([
      busCallArgv("/usr/bin/gdbus", "GetCapabilities", []),
      closeCallArgv("/usr/bin/gdbus", 41),
      notifyCallArgv("/usr/bin/gdbus", ALERT, true),
      ["/usr/bin/xdotool", "windowactivate", "12345"],
    ]);
    expect(seen).toEqual(["42"]);
  });

  it("a server without the actions capability: the same alert, no buttons", async () => {
    const stateDir = tempDir("desktop-alert");
    const { run, runs } = fakeRunner([{ stdout: "(['body'],)\n" }, { stdout: "(uint32 42,)\n" }]);
    const { watch } = watching([]);
    expect(
      await runDesktopAlert(ALERT, { ...baseDeps(stateDir), capture: run, sleep: atOnce, watch }),
    ).toBe("shown");
    expect(runs[1]?.argv).toEqual(notifyCallArgv("/usr/bin/gdbus", ALERT, false));
  });

  it("no bus: notify-send with its two flags, and the click it reports", async () => {
    const stateDir = tempDir("desktop-alert");
    const which = toolsWhich(["notify-send", "xdotool"]);
    const { run, runs } = fakeRunner([
      { stdout: "-A, --action=[NAME=]Text\n-w, --wait\n-t, --expire-time=TIME\n" },
      { stdout: "default\n" },
    ]);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: run,
        sleep: never,
        watch: watching([]).watch,
        which,
      }),
    ).toBe("raised");
    expect(runs.map((one) => one.argv)).toEqual([
      ["/usr/bin/notify-send", "--help"],
      notifySendAlertArgv(
        "/usr/bin/notify-send",
        ALERT,
        { actions: true, expire: true, wait: true },
        ALERT_SCREEN_MS,
      ),
      ["/usr/bin/xdotool", "windowactivate", "12345"],
    ]);
  });

  it("notify-send: a click on the popup raises, the expiry and a killed wait do not, and a failed run falls back", async () => {
    const stateDir = tempDir("desktop-alert");
    const which = toolsWhich(["notify-send", "xdotool"]);
    const help = { stdout: "-A, --action=[NAME=]Text\n-w, --wait\n" };
    /** The wait's length, as the worker's clock reads it: 0 first, then `tookMs`. */
    const clockOf = (tookMs: number) => {
      let first = true;
      return () => {
        if (first) {
          first = false;
          return 0;
        }
        return tookMs;
      };
    };

    // No action, back inside the minute: a click on the popup itself, which raises.
    const clicked = fakeRunner([help, { stdout: "" }]);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: clicked.run,
        nowMs: clockOf(3_000),
        sleep: never,
        watch: watching([]).watch,
        which,
      }),
    ).toBe("raised");
    expect(clicked.runs.at(-1)?.argv).toEqual(["/usr/bin/xdotool", "windowactivate", "12345"]);

    // No action, back at the minute: the expiry, and nothing raises.
    const expired = fakeRunner([help, { stdout: "" }]);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: expired.run,
        nowMs: clockOf(ALERT_SCREEN_MS),
        sleep: never,
        watch: watching([]).watch,
        which,
      }),
    ).toBe("shown");
    expect(expired.runs).toHaveLength(2);

    // The wait itself was killed: the same, nothing raises.
    const killed = fakeRunner([help, { stdout: "", timedOut: true }]);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: killed.run,
        sleep: never,
        watch: watching([]).watch,
        which,
      }),
    ).toBe("shown");
    expect(killed.runs).toHaveLength(2);

    // The run fails ("Actions are not supported"): the plain notification still shows.
    const failed = fakeRunner([help, { exitCode: 1, stdout: "Actions are not supported\n" }, {}]);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: failed.run,
        sleep: never,
        watch: watching([]).watch,
        which,
      }),
    ).toBe("shown");
    expect(failed.runs.at(-1)?.argv).toEqual([
      "/usr/bin/notify-send",
      "--urgency=critical",
      "Claude needs you · my-app",
      "Claude needs your permission to use Bash",
    ]);
  });

  it("no notifier at all: the caller says the words on stderr", async () => {
    const stateDir = tempDir("desktop-alert");
    const { run, runs } = fakeRunner([]);
    expect(
      await runDesktopAlert(ALERT, {
        ...baseDeps(stateDir),
        capture: run,
        sleep: never,
        watch: watching([]).watch,
        which: toolsWhich([]),
      }),
    ).toBe("no notifier");
    expect(runs).toEqual([]);
  });
});

describe("the desktop rules and the wire shape", () => {
  it("a desktop is DISPLAY or WAYLAND_DISPLAY on Linux; macOS and Windows always have one", () => {
    expect(hasDesktop("linux", { DISPLAY: ":0" })).toBe(true);
    expect(hasDesktop("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(hasDesktop("linux", {})).toBe(false);
    expect(hasDesktop("linux", { DISPLAY: "" })).toBe(false);
    expect(hasDesktop("darwin", {})).toBe(true);
    expect(hasDesktop("win32", {})).toBe(true);
  });

  it("the Do-Not-Disturb check reads XFCE's own setting, and anything else counts as off", () => {
    const tools = desktopTools(toolsWhich(["xfconf-query"]));
    const on = fakeRunner([{ stdout: "true\n" }]);
    expect(dndOn(tools, on.run)).toBe(true);
    expect(on.runs[0]?.argv).toEqual([
      "/usr/bin/xfconf-query",
      "-c",
      "xfce4-notifyd",
      "-p",
      "/do-not-disturb",
    ]);
    const off = fakeRunner([{ stdout: "false\n" }]);
    expect(dndOn(tools, off.run)).toBe(false);
    // No xfconf-query (not XFCE), or a call that fails: the sound plays as always.
    const none = fakeRunner([]);
    expect(dndOn(desktopTools(toolsWhich([])), none.run)).toBe(false);
    const broken = fakeRunner([{ exitCode: 1, stdout: "true\n" }]);
    expect(dndOn(tools, broken.run)).toBe(false);
  });

  it("the record file is one per session, and an id from outside never becomes a path", () => {
    expect(shownStateFile("/run/user/1", "abc-123")).toBe(
      "/run/user/1/cc-smart-dev-kit-notify-shown-abc-123",
    );
    expect(shownStateFile("/run/user/1", "../etc/passwd")).toBe(
      "/run/user/1/cc-smart-dev-kit-notify-shown-etcpasswd",
    );
    expect(shownStateFile("/run/user/1", "")).toBe(
      "/run/user/1/cc-smart-dev-kit-notify-shown-none",
    );
  });

  it("the payload: what the hook writes, and what a broken argument gives", () => {
    const built = notifyWorkerAlert(
      { body: "b", critical: true, title: "t" },
      {
        folder: "my-app",
        name: "the alerts",
        program: "WarpTerminal",
        session: "s-1",
        windowId: "9",
      },
    );
    expect(built).toEqual({
      body: "b",
      critical: true,
      kind: "notify",
      session: "s-1",
      title: "t",
      window: { folder: "my-app", name: "the alerts", program: "WarpTerminal", windowId: "9" },
    });
    expect(parseNotifyWorkerAlert(JSON.stringify(built))).toEqual(built);
    // The usage-limit alert's shape is not this one.
    expect(parseNotifyWorkerAlert(JSON.stringify({ body: "b", title: "t" }))).toBeNull();
    expect(parseNotifyWorkerAlert("not json")).toBeNull();
    expect(parseNotifyWorkerAlert(JSON.stringify({ kind: "notify", title: "t" }))).toBeNull();
    // A window id that is not digits cannot name a window: it is dropped, never passed on.
    const odd = parseNotifyWorkerAlert(
      JSON.stringify({ ...built, window: { folder: 1, windowId: "12; rm -rf" } }),
    );
    expect(odd?.window).toEqual({ folder: "", name: "", program: "", windowId: "" });
  });
});

/** A `sleep` that never resolves: the click decides the race, never the minute. */
const never = (): Promise<void> => new Promise<void>(() => undefined);

/** A `sleep` that resolves at once: the minute decides the race. */
const atOnce = (): Promise<void> => Promise.resolve();
