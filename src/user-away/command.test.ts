import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { createOut, textSink } from "../cli/ui/out";
import { detectTerminal } from "../cli/ui/terminal";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { runUser, type UserContext } from "./command";
import { readAway } from "./state";
import type { OwnerSources } from "./whose";

const NOW = Date.parse("2026-10-25T01:00:00.000Z");

interface Run {
  code: number;
  err: string;
  out: string;
}

/** No session runs, and a folder under /work/<name> is project <name>: nothing reads this machine. */
const NO_OWNERS: OwnerSources = {
  sessions: () => [],
  projectOf: (cwd) => /^\/work\/([^/]+)/.exec(cwd)?.[1] ?? cwd,
};

/** One `user` command in this process: plain output, UTC, a fixed clock, a home of its own. */
async function user(
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    home?: string;
    nowMs?: number;
    owners?: OwnerSources;
  } = {},
): Promise<Run & { ctx: UserContext }> {
  const home = options.home ?? tempDir("user-cmd");
  const env = { HOME: home, CLAUDE_CONFIG_DIR: `${home}/.claude`, ...options.env };
  let out = "";
  let err = "";
  const term = detectTerminal({ isTTY: false, env: {}, platform: "linux" });
  const ctx: UserContext = {
    cwd: options.cwd ?? "/work/app",
    env,
    nowMs: options.nowMs ?? NOW,
    out: createOut(
      term,
      textSink((text) => (out += text)),
    ),
    paths: cliPaths(env),
    print: (line) => {
      out += `${line}\n`;
    },
    say: (line) => {
      err += `${line}\n`;
    },
    timeZone: "UTC",
    owners: options.owners ?? NO_OWNERS,
  };
  const code = await runUser(args, ctx);
  return { code, ctx, err, out };
}

function stateOf(run: { ctx: UserContext }) {
  return readAway(run.ctx.paths.stateDir);
}

/** The asking session, a peer that still runs in another project, and one that ended. */
const ME = { CLAUDE_CODE_SESSION_ID: "sess-me" };
const PEER_RUNS: OwnerSources = {
  ...NO_OWNERS,
  sessions: () => [{ pid: 7, sessionId: "sess-peer", cwd: "/work/shop", name: "shop fix" }],
};

/** Three items: this session's in /work/app, the peer's in /work/shop, an ended one's in /work/old. */
async function threeSessions(): Promise<string> {
  const home = tempDir("user-cmd");
  await user(["unavailable"], { home });
  await user(["park", "--kind", "question", "Mine?"], { home, env: ME });
  await user(["park", "--kind", "question", "Ship the build?"], {
    home,
    cwd: "/work/shop",
    env: { CLAUDE_CODE_SESSION_ID: "sess-peer" },
  });
  await user(["park", "--kind", "decision", "Chose A. Undo: B."], {
    home,
    cwd: "/work/old",
    env: { CLAUDE_CODE_SESSION_ID: "sess-ended" },
  });
  return home;
}

