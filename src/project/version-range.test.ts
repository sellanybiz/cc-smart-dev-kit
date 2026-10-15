import { describe, expect, test } from "bun:test";
import { isValidRange, satisfiesRange } from "./version-range";

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
