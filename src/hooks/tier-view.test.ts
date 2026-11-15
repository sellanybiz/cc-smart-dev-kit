/**
 * The `tier-view` hook (`tier-view.ts`): one note to Claude at a session start, and again when
 * what the four subagent tiers run changes. The expected notes are written out by hand.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { tierViewHook } from "./specs";
import { tierView, tierViewMark } from "./tier-view";

const SESSION = "11111111-2222-3333-4444-555555555555";
const ROUTER = "http://127.0.0.1:39999";

const HEADER = "Subagent tiers now (the Agent tool's `model`):";
const HAIKU_CLAUDE = "- haiku → Claude Haiku.";
const SONNET_CLAUDE = "- sonnet → Claude Sonnet.";
const OPUS_CLAUDE = "- opus → Claude Opus.";
const FABLE_CLAUDE = "- fable → Claude Fable.";
const FOOTER =
  "Choose the tier and effort by the job (`/cc-smart-dev-kit:subagent-decision`), never by the model behind a tier. `opus` at `max` and any `fable` launch (with a `Fable reason:` line) ask the person.";

/** The note for a view, written by hand from its four lines and the footer. */
function note(...lines: string[]): string {
  return [HEADER, ...lines, FOOTER].join("\n");
}

/** Every tier Claude: the gateway off, or every slot on Claude alone. */
const ALL_CLAUDE = note(HAIKU_CLAUDE, SONNET_CLAUDE, OPUS_CLAUDE, FABLE_CLAUDE);

/** A SessionStart or UserPromptSubmit input. */
function event(
  name: "SessionStart" | "UserPromptSubmit",
  cwd: string,
  sessionId = SESSION,
): Record<string, unknown> {
  return { cwd, hook_event_name: name, session_id: sessionId, source: "startup" };
}

/** The context text the hook gave Claude, or null when it said nothing. */
function said(result: { stdout?: string }): string | null {
  if (result.stdout === undefined) return null;
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput?: { additionalContext?: string; hookEventName?: string };
  };
  return parsed.hookSpecificOutput?.additionalContext ?? null;
}