describe("user unavailable, status, available", () => {
  test("status of a machine that never said anything", async () => {
    const run = await user(["status"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("· The person is available.\n· Nothing is parked.\n");
  });

  test("unavailable says since when, and that the list is empty", async () => {
    const run = await user(["unavailable"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      [
        "✓ The person is unavailable since 01:00.",
        "· Sessions park what needs the person instead of asking. Nothing is parked yet.",
        "",
        "Next steps:",
        "  1. When the person is back, go through what waited:",
        "       /cc-smart-dev-kit:user-available",
        "",
      ].join("\n"),
    );
    expect(stateOf(run).unavailable).toBe(true);
  });

  test("--until 8h records the expected return, and status shows it", async () => {
    const home = tempDir("user-cmd");
    const run = await user(["unavailable", "--until", "8h"], { home });
    expect(run.code).toBe(0);
    expect(run.out).toContain("✓ The person is unavailable since 01:00, back about 09:00.");
    expect(stateOf(run).until).toBe("2026-10-25T09:00:00.000Z");
    const status = await user(["status"], { home });
    expect(status.out).toBe(
      "· The person is unavailable since 01:00, back about 09:00.\n· Nothing is parked.\n",
    );
  });

  test("--until takes an ISO time and a time of day, and refuses what it cannot read or a time that has passed", async () => {
    const iso = await user(["unavailable", "--until", "2026-10-25T07:30:00Z"]);
    expect(stateOf(iso).until).toBe("2026-10-25T07:30:00.000Z");

    const clock = await user(["unavailable", "--until", "07:30"]);
    const at = new Date(stateOf(clock).until ?? "");
    expect([at.getHours(), at.getMinutes()]).toEqual([7, 30]);
    expect(at.getTime()).toBeGreaterThan(NOW);
    expect(at.getTime() - NOW).toBeLessThanOrEqual(24 * 3_600_000);

    const bad = await user(["unavailable", "--until", "soon"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--until needs a time");
    const past = await user(["unavailable", "--until", "2026-10-24T07:30:00Z"]);
    expect(past.code).toBe(2);
    expect(past.err).toContain("has already passed");
  });

  test("available puts the state back, and says what still waits", async () => {
    const home = tempDir("user-cmd");
    await user(["unavailable"], { home });
    await user(["park", "--kind", "question", "Which name?"], { home });
    const run = await user(["available"], { home });
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      [
        "✓ The person is available again.",
        "· 1 item waits for the person: go through it with /cc-smart-dev-kit:user-available.",
        "",
      ].join("\n"),
    );
    expect(stateOf(run).unavailable).toBe(false);
    expect(stateOf(run).items).toHaveLength(1);
  });

  test("available in a session counts its own items and names where the rest wait", async () => {
    const home = await threeSessions();
    const run = await user(["available"], { home, env: ME, owners: PEER_RUNS });
    expect(run.out).toBe(
      [
        "✓ The person is available again.",
        "· 1 item waits for this session: go through it with /cc-smart-dev-kit:user-available.",
        "· 1 item waits in other sessions, which go through their own: shop fix (1).",
        "· 1 item was parked in another project by a session that ended: /cc-smart-dev-kit:user-available asks whether to take it here.",
        "",
      ].join("\n"),
    );
  });

  test("available with nothing parked", async () => {
    const run = await user(["available"]);
    expect(run.out).toBe("✓ The person is available again.\n· Nothing was parked.\n");
  });

  test("status --json is data a program reads", async () => {
    const home = tempDir("user-cmd");
    await user(["unavailable"], { home });
    await user(["park", "--kind", "decision", "Chose A. Undo: revert it."], { home });
    const run = await user(["status", "--json"], { home });
    const data = JSON.parse(run.out);
    expect(data.unavailable).toBe(true);
    expect(data.since).toBe("2026-10-25T01:00:00.000Z");
    expect(data.counts).toEqual({ action: 0, decision: 1, question: 0 });
    // The parked words and commands are read with `list`; a status line must not carry them into
    // whichever session asks for the time (a command may hold a secret).
    expect(data.items).toBeUndefined();
    expect(data.said).toBeUndefined();
  });
});

describe("user park", () => {
  test("a question keeps its options and the recommended one, and who parked it", async () => {
    const run = await user(
      [
        "park",
        "--kind",
        "question",
        "Which name?",
        "--option",
        "alpha",
        "--option",
        "beta",
        "--recommend",
        "2",
      ],
      { env: { CLAUDE_CODE_SESSION_ID: "sess-1" } },
    );
    expect(run.code).toBe(0);
    expect(run.out).toBe("✓ Parked as #1: a question for the person.\n");
    expect(stateOf(run).items).toEqual([
      {
        id: 1,
        kind: "question",
        text: "Which name?",
        command: null,
        tool: null,
        options: ["alpha", "beta"],
        recommend: 2,
        session: "sess-1",

        cwd: "/work/app",
        at: "2026-10-25T01:00:00.000Z",
      },
    ]);
  });

  test("an action keeps its exact command, quotes and new lines included", async () => {
    const command = "git push origin 'fix/x'\ngh pr create --title \"a b\"";
    const run = await user([
      "park",
      "--kind",
      "action",
      "Push and open the pull request",
      "--command",
      command,
    ]);
    expect(run.code).toBe(0);
    expect(stateOf(run).items[0]?.command).toBe(command);
    expect(stateOf(run).items[0]?.tool).toBeNull();
  });

  test("a decision is parked by its words", async () => {
    const run = await user([
      "park",
      "--kind",
      "decision",
      "Chose B: the plan recommends it. Undo: git revert 0123456789abcdef0123456789abcdef01234567",
    ]);
    expect(run.out).toBe("✓ Parked as #1: a decision the person can keep or undo.\n");
    expect(stateOf(run).items[0]?.text).toContain("0123456789abcdef0123456789abcdef01234567");
  });

  test("two parks at once keep both", async () => {
    const home = tempDir("user-cmd");
    const [a, b] = await Promise.all([
      user(["park", "--kind", "question", "one"], { home }),
      user(["park", "--kind", "question", "two"], { home }),
    ]);
    expect([a.code, b.code]).toEqual([0, 0]);
    expect(
      readAway(a.ctx.paths.stateDir)
        .items.map((item) => item.text)
        .sort(),
    ).toEqual(["one", "two"]);
  });

  test("the same action parked again says it is already parked", async () => {
    const home = tempDir("user-cmd");
    await user(["park", "--kind", "action", "push", "--command", "git push"], { home });
    const again = await user(["park", "--kind", "action", "push", "--command", "git push"], {
      home,
    });
    expect(again.code).toBe(0);
    expect(again.out).toBe("· Already parked as #1: an action that needs the person's yes.\n");
  });

  test.each([
    [["park", "Which name?"], "--kind is required"],
    [["park", "--kind", "idea", "x"], "--kind is question, action or decision"],
    [["park", "--kind", "question"], "What is parked needs its words"],
    [["park", "--kind", "question", ""], "What is parked needs its words"],
    [["park", "--kind", "decision", "   "], "What is parked needs its words"],
    [["park", "--kind", "action", "x", "--command", ""], "--command needs a value"],
    [["park", "--kind", "action", "x", "--command", "  "], "--command needs the exact command"],
    [["park", "--kind", "question", "a", "b"], "What is parked takes one text"],
    [["park", "--kind", "question", "x", "--command", "ls"], "--command is for an action"],
    [
      ["park", "--kind", "action", "x", "--option", "a"],
      "--option and --recommend are for a question",
    ],
    [
      ["park", "--kind", "question", "x", "--option", "a", "--recommend", "2"],
      "--recommend is a number from 1 to 1",
    ],
    [["park", "--kind", "question", "x", "--recommend", "1"], "--recommend needs options"],
  ] as const)("a wrong park %j is refused: %s", async (args, message) => {
    const run = await user([...args]);
    expect(run.code).toBe(2);
    expect(run.err).toContain(message);
    expect(stateOf(run).items).toEqual([]);
  });
});

describe("user list and clear", () => {
  async function seeded(): Promise<string> {
    const home = tempDir("user-cmd");
    await user(["unavailable"], { home });
    await user(
      [
        "park",
        "--kind",
        "question",
        "Which name?",
        "--option",
        "alpha",
        "--option",
        "beta",
        "--recommend",
        "2",
      ],
      { home, env: { CLAUDE_CODE_SESSION_ID: "sess-1" } },
    );
    await user(["park", "--kind", "action", "Push the branch", "--command", "git push origin x"], {
      home,
      nowMs: NOW + 60_000,
    });
    return home;
  }

  test("list shows each item with its kind, who parked it, when, its options and its exact command", async () => {
    const home = await seeded();
    const run = await user(["list"], { home });
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      [
        "#1 question · session sess-1 · 01:00",
        "   Which name?",
        "   1. alpha",
        "   2. beta (recommended)",
        "#2 action · 01:01",
        "   Push the branch",
        "   in /work/app",
        "   $ git push origin x",
        "",
      ].join("\n"),
    );
  });

  test("list --json is the items, exact", async () => {
    const home = await seeded();
    const run = await user(["list", "--json"], { home });
    const items = JSON.parse(run.out);
    expect(items.map((item: { id: number }) => item.id)).toEqual([1, 2]);
    expect(items[1].command).toBe("git push origin x");
  });

  test("list --json says whose each item is, for the session that asks", async () => {
    const home = await threeSessions();
    const run = await user(["list", "--json"], { home, env: ME, owners: PEER_RUNS });
    const items = JSON.parse(run.out);
    expect(
      items.map((one: { id: number; whose: string; waitsIn: unknown }) => [
        one.id,
        one.whose,
        one.waitsIn,
      ]),
    ).toEqual([
      [1, "this session", null],
      [2, "another session", { name: "shop fix", cwd: "/work/shop" }],
      [3, "no session", null],
    ]);
    // The peer asks: the first item is now another session's, and its own is its own.
    const peer = await user(["list", "--json"], {
      home,
      cwd: "/work/shop",
      env: { CLAUDE_CODE_SESSION_ID: "sess-peer" },
      owners: {
        ...NO_OWNERS,
        sessions: () => [{ pid: 8, sessionId: "sess-me", cwd: "/work/app", name: "kit session" }],
      },
    });
    expect(JSON.parse(peer.out).map((one: { whose: string }) => one.whose)).toEqual([
      "another session",
      "this session",
      "no session",
    ]);
  });

  test("the list's view says who answers each item", async () => {
    const home = await threeSessions();
    const run = await user(["list"], { home, env: ME, owners: PEER_RUNS });
    expect(run.out).toBe(
      [
        "#1 question · session sess-me · 01:00 · for this session",
        "   Mine?",
        "#2 question · session sess-peer · 01:00 · waits in shop fix",
        "   Ship the build?",
        "#3 decision · session sess-ended · 01:00 · its session ended",
        "   Chose A. Undo: B.",
        "",
      ].join("\n"),
    );
  });

  test("list with nothing parked says so", async () => {
    const run = await user(["list"]);
    expect(run.out).toBe("· Nothing is parked.\n");
  });

  test("list never lets a terminal escape through", async () => {
    const home = tempDir("user-cmd");
    await user(["park", "--kind", "decision", "bad \u001b]52;c;eA==\u0007 text"], { home });
    const run = await user(["list"], { home });
    expect(run.out).not.toContain("\u001b");
    expect(run.out).not.toContain("\u0007");
  });

  test("a command the view had to change says so, and list --json still holds it exact", async () => {
    const home = tempDir("user-cmd");
    // A tab and a line break stay in the view; a carriage return or an escape do not.
    const command = "printf 'a\tb'\r\nls";
    await user(["park", "--kind", "action", "Print a line", "--command", command], { home });
    const view = await user(["list"], { home });
    expect(view.out).toContain("list --json");
    expect(view.out).toContain("changed");
    expect(JSON.parse((await user(["list", "--json"], { home })).out)[0].command).toBe(command);
    // A plain command needs no such line.
    const plain = await seeded();
    expect((await user(["list"], { home: plain })).out).not.toContain("list --json");
  });

  test("clear takes the named items out; a missing id is an error and removes nothing", async () => {
    const home = await seeded();
    const run = await user(["clear", "1"], { home });
    expect(run.out).toBe("✓ Cleared #1. 1 item still waits.\n");
    expect(stateOf(run).items.map((item) => item.id)).toEqual([2]);

    const missing = await user(["clear", "2", "9"], { home });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("No item #9");
    expect(stateOf(missing).items.map((item) => item.id)).toEqual([2]);
  });

  test("clear --all empties the list", async () => {
    const home = await seeded();
    const run = await user(["clear", "--all"], { home });
    expect(run.out).toBe("✓ Cleared #1 and #2. Nothing waits now.\n");
    expect(stateOf(run).items).toEqual([]);
  });

  test("clear needs ids or --all, never both", async () => {
    const none = await user(["clear"]);
    expect(none.code).toBe(2);
    expect(none.err).toContain("clear needs item numbers or --all");
    const both = await user(["clear", "1", "--all"]);
    expect(both.code).toBe(2);
    const text = await user(["clear", "one"]);
    expect(text.code).toBe(2);
    expect(text.err).toContain("is not an item number");
  });
});

describe("the command line", () => {
  test("no command prints the usage with exit 2", async () => {
    const run = await user([]);
    expect(run.code).toBe(2);
    expect(run.err).toContain("Usage: cc-smart-dev-kit user <command>");
  });

  test.each([
    [["sleep"], "Unknown command: user sleep"],
    [["status", "now"], "status takes no text: now"],
    [["available", "--until", "8h"], "Unknown option: --until"],
    [["unavailable", "soon"], "unavailable takes no text: soon"],
  ] as const)("a wrong line %j: one line and where to look, exit 2", async (args, message) => {
    const run = await user([...args]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(`${message}\nSee: cc-smart-dev-kit user --help\n`);
  });

  test("a state file that cannot be read stops the command with its own words, exit 1", async () => {
    const home = tempDir("user-cmd");
    await user(["unavailable"], { home });
    const { awayStateFile } = await import("./state");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      awayStateFile(cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: `${home}/.claude` }).stateDir),
      "nope",
    );
    const run = await user(["status"], { home });
    expect(run.code).toBe(1);
    expect(run.err).toContain("is not a state file");
  });
});

describe("sessions that park at once, each in its own process", () => {
  // The in-process test above shares one event loop, so it cannot tell whether the lock is there:
  // a read-change-write with no await in it never interleaves. Separate processes do.
  test("every park is kept, with its own number", async () => {
    const home = tempDir("user-cmd");
    const guard = subprocessGuard();
    const entry = join(import.meta.dir, "..", "entries", "cli.ts");
    const count = 8;
    const runs = Array.from({ length: count }, (_, index) =>
      Bun.spawn(
        [
          process.execPath,
          ...guard.args,
          entry,
          "user",
          "park",
          "--kind",
          "question",
          `question ${String(index)}`,
        ],
        {
          env: {
            ...guard.env,
            CLAUDE_CONFIG_DIR: `${home}/.claude`,
            HOME: home,
            PATH: process.env.PATH ?? "",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      ),
    );
    const codes = await Promise.all(runs.map((run) => run.exited));
    expect(codes).toEqual(Array.from({ length: count }, () => 0));
    const items = readAway(
      cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: `${home}/.claude` }).stateDir,
    ).items;
    expect(items.map((item) => item.text).sort()).toEqual(
      Array.from({ length: count }, (_, index) => `question ${String(index)}`).sort(),
    );
    expect(new Set(items.map((item) => item.id)).size).toBe(count);
  }, 60_000);
});
