/**
 * The self-update: the SessionStart hook, the detached background check, and
 * `anymodel update`. Everything runs in a temp HOME and CLAUDE_CONFIG_DIR, with fakes first
 * on PATH for `git` (ls-remote, rev-parse, the shallow fetch), `claude` (the two plugin
 * commands) and the notifiers. Each fake logs its calls, so the tests assert them.
 * Nothing here reaches the network, the real ~/.claude or the real `claude`.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { withLock } from "../setup/lock";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { installedText, notifyCommand } from "./apply";
import { backgroundCheck, sessionStart } from "./background";
import { isOlder } from "./check";
import {
  CHECK_INTERVAL_MS,
  isDue,
  readLastCheck,
  registerSession,
  runningSessions,
  updateFiles,
  writeLastCheck,
} from "./state";

const HOOK = join(import.meta.dir, "..", "entries", "update-check.ts");
const CLI = join(import.meta.dir, "..", "entries", "cli.ts");
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);

interface MachineOptions {
  /** The installed version. Default 1.0.0. */
  installed?: string;
  /** The version in Claude Code's copy of the marketplace. Default 1.0.0. */
  inCopy?: string;
  /** The remote head, and the copy's head. Default: both HEAD_A (the copy is current). */
  remoteHead?: string;
  localHead?: string;
  /** The version a refresh brings to the copy, and an update installs. Default 1.1.0. */
  newVersion?: string;
  /** The version in the remote head's plugin.json (the shallow fetch). Default newVersion. */
  remoteVersion?: string;
  /** ls-remote fails. */
  gitFails?: boolean;
  /** `claude plugin update` fails. */
  claudeFails?: boolean;
  /** Seconds the fake `claude` sleeps in `marketplace update`. */
  claudeSleeps?: number;
}

