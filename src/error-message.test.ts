import { describe, expect, test } from "bun:test";
import { messageOf } from "./error-message";

describe("messageOf", () => {
  test("an Error gives its message, without the class name", () => {
    expect(messageOf(new TypeError("no such file"))).toBe("no such file");
  });

  test("a thrown string is its own words", () => {
    expect(messageOf("the lock is held")).toBe("the lock is held");
  });

  test("any other value is turned into text", () => {
    expect(messageOf({ code: 2 })).toBe("[object Object]");
    expect(messageOf(undefined)).toBe("undefined");
  });
});
