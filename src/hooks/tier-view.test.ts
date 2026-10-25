/**
 * The `tier-view` hook (`tier-view.ts`): one note to Claude at a session start, and again when
 * what the four subagent tiers run changes. The expected notes are written out by hand.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { tierViewHook } from "./specs";
import { tierViewMark } from "./tier-view";

const SESSION = "11111111-2222-3333-4444-555555555555";
const ROUTER = "http://127.0.0.1:39999";

const HEADER = "Subagent tiers now (the Agent tool's `model`):";
const HAIKU_CLAUDE = "- haiku → Claude Haiku: the effort the task needs, medium to max.";
const SONNET_CLAUDE = "- sonnet → Claude Sonnet: the effort the task needs, medium to max.";
const OPUS_CLAUDE = "- opus → Claude Opus: medium to xhigh; max asks the person.";
const FABLE_CLAUDE = "- fable → Claude Fable: asks the person, with a `Fable reason:` line.";

/** The note for a view, written by hand from its four lines. */
function note(...lines: string[]): string {
  return [HEADER, ...lines].join("\n");
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

  it("a backend-first worker chain: sonnet is the backend, and runs at max", async () => {
    const env = hookEnv();
    writeGateway(env, {
      "cc-smart-dev-kit-scout": ["claude-haiku-5-5"],
      "cc-smart-dev-kit-worker": ["omniroute:glm-x", "claude-sonnet-5-5"],
    });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(
        HAIKU_CLAUDE,
        "- sonnet → omniroute:glm-x (a backend): runs at max.",
        OPUS_CLAUDE,
        FABLE_CLAUDE,
      ),
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

  it("a backend scout: haiku is the backend at max, and sonnet stays Claude", async () => {
    const env = hookEnv();
    writeGateway(env, {
      "cc-smart-dev-kit-scout": ["omniroute:glm-s"],
      "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"],
    });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(
        "- haiku → omniroute:glm-s (a backend): runs at max.",
        SONNET_CLAUDE,
        OPUS_CLAUDE,
        FABLE_CLAUDE,
      ),
    );
  });

  it("a slot or an override that answers with another Claude family names that model", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-scout": ["claude-sonnet-5-5"] });
    const slot = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(slot)).toBe(
      note(
        "- haiku → Claude Sonnet: the effort the task needs, medium to max.",
        SONNET_CLAUDE,
        OPUS_CLAUDE,
        FABLE_CLAUDE,
      ),
    );
    const plain = hookEnv();
    const override = { ...plain, ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-5-5" };
    expect(said(await runHook(tierViewHook, event("SessionStart", makeRepo()), override))).toBe(
      note(
        "- haiku → Claude Sonnet: the effort the task needs, medium to max.",
        SONNET_CLAUDE,
        OPUS_CLAUDE,
        FABLE_CLAUDE,
      ),
    );
  });

  it("the opus tier keeps its rule when a backend answers it", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-opus": ["omniroute:glm-o"] });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(
        HAIKU_CLAUDE,
        SONNET_CLAUDE,
        "- opus → omniroute:glm-o (a backend): medium to xhigh; max asks the person.",
        FABLE_CLAUDE,
      ),
    );
  });

  it("a worker slot that answers with a Claude Opus id is read as the opus tier", async () => {
    const env = hookEnv();
    writeGateway(env, { "cc-smart-dev-kit-worker": ["claude-opus-5-5"] });
    const result = await runHook(tierViewHook, event("SessionStart", makeRepo()), onRouter(env));
    expect(said(result)).toBe(
      note(
        HAIKU_CLAUDE,
        "- sonnet → Claude Opus: medium to xhigh; max asks the person.",
        OPUS_CLAUDE,
        FABLE_CLAUDE,
      ),
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
      note(
        HAIKU_CLAUDE,
        "- sonnet → omniroute:glm-x (a backend): runs at max.",
        OPUS_CLAUDE,
        FABLE_CLAUDE,
      ),
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

  it("machine-wide: a folder outside git, and a crew session, get the same note", async () => {
    const env = hookEnv();
    const outside = tempDir("tier-view-outside");
    expect(said(await runHook(tierViewHook, event("SessionStart", outside), env))).toBe(ALL_CLAUDE);
    const crew = { ...env, CC_SMART_DEV_KIT_CREW: "W2-x-1a2b3c" };
    expect(said(await runHook(tierViewHook, event("SessionStart", makeRepo()), crew))).toBe(
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
            "- sonnet → omniroute:glm-x (a backend): runs at max.",
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
