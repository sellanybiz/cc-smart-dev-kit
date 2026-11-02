import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";

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
  expect(await run("done", "#1")).toEqual({
    code: 0,
    text: '#1 "Read the result" · done\n',
    error: "",
  });
  expect(await run("check")).toEqual({
    code: 0,
    text: "Project tasks: no problems found.\n",
    error: "",
  });
  expect(
    (await run("add", "Check a missing path", "--kind", "database", "--ref", "missing.sql")).code,
  ).toBe(0);
  expect((await run("check")).code).toBe(1);
  // A usage mistake: one line on stderr and where the help is, never the whole usage.
  expect(await run("list", "--typo")).toEqual({
    code: 2,
    text: "",
    error: "Unknown option: --typo\nSee: cc-smart-dev-kit task --help\n",
  });
  // A refused call: its reason on stderr, exit 1.
  expect(await run("done", "#9")).toEqual({ code: 1, text: "", error: "Task not found: #9\n" });
});

test("task import notes ends with what it did, and a dry run says nothing was changed", async () => {
  const home = tempDir();
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  git(cwd, "commit", "--allow-empty", "-m", "initial");
  const notes = join(cwd, "notes");
  mkdirSync(notes);
  writeFileSync(join(notes, "2026-11-01-backfill.md"), "# Backfill the column\n\nRun it twice.\n");
  const guard = subprocessGuard();
  const env = {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(process.execPath)}:${dirname(Bun.which("git") ?? "/usr/bin/git")}`,
  };
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
  const dry = await run("import", "notes", "notes", "--kind", "database", "--dry-run");
  expect(dry.code).toBe(0);
  expect(dry.error).toBe("");
  expect(dry.lines.at(-1)).toBe("Dry run: nothing was changed.");
  expect(existsSync(join(cwd, ".claude", "tasks"))).toBe(false);
  const real = await run("import", "notes", "notes", "--kind", "database");
  expect(real.code).toBe(0);
  expect(real.lines.at(-1)).toBe(
    "Imported 1 note into .claude/tasks: commit the task files with your branch.",
  );
  expect(real.lines[0]).toMatch(/^T-[a-z2-7]{6} "Backfill the column" · /);
});
