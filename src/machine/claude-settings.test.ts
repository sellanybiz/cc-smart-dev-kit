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