/** Writes `gateway.json` (mode 600) with the given slots and profiles. */
function writeGateway(
  env: Record<string, string>,
  slots: Record<string, string[]>,
  profiles?: Record<string, unknown>,
): void {
  const file = cliPaths(env).gatewayConfigFile;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
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

/** The environment of a session on the router (`ANTHROPIC_BASE_URL`), `url` by default. */
function onRouter(env: Record<string, string>, url = ROUTER): Record<string, string> {
  return { ...env, ANTHROPIC_BASE_URL: url };
}

describe("the note at a session start", () => {
  it("the gateway off: every tier is Claude, said as additionalContext", async () => {
    const env = hookEnv();
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), env);
    expect(result).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ALL_CLAUDE },
      }),
    });
  });

  it("on, with the worker and scout slots on Claude alone (tonight's setup): Claude by the task", async () => {
    const env = hookEnv();
    writeGateway(env, {
      "cc-smart-dev-kit-scout": ["claude-haiku-5-5"],
      "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"],
    });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(ALL_CLAUDE);
  });

  it("a backend-first worker chain: sonnet is the backend, with the same task-effort rule as Claude", async () => {
    const env = hookEnv();
    writeGateway(env, {
      "cc-smart-dev-kit-scout": ["claude-haiku-5-5"],
      "cc-smart-dev-kit-worker": ["omniroute:glm-x", "claude-sonnet-5-5"],
    });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(HAIKU_CLAUDE, "- sonnet → omniroute:glm-x (a backend).", OPUS_CLAUDE, FABLE_CLAUDE),
    );
  });

  it("a Claude-first chain with a backend fallback: Claude, by the task", async () => {
    const env = hookEnv();
    writeGateway(env, {
      "cc-smart-dev-kit-scout": ["claude-haiku-5-5", "omniroute:glm-x"],
      "cc-smart-dev-kit-worker": ["claude-sonnet-5-5", "omniroute:glm-x"],
    });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(ALL_CLAUDE);
  });

  it("a backend scout: haiku is the backend with the same task-effort rule, and sonnet stays Claude", async () => {
    const env = hookEnv();
    writeGateway(env, {
      "cc-smart-dev-kit-scout": ["omniroute:glm-s"],
      "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"],
    });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note("- haiku → omniroute:glm-s (a backend).", SONNET_CLAUDE, OPUS_CLAUDE, FABLE_CLAUDE),
    );
  });

  it("a slot or an override that answers with another Claude family names that model", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-scout": ["claude-sonnet-5-5"] });
    const slot = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(slot)).toBe(
      note("- haiku → Claude Sonnet.", SONNET_CLAUDE, OPUS_CLAUDE, FABLE_CLAUDE),
    );
    const plain = hookEnv();
    const override = { ...plain, ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-5-5" };
    expect(said(await runHook(tierViewHook, event("SessionStart", makeRepo()), override))).toBe(
      note("- haiku → Claude Sonnet.", SONNET_CLAUDE, OPUS_CLAUDE, FABLE_CLAUDE),
    );
  });

  it("the opus tier keeps its rule when a backend answers it", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-opus": ["omniroute:glm-o"] });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(HAIKU_CLAUDE, SONNET_CLAUDE, "- opus → omniroute:glm-o (a backend).", FABLE_CLAUDE),
    );
  });

  it("the fable tier keeps its rule when a backend answers it", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-fable": ["omniroute:glm-f"] });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(HAIKU_CLAUDE, SONNET_CLAUDE, OPUS_CLAUDE, "- fable → omniroute:glm-f (a backend)."),
    );
  });

  it("the opus tier answered by Claude Fable names Fable, and stays the opus tier", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-opus": ["claude-fable-5-2", "claude-opus-5-5"] });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(HAIKU_CLAUDE, SONNET_CLAUDE, "- opus → Claude Fable.", FABLE_CLAUDE),
    );
  });

  it("a worker slot that answers with a Claude Opus id is read as the opus tier", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-opus-5-5"] });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(HAIKU_CLAUDE, "- sonnet → Claude Opus.", OPUS_CLAUDE, FABLE_CLAUDE),
    );
  });

  it("a profile's view decides for a profile's session, not the machine's", async () => {
    const env = hookEnv();
    writeGateway(
      env,
      { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] },
      { cheap: { slots: { "cc-smart-dev-kit-worker": ["omniroute:glm-x"] } } },
    );
    const profile = await runHook(
      tierViewHook,
      event("SessionStart", makeRepo()),
      onRouter(env, `${ROUTER}/p/cheap`),
    );
    expect(said(profile)).toBe(
      note(HAIKU_CLAUDE, "- sonnet → omniroute:glm-x (a backend).", OPUS_CLAUDE, FABLE_CLAUDE),
    );
    const plain = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(plain)).toBe(ALL_CLAUDE);
  });

  it("a gateway config that cannot be read: no crash, and the note says so plainly", async () => {
    const env = hookEnv();
    const file = cliPaths(env).gatewayConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json", { mode: 0o600 });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(result.exitCode ?? 0).toBe(0);
    expect(said(result)).toBe(
      "Subagent tiers now: not known — the gateway config cannot be read (`cc-smart-dev-kit doctor` says why). The Agent guard judges each launch and names the effort it needs.",
    );
  });

  it("an address with no gateway config at all is not the kit's gateway: Claude", async () => {
    const env = hookEnv();
    const result = await runHook(
      tierViewHook,
      event("SessionStart", makeRepo()),
      onRouter(env, "http://127.0.0.1:4000"),
    );
    expect(said(result)).toBe(ALL_CLAUDE);
  });

  it("machine-wide: a folder outside git gets the same note as a project", async () => {
    const env = hookEnv();
    const outside = tempDir("tier-view-outside");
    expect(said(await runHook(tierViewHook, event("SessionStart", outside), env))).toBe(ALL_CLAUDE);
    expect(said(await runHook(tierViewHook, event("SessionStart", makeRepo()), env))).toBe(
      ALL_CLAUDE,
    );
  });

  it("a start says it again whenever it is a new context: a resume, a clear, a compaction", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    for (const source of ["startup", "resume", "clear", "compact"]) {
      const input = { ...event("SessionStart", repo), source };
      expect(said(await runHook(tierViewHook, input, env))).toBe(ALL_CLAUDE);
    }
  });
});

