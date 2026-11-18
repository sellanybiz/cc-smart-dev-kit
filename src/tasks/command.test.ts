import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { claudeMemDb, mistakenImport } from "../testing/claude-mem-db";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { taskContext } from "./context";
import { openWorkDb, workDbFile } from "./work/db";
import { addNote } from "./work/store";

const CLI = join(import.meta.dir, "../entries/cli.ts");
test("task command creates, lists, completes and checks as a process", async () => {
  const home = tempDir();
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  git(cwd, "commit", "--allow-empty", "-m", "initial");
  const guard = subprocessGuard();
  const env = {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(process.execPath)}:${dirname(Bun.which("git") ?? "/usr/bin/git")}`,
  };
  async function run(...args: string[]) {
    const process = Bun.spawn([Bun.which("bun") ?? "bun", ...guard.args, CLI, "task", ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: await process.exited,
      text: await new Response(process.stdout).text(),
      error: await new Response(process.stderr).text(),
    };
  }
  expect(await run("add", "Read the result")).toEqual({
    code: 0,
    text: '#1 "Read the result"\n',
    error: "",
  });
  expect(await run("list")).toEqual({ code: 0, text: "#1 [pending] Read the result\n", error: "" });
  expect(
    (
      await run(
        "add",
        "Bound",
        "--agent",
        "builder-a",
        "--branch",
        "phase-a",
        "--worktree",
        "/tmp/phase-a",
        "--base",
        "abc123",
      )
    ).code,
  ).toBe(0);
  expect((await run("show", "#2")).text).toContain(
    "Agent: builder-a\nBranch: phase-a\nWorktree: /tmp/phase-a\nBase: abc123",
  );
  expect(
    (
      await run(
        "set",
        "#2",
        "--agent",
        "builder-b",
        "--branch",
        "phase-b",
        "--worktree",
        "/tmp/phase-b",
        "--base",
        "def456",
      )
    ).code,
  ).toBe(0);
  expect(
    (
      await run(
        "start",
        "#2",
        "--agent",
        "builder-c",
        "--branch",
        "phase-c",
        "--worktree",
        "/tmp/phase-c",
        "--base",
        "fedcba",
      )
    ).code,
  ).toBe(0);
  expect((await run("show", "#2")).text).toContain(
    "Agent: builder-c\nBranch: phase-c\nWorktree: /tmp/phase-c\nBase: fedcba",
  );
  expect(await run("done", "#1")).toEqual({
    code: 0,
    text: '#1 "Read the result" · done\n',
    error: "",
  });
  expect(await run("check")).toEqual({
    code: 0,
    text: "Deploy tasks: no problems found.\n",
    error: "",
  });
  expect(
    (
      await run(
        "add",
        "Check a missing path",
        "--kind",
        "prod",
        "--deploy",
        "before",
        "--type",
        "blocking",
        "--ref",
        "missing.sql",
      )
    ).code,
  ).toBe(0);
  expect((await run("check")).code).toBe(1);
  expect(await run("take", "#2")).toEqual({
    code: 1,
    text: "",
    error: "take needs a resolvable calling session\n",
  });
  // A usage mistake: one line on stderr and where the help is, never the whole usage.
  expect(await run("list", "--typo")).toEqual({
    code: 2,
    text: "",
    error: "Unknown option: --typo\nSee: cc-smart-dev-kit task --help\n",
  });
  // A refused call: its reason on stderr, exit 1.
  expect(await run("done", "#9")).toEqual({ code: 1, text: "", error: "Task not found: #9\n" });
});

test("task command holds the plan shape: a phase starts with tasks, a step closes with proof, a plan holds a waiting task", async () => {
  const home = tempDir();
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  git(cwd, "commit", "--allow-empty", "-m", "initial");
  const guard = subprocessGuard();
  const env = {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(process.execPath)}:${dirname(Bun.which("git") ?? "/usr/bin/git")}`,
  };
  async function run(...args: string[]) {
    const process = Bun.spawn([Bun.which("bun") ?? "bun", ...guard.args, CLI, "task", ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: await process.exited,
      text: await new Response(process.stdout).text(),
      error: await new Response(process.stderr).text(),
    };
  }
  expect((await run("add", "The plan", "--plan", "p")).code).toBe(0);
  expect((await run("add", "An area", "--plan", "p", "--phase", "A")).code).toBe(0);
  // A phase with no task does not start; the refusal names the call that adds one.
  expect(await run("start", "#2")).toEqual({
    code: 1,
    text: "",
    error:
      '#2 "An area" has no tasks: add its steps first, each with its done-check (task_create with parent "#2"), then start it\n',
  });
  expect((await run("add", "A step", "--parent", "#2")).code).toBe(0);
  expect((await run("start", "#2")).code).toBe(0);
  // A step closes with its proof: evidence to finish, a note to drop.
  expect((await run("done", "#3")).error).toContain("a step closes done with evidence");
  expect((await run("drop", "#3")).error).toContain("a step is dropped with a note");
  expect((await run("done", "#3", "--evidence", "ran the check: ok")).code).toBe(0);
  // A plan holds a task that waits there for a phase.
  expect(await run("add", "A later ask", "--parent", "#1")).toEqual({
    code: 0,
    text: '#4 "A later ask" under #1\n',
    error: "",
  });
  expect((await run("done", "#2")).code).toBe(0);
  expect((await run("done", "#1")).error).toBe("open tasks: #4 A later ask\n");
});

