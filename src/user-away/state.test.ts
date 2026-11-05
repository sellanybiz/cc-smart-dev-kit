import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  AwayStateError,
  awayStateFile,
  clearItems,
  forgetSaid,
  type ParkDraft,
  parkItem,
  readAway,
  sayOnce,
  setAvailable,
  setUnavailable,
  stopSayOnce,
} from "./state";

const T0 = Date.parse("2026-10-25T01:00:00.000Z");

function draft(over: Partial<ParkDraft> = {}): ParkDraft {
  return {
    kind: "question",
    text: "Which name?",
    command: null,
    tool: null,
    options: [],
    recommend: null,
    session: "s1",

    cwd: "/work/app",
    ...over,
  };
}

describe("the state: unavailable, then available", () => {
  test("a machine that never said anything is available, with an empty list", () => {
    const stateDir = tempDir("away");
    expect(readAway(stateDir)).toEqual({
      unavailable: false,
      since: null,
      until: null,
      items: [],
      nextId: 1,
      said: {},
      stopSaid: {},
    });
    expect(existsSync(awayStateFile(stateDir))).toBe(false);
  });

  test("unavailable records since when and the expected return; available puts the state back and keeps the list", async () => {
    const stateDir = tempDir("away");
    const until = "2026-10-25T05:00:00.000Z";
    const gone = await setUnavailable(stateDir, T0, until);
    expect(gone.unavailable).toBe(true);
    expect(gone.since).toBe("2026-10-25T01:00:00.000Z");
    expect(gone.until).toBe(until);
    await parkItem(stateDir, draft(), T0 + 1000);

    const back = await setAvailable(stateDir);
    expect(back.unavailable).toBe(false);
    expect(back.since).toBeNull();
    expect(back.until).toBeNull();
    // What was parked is still there: the person answers it after the state is back.
    expect(back.items.map((item) => item.text)).toEqual(["Which name?"]);
    expect(readAway(stateDir).unavailable).toBe(false);
  });

  test("unavailable again while unavailable keeps the first since and takes the new return time", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    const again = await setUnavailable(stateDir, T0 + 3_600_000, "2026-10-25T09:00:00.000Z");
    expect(again.since).toBe("2026-10-25T01:00:00.000Z");
    expect(again.until).toBe("2026-10-25T09:00:00.000Z");
  });

  test("the file is the person's alone: mode 0600", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    expect(statSync(awayStateFile(stateDir)).mode & 0o777).toBe(0o600);
  });

  test("a broken file is named, never read as available", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    writeFileSync(awayStateFile(stateDir), "{ not json");
    expect(() => readAway(stateDir)).toThrow(AwayStateError);
    await expect(setAvailable(stateDir)).rejects.toThrow(AwayStateError);
  });
});

describe("parking", () => {
  test("a question, an action and a decision each keep their kind, who parked it and when", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    const question = await parkItem(
      stateDir,
      draft({ options: ["A", "B"], recommend: 2, session: "s1" }),
      T0 + 1000,
    );
    const action = await parkItem(
      stateDir,
      draft({
        kind: "action",
        text: "Push the branch",
        command: "git push origin fix/x",
        tool: "Bash",
        session: "s2",
      }),
      T0 + 2000,
    );
    const decision = await parkItem(
      stateDir,
      draft({ kind: "decision", text: "Chose B because it is easy to undo. Undo: revert abc123." }),
      T0 + 3000,
    );
    expect(question.item).toEqual({
      id: 1,
      kind: "question",
      text: "Which name?",
      command: null,
      tool: null,
      options: ["A", "B"],
      recommend: 2,
      session: "s1",

      cwd: "/work/app",
      at: "2026-10-25T01:00:01.000Z",
    });
    expect(action.item.id).toBe(2);
    expect(action.item.command).toBe("git push origin fix/x");
    expect(action.item.tool).toBe("Bash");
    expect(decision.item.id).toBe(3);
    expect(readAway(stateDir).items.map((item) => item.kind)).toEqual([
      "question",
      "action",
      "decision",
    ]);
  });

  test("two sessions parking at once: both items are kept, each with its own id", async () => {
    const stateDir = tempDir("away");
    const parked = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        parkItem(stateDir, draft({ text: `question ${index}`, session: `s${index}` }), T0 + index),
      ),
    );
    const items = readAway(stateDir).items;
    expect(items).toHaveLength(8);
    expect(new Set(items.map((item) => item.id)).size).toBe(8);
    expect(new Set(items.map((item) => item.text)).size).toBe(8);
    expect(parked.every((one) => one.added)).toBe(true);
  });

  test("the same command parked again (a session retries) stays one item", async () => {
    const stateDir = tempDir("away");
    const first = await parkItem(
      stateDir,
      draft({ kind: "action", text: "ask", command: "git push", tool: "Bash" }),
      T0,
    );
    const second = await parkItem(
      stateDir,
      draft({ kind: "action", text: "ask", command: "git push", tool: "Bash", session: "s9" }),
      T0 + 5,
    );
    expect(second.added).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(readAway(stateDir).items).toHaveLength(1);
  });

  test("the same command from another folder is another item: a yes runs it in its own cwd", async () => {
    const stateDir = tempDir("away");
    const action = { kind: "action", text: "ask", command: "git push -u origin HEAD" } as const;
    const first = await parkItem(stateDir, draft({ ...action, cwd: "/work/app-wt-a" }), T0);
    const second = await parkItem(stateDir, draft({ ...action, cwd: "/work/app-wt-b" }), T0 + 5);
    expect(second.added).toBe(true);
    expect(second.item.id).not.toBe(first.item.id);
    expect(readAway(stateDir).items.map((item) => item.cwd)).toEqual([
      "/work/app-wt-a",
      "/work/app-wt-b",
    ]);
  });

  test("a decision with the same words as an action is another item", async () => {
    const stateDir = tempDir("away");
    await parkItem(stateDir, draft({ kind: "action", text: "same", command: "x" }), T0);
    await parkItem(stateDir, draft({ kind: "decision", text: "same", command: "x" }), T0);
    expect(readAway(stateDir).items).toHaveLength(2);
  });

  test("ids never go back: one cleared, the next is still new", async () => {
    const stateDir = tempDir("away");
    await parkItem(stateDir, draft({ text: "a" }), T0);
    await clearItems(stateDir, [1]);
    const next = await parkItem(stateDir, draft({ text: "b" }), T0);
    expect(next.item.id).toBe(2);
  });
});

