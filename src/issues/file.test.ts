/**
 * `issue file` (D67): the switch, the repository it names, the hidden marker, the screen and
 * the public-repository yes. Every test runs against a temp checkout and a fake `gh`
 * (`src/testing/fake-gh.ts`): nothing here reaches GitHub.
 */
import { describe, expect, test } from "bun:test";
import { type FakeGh, repoOf } from "../testing/fake-gh";
import { git } from "../testing/temp";
import {
  type IssuesSetup,
  issuesWorld,
  OWN_REPO,
  TEST_HOME as HOME,
} from "../testing/issues-world";
import { fileIssue, type IssueOutcome, issueLine } from "./file";
import { fingerprintHash, markerLine } from "./marker";

const world = (setup: IssuesSetup = {}) => issuesWorld(setup);

const REQUEST = {
  body: "The hook crashes on an empty input.",
  fingerprint: "hooks:empty-input",
  labels: [],
  title: "Hook crashes on empty input",
};

function refusal(outcome: IssueOutcome): string {
  if (outcome.kind !== "refused") throw new Error(`expected a refusal, got ${issueLine(outcome)}`);
  return outcome.why;
}

describe("the switch", () => {
  test("off by default: refused, with how to turn it on, and gh is never called", async () => {
    const { gh, world: w } = world({ committed: { worktrees: { base: "main" } } });
    const why = refusal(await fileIssue(w, REQUEST));
    expect(why).toContain("issues.enabled is off (default)");
    expect(why).toContain("workflow set issues.enabled true");
    expect(why).toContain(`"workflow": {"issues": {"enabled": true}}`);
    expect(gh.calls).toEqual([]);
  });

  test("on from the person's own file", async () => {
    const { world: w } = world({
      committed: { worktrees: { base: "main" } },
      personal: { issues: { enabled: true } },
    });
    expect((await fileIssue(w, REQUEST)).kind).toBe("filed");
  });

  test("on from the project's file committed on origin/<base>", async () => {
    const { world: w } = world();
    expect((await fileIssue(w, REQUEST)).kind).toBe("filed");
  });

  test("a working-copy edit does not count: the committed file says off", async () => {
    const { gh, world: w } = world({
      committed: { worktrees: { base: "main" } },
      workingCopy: { worktrees: { base: "main" }, workflow: { issues: { enabled: true } } },
    });
    expect(refusal(await fileIssue(w, REQUEST))).toContain("issues.enabled is off (default)");
    expect(gh.calls).toEqual([]);
  });

  test("a working-copy edit cannot switch it off either: the committed file says on", async () => {
    const { world: w } = world({
      workingCopy: { worktrees: { base: "main" }, workflow: { issues: { enabled: false } } },
    });
    expect((await fileIssue(w, REQUEST)).kind).toBe("filed");
  });

  test("a policy that cannot be read is a refusal, never a guess", async () => {
    const { gh, world: w } = world({ committed: null });
    // No committed file and no personal file: the default (off) applies.
    expect(refusal(await fileIssue(w, REQUEST))).toContain("issues.enabled is off");
    expect(gh.calls).toEqual([]);
  });
});

