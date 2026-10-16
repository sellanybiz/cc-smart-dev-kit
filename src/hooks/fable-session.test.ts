/**
 * The `fable-session` hook (`fable-session.ts`): one line to the person, once in a session,
 * when that session's own model is Claude Fable. Nothing to Claude, never an error, and
 * nothing at all when the model cannot be read or the mark cannot be kept.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { FABLE_SESSION_MESSAGE, fableSessionMark } from "./fable-session";
import { fableSessionHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";

/** The line Claude Code would show the person, or null when the hook said nothing. */
function told(result: { stdout?: string }): string | null {
  if (result.stdout === undefined) return null;
  const parsed = JSON.parse(result.stdout) as { systemMessage?: string };
  return parsed.systemMessage ?? null;
}

/** The one line, written out by hand: what the person must see. */
const THE_LINE =
  "cc-smart-dev-kit: this session runs on Claude Fable, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.";

/** A SessionStart input, with the model Claude Code names for the session. */
function start(model: string | null, sessionId = SESSION): Record<string, unknown> {
  return {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    cwd: makeRepo(),
    source: "startup",
    ...(model === null ? {} : { model }),
  };
}

/** A transcript whose last assistant line names `model`, as Claude Code writes one. */
function transcriptNaming(model: string): string {
  const file = join(tempDir("fable-transcript"), "session.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ message: { content: [], model }, type: "assistant" })}\n`,
  );
  return file;
}

describe("a session on Claude Fable", () => {
  it("the first SessionStart says one line, and it is the person's alone", async () => {
    const env = hookEnv();
    const result = await runHook(fableSessionHook, start("claude-fable-5-1"), env);
    // Exactly one `systemMessage`, no `additionalContext` for Claude and no exit code.
    expect(result).toEqual({ stdout: JSON.stringify({ systemMessage: THE_LINE }) });
    expect(FABLE_SESSION_MESSAGE).toBe(THE_LINE);
    // The mark is recorded: the line is said once, not at every start.
    expect(existsSync(fableSessionMark(cliPaths(env), SESSION))).toBe(true);
  });

  it("the same session is never told twice: another SessionStart, then a prompt", async () => {
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), env))).toBe(THE_LINE);
    expect(
      told(
        await runHook(fableSessionHook, { ...start("claude-fable-5-1"), source: "resume" }, env),
      ),
    ).toBeNull();
    expect(
      told(
        await runHook(
          fableSessionHook,
          { hook_event_name: "UserPromptSubmit", session_id: SESSION, cwd: makeRepo() },
          env,
        ),
      ),
    ).toBeNull();
  });

  it("an Opus or Sonnet session says nothing, and keeps no mark", async () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"]) {
      const env = hookEnv();
      const result = await runHook(fableSessionHook, start(model), env);
      expect(result).toEqual({});
      expect(existsSync(fableSessionMark(cliPaths(env), SESSION))).toBe(false);
    }
  });

  it("a `/model` switch to Fable is caught at the prompt: the transcript's last model", async () => {
    const env = hookEnv();
    // The session started on Sonnet: nothing said then.
    expect(told(await runHook(fableSessionHook, start("claude-sonnet-5-5"), env))).toBeNull();
    // Fable answered: the next prompt says the line, once.
    const prompt = {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION,
      cwd: makeRepo(),
      transcript_path: transcriptNaming("claude-fable-5-1"),
    };
    expect(told(await runHook(fableSessionHook, prompt, env))).toBe(THE_LINE);
    expect(told(await runHook(fableSessionHook, prompt, env))).toBeNull();
  });

  it("ANTHROPIC_MODEL names the model when no transcript has answered yet", async () => {
    const env = { ...hookEnv(), ANTHROPIC_MODEL: "claude-fable-5-1" };
    const prompt = { hook_event_name: "UserPromptSubmit", session_id: SESSION, cwd: makeRepo() };
    expect(told(await runHook(fableSessionHook, prompt, env))).toBe(THE_LINE);
  });

  it("a model that cannot be read says nothing, at a start and at a prompt", async () => {
    const env = hookEnv();
    expect(await runHook(fableSessionHook, start(null), env)).toEqual({});
    expect(
      await runHook(
        fableSessionHook,
        { hook_event_name: "UserPromptSubmit", session_id: SESSION, cwd: makeRepo() },
        env,
      ),
    ).toEqual({});
    // A SessionStart that names no model judges nothing, even with the environment naming one.
    expect(
      await runHook(fableSessionHook, start(null), {
        ...hookEnv(),
        ANTHROPIC_MODEL: "claude-fable-5-1",
      }),
    ).toEqual({});
  });

  it("a session id Claude Code would not write: nothing", async () => {
    const env = hookEnv();
    expect(
      await runHook(fableSessionHook, start("claude-fable-5-1", "not-a-session-id"), env),
    ).toEqual({});
  });

  it("a state folder that cannot be written: nothing, exit 0", async () => {
    const env = hookEnv();
    // The state folder is a FILE: the mark cannot be made, so the promise cannot be kept and
    // the hook stays quiet rather than saying the line at every prompt.
    const stateDir = cliPaths(env).stateDir;
    mkdirSync(join(stateDir, ".."), { recursive: true });
    writeFileSync(stateDir, "");
    const result = await runHook(fableSessionHook, start("claude-fable-5-1"), env);
    expect(result).toEqual({});
    expect(result.exitCode ?? 0).toBe(0);
  });
});
