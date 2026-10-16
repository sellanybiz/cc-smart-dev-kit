/**
 * The `fable-session` hook (`fable-session.ts`): one line to the person, once in a session,
 * when that session's own model is the `fable` tier. Nothing to Claude, never an error, nothing
 * in a session nobody watches, and nothing at all when the model cannot be read or the mark
 * cannot be kept.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hookEnv, makeRepo, runHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { fableSessionMark } from "./fable-session";
import { fableSessionHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";

/** The line Claude Code would show the person, or null when the hook said nothing. */
function told(result: { stdout?: string }): string | null {
  if (result.stdout === undefined) return null;
  const parsed = JSON.parse(result.stdout) as { systemMessage?: string };
  return parsed.systemMessage ?? null;
}

/** The one line for a Claude session, written out by hand: what the person must see. */
const THE_LINE =
  "cc-smart-dev-kit: this session runs on Claude Fable, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.";

/** The line a backend answering the tier gets, written out by hand. */
const BY_BACKEND =
  "cc-smart-dev-kit: this session runs on the `fable` model, openai:gpt-5.5, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.";

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

/** A prompt input; with a model, its transcript names that model. */
function prompt(model: string | null): Record<string, unknown> {
  return {
    hook_event_name: "UserPromptSubmit",
    session_id: SESSION,
    cwd: makeRepo(),
    ...(model === null ? {} : { transcript_path: transcriptNaming(model) }),
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

describe("a session on the fable tier", () => {
  it("the first SessionStart says one line, and it is the person's alone", async () => {
    const env = hookEnv();
    const result = await runHook(fableSessionHook, start("claude-fable-5-1"), env);
    // Exactly one `systemMessage`, no `additionalContext` for Claude and no exit code.
    expect(result).toEqual({ stdout: JSON.stringify({ systemMessage: THE_LINE }) });
    // The mark is recorded, beside the session's own name files: the line is said once.
    expect(existsSync(fableSessionMark(env, SESSION))).toBe(true);
  });

  it("the same session is never told twice: another SessionStart, then a Fable prompt", async () => {
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), env))).toBe(THE_LINE);
    expect(
      told(
        await runHook(fableSessionHook, { ...start("claude-fable-5-1"), source: "resume" }, env),
      ),
    ).toBeNull();
    // A prompt that would say it — the transcript names Fable — stays silent: the mark answers.
    expect(told(await runHook(fableSessionHook, prompt("claude-fable-5-1"), env))).toBeNull();
  });

  it("an Opus or Sonnet session says nothing, and keeps no mark", async () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"]) {
      const env = hookEnv();
      expect(await runHook(fableSessionHook, start(model), env)).toEqual({});
      expect(existsSync(fableSessionMark(env, SESSION))).toBe(false);
    }
  });

  it("a `/model` switch to Fable is caught once Fable has answered", async () => {
    const env = hookEnv();
    // The session started on Sonnet: nothing said then.
    expect(told(await runHook(fableSessionHook, start("claude-sonnet-5-5"), env))).toBeNull();
    // Fable answered: the next prompt says the line, once.
    expect(told(await runHook(fableSessionHook, prompt("claude-fable-5-1"), env))).toBe(THE_LINE);
    expect(told(await runHook(fableSessionHook, prompt("claude-fable-5-1"), env))).toBeNull();
  });

  it("ANTHROPIC_MODEL names the model when no transcript has answered yet", async () => {
    const env = { ...hookEnv(), ANTHROPIC_MODEL: "claude-fable-5-1" };
    expect(told(await runHook(fableSessionHook, prompt(null), env))).toBe(THE_LINE);
  });

  it("a session nobody watches (`claude -p`) is told nothing, and keeps no mark", async () => {
    const env = { ...hookEnv(), CLAUDE_CODE_SESSION_ATTENDED: "0" };
    expect(await runHook(fableSessionHook, start("claude-fable-5-1"), env)).toEqual({});
    expect(existsSync(fableSessionMark(env, SESSION))).toBe(false);
    expect(await runHook(fableSessionHook, prompt("claude-fable-5-1"), env)).toEqual({});
    expect(existsSync(fableSessionMark(env, SESSION))).toBe(false);
  });

  it("a model that cannot be read says nothing, at a start and at a prompt", async () => {
    const env = hookEnv();
    expect(await runHook(fableSessionHook, start(null), env)).toEqual({});
    expect(await runHook(fableSessionHook, prompt(null), env)).toEqual({});
    // A SessionStart that names no model judges nothing, even with the environment naming one.
    expect(
      await runHook(fableSessionHook, start(null), {
        ...hookEnv(),
        ANTHROPIC_MODEL: "claude-fable-5-1",
      }),
    ).toEqual({});
  });

  it("the `fable` tier warns the same when a backend answers it, naming the model", async () => {
    // The session's own model is the id the override names: the tier is fable, and it is not
    // Claude, so the line names what answers it.
    expect(
      told(
        await runHook(fableSessionHook, start("openai:gpt-5.5"), {
          ...hookEnv(),
          ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5",
        }),
      ),
    ).toBe(BY_BACKEND);
    // The family name with the same override warns the same way.
    expect(
      told(
        await runHook(fableSessionHook, start("fable"), {
          ...hookEnv(),
          ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5",
        }),
      ),
    ).toBe(BY_BACKEND);
  });

  it("a mark another run made means told already; one that cannot be made means silence", async () => {
    // EEXIST: a broken symlink passes `existsSync` and makes the `wx` write fail — what a run
    // that races this one sees.
    const racing = hookEnv();
    const raced = fableSessionMark(racing, SESSION);
    mkdirSync(dirname(raced), { recursive: true });
    symlinkSync(join(racing.TMPDIR ?? "", "nowhere"), raced);
    expect(await runHook(fableSessionHook, start("claude-fable-5-1"), racing)).toEqual({});
    // A state folder that cannot be written at all: the same silence, never a second line.
    const broken = hookEnv();
    const mark = fableSessionMark(broken, SESSION);
    // The names folder is a FILE here, so the mark cannot be made.
    writeFileSync(dirname(mark), "");
    const result = await runHook(fableSessionHook, start("claude-fable-5-1"), broken);
    expect(result).toEqual({});
    expect(result.exitCode ?? 0).toBe(0);
  });

  it("a session id Claude Code would not write: nothing", async () => {
    const env = hookEnv();
    expect(
      await runHook(fableSessionHook, start("claude-fable-5-1", "not-a-session-id"), env),
    ).toEqual({});
  });
});
