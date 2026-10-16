/**
 * The self-update: the SessionStart hook, the detached background check, and
 * `cc-smart-dev-kit update`. Everything runs in a temp HOME and CLAUDE_CONFIG_DIR, with fakes first
 * on PATH for `git` (ls-remote, rev-parse, the shallow fetch), `claude` (the two plugin
 * commands) and the notifiers. Each fake logs its calls, so the tests assert them.
 * Nothing here reaches the network, the real ~/.claude or the real `claude`.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import {
  installInstructions,
  instructionsPaths,
  optOutFile,
  readVersionStamp,
} from "../setup/instructions";
import { lockIsHeld, withLock } from "../setup/lock";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { installedText, notifyCommand } from "./apply";
import { backgroundCheck, refreshInstructionsAtSessionStart, sessionStart } from "./background";
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
  /** `claude plugin marketplace update` fails, printing this line on stderr. */
  refreshFails?: string;
  /** Seconds the fake `claude` sleeps in `marketplace update`. */
  claudeSleeps?: number;
  /** More environment for the hook and the CLI (Claude Code's switches, git's variables). */
  env?: Record<string, string>;
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
    // Where it runs, and git's repo variables it was given.
    `echo "cwd=$(pwd) GIT_DIR=\${GIT_DIR-unset} GIT_WORK_TREE=\${GIT_WORK_TREE-unset} GIT_INDEX_FILE=\${GIT_INDEX_FILE-unset}" >> ${q(join(fake, "claude-env.log"))}`,
    'case "$*" in',
    options.refreshFails !== undefined
      ? `  "plugin marketplace update cc-smart-dev-kit") echo ${q(options.refreshFails)} >&2; exit 1 ;;`
      : `  "plugin marketplace update cc-smart-dev-kit") sleep ${options.claudeSleeps ?? 0}; cp ${q(join(fake, "copy-after"))} ${q(join(copy, "plugin", ".claude-plugin", "plugin.json"))}; echo '${remoteHead}' > ${q(join(fake, "local-head"))}; echo refreshed ;;`,
    options.claudeFails === true
      ? '  "plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user") echo "Failed to update: network" >&2; exit 1 ;;'
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
      "plugin marketplace update cc-smart-dev-kit\nplugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user\n",
    );
    expect(m.installedVersion()).toBe("1.1.0");
    expect(m.read("notify.log")).toBe(
      "notify-send cc-smart-dev-kit cc-smart-dev-kit 1.1.0 installed; restart Claude sessions to load it\n",
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
        "1.1.0 (was 1.0.0); its router changed: to run it, cc-smart-dev-kit gateway setup (it asks before the restart)",
      result: "updated",
    });
    expect(m.read("notify.log")).toBe(
      "notify-send cc-smart-dev-kit cc-smart-dev-kit 1.1.0 installed; restart Claude sessions to load it; its router changed: to run it, cc-smart-dev-kit gateway setup (it asks before the restart)\n",
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
) {
  let started = 0;
  const answer = sessionStart({
    env,
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
      "cc-smart-dev-kit 2.0.0 is available (installed: 1.0.0). Run: cc-smart-dev-kit update\n",
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

  test("notify-send on Linux, osascript on macOS, nothing elsewhere or without the tool", () => {
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
