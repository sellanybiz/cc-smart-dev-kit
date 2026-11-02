import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardWorld } from "../testing/board-world";
import { git } from "../testing/temp";
import { runCrew } from "./command";
import { crewFile } from "./store";

test("log reads shared refs from another worktree without changing the store", async () => {
  const world = await boardWorld();
  const record = await world.addCrew();
  writeFileSync(join(record.worktree, "phase.txt"), "one\n");
  git(record.worktree, "add", "phase.txt");
  git(record.worktree, "commit", "-qm", "phase change");
  const sha = git(world.repo, "rev-parse", "--short", record.branch).trim();
  const caller = join(world.repo, ".claude", "worktrees", "reader");
  git(world.repo, "worktree", "add", "-b", "reader", caller, "HEAD");
  const file = crewFile(world.paths.stateDir, world.repo, record.id);
  const before = readFileSync(file, "utf8");
  expect(await runCrew(["log", record.id], world.ctx({ cwd: caller }))).toBe(0);
  expect(world.out).toEqual([
    `${record.name} — ${record.branch}`,
    `Commits since ${record.base?.sha}:`,
    `${sha} phase change`,
    "Diff stat against merge base:",
    "phase.txt | 1 +\n 1 file changed, 1 insertion(+)",
  ]);
  expect(readFileSync(file, "utf8")).toBe(before);
  world.out.length = 0;
  expect(await runCrew(["log", record.name], world.ctx())).toBe(0);
  expect(world.out[2]).toBe(`${sha} phase change`);
});

test("log distinguishes an empty branch from an unreadable one", async () => {
  const world = await boardWorld();
  const record = await world.addCrew();
  expect(await runCrew(["log", record.id], world.ctx())).toBe(0);
  expect(world.out.slice(2)).toEqual([
    "No commits.",
    "Diff stat against merge base:",
    "No changes.",
  ]);
});

test("log refuses unknown names, queued branches and missing refs", async () => {
  const world = await boardWorld();
  expect(await runCrew(["log", "unknown"], world.ctx())).toBe(1);
  expect(world.err.join("\n")).toContain("no crew session");
  const queued = await world.addCrew({ state: "queued", worktree: false, base: null });
  world.err.length = 0;
  expect(await runCrew(["log", queued.id], world.ctx())).toBe(1);
  expect(world.err.join("\n")).toContain("has no branch base yet");
  const missing = await world.addCrew({
    slug: "missing",
    worktree: false,
    base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
  });
  world.err.length = 0;
  expect(await runCrew(["log", missing.id], world.ctx())).toBe(1);
  expect(world.err.join("\n")).toContain("cannot read commits");
});
