/** The verification gate: one Stop block when files changed and the fast check did not run. */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEAD_MONITOR } from "../crew/brief";
import { CREW_ENV } from "../crew/session";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
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

  test("a crew session: silent (its own report gate answers)", async () => {
    const repo = project();
    const path = transcript([EDIT]);
    const env = { ...hookEnv(), [CREW_ENV]: "B1-x-1" };
    expect(await runHook(verifyGateHook, stop(repo, path), env)).toEqual({});
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

  /**
   * The lead's own monitor as Claude Code lists it in `background_tasks` (read from the 2.1.310
   * binary): a shell task, with the command and description `plugin/monitors/monitors.json`
   * gives `crew-events`, and nothing that says "monitor". It runs for the whole of a lead's
   * session.
   */
  function leadWatchTask(): Record<string, unknown> {
    const monitors = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "plugin", "monitors", "monitors.json"),
        "utf8",
      ),
    ) as { command: string; description: string; name: string }[];
    const events = monitors.find((one) => one.name === LEAD_MONITOR);
    return {
      command: events?.command,
      description: events?.description,
      id: "bm4k2x9a1",
      status: "running",
      type: "shell",
    };
  }

  test("a lead's own watch monitor always runs, and is no reason to skip the reminder", async () => {
    // Before: every lead had the monitor in the list, so the gate never spoke in a lead.
    const repo = project();
    const path = transcript([EDIT]);
    const input = { ...stop(repo, path), background_tasks: [leadWatchTask()] };
    expect(await runHook(verifyGateHook, input, hookEnv())).toEqual({ stdout: BLOCK });
  });

  test("the lead's monitor beside a task of the session's own: that turn waits, so silent", async () => {
    const repo = project();
    const path = transcript([EDIT]);
    const own = { command: "bun test", id: "b1", status: "running", type: "shell" };
    const input = { ...stop(repo, path), background_tasks: [leadWatchTask(), own] };
    expect(await runHook(verifyGateHook, input, hookEnv())).toEqual({});
  });

  test("a task that only has the monitor's words in its command is the session's own work: silent", async () => {
    const repo = project();
    const path = transcript([EDIT]);
    for (const command of [
      "tail -f /tmp/crew-watch.log",
      "grep -r 'cc-smart-dev-kit crew watch' src",
      "cc-smart-dev-kit crew watch-x",
      "bun test # cc-smart-dev-kit crew watch",
    ]) {
      const input = {
        ...stop(repo, path),
        background_tasks: [{ command, id: "b2", status: "running", type: "shell" }],
      };
      expect(await runHook(verifyGateHook, input, hookEnv())).toEqual({});
    }
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
