/**
 * Claude Code's auto-compact variables (`claude-settings.ts`): read-only, from the process
 * environment and the `env` block of the settings files that apply to a session, in Claude
 * Code's own order.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  AUTOCOMPACT_MAX_TOKENS,
  AUTOCOMPACT_MIN_TOKENS,
  compactEnvOf,
  compactWindowsOf,
  mainCheckoutOfFolder,
  parseCompactPercent,
  parseCompactWindow,
} from "./claude-settings";

function write(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

describe("the window variable's value, read as Claude Code 2.1.310 reads it", () => {
  test("a number, or a number with k or M", () => {
    expect(parseCompactWindow("300000")).toBe(300_000);
    expect(parseCompactWindow("300k")).toBe(300_000);
    expect(parseCompactWindow(" 300K ")).toBe(300_000);
    expect(parseCompactWindow("1M")).toBe(1_000_000);
    expect(parseCompactWindow("0.5M")).toBe(500_000);
  });

  test("grouped digits, scientific notation, a sign and trailing text are numbers too", () => {
    expect(parseCompactWindow("400,000")).toBe(400_000);
    expect(parseCompactWindow("400 000")).toBe(400_000);
    expect(parseCompactWindow("1_000_000")).toBe(1_000_000);
    expect(parseCompactWindow("3e5")).toBe(300_000);
    expect(parseCompactWindow("+300000")).toBe(300_000);
    expect(parseCompactWindow("300000abc")).toBe(300_000);
  });

  test("a value out of range is held at the nearest end", () => {
    expect(parseCompactWindow("50k")).toBe(AUTOCOMPACT_MIN_TOKENS);
    expect(parseCompactWindow("200")).toBe(AUTOCOMPACT_MIN_TOKENS);
    expect(parseCompactWindow("12x")).toBe(AUTOCOMPACT_MIN_TOKENS);
    expect(parseCompactWindow("5M")).toBe(AUTOCOMPACT_MAX_TOKENS);
  });

  test("below 1, or no number, is no value", () => {
    for (const bad of ["", "auto", "abc", "-5", "0", "0k", "0.5"]) {
      expect(`${bad}: ${parseCompactWindow(bad)}`).toBe(`${bad}: null`);
    }
  });
});

describe("the percent variable's value", () => {
  test("above 0 and up to 100, read with parseFloat", () => {
    expect(parseCompactPercent("60")).toBe(60);
    expect(parseCompactPercent("50%")).toBe(50);
    expect(parseCompactPercent("0.5")).toBe(0.5);
    for (const bad of ["0", "101", "-3", "x", ""]) {
      expect(`${bad}: ${parseCompactPercent(bad)}`).toBe(`${bad}: null`);
    }
  });
});

describe("what applies to a session", () => {
  /** A main checkout, a linked worktree beside it, and a config folder. */
  function world() {
    const main = tempDir("compact-main");
    const worktree = tempDir("compact-worktree");
    const config = tempDir("compact-config");
    const read = (env: Record<string, string> = {}) =>
      compactEnvOf({ configDir: config, env, mainCheckout: main, projectFolder: worktree });
    const set = (file: string, variable: string, value: string | number) =>
      write(file, { env: { [variable]: value } });
    return {
      config: join(config, "settings.json"),
      mainLocal: join(main, ".claude", "settings.local.json"),
      read,
      set,
      worktreeLocal: join(worktree, ".claude", "settings.local.json"),
      worktreeShared: join(worktree, ".claude", "settings.json"),
    };
  }
  const WINDOW = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
  const PERCENT = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";

  test("nothing set: no window, no percent", () => {
    expect(world().read()).toEqual({ percent: null, window: null });
  });

  test("the process environment", () => {
    expect(world().read({ [PERCENT]: "60", [WINDOW]: "300k" })).toEqual({
      percent: 60,
      window: 300_000,
    });
  });

  test("the first source that sets it decides: main local, worktree local, worktree shared, user, shell", () => {
    const w = world();
    const shell = { [WINDOW]: "900k" };
    w.set(w.config, WINDOW, "800k");
    expect(w.read(shell).window).toBe(800_000);
    w.set(w.worktreeShared, WINDOW, "700000");
    expect(w.read(shell).window).toBe(700_000);
    w.set(w.worktreeLocal, WINDOW, 600_000);
    expect(w.read(shell).window).toBe(600_000);
    // The main checkout's local file is read for every worktree, and wins over the rest — even
    // with a larger value than the others: it is the order that decides, not the size.
    w.set(w.mainLocal, WINDOW, "950k");
    expect(w.read(shell).window).toBe(950_000);
  });

  test("each variable is decided on its own", () => {
    const w = world();
    w.set(w.mainLocal, PERCENT, "80");
    w.set(w.worktreeLocal, WINDOW, "400k");
    expect(w.read({ [WINDOW]: "200k", [PERCENT]: "10" })).toEqual({ percent: 80, window: 400_000 });
  });

  test("a source that sets an unusable value decides: Claude Code ignores it and looks no further", () => {
    const w = world();
    w.set(w.worktreeLocal, WINDOW, "auto");
    expect(w.read({ [WINDOW]: "300k" }).window).toBeNull();
  });

  test("the modelSettings of the person's settings do not count: --autocompact auto skips them", () => {
    const w = world();
    write(w.config, {
      autoCompactWindow: 300_000,
      modelSettings: { "claude-opus-5-5": { autoCompactWindow: 400_000 } },
    });
    expect(w.read().window).toBeNull();
  });

  test("a settings file that is broken, has no env, or holds a byte order mark", () => {
    const w = world();
    write(w.config, "{ not json");
    write(w.worktreeShared, { env: "nope" });
    write(w.worktreeLocal, []);
    expect(w.read()).toEqual({ percent: null, window: null });
    write(w.mainLocal, `\uFEFF${JSON.stringify({ env: { [WINDOW]: "300k" } })}`);
    expect(w.read().window).toBe(300_000);
  });
});

