/** How git reads its own options before the subcommand. */
import { describe, expect, test } from "bun:test";
import { gitCalls } from "./git-calls";

describe("gitCalls", () => {
  test("the subcommand and its arguments, behind git's own options", () => {
    expect(gitCalls(["push", "origin", "main"])).toEqual([
      {
        config: new Map(),
        dirs: [],
        gitDir: null,
        rest: ["origin", "main"],
        sub: "push",
        workTree: null,
      },
    ]);
    expect(gitCalls(["--no-pager", "-C", "a", "-C", "b", "log", "-1"])).toEqual([
      {
        config: new Map(),
        dirs: ["a", "b"],
        gitDir: null,
        rest: ["-1"],
        sub: "log",
        workTree: null,
      },
    ]);
  });

  test("-c and --config-env settings, the value of the second null (read from the environment)", () => {
    const [call] = gitCalls(["-c", "Alias.p=push", "--config-env=user.name=NAME", "p"]);
    expect(call?.sub).toBe("p");
    expect([...(call?.config ?? [])]).toEqual([
      ["alias.p", "push"],
      ["user.name", null],
    ]);
  });

  test("--work-tree: both spellings, the last one wins", () => {
    expect(gitCalls(["--work-tree=/w", "commit"])[0]?.workTree).toBe("/w");
    expect(gitCalls(["--git-dir", "/g", "--work-tree", "/w", "commit"])[0]).toMatchObject({
      sub: "commit",
      workTree: "/w",
    });
    expect(gitCalls(["--work-tree", "/a", "--work-tree=/b", "commit"])[0]?.workTree).toBe("/b");
    expect(gitCalls(["--git-dir=/g", "commit"])[0]).toMatchObject({
      sub: "commit",
      workTree: null,
    });
  });

  test("--git-dir: both spellings, the last one wins, and it is not the subcommand", () => {
    expect(gitCalls(["--git-dir=/g", "checkout", "--", "f"])[0]).toMatchObject({
      gitDir: "/g",
      rest: ["--", "f"],
      sub: "checkout",
    });
    expect(gitCalls(["--git-dir", "/g", "-C", "d", "reset", "--hard"])[0]).toMatchObject({
      dirs: ["d"],
      gitDir: "/g",
      rest: ["--hard"],
      sub: "reset",
    });
    expect(gitCalls(["--git-dir", "/a", "--git-dir=/b", "status"])[0]?.gitDir).toBe("/b");
    expect(gitCalls(["checkout", "--", "f"])[0]?.gitDir).toBeNull();
  });

  test("git only prints: no call; an option it does not know takes no value, or the next word", () => {
    expect(gitCalls(["--version"])).toEqual([]);
    expect(gitCalls([])).toEqual([]);
    expect(gitCalls(["--newer", "x", "push"]).map((call) => call.sub)).toEqual(["x", "push"]);
    // No git option takes two values, so a third word is never the subcommand.
    expect(gitCalls(["--newer", "x", "y", "push"]).map((call) => call.sub)).toEqual(["x", "y"]);
    // An attached value is its own; options after it are read as git reads them.
    expect(gitCalls(["--newer=x", "push"]).map((call) => call.sub)).toEqual(["push"]);
    expect(gitCalls(["--newer", "v", "-C", "d", "reset"])).toEqual([
      {
        config: new Map(),
        dirs: [],
        gitDir: null,
        rest: ["-C", "d", "reset"],
        sub: "v",
        workTree: null,
      },
      { config: new Map(), dirs: ["d"], gitDir: null, rest: [], sub: "reset", workTree: null },
    ]);
    expect(gitCalls(["--a", "--b", "push"]).map((call) => call.sub)).toEqual(["push", "push"]);
  });

  // The final review's W1: one reading per later word made a long line cost its square.
  test("W1, a long line after an option it does not know gives two readings, not one a word", () => {
    const words = ["--foo", ...Array.from({ length: 20_000 }, () => "reset")];
    const started = Date.now();
    expect(gitCalls(words)).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("W1, many options it does not know stop branching at MAX_READINGS", () => {
    const words = [...Array.from({ length: 20_000 }, () => "--foo"), "reset"];
    const started = Date.now();
    expect(gitCalls(words).length).toBeLessThanOrEqual(16);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
