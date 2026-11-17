import { expect, test } from "bun:test";
import { encodeCursorAddress, WaitBarrier, waitFacts } from "./command";
import { parseHerdrArgs } from "./words";

test("F1 finished event is any news; F2 lost leaves all barrier", () => {
  const a = new WaitBarrier("any");
  a.consume({
    terminals: [{ address: "t1", state: "live", status: { state: "working" }, turn: 1 }],
  });
  expect(
    a.consume({ method: "event", params: { type: "finished", terminal: "t1", data: {} } }),
  ).toBe(true);
  expect(a.news).toEqual([{ terminal: "t1", state: "finished", turn: null, status_ms: null }]);
  const b = new WaitBarrier("all");
  b.consume({
    terminals: [{ address: "t1", state: "live", status: { state: "working" }, turn: 1 }],
  });
  expect(b.consume({ method: "event", params: { type: "lost", terminal: "t1", data: {} } })).toBe(
    true,
  );
  expect(b.pending()).toEqual([]);
});
test("same null turn and state is already seen", () => {
  expect(
    waitFacts(
      { terminals: [{ address: "t1", state: "live", status: { state: "done" } }] },
      { t1: { turn: null, state: "done" } },
    ),
  ).toEqual([]);
});
const child = (address: string, state: string, turn: number) => ({
  address,
  state: "live",
  status: { state },
  turn,
});
test("seen turns suppress old done news but allow new turns", () => {
  expect(
    waitFacts({ terminals: [child("t1", "done", 3)] }, { t1: { turn: 3, state: "done" } }),
  ).toEqual([]);
  expect(
    waitFacts({ terminals: [child("t1", "done", 4)] }, { t1: { turn: 3, state: "done" } }),
  ).toEqual([{ terminal: "t1", state: "done", status_ms: null, turn: 4 }]);
});
test("a blocked child is the person's, not news: snapshot, event and both barriers", () => {
  expect(waitFacts({ terminals: [child("t1", "blocked", 3)] })).toEqual([]);
  expect(
    waitFacts({
      method: "event",
      params: { terminal: "t1", type: "status", data: { state: "blocked", turn: 3 } },
    }),
  ).toEqual([]);
  const any = new WaitBarrier("any", {}, "core/lead");
  expect(any.consume({ terminals: [child("t1", "working", 2)] })).toBe(false);
  expect(
    any.consume({
      method: "event",
      params: { terminal: "t1", type: "status", data: { state: "blocked", turn: 3 } },
    }),
  ).toBe(false);
  expect(
    any.consume({
      method: "event",
      params: { terminal: "t1", type: "status", data: { state: "done", turn: 3 } },
    }),
  ).toBe(true);
  expect(any.news).toEqual([{ terminal: "t1", state: "done", status_ms: null, turn: 3 }]);
  const all = new WaitBarrier("all", {}, "core/lead");
  expect(all.consume({ terminals: [child("t1", "blocked", 3)] })).toBe(false);
  expect(all.pending()).toEqual(["t1"]);
});
test("all ignores settled seen child, and relabel away leaves barrier", () => {
  const b = new WaitBarrier("all", { b: { turn: 3, state: "done" } }, "core/lead");
  expect(b.consume({ terminals: [child("a", "working", 1), child("b", "done", 3)] })).toBe(false);
  expect(
    b.consume({
      method: "event",
      params: { terminal: "a", type: "status", data: { state: "done", turn: 2 } },
    }),
  ).toBe(true);
  const c = new WaitBarrier("all", {}, "core/lead");
  expect(c.consume({ terminals: [child("a", "working", 1)] })).toBe(false);
  expect(
    c.consume({
      method: "event",
      params: { terminal: "a", type: "labels", data: { "kit.lead": "core/other" } },
    }),
  ).toBe(true);
});
test("seen parser replaces since and validates addresses and turns", () => {
  expect(
    parseHerdrArgs(["wait", "--all", "--seen", "t1:3:error,remote%2Ft2:?:end", "--timeout", "9"]),
  ).toEqual({
    verb: "wait",
    mode: "all",
    seen: { t1: { turn: 3, state: "error" }, "remote/t2": { turn: null, state: "end" } },
    timeoutMs: 9000,
  });
  // A 4.10.0 cursor's blocked entry is accepted and ignored.
  expect(parseHerdrArgs(["wait", "--seen", "t1:3:blocked,t2:4:done"])).toEqual({
    verb: "wait",
    mode: "any",
    seen: { t2: { turn: 4, state: "done" } },
  });
  expect(parseHerdrArgs(["wait", "--seen", "t1:bad"])).toHaveProperty("error");
});

test("state changes and stale higher cursor produce news, other event types do not", () => {
  expect(
    waitFacts({ terminals: [child("t1", "done", 3)] }, { t1: { turn: 3, state: "error" } }),
  ).toHaveLength(1);
  expect(
    waitFacts({ terminals: [child("t1", "done", 2)] }, { t1: { turn: 9, state: "done" } }),
  ).toHaveLength(1);
  expect(
    waitFacts({
      method: "event",
      params: { terminal: "t1", type: "title", data: child("t1", "done", 3) },
    }),
  ).toEqual([]);
});

test("encoded addresses and missing turns round trip", () => {
  for (const address of ["CAPS.Box/t1", "[2001:db8::1]/t2", "box,west/t3", "box!'()*/t4"]) {
    const parsed = parseHerdrArgs(["wait", "--seen", `${encodeCursorAddress(address)}:?:done`]);
    expect(parsed).toEqual({
      verb: "wait",
      mode: "any",
      seen: { [address]: { turn: null, state: "done" } },
    });
  }
  expect(parseHerdrArgs(["wait", "--seen", "%ZZ:?:done"])).toHaveProperty("error");
});