describe("clearing", () => {
  test("named ids go, the others stay, and a missing id is reported", async () => {
    const stateDir = tempDir("away");
    for (const text of ["a", "b", "c"]) await parkItem(stateDir, draft({ text }), T0);
    const result = await clearItems(stateDir, [1, 3, 9]);
    expect(result).toEqual({ removed: [1, 3], missing: [9] });
    expect(readAway(stateDir).items.map((item) => item.text)).toEqual(["b"]);
  });

  test("all empties the list and keeps the state", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    await parkItem(stateDir, draft(), T0);
    const result = await clearItems(stateDir, "all");
    expect(result.removed).toEqual([1]);
    const state = readAway(stateDir);
    expect(state.items).toEqual([]);
    expect(state.unavailable).toBe(true);
  });
});

describe("saying a note once", () => {
  test("a session hears a key once, and again when the key changes", async () => {
    const stateDir = tempDir("away");
    expect(await sayOnce(stateDir, "s1", "a|0")).toBe(true);
    expect(await sayOnce(stateDir, "s1", "a|0")).toBe(false);
    expect(await sayOnce(stateDir, "s1", "a|1")).toBe(true);
    // Another session has its own record.
    expect(await sayOnce(stateDir, "s2", "a|1")).toBe(true);
  });

  test("the record keeps the newest sessions only", async () => {
    const stateDir = tempDir("away");
    for (let index = 0; index < 120; index += 1) await sayOnce(stateDir, `s${index}`, "k");
    const kept = Object.keys(readAway(stateDir).said);
    expect(kept).toHaveLength(100);
    expect(kept).not.toContain("s0");
    expect(kept).toContain("s119");
  });

  test("available keeps what was said, so each session can be told once that it is over", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    await sayOnce(stateDir, "s1", "k");
    await setAvailable(stateDir);
    expect(readAway(stateDir).said).toEqual({ s1: "k" });
    expect(await forgetSaid(stateDir, "s1")).toBe(true);
    expect(await forgetSaid(stateDir, "s1")).toBe(false);
    expect(await forgetSaid(stateDir, "never")).toBe(false);
    expect(readAway(stateDir).said).toEqual({});
  });

  test("a note heard at the turn end has its own mark, and forgetting covers it too", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    expect(await stopSayOnce(stateDir, "s1", "k")).toBe(true);
    expect(await stopSayOnce(stateDir, "s1", "k")).toBe(false);
    expect(readAway(stateDir).said).toEqual({});
    expect(readAway(stateDir).stopSaid).toEqual({ s1: "k" });
    await setAvailable(stateDir);
    // Told only at its turn end, the session is still told once that the person is back.
    expect(await forgetSaid(stateDir, "s1")).toBe(true);
    expect(readAway(stateDir).stopSaid).toEqual({});
    expect(await forgetSaid(stateDir, "s1")).toBe(false);
  });

  test("a file written before the turn-end mark existed still reads, with none", () => {
    const stateDir = tempDir("away");
    const file = awayStateFile(stateDir);
    mkdirSync(join(stateDir, "user-away"), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        unavailable: true,
        since: "a",
        until: null,
        items: [],
        nextId: 1,
        said: { s1: "k" },
      }),
    );
    expect(readAway(stateDir).stopSaid).toEqual({});
    expect(readAway(stateDir).said).toEqual({ s1: "k" });
  });
});

describe("the file on disk", () => {
  test("holds the state and the list as plain JSON a person can read", async () => {
    const stateDir = tempDir("away");
    await setUnavailable(stateDir, T0, null);
    await parkItem(stateDir, draft({ text: "one" }), T0);
    const text = readFileSync(join(stateDir, "user-away", "state.json"), "utf8");
    expect(JSON.parse(text).items[0].text).toBe("one");
  });
});
