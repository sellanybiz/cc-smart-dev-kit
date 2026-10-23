import { describe, expect, test } from "bun:test";
import { sessionLabel } from "./history";

describe("sessionLabel", () => {
  test("its own name first", () => {
    expect(
      sessionLabel({ id: "aaaa1111-0000", name: "Fix the login form", project: "my-app" }),
    ).toBe("Fix the login form");
  });

  test("else its project and short id", () => {
    expect(sessionLabel({ id: "aaaa1111-0000", name: null, project: "my-app" })).toBe(
      "my-app aaaa1111",
    );
  });

  test("a session with no project is its short id alone, never the word null", () => {
    expect(sessionLabel({ id: "aaaa1111-0000", name: null, project: null })).toBe("aaaa1111");
  });
});
