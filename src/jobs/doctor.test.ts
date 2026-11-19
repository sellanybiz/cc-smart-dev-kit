import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import {
  type FakeLimitOptions,
  fakeControllersFile,
  fakeLimitFacts,
  fakeSliceDir,
} from "../testing/limit-facts";
import { tempDir } from "../testing/temp";
import { jobsPaths, setHeavyLimit } from "./config";
import { gitHooksCheck, heavyJobChecks, limitsChecks } from "./doctor";
import { installGitHooksFolder } from "./hook-folder";
import type { LimitFacts } from "./limits";

test("doctor reports default, chosen source and ignored legacy maxJobs with a fix", async () => {
  const paths = cliPaths({ HOME: tempDir("jobs-doctor") });
  // The git hooks folder has its own line (below); this test reads the queue's own lines.
  const queueChecks = () => heavyJobChecks(paths, null, "linux").slice(0, -1);
  expect(queueChecks()).toEqual([{ ok: true, info: true, text: "Heavy-job limit: 1 (default)" }]);
  const files = jobsPaths(paths.home);
  mkdirSync(dirname(files.legacyFile), { recursive: true });
  writeFileSync(files.legacyFile, '﻿{"maxJobs":3}');
  await setHeavyLimit(paths, 2);
  expect(queueChecks()).toEqual([
    { ok: true, info: true, text: `Heavy-job limit: 2 (${files.configFile})` },
    {
      ok: true,
      info: true,
      text: `${files.legacyFile}: legacy maxJobs is ignored`,
      fix: "Remove maxJobs from that old file; use cc-smart-dev-kit job set max <n> to choose the new limit",
    },
  ]);
  writeFileSync(files.configFile, '{"maxConcurrent":0}');
  expect(queueChecks()[0]).toMatchObject({
    ok: false,
    fix: "Run cc-smart-dev-kit job set max <n> with a valid limit, or remove maxConcurrent from the new file",
  });
});

// The caps' lines read files and the process list only, so a fake that cannot ask systemd is
// enough, and the portal can show the same lines. They are information or a warning: a cap
// that cannot apply never fails `doctor`.
describe("the CPU and memory caps' lines", () => {
  const MEMINFO = "MemTotal:       32768000 kB\n";
  const MEMORY_90 = String(Math.round(32768000 * 1024 * 0.9));
  const sliceFile = (name: string) => `${fakeSliceDir()}/${name}`;
  /** A fake machine; `systemd` throws, because `doctor` must never ask it. */
  const machine = (options: FakeLimitOptions = {}) => {
    const { facts, files } = fakeLimitFacts({
      ...options,
      files: { "/proc/meminfo": MEMINFO, ...options.files },
      systemd: () => {
        throw new Error("doctor must not call systemd");
      },
      systemdText: () => {
        throw new Error("doctor must not call systemd");
      },
    });
    return { facts, files };
  };
  const checks = (facts: LimitFacts, home = tempDir("jobs-doctor-caps")) =>
    limitsChecks(cliPaths({ HOME: home }), facts);

  test("applied: it reads cpu.max and memory.max before it claims a cap", () => {
    const { facts } = machine({
      files: { [sliceFile("cpu.max")]: "1080000 100000", [sliceFile("memory.max")]: MEMORY_90 },
    });
    expect(checks(facts)).toEqual([
      {
        ok: true,
        text: "Heavy-job caps applied on cc-smart-dev-kit-jobs.slice: CPU 90%, memory 90% (12 CPUs); the jobs yield to your apps",
      },
    ]);
  });

  test("no heavy job since boot: the caps are set, and the line says when they are written", () => {
    expect(checks(machine().facts)).toEqual([
      {
        ok: true,
        info: true,
        text: "Heavy-job caps: CPU 90%, memory 90%; written to cc-smart-dev-kit-jobs.slice when the next heavy job starts",
      },
    ]);
  });

  test("a slice that carries other values is a warning that names them, never a claim", () => {
    const { facts } = machine({
      files: { [sliceFile("cpu.max")]: "max 100000", [sliceFile("memory.max")]: "max" },
    });
    expect(checks(facts)).toEqual([
      {
        ok: true,
        warn: true,
        text: 'cc-smart-dev-kit-jobs.slice carries cpu.max "max 100000" and memory.max "max", not the caps set (CPU 90%, memory 90%)',
        fix: "the next heavy job writes the caps again; check them with: systemctl --user show cc-smart-dev-kit-jobs.slice",
      },
    ]);
  });

  test("systemd-oomd not running: a warning with the fix; the caps line stays", () => {
    const lines = checks(machine({ oomd: false }).facts);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      ok: true,
      warn: true,
      text: "systemd-oomd is not running: the caps hold, but nothing stops a heavy job that stalls on memory",
      fix: "start it (as root): systemctl enable --now systemd-oomd",
    });
  });

  test("a bad setting: the caps are off, the key is named, and the fix is there", () => {
    const home = tempDir("jobs-doctor-caps");
    const files = jobsPaths(home);
    mkdirSync(dirname(files.configFile), { recursive: true });
    writeFileSync(files.configFile, '{"cpuPercent":500}');
    expect(checks(machine().facts, home)).toEqual([
      {
        ok: true,
        warn: true,
        text: `Heavy-job caps are off: ${files.configFile}: cpuPercent must be an integer from 10 to 100`,
        fix: "correct it in that file (a whole number from 10 to 100), or remove it and run cc-smart-dev-kit job set cpu <n>",
      },
    ]);
  });

  test("the reasons they cannot apply: a warning each, never a failure, and no oomd line after", () => {
    const reasons: [FakeLimitOptions, string][] = [
      [
        { files: { [fakeControllersFile()]: null } },
        "no systemd user manager with cgroup v2 here (its controllers file is missing)",
      ],
      [
        { files: { [fakeControllersFile()]: "memory pids" } },
        'the systemd user manager has no delegated "cpu" controller',
      ],
      [{ programs: ["choom"] }, "systemd-run is not installed"],
    ];
    for (const [options, why] of reasons) {
      expect(checks(machine({ ...options, oomd: false }).facts)).toEqual([
        {
          ok: true,
          warn: true,
          text: `Heavy-job caps cannot apply here: ${why}; heavy jobs run without them`,
          fix: "see docs/jobs.md § Limits in the plugin's repo for what the caps need",
        },
      ]);
    }
  });

  test("macOS and Windows: one note, and nothing else is read", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(checks(machine({ platform }).facts)).toEqual([
        {
          ok: true,
          info: true,
          text: `Heavy-job CPU and memory caps: not applied on ${platform}; heavy jobs run as they are`,
        },
      ]);
    }
  });

  test("heavyJobChecks puts the caps' lines after the limit's and before the git hooks' line", () => {
    const paths = cliPaths({ HOME: tempDir("jobs-doctor-caps") });
    const all = heavyJobChecks(paths, machine().facts, "linux");
    expect(all[0]?.text).toBe("Heavy-job limit: 1 (default)");
    expect(all[1]?.text).toStartWith("Heavy-job caps");
    expect(all.at(-1)).toEqual(gitHooksCheck(paths, "linux"));
    expect(
      heavyJobChecks(paths, null, "linux").some((c) => c.text.startsWith("Heavy-job caps")),
    ).toBe(false);
  });

  test("no line of the caps is ever a failure", () => {
    for (const options of [{}, { oomd: false }, { platform: "darwin" as const }, { uid: null }]) {
      expect(checks(machine(options).facts).every((check) => check.ok)).toBe(true);
    }
  });
});

