import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { createHistoryWriter, type HistoryRow } from "./history";
import { lastAnswer } from "./history-read";

const NOW = Date.now();
function file(): string {
  return join(tempDir("answer-history"), "history.db");
}
function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    at: NOW,
    breaker: null,
    cost: null,
    model: "claude-sonnet-5-5",
    ms: 1,
    nextTarget: null,
    profile: null,
    session: "session-1",
    slot: "cc-smart-dev-kit-worker",
    status: 200,
    target: "claude-sonnet-5-5",
    tokens: null,
    ...overrides,
  };
}
function seed(rows: HistoryRow[]) {
  const path = file();
  const writer = createHistoryWriter({
    file: path,
    flushAfterMs: 60_000,
    log: () => {},
    retentionDays: () => 90,
  });
  for (const entry of rows) writer.record(entry);
  writer.flush();
  writer.close();
  return path;
}
describe("the status row's last answer", () => {
  it("separates main, agent, profile and model, normalizes [1m], and skips failures", () => {
    const path = seed([
      row({ target: "omniroute:gpt-6.1-sol" }),
      row({ agent: "agent-1", target: "omniroute:agent" }),
      row({ profile: "other", target: "omniroute:profile" }),
      row({ model: "claude-haiku-5-5", target: "omniroute:side" }),
      row({ status: 502, target: "omniroute:failed" }),
      row({ outcome: "refused" }),
      row({ outcome: "stream_error" }),
    ]);
    expect(lastAnswer(path, "session-1", null, null, "claude-sonnet-5-5[1m]")).toEqual({
      at: NOW,
      model: "claude-sonnet-5-5",
      slot: "cc-smart-dev-kit-worker",
      target: "omniroute:gpt-6.1-sol",
    });
    expect(lastAnswer(path, "session-1", "agent-1", null)?.target).toBe("omniroute:agent");
    expect(lastAnswer(path, "session-1", null, "other", "claude-sonnet-5-5")?.target).toBe(
      "omniroute:profile",
    );
    expect(lastAnswer(path, "session-1", null, null, "claude-opus-5-5")).toBeNull();
    expect(lastAnswer(path, "session-1", "not-yet", null)).toBeNull();
  });
  it("returns null for missing files and files without agent, and reads files without outcome", () => {
    expect(lastAnswer(file(), "s", null, null, "m")).toBeNull();
    const path = seed([row()]);
    const old = new Database(path);
    old.run("ALTER TABLE requests DROP COLUMN outcome");
    expect(lastAnswer(path, "session-1", null, null, "claude-sonnet-5-5")?.target).toBe(
      "claude-sonnet-5-5",
    );
    old.run("ALTER TABLE requests DROP COLUMN agent");
    expect(lastAnswer(path, "session-1", null, null, "claude-sonnet-5-5")).toBeNull();
    old.close();
  });
  it("adds columns to schema 2 without a version bump and keeps old named inserts working", () => {
    const path = seed([row()]);
    const old = new Database(path);
    old.run("ALTER TABLE requests DROP COLUMN outcome");
    old.run("ALTER TABLE requests DROP COLUMN agent");
    old.close(true);
    const writer = createHistoryWriter({
      file: path,
      flushAfterMs: 60_000,
      log: () => {},
      retentionDays: () => 90,
    });
    writer.record(row({ agent: "agent-new", outcome: "refused" }));
    writer.close();
    const db = new Database(path);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    db.run(
      "INSERT INTO requests (at, session, model, target, status, ms) VALUES (1, 'old-session', 'm', 'm', 200, 1)",
    );
    expect(
      db.query("SELECT agent, outcome FROM requests WHERE session = 'old-session'").get(),
    ).toEqual({ agent: null, outcome: null });
    expect(db.query("SELECT agent, outcome FROM requests WHERE agent = 'agent-new'").get()).toEqual(
      { agent: "agent-new", outcome: "refused" },
    );
    db.close(true);
  });
  it("does not wait on an exclusive lock", () => {
    const path = file();
    const locked = new Database(path);
    locked.run("CREATE TABLE requests (session TEXT, agent TEXT, outcome TEXT)");
    locked.run("BEGIN EXCLUSIVE");
    try {
      const start = performance.now();
      expect(lastAnswer(path, "session-1", null, null, "claude-sonnet-5-5")).toBeNull();
      expect(performance.now() - start).toBeLessThan(200);
    } finally {
      locked.run("ROLLBACK");
      locked.close();
    }
  });
  it("reads 10k session rows with one indexed answer query per tick", () => {
    const path = seed(
      Array.from({ length: 10_000 }, (_, i) => row({ agent: i === 0 ? null : "agent-1" })),
    );
    const start = performance.now();
    expect(lastAnswer(path, "session-1", null, null, "claude-sonnet-5-5")?.target).toBe(
      "claude-sonnet-5-5",
    );
    const ms = performance.now() - start;
    console.log(`lastAnswer 10k rows: ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(200);
  });
});
