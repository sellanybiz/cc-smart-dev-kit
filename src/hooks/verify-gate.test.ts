/** The verification gate: one Stop block when files changed and the fast check did not run. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { verifyGateHook } from "./specs";
import { ranCheck } from "./verify-gate";

const SESSION = "11111111-2222-3333-4444-555555555555";
const CHECK = "bun run typecheck";

/** The project's file with the fast check, in a fresh clone. */
function project(check = CHECK): string {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", { checks: { fast: check } });
  return repo;
}

/** One `tool_use` line, as Claude Code writes it. */
function toolUse(name: string, input: Record<string, unknown>, extra = {}) {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: `toolu_${name}`, name, input }],
      role: "assistant",
    },
    ...extra,
  };
}

/** One `tool_result` line for the call `toolUse` made. */
function toolResult(
  name: string,
  result: { content: unknown; isError?: boolean },
  extra: Record<string, unknown> = {},
) {
  return {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: `toolu_${name}`,
          content: result.content,
          ...(result.isError === true ? { is_error: true } : {}),
        },
      ],
      role: "user",
    },
    ...extra,
  };
}

/** A transcript file holding these lines, in order. */
function transcript(lines: Array<Record<string, unknown>>): string {
  const file = join(tempDir("verify-gate-transcript"), "session.jsonl");
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
}

const EDIT = toolUse("Edit", { file_path: "src/a.ts", old_string: "a", new_string: "b" });
const WRITE = toolUse("Write", { file_path: "src/b.ts", content: "b" });

/** A Bash or PowerShell call. */
function shell(name: string, command: string) {
  return toolUse(name, { command });
}

/** A Bash call that runs the project's fast check. */
const CHECKED = shell("Bash", CHECK);

/** The reason this hook gives, written by hand: the test must not compute it. */
const REASON = `This session changed files and has not run the project's fast check since: run \`${CHECK}\`, then stop.`;

/** What Claude Code writes into the transcript when a Stop hook's block continues the turn. */
const REMINDER = {
  type: "user",
  message: { content: [{ type: "text", text: `Stop hook feedback:\n${REASON}` }], role: "user" },
};

/** The Stop input for a session in `repo` on `path`. */
function stop(repo: string, path: string): Record<string, unknown> {
  return {
    hook_event_name: "Stop",
    session_id: SESSION,
    cwd: repo,
    stop_hook_active: false,
    transcript_path: path,
  };
}

/** The one block the hook gives, exactly as Claude Code reads it. */
const BLOCK = JSON.stringify({ decision: "block", reason: REASON });

