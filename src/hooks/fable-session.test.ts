/**
 * The `fable-session` hook (`fable-session.ts`): one line to the person, once in a session,
 * when that session's own model is the `fable` tier. Nothing to Claude, never an error, nothing
 * in a session nobody watches, and nothing at all when the model cannot be read or the mark
 * cannot be kept.
 *
 * The events: SessionStart (the input's `model`), PostModelSwitch (`to_model` — the model the
 * session moved TO, from Claude Code's own input schema) and Stop (the answer that just
 * finished). The live bug this pins (2026-10-17): the old UserPromptSubmit read judged the
 * PREVIOUS answer's model, so a switch to Fable was missed and the line then appeared while the
 * person was back on Opus.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook, writePersonalWorkflow } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { fableSessionMark, judgedMark, sessionMark } from "./fable-session";
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

/**
 * A PostModelSwitch input, as Claude Code 2.1.302 declares it: `to_model` is the resolved model
 * the session runs after the switch, `from_model` the one before it, and `source` says what
 * caused it (`command` for `/model <name>`, `picker`, `sdk`, `auto`, `resume`).
 */
function switchTo(model: string, from = "claude-opus-5-5"): Record<string, unknown> {
  return {
    hook_event_name: "PostModelSwitch",
    from_model: from,
    requested_model: null,
    session_id: SESSION,
    source: "command",
    to_model: model,
    cwd: makeRepo(),
  };
}

