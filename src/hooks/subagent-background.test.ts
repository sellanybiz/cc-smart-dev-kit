/**
 * The subagent-background hook: a subagent never hands back while background work it started
 * still runs. The Claude Code side — SubagentStop fires with the task still running, its
 * `background_tasks` is the SESSION's list, and `{"decision":"block","reason":…}` makes the
 * subagent continue with that reason — is proved offline on 2.1.308 and recorded in
 * `docs/claude-code-contract.md` § Hooks.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { subagentBackgroundHook } from "./specs";
import { HAND_BACK_REASON } from "./subagent-background";

const SESSION = "11111111-2222-3333-4444-555555555555";
const AGENT = "0a1b2c3d4e5f60718";
const CHILD = "f00dfeedcafebeef1";

/** The stop's whole answer, written by hand: a plain reason, and no context. */
const BLOCK = JSON.stringify({
  decision: "block",
  reason: "Your background work is still running: wait for it or stop it, then report.",
});

/** The task entry a background shell leaves in `background_tasks` (2.1.308). */
const SHELL_TASK = {
  id: "shell1234",
  type: "shell",
  status: "running",
  description: "the tests",
  command: "bun test",
};

/** A repo with the project's file, so the hook is on. */
function repoWithConfig(): string {
  const repo = makeRepo();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
  return repo;
}

/**
 * A subagent transcript with the given tool results, written the way Claude Code writes one:
 * every line carries the agent's own `agentId`.
 */
function transcript(...said: string[]): string {
  const path = join(tempDir("subagent-transcript"), "agent.jsonl");
  writeFileSync(
    path,
    said
      .map(
        (text) =>
          `${JSON.stringify({
            type: "user",
            agentId: AGENT,
            message: {
              content: [{ type: "tool_result", tool_use_id: "toolu_1", content: text }],
            },
          })}\n`,
      )
      .join(""),
  );
  return path;
}

/** A SubagentStop input for `repo`, with the fields a test overrides. */
function stop(repo: string, overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: "SubagentStop",
    session_id: SESSION,
    cwd: repo,
    agent_id: AGENT,
    agent_type: "general-purpose",
    stop_hook_active: false,
    ...overrides,
  };
}

describe("the hook", () => {
  test("it blocks once, with the plain reason and no context, when its own background work is still running", async () => {
    const repo = repoWithConfig();
    const result = await runHook(
      subagentBackgroundHook,
      stop(repo, {
        agent_transcript_path: transcript(
          "Command running in background with ID: shell1234. Output is being written to: /tmp/claude/tasks/shell1234.output.",
        ),
        background_tasks: [SHELL_TASK],
      }),
      hookEnv(),
    );
    expect(result).toEqual({ stdout: BLOCK });
    // Never `additionalContext`: a Stop-family hook's context keeps the turn going by itself
    // (crew-role's rule), and the block's reason is the whole message.
    expect(result.stdout).not.toContain("additionalContext");
    expect(HAND_BACK_REASON).toBe(
      "Your background work is still running: wait for it or stop it, then report.",
    );
  });

  test("none when nothing is in flight", async () => {
    const repo = repoWithConfig();
    const path = transcript("Command running in background with ID: shell1234.");
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, { agent_transcript_path: path, background_tasks: [] }),
        hookEnv(),
      ),
    ).toEqual({});
    // No field at all is the same as an empty array.
    expect(
      await runHook(subagentBackgroundHook, stop(repo, { agent_transcript_path: path }), hookEnv()),
    ).toEqual({});
  });

  test("never twice: the stop its own block caused (stop_hook_active) is silent", async () => {
    const repo = repoWithConfig();
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, {
          stop_hook_active: true,
          agent_transcript_path: transcript("Command running in background with ID: shell1234."),
          background_tasks: [SHELL_TASK],
        }),
        hookEnv(),
      ),
    ).toEqual({});
  });

  test("only its own work counts: a task of the session it did not start is none of its business", async () => {
    // The session's own background shell (proved on 2.1.308: a foreground subagent's stop
    // lists it). The subagent's transcript never names that id.
    const repo = repoWithConfig();
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, {
          agent_transcript_path: transcript("echo hi"),
          background_tasks: [
            {
              id: "mainshell",
              type: "shell",
              status: "running",
              description: "the lead's watch",
              command: "sleep 60",
            },
          ],
        }),
        hookEnv(),
      ),
    ).toEqual({});
  });

  test("a background subagent's own entry in the list is not its background work", async () => {
    // A subagent launched in the background appears in its own stop's list, and its transcript
    // carries its own id as `agentId` on every line: without the self-exclusion it would
    // match itself and block every background subagent.
    const repo = repoWithConfig();
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, {
          agent_transcript_path: transcript("echo hi"),
          background_tasks: [
            {
              id: AGENT,
              type: "subagent",
              status: "running",
              description: "proof agent",
              agent_type: "general-purpose",
            },
          ],
        }),
        hookEnv(),
      ),
    ).toEqual({});
  });

  test("a child agent it launched in the background counts as its background work", async () => {
    const repo = repoWithConfig();
    const result = await runHook(
      subagentBackgroundHook,
      stop(repo, {
        agent_transcript_path: transcript(
          `Async agent launched successfully. agentId: ${CHILD} (internal ID - do not mention to the user.)`,
        ),
        background_tasks: [
          {
            id: CHILD,
            type: "subagent",
            status: "running",
            description: "the searches",
            agent_type: "Explore",
          },
        ],
      }),
      hookEnv(),
    );
    expect(result).toEqual({ stdout: BLOCK });
  });

  test("a transcript it was not told, or cannot read, is no block: it cannot tell whose work it is", async () => {
    const repo = repoWithConfig();
    // No path in the input.
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, { background_tasks: [SHELL_TASK] }),
        hookEnv(),
      ),
    ).toEqual({});
    // A path that is not a file.
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, {
          agent_transcript_path: join(tempDir("missing-transcript"), "agent.jsonl"),
          background_tasks: [SHELL_TASK],
        }),
        hookEnv(),
      ),
    ).toEqual({});
  });

  test("a task entry without a string id is ignored", async () => {
    const repo = repoWithConfig();
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, {
          agent_transcript_path: transcript("echo hi"),
          background_tasks: [{ type: "shell", status: "running" }, "not-a-task"],
        }),
        hookEnv(),
      ),
    ).toEqual({});
  });

  test("off with no cc-smart-dev-kit.json: a project that never opted in does not notice the plugin", async () => {
    const repo = makeRepo("plain");
    expect(
      await runHook(
        subagentBackgroundHook,
        stop(repo, {
          agent_transcript_path: transcript("Command running in background with ID: shell1234."),
          background_tasks: [SHELL_TASK],
        }),
        hookEnv(),
      ),
    ).toEqual({});
  });
});
