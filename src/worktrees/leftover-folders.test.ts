import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import * as machineFacts from "./machine-facts";
import { isParkedWorktree, parkedOriginal } from "./scan";
import { finishParked, finishStrays, strayKeptWhy, strayParkedFolders } from "./scan-parked";

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
    git(repo, "init", "-b", "main");
    mkdirSync(join(repo, ".claude", "worktrees"), { recursive: true });
    const unsafe = join(repo, ".claude", "worktrees", "crew-B1-removing-2");
    const safe = join(repo, ".claude", "worktrees", "crew-B1-help-removing-1761300000000");
    mkdirSync(unsafe);
    mkdirSync(safe);
    expect(strayParkedFolders(repo, cleanGitEnv()).map((one) => one.path)).toEqual([safe]);
  });
});

describe("mount points", () => {
  test("a registered parked worktree with a bind mount stays", () => {
    const repo = tempDir("registered-mount");
    git(repo, "init", "-b", "main");
    writeFileSync(join(repo, "file.txt"), "x\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "initial");
    const parked = join(repo, ".claude", "worktrees", "crew-x-removing-1761300000000");
    git(repo, "worktree", "add", "-b", "crew/x", parked);
    const pass = finishParked(
      repo,
      [parked],
      {
        against: { label: "main", ref: "main" },
        base: "main",
        claudeConfigDir: tempDir("config"),
        env: cleanGitEnv(),
        facts: { ...QUIET, mounts: [join(parked, "bound")] },
        idleLimit: 0,
      },
      () => {},
    );
    expect(existsSync(parked)).toBe(true);
    expect(pass.kept).toEqual([
      { path: parked, why: `a mount point lies inside it: ${join(parked, "bound")}` },
    ]);
  });
  test("parses and decodes mountinfo paths", () => {
    const text = [
      "1 0 8:1 / / rw - ext4 /dev/sda1 rw",
      "2 1 0:1 / /dev rw - devtmpfs devtmpfs rw",
      "3 1 0:2 / /proc rw - proc proc rw",
      "4 1 0:3 / /work/heavy\\040jobs rw - tmpfs tmpfs rw",
      "5 1 0:4 / /work/slash\\134name rw - tmpfs tmpfs rw",
    ].join("\n");
    expect(machineFacts.parseMountPoints(text)).toEqual([
      "/",
      "/dev",
      "/proc",
      "/work/heavy jobs",
      "/work/slash\\name",
    ]);
  });

  test("rejects incomplete mount information", () => {
    expect(machineFacts.parseMountPoints("")).toBeNull();
    expect(machineFacts.parseMountPoints("broken")).toBeNull();
    expect(machineFacts.parseMountPoints("1 0 8:1 / / rw - ext4 disk rw\ninvalid")).toBeNull();
    expect(machineFacts.mountPoints("darwin")).toBe("unknown");
  });

  test("keeps a leftover whose files cannot be inspected", () => {
    const root = tempDir("unreadable-leftover");
    expect(strayKeptWhy({ path: join(root, "missing"), parkedAt: Date.now() }, QUIET)).toBe(
      "its files could not all be read",
    );
  });

  test("detects a same-disk bind mount from mountinfo", () => {
    const dir = tempDir("bind-mount");
    const mounts = machineFacts.parseMountPoints(
      `1 0 8:1 / / rw - ext4 /dev/sda1 rw\n2 1 8:1 /source ${dir}/bound rw - ext4 /dev/sda1 rw\n`,
    );
    expect(mounts).toEqual(["/", `${dir}/bound`]);
    expect(
      strayKeptWhy({ path: dir, parkedAt: Date.now() }, { ...QUIET, mounts: mounts ?? "unknown" }),
    ).toBe(`a mount point lies inside it: ${dir}/bound`);
  });

  test("keeps a stray for a mount inside it, but not one above it", () => {
    const dir = tempDir("mount-why");
    const stray = { path: dir, parkedAt: Date.now() };
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
    const stray = { path: folder, parkedAt: Date.now() };
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

  test.skipIf(process.platform !== "linux")("reads the Linux mount list", () => {
    expect(machineFacts.mountPoints()).toContain("/");
  });
});
