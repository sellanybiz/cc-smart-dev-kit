import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, tempDir } from "../testing/temp";
import * as machineFacts from "./machine-facts";
import { isParkedWorktree, parkedOriginal } from "./scan";
import { finishStrays, strayKeptWhy, strayParkedFolders } from "./scan-parked";

const ROOT = "/work/app/.claude/worktrees";
const QUIET = { containers: [], programs: [], sessions: [], mounts: [] };

describe("leftover folder marks", () => {
  test("recognizes only 13-digit move times and repeated marks", () => {
    const good = `${ROOT}/crew-B1-help-removing-1761300000000`;
    expect(isParkedWorktree(good)).toBe(true);
    expect(parkedOriginal(good)).toBe(`${ROOT}/crew-B1-help`);
    expect(parkedOriginal(`${good}-removing-1761300090000`)).toBe(`${ROOT}/crew-B1-help`);
    for (const path of [
      `${ROOT}/crew-B1-removing-2`,
      "/work/app-wt-x-removing-3",
      `${ROOT}/crew-B1-help-removing-176130000000`,
      `${ROOT}/crew-B1-help-removing-17613000000000`,
    ]) {
      expect(isParkedWorktree(path)).toBe(false);
      expect(parkedOriginal(path)).toBeNull();
    }
  });

  test("does not list a short mark as a stray", () => {
    const repo = tempDir("leftover-repo");
    mkdirSync(join(repo, ".claude", "worktrees"), { recursive: true });
    const unsafe = join(repo, ".claude", "worktrees", "crew-B1-removing-2");
    const safe = join(repo, ".claude", "worktrees", "crew-B1-help-removing-1761300000000");
    mkdirSync(unsafe);
    mkdirSync(safe);
    expect(strayParkedFolders(repo, cleanGitEnv()).map((one) => one.path)).toEqual([safe]);
  });
});

describe("mount points", () => {
  test("parses and decodes mountinfo paths", () => {
    const text = [
      "1 0 8:1 / / rw - ext4 /dev/sda1 rw",
      "2 1 0:1 / /dev rw - devtmpfs devtmpfs rw",
      "3 1 0:2 / /proc rw - proc proc rw",
      "4 1 0:3 / /work/heavy\\040jobs rw - tmpfs tmpfs rw",
      "5 1 0:4 / /work/slash\\134name rw - tmpfs tmpfs rw",
    ].join("\\n");
    expect(machineFacts.parseMountPoints(text)).toEqual([
      "/",
      "/dev",
      "/proc",
      "/work/heavy jobs",
      "/work/slash\\name",
    ]);
  });

  test("keeps a stray for a mount inside it, but not one above it", () => {
    const dir = tempDir("mount-why");
    const stray = { path: dir, parkedAt: 1 };
    const machine = { ...QUIET, mounts: ["/", join(dir, "sub")] };
    expect(strayKeptWhy(stray, machine)).toBe(`a mount point lies inside it: ${join(dir, "sub")}`);
    expect(strayKeptWhy(stray, { ...QUIET, mounts: [dir] })).toBe(
      `a mount point lies inside it: ${dir}`,
    );
    expect(strayKeptWhy(stray, { ...QUIET, mounts: ["/", join(dir, "..")] })).toBeNull();
    expect(strayKeptWhy(stray, { ...QUIET, mounts: "unknown" })).toBe(
      "its mount points could not be read, so it cannot be shown that nothing is mounted in it",
    );
  });

  test("finishStrays keeps mounted folders and removes folders with no mounts", () => {
    const repo = tempDir("mount-finish");
    const folder = join(repo, "stray");
    mkdirSync(folder);
    writeFileSync(join(folder, "left.txt"), "left\n");
    const stray = { path: folder, parkedAt: 1 };
    const kept = finishStrays(
      repo,
      {
        base: "main",
        claudeConfigDir: repo,
        env: cleanGitEnv(),
        facts: { ...QUIET, mounts: ["/", join(folder, "sub")] },
      },
      () => undefined,
      [stray],
    );
    expect(kept.kept).toEqual([
      { path: folder, why: `a mount point lies inside it: ${join(folder, "sub")}` },
    ]);
    expect(readFileSync(join(folder, "left.txt"), "utf8")).toBe("left\n");
    expect(existsSync(folder)).toBe(true);
    const removed = finishStrays(
      repo,
      { base: "main", claudeConfigDir: repo, env: cleanGitEnv(), facts: { ...QUIET, mounts: [] } },
      () => undefined,
      [stray],
    );
    expect(removed.removed).toEqual([folder]);
    expect(existsSync(folder)).toBe(false);
  });

  test("reads the Linux mount list", () => {
    expect(machineFacts.mountPoints()).toContain("/");
  });
});
