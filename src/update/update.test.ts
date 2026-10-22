/**
 * The self-update: the SessionStart hook, the detached background check, and
 * `cc-smart-dev-kit update`. Everything runs in a temp HOME and CLAUDE_CONFIG_DIR, with fakes first
 * on PATH for `git` (ls-remote, rev-parse, the shallow fetch), `claude` (the two plugin
 * commands) and the notifiers. Each fake logs its calls, so the tests assert them.
 * Nothing here reaches the network, the real ~/.claude or the real `claude`.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { decodedToastText } from "../hooks/windows-toast";
import { AUTO_UPDATE_KEY } from "../setup/auto-update";
import {
  installInstructions,
  instructionsPaths,
  optOutFile,
  readVersionStamp,
} from "../setup/instructions";
import { lockIsHeld, withLock } from "../setup/lock";
import { applyManagedJson } from "../setup/managed-json";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { capturingRunner, installedText, notifyCommand } from "./apply";
import {
  backgroundCheck,
  backgroundCheckArgv,
  backgroundCommand,
  refreshInstructionsAtSessionStart,
  sessionSourceOf,
  sessionStart,
} from "./background";
import { checkForUpdate, isOlder } from "./check";
import {
  CHECK_INTERVAL_MS,
  isDue,
  readHeldMajor,
  readLastCheck,
  registerSession,
  runningSessions,
  updateFiles,
  writeHeldMajor,
  writeLastCheck,
} from "./state";

// This file starts the CLI as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

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
  /** `claude plugin update` ends with exit 0 and installs nothing. */
  claudeInstallsNothing?: boolean;
  /** `claude plugin marketplace update` fails, printing this line on stderr. */
  refreshFails?: string;
  /** Seconds the fake `claude` sleeps in `marketplace update`. */
  claudeSleeps?: number;
  /** More environment for the hook and the CLI (Claude Code's switches, git's variables). */
  env?: Record<string, string>;
  /** The text of the copy's major-notes file (`MAJOR_NOTES_PATH`); absent: no such file. */
  majorNotes?: string;
}

/** A temp machine as `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit` leaves it, with fakes on PATH. */
function machine(options: MachineOptions = {}) {
  const home = tempDir("update");
  const configDir = join(home, ".claude");
  const plugins = join(configDir, "plugins");
  const copy = join(plugins, "marketplaces", "cc-smart-dev-kit");
  const installPath = join(
    plugins,
    "cache",
    "cc-smart-dev-kit",
    "cc-smart-dev-kit",
    options.installed ?? "1.0.0",
  );
  const newVersion = options.newVersion ?? "1.1.0";
  mkdirSync(join(copy, ".claude-plugin"), { recursive: true });
  mkdirSync(join(copy, "plugin", ".claude-plugin"), { recursive: true });
  mkdirSync(installPath, { recursive: true });
  const installed = (version: string) =>
    JSON.stringify({
      plugins: { "cc-smart-dev-kit@cc-smart-dev-kit": [{ installPath, scope: "user", version }] },
      version: 2,
    });
  const copyManifest = (version: string) => JSON.stringify({ name: "cc-smart-dev-kit", version });
  const marketplaceJson = JSON.stringify({
    name: "cc-smart-dev-kit",
    plugins: [{ name: "cc-smart-dev-kit", source: "./plugin" }],
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
      "cc-smart-dev-kit": {
        installLocation: copy,
        source: { repo: "example-org/cc-smart-dev-kit", source: "github" },
      },
    }),
  );

  if (options.majorNotes !== undefined) {
    mkdirSync(join(copy, "src", "update"), { recursive: true });
    writeFileSync(join(copy, "src", "update", "major-notes.json"), options.majorNotes);
  }

  // What the fakes read and write.
  const fake = join(home, "fake");
  const bin = join(fake, "bin");
  mkdirSync(bin, { recursive: true });
  const remoteHead = options.remoteHead ?? HEAD_A;
  const realGit = Bun.which("git");
  if (realGit === null) throw new Error("this test needs git");
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
    // The repo scan's own calls (it finds a session's checkout) reach the real git, unlogged.
    `case "$*" in *--path-format*|"worktree list"*) exec ${q(realGit)} "$@" ;; esac`,
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
    // Where it runs, and git's repo variables it was given.
    `echo "cwd=$(pwd) GIT_DIR=\${GIT_DIR-unset} GIT_WORK_TREE=\${GIT_WORK_TREE-unset} GIT_INDEX_FILE=\${GIT_INDEX_FILE-unset}" >> ${q(join(fake, "claude-env.log"))}`,
    'case "$*" in',
    options.refreshFails !== undefined
      ? `  "plugin marketplace update cc-smart-dev-kit") echo ${q(options.refreshFails)} >&2; exit 1 ;;`
      : `  "plugin marketplace update cc-smart-dev-kit") sleep ${options.claudeSleeps ?? 0}; cp ${q(join(fake, "copy-after"))} ${q(join(copy, "plugin", ".claude-plugin", "plugin.json"))}; echo '${remoteHead}' > ${q(join(fake, "local-head"))}; echo refreshed ;;`,
    options.claudeFails === true
      ? '  "plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user") echo "Failed to update: network" >&2; exit 1 ;;'
      : options.claudeInstallsNothing === true
        ? '  "plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user") echo updated ;;'
        : `  "plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user") cp ${q(join(fake, "installed-after"))} ${q(join(plugins, "installed_plugins.json"))}; echo updated ;;`,
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
    ...options.env,
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
  /**
   * Waits until the background check wrote a result other than "checking" and let go of
   * the update lock: its notification comes after the result, still under the lock.
   */
  const settled = async (timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const last = readLastCheck(files);
      if (last !== null && last.result !== "checking" && !lockIsHeld(files.lockDir)) return last;
      if (Date.now() > deadline)
        throw new Error(`no result after ${timeoutMs} ms: ${read("git.log")}`);
      await Bun.sleep(50);
    }
  };
  const installedVersion = () =>
    JSON.parse(readFileSync(join(plugins, "installed_plugins.json"), "utf8")).plugins[
      "cc-smart-dev-kit@cc-smart-dev-kit"
    ][0].version as string;
  return { cli, env, files, home, hook, installedVersion, paths, read, settled };
}

