import { describe, expect, test } from "bun:test";
import { FOLDS_KEPT, FOLDS_KEY, parseFolds, withFolds } from "@/hooks/use-folds";

describe("the remembered folds", () => {
  test("the stored entry reads back; anything else reads as no choice made", () => {
    expect(FOLDS_KEY).toBe("cc-smart-dev-kit-portal-task-folds");
    expect(parseFolds('{"t:w1":true,"s:p:s":false,"bad":"yes"}')).toEqual({
      "t:w1": true,
      "s:p:s": false,
    });
    expect(parseFolds(null)).toEqual({});
    expect(parseFolds("not json")).toEqual({});
    expect(parseFolds("[true]")).toEqual({});
    expect(parseFolds("7")).toEqual({});
  });

  test("a choice is the newest entry, and the oldest go past the cap", () => {
    expect(withFolds({ a: true, b: false }, ["a", "c"], false)).toEqual({
      b: false,
      a: false,
      c: false,
    });
    expect(Object.keys(withFolds({ a: true, b: false }, ["a"], true))).toEqual(["b", "a"]);
    const many = Object.fromEntries(
      Array.from({ length: FOLDS_KEPT }, (_, index) => [`k${index}`, true]),
    );
    const next = withFolds(many, ["new"], false);
    expect(Object.keys(next)).toHaveLength(FOLDS_KEPT);
    expect(next.k0).toBeUndefined();
    expect(next.new).toBe(false);
  });
});
