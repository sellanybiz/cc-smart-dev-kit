/**
 * The sweep of finished builders' branches: only `worktree-agent-*`, only when no worktree has
 * the branch checked out, only when the base holds the work, and only on `--clean`.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { projectKey } from "../tasks/context";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { createTask } from "../tasks/work/store";
import type { WorkStatus } from "../tasks/work/types";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { recordedBranches, sweepBuilderBranches, unusedBuilderBranches } from "./branch-sweep";
import { cleanWithStrays } from "./clean";
import { runWorktrees } from "./command";
import { scanWorktrees } from "./scan";

const freeLock = async (): Promise<{ close(): void }> => ({ close: () => undefined });

const NOTHING_RECORDED = { byBranch: new Map<string, number>(), ok: true } as const;

const QUIET_FACTS = { containers: [], mounts: [], programs: [], sessions: [] };

/** A repo with an origin: `main` pushed, and the branches the sweep must tell apart. */
function world() {
  const root = tempDir("branch-sweep");
  const origin = join(root, "origin.git");
  const main = join(root, "app");
  mkdirSync(origin);
  git(origin, "init", "--bare", "--initial-branch=main");
  mkdirSync(main);
  git(main, "init", "--initial-branch=main");
  writeFileSync(join(main, "README.md"), "# app\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "first");
  git(main, "remote", "add", "origin", origin);
  git(main, "push", "-u", "origin", "main");
  git(main, "remote", "set-head", "origin", "--auto");

  // Held by ancestry: a builder branch at the base's own commit.
  git(main, "branch", "worktree-agent-ancestor");
  // Held as a squash merge: the same change landed on main under another commit.
  git(main, "checkout", "-q", "-b", "worktree-agent-squashed");
  writeFileSync(join(main, "squashed.txt"), "same\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "builder work");
  git(main, "checkout", "-q", "main");
  writeFileSync(join(main, "squashed.txt"), "same\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "the lead's squash");
  git(main, "push", "origin", "main");
  // Unique commits: the base lacks this work.
  git(main, "checkout", "-q", "-b", "worktree-agent-unique");
  writeFileSync(join(main, "unique.txt"), "only here\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "unfinished");
  git(main, "checkout", "-q", "main");
  // A person's own branch, merged: never the sweep's.
  git(main, "branch", "feature-x");
  // A running builder: its branch is checked out in its folder.
  const running = join(root, "app-wt-running");
  git(main, "worktree", "add", "-q", "-b", "worktree-agent-running", running);

  const branches = () =>
    git(main, "for-each-ref", "--format=%(refname:short)", "refs/heads/").trim().split("\n").sort();
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(root, "claude"), HOME: root });
  const run = async (options: { clean: boolean; remove?: string | null }) => {
    const out: string[] = [];
    const sinks = {
      error: (line: string) => out.push(line),
      print: (line: string) => out.push(line),
    };
    const code = await runWorktrees(
      paths,
      { clean: options.clean, json: false, noFetch: true, remove: options.remove ?? null },
      cleanGitEnv(),
      main,
      sinks,
      freeLock,
    );
    return { code, text: out.join("\n") };
  };
  /** A task of this project that records a builder branch, as a lead binds a phase to its builder. */
  const record = (branch: string, status: WorkStatus = "pending", project = projectKey(main)) => {
    const db = openWorkDb(workDbFile(paths), { mode: "write" });
    try {
      const who = { pid: null, procStart: null, sessionId: "lead" };
      const task = createTask(
        db,
        { branch, project, status, subject: `builder of ${branch}` },
        who,
        1,
      );
      if (!task.ok) throw new Error(task.why);
      return task.value.number;
    } finally {
      db.close();
    }
  };
  return { branches, main, paths, record, root, run, running };
}

describe("the builder branch sweep", () => {
  test("only worktree-agent-* branches no worktree checks out are candidates", () => {
    const { main } = world();
    expect(unusedBuilderBranches(main, cleanGitEnv())).toEqual([
      "worktree-agent-ancestor",
      "worktree-agent-squashed",
      "worktree-agent-unique",
    ]);
  });

  test("--clean deletes the ones the base holds, keeps the others, and says why", async () => {
    const { branches, run } = world();
    const { code, text } = await run({ clean: true });
    expect(code).toBe(0);
    expect(text).toContain("deleted branch worktree-agent-ancestor");
    expect(text).toContain("deleted branch worktree-agent-squashed");
    expect(text).toContain(
      "kept branch worktree-agent-unique: it has commits that are not on origin/main",
    );
    // A person's branch, a branch a worktree has, and unique work stay.
    expect(branches()).toEqual([
      "feature-x",
      "main",
      "worktree-agent-running",
      "worktree-agent-unique",
    ]);
  });

  test("the listing says which would go and deletes nothing", async () => {
    const { branches, run } = world();
    const before = branches();
    const { code, text } = await run({ clean: false });
    expect(code).toBe(0);
    expect(text).toContain("Builder branches no worktree uses (worktree-agent-*)");
    expect(text).toContain("branch worktree-agent-ancestor: origin/main holds its work");
    expect(text).toContain(
      "kept branch worktree-agent-unique: it has commits that are not on origin/main",
    );
    expect(text).toContain("2 builder branches whose work the base holds");
    // The branch a worktree has is in the worktree table above, never in the branch rows.
    const rows = text.split("Builder branches no worktree uses")[1] ?? "";
    expect(rows).not.toContain("worktree-agent-running");
    expect(text).not.toContain("feature-x");
    expect(branches()).toEqual(before);
  });

  test("--remove of one worktree never sweeps branches", async () => {
    const { branches, main, root, run } = world();
    const other = join(root, "app-wt-done");
    git(main, "worktree", "add", "-q", "-b", "fix/done", other);
    const before = branches();
    const { code } = await run({ clean: false, remove: other });
    expect(code).toBe(0);
    expect(branches()).toEqual(before.filter((name) => name !== "fix/done"));
  });

  test("the background clean's shared code never sweeps branches", () => {
    const { branches, main } = world();
    const judged = {
      base: "main",
      claudeConfigDir: tempDir("branch-sweep-config"),
      env: cleanGitEnv(),
      facts: QUIET_FACTS,
    };
    cleanWithStrays(main, scanWorktrees(main, judged), judged, () => undefined);
    expect(branches()).toContain("worktree-agent-ancestor");
    expect(branches()).toContain("worktree-agent-squashed");
  });

  test("a branch an open task still records is kept, so its phase can still close", async () => {
    const { branches, record, run } = world();
    const number = record("worktree-agent-ancestor");
    const { code, text } = await run({ clean: true });
    expect(code).toBe(0);
    expect(text).toContain(
      `kept branch worktree-agent-ancestor: task #${String(number)} still records it`,
    );
    expect(text).toContain("deleted branch worktree-agent-squashed");
    expect(branches()).toContain("worktree-agent-ancestor");
    expect(branches()).not.toContain("worktree-agent-squashed");
  });

  test("the listing says the same, and does not count the kept branch as going", async () => {
    const { record, run } = world();
    record("worktree-agent-ancestor");
    const { text } = await run({ clean: false });
    expect(text).toContain("kept branch worktree-agent-ancestor: task #1 still records it");
    expect(text).toContain("1 builder branch whose work the base holds");
  });

  test("a task that is done or dropped, or of another project, keeps nothing", async () => {
    const { branches, record, run } = world();
    record("worktree-agent-ancestor", "done");
    record("worktree-agent-squashed", "dropped");
    record("worktree-agent-unique", "pending", "another-project");
    const { text } = await run({ clean: true });
    expect(text).not.toContain("still records it");
    expect(branches()).not.toContain("worktree-agent-ancestor");
    expect(branches()).not.toContain("worktree-agent-squashed");
  });

  test("when the task store cannot be read, every branch is kept and the line says so", () => {
    const { branches, main, paths } = world();
    const file = workDbFile(paths);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "this is not a database");
    const recorded = recordedBranches(paths, projectKey(main));
    expect(recorded.ok).toBe(false);
    const before = branches();
    const lines = sweepBuilderBranches(
      main,
      { base: "main", env: cleanGitEnv(), recorded },
      "delete",
    );
    expect(lines.map((one) => one.state)).toEqual(["kept", "kept", "kept"]);
    expect(lines.every((one) => one.text.includes("task store cannot be read"))).toBe(true);
    expect(branches()).toEqual(before);
  });

  test("with no task store at all, no task records anything", () => {
    const { main, paths } = world();
    const recorded = recordedBranches(paths, projectKey(main));
    expect(recorded.ok).toBe(true);
  });

  test("when the base cannot be read, every branch is kept and the line says so", () => {
    const { branches, main } = world();
    const before = branches();
    const lines = sweepBuilderBranches(
      main,
      { base: "no-such-base", env: cleanGitEnv(), recorded: NOTHING_RECORDED },
      "delete",
    );
    expect(lines.map((one) => one.state)).toEqual(["kept", "kept", "kept"]);
    expect(lines.every((one) => one.text.startsWith("kept branch worktree-agent-"))).toBe(true);
    expect(branches()).toEqual(before);
  });
});
