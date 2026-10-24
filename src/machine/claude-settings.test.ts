/**
 * Claude Code's auto-compact variables (`claude-settings.ts`): read-only, from the process
 * environment and the `env` block of the three settings files that apply to a folder.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  AUTOCOMPACT_MAX_TOKENS,
  AUTOCOMPACT_MIN_TOKENS,
  compactEnvOf,
  parseCompactWindow,
} from "./claude-settings";

function write(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

describe("the window variable's value", () => {
  test("a number, or a number with k or M, as Claude Code reads it", () => {
    expect(parseCompactWindow("300000")).toBe(300_000);
    expect(parseCompactWindow("300k")).toBe(300_000);
    expect(parseCompactWindow(" 300K ")).toBe(300_000);
    expect(parseCompactWindow("1M")).toBe(1_000_000);
    expect(parseCompactWindow("0.5M")).toBe(500_000);
  });

  test("a value out of range is held at the nearest end, as Claude Code does", () => {
    expect(parseCompactWindow("50k")).toBe(AUTOCOMPACT_MIN_TOKENS);
    expect(parseCompactWindow("200")).toBe(AUTOCOMPACT_MIN_TOKENS);
    expect(parseCompactWindow("5M")).toBe(AUTOCOMPACT_MAX_TOKENS);
  });

  test("anything else is ignored", () => {
    for (const bad of ["", "auto", "abc", "-5", "12x"]) {
      expect(`${bad}: ${parseCompactWindow(bad)}`).toBe(`${bad}: null`);
    }
  });
});

describe("what applies to a folder", () => {
  test("nothing set: no window, no percent", () => {
    const config = tempDir("compact-config");
    const project = tempDir("compact-project");
    expect(compactEnvOf({ configDir: config, env: {}, projectFolder: project })).toEqual({
      percent: null,
      window: null,
    });
  });

  test("the process environment", () => {
    const config = tempDir("compact-config");
    const project = tempDir("compact-project");
    expect(
      compactEnvOf({
        configDir: config,
        env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "60", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300k" },
        projectFolder: project,
      }),
    ).toEqual({ percent: 60, window: 300_000 });
  });

  test("the env block of the user, project and local settings: the smallest window wins", () => {
    const config = tempDir("compact-config");
    const project = tempDir("compact-project");
    write(join(config, "settings.json"), { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" } });
    write(join(project, ".claude", "settings.json"), {
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "400k" },
    });
    write(join(project, ".claude", "settings.local.json"), {
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 350_000, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "80" },
    });
    expect(
      compactEnvOf({
        configDir: config,
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "900k" },
        projectFolder: project,
      }),
    ).toEqual({ percent: 80, window: 350_000 });
  });

  test("the modelSettings of the person's settings do not count: --autocompact auto skips them", () => {
    const config = tempDir("compact-config");
    const project = tempDir("compact-project");
    write(join(config, "settings.json"), {
      autoCompactWindow: 300_000,
      modelSettings: { "claude-opus-5-5": { autoCompactWindow: 400_000 } },
    });
    expect(compactEnvOf({ configDir: config, env: {}, projectFolder: project }).window).toBeNull();
  });

  test("a settings file that is broken, or has no env, is skipped", () => {
    const config = tempDir("compact-config");
    const project = tempDir("compact-project");
    write(join(config, "settings.json"), "{ not json");
    write(join(project, ".claude", "settings.json"), { env: "nope" });
    write(join(project, ".claude", "settings.local.json"), []);
    expect(compactEnvOf({ configDir: config, env: {}, projectFolder: project })).toEqual({
      percent: null,
      window: null,
    });
  });

  test("a percent outside 1-100 is ignored", () => {
    const config = tempDir("compact-config");
    const project = tempDir("compact-project");
    for (const bad of ["0", "101", "x"]) {
      expect(
        compactEnvOf({
          configDir: config,
          env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: bad },
          projectFolder: project,
        }).percent,
      ).toBeNull();
    }
  });
});