describe("filing and the hidden marker", () => {
  test("a new issue: one create, to the project's own repository, with the marker and the found label", async () => {
    const { gh, world: w } = world();
    const outcome = await fileIssue(w, REQUEST);
    expect(outcome).toEqual({
      kind: "filed",
      number: 1,
      public: false,
      url: "https://github.com/example-org/my-app/issues/1",
    });
    expect(issueLine(outcome)).toBe("filed #1 https://github.com/example-org/my-app/issues/1");
    const [issue] = gh.issues;
    expect(issue?.title).toBe(REQUEST.title);
    expect(issue?.labels).toEqual(["kit:found"]);
    // The marker is the hash of the key, on its own last line; the key itself is not written.
    expect(issue?.body).toBe(
      `${REQUEST.body}\n\n<!-- cc-smart-dev-kit:issue ${fingerprintHash(REQUEST.fingerprint)} -->\n`,
    );
    expect(issue?.body).not.toContain(REQUEST.fingerprint);
    // Every call names the repository, and nothing else.
    for (const call of gh.calls) expect(repoOf(call.args)).toBe(OWN_REPO);
  });

  test("the hash is fixed: the marker of a known key (written by hand)", () => {
    // sha256("a") begins ca978112ca1bbdcafac231b39a23dc4d
    expect(markerLine(fingerprintHash("a"))).toBe(
      "<!-- cc-smart-dev-kit:issue ca978112ca1bbdcafac231b39a23dc4d -->",
    );
  });

  test("the same fingerprint again updates the body and opens no second issue", async () => {
    const { gh, world: w } = world();
    await fileIssue(w, REQUEST);
    const again = await fileIssue(w, { ...REQUEST, body: "It also crashes on a null input." });
    expect(again).toEqual({
      kind: "updated",
      number: 1,
      public: false,
      url: "https://github.com/example-org/my-app/issues/1",
    });
    expect(issueLine(again)).toBe("updated #1 https://github.com/example-org/my-app/issues/1");
    expect(gh.issues).toHaveLength(1);
    expect(gh.issues[0]?.body).toContain("null input");
    expect(gh.issues[0]?.body).toContain(markerLine(fingerprintHash(REQUEST.fingerprint)));
  });

  test("two fingerprints are two issues", async () => {
    const { gh, world: w } = world();
    await fileIssue(w, REQUEST);
    const second = await fileIssue(w, { ...REQUEST, fingerprint: "hooks:other" });
    expect(second.kind).toBe("filed");
    expect(gh.issues).toHaveLength(2);
  });

  test("a marker only counts on an issue that carries the found label", async () => {
    const stray = {
      body: `Someone's note\n\n${markerLine(fingerprintHash(REQUEST.fingerprint))}\n`,
      labels: ["question"],
      number: 7,
      title: "stray",
      url: "https://github.com/example-org/my-app/issues/7",
    };
    const { gh, world: w } = world({ gh: { issues: [stray] } });
    const outcome = await fileIssue(w, REQUEST);
    expect(outcome.kind).toBe("filed");
    expect(gh.issues[0]?.body).toBe(stray.body);
  });

  test("a body that already holds a marker is refused: it could take over another issue", async () => {
    const { gh, world: w } = world();
    const why = refusal(
      await fileIssue(w, { ...REQUEST, body: `x\n${markerLine(fingerprintHash("other"))}` }),
    );
    expect(why).toContain("marker");
    expect(gh.calls).toEqual([]);
  });

  test("extra labels are asked for, and a label the repository lacks is created first", async () => {
    const { gh, world: w } = world({ gh: { labels: ["kit:found"] } });
    await fileIssue(w, { ...REQUEST, labels: ["hooks", "kit:found"] });
    expect(gh.issues[0]?.labels).toEqual(["kit:found", "hooks"]);
    const created = gh.calls.filter(
      (call) => call.args[0] === "label" && call.args[1] === "create",
    );
    expect(created.map((call) => call.args[2])).toEqual(["hooks"]);
  });

  test("a label the schema would refuse is refused before gh is called", async () => {
    const { gh, world: w } = world();
    expect(refusal(await fileIssue(w, { ...REQUEST, labels: ["a,b"] }))).toContain("label");
    expect(gh.calls).toEqual([]);
  });

  test("a title or fingerprint that is empty is refused", async () => {
    const { world: w } = world();
    expect(refusal(await fileIssue(w, { ...REQUEST, title: " " }))).toContain("title");
    expect(refusal(await fileIssue(w, { ...REQUEST, fingerprint: "" }))).toContain("fingerprint");
  });

  test("so many labelled issues that the list may be cut is a refusal, never a second issue", async () => {
    const many = Array.from({ length: 1000 }, (_, index) => ({
      body: "x",
      labels: ["kit:found"],
      number: index + 1,
      title: "t",
      url: `https://github.com/example-org/my-app/issues/${index + 1}`,
    }));
    const { gh, world: w } = world({ gh: { issues: many } });
    expect(refusal(await fileIssue(w, REQUEST))).toContain("1000");
    expect(gh.issues).toHaveLength(1000);
  });
});

describe("the screen: nothing is sent", () => {
  const cases: [string, string, string][] = [
    ["a home path", `fine\nsee ${HOME}/notes.txt here`, "the body, line 2, column 5"],
    [
      "a key or token",
      "line one\n\ntoken ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "the body, line 3, column 7",
    ],
    [
      "a URL with credentials",
      "clone https://alice:hunter2@example.com/x.git",
      "the body, line 1, column 7",
    ],
  ];
  for (const [kind, body, where] of cases) {
    test(`${kind}: refused with ${where}, never the value`, async () => {
      const { gh, world: w } = world();
      const why = refusal(await fileIssue(w, { ...REQUEST, body }));
      expect(why).toContain(kind);
      expect(why).toContain(where);
      expect(why).not.toContain("hunter2");
      expect(why).not.toContain("ghp_");
      expect(why).not.toContain(HOME);
      expect(gh.calls).toEqual([]);
    });
  }

  test("the title is screened too", async () => {
    const { gh, world: w } = world();
    const why = refusal(await fileIssue(w, { ...REQUEST, title: `crash in ${HOME}/x` }));
    expect(why).toContain("the title, line 1, column 10");
    expect(gh.calls).toEqual([]);
  });

  test("a `~` path and a commit hash are fine", async () => {
    const { world: w } = world();
    const body = "see ~/.config/x and commit 4dfa940163c4b6f2d3a2f1c0e9b8a7d6c5b4a392";
    expect((await fileIssue(w, { ...REQUEST, body })).kind).toBe("filed");
  });

  test("a home path inside another name is not a hit", async () => {
    const { world: w } = world();
    expect((await fileIssue(w, { ...REQUEST, body: "/home/testerson/x" })).kind).toBe("filed");
  });
});

