import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardWorld, NOW } from "../testing/board-world";
import { git } from "../testing/temp";
import { runCrew } from "./command";
import { buildCrewDiscardFacts, pruneCrewDiscarded } from "./discard";
import { runCrewRm } from "./remove";
import { readCrew, updateCrew } from "./store";

describe("explicit recoverable crew discard", () => {
  test("archives commits, staged, dirty, untracked and small ignored text; recovery restores them", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, "committed.txt"), "unmerged commit\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "unmerged feature");
    writeFileSync(join(record.worktree, "README.md"), "staged version\n");
    git(record.worktree, "add", "README.md");
    writeFileSync(join(record.worktree, "README.md"), "dirty version\n");
    writeFileSync(join(record.worktree, "new.txt"), "untracked\n");
    writeFileSync(join(record.worktree, ".gitignore"), "private/\n");
    mkdirSync(join(record.worktree, "private"));
    writeFileSync(join(record.worktree, "private", "note.txt"), "ignored text\n");
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(0);
    expect(existsSync(record.worktree)).toBe(false);
    const stored = readCrew(world.paths.stateDir, world.repo, record.id);
    expect(stored?.state).toBe("discarded");
    const ref = `refs/crew-discarded/${record.branch}`;
    expect(git(world.repo, "show", `${ref}:README.md`)).toBe("dirty version\n");
    expect(git(world.repo, "show", `${ref}^:README.md`)).toBe("staged version\n");
    expect(git(world.repo, "show", `${ref}:new.txt`)).toBe("untracked\n");
    expect(git(world.repo, "show", `${ref}:private/note.txt`)).toBe("ignored text\n");
    expect(git(world.repo, "show", `${ref}:committed.txt`)).toBe("unmerged commit\n");
    expect(git(world.repo, "branch", "--list", record.branch)).toBe("");
    expect(world.claudeCalls()).toContainEqual(["rm", "a1b2c3d4"]);
    expect(world.out.join("\n")).toContain("1 unmerged commit");
    expect(world.out.join("\n")).toContain("unmerged feature");
    expect(world.out.join("\n")).toContain(`git branch ${record.branch} ${ref}`);
    git(world.repo, "branch", "recovered", ref);
    const restored = join(world.home, "recovered");
    git(world.repo, "worktree", "add", restored, "recovered");
    expect(readFileSync(join(restored, "private", "note.txt"), "utf8")).toBe("ignored text\n");
    expect(stored?.archive?.ref).toBe(ref);
    expect(stored?.archive?.at).toBe(new Date(NOW).toISOString());
  });

  test("rebuildable dependencies stay disposable while protected ignored notes are archived", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, ".gitignore"), "node_modules/\nprivate/\n");
    mkdirSync(join(record.worktree, "node_modules"));
    for (let i = 0; i < 300; i++)
      writeFileSync(join(record.worktree, "node_modules", `${i}.bin`), Buffer.from([0, 1, 2]));
    mkdirSync(join(record.worktree, "private"));
    writeFileSync(join(record.worktree, "private", "note"), "protected\n");
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(0);
    const ref = `refs/crew-discarded/${record.branch}`;
    expect(git(world.repo, "show", `${ref}:private/note`)).toBe("protected\n");
    expect(git(world.repo, "ls-tree", "--name-only", ref)).not.toContain("node_modules");
  });

  test("without confirmation a pipe does not archive, stop or unlock", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, "draft"), "draft\n");
    expect(await runCrew(["rm", record.id, "--discard"], world.ctx())).toBe(1);
    expect(existsSync(record.worktree)).toBe(true);
    expect(world.claudeVerbs()).not.toContain("rm");
    expect(git(world.repo, "for-each-ref", "refs/crew-discarded/")).toBe("");
    expect(world.out.join("\n")).toContain("Nothing removed");
  });

  test.each(["binary", "large", "symlink"])(
    "refuses unsafe ignored %s without changing the branch or index",
    async (kind) => {
      const world = await boardWorld();
      const record = await world.addCrew({ state: "stopped" });
      writeFileSync(join(record.worktree, ".gitignore"), "ignored\n");
      const file = join(record.worktree, "ignored");
      if (kind === "symlink") symlinkSync("README.md", file);
      else writeFileSync(file, kind === "binary" ? Buffer.from([0, 1, 2]) : "x".repeat(65_537));
      const before = git(record.worktree, "rev-parse", "HEAD");
      const index = git(record.worktree, "write-tree");
      expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(1);
      expect(world.err.join("\n")).toContain("ignored");
      expect(world.err.join("\n")).toContain("small regular UTF-8 text");
      expect(git(record.worktree, "rev-parse", "HEAD")).toBe(before);
      expect(git(record.worktree, "write-tree")).toBe(index);
      expect(git(world.repo, "for-each-ref", "refs/crew-discarded/")).toBe("");
      expect(world.claudeVerbs()).not.toContain("stop");
    },
  );

  test.each(["person", "container", "unknown programs", "unknown containers"])(
    "%s refuses before archive or stop",
    async (kind) => {
      const world = await boardWorld();
      const record = await world.addCrew({ state: "stopped" });
      writeFileSync(join(record.worktree, "draft"), "draft\n");
      const before = git(record.worktree, "rev-parse", "HEAD");
      const ctx = world.ctx({
        scanFacts: {
          sessions: [],
          mounts: [],
          programs:
            kind === "unknown programs"
              ? "unknown"
              : kind === "person"
                ? [{ pid: 424242, parentPid: 1, path: "/usr/bin/editor", cwd: record.worktree }]
                : [],
          containers:
            kind === "unknown containers"
              ? "unknown"
              : kind === "container"
                ? [{ name: "database", sources: [record.worktree] }]
                : [],
        },
      });
      expect(await runCrew(["rm", record.id, "--discard", "--yes"], ctx)).toBe(1);
      expect(git(record.worktree, "rev-parse", "HEAD")).toBe(before);
      expect(git(world.repo, "for-each-ref", "refs/crew-discarded/")).toBe("");
      expect(existsSync(record.worktree)).toBe(true);
      expect(world.claudeVerbs()).not.toContain("stop");
    },
  );

  test("a preview token refuses new untracked, staged or ignored content before side effects", async () => {
    for (const kind of ["untracked", "staged", "ignored"]) {
      const world = await boardWorld();
      const record = await world.addCrew({ state: "stopped" });
      writeFileSync(join(record.worktree, ".gitignore"), "ignored\n");
      writeFileSync(join(record.worktree, "ignored"), "before\n");
      const preview = buildCrewDiscardFacts(record, world.ctx());
      if (kind === "untracked") writeFileSync(join(record.worktree, "new.txt"), "after\n");
      else if (kind === "ignored") writeFileSync(join(record.worktree, "ignored"), "after\n");
      else {
        writeFileSync(join(record.worktree, "README.md"), "staged\n");
        git(record.worktree, "add", "README.md");
      }
      expect(
        await runCrew(
          ["rm", record.id, "--discard", "--yes", "--discard-token", preview.token],
          world.ctx(),
        ),
      ).toBe(1);
      expect(world.err.join("\n")).toContain("work changed since the discard preview");
      expect(git(world.repo, "for-each-ref", "refs/crew-discarded/")).toBe("");
      expect(world.claudeVerbs()).not.toContain("stop");
    }
  });

  test("interactive confirmation uses the shared words and rechecks content afterward", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, "draft"), "before\n");
    const preview = buildCrewDiscardFacts(record, world.ctx());
    const questions: string[] = [];
    expect(
      await runCrewRm(record.id, world.ctx(), {
        discard: true,
        confirm: (question) => {
          questions.push(question);
          writeFileSync(join(record.worktree, "draft"), "after\n");
          return true;
        },
      }),
    ).toBe(1);
    expect(questions).toEqual([preview.question]);
    expect(world.out).toEqual(preview.lines);
    expect(world.err.join("\n")).toContain("work changed since confirmation");
    expect(git(world.repo, "for-each-ref", "refs/crew-discarded/")).toBe("");
  });

  test("archive refs are immutable when a discarded branch name is used again", async () => {
    const world = await boardWorld();
    const first = await world.addCrew({ state: "stopped" });
    writeFileSync(join(first.worktree, "draft"), "first\n");
    expect(await runCrew(["rm", first.id, "--discard", "--yes"], world.ctx())).toBe(0);
    const archived = git(world.repo, "rev-parse", `refs/crew-discarded/${first.branch}`);
    const second = await world.addCrew({ state: "stopped", suffix: "second" });
    writeFileSync(join(second.worktree, "draft"), "second\n");
    expect(await runCrew(["rm", second.id, "--discard", "--yes"], world.ctx())).toBe(1);
    expect(git(world.repo, "rev-parse", `refs/crew-discarded/${first.branch}`)).toBe(archived);
    expect(existsSync(second.worktree)).toBe(true);
    expect(readFileSync(join(second.worktree, "draft"), "utf8")).toBe("second\n");
  });

  test("prune keeps exactly 30 days and incomplete removals; expires older completed archives once", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, "draft"), "kept in archive\n");
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(0);
    const archive = `refs/crew-discarded/${record.branch}`;
    expect(
      await pruneCrewDiscarded(world.repo, world.ctx({ now: () => NOW + 30 * 86_400_000 })),
    ).toEqual([]);
    await updateCrew(world.paths.stateDir, world.repo, record.id, { state: "stopped" }, NOW);
    expect(
      await pruneCrewDiscarded(world.repo, world.ctx({ now: () => NOW + 31 * 86_400_000 })),
    ).toEqual([]);
    await updateCrew(world.paths.stateDir, world.repo, record.id, { state: "discarded" }, NOW);
    expect(
      await pruneCrewDiscarded(world.repo, world.ctx({ now: () => NOW + 31 * 86_400_000 })),
    ).toEqual([`pruned ${archive} (discarded more than 30 days ago)`]);
    expect(git(world.repo, "for-each-ref", "refs/crew-discarded/")).toBe("");
    expect(
      await pruneCrewDiscarded(world.repo, world.ctx({ now: () => NOW + 32 * 86_400_000 })),
    ).toEqual([]);
  });

  test("a failed claude rm keeps recovery and retries without recommitting or changing its immutable ref", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, "draft"), "recoverable\n");
    expect(
      await runCrew(
        ["rm", record.id, "--discard", "--yes"],
        world.ctx(
          {},
          {
            FAKE_RM: "fail",
            FAKE_AGENTS_JSON: JSON.stringify([
              { id: "a1b2c3d4", name: record.name, state: "stopped" },
            ]),
          },
        ),
      ),
    ).toBe(1);
    const archived = git(world.repo, "rev-parse", `refs/crew-discarded/${record.branch}`);
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(0);
    expect(git(world.repo, "rev-parse", `refs/crew-discarded/${record.branch}`)).toBe(archived);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("discarded");
  });

  test("against uses the supplied base even when the historical lead proof is valid", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    const base = git(world.repo, "rev-parse", "HEAD").trim();
    writeFileSync(join(record.worktree, "draft"), "committed\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "not on supplied base");
    git(world.repo, "merge", "--no-ff", "-m", "lead merge", record.branch);
    expect(
      await runCrewRm(record.id, world.ctx(), { against: { label: "project base", ref: base } }),
    ).toBe(1);
    expect(existsSync(record.worktree)).toBe(true);
    expect(world.err.join("\n")).toContain("project base does not have");
  });
});
