/** The verification gate: one Stop block when files changed and the fast check did not run. */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CREW_ENV } from "../crew/session";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { verifyGateHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const CHECK = "bun run typecheck";

/** The project's file with the fast check, in a fresh clone. */
function project(): string {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", { checks: { fast: CHECK } });
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

/** A transcript file holding these lines, in order. */
function transcript(lines: Array<Record<string, unknown>>): string {
  const file = join(tempDir("verify-gate-transcript"), "session.jsonl");
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
}

const EDIT = toolUse("Edit", { file_path: "src/a.ts", old_string: "a", new_string: "b" });
const WRITE = toolUse("Write", { file_path: "src/b.ts", content: "b" });

/** A Bash call that runs the project's fast check. */
const CHECKED = toolUse("Bash", { command: CHECK });

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
const BLOCK = JSON.stringify({
  decision: "block",
  reason: `This session changed files and has not run the project's fast check since: run \`${CHECK}\`, then stop.`,
});

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

  test("a compound line that runs the check counts: `cd … && bun run typecheck 2>&1 | tail`", async () => {
    const repo = project();
    const path = transcript([
      EDIT,
      toolUse("Bash", { command: `cd ${repo} && ${CHECK} 2>&1 | tail -20` }),
    ]);
    expect(await runHook(verifyGateHook, stop(repo, path), hookEnv())).toEqual({});
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
