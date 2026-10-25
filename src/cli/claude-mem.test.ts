/**
 * `cc-smart-dev-kit claude-mem`: the same choices the portal's card makes, from the command
 * line. Every write goes through `src/machine/claude-mem-choices.ts`, so the two cannot
 * disagree; the key comes on stdin and is never printed.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import { type ClaudeMemDeps, runClaudeMem } from "./claude-mem";
import { cliPaths } from "./paths";
import { createOut, textSink } from "./ui/out";
import { detectTerminal } from "./ui/terminal";

/** The key the gateway holds for its backend, and the one the person pastes. */
const GATEWAY_KEY = "sk-gateway-PLANTED-0001";
const OWN_KEY = "sk-own-PLANTED-0002";
const BACKEND_URL = "http://127.0.0.1:18434";

/** claude-mem's settings.json as 13.40.0 seeds it. */
const SEEDED = {
  CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "true",
  CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEYS: "",
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
  CLAUDE_MEM_PROVIDER: "claude",
  CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "",
  CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
  CLAUDE_MEM_WORK_STATE_ENABLED: "true",
};

const PLAIN = detectTerminal({ env: {}, isTTY: false, platform: "linux" });

interface Options {
  installed?: boolean;
  settings?: unknown;
  /** The models the backend lists; null: it does not answer. */
  models?: null | string[];
  /** What the key's read answers: a string, or null at Ctrl+C. Left out: nothing arrives. */
  stdin?: null | string;
  /** A read that fails, as a terminal that cannot hide what is typed does. */
  readError?: string;
  /** The terminal's answer to the take-over's question; null: there is no terminal. */
  confirm?: null | boolean;
}

/** A machine, a printed-lines collector, and a command runner. */
function world(options: Options = {}) {
  const home = tempDir("cli-claude-mem");
  const configDir = join(home, ".claude");
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  if (options.installed !== false) {
    const installPath = join(home, "plugins", "claude-mem");
    mkdirSync(installPath, { recursive: true });
    writeFileSync(
      paths.installedPluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "claude-mem@thedotmack": [{ installPath, scope: "user", version: "13.40.0" }],
        },
      }),
    );
  }
  mkdirSync(dirname(paths.claudeMemSettingsFile), { recursive: true });
  writeFileSync(paths.claudeMemSettingsFile, JSON.stringify(options.settings ?? SEEDED, null, 2), {
    mode: 0o644,
  });
  mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
  writeFileSync(
    paths.gatewayConfigFile,
    JSON.stringify({
      backends: { omniroute: { apiKey: GATEWAY_KEY, baseUrl: BACKEND_URL } },
      slots: {},
      version: 1,
    }),
    { mode: 0o600 },
  );
  const lines: string[] = [];
  const checks: Array<{ apiKey: string; backend: string; baseUrl: string; model: string }> = [];
  const deps: ClaudeMemDeps = {
    check: async (target) => {
      checks.push({ ...target });
      return null;
    },
    confirm:
      options.confirm === undefined || options.confirm === null
        ? (options.confirm ?? null)
        : () => options.confirm === true,
    list: async () => {
      const models = options.models === undefined ? ["glm/flash", "scout/model"] : options.models;
      return models === null
        ? { error: "it did not answer" }
        : { models: models.map((id) => ({ contextLength: null, id })), status: 200 };
    },
    out: createOut(
      PLAIN,
      textSink((text) => lines.push(text)),
    ),
    paths,
    read: async () => {
      if (options.readError !== undefined) throw new Error(options.readError);
      return options.stdin === undefined ? "" : options.stdin;
    },
  };
  const settings = () => JSON.parse(readFileSync(paths.claudeMemSettingsFile, "utf8"));
  const printed = () => lines.join("");
  return { checks, deps, paths, printed, settings };
}

