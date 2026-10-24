/**
 * `context-window.ts`: the window a crew session's hand-off share is measured against. Claude
 * Code's own number when the status line recorded one for the model; the kit's table otherwise;
 * a backend's own list for the bare model name a router answer records.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { cliPaths } from "../cli/paths";
import type { ListedModel } from "../gateway/backends";
import { parseConfig } from "../gateway/config";
import { tempDir } from "../testing/temp";
import {
  BACKEND_LIST_RETRY_MS,
  BACKEND_LIST_TTL_MS,
  backendForModel,
  backendWindowsFile,
  CONTEXT_WINDOW_1M,
  CONTEXT_WINDOW_SMALL,
  claudeWindowFile,
  claudeWindowOfInput,
  claudeWindowSaid,
  compactPointOf,
  contextWindowOf,
  recordClaudeWindow,
  windowWatch,
} from "./context-window";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");

/** A temp home with the kit's own folders, and a gateway config naming one backend target. */
function world(target = "omniroute:deepseek-v4.1-flash"): CliPaths {
  const paths = cliPaths({ HOME: tempDir("home") });
  mkdirSync(paths.stateDir, { recursive: true });
  mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
  writeFileSync(
    paths.gatewayConfigFile,
    JSON.stringify({
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
      slots: { "cc-smart-dev-kit-worker": [target] },
      version: 1,
    }),
    { mode: 0o600 },
  );
  return paths;
}

/** A status line input as Claude Code passes it, with the fields this reads. */
function statusLineInput(model: string, size: number): Record<string, unknown> {
  return { context_window: { context_window_size: size }, model: { id: model } };
}

/** A fake model list that counts its calls, and answers what the test says. */
function fakeList(models: ListedModel[], status = 200) {
  const calls: string[] = [];
  const list = (baseUrl: string): Promise<{ models: ListedModel[]; status: number }> => {
    calls.push(baseUrl);
    return Promise.resolve({ models, status });
  };
  return { calls, list };
}

describe("the kit's table", () => {
  test("CC4: every current Claude family has a 1M window", () => {
    expect(contextWindowOf("claude-opus-5-5")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-opus-5")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-opus-4-6")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-opus-4-8")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-sonnet-5-5")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-sonnet-5")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-sonnet-4-6")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-haiku-5-5")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-fable-5")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-fable-5-1")).toBe(CONTEXT_WINDOW_1M);
  });

  test("CC4: the family name a crew session is launched with is its current model", () => {
    expect(contextWindowOf("opus")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("sonnet")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("haiku")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("fable")).toBe(CONTEXT_WINDOW_1M);
  });

  test("CC4: `[1m]` is 1M on any id, as Claude Code reads it", () => {
    expect(contextWindowOf("claude-sonnet-5-5[1m]")).toBe(CONTEXT_WINDOW_1M);
    expect(contextWindowOf("claude-haiku-4-5[1m]")).toBe(CONTEXT_WINDOW_1M);
  });

  test("CC4: Haiku 4.5 and the older models have 200 000", () => {
    expect(contextWindowOf("claude-haiku-4-5")).toBe(CONTEXT_WINDOW_SMALL);
    expect(contextWindowOf("claude-haiku-4-5-20251001")).toBe(CONTEXT_WINDOW_SMALL);
    expect(contextWindowOf("claude-sonnet-4-5")).toBe(CONTEXT_WINDOW_SMALL);
    expect(contextWindowOf("claude-opus-4-5")).toBe(CONTEXT_WINDOW_SMALL);
    expect(contextWindowOf("claude-3-5-sonnet-20241022")).toBe(CONTEXT_WINDOW_SMALL);
  });

  test("CC4: an unknown Claude id is the smaller guess, so it hands off early", () => {
    expect(contextWindowOf("claude-mystery-1")).toBe(CONTEXT_WINDOW_SMALL);
  });

  test("CC4: a model that is not Claude's has no table window", () => {
    expect(contextWindowOf("deepseek-v4.1-flash")).toBeNull();
    expect(contextWindowOf("omniroute:glm-5.3-flash")).toBeNull();
    expect(contextWindowOf("cc-smart-dev-kit-worker")).toBeNull();
    expect(contextWindowOf("")).toBeNull();
  });
});

