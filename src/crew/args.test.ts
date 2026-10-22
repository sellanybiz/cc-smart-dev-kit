/**
 * The arguments of a `crew` command (`args.ts`): values, flags, and every mistake a person
 * can make, each with the line that tells them what to fix.
 */
import { describe, expect, test } from "bun:test";
import { commaList, parseOptions } from "./args";

describe("parseOptions", () => {
  test("`--name value` and `--name=value` give the same value; the rest are positionals", () => {
    const spaced = parseOptions(["B1", "--slug", "help", "--kind=build"], ["--slug", "--kind"]);
    expect(spaced).toEqual({
      flags: new Set(),
      lists: new Map(),
      options: new Map([
        ["--slug", "help"],
        ["--kind", "build"],
      ]),
      positionals: ["B1"],
    });
  });

  test("a flag takes no value, and is there only when it was given", () => {
    const given = parseOptions(["--all", "--json"], [], ["--all", "--json"]);
    expect(given).toEqual({
      flags: new Set(["--all", "--json"]),
      lists: new Map(),
      options: new Map(),
      positionals: [],
    });
    const none = parseOptions([], [], ["--all", "--json"]);
    expect(none).toEqual({
      flags: new Set(),
      lists: new Map(),
      options: new Map(),
      positionals: [],
    });
  });

  test("a flag after a positional still counts, and does not swallow the next word", () => {
    expect(parseOptions(["x", "--json", "y"], [], ["--json"])).toEqual({
      flags: new Set(["--json"]),
      lists: new Map(),
      options: new Map(),
      positionals: ["x", "y"],
    });
  });

  test("a repeatable option collects its values in order; a bare -- ends the options", () => {
    const parsed = parseOptions(
      ["--option", "a", "--option=b", "--", "--not-an-option", "x"],
      ["--option"],
      [],
      ["--option"],
    );
    expect(parsed).toEqual({
      flags: new Set(),
      lists: new Map([["--option", ["a", "b"]]]),
      options: new Map(),
      positionals: ["--not-an-option", "x"],
    });
  });

  test("mistakes: an unknown option, a repeated one, a missing value, a value on a flag", () => {
    expect(parseOptions(["--nope"], ["--slug"])).toEqual({ error: "Unknown option: --nope" });
    expect(parseOptions(["--nope=1"], ["--slug"])).toEqual({ error: "Unknown option: --nope=1" });
    expect(parseOptions(["--slug", "a", "--slug", "b"], ["--slug"])).toEqual({
      error: "--slug is given twice",
    });
    expect(parseOptions(["--slug"], ["--slug"])).toEqual({ error: "--slug needs a value" });
    expect(parseOptions(["--slug", "--kind", "x"], ["--slug", "--kind"])).toEqual({
      error: "--slug needs a value",
    });
    expect(parseOptions(["--slug="], ["--slug"])).toEqual({ error: "--slug needs a value" });
    expect(parseOptions(["--all", "--all"], [], ["--all"])).toEqual({
      error: "--all is given twice",
    });
    expect(parseOptions(["--all=yes"], [], ["--all"])).toEqual({ error: "--all takes no value" });
  });
});

describe("commaList", () => {
  test("each part trimmed, the empty ones dropped, nothing for nothing", () => {
    expect(commaList(" a, b ,, c ")).toEqual(["a", "b", "c"]);
    expect(commaList("")).toEqual([]);
    expect(commaList(undefined)).toEqual([]);
  });
});
