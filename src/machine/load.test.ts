/** The load reading (`load.ts`): the 1-minute average over the cores; none on native Windows. */
import { describe, expect, test } from "bun:test";
import { type LoadFacts, loadLimit, machineLoad } from "./load";

const facts = (change: Partial<LoadFacts> = {}): LoadFacts => ({
  cores: () => 16,
  loadavg: () => [85, 60, 30],
  platform: "linux",
  ...change,
});

describe("machineLoad", () => {
  test("the 1-minute average and the cores", () => {
    expect(machineLoad(facts())).toEqual({ cores: 16, oneMinute: 85 });
  });

  test("native Windows gives no reading, whatever loadavg says", () => {
    expect(machineLoad(facts({ platform: "win32" }))).toBeNull();
  });

  test("a reading that is no number, or no cores, is no reading", () => {
    expect(machineLoad(facts({ loadavg: () => [] }))).toBeNull();
    expect(machineLoad(facts({ loadavg: () => [Number.NaN, 0, 0] }))).toBeNull();
    expect(machineLoad(facts({ cores: () => 0 }))).toBeNull();
  });

  test("the limit is loadPerCore for each core", () => {
    expect(loadLimit({ cores: 16, oneMinute: 1 }, 3)).toBe(48);
    expect(loadLimit({ cores: 4, oneMinute: 1 }, 1.5)).toBe(6);
  });
});