/** A temp machine as `claude plugin install anymodel@anymodel` leaves it, with fakes on PATH. */
function machine(options: MachineOptions = {}) {
  const home = tempDir("update");
  const configDir = join(home, ".claude");
  const plugins = join(configDir, "plugins");
  const copy = join(plugins, "marketplaces", "anymodel");
  const installPath = join(plugins, "cache", "anymodel", "anymodel", options.installed ?? "1.0.0");
  const newVersion = options.newVersion ?? "1.1.0";
  mkdirSync(join(copy, ".claude-plugin"), { recursive: true });
  mkdirSync(join(copy, "plugin", ".claude-plugin"), { recursive: true });
  mkdirSync(installPath, { recursive: true });
  const installed = (version: string) =>
    JSON.stringify({
      plugins: { "anymodel@anymodel": [{ installPath, scope: "user", version }] },
      version: 2,
    });
  const copyManifest = (version: string) => JSON.stringify({ name: "anymodel", version });
  const marketplaceJson = JSON.stringify({
    name: "anymodel",
    plugins: [{ name: "anymodel", source: "./plugin" }],
  });
  writeFileSync(join(plugins, "installed_plugins.json"), installed(options.installed ?? "1.0.0"));
  writeFileSync(join(copy, ".claude-plugin", "marketplace.json"), marketplaceJson);
  writeFileSync(
    join(copy, "plugin", ".claude-plugin", "plugin.json"),
    copyManifest(options.inCopy ?? "1.0.0"),
  );
  writeFileSync(
    join(plugins, "known_marketplaces.json"),
    JSON.stringify({
      anymodel: {
        installLocation: copy,
        source: { repo: "example-org/anymodel", source: "github" },
      },
    }),
  );

  // What the fakes read and write.
  const fake = join(home, "fake");
  const bin = join(fake, "bin");
  mkdirSync(bin, { recursive: true });
  const remoteHead = options.remoteHead ?? HEAD_A;
  writeFileSync(join(fake, "local-head"), `${options.localHead ?? HEAD_A}\n`);
  writeFileSync(join(fake, "installed-after"), installed(newVersion));
  writeFileSync(join(fake, "copy-after"), copyManifest(newVersion));
  writeFileSync(join(fake, "remote-marketplace"), marketplaceJson);
  writeFileSync(join(fake, "remote-plugin"), copyManifest(options.remoteVersion ?? newVersion));
  const q = (path: string) => `'${path}'`;
  const script = (name: string, lines: string[]) => {
    writeFileSync(join(bin, name), ["#!/bin/sh", ...lines, ""].join("\n"));
    chmodSync(join(bin, name), 0o755);
  };
  script("git", [
    `echo "$*" >> ${q(join(fake, "git.log"))}`,
    'case "$*" in',
    "  config*) exit 1 ;;",
    options.gitFails === true
      ? "  ls-remote*) echo 'fatal: could not read from remote repository' >&2; exit 128 ;;"
      : `  ls-remote*) printf '%s\\tHEAD\\n' '${remoteHead}' ;;`,
    `  *rev-parse*) cat ${q(join(fake, "local-head"))} ;;`,
    `  *show*marketplace.json*) cat ${q(join(fake, "remote-marketplace"))} ;;`,
    `  *show*plugin.json*) cat ${q(join(fake, "remote-plugin"))} ;;`,
    "esac",
    "exit 0",
  ]);
  script("claude", [
    `echo "$*" >> ${q(join(fake, "claude.log"))}`,
    'case "$*" in',
    `  "plugin marketplace update anymodel") sleep ${options.claudeSleeps ?? 0}; cp ${q(join(fake, "copy-after"))} ${q(join(copy, "plugin", ".claude-plugin", "plugin.json"))}; echo '${remoteHead}' > ${q(join(fake, "local-head"))}; echo refreshed ;;`,
    options.claudeFails === true
      ? '  "plugin update anymodel@anymodel --scope user") echo "Failed to update: network" >&2; exit 1 ;;'
      : `  "plugin update anymodel@anymodel --scope user") cp ${q(join(fake, "installed-after"))} ${q(join(plugins, "installed_plugins.json"))}; echo updated ;;`,
    "esac",
  ]);
  for (const notifier of ["notify-send", "osascript"]) {
    script(notifier, [`echo "${notifier} $*" >> ${q(join(fake, "notify.log"))}`]);
  }

  const env: Record<string, string> = {
    CLAUDE_CONFIG_DIR: configDir,
    // The test's own process: alive, so the session record stays.
    CLAUDE_PID: String(process.pid),
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
  };
  const paths = cliPaths(env);
  const files = updateFiles(paths.stateDir);
  const read = (name: string) => {
    const file = join(fake, name);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  };
  const spawn = async (argv: string[], input?: string) => {
    const guard = subprocessGuard();
    const started = performance.now();
    const proc = Bun.spawn([process.execPath, ...guard.args, ...argv], {
      env: { ...env, ...guard.env },
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, ms: performance.now() - started, stderr, stdout };
  };
  /** The SessionStart hook, as Claude Code runs it: JSON on stdin. */
  const hook = () =>
    spawn([HOOK], JSON.stringify({ cwd: home, hook_event_name: "SessionStart", session_id: "s1" }));
  const cli = (args: string[]) => spawn([CLI, ...args]);
  /** Waits until the background check wrote a result other than "checking". */
  const settled = async (timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const last = readLastCheck(files);
      if (last !== null && last.result !== "checking") return last;
      if (Date.now() > deadline)
        throw new Error(`no result after ${timeoutMs} ms: ${read("git.log")}`);
      await Bun.sleep(50);
    }
  };
  const installedVersion = () =>
    JSON.parse(readFileSync(join(plugins, "installed_plugins.json"), "utf8")).plugins[
      "anymodel@anymodel"
    ][0].version as string;
  return { cli, env, files, home, hook, installedVersion, paths, read, settled };
}