describe("Claude Code's own number", () => {
  test("CC4: the status line records it per id as reported, `[1m]` included", () => {
    // One id can have two windows, so the two readings must not share a key.
    const paths = world();
    recordClaudeWindow(paths, statusLineInput("claude-opus-5-5", CONTEXT_WINDOW_SMALL), NOW);
    recordClaudeWindow(paths, statusLineInput("claude-opus-5-5[1m]", CONTEXT_WINDOW_1M), NOW);
    expect(claudeWindowSaid(paths, "claude-opus-5-5")).toBe(CONTEXT_WINDOW_SMALL);
    expect(claudeWindowSaid(paths, "claude-opus-5-5[1m]")).toBe(CONTEXT_WINDOW_1M);
    const kept = JSON.parse(readFileSync(claudeWindowFile(paths), "utf8"));
    expect(Object.keys(kept).sort()).toEqual(["claude-opus-5-5", "claude-opus-5-5[1m]"]);
  });

  test("CC4: a `[1m]` model is not measured by what was recorded for the same id without it", async () => {
    const paths = world();
    // An interactive session on the 200K model recorded its number; the `[1m]` model's own
    // window is still Claude Code's 1M.
    recordClaudeWindow(paths, statusLineInput("claude-opus-4-5", CONTEXT_WINDOW_SMALL), NOW);
    const watch = windowWatch({ paths });
    expect(await watch.of("claude-opus-4-5", NOW)).toBe(CONTEXT_WINDOW_SMALL);
    expect(await watch.of("claude-opus-4-5[1m]", NOW)).toBe(CONTEXT_WINDOW_1M);
  });

  test("CC4: nothing is recorded when the input reports no model or no window", () => {
    const paths = world();
    expect(claudeWindowOfInput({ context_window: { context_window_size: 1_000_000 } })).toBeNull();
    expect(claudeWindowOfInput({ model: { id: "claude-opus-5-5" } })).toBeNull();
    expect(
      claudeWindowOfInput({ context_window: { context_window_size: 0 }, model: { id: "x" } }),
    ).toBeNull();
    recordClaudeWindow(paths, { model: { id: "claude-opus-5-5" } }, NOW);
    expect(claudeWindowSaid(paths, "claude-opus-5-5")).toBeNull();
  });

  test("CC4: the same number again is not written again", () => {
    const paths = world();
    recordClaudeWindow(paths, statusLineInput("claude-opus-5-5", CONTEXT_WINDOW_1M), NOW);
    const once = readFileSync(claudeWindowFile(paths), "utf8");
    recordClaudeWindow(
      paths,
      statusLineInput("claude-opus-5-5", CONTEXT_WINDOW_1M),
      NOW + 60 * 60_000,
    );
    expect(readFileSync(claudeWindowFile(paths), "utf8")).toBe(once);
    // A different number is the model's window changing: it replaces the old reading.
    recordClaudeWindow(
      paths,
      statusLineInput("claude-opus-5-5", CONTEXT_WINDOW_SMALL),
      NOW + 60 * 60_000,
    );
    expect(claudeWindowSaid(paths, "claude-opus-5-5")).toBe(CONTEXT_WINDOW_SMALL);
  });

  test("CC4: it wins over the kit's table", async () => {
    const paths = world();
    recordClaudeWindow(paths, statusLineInput("claude-opus-5-5", 500_000), NOW);
    const watch = windowWatch({ paths });
    expect(await watch.of("claude-opus-5-5", NOW)).toBe(500_000);
    // With nothing recorded for the model, the table decides.
    expect(await watch.of("claude-sonnet-5-5", NOW)).toBe(CONTEXT_WINDOW_1M);
  });
});