describe("the note when the view changes", () => {
  it("no change: silent at the next prompt, and at every one after it", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    expect(said(await runHook(tierViewHook, event("SessionStart", repo), env))).toBe(ALL_CLAUDE);
    for (let turn = 0; turn < 3; turn += 1) {
      expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), env)).toEqual({});
    }
  });

  it("a slot changed mid-session: said once at the next prompt, then silent", async () => {
    const env = hookEnv();
    const live = onRouter(env);
    const repo = makeRepo();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    expect(said(await runHook(tierViewHook, event("SessionStart", repo), live))).toBe(ALL_CLAUDE);
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), live)).toEqual({});
    // The owner moves the worker slot to a backend while the session runs.
    writeGateway(env, { "cc-smart-dev-kit-worker": ["omniroute:glm-x"] });
    const changed = await runHook(tierViewHook, event("UserPromptSubmit", repo), live);
    expect(changed.stdout).toBe(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: note(
            HAIKU_CLAUDE,
            "- sonnet → omniroute:glm-x (a backend).",
            OPUS_CLAUDE,
            FABLE_CLAUDE,
          ),
        },
      }),
    );
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), live)).toEqual({});
    // And back again: a second change is said, once.
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    expect(said(await runHook(tierViewHook, event("UserPromptSubmit", repo), live))).toBe(
      ALL_CLAUDE,
    );
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), live)).toEqual({});
  });

  it("the config breaks mid-session: said plainly once, and once more when it is fixed", async () => {
    const env = hookEnv();
    const live = onRouter(env);
    const repo = makeRepo();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    await runHook(tierViewHook, event("SessionStart", repo), live);
    writeFileSync(cliPaths(env).gatewayConfigFile, "{ not json", { mode: 0o600 });
    const broken = said(await runHook(tierViewHook, event("UserPromptSubmit", repo), live));
    expect(broken).toStartWith("Subagent tiers now: not known");
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), live)).toEqual({});
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    expect(said(await runHook(tierViewHook, event("UserPromptSubmit", repo), live))).toBe(
      ALL_CLAUDE,
    );
  });

  it("a prompt in a session whose start the hook never saw (a plugin updated mid-session): said once", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    expect(said(await runHook(tierViewHook, event("UserPromptSubmit", repo), env))).toBe(
      ALL_CLAUDE,
    );
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), env)).toEqual({});
  });

  it("another session is told its own: the mark is per session", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const other = "99999999-2222-3333-4444-555555555555";
    await runHook(tierViewHook, event("SessionStart", repo), env);
    expect(said(await runHook(tierViewHook, event("UserPromptSubmit", repo, other), env))).toBe(
      ALL_CLAUDE,
    );
  });

  it("a mark that cannot be kept: a prompt stays silent rather than repeat itself", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const mark = tierViewMark(env, SESSION);
    // The names folder is a FILE here, so no mark can be made.
    mkdirSync(dirname(dirname(mark)), { recursive: true });
    writeFileSync(dirname(mark), "");
    expect(said(await runHook(tierViewHook, event("UserPromptSubmit", repo), env))).toBeNull();
    // A start still says it: it is said once by nature.
    const start = await runHook(tierViewHook, event("SessionStart", repo), env);
    expect(said(start)).toBe(ALL_CLAUDE);
    expect(start.exitCode ?? 0).toBe(0);
  });

  it("a prompt with no session id Claude Code would write: silent", async () => {
    const env = hookEnv();
    const input = event("UserPromptSubmit", makeRepo(), "not-a-session-id");
    expect(await runHook(tierViewHook, input, env)).toEqual({});
  });

  it("the mark lies beside the session's name files", () => {
    const env = hookEnv();
    expect(tierViewMark(env, SESSION)).toBe(
      join(env.TMPDIR ?? "", "cc-smart-dev-kit-session-names", `${SESSION}.tiers`),
    );
  });
});

