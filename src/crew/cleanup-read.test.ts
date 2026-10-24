import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardWorld, NOW } from "../testing/board-world";
import { git } from "../testing/temp";
import { crewCleanupAnswer } from "./cleanup-read";
import { crewStoreDir } from "./store";

test("cleanup JSON uses the shared stopped need and never removes unmerged work", async () => {
  const w = await boardWorld();
  const record = await w.addCrew({ state: "stopped", atMs: NOW - 2 * 86_400_000 });
  writeFileSync(join(record.worktree, "work.txt"), "unmerged work\n");
  git(record.worktree, "add", ".");
  git(record.worktree, "commit", "-m", "unmerged work");
  const answer = crewCleanupAnswer(w.ctx());
  expect(answer.error).toBeNull();
  expect(answer.stopped).toMatchObject([
    {
      crew: { id: record.id, name: record.name, state: "stopped" },
      repo: w.repo,
      days: 2,
      unmergedCommits: 1,
    },
  ]);
  expect(answer.stopped[0]?.line).toContain("crew resume");
  expect(answer.stopped[0]?.discard.error).toBeNull();
  expect(answer.stopped[0]?.discard.facts?.question).toBe(
    "Archive this work and remove the crew session?",
  );
  expect(answer.stopped[0]?.discard.facts?.unmergedCommits).toEqual({
    count: 1,
    subjects: ["unmerged work"],
  });
  expect(answer.stopped[0]?.discard.facts?.lines).toContain("1 unmerged commit:");
  expect(answer.stopped[0]?.discard.facts?.token).toMatch(/^[0-9a-f]{64}$/);
  expect(
    git(w.repo, "show-ref", "--verify", `refs/heads/${record.branch}`).trim().split(" ")[1],
  ).toBe(`refs/heads/${record.branch}`);
});

test("an unsafe ignored file disables only its discard preview, leaving the shared stopped reminder", async () => {
  const w = await boardWorld();
  const record = await w.addCrew({ state: "stopped", atMs: NOW - 2 * 86_400_000 });
  writeFileSync(join(record.worktree, ".gitignore"), "private.bin\n");
  writeFileSync(join(record.worktree, "private.bin"), Buffer.from([0, 1, 2]));
  const answer = crewCleanupAnswer(w.ctx());
  expect(answer.error).toBeNull();
  expect(answer.stopped).toHaveLength(1);
  expect(answer.stopped[0]?.discard.facts).toBeNull();
  expect(answer.stopped[0]?.discard.error).toContain("not safe to archive");
});

test("a broken ownership record fails the whole cleanup JSON answer closed", async () => {
  const w = await boardWorld();
  const dir = join(crewStoreDir(w.paths.stateDir, w.repo), "crew");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "broken.json"), "{");
  const answer = crewCleanupAnswer(w.ctx());
  expect(answer.stopped).toEqual([]);
  expect(answer.error).toContain("record");
});