describe("a backend's model", () => {
  test("CC4: its window comes from the backend's own list, read once and kept", async () => {
    const paths = world();
    const fake = fakeList([{ contextLength: 1_000_000, id: "deepseek-v4.1-flash" }]);
    const watch = windowWatch({ list: fake.list, paths });
    expect(await watch.of("deepseek-v4.1-flash", NOW)).toBe(1_000_000);
    expect(fake.calls).toEqual(["http://127.0.0.1:9"]);
    // Kept: a second watch reads the file, not the backend — also one started later.
    expect(await watch.of("deepseek-v4.1-flash", NOW + 60_000)).toBe(1_000_000);
    const later = fakeList([]);
    expect(
      await windowWatch({ list: later.list, paths }).of("deepseek-v4.1-flash", NOW + 60_000),
    ).toBe(1_000_000);
    expect(later.calls).toEqual([]);
    const kept = JSON.parse(readFileSync(backendWindowsFile(paths), "utf8"));
    expect(kept.omniroute.windows["deepseek-v4.1-flash"]).toBe(1_000_000);
  });

  test("CC4: a catalog id's provider prefix is not in the transcript's bare name", async () => {
    // Measured on this machine: the target is `omniroute:ollama-cloud/deepseek-v4.1-flash`, the
    // backend lists it as `ollama-cloud/deepseek-v4.1-flash`, and the transcript says
    // `deepseek-v4.1-flash`. Only the models a chain names are kept, not the whole catalog.
    const paths = world("omniroute:ollama-cloud/deepseek-v4.1-flash");
    const fake = fakeList([
      { contextLength: 1_000_000, id: "ollama-cloud/deepseek-v4.1-flash" },
      { contextLength: 8_192, id: "aihorde/2DN" },
    ]);
    expect(await windowWatch({ list: fake.list, paths }).of("deepseek-v4.1-flash", NOW)).toBe(
      1_000_000,
    );
    const kept = JSON.parse(readFileSync(backendWindowsFile(paths), "utf8"));
    expect(kept.omniroute.windows).toEqual({
      "ollama-cloud/deepseek-v4.1-flash": 1_000_000,
    });
  });

  test("CC4: before the first reply, the record's whole target names the backend too", async () => {
    // A crew session's record holds `model.resolved` as the target it was launched on.
    const paths = world("omniroute:ollama-cloud/deepseek-v4.1-flash");
    const fake = fakeList([{ contextLength: 1_000_000, id: "ollama-cloud/deepseek-v4.1-flash" }]);
    expect(
      await windowWatch({ list: fake.list, paths }).of(
        "omniroute:ollama-cloud/deepseek-v4.1-flash",
        NOW,
      ),
    ).toBe(1_000_000);
  });

  test("CC4: an answer that names no chain model is not kept for the day", async () => {
    // A catalog still loading, or a 200 that is no list: keeping it would leave the gauge blind
    // until the kept list was a day old.
    const paths = world();
    let calls = 0;
    const empty = () => {
      calls += 1;
      return Promise.resolve({
        models: [{ contextLength: null, id: "aihorde/2DN" }],
        status: 200,
      });
    };
    expect(await windowWatch({ list: empty, paths }).of("deepseek-v4.1-flash", NOW)).toBeNull();
    expect(existsSync(backendWindowsFile(paths))).toBe(false);
    // A watch started now asks again at once, not in a day.
    expect(
      await windowWatch({ list: empty, paths }).of("deepseek-v4.1-flash", NOW + 60_000),
    ).toBeNull();
    expect(calls).toBe(2);
  });

  test("CC4: the exact catalog id wins over another provider's same-named entry", async () => {
    const paths = world("omniroute:ollama-cloud/deepseek-v4.1-flash");
    const fake = fakeList([
      { contextLength: 64_000, id: "deepseek/deepseek-v4.1-flash" },
      { contextLength: 1_000_000, id: "ollama-cloud/deepseek-v4.1-flash" },
    ]);
    expect(await windowWatch({ list: fake.list, paths }).of("deepseek-v4.1-flash", NOW)).toBe(
      1_000_000,
    );
    // A target that carries a provider is named only by its own id: another provider's entry
    // with the same last segment is not that model.
    const elsewhere = world("omniroute:ollama-cloud/deepseek-v4.1-flash");
    const only = fakeList([{ contextLength: 64_000, id: "deepseek/deepseek-v4.1-flash" }]);
    expect(
      await windowWatch({ list: only.list, paths: elsewhere }).of("deepseek-v4.1-flash", NOW),
    ).toBeNull();
  });

  test("CC4: a bare target's own entry wins over a provider's same-named one", async () => {
    const paths = world("omniroute:deepseek-v4.1-flash");
    // The bare entry is the target itself; the prefixed one only shares its last segment.
    const fake = fakeList([
      { contextLength: 64_000, id: "deepseek/deepseek-v4.1-flash" },
      { contextLength: 1_000_000, id: "deepseek-v4.1-flash" },
    ]);
    expect(await windowWatch({ list: fake.list, paths }).of("deepseek-v4.1-flash", NOW)).toBe(
      1_000_000,
    );
    // With no bare entry nothing says which provider answered: the smallest window, so a crew
    // session hands off early, never late. (A fresh world: the first call kept this one's list.)
    const served = fakeList([
      { contextLength: 1_000_000, id: "ollama-cloud/deepseek-v4.1-flash" },
      { contextLength: 64_000, id: "deepseek/deepseek-v4.1-flash" },
    ]);
    expect(
      await windowWatch({ list: served.list, paths: world("omniroute:deepseek-v4.1-flash") }).of(
        "deepseek-v4.1-flash",
        NOW,
      ),
    ).toBe(64_000);
  });

  test("CC4: the kept list is read again after its day", async () => {
    const paths = world();
    const first = fakeList([{ contextLength: 200_000, id: "deepseek-v4.1-flash" }]);
    expect(await windowWatch({ list: first.list, paths }).of("deepseek-v4.1-flash", NOW)).toBe(
      200_000,
    );
    const second = fakeList([{ contextLength: 1_000_000, id: "deepseek-v4.1-flash" }]);
    expect(
      await windowWatch({ list: second.list, paths }).of(
        "deepseek-v4.1-flash",
        NOW + BACKEND_LIST_TTL_MS + 1,
      ),
    ).toBe(1_000_000);
    expect(second.calls).toHaveLength(1);
  });

  test("CC4: a list that fails gives no window, and is not asked again every poll", async () => {
    const paths = world();
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.resolve({ error: "down" });
    };
    const watch = windowWatch({ list: failing, paths });
    expect(await watch.of("deepseek-v4.1-flash", NOW)).toBeNull();
    expect(await watch.of("deepseek-v4.1-flash", NOW + 60_000)).toBeNull();
    expect(calls).toBe(1);
    // After the retry wait it is asked again.
    expect(await watch.of("deepseek-v4.1-flash", NOW + BACKEND_LIST_RETRY_MS + 1)).toBeNull();
    expect(calls).toBe(2);
  });

  test("CC4: a model with no listed window has none, and one no chain names has none either", async () => {
    const paths = world();
    const fake = fakeList([{ contextLength: null, id: "deepseek-v4.1-flash" }]);
    const watch = windowWatch({ list: fake.list, paths });
    expect(await watch.of("deepseek-v4.1-flash", NOW)).toBeNull();
    // No chain names this one, so there is no backend to ask.
    expect(await watch.of("some-other-model", NOW)).toBeNull();
    expect(fake.calls).toEqual(["http://127.0.0.1:9"]);
  });

  test("CC4: the bare name maps to the target that names it", () => {
    const parsed = parseConfig({
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
      slots: {
        "cc-smart-dev-kit-opus": ["claude-opus-5-5", "omniroute:deepseek-v4.1-flash"],
        "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash"],
      },
      version: 1,
    });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(backendForModel(parsed.config, "deepseek-v4.1-flash")).toEqual({
      backend: "omniroute",
      model: "deepseek-v4.1-flash",
    });
    expect(backendForModel(parsed.config, "glm-5.3-flash")?.backend).toBe("omniroute");
    expect(backendForModel(parsed.config, "claude-opus-5-5")).toBeNull();
    expect(backendForModel(parsed.config, "not-there")).toBeNull();
    // A catalog id names its target by its last segment too (this machine's real shape).
    const catalog = parseConfig({
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
      slots: { "cc-smart-dev-kit-worker": ["omniroute:ollama-cloud/deepseek-v4.1-flash"] },
      version: 1,
    });
    if ("error" in catalog) throw new Error(catalog.error);
    expect(backendForModel(catalog.config, "deepseek-v4.1-flash")).toEqual({
      backend: "omniroute",
      model: "ollama-cloud/deepseek-v4.1-flash",
    });
  });

  test("CC4: no gateway config means no backend window, and nothing is called", async () => {
    const paths = cliPaths({ HOME: tempDir("home") });
    mkdirSync(paths.stateDir, { recursive: true });
    const fake = fakeList([{ contextLength: 1_000_000, id: "deepseek-v4.1-flash" }]);
    expect(await windowWatch({ list: fake.list, paths }).of("deepseek-v4.1-flash", NOW)).toBeNull();
    expect(fake.calls).toEqual([]);
  });
});

