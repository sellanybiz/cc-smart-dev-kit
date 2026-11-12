import { expect, test } from "bun:test";
import { WaitBarrier, waitFacts } from "./command";
import { parseHerdrArgs } from "./words";

const child = (address: string, state: string, turn: number) => ({
  address,
  state: "live",
  status: { state },
  turn,
});
test("seen turns suppress old blocked news but allow new turns", () => {
  expect(
    waitFacts({ terminals: [child("t1", "blocked", 3)] }, { t1: { turn: 3, state: "blocked" } }),
  ).toEqual([]);
  expect(
    waitFacts({ terminals: [child("t1", "blocked", 4)] }, { t1: { turn: 3, state: "blocked" } }),
  ).toEqual([{ terminal: "t1", state: "blocked", status_ms: null, turn: 4 }]);
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
    parseHerdrArgs(["wait", "--all", "--seen", "t1:3:blocked,remote%2Ft2:?:end", "--timeout", "9"]),
  ).toEqual({
    verb: "wait",
    mode: "all",
    seen: { t1: { turn: 3, state: "blocked" }, "remote/t2": { turn: null, state: "end" } },
    timeoutMs: 9000,
  });
  expect(parseHerdrArgs(["wait", "--seen", "t1:bad"])).toHaveProperty("error");
});

test("state changes and stale higher cursor produce news, other event types do not", () => {
  expect(
    waitFacts({ terminals: [child("t1", "done", 3)] }, { t1: { turn: 3, state: "blocked" } }),
  ).toHaveLength(1);
  expect(
    waitFacts({ terminals: [child("t1", "blocked", 2)] }, { t1: { turn: 9, state: "blocked" } }),
  ).toHaveLength(1);
  expect(
    waitFacts({
      method: "event",
      params: { terminal: "t1", type: "title", data: child("t1", "blocked", 3) },
    }),
  ).toEqual([]);
});

test("encoded addresses and missing turns round trip", () => {
  for (const address of ["CAPS.Box/t1", "[2001:db8::1]/t2", "box,west/t3"]) {
    const parsed = parseHerdrArgs(["wait", "--seen", `${encodeURIComponent(address)}:?:blocked`]);
    expect(parsed).toEqual({
      verb: "wait",
      mode: "any",
      seen: { [address]: { turn: null, state: "blocked" } },
    });
  }
  expect(parseHerdrArgs(["wait", "--seen", "%ZZ:?:done"])).toHaveProperty("error");
});
