import { describe, expect, test } from "bun:test";
import { allowsNewer, isValidRange, lowestAllowed, satisfiesRange } from "./version-range";

describe("lowestAllowed", () => {
  test.each([
    [">=1.4", "1.4.0"],
    ["^1.4", "1.4.0"],
    ["~1.4.2", "1.4.2"],
    [">=1.4 <2", "1.4.0"],
    ["1.x", "1.0.0"],
    ["^1.4 || ^2", "1.4.0"],
    ["^3 || >=2.1", "2.1.0"],
    ["<2", "0.0.0"],
    ["*", null],
  ])("%p starts at %p", (range, lowest) => {
    expect(lowestAllowed(range)).toBe(lowest);
  });
});

describe("allowsNewer: whether an update can bring the plugin into the range", () => {
  // "update": some version newer than the plugin is in the range; "widen": none is.
  test.each([
    ["^1.4 || ^2.1", "2.0.0", "update"],
    ["<2 >=1.4", "1.0.0", "update"],
    ["^1.4", "2.0.0", "widen"],
    [">2.0.0", "2.0.0", "update"],
    ["<1", "2.0.0", "widen"],
    ["1.x", "2.0.0", "widen"],
    ["1.2.0 - 1.5.0", "2.0.0", "widen"],
    ["1.2.0 - 1.5.0", "1.0.0", "update"],
    [">1.4", "1.4.3", "update"],
    ["~1.4.2", "1.4.0", "update"],
    [">=1.4 <1.4.5", "1.4.6", "widen"],
    // `>1.4` lets in 1.5.0 first, which neither 1.4.0 nor its next patch reaches.
    [">1.4 <1.6", "1.4.3", "update"],
    [">1 <3", "1.9.0", "update"],
  ] as const)("%p on %p: %p", (range, version, expected) => {
    expect(allowsNewer(version, range) ? "update" : "widen").toBe(expected);
  });

  test("a range it cannot read throws", () => {
    expect(() => allowsNewer("1.0.0", "banana")).toThrow('"banana" is not a valid version range');
  });
});

describe("isValidRange", () => {
  test.each([
    ">=1.2",
    "^1.2",
    "~1.2.3",
    "1.x",
    "*",
    ">=1.2 <2",
    ">= 1.2",
    "1.2.0 - 2.0.0",
    "^1 || ^2",
    "1.2.3-beta.1",
  ])("accepts %p", (range) => {
    expect(isValidRange(range)).toBe(true);
  });

  test.each(["", "banana", ">=1.2a", "1.2.3.4", "^1 ||", ">=", "1..2", "=>1.2"])(
    "rejects %p",
    (range) => {
      expect(isValidRange(range)).toBe(false);
    },
  );
});

describe("satisfiesRange", () => {
  test.each([
    ["1.2.0", ">=1.2", true],
    ["1.1.9", ">=1.2", false],
    ["1.9.0", "^1.2", true],
    ["2.0.0", "^1.2", false],
    ["0.1.5", "^0.1.2", true],
    ["0.2.0", "^0.1.2", false],
    ["1.5.0", ">=1.2 <2", true],
    ["3.1.0", "^1 || ^3", true],
  ] as const)("%p in %p is %p", (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });

  test("a range it cannot read throws, instead of matching every version", () => {
    expect(() => satisfiesRange("1.0.0", "banana")).toThrow(
      '"banana" is not a valid version range',
    );
  });
});