describe("the main checkout of a folder, found without git (SL1)", () => {
  test("a checkout's own root, from a folder inside it", () => {
    const root = tempDir("main-root");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    expect(mainCheckoutOfFolder(join(root, "src", "deep"))).toBe(root);
  });

  test("a linked worktree: the folder that holds the .git folder its .git file names", () => {
    const main = tempDir("main-of-wt");
    const worktree = tempDir("the-wt");
    mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
    write(join(worktree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
    mkdirSync(join(worktree, "sub"), { recursive: true });
    expect(mainCheckoutOfFolder(join(worktree, "sub"))).toBe(main);
  });

  test("a .git file that names something else, or no checkout at all: that folder itself", () => {
    const submodule = tempDir("submodule");
    write(join(submodule, ".git"), "gitdir: ../.git/modules/x\n");
    expect(mainCheckoutOfFolder(submodule)).toBe(submodule);
    const loose = tempDir("loose");
    expect(mainCheckoutOfFolder(loose)).toBe(loose);
  });
});

describe("the autoCompactWindow keys of a normal session (SL1)", () => {
  const OPUS = "claude-opus-5-5";
  function world() {
    const main = tempDir("keys-main");
    const worktree = tempDir("keys-worktree");
    const config = tempDir("keys-config");
    return {
      config: join(config, "settings.json"),
      mainLocal: join(main, ".claude", "settings.local.json"),
      read: (model: string, env: Record<string, string> = {}) =>
        compactWindowsOf(
          { configDir: config, env, mainCheckout: main, projectFolder: worktree },
          model,
        ),
      worktreeLocal: join(worktree, ".claude", "settings.local.json"),
      worktreeShared: join(worktree, ".claude", "settings.json"),
    };
  }

  test("a per-model window (the one /autocompact saves)", () => {
    const w = world();
    write(w.config, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(w.read(OPUS).settings).toBe(400_000);
    // Another model has none.
    expect(w.read("claude-sonnet-5-5").settings).toBeNull();
  });

  test("an id with the [1m] suffix, or in capitals, finds the same entry", () => {
    const w = world();
    write(w.config, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(w.read(`${OPUS}[1m]`).settings).toBe(400_000);
    expect(w.read(" Claude-Opus-5-5[1M] ").settings).toBe(400_000);
  });

  test("the top-level key is the fallback; a model's own entry wins over it", () => {
    const w = world();
    write(w.config, {
      autoCompactWindow: 300_000,
      modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } },
    });
    expect(w.read(OPUS).settings).toBe(400_000);
    expect(w.read("claude-sonnet-5-5").settings).toBe(300_000);
  });

  test('"auto" in a model entry means the model\'s own window, even under a top-level number', () => {
    const w = world();
    write(w.config, {
      autoCompactWindow: 300_000,
      modelSettings: { [OPUS]: { autoCompactWindow: "auto" } },
    });
    expect(w.read(OPUS).settings).toBeNull();
    expect(w.read("claude-sonnet-5-5").settings).toBe(300_000);
  });

  test("a project's files override the person's, local over shared, as Claude Code merges them", () => {
    const w = world();
    write(w.config, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(w.read(OPUS).settings).toBe(400_000);
    write(w.worktreeShared, { modelSettings: { [OPUS]: { autoCompactWindow: 500_000 } } });
    expect(w.read(OPUS).settings).toBe(500_000);
    write(w.worktreeLocal, { modelSettings: { [OPUS]: { autoCompactWindow: 600_000 } } });
    expect(w.read(OPUS).settings).toBe(600_000);
    write(w.mainLocal, { modelSettings: { [OPUS]: { autoCompactWindow: 700_000 } } });
    expect(w.read(OPUS).settings).toBe(700_000);
  });

  test("a higher file that sets the top-level key drops the lower files' per-model entries", () => {
    const w = world();
    write(w.config, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    write(w.worktreeLocal, { autoCompactWindow: 250_000 });
    expect(w.read(OPUS).settings).toBe(250_000);
  });

  test("a value out of range, not a whole number, or a text other than auto is no value", () => {
    const w = world();
    for (const bad of [99_999, 1_000_001, 400_000.5, "400k", true, null]) {
      write(w.config, {
        autoCompactWindow: bad,
        modelSettings: { [OPUS]: { autoCompactWindow: bad } },
      });
      expect(`${String(bad)}: ${w.read(OPUS).settings}`).toBe(`${String(bad)}: null`);
    }
    write(w.config, { autoCompactWindow: AUTOCOMPACT_MIN_TOKENS });
    expect(w.read(OPUS).settings).toBe(AUTOCOMPACT_MIN_TOKENS);
    write(w.config, { autoCompactWindow: AUTOCOMPACT_MAX_TOKENS });
    expect(w.read(OPUS).settings).toBe(AUTOCOMPACT_MAX_TOKENS);
  });

  test("a file that is not valid JSON, or has the wrong shape, sets nothing", () => {
    const w = world();
    write(w.config, "{ not json");
    write(w.worktreeShared, { modelSettings: "nope" });
    write(w.worktreeLocal, { modelSettings: { [OPUS]: 5 } });
    expect(w.read(OPUS)).toEqual({ env: { percent: null, window: null }, settings: null });
  });

  test("the environment variables come from the same read", () => {
    const w = world();
    write(w.config, { modelSettings: { [OPUS]: { autoCompactWindow: 400_000 } } });
    expect(w.read(OPUS, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300k" })).toEqual({
      env: { percent: null, window: 300_000 },
      settings: 400_000,
    });
  });
});
