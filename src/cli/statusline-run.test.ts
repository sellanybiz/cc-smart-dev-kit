/**
 * SL1: what `cc-smart-dev-kit statusline` prints for the context segment and the effort, end to
 * end: the input on stdin, Claude Code's settings files and the gateway's config on disk (all in
 * temp folders), the environment the command was given.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import { type CliPaths, cliPaths } from "./paths";
import { runStatusline } from "./statusline";

const NOW = Date.UTC(2026, 10, 25, 10, 0, 0);
const OPUS = "claude-opus-5-5";

function write(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

/** The status line input as Claude Code 2.1.310 passes it. */
function inputOf(
  over: {
    context?: Record<string, unknown> | null;
    effort?: unknown;
    folder?: string;
    id?: string;
  } = {},
): Record<string, unknown> {
  const context =
    over.context === null
      ? {}
      : {
          context_window: {
            context_window_size: 1_000_000,
            total_input_tokens: 312_000,
            used_percentage: 31,
            ...over.context,
          },
        };
  return {
    model: { display_name: "Opus 5.5", id: over.id ?? OPUS },
    ...context,
    ...(over.effort === undefined ? {} : { effort: over.effort }),
    ...(over.folder === undefined ? {} : { workspace: { project_dir: over.folder } }),
  };
}

let printed: string[] = [];
const original = console.log;
beforeEach(() => {
  printed = [];
  console.log = (...parts: unknown[]) => {
    printed.push(parts.map(String).join(" "));
  };
});
afterEach(() => {
  console.log = original;
});

function world() {
  const paths: CliPaths = cliPaths({ HOME: tempDir("sl1-home") });
  mkdirSync(paths.stateDir, { recursive: true });
  const folder = tempDir("sl1-project");
  return {
    folder,
    paths,
    run: async (input: unknown, env: Record<string, string | undefined> = {}) => {
      await runStatusline(paths, async () => JSON.stringify(input), NOW, undefined, env);
      return printed.at(-1) ?? "";
    },
    user: join(paths.claudeConfigDir, "settings.json"),
  };
}

describe("SL1: the context segment", () => {
  it("measures against the model's per-model auto-compact window", async () => {
    const w = world();
    write(w.user, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 78% of 400k");
  });

  it("a top-level window is the fallback", async () => {
    const w = world();
    write(w.user, { autoCompactWindow: 500_000 });
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 62% of 500k");
  });

  it('"auto" and no key measure against the model\'s window', async () => {
    const w = world();
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 31% of 1M");
    write(w.user, {
      autoCompactWindow: 500_000,
      modelSettings: { [OPUS]: { autoCompactWindow: "auto" } },
    });
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 31% of 1M");
  });

  it("a model id with the [1m] suffix finds its entry", async () => {
    const w = world();
    write(w.user, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(await w.run(inputOf({ folder: w.folder, id: `${OPUS}[1m]` }))).toBe(
      "Opus 5.5 · ctx 312k · 78% of 400k",
    );
  });

  it("warns from alerts.usagePercent", async () => {
    const w = world();
    write(w.user, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(
      await w.run(inputOf({ context: { total_input_tokens: 350_000 }, folder: w.folder })),
    ).toBe("Opus 5.5 · ⚠ ctx 350k · 88% of 400k");
  });

  it("shows no segment when the input has no context data", async () => {
    const w = world();
    expect(await w.run(inputOf({ context: null, folder: w.folder }))).toBe("Opus 5.5");
    expect(
      await w.run(
        inputOf({
          context: { total_input_tokens: null, used_percentage: null },
          folder: w.folder,
        }),
      ),
    ).toBe("Opus 5.5");
  });

  it("a settings file that is not valid JSON: no crash, the model's window", async () => {
    const w = world();
    write(w.user, "{ not json");
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 31% of 1M");
  });

  it("the project's own settings override the person's", async () => {
    const w = world();
    write(w.user, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    write(join(w.folder, ".claude", "settings.local.json"), {
      modelSettings: { [OPUS]: { autoCompactWindow: 600_000 } },
    });
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 52% of 600k");
  });

  it("a linked worktree reads the main checkout's local settings", async () => {
    const w = world();
    const main = tempDir("sl1-main");
    write(join(main, ".claude", "settings.local.json"), {
      modelSettings: { [OPUS]: { autoCompactWindow: 500_000 } },
    });
    mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
    write(join(w.folder, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 62% of 500k");
  });

  it("CLAUDE_CODE_AUTO_COMPACT_WINDOW in the command's environment wins over the keys", async () => {
    const w = world();
    write(w.user, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(
      await w.run(inputOf({ folder: w.folder }), { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "600k" }),
    ).toBe("Opus 5.5 · ctx 312k · 52% of 600k");
  });
});

describe("SL1: the reasoning effort", () => {
  it("is the one the input reports, and follows a change at the next refresh", async () => {
    const w = world();
    expect(await w.run(inputOf({ effort: { level: "xhigh" }, folder: w.folder }))).toBe(
      "Opus 5.5 · ctx 312k · 31% of 1M · xhigh",
    );
    expect(await w.run(inputOf({ effort: { level: "low" }, folder: w.folder }))).toBe(
      "Opus 5.5 · ctx 312k · 31% of 1M · low",
    );
  });

  it("no source says it: nothing is shown", async () => {
    const w = world();
    // The settings' `effortLevel` is not a source: the model may not take the parameter.
    write(w.user, { effortLevel: "xhigh" });
    expect(await w.run(inputOf({ folder: w.folder }))).toBe("Opus 5.5 · ctx 312k · 31% of 1M");
  });

  describe("on the gateway, with the slot's backend target pinned (D64)", () => {
    function gateway(w: ReturnType<typeof world>): void {
      mkdirSync(dirname(w.paths.gatewayConfigFile), { recursive: true });
      writeFileSync(
        w.paths.gatewayConfigFile,
        JSON.stringify({
          aliases: {},
          anthropicBaseUrl: "https://api.anthropic.com",
          backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
          effort: { "cc-smart-dev-kit-opus": { "omniroute:glm-5.3": "max" } },
          port: 20199,
          slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-5.3"] },
          timeouts: { firstByteMs: 60_000 },
          version: 1,
        }),
        { mode: 0o600 },
      );
    }

    it("shows the pinned effort, the one that really answers", async () => {
      const w = world();
      gateway(w);
      expect(
        await w.run(inputOf({ effort: { level: "xhigh" }, folder: w.folder }), {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:20199",
        }),
      ).toBe("Opus 5.5 · ctx 312k · 31% of 1M · max");
    });

    it("shows the pin even where the input reports no effort", async () => {
      const w = world();
      gateway(w);
      expect(
        await w.run(inputOf({ folder: w.folder }), {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:20199",
        }),
      ).toBe("Opus 5.5 · ctx 312k · 31% of 1M · max");
    });

    it("a session off the gateway, or with no address, keeps its own effort", async () => {
      const w = world();
      gateway(w);
      const input = inputOf({ effort: { level: "xhigh" }, folder: w.folder });
      expect(await w.run(input, { ANTHROPIC_BASE_URL: "https://api.anthropic.com" })).toBe(
        "Opus 5.5 · ctx 312k · 31% of 1M · xhigh",
      );
      expect(await w.run(input, {})).toBe("Opus 5.5 · ctx 312k · 31% of 1M · xhigh");
    });
  });
});
