import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { boardWorld, NOW } from "../testing/board-world";
import { git } from "../testing/temp";
import { runCrew } from "./command";
import {
  archiveCrewDiscard,
  buildCrewDiscardFacts,
  pruneCrewDiscarded,
  rollbackCrewDiscard,
} from "./discard";
import { runCrewRm } from "./remove";
import { readCrew, updateCrew } from "./store";

describe("explicit recoverable crew discard", () => {
  test("discard reads project rebuildable patterns once for the whole ignored walk", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, ".gitignore"), "private/\n");
    mkdirSync(join(record.worktree, "private"));
    writeFileSync(join(record.worktree, "private", "one"), "one\n");
    writeFileSync(join(record.worktree, "private", "two"), "two\n");
    const config = join(record.repo, ".claude", "cc-smart-dev-kit.json");
    const read = spyOn(fs, "readFileSync");
    try {
      expect(buildCrewDiscardFacts(record, world.ctx()).ignoredFiles).toEqual([
        "private/one",
        "private/two",
      ]);
      expect(read.mock.calls.filter(([file]) => file === config)).toHaveLength(1);
    } finally {
      read.mockRestore();
    }
  });

  test.each(["unlock", "scan", "move", "remove"])(
    "a failed %s restores exact branch/index without exposing ignored bytes and can retry",
    async (step) => {
      const world = await boardWorld();
      const record = await world.addCrew({ state: "stopped" });
      writeFileSync(join(record.worktree, "README.md"), "staged\n");
      git(record.worktree, "add", "README.md");
      writeFileSync(join(record.worktree, "README.md"), "disk\n");
      writeFileSync(join(record.worktree, ".gitignore"), ".env\n");
      writeFileSync(join(record.worktree, ".env"), "PRIVATE_TEST_VALUE=kept\n");
      if (step === "unlock")
        git(
          world.repo,
          "worktree",
          "lock",
          "--reason",
          `claude session fixture (pid ${process.pid} start ${process.pid})`,
          record.worktree,
        );
      buildCrewDiscardFacts(record, world.ctx());
      const before = git(record.worktree, "rev-parse", "HEAD");
      const indexPath = git(
        record.worktree,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index",
      ).trim();
      const index = readFileSync(indexPath);
      const fake = join(world.bin, "git");
      writeFileSync(
        fake,
        `#!/bin/sh\nif [ "$1 $2" = "worktree $FAIL_STEP" ] || { [ "$FAIL_STEP" = scan ] && [ "$1" = rev-list ] && [ -n "$("$REAL_GIT" for-each-ref refs/crew-discarded/)" ]; }; then printf 'injected refusal\\n' >&2; exit 1; fi\nexec "$REAL_GIT" "$@"\n`,
      );
      chmodSync(fake, 0o755);
      const ctx = world.ctx({}, { FAIL_STEP: step, REAL_GIT: Bun.which("git") ?? "" });
      expect(await runCrew(["rm", record.id, "--discard", "--yes"], ctx)).toBe(1);
      expect(git(world.repo, "rev-parse", `refs/heads/${record.branch}`)).toBe(before);
      expect(readFileSync(indexPath)).toEqual(index);
      const path = existsSync(record.worktree)
        ? record.worktree
        : git(world.repo, "worktree", "list", "--porcelain")
            .split("\n")
            .find((line) => line.startsWith(`worktree ${record.worktree}-removing-`))
            ?.slice(9);
      if (path === undefined) throw new Error("failed removal lost its folder");
      expect(readFileSync(join(path, ".env"), "utf8")).toBe("PRIVATE_TEST_VALUE=kept\n");
      expect(readFileSync(join(path, "README.md"), "utf8")).toBe("disk\n");
      expect(git(world.repo, "ls-tree", "--name-only", record.branch)).not.toContain(".env");
      const saved = readCrew(world.paths.stateDir, world.repo, record.id);
      expect(saved?.archive).toBeUndefined();
      expect(saved?.discardPending).toBeUndefined();
      expect(saved?.archiveHistory).toHaveLength(1);
      if (path !== record.worktree) git(world.repo, "worktree", "move", path, record.worktree);
      if (step === "unlock") git(world.repo, "worktree", "unlock", record.worktree);
      world.err.length = 0;
      world.out.length = 0;
      const restored = readCrew(world.paths.stateDir, world.repo, record.id);
      if (restored === null) throw new Error("missing crew record after rollback");
      rmSync(fake, { force: true });
      const retried = await archiveCrewDiscard(
        restored,
        buildCrewDiscardFacts(restored, world.ctx()),
        world.ctx(),
      );
      expect(retried.archive?.ref).toBe(`refs/crew-discarded/${record.id}-2`);
      if (retried.archive === undefined) throw new Error("missing retry archive");
      expect(git(world.repo, "rev-parse", `refs/heads/${record.branch}`).trim()).toBe(
        retried.archive.head,
      );
      const rolledBack = await rollbackCrewDiscard(retried, world.ctx());
      expect(rolledBack).toMatchObject({ discardPending: undefined, archive: undefined });
      expect(rolledBack.archiveHistory).toHaveLength(2);
      expect(git(world.repo, "rev-parse", `refs/heads/${record.branch}`).trim()).toBe(
        before.trim(),
      );
      expect(git(world.repo, "show", `refs/crew-discarded/${record.id}-2:.env`)).toBe(
        "PRIVATE_TEST_VALUE=kept\n",
      );
    },
  );

  test("a store failure after archive creation removes only that exact ref and permits retry", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, "draft"), "unchanged\n");
    const facts = buildCrewDiscardFacts(record, world.ctx());
    const { crewFile } = await import("./store");
    const file = crewFile(world.paths.stateDir, world.repo, record.id);
    renameSync(file, `${file}.saved`);
    await expect(archiveCrewDiscard(record, facts, world.ctx())).rejects.toThrow();
    expect(git(world.repo, "for-each-ref", "refs/crew-discarded/")).toBe("");
    renameSync(`${file}.saved`, file);
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(0);
  });

  test.each([
    ["no lock", null],
    ["Claude Code's lock", "claude session 1234"],
  ])(
    "a worktree folder deleted by hand (%s), its branch kept: made again, archived, discarded",
    async (_label, lock) => {
      const world = await boardWorld();
      const record = await world.addCrew({ state: "stopped" });
      writeFileSync(join(record.worktree, "result"), "kept\n");
      git(record.worktree, "add", "result");
      git(record.worktree, "commit", "-qm", "result");
      if (lock !== null) git(world.repo, "worktree", "lock", "--reason", lock, record.worktree);
      rmSync(record.worktree, { recursive: true, force: true });
      // Plain removal still refuses the unmerged commit.
      expect(await runCrewRm(record.id, world.ctx())).toBe(1);
      expect(await runCrewRm(record.id, world.ctx(), { discard: true, yes: true })).toBe(0);
      const after = readCrew(world.paths.stateDir, world.repo, record.id);
      expect(after?.state).toBe("discarded");
      expect(existsSync(record.worktree)).toBe(false);
      expect(git(world.repo, "branch", "--list", record.branch).trim()).toBe("");
      expect(git(world.repo, "show", `${after?.archive?.ref}:result`).trim()).toBe("kept");
      expect(world.out).toContain(
        `made .claude/worktrees/${record.worktree.split("/").at(-1)} again on ${record.branch}, to discard it (its folder was gone)`,
      );
    },
  );

  test("a worktree folder deleted by hand under a person's lock: refused, nothing changed", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    git(world.repo, "worktree", "lock", "--reason", "mine", record.worktree);
    rmSync(record.worktree, { recursive: true, force: true });
    expect(await runCrewRm(record.id, world.ctx(), { discard: true, yes: true })).toBe(1);
    expect(world.err).toEqual([
      `crew rm: .claude/worktrees/${record.worktree.split("/").at(-1)} is locked (mine), and not by Claude Code`,
      `Fix: release it yourself if you mean to remove the crew session: git worktree unlock ${record.worktree}; crew rm unlocks only Claude Code's own lock`,
    ]);
    expect(git(world.repo, "worktree", "list", "--porcelain")).toContain("locked mine");
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("stopped");
  });

  test("a worktree folder deleted by hand, its branch checked out in another worktree: refused with the fix", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    rmSync(record.worktree, { recursive: true, force: true });
    git(world.repo, "worktree", "prune");
    git(
      world.repo,
      "worktree",
      "add",
      "-q",
      join(dirname(record.worktree), "other"),
      record.branch,
    );
    expect(await runCrewRm(record.id, world.ctx(), { discard: true, yes: true })).toBe(1);
    expect(world.err).toEqual([
      `crew rm: ${record.branch} is checked out in .claude/worktrees/other, so its worktree cannot be made again`,
      "Fix: switch that worktree to another branch, or remove it, then run crew rm --discard again",
    ]);
    expect(existsSync(record.worktree)).toBe(false);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("stopped");
  });

  test("a preview with no yes says the folder it made again stays", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    rmSync(record.worktree, { recursive: true, force: true });
    expect(await runCrewRm(record.id, world.ctx(), { discard: true })).toBe(1);
    expect(world.out.at(-1)).toBe(
      `Nothing removed; .claude/worktrees/${record.worktree.split("/").at(-1)} stays made again for this preview. Use crew rm <name|id> --discard --yes to confirm without a terminal.`,
    );
    expect(existsSync(record.worktree)).toBe(true);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("stopped");
  });

  test("no worktree and no branch: discard refuses with the plain removal, which works", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    git(world.repo, "worktree", "remove", "--force", record.worktree);
    git(world.repo, "branch", "-D", record.branch);
    expect(await runCrewRm(record.id, world.ctx(), { discard: true, yes: true })).toBe(1);
    expect(world.err).toEqual([
      `crew rm: ${record.name} has no worktree and no branch ${record.branch}, so there is nothing to archive`,
      `Fix: crew rm ${record.id}, without --discard, removes the record`,
    ]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("stopped");
    expect(await runCrewRm(record.id, world.ctx())).toBe(0);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("removed");
  });

  test("a terminal done session's own lingering PID does not block discard", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    writeFileSync(join(record.worktree, "draft"), "done work\n");
    const ctx = world.ctx(
      {
        scanFacts: {
          sessions: [],
          mounts: [],
          containers: [],
          programs: [{ pid: 4242, parentPid: 1, path: null, cwd: record.worktree }],
        },
      },
      {
        FAKE_AGENTS_JSON: JSON.stringify([
          {
            id: record.shortId,
            sessionId: record.sessionId,
            cwd: record.worktree,
            state: "done",
            pid: 4242,
          },
        ]),
      },
    );
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], ctx)).toBe(0);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("discarded");
  });

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
    const ref = `refs/crew-discarded/${record.id}`;
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
    const ref = `refs/crew-discarded/${record.id}`;
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

  test("the same crew branch can be discarded twice with both records recoverable", async () => {
    const world = await boardWorld();
    const first = await world.addCrew({ state: "stopped" });
    writeFileSync(join(first.worktree, "draft"), "first\n");
    expect(await runCrew(["rm", first.id, "--discard", "--yes"], world.ctx())).toBe(0);
    const firstRef = `refs/crew-discarded/${first.id}`;
    const archived = git(world.repo, "rev-parse", firstRef);
    const second = await world.addCrew({ state: "stopped", suffix: "second" });
    writeFileSync(join(second.worktree, "draft"), "second\n");
    expect(await runCrew(["rm", second.id, "--discard", "--yes"], world.ctx())).toBe(0);
    expect(git(world.repo, "rev-parse", firstRef)).toBe(archived);
    expect(git(world.repo, "show", `${firstRef}:draft`)).toBe("first\n");
    expect(git(world.repo, "show", `refs/crew-discarded/${second.id}:draft`)).toBe("second\n");
    expect(existsSync(second.worktree)).toBe(false);
  });

  test("prune keeps exactly 30 days and incomplete removals; expires older completed archives once", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    writeFileSync(join(record.worktree, "draft"), "kept in archive\n");
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(0);
    const archive = `refs/crew-discarded/${record.id}`;
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
    const archived = git(world.repo, "rev-parse", `refs/crew-discarded/${record.id}`);
    expect(await runCrew(["rm", record.id, "--discard", "--yes"], world.ctx())).toBe(0);
    expect(git(world.repo, "rev-parse", `refs/crew-discarded/${record.id}`)).toBe(archived);
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
