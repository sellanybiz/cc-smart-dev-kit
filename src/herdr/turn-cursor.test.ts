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
  expect(waitFacts({ terminals: [child("t1", "blocked", 3)] }, { t1: 3 })).toEqual([]);
  expect(waitFacts({ terminals: [child("t1", "blocked", 4)] }, { t1: 3 })).toEqual([
    { terminal: "t1", state: "blocked", status_ms: null, turn: 4 },
  ]);
});
test("all ignores settled seen child, and relabel away leaves barrier", () => {
  const b = new WaitBarrier("all", { b: 3 }, "core/lead");
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
    parseHerdrArgs(["wait", "--all", "--seen", "t1:3,remote/t2:end", "--timeout", "9"]),
  ).toEqual({ verb: "wait", mode: "all", seen: { t1: 3, "remote/t2": "end" }, timeoutMs: 9000 });
  expect(parseHerdrArgs(["wait", "--seen", "t1:bad"])).toHaveProperty("error");
});