describe("claude-mem status", () => {
  test("MS1: it prints the route, the key, the fallback and who set each", async () => {
    expect(await runClaudeMem([], world().deps)).toBe(0);
    const { deps, printed } = world();
    expect(await runClaudeMem(["status"], deps)).toBe(0);
    expect(printed()).toBe(
      [
        "claude-mem 13.40.0",
        "· settings: ~/.claude-mem/settings.json",
        "· route: Claude, on your own Claude login, its model claude-haiku-4-5-20251001 — claude-mem's own default",
        "· key: none — claude-mem's own default",
        "· fallback: Claude (claude-mem's own), its model: claude-haiku-4-5-20251001 — claude-mem's own default",
        "! It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider.",
        "✓ Every choice here can be changed; nothing of yours stands in the way.",
        "",
      ].join("\n"),
    );
  });

  test("MS1: claude-mem not installed: one failure line carrying its fix", async () => {
    const { deps, printed } = world({ installed: false });
    expect(await runClaudeMem(["status"], deps)).toBe(1);
    expect(printed()).toBe(
      [
        "claude-mem",
        "· settings: ~/.claude-mem/settings.json",
        "✗ claude-mem is not installed, so there is nothing to set.",
        "  Fix: claude plugin install claude-mem@thedotmack",
        "",
      ].join("\n"),
    );
  });

  test("MS1: a value set by hand: which choice it refuses, and the take-over that opens it", async () => {
    const { deps, printed } = world({
      settings: { ...SEEDED, CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model" },
    });
    expect(await runClaudeMem(["status"], deps)).toBe(0);
    expect(printed()).toContain(
      "! Changing the route or the fallback is refused: CLAUDE_MEM_OPENAI_COMPAT_MODEL is set by hand in ~/.claude-mem/settings.json.",
    );
    expect(printed()).toContain(
      "cc-smart-dev-kit claude-mem take-over records it as cc-smart-dev-kit's, and restore puts the value back.",
    );
    expect(printed()).toContain("! Take those values over before you change them.");
  });

  test("MS1: a choice made here reads as the person's, never as the portal's", async () => {
    const w = world();
    await runClaudeMem(["route", "omniroute:glm/flash"], w.deps);
    expect(await runClaudeMem(["status"], w.deps)).toBe(0);
    expect(w.printed()).toContain("· route: omniroute:glm/flash — your choice\n");
    expect(w.printed()).toContain("· key: the gateway's own key for that backend — your choice\n");
  });
});

describe("claude-mem route and fallback", () => {
  test("MS1: a listed model goes in, and an unlisted one is refused by the live list", async () => {
    const { checks, deps, printed, settings } = world();
    expect(await runClaudeMem(["route", "omniroute:glm/flash"], deps)).toBe(0);
    expect(checks).toEqual([
      {
        apiKey: GATEWAY_KEY,
        backend: "omniroute",
        baseUrl: `${BACKEND_URL}/v1`,
        model: "glm/flash",
      },
    ]);
    expect(settings()).toMatchObject({
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "glm/flash",
      CLAUDE_MEM_PROVIDER: "openai-compatible",
    });
    expect(printed()).toContain(
      '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "" -> "glm/flash"',
    );
    // A model the backend does not list: refused before any chat, by the same rule as the card.
    const other = world();
    expect(await runClaudeMem(["route", "omniroute:not-there"], other.deps)).toBe(1);
    expect(other.printed()).toContain(
      '"omniroute:not-there": "omniroute" has no model "not-there" (see cc-smart-dev-kit gateway models)',
    );
    expect(other.checks).toEqual([]);
    expect(other.settings().CLAUDE_MEM_PROVIDER).toBe("claude");
  });

  test("MS1: a backend the gateway does not have, and a Claude model as a backend", async () => {
    const missing = world();
    expect(await runClaudeMem(["route", "nope:model"], missing.deps)).toBe(1);
    expect(missing.printed()).toContain('"nope:model": backend "nope" is not in the config');
    expect(missing.printed()).toContain("The config names: omniroute.");
    const claude = world();
    expect(await runClaudeMem(["route", "claude-haiku-5-5"], claude.deps)).toBe(1);
    expect(claude.printed()).toContain(
      'claude-haiku-5-5 is a Claude model: use "claude" for the Claude route, or "claude <model id>" for a Claude fallback.',
    );
    // No gateway at all: the route to a backend says so.
    const bare = world();
    bare.paths.gatewayConfigFile = join(bare.paths.stateDir, "no.json");
    expect(await runClaudeMem(["route", "omniroute:glm/flash"], bare.deps)).toBe(1);
    expect(bare.printed()).toContain(
      "The gateway is not set up, so it has no backend for claude-mem to use.",
    );
  });

  test("MS1: every fallback choice, and the refusals that name what to do", async () => {
    const off = world();
    expect(await runClaudeMem(["fallback", "off"], off.deps)).toBe(0);
    expect(off.settings().CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("off");
    const claude = world();
    expect(await runClaudeMem(["fallback", "claude", "claude-haiku-5-5"], claude.deps)).toBe(1);
    expect(claude.printed()).toContain(
      "claude-mem's route is Claude already, so Claude cannot be its fallback: pick a backend model, or off.",
    );
    // On a backend route, an OmniRoute fallback takes claude-mem's OpenRouter provider.
    const backend = world();
    await runClaudeMem(["route", "omniroute:glm/flash"], backend.deps);
    expect(await runClaudeMem(["fallback", "omniroute:scout/model"], backend.deps)).toBe(0);
    expect(backend.settings()).toMatchObject({
      CLAUDE_MEM_OPENROUTER_BASE_URL: `${BACKEND_URL}/v1`,
      CLAUDE_MEM_OPENROUTER_MODEL: "scout/model",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openrouter",
    });
    // Nothing to run: the words say what to give.
    const bare = world();
    expect(await runClaudeMem(["route"], bare.deps)).toBe(2);
    expect(bare.printed()).toContain(
      "Say where claude-mem's summaries go: claude, or <backend>:<model>",
    );
    expect(await runClaudeMem(["fallback"], bare.deps)).toBe(2);
    expect(await runClaudeMem(["fallback", "off", "extra"], bare.deps)).toBe(2);
    expect(await runClaudeMem(["nonsense"], bare.deps)).toBe(2);
    expect(bare.printed()).toContain("claude-mem takes status, route, key, fallback or take-over");
    // A word that is nonsense is never echoed back: it is what a person pastes by mistake.
    expect(await runClaudeMem([OWN_KEY], bare.deps)).toBe(2);
    expect(bare.printed()).not.toContain("PLANTED");
  });

  test("MS1: a Claude fallback's model is checked like a route's, and an empty word is refused", async () => {
    const w = world();
    await runClaudeMem(["route", "omniroute:glm/flash"], w.deps);
    // A Claude model id goes in on a backend route: the fallback provider becomes Claude.
    expect(await runClaudeMem(["fallback", "claude", "claude-sonnet-5-5"], w.deps)).toBe(0);
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-sonnet-5-5",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
    });
    // An empty word is not "claude-mem's own model": leaving the model out is.
    const empty = world();
    expect(await runClaudeMem(["fallback", "claude", ""], empty.deps)).toBe(2);
    expect(empty.printed()).toContain("claude takes a Claude model id after it, or none at all");
    // A word that is not a Claude id, and a backend target after "claude": both refused in words.
    const wrong = world();
    expect(await runClaudeMem(["fallback", "claude", "not-a-claude-id"], wrong.deps)).toBe(1);
    expect(wrong.printed()).toContain(
      "not-a-claude-id is not a Claude model id: give a claude-… id, or none for claude-mem's own model.",
    );
    const target = world();
    expect(await runClaudeMem(["fallback", "claude", "omniroute:glm/flash"], target.deps)).toBe(1);
    expect(target.printed()).toContain(
      "omniroute:glm/flash is not a Claude model id: give a claude-… id, or none for claude-mem's own model.",
    );
    expect(target.settings().CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("claude");
    expect(target.settings().CLAUDE_MEM_QUOTA_FALLBACK_MODEL).toBe("");
  });
});

describe("claude-mem key", () => {
  test("MS1: the key comes on stdin, is checked first, and is never printed", async () => {
    const w = world({ stdin: ` ${OWN_KEY} ` });
    await runClaudeMem(["route", "omniroute:glm/flash"], w.deps);
    expect(await runClaudeMem(["key"], w.deps)).toBe(0);
    expect(w.checks.at(-1)).toEqual({
      apiKey: OWN_KEY,
      backend: "omniroute",
      baseUrl: `${BACKEND_URL}/v1`,
      model: "glm/flash",
    });
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    expect(w.printed()).not.toContain("PLANTED");
    // Back to the gateway's own key.
    expect(await runClaudeMem(["key", "--gateway"], w.deps)).toBe(0);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(GATEWAY_KEY);
    expect(w.printed()).not.toContain("PLANTED");
  });

  test("MS1: no key on stdin, and a key as an argument: both refused, nothing written", async () => {
    const empty = world();
    expect(await runClaudeMem(["key"], empty.deps)).toBe(1);
    expect(empty.printed()).toContain(
      "The key was not saved: none arrived on stdin, and a key is never an argument.",
    );
    const argument = world();
    expect(await runClaudeMem(["key", OWN_KEY], argument.deps)).toBe(2);
    expect(argument.printed()).toContain(
      'A key comes on stdin, never as an argument: nothing after "key" but --gateway',
    );
    expect(argument.printed()).not.toContain("PLANTED");
    expect(argument.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe("");
  });

  test("MS1: a paste's bracketed markers and control characters go first, so the key checks clean", async () => {
    const w = world({ stdin: `\u001b[200~${OWN_KEY}\u001b[201~\n` });
    await runClaudeMem(["route", "omniroute:glm/flash"], w.deps);
    expect(await runClaudeMem(["key"], w.deps)).toBe(0);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    expect(w.printed()).not.toContain("PLANTED");
  });

  test("MS1: Ctrl+C at the secret read saves nothing and exits 130", async () => {
    const w = world({ stdin: null });
    expect(await runClaudeMem(["key"], w.deps)).toBe(130);
    expect(w.printed()).toContain("Nothing was saved (Ctrl+C).");
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe("");
  });

  test("MS1: a read that cannot hide what is typed refuses in its own words, never as Ctrl+C", async () => {
    const w = world({
      readError: "this terminal cannot hide what you type, so the key would be shown on screen",
    });
    expect(await runClaudeMem(["key"], w.deps)).toBe(1);
    expect(w.printed()).toContain(
      "The key was not saved: this terminal cannot hide what you type, so the key would be shown on screen.",
    );
    expect(w.printed()).not.toContain("Nothing was saved (Ctrl+C)");
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe("");
  });
});

describe("claude-mem take-over", () => {
  const BY_HAND = {
    ...SEEDED,
    CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${BACKEND_URL}/v1`,
    CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
    CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
    CLAUDE_MEM_PROVIDER: "openai-compatible",
  };

  test("MS1: it asks first, and with no terminal it changes nothing and says how to go on", async () => {
    const w = world({ confirm: null, settings: BY_HAND });
    expect(await runClaudeMem(["take-over"], w.deps)).toBe(1);
    expect(w.printed()).toContain(
      "Nothing was changed. Run again with --yes to take those values over.",
    );
    expect(w.printed()).toContain(
      "~/.claude-mem/settings.json holds values of yours: CLAUDE_MEM_PROVIDER, CLAUDE_MEM_OPENAI_COMPAT_PRESET, CLAUDE_MEM_OPENAI_COMPAT_BASE_URL, CLAUDE_MEM_OPENAI_COMPAT_MODEL.",
    );
    expect(w.printed()).toContain(
      "Nothing in that file changes: each value stays exactly as it is until you pick another, and cc-smart-dev-kit restore puts it back. A key's value is never written down: restore leaves your key as it is while it is still yours. Once cc-smart-dev-kit replaced it, restore keeps the kit's key only with the address it was written for; where your address comes back, your key comes back with it, from the backup of your file.",
    );
    // A "no" at the terminal is the same: nothing changes.
    const no = world({ confirm: false, settings: BY_HAND });
    expect(await runClaudeMem(["take-over"], no.deps)).toBe(1);
    expect(no.printed()).toContain("Nothing was changed.\n");
  });

  test("MS1: with --yes it records them, the file does not change, and the route then moves", async () => {
    const w = world({ settings: BY_HAND });
    const before = readFileSync(w.paths.claudeMemSettingsFile, "utf8");
    expect(await runClaudeMem(["take-over", "--yes"], w.deps)).toBe(0);
    expect(readFileSync(w.paths.claudeMemSettingsFile, "utf8")).toBe(before);
    expect(w.printed()).toContain(
      "The take-over recorded 4 values of claude-mem's as cc-smart-dev-kit's: each stays exactly as it is until you pick another.",
    );
    // The route that was refused now goes through.
    expect(await runClaudeMem(["route", "omniroute:glm/flash"], w.deps)).toBe(0);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("glm/flash");
    // And nothing to take over a second time.
    expect(await runClaudeMem(["take-over", "--yes"], w.deps)).toBe(0);
    expect(w.printed()).toContain(
      "Nothing to take over: every value claude-mem holds in ~/.claude-mem/settings.json is cc-smart-dev-kit's own, or claude-mem's own default.",
    );
  });

  test("MS1: a take-over asks at a terminal, and a yes goes through", async () => {
    const w = world({ confirm: true, settings: BY_HAND });
    expect(await runClaudeMem(["take-over"], w.deps)).toBe(0);
    expect(w.printed()).toContain("The take-over recorded 4 values");
  });
});