/** A Stop input; with a model, the transcript's last answer names that model. */
function stop(model: string | null): Record<string, unknown> {
  return {
    hook_event_name: "Stop",
    session_id: SESSION,
    stop_hook_active: false,
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

  it("the same session is never told twice: another SessionStart, then a Fable stop", async () => {
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), env))).toBe(THE_LINE);
    expect(
      told(
        await runHook(fableSessionHook, { ...start("claude-fable-5-1"), source: "resume" }, env),
      ),
    ).toBeNull();
    // A stop that would say it — the last answer came from Fable — stays silent: the mark answers.
    expect(told(await runHook(fableSessionHook, stop("claude-fable-5-1"), env))).toBeNull();
  });

  it("an Opus or Sonnet session gets no Fable line, and keeps no Fable mark", async () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"]) {
      const env = hookEnv();
      expect(told(await runHook(fableSessionHook, start(model), env))).not.toBe(THE_LINE);
      expect(existsSync(fableSessionMark(env, SESSION))).toBe(false);
    }
  });

  it("a switch TO Fable is warned at the switch itself, once", async () => {
    // The live bug: this line never appeared at the switch — the old hook read the previous
    // answer's model, so it only spoke one turn later.
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-opus-5-5"), env))).toBeNull();
    expect(told(await runHook(fableSessionHook, switchTo("claude-fable-5-1"), env))).toBe(THE_LINE);
    // Said once: a second switch to Fable in the same session says nothing more.
    expect(
      told(await runHook(fableSessionHook, switchTo("claude-fable-5-1", "claude-sonnet-5-5"), env)),
    ).toBeNull();
    expect(existsSync(fableSessionMark(env, SESSION))).toBe(true);
  });

  it("a switch back to Opus, and an Opus answer after it, never warn", async () => {
    // The other half of the live bug: the line appeared while the person was on Opus.
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-opus-5-5"), env))).toBeNull();
    expect(told(await runHook(fableSessionHook, switchTo("claude-fable-5-1"), env))).toBe(THE_LINE);
    // Back to Opus: the switch says nothing, and neither does the Opus answer that follows.
    expect(
      told(await runHook(fableSessionHook, switchTo("claude-opus-5-5", "claude-fable-5-1"), env)),
    ).toBeNull();
    expect(told(await runHook(fableSessionHook, stop("claude-opus-5-5"), env))).toBeNull();
    // And a fresh session told nothing so far stays silent through the same shape.
    const untouched = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-opus-5-5"), untouched))).toBeNull();
    expect(
      told(await runHook(fableSessionHook, switchTo("claude-opus-5-5"), untouched)),
    ).toBeNull();
    expect(told(await runHook(fableSessionHook, stop("claude-opus-5-5"), untouched))).toBeNull();
    expect(existsSync(fableSessionMark(untouched, SESSION))).toBe(false);
  });

  it("with no PostModelSwitch, a Fable answer is caught at Stop, once", async () => {
    // A Claude Code that fires no PostModelSwitch (or a switch the person made before this
    // version): the stop judge still catches it, and only once.
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-opus-5-5"), env))).toBeNull();
    expect(told(await runHook(fableSessionHook, stop("claude-fable-5-1"), env))).toBe(THE_LINE);
    expect(told(await runHook(fableSessionHook, stop("claude-fable-5-1"), env))).toBeNull();
  });

  it("ANTHROPIC_MODEL names the model when no transcript has answered yet", async () => {
    const env = { ...hookEnv(), ANTHROPIC_MODEL: "claude-fable-5-1" };
    expect(told(await runHook(fableSessionHook, stop(null), env))).toBe(THE_LINE);
  });

  it("a session nobody watches (`claude -p`) is told nothing, and keeps no mark", async () => {
    const env = { ...hookEnv(), CLAUDE_CODE_SESSION_ATTENDED: "0" };
    expect(await runHook(fableSessionHook, start("claude-fable-5-1"), env)).toEqual({});
    expect(existsSync(fableSessionMark(env, SESSION))).toBe(false);
    expect(await runHook(fableSessionHook, switchTo("claude-fable-5-1"), env)).toEqual({});
    expect(await runHook(fableSessionHook, stop("claude-fable-5-1"), env)).toEqual({});
    expect(existsSync(fableSessionMark(env, SESSION))).toBe(false);
  });

  it("a model that cannot be read says nothing, at a start, a switch and a stop", async () => {
    const env = hookEnv();
    expect(await runHook(fableSessionHook, start(null), env)).toEqual({});
    expect(await runHook(fableSessionHook, stop(null), env)).toEqual({});
    // A switch whose input names no model: nothing is judged, and no mark is kept.
    expect(await runHook(fableSessionHook, { ...switchTo("x"), to_model: undefined }, env)).toEqual(
      {},
    );
    expect(existsSync(fableSessionMark(env, SESSION))).toBe(false);
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
    // And a switch naming that same id warns the same way.
    expect(
      told(
        await runHook(fableSessionHook, switchTo("openai:gpt-5.5"), {
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
    expect(await runHook(fableSessionHook, switchTo("claude-fable-5-1"), racing)).toEqual({});
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
    expect(
      await runHook(
        fableSessionHook,
        { ...switchTo("claude-fable-5-1"), session_id: "not-a-session-id" },
        env,
      ),
    ).toEqual({});
  });
});

/** The router's address in these tests: a port no real router holds. */
const ROUTER = "http://127.0.0.1:39999";

/** Writes this machine's `gateway.json`: the omniroute backend, and `slots`/`profiles`. */
function writeGateway(
  env: Record<string, string>,
  slots: Record<string, string[]>,
  profiles?: Record<string, unknown>,
): void {
  const where = cliPaths(env);
  mkdirSync(dirname(where.gatewayConfigFile), { recursive: true });
  writeFileSync(
    where.gatewayConfigFile,
    JSON.stringify({
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
      port: 39_999,
      ...(profiles === undefined ? {} : { profiles }),
      slots,
      version: 1,
    }),
    { mode: 0o600 },
  );
}

/**
 * The hook's environment on a machine whose `gateway.json` puts a backend first in the fable
 * slot (and, as `profiles`, the profile `cheap`), whose user settings file holds `userUrl`
 * (null: no address), for a session whose effective URL is `sessionUrl` (null: none).
 */
function machine(
  userUrl: null | string,
  sessionUrl: null | string,
  options: { profiles?: Record<string, unknown>; slots?: Record<string, string[]> } = {},
): Record<string, string> {
  const env = hookEnv();
  const where = cliPaths(env);
  writeGateway(
    env,
    options.slots ?? { "cc-smart-dev-kit-fable": ["omniroute:glm-x"] },
    options.profiles,
  );
  writeFileSync(
    where.settingsFile,
    JSON.stringify(userUrl === null ? {} : { env: { ANTHROPIC_BASE_URL: userUrl } }),
  );
  return sessionUrl === null ? env : { ...env, ANTHROPIC_BASE_URL: sessionUrl };
}

describe("RV4: the line names what answers THIS session, read from its own ANTHROPIC_BASE_URL", () => {
  // Claude Code gives a hook the session's effective URL in its environment: the project's file,
  // a `--settings` launch and a profile each change it, and the machine's user file does not
  // speak for them (`sessionGatewayOf`, proved live on 2.1.310).

  /** The line a backend at the head of the fable slot gets, written out by hand. */
  const BY_SLOT =
    "cc-smart-dev-kit: this session runs on the `fable` model, omniroute:glm-x, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.";

  it("a project set to Anthropic's own address while the machine is on: Claude Fable, on the login", async () => {
    const env = machine(ROUTER, "https://api.anthropic.com");
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), env))).toBe(THE_LINE);
  });

  it("a session on the router while the machine's file says nothing: the backend that answers", async () => {
    const env = machine(null, ROUTER);
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), env))).toBe(BY_SLOT);
  });

  it("a profile's chain decides for a profile's session, not the machine's", async () => {
    // The machine's fable slot starts with Claude; the profile `cheap` puts a backend first.
    const env = machine(ROUTER, `${ROUTER}/p/cheap`, {
      profiles: { cheap: { slots: { "cc-smart-dev-kit-fable": ["omniroute:glm-x"] } } },
      slots: { "cc-smart-dev-kit-fable": ["claude-fable-5-1", "omniroute:glm-x"] },
    });
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), env))).toBe(BY_SLOT);
    // The same machine, a session on the machine's own address: Claude answers first.
    const plain = machine(ROUTER, ROUTER, {
      slots: { "cc-smart-dev-kit-fable": ["claude-fable-5-1", "omniroute:glm-x"] },
    });
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), plain))).toBe(THE_LINE);
  });
});