describe("verify-gate", () => {
  test.each(["README.md", "guide.MDX", ".claude/plans/script.ts"])("skips %s", async (file) => {
    const repo = project();
    expect(
      await runHook(
        verifyGateHook,
        stop(repo, transcript([toolUse("Write", { file_path: join(repo, file) })])),
        hookEnv(),
      ),
    ).toEqual({});
  });

  test("skips outside paths and configured and default plan directories", async () => {
    const repo = project();
    const env = hookEnv();
    const paths = cliPaths(env);
    const custom = join(repo, "custom-plans");
    mkdirSync(paths.claudeConfigDir, { recursive: true });
    for (const file of [
      join(tempDir("outside"), "a.ts"),
      join(paths.claudeConfigDir, "plans", "a.ts"),
    ]) {
      expect(
        await runHook(
          verifyGateHook,
          stop(repo, transcript([toolUse("Edit", { file_path: file })])),
          env,
        ),
      ).toEqual({});
    }
    writeFileSync(paths.settingsFile, JSON.stringify({ plansDirectory: custom }));
    expect(
      await runHook(
        verifyGateHook,
        stop(repo, transcript([toolUse("Write", { file_path: join(custom, "a.ts") })])),
        env,
      ),
    ).toEqual({});
  });

  test("unknown edit paths count for every change tool and malformed input", async () => {
    const repo = project();
    for (const name of ["Edit", "Write", "NotebookEdit"]) {
      for (const input of [
        {},
        { file_path: "", notebook_path: "" },
        { file_path: 42, notebook_path: [] },
        { file_path: "  ", notebook_path: "  " },
        { file_path: "bad\0path", notebook_path: "bad\0path" },
        name === "NotebookEdit"
          ? { file_path: join(repo, "README.md") }
          : { notebook_path: join(repo, "README.md") },
        null,
        "bad",
        [],
      ]) {
        const edit = toolUse(name, {});
        const block = edit.message.content[0];
        if (block === undefined) throw new Error("missing tool block");
        Object.assign(block, { input });
        expect(await runHook(verifyGateHook, stop(repo, transcript([edit])), hookEnv())).toEqual({
          stdout: BLOCK,
        });
      }
    }
  });

  test("relative edits use the transcript record cwd, not the Stop cwd", async () => {
    const repo = project();
    mkdirSync(join(repo, "pkg"));
    const edit = toolUse("Edit", { file_path: "../src/a.ts" }, { cwd: join(repo, "pkg") });
    expect(await runHook(verifyGateHook, stop(repo, transcript([edit])), hookEnv())).toEqual({
      stdout: BLOCK,
    });
    const uncertain = toolUse("Edit", { file_path: "../src/a.ts" });
    expect(await runHook(verifyGateHook, stop(repo, transcript([uncertain])), hookEnv())).toEqual({
      stdout: BLOCK,
    });
  });

  test("relative edits retain their checkout across a worktree switch", async () => {
    const repo = project();
    const worktree = join(repo, ".claude/worktrees/relative-topic");
    git(repo, "worktree", "add", "-q", "-b", "relative-topic", worktree);
    writeClaudeFile(worktree, "cc-smart-dev-kit.json", { checks: { fast: CHECK } });
    const oldEdit = toolUse("Edit", { file_path: "src/a.ts" }, { cwd: repo });
    expect(await runHook(verifyGateHook, stop(worktree, transcript([oldEdit])), hookEnv())).toEqual(
      {},
    );
    const newEdit = toolUse("Write", { file_path: "src/new.ts" }, { cwd: worktree });
    expect(
      await runHook(verifyGateHook, stop(worktree, transcript([oldEdit, newEdit])), hookEnv()),
    ).toEqual({ stdout: BLOCK });
  });

  test("entering a worktree judges old and new edits against that checkout", async () => {
    const repo = project();
    const worktree = join(repo, ".claude/worktrees/topic");
    git(repo, "worktree", "add", "-q", "-b", "topic", worktree);
    writeClaudeFile(worktree, "cc-smart-dev-kit.json", { checks: { fast: CHECK } });
    const oldEdit = toolUse("Write", { file_path: join(repo, "new.ts") });
    expect(await runHook(verifyGateHook, stop(worktree, transcript([oldEdit])), hookEnv())).toEqual(
      {},
    );
    expect(
      await runHook(
        verifyGateHook,
        stop(
          worktree,
          transcript([oldEdit, toolUse("Write", { file_path: join(worktree, "new.ts") })]),
        ),
        hookEnv(),
      ),
    ).toEqual({ stdout: BLOCK });
  });

  test("project-local plans setting wins, and links into plans are excluded", async () => {
    const repo = project();
    const env = hookEnv();
    writeClaudeFile(repo, "settings.json", { plansDirectory: "project-plans" });
    writeClaudeFile(repo, "settings.local.json", { plansDirectory: "local-plans" });
    mkdirSync(join(repo, "local-plans"));
    symlinkSync(join(repo, "local-plans"), join(repo, "linked-plans"), "dir");
    for (const file of ["local-plans/new.ts", "linked-plans/new.ts"]) {
      expect(
        await runHook(
          verifyGateHook,
          stop(repo, transcript([toolUse("Write", { file_path: join(repo, file) })])),
          env,
        ),
      ).toEqual({});
    }
    expect(
      await runHook(
        verifyGateHook,
        stop(
          repo,
          transcript([toolUse("Write", { file_path: join(repo, "project-plans/new.ts") })]),
        ),
        env,
      ),
    ).toEqual({ stdout: BLOCK });
  });

  test("resolves symlinks, counts new code and notebooks, and follows the current checkout", async () => {
    const repo = project();
    const other = project();
    const link = join(repo, "outside-link");
    symlinkSync(other, link, "dir");
    const alias = join(tempDir("alias"), "repo");
    symlinkSync(repo, alias, "dir");
    for (const file of [join(link, "new.ts"), join(other, "new.ts")]) {
      expect(
        await runHook(
          verifyGateHook,
          stop(repo, transcript([toolUse("Write", { file_path: file })])),
          hookEnv(),
        ),
      ).toEqual({});
    }
    for (const edit of [
      toolUse("Write", { file_path: join(alias, "new.ts") }),
      toolUse("NotebookEdit", { notebook_path: join(repo, "new.ipynb") }),
    ]) {
      expect(await runHook(verifyGateHook, stop(repo, transcript([edit])), hookEnv())).toEqual({
        stdout: BLOCK,
      });
    }
  });
  test("files changed and the check did not run: one block, naming the command", async () => {
    const repo = project();
    const path = transcript([EDIT]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({ stdout: BLOCK });
  });

  test("the check ran after the last change: silent", async () => {
    const repo = project();
    const path = transcript([EDIT, CHECKED]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("a change after the check: the block comes back", async () => {
    const repo = project();
    const path = transcript([EDIT, CHECKED, WRITE]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({ stdout: BLOCK });
  });

  test("another Bash call is not the check: the block stays", async () => {
    const repo = project();
    const path = transcript([EDIT, shell("Bash", "ls -la")]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({ stdout: BLOCK });
  });

  test("a compound line that runs the check counts: `cd … && bun run typecheck 2>&1 | tail`", async () => {
    const repo = project();
    const path = transcript([EDIT, shell("Bash", `cd ${repo} && ${CHECK} 2>&1 | tail -20`)]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("a PowerShell line counts too: the Windows tool is a shell as well", async () => {
    const repo = project();
    const path = transcript([EDIT, shell("PowerShell", CHECK)]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("the check through `bash -c` counts: the shell reader steps inside", async () => {
    const repo = project();
    const path = transcript([EDIT, shell("Bash", `bash -c '${CHECK}'`)]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test('a line that only quotes the check runs it not: `echo "bun run typecheck"`', async () => {
    const repo = project();
    const path = transcript([EDIT, shell("Bash", `echo "${CHECK}"`)]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({ stdout: BLOCK });
  });

  test("a check that failed still ran: its error result is no reason to remind", async () => {
    const repo = project();
    const path = transcript([
      EDIT,
      CHECKED,
      toolResult("Bash", {
        content: "error TS2322: Type 'string' is not assignable",
        isError: true,
      }),
    ]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("an edit that was refused changed nothing: silent", async () => {
    const repo = project();
    const path = transcript([
      EDIT,
      toolResult("Edit", {
        content: "The user doesn't want to proceed with this tool use.",
        isError: true,
      }),
    ]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("the reminder's own feedback is no second reminder: the next turn is silent", async () => {
    const repo = project();
    const path = transcript([EDIT, REMINDER]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("a change after the reminder earns the next one", async () => {
    const repo = project();
    const path = transcript([EDIT, REMINDER, WRITE]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({ stdout: BLOCK });
  });

  test("the stop a block caused (stop_hook_active): silent, never a second block", async () => {
    const repo = project();
    const path = transcript([EDIT]);
    const input = { ...stop(repo, path), stop_hook_active: true };
    expect(await runHook(verifyGateHook, input, hookEnv())).toEqual({});
  });

  test("the project sets no checks.fast: silent", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    const path = transcript([EDIT]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("no cc-smart-dev-kit.json: silent", async () => {
    const { repo } = makeClone();
    const path = transcript([EDIT]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("a transcript that cannot be read: silent (fail open)", async () => {
    const repo = project();
    const path = join(tempDir("verify-gate-missing"), "not-there.jsonl");
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("no transcript path in the input: silent", async () => {
    const repo = project();
    const input = stop(repo, "");
    delete input.transcript_path;
    expect(await runHook(verifyGateHook, input, hookEnv())).toEqual({});
  });

  test("a turn that still waits on background work: silent (that turn is not over)", async () => {
    const repo = project();
    const path = transcript([EDIT]);
    const input = { ...stop(repo, path), background_tasks: [{ id: "shell1" }] };
    expect(await runHook(verifyGateHook, input, hookEnv())).toEqual({});
  });

  test("a subagent's own (sidechain) edit is not this session's change", async () => {
    const repo = project();
    const sidechainEdit = { ...EDIT, isSidechain: true };
    const path = transcript([sidechainEdit]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
  });

  test("lines that are not JSON are skipped; a broken transcript is no block", async () => {
    const repo = project();
    const file = join(tempDir("verify-gate-broken"), "session.jsonl");
    writeFileSync(file, "{ not json\n\n[1,2,3]\n");
    expect(await runHook(verifyGateHook, stop(repo, file), hookEnv())).toEqual({});
  });

  test("another event (not Stop): nothing", async () => {
    const repo = project();
    const path = transcript([EDIT]);
    const input = { ...stop(repo, path), hook_event_name: "SubagentStop" };
    expect(await runHook(verifyGateHook, input, hookEnv())).toEqual({});
  });
});

describe("ranCheck", () => {
  test("the check's words, whole: a longer script name is not the check", () => {
    expect(ranCheck("bun run check:neutral", "bun run check")).toBe(false);
    expect(ranCheck("bun run check", "bun run check")).toBe(true);
    expect(ranCheck("bun run check:neutral && bun run check", "bun run check")).toBe(true);
    expect(ranCheck("bun run typecheck", "bun run check")).toBe(false);
  });

  test("wrappers, pipes and extra spaces are read through; quotes around it alone are not a run", () => {
    expect(ranCheck("cd /x && bun   run check 2>&1 | tail -5", "bun run check")).toBe(true);
    expect(ranCheck("timeout 300 bun run check", "bun run check")).toBe(true);
    expect(ranCheck('echo "bun run check"', "bun run check")).toBe(false);
    expect(ranCheck("bash -c 'bun run check'", "bun run check")).toBe(true);
  });

  test("a compound check matches when its commands run in that order", () => {
    const check = "bun run typecheck && bun test src/changed";
    expect(ranCheck("bun run typecheck && bun test src/changed", check)).toBe(true);
    expect(ranCheck("bun run typecheck; bun test src/changed", check)).toBe(true);
    expect(ranCheck("bun test src/changed && bun run typecheck", check)).toBe(false);
  });

  test("PowerShell reads the line in its own dialect", () => {
    expect(ranCheck("bun run check; Write-Host done", "bun run check", "powershell")).toBe(true);
    expect(ranCheck("bun run check", "bun run check", "bash")).toBe(true);
  });
});
