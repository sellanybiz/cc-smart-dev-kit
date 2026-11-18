import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { jobsPaths, setHeavyLimit } from "./config";
import { gitHooksCheck, heavyJobChecks } from "./doctor";
import { installGitHooksFolder } from "./hook-folder";

test("doctor reports default, chosen source and ignored legacy maxJobs with a fix", async () => {
  const paths = cliPaths({ HOME: tempDir("jobs-doctor") });
  // The git hooks folder has its own line (below); this test reads the queue's own lines.
  const queueChecks = () => heavyJobChecks(paths, "linux").slice(0, -1);
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

describe("the git hooks folder's line", () => {
  test("a machine that never ran setup: a failure that names the fix", () => {
    const paths = cliPaths({ HOME: tempDir("jobs-doctor-hooks") });
    expect(gitHooksCheck(paths, "linux")).toEqual({
      ok: false,
      text: "Git hooks folder is missing (~/.local/share/cc-smart-dev-kit/git-hooks)",
      fix: "Run cc-smart-dev-kit setup",
    });
    // It is the last line of the queue's group, so a person sees it with the others.
    expect(heavyJobChecks(paths, "linux").at(-1)).toEqual(gitHooksCheck(paths, "linux"));
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
      fix: "Run cc-smart-dev-kit setup",
    });
    writeFileSync(join(folder, "pre-push"), "#!/bin/sh\n# an older version\n");
    chmodSync(join(folder, "pre-push"), 0o755);
    rmSync(join(folder, "commit-msg"));
    rmSync(join(folder, "post-merge"));
    expect(gitHooksCheck(paths, "linux")).toEqual({
      ok: false,
      text: "Git hooks folder ~/.local/share/cc-smart-dev-kit/git-hooks: pre-commit is not executable, commit-msg is missing, post-merge is missing and 1 more",
      fix: "Run cc-smart-dev-kit setup",
    });
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
