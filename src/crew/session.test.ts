/**
 * Who calls a `crew` command (`session.ts`): a crew session named in its environment, or the nearest
 * ancestor process with a Claude Code session record (proved live, L1a.1 P13).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  CREW_ENV,
  callingSession,
  crewIdOf,
  realProcessFacts,
  SessionRecordError,
  sessionRecordFile,
} from "./session";

/** A parent reader over a fixed tree: child pid → parent pid. */
function tree(parents: Record<number, number>): (pid: number) => null | number {
  return (pid) => parents[pid] ?? null;
}

/** Writes Claude Code's record of session `pid` into `config`'s sessions folder. */
function record(config: string, pid: number, fields: Record<string, unknown>): void {
  mkdirSync(join(config, "sessions"), { recursive: true });
  writeFileSync(sessionRecordFile(config, pid), JSON.stringify({ pid, ...fields }));
}

describe("a crew session is named in its own environment", () => {
  test("the variable's value is its id; unset or blank is no crew session", () => {
    expect(CREW_ENV).toBe("CC_SMART_DEV_KIT_CREW");
    expect(crewIdOf({ CC_SMART_DEV_KIT_CREW: "B6b-portal-live-1a2b3c" })).toBe(
      "B6b-portal-live-1a2b3c",
    );
    expect(crewIdOf({ CC_SMART_DEV_KIT_CREW: "  " })).toBeNull();
    expect(crewIdOf({})).toBeNull();
  });
});

describe("the calling session", () => {
  test("the nearest ancestor with a session record, past the shell and the launcher", () => {
    const config = tempDir("config");
    // 500 (this command) ← 400 (sh launcher) ← 300 (the Bash tool's shell) ← 200 (the session)
    // ← 100 (an outer session that started a terminal): the nearest one is the session.
    record(config, 200, { cwd: "/home/user/my-app", name: "lead", sessionId: "s-200" });
    record(config, 100, { cwd: "/home/user", name: "outer", sessionId: "s-100" });
    const found = callingSession(config, 500, tree({ 500: 400, 400: 300, 300: 200, 200: 100 }));
    expect(found).toEqual({ cwd: "/home/user/my-app", name: "lead", pid: 200, sessionId: "s-200" });
  });

  test("outside Claude Code no ancestor has a record: null", () => {
    const config = tempDir("config");
    expect(callingSession(config, 500, tree({ 500: 400, 400: 1 }))).toBeNull();
  });

  test("a loop in bad data ends the walk", () => {
    const config = tempDir("config");
    expect(callingSession(config, 5, tree({ 5: 6, 6: 7, 7: 6 }))).toBeNull();
  });

  test("the nearest record that does not read stops the walk: never an outer session", () => {
    const config = tempDir("config");
    mkdirSync(join(config, "sessions"), { recursive: true });
    writeFileSync(sessionRecordFile(config, 200), "{ not json");
    record(config, 100, { cwd: "/home/user", name: "outer", sessionId: "s-100" });
    expect(() => callingSession(config, 300, tree({ 300: 200, 200: 100 }))).toThrow(
      new SessionRecordError(
        `the session record ${join(config, "sessions", "200.json")} cannot be read, so the session that runs this command is unknown`,
      ),
    );
  });

  test("a record that names another pid is not this process's record", () => {
    const config = tempDir("config");
    mkdirSync(join(config, "sessions"), { recursive: true });
    writeFileSync(
      sessionRecordFile(config, 200),
      JSON.stringify({ cwd: "/x", name: "n", pid: 999, sessionId: "s" }),
    );
    expect(() => callingSession(config, 300, tree({ 300: 200 }))).toThrow(SessionRecordError);
  });

  test("Linux: the real reader walks /proc up to this test's own parent", () => {
    if (process.platform !== "linux") return;
    const facts = realProcessFacts("linux");
    expect(facts.parentOf(process.pid)).toBe(process.ppid);
    expect(facts.commandLineOf(process.pid)).toContain("test");
    expect(facts.parentOf(2 ** 30)).toBeNull();
    expect(facts.commandLineOf(2 ** 30)).toBeNull();
  });
});