describe("the line while auto mode's safety checks are failing (the owner, 2026-10-27)", () => {
  /** A record fresh at the real clock (the hook reads it); no clock words in the cause. */
  const record = (extra: Record<string, unknown> = {}) => ({
    claim: null,
    lastAt: Date.now(),
    resetsAt: null,
    since: Date.now() - 60_000,
    status: 529,
    why: "off",
    ...extra,
  });

  function writeState(env: Record<string, string>, checksDown: Record<string, unknown>): void {
    const file = cliPaths(env).gatewayStateFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ checksDown, fallbacks: {}, limits: {}, version: 1 }), {
      mode: 0o600,
    });
  }

  /** The owner's sentence, with the reason and what the person can do. */
  const LINE = `Auto mode's safety checks are failing: Claude is down (HTTP 529), and the judge's stand-in is switched off. You cannot fix this; say it to the person once (what they can do: ${COMMAND} gateway fallback judge on), then stop and wait — do not retry or argue.`;

  it("a session on the gateway is told once at its start, under the tiers", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    writeState(env, { "cc-smart-dev-kit-judge": record() });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(`${ALL_CLAUDE}\n\n${LINE}`);
  });

  it("no record, a stale one, or a session off the gateway: the tiers alone", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    expect(
      said(await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env))),
    ).toBe(ALL_CLAUDE);
    writeState(env, { "cc-smart-dev-kit-judge": record({ lastAt: Date.now() - 16 * 60_000 }) });
    expect(
      said(await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env))),
    ).toBe(ALL_CLAUDE);
    writeState(env, { "cc-smart-dev-kit-judge": record() });
    // The gateway off: no address of ours, so nothing the router recorded is about this session.
    expect(said(await runHook(tierViewHook, event("SessionStart", makeRepo()), env))).toBe(
      ALL_CLAUDE,
    );
  });

  it("a profile's session reads its own record, never the machine's", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] }, { cheap: {} });
    writeState(env, { "cc-smart-dev-kit-judge": record() });
    const cheap = onRouter(env, `${ROUTER}/p/cheap`);
    expect(said(await runHook(tierViewHook, event("SessionStart", makeRepo()), cheap))).toBe(
      ALL_CLAUDE,
    );
    writeState(env, { "cheap/cc-smart-dev-kit-judge": record() });
    expect(said(await runHook(tierViewHook, event("SessionStart", makeRepo()), cheap))).toBe(
      `${ALL_CLAUDE}\n\n${LINE.replace("fallback judge on", "profile cheap fallback judge on")}`,
    );
    expect(
      said(await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env))),
    ).toBe(ALL_CLAUDE);
  });

  it("said once at the next prompt when the checks start failing, then silent, then the tiers again when they recover", async () => {
    const env = hookEnv();
    const live = onRouter(env);
    const repo = makeRepo();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    expect(said(await runHook(tierViewHook, event("SessionStart", repo), live))).toBe(ALL_CLAUDE);
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), live)).toEqual({});
    writeState(env, { "cc-smart-dev-kit-judge": record() });
    expect(said(await runHook(tierViewHook, event("UserPromptSubmit", repo), live))).toBe(
      `${ALL_CLAUDE}\n\n${LINE}`,
    );
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), live)).toEqual({});
    // The router ends the record at the next verdict: the note changes, and is said again.
    writeState(env, {});
    expect(said(await runHook(tierViewHook, event("UserPromptSubmit", repo), live))).toBe(
      ALL_CLAUDE,
    );
    expect(await runHook(tierViewHook, event("UserPromptSubmit", repo), live)).toEqual({});
  });
});

describe("no plan usage reaches Claude (the owner, 2026-11-15)", () => {
  const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);

  /** Writes the usage file the status line keeps, with both windows at 95%. */
  function writeUsageAt95(env: Record<string, string>): void {
    const paths = cliPaths(env);
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(
      join(paths.stateDir, "usage-window.json"),
      JSON.stringify({
        fiveHour: { percent: 95, resetsAt: NOW / 1000 + 3 * 3600 },
        readAt: "2026-10-15T09:00:00.000Z",
        sevenDay: { percent: 95, resetsAt: NOW / 1000 + 3 * 86_400 },
      }),
    );
  }

  it("a prompt with both windows at 95% says the tiers' note and no usage line", () => {
    const env = hookEnv();
    writeUsageAt95(env);
    const paths = cliPaths(env);
    const prompt = (): string | null =>
      said(tierView(event("UserPromptSubmit", "/nowhere"), env, paths, NOW));
    // No start seen, so the tiers' note is due: it is all the prompt says.
    expect(prompt()).toBe(ALL_CLAUDE);
    expect(prompt()).toBeNull();
  });

  it("a start says the tiers' note alone, whatever the usage file holds", () => {
    const env = hookEnv();
    writeUsageAt95(env);
    const start = tierView(event("SessionStart", "/nowhere"), env, cliPaths(env), NOW);
    expect(said(start)).toBe(ALL_CLAUDE);
  });
});