/** The file a world writes is kept where the kit says (one home for the path). */
test("CC4: the kept files live in the state folder", () => {
  const paths = world();
  expect(claudeWindowFile(paths)).toBe(join(paths.stateDir, "context-window.json"));
  expect(backendWindowsFile(paths)).toBe(join(paths.stateDir, "backend-windows.json"));
});

describe("HO1: the point Claude Code compacts a crew session at", () => {
  const none = { percent: null, window: null };

  test("--autocompact auto with nothing set: the model's window less the 33 000 reserve", () => {
    expect(compactPointOf(1_000_000, none)).toBe(967_000);
    expect(compactPointOf(200_000, none)).toBe(167_000);
  });

  test("a window the kit cannot know and no variable: no point", () => {
    expect(compactPointOf(null, none)).toBeNull();
  });

  test("CLAUDE_CODE_AUTO_COMPACT_WINDOW holds the window down, and stands in for an unknown one", () => {
    expect(compactPointOf(1_000_000, { percent: null, window: 300_000 })).toBe(267_000);
    expect(compactPointOf(null, { percent: null, window: 300_000 })).toBe(267_000);
    // Above the model's window it is clamped to it, as Claude Code does.
    expect(compactPointOf(200_000, { percent: null, window: 900_000 })).toBe(167_000);
  });

  test("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE lowers the point to a share of the window, never raises it", () => {
    expect(compactPointOf(1_000_000, { percent: 50, window: null })).toBe(500_000);
    expect(compactPointOf(200_000, { percent: 99, window: null })).toBe(167_000);
  });
});