describe("the SessionStart hook and the background check, end to end", () => {
  test("a newer version: the hook returns at once with no output; the detached check refreshes, updates, logs and notifies", async () => {
    // The refresh takes 3 s: the hook must not wait for it.
    const m = machine({ claudeSleeps: 3, remoteHead: HEAD_B });
    const run = await m.hook();
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.ms).toBeLessThan(2_000);
    const last = await m.settled();
    expect(last.result).toBe("updated");
    expect(last.detail).toBe("1.1.0 (was 1.0.0)");
    expect(m.read("claude.log")).toBe(
      "plugin marketplace update anymodel\nplugin update anymodel@anymodel --scope user\n",
    );
    expect(m.installedVersion()).toBe("1.1.0");
    expect(m.read("notify.log")).toBe(
      "notify-send anymodel anymodel 1.1.0 installed; restart Claude sessions to load it\n",
    );
    // git: the remote head (no password prompt), then the copy's head.
    expect(m.read("git.log")).toBe(
      [
        "config --get core.sshCommand",
        "ls-remote git@github.com:example-org/anymodel.git HEAD",
        `-C ${join(m.home, ".claude", "plugins", "marketplaces", "anymodel")} rev-parse HEAD`,
        "",
      ].join("\n"),
    );
    const log = readFileSync(m.files.log, "utf8").replace(/^\S+ /gm, "");
    expect(log).toBe(
      [
        "newer: installed 1.0.0, the marketplace copy 1.0.0, and the copy is behind the remote",
        "run: claude plugin marketplace update anymodel",
        "run: claude plugin update anymodel@anymodel --scope user",
        "updated: 1.1.0 (was 1.0.0)",
        "",
      ].join("\n"),
    );
  }, 30_000);

  test("the same version and the same head: nothing runs, nothing is notified", async () => {
    const m = machine();
    const run = await m.hook();
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("");
    const last = await m.settled();
    expect(last).toEqual({ at: last.at, detail: "1.0.0", result: "up-to-date" });
    expect(m.read("claude.log")).toBe("");
    expect(m.read("notify.log")).toBe("");
  }, 30_000);

  test("the copy was refreshed but the update not installed (the auto-update bug): only the update installs it", async () => {
    const m = machine({ inCopy: "1.1.0" });
    await m.hook();
    expect((await m.settled()).result).toBe("updated");
    // The refresh runs first all the same: it is cheap, and the copy may be behind too.
    expect(m.read("claude.log")).toBe(
      "plugin marketplace update anymodel\nplugin update anymodel@anymodel --scope user\n",
    );
  }, 30_000);

  test("new commits but no new version: the refresh runs, no update, no notification", async () => {
    const m = machine({ newVersion: "1.0.0", remoteHead: HEAD_B });
    await m.hook();
    expect(await m.settled()).toMatchObject({ detail: "1.0.0", result: "up-to-date" });
    expect(m.read("claude.log")).toBe("plugin marketplace update anymodel\n");
    expect(m.read("notify.log")).toBe("");
  }, 30_000);

  test("a failed update: recorded; the next session start says so once, as a systemMessage", async () => {
    const m = machine({ claudeFails: true, remoteHead: HEAD_B });
    await m.hook();
    const last = await m.settled();
    expect(last.result).toBe("failed");
    expect(last.detail).toBe(
      "claude plugin update anymodel@anymodel --scope user failed (exit 1): Failed to update: network",
    );
    expect(m.read("notify.log")).toBe("");
    const told = await m.hook();
    expect(JSON.parse(told.stdout)).toEqual({
      systemMessage: `anymodel: the background update failed at ${last.at} (${last.detail}). The log: ~/.claude/anymodel/update.log. To try now: anymodel update`,
    });
    expect(told.stderr).toBe("");
    // Once: the next session is not told again.
    expect((await m.hook()).stdout).toBe("");
  }, 30_000);

  test("an unreachable marketplace: a failed check naming both URLs, nothing run", async () => {
    const m = machine({ gitFails: true });
    await m.hook();
    const last = await m.settled();
    expect(last.result).toBe("failed");
    expect(last.detail).toBe(
      "cannot read the marketplace (git@github.com:example-org/anymodel.git: fatal: could not read from remote repository; https://github.com/example-org/anymodel.git: fatal: could not read from remote repository)",
    );
    expect(m.read("claude.log")).toBe("");
  }, 30_000);
});

