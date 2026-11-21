import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  launchedHere,
  launchRecordPath,
  launchRecordsFolder,
  writeLaunchRecord,
} from "./launch-record";

function folders() {
  const stateDir = tempDir("launch-state");
  const repo = tempDir("launch-repo");
  const worktree = join(tempDir("launch-elsewhere"), "feature");
  mkdirSync(worktree);
  return { repo, stateDir, worktree };
}

test("a launch record is private, keyed by the worktree, and names the repo and the branch", async () => {
  const { repo, stateDir, worktree } = folders();
  expect(launchedHere(stateDir, repo, worktree)).toBe(false);
  await writeLaunchRecord(stateDir, { at: 5, branch: "feat-x", repo, worktree });
  const file = launchRecordPath(stateDir, worktree);
  expect(dirname(file)).toBe(launchRecordsFolder(stateDir));
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
    at: 5,
    branch: "feat-x",
    repo,
    worktree,
  });
  if (process.platform !== "win32") {
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
  }
  expect(launchedHere(stateDir, repo, worktree)).toBe(true);
});

test("a record vouches only for its own worktree of its own repo", async () => {
  const { repo, stateDir, worktree } = folders();
  await writeLaunchRecord(stateDir, { at: 5, branch: "feat-x", repo, worktree });
  const other = join(tempDir("launch-elsewhere"), "feature");
  mkdirSync(other);
  expect(launchedHere(stateDir, repo, other)).toBe(false);
  expect(launchedHere(stateDir, tempDir("launch-repo"), worktree)).toBe(false);
});

test("a record found through a link to the folder still names it", async () => {
  const { repo, stateDir, worktree } = folders();
  await writeLaunchRecord(stateDir, { at: 5, branch: "feat-x", repo, worktree });
  const links = tempDir("launch-links");
  symlinkSync(dirname(worktree), join(links, "via"));
  expect(launchedHere(stateDir, repo, join(links, "via", "feature"))).toBe(true);
});

test("a file that is not a record, or names another worktree, never vouches", async () => {
  const { repo, stateDir, worktree } = folders();
  const file = launchRecordPath(stateDir, worktree);
  mkdirSync(dirname(file), { recursive: true });
  for (const text of [
    "not json",
    "[]",
    "null",
    '{"at":"5","branch":"b","repo":"r","worktree":"w"}',
  ]) {
    writeFileSync(file, text);
    expect(launchedHere(stateDir, repo, worktree)).toBe(false);
  }
  // A well-formed record under this worktree's key that names another folder is refused.
  writeFileSync(
    file,
    JSON.stringify({ at: 1, branch: "b", repo, worktree: join(repo, "elsewhere") }),
  );
  expect(launchedHere(stateDir, repo, worktree)).toBe(false);
});