describe("backgroundCommand", () => {
  test("this bun and this bundle again, with --background and the plugin's two flags", () => {
    // The child runs bun a second time, in the home folder: without the flags bun would read
    // that folder's `.env` files and its `bunfig.toml`.
    expect(
      backgroundCommand(
        "/opt/bun/bin/bun",
        "/plugins/cc-smart-dev-kit/dist/update-check.js",
        "/plugins/cc-smart-dev-kit",
      ),
    ).toEqual([
      "/opt/bun/bin/bun",
      "--no-env-file",
      "--config=/plugins/cc-smart-dev-kit/bunfig.toml",
      "/plugins/cc-smart-dev-kit/dist/update-check.js",
      "--background",
    ]);
  });
});

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
    expect(last.detail).toBe(
      "1.1.0 (was 1.0.0); agent view's notification hook is missing: cc-smart-dev-kit setup writes it",
    );
    expect(m.read("claude.log")).toBe(
      "plugin marketplace update cc-smart-dev-kit\nplugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user\n",
    );
    expect(m.installedVersion()).toBe("1.1.0");
    expect(m.read("notify.log")).toBe(
      "notify-send cc-smart-dev-kit cc-smart-dev-kit 1.1.0 installed; restart Claude sessions to load it; agent view's notification hook is missing: cc-smart-dev-kit setup writes it\n",
    );
    // git: the remote head (no password prompt), then the copy's head.
    expect(m.read("git.log")).toBe(
      [
        "config --get core.sshCommand",
        "ls-remote git@github.com:example-org/cc-smart-dev-kit.git HEAD",
        `-C ${join(m.home, ".claude", "plugins", "marketplaces", "cc-smart-dev-kit")} rev-parse HEAD`,
        "",
      ].join("\n"),
    );
    const log = readFileSync(m.files.log, "utf8").replace(/^\S+ /gm, "");
    expect(log).toBe(
      [
        "newer: installed 1.0.0, the marketplace copy 1.0.0, and the copy is behind the remote",
        "run: claude plugin marketplace update cc-smart-dev-kit",
        "run: claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user",
        "updated: 1.1.0 (was 1.0.0); agent view's notification hook is missing: cc-smart-dev-kit setup writes it",
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

  test("D10: the session start starts the portal's own starter, detached and never waited for", async () => {
    const m = machine();
    // The installed version's bundle, as a real one would be: this one only says it ran.
    const install = JSON.parse(readFileSync(m.paths.installedPluginsFile, "utf8")) as {
      plugins: Record<string, { installPath: string }[]>;
    };
    const folder = install.plugins["cc-smart-dev-kit@cc-smart-dev-kit"]?.[0]?.installPath ?? "";
    mkdirSync(join(folder, "dist"), { recursive: true });
    writeFileSync(join(folder, "bunfig.toml"), "");
    const marker = join(m.home, "portal-starter.txt");
    writeFileSync(
      join(folder, "dist", "portal.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv.join(" "));\n`,
    );
    const run = await m.hook();
    expect(run.stdout).toBe("");
    expect(run.ms).toBeLessThan(2_000);
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(25);
    // The last of the argv: the bundle was run with `--ensure`, which does the work; the
    // hook returned without waiting for it.
    expect(readFileSync(marker, "utf8").endsWith("--ensure")).toBe(true);
  }, 30_000);

  test("D10: a `claude -p` session starts no portal", async () => {
    const m = machine({ env: { CLAUDE_CODE_SESSION_ATTENDED: "0" } });
    const install = JSON.parse(readFileSync(m.paths.installedPluginsFile, "utf8")) as {
      plugins: Record<string, { installPath: string }[]>;
    };
    const folder = install.plugins["cc-smart-dev-kit@cc-smart-dev-kit"]?.[0]?.installPath ?? "";
    mkdirSync(join(folder, "dist"), { recursive: true });
    writeFileSync(join(folder, "bunfig.toml"), "");
    const marker = join(m.home, "portal-starter.txt");
    writeFileSync(
      join(folder, "dist", "portal.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`,
    );
    await m.hook();
    await Bun.sleep(400);
    expect(existsSync(marker)).toBe(false);
  }, 30_000);

  test("the copy was refreshed but the update not installed (the auto-update bug): only the update installs it", async () => {
    const m = machine({ inCopy: "1.1.0" });
    await m.hook();
    expect((await m.settled()).result).toBe("updated");
    // The refresh runs first all the same: it is cheap, and the copy may be behind too.
    expect(m.read("claude.log")).toBe(
      "plugin marketplace update cc-smart-dev-kit\nplugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user\n",
    );
  }, 30_000);

  test("new commits but no new version: the refresh runs, no update, no notification", async () => {
    const m = machine({ newVersion: "1.0.0", remoteHead: HEAD_B });
    await m.hook();
    expect(await m.settled()).toMatchObject({ detail: "1.0.0", result: "up-to-date" });
    expect(m.read("claude.log")).toBe("plugin marketplace update cc-smart-dev-kit\n");
    expect(m.read("notify.log")).toBe("");
  }, 30_000);

  test("a failed update: recorded; the next session start says so once, as a systemMessage", async () => {
    const m = machine({ claudeFails: true, remoteHead: HEAD_B });
    await m.hook();
    const last = await m.settled();
    expect(last.result).toBe("failed");
    expect(last.detail).toBe(
      "claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user failed (exit 1): Failed to update: network",
    );
    expect(m.read("notify.log")).toBe("");
    const told = await m.hook();
    expect(JSON.parse(told.stdout)).toEqual({
      systemMessage: `cc-smart-dev-kit: the background update failed at ${last.at} (${last.detail}). The log: ~/.claude/cc-smart-dev-kit/update.log. To try now: cc-smart-dev-kit update`,
    });
    expect(told.stderr).toBe("");
    // Once: the next session is not told again.
    expect((await m.hook()).stdout).toBe("");
  }, 30_000);

  test("an unreachable marketplace: not a failure yet (both URLs named), nothing run, no session told", async () => {
    const m = machine({ gitFails: true });
    await m.hook();
    const last = await m.settled();
    expect(last).toEqual({
      at: last.at,
      detail:
        "cannot read the marketplace (git@github.com:example-org/cc-smart-dev-kit.git: fatal: could not read from remote repository; https://github.com/example-org/cc-smart-dev-kit.git: fatal: could not read from remote repository)",
      result: "unreachable",
      since: last.at,
    });
    expect(m.read("claude.log")).toBe("");
    expect((await m.hook()).stdout).toBe("");
  }, 30_000);

  test("the detached check and its claude commands run in the home folder, without git's repo variables", async () => {
    // As when Claude Code runs inside a git hook: its hooks inherit these.
    const m = machine({
      env: {
        GIT_DIR: "/elsewhere/.git",
        GIT_INDEX_FILE: "/elsewhere/.git/index",
        GIT_WORK_TREE: "/elsewhere",
      },
      remoteHead: HEAD_B,
    });
    // The hook runs in this repo's folder (the test's own), like a session in a project.
    await m.hook();
    expect((await m.settled()).result).toBe("updated");
    const clean = `cwd=${m.home} GIT_DIR=unset GIT_WORK_TREE=unset GIT_INDEX_FILE=unset\n`;
    expect(m.read("claude-env.log")).toBe(clean + clean);
  }, 30_000);

  test("a failed command's output: every URL in it loses its credentials, in the record and the log", async () => {
    const m = machine({
      refreshFails:
        "fatal: unable to access https://user:s3cret-token@git.example.com/org/cc-smart-dev-kit.git/: Could not resolve host",
      remoteHead: HEAD_B,
    });
    await m.hook();
    const last = await m.settled();
    expect(last.result).toBe("failed");
    expect(last.detail).toBe(
      "claude plugin marketplace update cc-smart-dev-kit failed (exit 1): fatal: unable to access https://***@git.example.com/org/cc-smart-dev-kit.git/: Could not resolve host",
    );
    expect(readFileSync(m.files.log, "utf8")).not.toContain("s3cret-token");
    expect(readFileSync(m.files.check, "utf8")).not.toContain("s3cret-token");
    // The session that is told sees it the same way.
    expect((await m.hook()).stdout).not.toContain("s3cret-token");
  }, 30_000);

  test("Claude Code's own refresh holding git's index.lock: skipped, not failed; no session told", async () => {
    const m = machine({
      refreshFails:
        "fatal: Unable to create '/home/u/.claude/plugins/marketplaces/cc-smart-dev-kit/.git/index.lock': File exists.",
      remoteHead: HEAD_B,
    });
    await m.hook();
    expect(await m.settled()).toMatchObject({
      detail:
        "Claude Code was refreshing the same marketplace (git's index.lock was taken); the next check tries again",
      result: "skipped",
    });
    expect((await m.hook()).stdout).toBe("");
  }, 30_000);

  test("a new version whose router differs from the running copy: the notification adds the gateway setup hint", async () => {
    const m = machine({ remoteHead: HEAD_B });
    // The gateway runs a copy of the old router; the installed version has another one.
    const installPath = join(
      m.home,
      ".claude",
      "plugins",
      "cache",
      "cc-smart-dev-kit",
      "cc-smart-dev-kit",
      "1.0.0",
    );
    mkdirSync(join(installPath, "dist"), { recursive: true });
    writeFileSync(join(installPath, "dist", "router.js"), "// router v2\n");
    mkdirSync(join(m.home, ".local", "share", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(
      join(m.home, ".local", "share", "cc-smart-dev-kit", "router.js"),
      "// router v1\n",
    );
    await m.hook();
    expect(await m.settled()).toMatchObject({
      detail:
        "1.1.0 (was 1.0.0); its router changed: to run it, cc-smart-dev-kit gateway setup (it asks before the restart); agent view's notification hook is missing: cc-smart-dev-kit setup writes it",
      result: "updated",
    });
    expect(m.read("notify.log")).toBe(
      "notify-send cc-smart-dev-kit cc-smart-dev-kit 1.1.0 installed; restart Claude sessions to load it; its router changed: to run it, cc-smart-dev-kit gateway setup (it asks before the restart); agent view's notification hook is missing: cc-smart-dev-kit setup writes it\n",
    );
  }, 30_000);

  test("the notification hook is already set: no `setup` hint in the update's text", async () => {
    const m = machine({ remoteHead: HEAD_B });
    writeFileSync(
      m.paths.settingsFile,
      JSON.stringify({
        hooks: {
          Notification: [
            {
              matcher: "agent_needs_input|agent_completed",
              hooks: [
                {
                  type: "command",
                  command: '"$HOME/.local/bin/cc-smart-dev-kit" hook notify',
                  timeout: 10,
                },
              ],
            },
          ],
        },
      }),
    );
    await m.hook();
    expect(await m.settled()).toMatchObject({ detail: "1.1.0 (was 1.0.0)", result: "updated" });
    expect(m.read("notify.log")).toBe(
      "notify-send cc-smart-dev-kit cc-smart-dev-kit 1.1.0 installed; restart Claude sessions to load it\n",
    );
  }, 30_000);

  test("Claude Code's switch for updates set: the hook starts nothing, says nothing, and records why", async () => {
    const m = machine({ env: { DISABLE_AUTOUPDATER: "1" }, remoteHead: HEAD_B });
    const run = await m.hook();
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("");
    expect(readLastCheck(m.files)).toMatchObject({
      detail: "DISABLE_AUTOUPDATER is set",
      result: "skipped",
    });
    // No check ran: no git, no claude, no lock.
    expect(m.read("git.log")).toBe("");
    expect(m.read("claude.log")).toBe("");
    const doctor = await m.cli(["doctor"]);
    expect(doctor.stdout).toContain("skipped: DISABLE_AUTOUPDATER is set\n");
  }, 30_000);
});

describe("Claude Code's switches for updates", () => {
  test("each switch stops the hook (from the environment or settings.json); FORCE_AUTOUPDATE_PLUGINS lets it run", () => {
    for (const name of [
      "DISABLE_AUTOUPDATER",
      "DISABLE_UPDATES",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    ]) {
      const m = machine();
      const blocked = hookHere(m, NOW, { ...m.env, [name]: "1" });
      expect(blocked).toEqual({ answer: "", started: 0 });
      expect(readLastCheck(m.files)).toEqual({
        at: "2026-10-15T10:00:00Z",
        detail: `${name} is set`,
        result: "skipped",
      });
      // Recorded once: a later session start keeps the first time.
      hookHere(m, NOW + 5_000, { ...m.env, [name]: "1" });
      expect(readLastCheck(m.files)?.at).toBe("2026-10-15T10:00:00Z");
      // An hour on (the skip counts as a check for the throttle).
      expect(
        hookHere(m, NOW + CHECK_INTERVAL_MS, {
          ...m.env,
          [name]: "1",
          FORCE_AUTOUPDATE_PLUGINS: "1",
        }).started,
      ).toBe(1);
      // `0` is not set.
      expect(hookHere(m, NOW + CHECK_INTERVAL_MS, { ...m.env, [name]: "0" }).started).toBe(1);
    }
    const m = machine();
    writeFileSync(m.paths.settingsFile, JSON.stringify({ env: { DISABLE_UPDATES: "true" } }));
    expect(hookHere(m).started).toBe(0);
    expect(readLastCheck(m.files)?.detail).toBe("DISABLE_UPDATES is set");
  });

  test("checked again under the lock: a background check that already started does nothing but record it", async () => {
    const m = machine({ remoteHead: HEAD_B });
    let ran = 0;
    await backgroundCheck({
      claude: "/nowhere/claude",
      env: { ...m.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
      notify: () => {},
      now: () => NOW,
      paths: m.paths,
      run: () => {
        ran += 1;
        return { exitCode: 0, output: "" };
      },
    });
    expect(ran).toBe(0);
    expect(m.read("git.log")).toBe("");
    expect(readLastCheck(m.files)).toEqual({
      at: "2026-10-15T10:00:00Z",
      detail: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set",
      result: "skipped",
    });
  });
});

describe("a failure: when it counts, and who is told", () => {
  /** One background check at `nowMs`, in this process; git and claude are the fakes. */
  const checkAt = (m: ReturnType<typeof machine>, nowMs: number) =>
    backgroundCheck({
      claude: null,
      env: m.env,
      notify: () => {},
      now: () => nowMs,
      paths: m.paths,
      run: () => ({ exitCode: 1, output: "" }),
    });

  test("an unreachable marketplace counts as failed only after 24 h in a row; a check that reads it ends the streak", async () => {
    const m = machine({ gitFails: true });
    const HOUR = 60 * 60 * 1000;
    await checkAt(m, NOW);
    expect(readLastCheck(m.files)).toMatchObject({
      result: "unreachable",
      since: "2026-10-15T10:00:00Z",
    });
    await checkAt(m, NOW + 23 * HOUR);
    expect(readLastCheck(m.files)).toMatchObject({
      at: "2026-10-16T09:00:00Z",
      result: "unreachable",
      since: "2026-10-15T10:00:00Z",
    });
    await checkAt(m, NOW + 24 * HOUR);
    const failed = readLastCheck(m.files);
    expect(failed?.result).toBe("failed");
    expect(failed?.detail).toStartWith(
      "cannot read the marketplace since 2026-10-15T10:00:00Z (git@github.com:example-org/cc-smart-dev-kit.git: ",
    );
    const doctor = await m.cli(["doctor"]);
    expect(doctor.stdout).toContain(
      "✗ background update: the last check, 2026-10-16T10:00:00Z, failed: cannot read the marketplace since 2026-10-15T10:00:00Z",
    );
    // The marketplace answers again: no streak left.
    writeFileSync(
      join(m.home, "fake", "bin", "git"),
      "#!/bin/sh\ncase \"$*\" in config*) exit 1 ;; ls-remote*) printf '%s\\tHEAD\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ;; *rev-parse*) echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;; esac\n",
    );
    await checkAt(m, NOW + 25 * HOUR);
    expect(readLastCheck(m.files)).toEqual({
      at: "2026-10-16T11:00:00Z",
      detail: "1.0.0",
      result: "up-to-date",
    });
  });

  test("doctor: an unreachable marketplace is information, with since when", async () => {
    const m = machine();
    writeLastCheck(m.files, {
      at: "2026-10-15T11:00:00Z",
      detail: "cannot read the marketplace (x: offline)",
      result: "unreachable",
      since: "2026-10-15T10:00:00Z",
    });
    const doctor = await m.cli(["doctor"]);
    expect(doctor.stdout).toContain(
      "· background update: last check 2026-10-15T11:00:00Z: cannot read the marketplace (x: offline), since 2026-10-15T10:00:00Z. It counts as a failure only after 24 h in a row. To look now: cc-smart-dev-kit update --check\n",
    );
  }, 30_000);

  test("a failure is told to an attended session only: a `claude -p` session neither shows it nor uses it up", () => {
    const m = machine();
    writeLastCheck(m.files, { at: "2026-10-15T09:00:00Z", detail: "boom", result: "failed" });
    // `claude -p`: Claude Code sets CLAUDE_CODE_SESSION_ATTENDED=0 for its hooks.
    const unattended = { ...m.env, CLAUDE_CODE_SESSION_ATTENDED: "0" };
    expect(hookHere(m, NOW, unattended).answer).toBe("");
    expect(hookHere(m, NOW, unattended).answer).toBe("");
    const attended = { ...m.env, CLAUDE_CODE_SESSION_ATTENDED: "1" };
    expect(JSON.parse(hookHere(m, NOW, attended).answer)).toEqual({
      systemMessage:
        "cc-smart-dev-kit: the background update failed at 2026-10-15T09:00:00Z (boom). The log: ~/.claude/cc-smart-dev-kit/update.log. To try now: cc-smart-dev-kit update",
    });
    expect(hookHere(m, NOW, attended).answer).toBe("");
  });

  test("an unreadable marketplace past 24 h is told once for its streak, not after every hourly check", () => {
    const m = machine();
    const failedAt = (at: string) =>
      writeLastCheck(m.files, {
        at,
        detail: "cannot read the marketplace since 2026-10-14T09:00:00Z (x: offline)",
        result: "failed",
        since: "2026-10-14T09:00:00Z",
      });
    failedAt("2026-10-15T09:00:00Z");
    expect(hookHere(m).answer).toContain("the background update failed at 2026-10-15T09:00:00Z");
    failedAt("2026-10-15T10:00:00Z");
    expect(hookHere(m, NOW + CHECK_INTERVAL_MS).answer).toBe("");
    // Another failure (no streak): told again.
    writeLastCheck(m.files, { at: "2026-10-15T11:00:00Z", detail: "boom", result: "failed" });
    expect(hookHere(m, NOW + 2 * CHECK_INTERVAL_MS).answer).toContain(
      "failed at 2026-10-15T11:00:00Z",
    );
  });
});

/** The hook's logic in this process, with a spy for the background start. */
function hookHere(
  m: ReturnType<typeof machine>,
  nowMs = NOW,
  env: Record<string, string | undefined> = m.env,
  source: null | string = "startup",
) {
  let started = 0;
  const answer = sessionStart({
    env,
    nowMs,
    paths: m.paths,
    sessionPid: process.pid,
    source,
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
      "Background updates are on hold: a new Claude session no longer checks for a newer cc-smart-dev-kit. To resume: cc-smart-dev-kit update --resume\n",
    );
    expect(held.exitCode).toBe(0);
    expect(hookHere(m).started).toBe(0);
    expect((await m.cli(["update", "--hold"])).stdout).toStartWith(
      "Background updates were already on hold (since 20",
    );
    const resumed = await m.cli(["update", "--resume"]);
    expect(resumed.stdout).toBe(
      "Background updates resume: a new Claude session checks for a newer cc-smart-dev-kit, at most once an hour (~/.claude/cc-smart-dev-kit/update.log).\n",
    );
    expect(hookHere(m).started).toBe(1);
    expect((await m.cli(["update", "--resume"])).stdout).toBe(
      "Background updates were not on hold.\n",
    );
  }, 30_000);

  test("--hold and --resume take no lock: they answer at once while a check (and a setup) holds its lock, and say the check finishes", async () => {
    const m = machine();
    // This test's process holds both locks: the update lock (a check runs) and the setup lock.
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const update = withLock(m.files.lockDir, () => released);
    const setup = withLock(m.paths.stateDir, () => released);
    await Bun.sleep(20);
    const held = await m.cli(["update", "--hold"]);
    expect(held.exitCode).toBe(0);
    expect(held.stdout).toBe(
      "Background updates are on hold: a new Claude session no longer checks for a newer cc-smart-dev-kit. To resume: cc-smart-dev-kit update --resume\nA check is running now; it finishes.\n",
    );
    expect(held.ms).toBeLessThan(5_000);
    const resumed = await m.cli(["update", "--resume"]);
    expect(resumed.stdout).toBe(
      "Background updates resume: a new Claude session checks for a newer cc-smart-dev-kit, at most once an hour (~/.claude/cc-smart-dev-kit/update.log).\nA check is running now; it finishes.\n",
    );
    release();
    await Promise.all([update, setup]);
    // No check runs: only the answer.
    expect((await m.cli(["update", "--hold"])).stdout).toBe(
      "Background updates are on hold: a new Claude session no longer checks for a newer cc-smart-dev-kit. To resume: cc-smart-dev-kit update --resume\n",
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

describe("cc-smart-dev-kit update", () => {
  test("--check: the newest; a newer one in the copy; a newer one only at the remote (read without touching the copy)", async () => {
    expect((await machine().cli(["update", "--check"])).stdout).toBe(
      "cc-smart-dev-kit 1.0.0 is the newest version.\n",
    );
    expect((await machine({ inCopy: "1.2.0" }).cli(["update", "--check"])).stdout).toBe(
      "cc-smart-dev-kit 1.2.0 is available (installed: 1.0.0). Run: cc-smart-dev-kit update\n",
    );
    const remote = machine({ remoteHead: HEAD_B, remoteVersion: "2.0.0" });
    expect((await remote.cli(["update", "--check"])).stdout).toBe(
      "cc-smart-dev-kit 2.0.0 is available (installed: 1.0.0). It is a major version: read What's new first. Run: cc-smart-dev-kit update\n",
    );
    // No claude command, and Claude Code's copy untouched.
    expect(remote.read("claude.log")).toBe("");
    expect(remote.read("git.log")).toContain(
      "fetch -q --depth 1 --no-tags git@github.com:example-org/cc-smart-dev-kit.git HEAD\n",
    );
    const docsOnly = machine({ remoteHead: HEAD_B, remoteVersion: "1.0.0" });
    expect((await docsOnly.cli(["update", "--check"])).stdout).toBe(
      "cc-smart-dev-kit 1.0.0 is the newest version (the marketplace has newer commits, with no new version).\n",
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
        "$ claude plugin marketplace update cc-smart-dev-kit",
        "refreshed",
        "$ claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user",
        "updated",
        "cc-smart-dev-kit 1.1.0 installed (was 1.0.0). Restart Claude sessions to load it.",
        "",
      ].join("\n"),
    );
    expect(readLastCheck(m.files)).toMatchObject({
      detail: "1.1.0 (was 1.0.0)",
      result: "updated",
    });
    // Nothing newer now.
    expect((await m.cli(["update"])).stdout).toBe("cc-smart-dev-kit 1.1.0 is up to date.\n");
  }, 30_000);

  test("a local copy whose head git cannot read is not 'behind': only the versions decide then", () => {
    // `git rev-parse HEAD` answers nothing a commit looks like (a copy that is not a git
    // checkout, or a broken one). Read as "behind", every check said so, and the background
    // check refreshed the marketplace every hour for nothing.
    const m = machine({ localHead: "" });
    expect(checkForUpdate(m.paths, m.env)).toEqual({ installed: "1.0.0", kind: "up-to-date" });
    // A newer version in the copy is still found.
    const newer = machine({ localHead: "", inCopy: "1.2.0" });
    expect(checkForUpdate(newer.paths, newer.env)).toMatchObject({
      catalogBehind: false,
      inCopy: "1.2.0",
      kind: "behind",
    });
  });

  test("a wrong option: the usage, exit 2", async () => {
    const run = await machine().cli(["update", "--now"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toBe(
      "Unknown option: --now\n\nUsage: cc-smart-dev-kit update [--check | --hold | --resume]\n",
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
      "· 1 running Claude session loaded cc-smart-dev-kit 1.0.0; 1.1.0 is installed. Restart it to load it.\n",
    );
    writeLastCheck(m.files, { at: "2026-10-15T11:00:00Z", detail: "boom", result: "failed" });
    writeFileSync(m.files.hold, "2026-10-15T11:30:00Z\n");
    const failed = await m.cli(["doctor"]);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain(
      "· background updates are on hold (since 2026-10-15T11:30:00Z). To resume: cc-smart-dev-kit update --resume\n✗ background update: the last check, 2026-10-15T11:00:00Z, failed: boom. The log: ~/.claude/cc-smart-dev-kit/update.log. To try now: cc-smart-dev-kit update\n",
    );
  }, 30_000);
});

describe("the notification", () => {
  const which = (found: string[]) => (command: string) =>
    found.includes(command) ? `/usr/bin/${command}` : null;

  test("notify-send on Linux, osascript on macOS, a PowerShell toast on Windows, nothing without the tool", () => {
    const text = installedText("1.2.3");
    expect(text).toBe("cc-smart-dev-kit 1.2.3 installed; restart Claude sessions to load it");
    expect(notifyCommand(text, "linux", which(["notify-send"]))).toEqual([
      "/usr/bin/notify-send",
      "cc-smart-dev-kit",
      text,
    ]);
    expect(notifyCommand(text, "linux", which([]))).toBe(null);
    expect(notifyCommand(text, "darwin", which(["osascript"]))).toEqual([
      "/usr/bin/osascript",
      "-e",
      'display notification "cc-smart-dev-kit 1.2.3 installed; restart Claude sessions to load it" with title "cc-smart-dev-kit"',
    ]);
    expect(notifyCommand(text, "win32", which(["notify-send", "osascript"]))).toBe(null);
    // Windows: the toast, with the alert's words in the encoded script, never on the command
    // line (`windows-toast.ts`; the script itself is pinned in its own test file).
    const toast = notifyCommand(text, "win32", which(["powershell"]));
    expect(toast?.slice(0, 4)).toEqual([
      "/usr/bin/powershell",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    // The words are base64 of UTF-8 inside the script, which decodes them itself: no
    // character of the alert is part of the script's own source (`decodedToastText`).
    const script = Buffer.from(toast?.[4] ?? "", "base64").toString("utf16le");
    expect(decodedToastText(script, "title")).toBe("cc-smart-dev-kit");
    expect(decodedToastText(script, "body")).toBe(text);
  });

  test("the setup hints: the router's, the missing notification hook's, or both", () => {
    expect(installedText("1.2.3", false, true)).toBe(
      "cc-smart-dev-kit 1.2.3 installed; restart Claude sessions to load it; agent view's notification hook is missing: cc-smart-dev-kit setup writes it",
    );
    expect(installedText("1.2.3", true, true)).toBe(
      "cc-smart-dev-kit 1.2.3 installed; restart Claude sessions to load it; its router changed: to run it, cc-smart-dev-kit gateway setup (it asks before the restart); agent view's notification hook is missing: cc-smart-dev-kit setup writes it",
    );
  });

  test("a version that is not plain text never reaches the notifier", () => {
    expect(installedText('1.0" & do shell script "x')).toBe(
      "cc-smart-dev-kit a new version installed; restart Claude sessions to load it",
    );
    expect(installedText(null)).toBe(
      "cc-smart-dev-kit a new version installed; restart Claude sessions to load it",
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

describe("the background check's argv", () => {
  test("both bun flags everywhere; the cmd /c start trampoline on Windows only", () => {
    // A detached child dies with its hook on Windows (oven-sh/bun#31603): the trampoline
    // starts the check outside that job object (`src/hooks/detached.ts`). The flags keep
    // the home folder's `.env` and `bunfig.toml` out of the child on every system.
    //
    // The trampoline hands cmd.exe **one line**, and cmd.exe reads it: `start "" /b` with
    // every argument in double quotes (`&`, `^`, `%`, a space: cmd's own characters), the
    // whole line in one pair of quotes that `/s` strips, and `/d` and `/v:off` so no AutoRun
    // command and no `!` expansion can touch it. None of these arguments ends in a `\`, so
    // none needs the doubled backslashes a path ending in one gets. Written out by hand:
    expect(
      backgroundCheckArgv(
        "win32",
        "C:\\Users\\u\\.bun\\bin\\bun.exe",
        "C:\\p\\dist\\update-check.js",
        "C:\\p",
      ),
    ).toEqual([
      "cmd",
      "/d",
      "/s",
      "/v:off",
      "/c",
      String.raw`"start "" /b "C:\Users\u\.bun\bin\bun.exe" "--no-env-file" "--config=C:\p/bunfig.toml" "C:\p\dist\update-check.js" "--background""`,
    ]);
    for (const platform of ["linux", "darwin"] as const) {
      const argv = backgroundCheckArgv(platform, "/usr/bin/bun", "/p/dist/update-check.js", "/p");
      expect(argv).toEqual(backgroundCommand("/usr/bin/bun", "/p/dist/update-check.js", "/p"));
      expect(argv).toContain("--no-env-file");
      expect(argv).toContain(`--config=${join("/p", "bunfig.toml")}`);
    }
  });
});

describe("the instructions copy at a session start", () => {
  /** The plugin's instructions folder, as the plugin ships it. */
  const source = (): string => {
    const dir = tempDir("instructions-source");
    mkdirSync(join(dir, "optin"), { recursive: true });
    writeFileSync(join(dir, "core.md"), "# Core\n\nThe plugin's own rules.\n");
    writeFileSync(join(dir, "optin", "worktrees.md"), "# Worktrees\n");
    return dir;
  };

  test("a copy behind this version is refreshed: the copy only, quietly", async () => {
    const home = tempDir("instructions-home");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const where = instructionsPaths(paths, source());
    installInstructions(where, false, "0.2.0");
    // What the person's CLAUDE.md looks like after they edited it: the refresh never
    // touches it (a \`setup\` run is what writes or updates the block).
    const edited = `${readFileSync(where.claudeMd, "utf8")}\nMy own note.\n`;
    writeFileSync(where.claudeMd, edited);
    writeFileSync(join(where.source, "core.md"), "# Core\n\nThe new version's rules.\n");
    const said: string[] = [];

    await refreshInstructionsAtSessionStart({
      where,
      version: "0.3.0",
      log: (line) => said.push(line),
    });

    expect(readFileSync(join(where.target, "core.md"), "utf8")).toContain("The new version's");
    expect(readFileSync(where.claudeMd, "utf8")).toBe(edited);
    expect(readVersionStamp(where.stateDir)).toBe("0.3.0");
    expect(said).toEqual([]);
  });

  test("an older session never writes back over the installed copy, and says so in one line", async () => {
    // Seen live (2026-10-19): a session still on 0.5.2 rewrote the 0.5.3 copy at its start,
    // and `doctor` read "written by 0.5.2". The copy is not the installed version's here.
    const home = tempDir("instructions-home");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const where = instructionsPaths(paths, source());
    installInstructions(where, false, "0.4.0");
    mkdirSync(join(paths.claudeConfigDir, "plugins"), { recursive: true });
    const installed = (version: string) =>
      writeFileSync(
        paths.installedPluginsFile,
        JSON.stringify({
          version: 2,
          plugins: {
            "cc-smart-dev-kit@cc-smart-dev-kit": [
              { installPath: join(home, "plugin"), scope: "user", version },
            ],
          },
        }),
      );
    installed("0.5.0");
    writeFileSync(join(where.source, "core.md"), "# Core\n\nThe old version's rules.\n");
    const said: string[] = [];

    await refreshInstructionsAtSessionStart({
      where,
      version: "0.3.0",
      log: (line) => said.push(line),
    });

    expect(readFileSync(join(where.target, "core.md"), "utf8")).toContain("The plugin's own rules");
    expect(readVersionStamp(where.stateDir)).toBe("0.4.0");
    expect(said).toEqual([
      "cc-smart-dev-kit: this session runs 0.3.0; restart it to use the installed 0.5.0's instructions.",
    ]);

    // The copy is already the installed version's: an old session runs old code, and the
    // copy is right — nothing to say.
    installed("0.4.0");
    said.length = 0;
    await refreshInstructionsAtSessionStart({
      where,
      version: "0.3.0",
      log: (line) => said.push(line),
    });
    expect(readVersionStamp(where.stateDir)).toBe("0.4.0");
    expect(said).toEqual([]);
  });

  test("nothing when the person chose --no-instructions, and nothing when setup never ran", async () => {
    const home = tempDir("instructions-home");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const where = instructionsPaths(paths, source());
    const said: string[] = [];
    const log = (line: string) => said.push(line);

    // Never installed: no copy, no state folder, nothing to do.
    await refreshInstructionsAtSessionStart({ where, version: "0.3.0", log });
    expect(existsSync(where.target)).toBe(false);
    expect(said).toEqual([]);

    installInstructions(where, false, "0.2.0");
    writeFileSync(optOutFile(where.stateDir), "");
    await refreshInstructionsAtSessionStart({ where, version: "0.3.0", log });
    expect(readVersionStamp(where.stateDir)).toBe("0.2.0");
    expect(said).toEqual([]);
  });

  test("a refresh that cannot run is one line, and the session goes on", async () => {
    const home = tempDir("instructions-home");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const where = instructionsPaths(paths, source());
    installInstructions(where, false, "0.2.0");
    // The new version's files are not there (a half-installed plugin folder).
    rmSync(where.source, { force: true, recursive: true });
    const said: string[] = [];

    await refreshInstructionsAtSessionStart({
      where,
      version: "0.3.0",
      log: (line) => said.push(line),
    });

    expect(said).toHaveLength(1);
    expect(said[0]).toContain("the instructions copy was not refreshed");
    expect(readVersionStamp(where.stateDir)).toBe("0.2.0");
  });

  test("another session holds the state lock: silent (it is doing the refresh)", async () => {
    const home = tempDir("instructions-home");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const where = instructionsPaths(paths, source());
    installInstructions(where, false, "0.2.0");
    writeFileSync(join(where.source, "core.md"), "# Core\n\nThe new version's rules.\n");
    let release: () => void = () => {};
    const busy = withLock(
      where.stateDir,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Bun.sleep(20);
    const said: string[] = [];

    await refreshInstructionsAtSessionStart({
      where,
      version: "0.3.0",
      log: (line) => said.push(line),
      waitMs: 50,
    });

    expect(said).toEqual([]);
    expect(readVersionStamp(where.stateDir)).toBe("0.2.0");
    release();
    await busy;
  });
});

/** The detached check in this process, with the machine's fakes; what it recorded and notified. */
async function checkHere(m: ReturnType<typeof machine>) {
  const notified: string[] = [];
  await backgroundCheck({
    claude: Bun.which("claude", { PATH: m.env.PATH ?? "" }),
    env: m.env,
    notify: (text) => notified.push(text),
    now: () => NOW,
    paths: m.paths,
    run: capturingRunner(m.env, m.home),
  });
  return { last: readLastCheck(m.files), notified };
}

describe("D33: a major version waits for the person", () => {
  const NOTES = JSON.stringify({ "1.0.0": "it refuses old project fields" });
  const LINE_1_0_0 =
    "cc-smart-dev-kit 1.0.0 is ready: it is a major version (it refuses old project fields). Read What's new, then run `cc-smart-dev-kit update`.";

  /** A held major, as the background check leaves it. */
  const holdMajor = (m: ReturnType<typeof machine>, notes: string[] = []) =>
    writeHeldMajor(m.files, { at: "2026-10-15T09:00:00Z", from: "0.6.0", notes, version: "1.0.0" });

  test("D33: 0.6.0 → 0.6.1 installs, as before", async () => {
    const m = machine({
      inCopy: "0.6.0",
      installed: "0.6.0",
      newVersion: "0.6.1",
      remoteHead: HEAD_B,
    });
    const { last, notified } = await checkHere(m);
    expect(last?.result).toBe("updated");
    expect(m.installedVersion()).toBe("0.6.1");
    expect(notified).toHaveLength(1);
    expect(readHeldMajor(m.files)).toBeNull();
  });

  test("D33: 1.0.0 → 1.1.0 installs, as before", async () => {
    const m = machine({ remoteHead: HEAD_B });
    expect((await checkHere(m)).last?.result).toBe("updated");
    expect(m.installedVersion()).toBe("1.1.0");
    expect(readHeldMajor(m.files)).toBeNull();
  });

  test("D33: 0.6.0 → 1.0.0 holds: the refresh only, nothing installed, nothing notified; the held state says what and why", async () => {
    const m = machine({
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    const { last, notified } = await checkHere(m);
    expect(m.read("claude.log")).toBe("plugin marketplace update cc-smart-dev-kit\n");
    expect(m.installedVersion()).toBe("0.6.0");
    expect(notified).toEqual([]);
    expect(last).toEqual({
      at: "2026-10-15T10:00:00Z",
      detail:
        "1.0.0 is a major version (it refuses old project fields): it waits for `cc-smart-dev-kit update`",
      result: "skipped",
    });
    expect(readHeldMajor(m.files)).toEqual({
      at: "2026-10-15T10:00:00Z",
      from: "0.6.0",
      notes: ["it refuses old project fields"],
      version: "1.0.0",
    });
  });

  test("D33: 0.6.0 → 1.1.0 (two steps, one major) holds, with 1.0.0's note", async () => {
    const m = machine({
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.1.0",
      remoteHead: HEAD_B,
    });
    await checkHere(m);
    expect(m.installedVersion()).toBe("0.6.0");
    expect(readHeldMajor(m.files)).toMatchObject({
      notes: ["it refuses old project fields"],
      version: "1.1.0",
    });
  });

  test("D33: two majors behind (0.6.0 → 2.0.0): held, with both notes, oldest first", async () => {
    const m = machine({
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: JSON.stringify({
        "2.0.0": "it needs a newer Bun",
        "1.0.0": "it refuses old project fields",
        "3.0.0": "not crossed",
      }),
      newVersion: "2.0.0",
      remoteHead: HEAD_B,
    });
    expect((await checkHere(m)).last?.detail).toBe(
      "2.0.0 is a major version (it refuses old project fields; it needs a newer Bun): it waits for `cc-smart-dev-kit update`",
    );
    expect(m.installedVersion()).toBe("0.6.0");
  });

  test("D33: a copy without the notes file: held all the same, the line without a why", async () => {
    const m = machine({
      inCopy: "1.4.2",
      installed: "1.4.2",
      newVersion: "2.0.0",
      remoteHead: HEAD_B,
    });
    await checkHere(m);
    expect(m.installedVersion()).toBe("1.4.2");
    expect(readHeldMajor(m.files)?.notes).toEqual([]);
    expect(JSON.parse(hookHere(m).answer)).toEqual({
      systemMessage:
        "cc-smart-dev-kit 2.0.0 is ready: it is a major version. Read What's new, then run `cc-smart-dev-kit update`.",
    });
  });

  test("D33: the next check keeps when it was first found; a check that finds the install current forgets it", async () => {
    const m = machine({
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    writeHeldMajor(m.files, {
      at: "2026-10-15T08:00:00Z",
      from: "0.6.0",
      notes: [],
      version: "1.0.0",
    });
    await checkHere(m);
    expect(readHeldMajor(m.files)?.at).toBe("2026-10-15T08:00:00Z");
    // Installed by hand since (`claude plugin update`): the next check finds it current.
    writeFileSync(
      join(m.home, ".claude", "plugins", "installed_plugins.json"),
      readFileSync(join(m.home, "fake", "installed-after"), "utf8"),
    );
    writeLastCheck(m.files, { at: "2026-10-15T08:00:00Z", detail: "", result: "skipped" });
    expect((await checkHere(m)).last?.result).toBe("up-to-date");
    expect(readHeldMajor(m.files)).toBeNull();
  });

  test("D33: an older version reads the hold's record as an ordinary skipped check (its own file holds the major)", async () => {
    // An older checker (0.6.0) knows no "held" result: a record it cannot read counts as no
    // check at all, and it would check again at once. So the hold writes a result every older
    // version knows, with the three fields it reads, and keeps the major in a file of its own.
    const m = machine({
      inCopy: "0.6.0",
      installed: "0.6.0",
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    await checkHere(m);
    const record = JSON.parse(readFileSync(m.files.check, "utf8"));
    expect(Object.keys(record).sort()).toEqual(["at", "detail", "result"]);
    expect(record.result).toBe("skipped");
    expect(existsSync(m.files.major)).toBe(true);
  });

  test("D33: the session start shows one line while a major is held: at startup and resume, never on a clear or a compact", () => {
    const m = machine({ installed: "0.6.0" });
    holdMajor(m, ["it refuses old project fields"]);
    writeLastCheck(m.files, { at: "2026-10-15T09:30:00Z", detail: "x", result: "skipped" });
    const line = { systemMessage: LINE_1_0_0 };
    expect(JSON.parse(hookHere(m, NOW, m.env, "startup").answer)).toEqual(line);
    expect(hookHere(m, NOW, m.env, "compact").answer).toBe("");
    expect(hookHere(m, NOW, m.env, "clear").answer).toBe("");
    // Every new start says it again while it waits: it is the person's next step.
    expect(JSON.parse(hookHere(m, NOW, m.env, "resume").answer)).toEqual(line);
    // An input that does not say why the hook runs counts as a start.
    expect(JSON.parse(hookHere(m, NOW, m.env, null).answer)).toEqual(line);
  });

  test("D33: an unattended session (`claude -p`) gets no line", () => {
    const m = machine({ installed: "0.6.0" });
    holdMajor(m);
    expect(hookHere(m, NOW, { ...m.env, CLAUDE_CODE_SESSION_ATTENDED: "0" }).answer).toBe("");
  });

  test("D33: `update --hold` wins: no line and no check", () => {
    const m = machine({ installed: "0.6.0" });
    holdMajor(m);
    writeFileSync(m.files.hold, "2026-10-15T09:00:00Z\n");
    expect(hookHere(m)).toEqual({ answer: "", started: 0 });
  });

  test("D33: held, but installed by hand since: no line", () => {
    const m = machine({ installed: "1.0.0" });
    holdMajor(m);
    expect(hookHere(m).answer).toBe("");
  });

  test("D33: a failure to tell and a held major: both, in one systemMessage", () => {
    const m = machine({ installed: "0.6.0" });
    holdMajor(m, ["it refuses old project fields"]);
    writeLastCheck(m.files, { at: "2026-10-15T09:00:00Z", detail: "boom", result: "failed" });
    expect(JSON.parse(hookHere(m).answer)).toEqual({
      systemMessage: `cc-smart-dev-kit: the background update failed at 2026-10-15T09:00:00Z (boom). The log: ~/.claude/cc-smart-dev-kit/update.log. To try now: cc-smart-dev-kit update\n${LINE_1_0_0}`,
    });
  });

  test("D33: the hook as Claude Code runs it: the line on a startup, nothing on a compact", async () => {
    const m = machine({ installed: "0.6.0" });
    holdMajor(m, ["it refuses old project fields"]);
    const run = async (source: string) => {
      const guard = subprocessGuard();
      const proc = Bun.spawn([process.execPath, ...guard.args, HOOK], {
        env: { ...m.env, ...guard.env, CLAUDE_CODE_SESSION_ATTENDED: "1" },
        stdin: new Blob([JSON.stringify({ cwd: m.home, hook_event_name: "SessionStart", source })]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return stdout;
    };
    expect(await run("startup")).toBe(`${JSON.stringify({ systemMessage: LINE_1_0_0 })}\n`);
    expect(await run("compact")).toBe("");
  }, 30_000);

  test("D33: sessionSourceOf reads the input's source; anything else is null", () => {
    expect(sessionSourceOf('{"source":"compact"}')).toBe("compact");
    expect(sessionSourceOf('{"source":3}')).toBeNull();
    expect(sessionSourceOf("")).toBeNull();
    expect(sessionSourceOf("not json")).toBeNull();
  });

  test("D33: `update` with a held major installs it on the person's word: first the repos to fix, then the install; the held state goes", async () => {
    const m = machine({
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    holdMajor(m, ["it refuses old project fields"]);
    // A repo a saved session names, still with the retired prefix.
    const repo = tempDir("old-repo");
    git(repo, "init", "-q");
    mkdirSync(join(repo, ".claude"));
    const config = JSON.stringify({ worktrees: { base: "main", prefix: "app-wt-" } });
    writeFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), config);
    const folder = join(m.paths.projectsDir, "-old-repo");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "s1.jsonl"), `${JSON.stringify({ cwd: repo, type: "user" })}\n`);

    const run = await m.cli(["update"]);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        "$ claude plugin marketplace update cc-smart-dev-kit",
        "refreshed",
        "cc-smart-dev-kit 1.0.0 is a major version (it refuses old project fields): installing it.",
        `! ${repo} still has worktrees.prefix in .claude/cc-smart-dev-kit.json, retired in 1.0.0: cd ${repo} && cc-smart-dev-kit project init`,
        "$ claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user",
        "updated",
        "cc-smart-dev-kit 1.0.0 installed (was 0.6.0). Restart Claude sessions to load it.",
        "Run `cc-smart-dev-kit setup` now: a major version may need it.",
        "",
      ].join("\n"),
    );
    expect(m.installedVersion()).toBe("1.0.0");
    expect(readHeldMajor(m.files)).toBeNull();
    // The other repo is only read, never changed.
    expect(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8")).toBe(config);
  }, 30_000);

  test("D33: `update` whose install fails keeps the hold, and says the major still waits", async () => {
    const m = machine({
      claudeFails: true,
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    holdMajor(m, ["it refuses old project fields"]);
    const run = await m.cli(["update"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      "cc-smart-dev-kit 1.0.0 is a major version (it refuses old project fields): it was not installed, and it still waits for `cc-smart-dev-kit update`.\n",
    );
    expect(run.stdout).not.toContain("cc-smart-dev-kit setup");
    expect(m.installedVersion()).toBe("0.6.0");
    expect(readHeldMajor(m.files)?.version).toBe("1.0.0");
  }, 30_000);

  test("D33: `update` whose install ends well but installs nothing keeps the hold", async () => {
    const m = machine({
      claudeInstallsNothing: true,
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    holdMajor(m, ["it refuses old project fields"]);
    const run = await m.cli(["update"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe(
      "cc-smart-dev-kit 1.0.0 is a major version (it refuses old project fields): it was not installed, and it still waits for `cc-smart-dev-kit update`.\n",
    );
    expect(run.stdout).not.toContain("is the newest version");
    expect(m.installedVersion()).toBe("0.6.0");
    expect(readHeldMajor(m.files)?.version).toBe("1.0.0");
    expect(readLastCheck(m.files)?.detail).toBe(
      "1.0.0 is a major version (it refuses old project fields): it waits for `cc-smart-dev-kit update`",
    );
  }, 30_000);
  test("D33: `update` whose install fails keeps the hold, and says the major still waits", async () => {
    const m = machine({
      claudeFails: true,
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    holdMajor(m, ["it refuses old project fields"]);
    const run = await m.cli(["update"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      "cc-smart-dev-kit 1.0.0 is a major version (it refuses old project fields): it was not installed, and it still waits for `cc-smart-dev-kit update`.\n",
    );
    expect(run.stdout).not.toContain("cc-smart-dev-kit setup");
    expect(m.installedVersion()).toBe("0.6.0");
    expect(readHeldMajor(m.files)?.version).toBe("1.0.0");
  }, 30_000);

  test("D33: `update` whose install ends well but installs nothing keeps the hold", async () => {
    const m = machine({
      claudeInstallsNothing: true,
      inCopy: "0.6.0",
      installed: "0.6.0",
      majorNotes: NOTES,
      newVersion: "1.0.0",
      remoteHead: HEAD_B,
    });
    holdMajor(m, ["it refuses old project fields"]);
    const run = await m.cli(["update"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe(
      "cc-smart-dev-kit 1.0.0 is a major version (it refuses old project fields): it was not installed, and it still waits for `cc-smart-dev-kit update`.\n",
    );
    expect(run.stdout).not.toContain("is the newest version");
    expect(m.installedVersion()).toBe("0.6.0");
    expect(readHeldMajor(m.files)?.version).toBe("1.0.0");
    expect(readLastCheck(m.files)?.detail).toBe(
      "1.0.0 is a major version (it refuses old project fields): it waits for `cc-smart-dev-kit update`",
    );
  }, 30_000);

  test("D33: `update --check` says a major is one", async () => {
    const m = machine({ inCopy: "1.0.0", installed: "0.6.0" });
    expect((await m.cli(["update", "--check"])).stdout).toBe(
      "cc-smart-dev-kit 1.0.0 is available (installed: 0.6.0). It is a major version: read What's new first. Run: cc-smart-dev-kit update\n",
    );
  }, 30_000);
});

describe("D39: the background check turns setup's own leftover autoUpdate true off", () => {
  const KEY = 'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate';
  const autoUpdateIn = (m: ReturnType<typeof machine>) =>
    JSON.parse(readFileSync(m.paths.settingsFile, "utf8")).extraKnownMarketplaces?.[
      "cc-smart-dev-kit"
    ]?.autoUpdate;
  const autoUpdateLines = (m: ReturnType<typeof machine>) =>
    readFileSync(m.files.log, "utf8")
      .split("\n")
      .filter((line) => line.includes("auto-update:"))
      .map((line) => line.replace(/^\S+ /, ""));
  /** What an older setup left: the key at true, written and owned by the managed writer. */
  const olderSetupRan = (m: ReturnType<typeof machine>) =>
    applyManagedJson({
      file: m.paths.settingsFile,
      set: [[AUTO_UPDATE_KEY, true]],
      stateDir: m.paths.stateDir,
    });

  test("D39: setup's own true becomes false, once; the check goes on", async () => {
    const m = machine();
    olderSetupRan(m);
    expect((await checkHere(m)).last?.result).toBe("up-to-date");
    expect(autoUpdateIn(m)).toBe(false);
    expect(autoUpdateLines(m)).toEqual([
      `auto-update: ${KEY} set to false in ~/.claude/settings.json: Claude Code's own plugin auto-update is off`,
    ]);
    // The next check changes nothing more.
    writeLastCheck(m.files, { at: "2026-10-15T08:00:00Z", detail: "", result: "up-to-date" });
    await checkHere(m);
    expect(autoUpdateLines(m)).toHaveLength(1);
  });

  test("D39: a true the person set stays; the log says so, and the check goes on", async () => {
    const m = machine();
    writeFileSync(
      m.paths.settingsFile,
      JSON.stringify({ extraKnownMarketplaces: { "cc-smart-dev-kit": { autoUpdate: true } } }),
    );
    expect((await checkHere(m)).last?.result).toBe("up-to-date");
    expect(autoUpdateIn(m)).toBe(true);
    expect(autoUpdateLines(m)).toEqual([
      `auto-update: left on: ${KEY} is true in ~/.claude/settings.json, set by you; \`cc-smart-dev-kit doctor\` says how to turn it off`,
    ]);
  });

  test("D39: no key (a restore took it): nothing is written", async () => {
    const m = machine();
    expect((await checkHere(m)).last?.result).toBe("up-to-date");
    expect(existsSync(m.paths.settingsFile)).toBe(false);
    expect(autoUpdateLines(m)).toEqual([]);
  });

  test("D39: a busy state lock: not changed, one log line, the check goes on", async () => {
    const m = machine();
    olderSetupRan(m);
    let release = () => {};
    const busy = withLock(
      m.paths.stateDir,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Bun.sleep(20);
    expect((await checkHere(m)).last?.result).toBe("up-to-date");
    release();
    await busy;
    expect(autoUpdateIn(m)).toBe(true);
    expect(autoUpdateLines(m)).toEqual([
      "auto-update: not turned off (the state lock is busy (a setup runs now)); the next check tries again",
    ]);
  });

  test("D39: a settings file that is not valid JSON: one log line, the check goes on", async () => {
    const m = machine();
    writeFileSync(m.paths.settingsFile, "{ not json");
    expect((await checkHere(m)).last?.result).toBe("up-to-date");
    expect(readFileSync(m.paths.settingsFile, "utf8")).toBe("{ not json");
    const lines = autoUpdateLines(m);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(
      `auto-update: not turned off (${m.paths.settingsFile} is not valid JSON`,
    );
  });
});