/** The hook's logic in this process, with a spy for the background start. */
function hookHere(m: ReturnType<typeof machine>, nowMs = NOW) {
  let started = 0;
  const answer = sessionStart({
    nowMs,
    paths: m.paths,
    sessionPid: process.pid,
    spawnBackground: () => {
      started += 1;
    },
    version: "1.0.0",
  });
  return { answer, started };
}

describe("the throttle, the hold and the lock", () => {
  test("at most one check an hour: none within the hour, one at the hour", () => {
    const m = machine();
    expect(hookHere(m).started).toBe(1);
    writeLastCheck(m.files, { at: "2026-10-15T10:00:00Z", detail: "1.0.0", result: "up-to-date" });
    expect(hookHere(m, NOW + 1_000).started).toBe(0);
    expect(hookHere(m, NOW + CHECK_INTERVAL_MS - 1).started).toBe(0);
    expect(hookHere(m, NOW + CHECK_INTERVAL_MS).started).toBe(1);
    // A failed or unfinished check counts too: no retry storm while offline.
    writeLastCheck(m.files, { at: "2026-10-15T10:00:00Z", detail: "x", result: "checking" });
    expect(hookHere(m, NOW + 60_000).started).toBe(0);
  });

  test("isDue: none yet, an hour old, or in the future (the clock moved back)", () => {
    const at = (iso: string) => ({ at: iso, detail: "", result: "up-to-date" as const });
    expect(isDue(null, NOW)).toBe(true);
    expect(isDue(at("2026-10-15T09:00:00Z"), NOW)).toBe(true);
    expect(isDue(at("2026-10-15T09:00:01Z"), NOW)).toBe(false);
    expect(isDue(at("2026-10-15T10:05:00Z"), NOW)).toBe(true);
  });

  test("held: the hook starts nothing; resumed: it does again (through the CLI)", async () => {
    const m = machine();
    const held = await m.cli(["update", "--hold"]);
    expect(held.stdout).toBe(
      "Background updates are on hold: a new Claude session no longer checks for a newer anymodel. To resume: anymodel update --resume\n",
    );
    expect(held.exitCode).toBe(0);
    expect(hookHere(m).started).toBe(0);
    expect((await m.cli(["update", "--hold"])).stdout).toStartWith(
      "Background updates were already on hold (since 20",
    );
    const resumed = await m.cli(["update", "--resume"]);
    expect(resumed.stdout).toBe(
      "Background updates resume: a new Claude session checks for a newer anymodel, at most once an hour (~/.claude/anymodel/update.log).\n",
    );
    expect(hookHere(m).started).toBe(1);
    expect((await m.cli(["update", "--resume"])).stdout).toBe(
      "Background updates were not on hold.\n",
    );
  }, 30_000);

  test("held: a background check that already started does nothing either", async () => {
    const m = machine({ remoteHead: HEAD_B });
    mkdirSync(m.paths.stateDir, { recursive: true });
    writeFileSync(m.files.hold, "2026-10-15T09:00:00Z\n");
    let ran = 0;
    await backgroundCheck({
      claude: "/nowhere/claude",
      env: m.env,
      notify: () => {},
      now: () => NOW,
      paths: m.paths,
      run: () => {
        ran += 1;
        return { exitCode: 0, output: "" };
      },
    });
    expect(ran).toBe(0);
    expect(readLastCheck(m.files)).toBe(null);
  });

  test("the update lock held by a running check: a second check leaves at once, writing nothing", async () => {
    const m = machine({ remoteHead: HEAD_B });
    let ran = 0;
    let release: () => void = () => {};
    const busy = withLock(
      m.files.lockDir,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Bun.sleep(20);
    await backgroundCheck({
      claude: "/nowhere/claude",
      env: m.env,
      notify: () => {},
      now: () => NOW,
      paths: m.paths,
      run: () => {
        ran += 1;
        return { exitCode: 0, output: "" };
      },
    });
    expect(ran).toBe(0);
    expect(readLastCheck(m.files)).toBe(null);
    release();
    await busy;
  });

  test("under the lock, a check the hook thought due but another one just made is not repeated", async () => {
    const m = machine({ remoteHead: HEAD_B });
    writeLastCheck(m.files, { at: "2026-10-15T09:59:00Z", detail: "1.0.0", result: "up-to-date" });
    let ran = 0;
    await backgroundCheck({
      claude: "/nowhere/claude",
      env: m.env,
      notify: () => {},
      now: () => NOW,
      paths: m.paths,
      run: () => {
        ran += 1;
        return { exitCode: 0, output: "" };
      },
    });
    expect(ran).toBe(0);
    expect(readLastCheck(m.files)?.at).toBe("2026-10-15T09:59:00Z");
  });
});

describe("anymodel update", () => {
  test("--check: the newest; a newer one in the copy; a newer one only at the remote (read without touching the copy)", async () => {
    expect((await machine().cli(["update", "--check"])).stdout).toBe(
      "anymodel 1.0.0 is the newest version.\n",
    );
    expect((await machine({ inCopy: "1.2.0" }).cli(["update", "--check"])).stdout).toBe(
      "anymodel 1.2.0 is available (installed: 1.0.0). Run: anymodel update\n",
    );
    const remote = machine({ remoteHead: HEAD_B, remoteVersion: "2.0.0" });
    expect((await remote.cli(["update", "--check"])).stdout).toBe(
      "anymodel 2.0.0 is available (installed: 1.0.0). Run: anymodel update\n",
    );
    // No claude command, and Claude Code's copy untouched.
    expect(remote.read("claude.log")).toBe("");
    expect(remote.read("git.log")).toContain(
      "fetch -q --depth 1 --no-tags git@github.com:example-org/anymodel.git HEAD\n",
    );
    const docsOnly = machine({ remoteHead: HEAD_B, remoteVersion: "1.0.0" });
    expect((await docsOnly.cli(["update", "--check"])).stdout).toBe(
      "anymodel 1.0.0 is the newest version (the marketplace has newer commits, with no new version).\n",
    );
    const offline = await machine({ gitFails: true }).cli(["update", "--check"]);
    expect(offline.exitCode).toBe(1);
    expect(offline.stderr).toStartWith("cannot read the marketplace (git@github.com:");
  }, 30_000);

  test("update now: each step's command, then what was installed; the check is recorded", async () => {
    const m = machine({ remoteHead: HEAD_B });
    const run = await m.cli(["update"]);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        "$ claude plugin marketplace update anymodel",
        "refreshed",
        "$ claude plugin update anymodel@anymodel --scope user",
        "updated",
        "anymodel 1.1.0 installed (was 1.0.0). Restart Claude sessions to load it.",
        "",
      ].join("\n"),
    );
    expect(readLastCheck(m.files)).toMatchObject({
      detail: "1.1.0 (was 1.0.0)",
      result: "updated",
    });
    // Nothing newer now.
    expect((await m.cli(["update"])).stdout).toBe("anymodel 1.1.0 is up to date.\n");
  }, 30_000);

  test("a wrong option: the usage, exit 2", async () => {
    const run = await machine().cli(["update", "--now"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toBe(
      "Unknown option: --now\n\nUsage: anymodel update [--check | --hold | --resume]\n",
    );
  }, 30_000);
});

describe("running sessions and the version they loaded", () => {
  test("the hook records its session; a record of a process that is gone is dropped", () => {
    const m = machine();
    mkdirSync(m.files.sessions, { recursive: true });
    // A pid that is not running (pid_max is far below this), and a temp file of a write.
    writeFileSync(
      join(m.files.sessions, "999999999.json"),
      JSON.stringify({ pid: 999_999_999, start: "proc:1", version: "0.9.0" }),
    );
    writeFileSync(join(m.files.sessions, ".tmp-123"), "half");
    registerSession(m.files, process.pid, "1.0.0");
    expect(existsSync(join(m.files.sessions, "999999999.json"))).toBe(false);
    expect(existsSync(join(m.files.sessions, ".tmp-123"))).toBe(true);
    expect(runningSessions(m.files).map((s) => [s.pid, s.version])).toEqual([
      [process.pid, "1.0.0"],
    ]);
  });

  test("doctor: no check yet; then an older running session after an update; a failed check is a ✗", async () => {
    const m = machine();
    const before = await m.cli(["doctor"]);
    expect(before.stdout).toContain(
      "· background update: no check yet (a new Claude session checks, at most once an hour)\n",
    );
    // This test's process stands for a session that loaded 1.0.0; then 1.1.0 is installed.
    registerSession(m.files, process.pid, "1.0.0");
    writeFileSync(
      join(m.home, ".claude", "plugins", "installed_plugins.json"),
      readFileSync(join(m.home, "fake", "installed-after"), "utf8"),
    );
    writeLastCheck(m.files, {
      at: "2026-10-15T10:00:00Z",
      detail: "1.1.0 (was 1.0.0)",
      result: "updated",
    });
    const after = await m.cli(["doctor"]);
    expect(after.stdout).toContain(
      "✓ background update: last check 2026-10-15T10:00:00Z: installed 1.1.0 (was 1.0.0)\n",
    );
    expect(after.stdout).toContain(
      "· 1 running Claude session loaded anymodel 1.0.0; 1.1.0 is installed. Restart it to load it.\n",
    );
    writeLastCheck(m.files, { at: "2026-10-15T11:00:00Z", detail: "boom", result: "failed" });
    writeFileSync(m.files.hold, "2026-10-15T11:30:00Z\n");
    const failed = await m.cli(["doctor"]);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain(
      "· background updates are on hold (since 2026-10-15T11:30:00Z). To resume: anymodel update --resume\n✗ background update: the last check, 2026-10-15T11:00:00Z, failed: boom. The log: ~/.claude/anymodel/update.log. To try now: anymodel update\n",
    );
  }, 30_000);
});

describe("the notification", () => {
  const which = (found: string[]) => (command: string) =>
    found.includes(command) ? `/usr/bin/${command}` : null;

  test("notify-send on Linux, osascript on macOS, nothing elsewhere or without the tool", () => {
    const text = installedText("1.2.3");
    expect(text).toBe("anymodel 1.2.3 installed; restart Claude sessions to load it");
    expect(notifyCommand(text, "linux", which(["notify-send"]))).toEqual([
      "/usr/bin/notify-send",
      "anymodel",
      text,
    ]);
    expect(notifyCommand(text, "linux", which([]))).toBe(null);
    expect(notifyCommand(text, "darwin", which(["osascript"]))).toEqual([
      "/usr/bin/osascript",
      "-e",
      'display notification "anymodel 1.2.3 installed; restart Claude sessions to load it" with title "anymodel"',
    ]);
    expect(notifyCommand(text, "win32", which(["notify-send", "osascript"]))).toBe(null);
  });

  test("a version that is not plain text never reaches the notifier", () => {
    expect(installedText('1.0" & do shell script "x')).toBe(
      "anymodel a new version installed; restart Claude sessions to load it",
    );
    expect(installedText(null)).toBe(
      "anymodel a new version installed; restart Claude sessions to load it",
    );
  });

  test("isOlder: a missing installed version is older; a missing available one is not newer", () => {
    expect(isOlder("1.0.0", "1.1.0")).toBe(true);
    expect(isOlder("1.1.0", "1.1.0")).toBe(false);
    expect(isOlder("1.2.0", "1.1.0")).toBe(false);
    expect(isOlder(null, "1.1.0")).toBe(true);
    expect(isOlder("1.0.0", null)).toBe(false);
  });
});