describe("only the project's own repository", () => {
  test("no origin: refused", async () => {
    const { gh, world: w } = world({ origin: null });
    expect(refusal(await fileIssue(w, REQUEST))).toContain("origin");
    expect(gh.calls).toEqual([]);
  });

  test("an origin that is not on GitHub: refused", async () => {
    const { gh, world: w } = world({ origin: "https://gitlab.example.com/example-org/my-app.git" });
    expect(refusal(await fileIssue(w, REQUEST))).toContain("not on github.com");
    expect(gh.calls).toEqual([]);
  });

  test("a fork: only origin's repository is named, never the upstream's", async () => {
    const { gh, repo, world: w } = world();
    git(repo, "remote", "add", "upstream", "git@github.com:upstream-org/lib.git");
    await fileIssue(w, REQUEST);
    expect(gh.calls.length).toBeGreaterThan(0);
    for (const call of gh.calls) {
      expect(repoOf(call.args)).toBe(OWN_REPO);
      expect(call.args.join(" ")).not.toContain("upstream-org");
    }
  });

  test("an https origin and an ssh:// origin name the same repository", async () => {
    for (const origin of [
      "https://github.com/example-org/my-app.git",
      "ssh://git@github.com/example-org/my-app",
    ]) {
      const { gh, world: w } = world({ origin });
      await fileIssue(w, REQUEST);
      expect(repoOf(gh.calls[0]?.args ?? [])).toBe(OWN_REPO);
    }
  });

  test("the repository has issues turned off: refused", async () => {
    const { world: w } = world({ gh: { hasIssuesEnabled: false } });
    expect(refusal(await fileIssue(w, REQUEST))).toContain("issues turned off");
  });
});

describe("a public repository", () => {
  test("is its own yes: with allowPublic off it is refused, and says how to turn it on", async () => {
    const { gh, world: w } = world({ gh: { visibility: "PUBLIC" } });
    const why = refusal(await fileIssue(w, REQUEST));
    expect(why).toContain("public");
    expect(why).toContain("issues.allowPublic is off (default)");
    expect(why).toContain("workflow set issues.allowPublic true");
    expect(gh.issues).toEqual([]);
  });

  test("with allowPublic on it posts, and the line says public", async () => {
    const { world: w } = world({
      committed: {
        worktrees: { base: "main" },
        workflow: { issues: { allowPublic: true, enabled: true } },
      },
      gh: { visibility: "PUBLIC" },
    });
    const outcome = await fileIssue(w, REQUEST);
    expect(outcome).toMatchObject({ kind: "filed", public: true });
    expect(issueLine(outcome)).toBe(
      "filed #1 https://github.com/example-org/my-app/issues/1 (public repository)",
    );
  });

  test("the visibility is read once per call", async () => {
    const { gh, world: w } = world();
    await fileIssue(w, REQUEST);
    expect(gh.calls.filter((call) => call.args[0] === "repo")).toHaveLength(1);
  });
});

describe("gh that cannot do it", () => {
  test("missing: refused, with where to get it", async () => {
    const { world: w } = world({ gh: { mode: "missing" } });
    const why = refusal(await fileIssue(w, REQUEST));
    expect(why).toContain("gh is not installed");
    expect(why).toContain("https://cli.github.com");
  });

  test("logged out: refused, with gh auth login", async () => {
    const { world: w } = world({ gh: { mode: "logged-out" } });
    expect(refusal(await fileIssue(w, REQUEST))).toContain("gh auth login");
  });

  test("timed out: refused, and nothing is said to have been filed", async () => {
    const { gh, world: w } = world({ gh: { mode: "timeout" } });
    const why = refusal(await fileIssue(w, REQUEST));
    expect(why).toContain("timed out");
    expect(gh.issues).toEqual([]);
  });
});

describe("an issue someone else wrote is data", () => {
  test("an update replaces only the body of the issue the marker names", async () => {
    const mine: FakeGh["issues"][number] = {
      body: `old\n\n${markerLine(fingerprintHash(REQUEST.fingerprint))}\n`,
      labels: ["kit:found"],
      number: 3,
      title: "mine",
      url: "https://github.com/example-org/my-app/issues/3",
    };
    const { gh, world: w } = world({ gh: { issues: [mine] } });
    await fileIssue(w, REQUEST);
    const edits = gh.calls.filter((call) => call.args[1] === "edit");
    expect(edits.map((call) => call.args.slice(0, 3))).toEqual([["issue", "edit", "3"]]);
    expect(edits[0]?.args).not.toContain("--title");
  });
});