describe("the lead hint: once a session, when the lead is not Claude Opus (2.2.0)", () => {
  /** The hint for a lead on `named`, written out by hand. */
  const hint = (named: string) =>
    `cc-smart-dev-kit: this session runs on ${named}. The kit works best with the lead on Claude Opus at high effort. Switch with /model. (To stop this hint: cc-smart-dev-kit workflow set switches.leadHint false.)`;
  /** The hint when a backend answers the `opus` tier itself: /model cannot fix that. */
  const viaGateway = (named: string) =>
    `cc-smart-dev-kit: this session runs on ${named}. The kit works best with the lead on Claude Opus at high effort. Put Claude Opus first in the gateway's opus slot (/cc-smart-dev-kit:gateway), or start the session with cc-smart-dev-kit launch --no-gateway. (To stop this hint: cc-smart-dev-kit workflow set switches.leadHint false.)`;

  it("a Claude Opus lead hears nothing, at a start, a switch and a stop, and keeps no line mark", async () => {
    const env = hookEnv();
    expect(await runHook(fableSessionHook, start("claude-opus-5-5"), env)).toEqual({});
    expect(await runHook(fableSessionHook, switchTo("claude-opus-5-5[1m]"), env)).toEqual({});
    expect(await runHook(fableSessionHook, stop("claude-opus-5-5"), env)).toEqual({});
    expect(existsSync(sessionMark(env, SESSION, "lead"))).toBe(false);
    expect(existsSync(sessionMark(env, SESSION, "fable"))).toBe(false);
    // The family name alone, as `ANTHROPIC_MODEL` may give it, is Claude Opus too.
    const named = { ...hookEnv(), ANTHROPIC_MODEL: "opus" };
    expect(await runHook(fableSessionHook, stop(null), named)).toEqual({});
  });

  it("a Sonnet lead is told once, as a line for the person alone", async () => {
    const env = hookEnv();
    expect(await runHook(fableSessionHook, start("claude-sonnet-5-5"), env)).toEqual({
      stdout: JSON.stringify({ systemMessage: hint("Claude Sonnet") }),
    });
    expect(existsSync(sessionMark(env, SESSION, "lead"))).toBe(true);
    // Said once: the next stop on Sonnet, and a switch to Haiku, say nothing more.
    expect(await runHook(fableSessionHook, stop("claude-sonnet-5-5"), env)).toEqual({});
    expect(await runHook(fableSessionHook, switchTo("claude-haiku-4-5"), env)).toEqual({});
  });

  it("a Haiku lead is named by its family", async () => {
    expect(told(await runHook(fableSessionHook, start("claude-haiku-4-5"), hookEnv()))).toBe(
      hint("Claude Haiku"),
    );
  });

  it("a Fable lead gets the Fable line only, never the hint", async () => {
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-fable-5-1"), env))).toBe(THE_LINE);
    expect(await runHook(fableSessionHook, stop("claude-fable-5-1"), env)).toEqual({});
    expect(existsSync(sessionMark(env, SESSION, "lead"))).toBe(false);
  });

  it("the opus tier answered by a backend gets the hint, naming the backend and the gateway's way back", async () => {
    const env = machine(ROUTER, ROUTER, {
      slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-x"] },
    });
    expect(told(await runHook(fableSessionHook, start("claude-opus-5-5"), env))).toBe(
      viaGateway("the `opus` model, omniroute:glm-x"),
    );
    // A Sonnet lead on the same machine is pointed at /model: another family is one switch away.
    const sonnet = machine(ROUTER, ROUTER, {
      slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-x"] },
    });
    expect(told(await runHook(fableSessionHook, start("claude-sonnet-5-5"), sonnet))).toBe(
      hint("Claude Sonnet"),
    );
    // The same machine, a session on Anthropic's own address: Claude Opus answers, nothing said.
    const login = machine(ROUTER, "https://api.anthropic.com", {
      slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-x"] },
    });
    expect(await runHook(fableSessionHook, start("claude-opus-5-5"), login)).toEqual({});
  });

  it("Claude Fable the person put first in the opus slot: no Fable line and no hint (owner, 2026-11-11)", async () => {
    const env = machine(ROUTER, ROUTER, {
      slots: { "cc-smart-dev-kit-opus": ["claude-fable-5-2", "claude-opus-5-5"] },
    });
    // The start names Opus; the router answers it with Fable, so the stop's transcript says
    // Fable. Both are the `opus` tier: the person chose that mapping.
    expect(await runHook(fableSessionHook, start("claude-opus-5-5"), env)).toEqual({});
    expect(await runHook(fableSessionHook, stop("claude-fable-5-2"), env)).toEqual({});
    expect(existsSync(sessionMark(env, SESSION, "fable"))).toBe(false);
    expect(existsSync(sessionMark(env, SESSION, "lead"))).toBe(false);
    // A switch to Fable OUTRIGHT names the model it asks for: that is Fable, so the line speaks,
    // though the same id already answered as the opus slot's.
    expect(told(await runHook(fableSessionHook, switchTo("claude-fable-5-2"), env))).toBe(
      "cc-smart-dev-kit: this session runs on Claude Fable, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.",
    );
  });

  it("a switch names the tier by the alias the person picked, not the id an override resolved", async () => {
    const line =
      "cc-smart-dev-kit: this session runs on Claude Fable, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.";
    // `/model opus` where ANTHROPIC_DEFAULT_OPUS_MODEL is a Fable id: the opus tier, no line.
    const opusAsFable = { ...hookEnv(), ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-fable-5-2" };
    const toOpus = { ...switchTo("claude-fable-5-2"), requested_model: "opus" };
    expect(await runHook(fableSessionHook, toOpus, opusAsFable)).toEqual({});
    // `/model fable` where ANTHROPIC_DEFAULT_FABLE_MODEL is an Opus id: the fable tier, the line.
    const fableAsOpus = { ...hookEnv(), ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-opus-5-5" };
    const toFable = { ...switchTo("claude-opus-5-5"), requested_model: "fable" };
    expect(told(await runHook(fableSessionHook, toFable, fableAsOpus))).toBe(
      line.replace("Claude Fable", "Claude Opus"),
    );
  });

  it("the hint, then a switch to Fable: both lines, each once", async () => {
    const env = hookEnv();
    expect(told(await runHook(fableSessionHook, start("claude-sonnet-5-5"), env))).toBe(
      hint("Claude Sonnet"),
    );
    expect(told(await runHook(fableSessionHook, switchTo("claude-fable-5-1"), env))).toBe(THE_LINE);
    expect(await runHook(fableSessionHook, stop("claude-fable-5-1"), env)).toEqual({});
    expect(await runHook(fableSessionHook, switchTo("claude-sonnet-5-5"), env)).toEqual({});
  });

  it("a start that names no model (after /clear): the stop's transcript model decides", async () => {
    const env = hookEnv();
    expect(await runHook(fableSessionHook, start(null), env)).toEqual({});
    expect(told(await runHook(fableSessionHook, stop("claude-sonnet-5-5"), env))).toBe(
      hint("Claude Sonnet"),
    );
  });

  it("switches.leadHint false: no hint, and the Fable line still speaks", async () => {
    const env = hookEnv();
    writePersonalWorkflow(env, { switches: { leadHint: false } });
    expect(await runHook(fableSessionHook, start("claude-sonnet-5-5"), env)).toEqual({});
    expect(existsSync(sessionMark(env, SESSION, "lead"))).toBe(false);
    expect(told(await runHook(fableSessionHook, switchTo("claude-fable-5-1"), env))).toBe(THE_LINE);
    // A personal file that cannot be read keeps the default: on.
    const broken = hookEnv();
    mkdirSync(dirname(cliPaths(broken).workflowConfigFile), { recursive: true });
    writeFileSync(cliPaths(broken).workflowConfigFile, "{not json");
    expect(told(await runHook(fableSessionHook, start("claude-sonnet-5-5"), broken))).toBe(
      hint("Claude Sonnet"),
    );
  });

  it("a session nobody watches (`claude -p`) is told nothing, and keeps no mark", async () => {
    const env = { ...hookEnv(), CLAUDE_CODE_SESSION_ATTENDED: "0" };
    expect(await runHook(fableSessionHook, start("claude-sonnet-5-5"), env)).toEqual({});
    expect(await runHook(fableSessionHook, stop("claude-sonnet-5-5"), env)).toEqual({});
    expect(existsSync(sessionMark(env, SESSION, "lead"))).toBe(false);
    expect(existsSync(judgedMark(env, SESSION, "claude-sonnet-5-5"))).toBe(false);
  });

  it("a model judged once is not judged again in the session: an Opus stop stops at its mark", async () => {
    const env = machine(ROUTER, ROUTER, { slots: {} });
    expect(await runHook(fableSessionHook, start("claude-opus-5-5"), env)).toEqual({});
    expect(existsSync(judgedMark(env, SESSION, "claude-opus-5-5"))).toBe(true);
    // The opus slot moves to a backend mid-session: the model was judged, so no gateway read and
    // no new line — the hint is a once-a-session note, not a watch.
    writeGateway(env, { "cc-smart-dev-kit-opus": ["omniroute:glm-x"] });
    expect(await runHook(fableSessionHook, stop("claude-opus-5-5"), env)).toEqual({});
    // Another session on the same machine judges it fresh, and hears the hint.
    expect(
      told(
        await runHook(
          fableSessionHook,
          start("claude-opus-5-5", "22222222-2222-3333-4444-555555555555"),
          env,
        ),
      ),
    ).toBe(viaGateway("the `opus` model, omniroute:glm-x"));
  });

  it("a hint mark that cannot be made: silence, never a hint said twice", async () => {
    const env = hookEnv();
    writeFileSync(dirname(sessionMark(env, SESSION, "lead")), "");
    const result = await runHook(fableSessionHook, start("claude-sonnet-5-5"), env);
    expect(result).toEqual({});
    expect(result.exitCode ?? 0).toBe(0);
  });
});
