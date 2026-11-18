/** How git reads its own options before the subcommand. */
import { describe, expect, test } from "bun:test";
import { gitCalls } from "./git-calls";

describe("gitCalls", () => {
  test("the subcommand and its arguments, behind git's own options", () => {
    expect(gitCalls(["push", "origin", "main"])).toEqual([
      { config: new Map(), dirs: [], rest: ["origin", "main"], sub: "push", workTree: null },
    ]);
    expect(gitCalls(["--no-pager", "-C", "a", "-C", "b", "log", "-1"])).toEqual([
      { config: new Map(), dirs: ["a", "b"], rest: ["-1"], sub: "log", workTree: null },
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

  test("--work-tree: both spellings, the last one wins; --git-dir is skipped", () => {
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

  test("git only prints: no call; an option it does not know: every later word may be the subcommand", () => {
    expect(gitCalls(["--version"])).toEqual([]);
    expect(gitCalls([])).toEqual([]);
    expect(gitCalls(["--newer", "x", "push"]).map((call) => call.sub)).toEqual(["x", "push"]);
  });
});