test("task import claude-mem leaves claude-mem's own lists out, and drops what an earlier import took", async () => {
  const home = tempDir();
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  git(cwd, "commit", "--allow-empty", "-m", "initial");
  const guard = subprocessGuard();
  const env = {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(process.execPath)}:${dirname(Bun.which("git") ?? "/usr/bin/git")}`,
  };
  const paths = cliPaths(env);
  mkdirSync(dirname(paths.claudeMemSettingsFile), { recursive: true });
  const at = Date.UTC(2026, 10, 1);
  claudeMemDb(
    [
      ["my-focus", { task: "Focus area: Billing", status: "suggested" }, at],
      ["owner-goals", { task: "Ask: Ship faster", status: "todo" }, at],
      ["release-work", { task: "Ship it", status: "todo" }, at],
    ],
    dirname(paths.claudeMemSettingsFile),
  );
  const context = taskContext(cwd, env);
  if (!context.ok) throw new Error(context.why);
  const store = openWorkDb(workDbFile(paths), { mode: "write" });
  mistakenImport(store, context.project, at);
  // A session noted the item of another such list: it may be someone's work, so it stays open.
  const rules = mistakenImport(store, context.project, at, "my-rules");
  const session = { sessionId: "session", pid: null, procStart: null };
  const noted = addNote(store, rules.item.id, "mine", session, at);
  if (!noted.ok) throw new Error(noted.why);
  store.close();
  async function run(...args: string[]) {
    const child = Bun.spawn([Bun.which("bun") ?? "bun", ...guard.args, CLI, "task", ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: await child.exited,
      lines: (await new Response(child.stdout).text()).trimEnd().split("\n"),
      error: await new Response(child.stderr).text(),
    };
  }
  const own = "Left out claude-mem's own lists (its My Work data): my-focus, owner-goals.";
  const kept = `Left #3 "my-rules" open: claude-mem's own list, which an earlier import took as work, but a session made or changed #4 in it. Close what is not work yourself.`;
  expect(await run("import", "claude-mem", "--project", "home", "--dry-run")).toEqual({
    code: 0,
    lines: [
      "release-work",
      "  Ship it",
      `Would drop #1 "my-focus" (2 open tasks): claude-mem's own list, which an earlier import took as work.`,
      kept,
      own,
      "Dry run: nothing was changed.",
    ],
    error: "",
  });
  expect(await run("import", "claude-mem", "--project", "home")).toEqual({
    code: 0,
    lines: [
      "release-work",
      "  Ship it",
      `Dropped #1 "my-focus" (2 open tasks): claude-mem's own list, which an earlier import took as work.`,
      kept,
      own,
      "Imported 2 work tasks from claude-mem's open lists.",
    ],
    error: "",
  });
  expect(await run("import", "claude-mem", "--project", "home")).toEqual({
    code: 0,
    lines: [kept, own, "Nothing new to import."],
    error: "",
  });
});