describe("the git hooks folder's line", () => {
  test("a machine that never ran setup: a warning that names the fix, never a failure", () => {
    const paths = cliPaths({ HOME: tempDir("jobs-doctor-hooks") });
    // `update` does not run setup, and the route adds nothing without the folder: nothing is broken.
    expect(gitHooksCheck(paths, "linux")).toEqual({
      ok: true,
      warn: true,
      text: "Git hooks folder is missing (~/.local/share/cc-smart-dev-kit/git-hooks): a commit or push whose hook runs heavy work does not wait for a slot",
      fix: "cc-smart-dev-kit setup",
    });
    // It is the last line of the queue's group, so a person sees it with the others.
    expect(heavyJobChecks(paths, null, "linux").at(-1)).toEqual(gitHooksCheck(paths, "linux"));
  });

  test("a folder as this version writes it passes", () => {
    const paths = cliPaths({ HOME: tempDir("jobs-doctor-hooks") });
    installGitHooksFolder(paths);
    expect(gitHooksCheck(paths, "linux")).toEqual({
      ok: true,
      text: "Git hooks folder: 26 hook scripts, executable and up to date",
    });
  });

  test("a missing, stale or non-executable script is named, with the fix; the list is cut at three", () => {
    const paths = cliPaths({ HOME: tempDir("jobs-doctor-hooks") });
    installGitHooksFolder(paths);
    const folder = paths.gitHooksFolder;
    chmodSync(join(folder, "pre-commit"), 0o644);
    expect(gitHooksCheck(paths, "linux")).toEqual({
      ok: false,
      text: "Git hooks folder ~/.local/share/cc-smart-dev-kit/git-hooks: pre-commit is not executable",
      fix: "cc-smart-dev-kit setup",
    });
    writeFileSync(join(folder, "pre-push"), "#!/bin/sh\n# an older version\n");
    chmodSync(join(folder, "pre-push"), 0o755);
    rmSync(join(folder, "commit-msg"));
    rmSync(join(folder, "post-merge"));
    expect(gitHooksCheck(paths, "linux")).toEqual({
      ok: false,
      text: "Git hooks folder ~/.local/share/cc-smart-dev-kit/git-hooks: pre-commit is not executable, commit-msg is missing, post-merge is missing and 1 more",
      fix: "cc-smart-dev-kit setup",
    });
  });

  test("a folder at that path the kit did not make: the fix that works, not setup alone", () => {
    const paths = cliPaths({ HOME: tempDir("jobs-doctor-hooks") });
    mkdirSync(paths.gitHooksFolder, { recursive: true });
    writeFileSync(join(paths.gitHooksFolder, "pre-commit"), "#!/bin/sh\nmine\n");
    // Setup refuses it ("move it away"), so the fix names that step first.
    expect(gitHooksCheck(paths, "linux")).toEqual({
      ok: false,
      text: "Git hooks folder ~/.local/share/cc-smart-dev-kit/git-hooks was not made by cc-smart-dev-kit, so setup leaves it alone",
      fix: "move that folder away by hand, then run: cc-smart-dev-kit setup",
    });
    // Once it is moved away, setup writes the kit's own folder and the line passes.
    rmSync(paths.gitHooksFolder, { recursive: true });
    installGitHooksFolder(paths);
    expect(gitHooksCheck(paths, "linux").ok).toBe(true);
  });

  test("native Windows: one plain line, never a failure", () => {
    const paths = cliPaths({ HOME: tempDir("jobs-doctor-hooks") });
    expect(gitHooksCheck(paths, "win32")).toEqual({
      ok: true,
      info: true,
      text: "Git hook queue: not set up on Windows yet; commit and push hooks run as they are",
    });
  });
});
