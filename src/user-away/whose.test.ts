import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRecord } from "../hooks/sessions";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import type { ParkedItem } from "./state";
import { type OwnerFacts, ownedItems, ownerFacts, ownerOf, waitingLines } from "./whose";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const PEER = "bbbbbbbb-0000-0000-0000-000000000002";
const GONE = "cccccccc-0000-0000-0000-000000000003";

function item(over: Partial<ParkedItem> = {}): ParkedItem {
  return {
    id: 1,
    kind: "question",
    text: "Which name?",
    command: null,
    tool: null,
    options: [],
    recommend: null,
    session: ME,
    cwd: "/work/app",
    at: "2026-11-03T00:00:00.000Z",
    ...over,
  };
}

function record(sessionId: string, name: string, cwd: string): SessionRecord {
  return { pid: 1, sessionId, cwd, name };
}

/**
 * The asker is ME in project "app"; PEER runs in "shop".
 */
function facts(over: Partial<OwnerFacts> = {}): OwnerFacts {
  return {
    session: ME,
    project: "app",
    live: [record(ME, "kit session", "/work/app"), record(PEER, "shop fix", "/work/shop")],
    projectOf: (cwd) =>
      cwd.startsWith("/work/app") ? "app" : cwd.startsWith("/work/shop") ? "shop" : null,
    ...over,
  };
}

describe("ownerOf", () => {
  test("an item this session parked is this session's", () => {
    expect(ownerOf(item(), facts())).toEqual({ whose: "this session", waitsIn: null });
  });

  test("an item another running session parked waits in that session, whatever the project", () => {
    expect(ownerOf(item({ session: PEER, cwd: "/work/shop" }), facts())).toEqual({
      whose: "another session",
      waitsIn: { name: "shop fix", cwd: "/work/shop" },
    });
    // The same project changes nothing: that session is still there to answer it.
    expect(ownerOf(item({ session: PEER, cwd: "/work/app" }), facts())).toEqual({
      whose: "another session",
      waitsIn: { name: "shop fix", cwd: "/work/shop" },
    });
  });

  test("an item of a session that ended is this project's sessions', and nobody's elsewhere", () => {
    expect(ownerOf(item({ session: GONE, cwd: "/work/app/.claude/worktrees/x" }), facts())).toEqual(
      { whose: "this session", waitsIn: null },
    );
    expect(ownerOf(item({ session: GONE, cwd: "/work/shop" }), facts())).toEqual({
      whose: "no session",
      waitsIn: null,
    });
    expect(ownerOf(item({ session: "", cwd: "/elsewhere" }), facts())).toEqual({
      whose: "no session",
      waitsIn: null,
    });
  });

  test("running sessions that cannot be read keep another session's item there", () => {
    expect(ownerOf(item({ session: GONE, cwd: "/work/app" }), facts({ live: null }))).toEqual({
      whose: "another session",
      waitsIn: null,
    });
    // An item no session is named on has no owner to wait for: the project rule still holds.
    expect(ownerOf(item({ session: "", cwd: "/work/app" }), facts({ live: null }))).toEqual({
      whose: "this session",
      waitsIn: null,
    });
  });

  test("a project that cannot be told never makes an item this session's", () => {
    expect(ownerOf(item({ session: GONE }), facts({ project: null }))).toEqual({
      whose: "no session",
      waitsIn: null,
    });
    expect(ownerOf(item({ session: GONE }), facts({ projectOf: () => null }))).toEqual({
      whose: "no session",
      waitsIn: null,
    });
    // Two projects that cannot be told are not one project.
    expect(
      ownerOf(item({ session: GONE }), facts({ project: null, projectOf: () => null })),
    ).toEqual({ whose: "no session", waitsIn: null });
  });

  test("the person's own terminal has no session: only the running owners and the project decide", () => {
    const terminal = facts({ session: null });
    expect(ownerOf(item({ session: ME }), terminal)).toEqual({
      whose: "another session",
      waitsIn: { name: "kit session", cwd: "/work/app" },
    });
    expect(ownerOf(item({ session: GONE }), terminal)).toEqual({
      whose: "this session",
      waitsIn: null,
    });
  });
});

describe("ownerFacts", () => {
  const asker = (cwd: string, home: string) => ({
    session: ME,
    cwd,
    env: cleanGitEnv(),
    paths: { claudeConfigDir: join(home, ".claude"), stateDir: join(home, "state") },
  });

  test("a folder that is gone belongs where its nearest parent does", () => {
    const home = tempDir("whose");
    const repo = join(home, "app");
    mkdirSync(repo);
    git(repo, "init", "-q");
    const facts = ownerFacts(asker(repo, home), { sessions: () => [] });
    expect(facts.project).not.toBeNull();
    expect(facts.projectOf(join(repo, ".claude", "worktrees", "removed"))).toBe(facts.project);
    expect(facts.projectOf(join(home, "elsewhere"))).not.toBe(facts.project);
  });

  test("a fact that throws is unknown, never a guess", () => {
    const home = tempDir("whose");
    const facts = ownerFacts(asker("/work/app", home), {
      sessions: () => {
        throw new Error("the record of running session 9 cannot be read; retry");
      },
      projectOf: () => {
        throw new Error("git did not answer");
      },
    });
    expect(facts.live).toBeNull();
    expect(facts.project).toBeNull();
    expect(facts.projectOf("/work/shop")).toBeNull();
  });

  test("the running sessions come from Claude Code's own records", () => {
    const home = tempDir("whose");
    const sessions = join(home, ".claude", "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, `${String(process.pid)}.json`),
      JSON.stringify({ pid: process.pid, sessionId: PEER, cwd: "/work/shop", name: "shop fix" }),
    );
    const facts = ownerFacts(asker("/work/app", home), { projectOf: (cwd) => cwd });
    expect(facts.live?.map((one) => one.sessionId)).toEqual([PEER]);
  });
});

describe("ownedItems and waitingLines", () => {
  test("each item carries whose it is, and nothing is read for an empty list", () => {
    const home = tempDir("whose");
    let reads = 0;
    const sources = {
      sessions: () => {
        reads += 1;
        return [record(PEER, "shop fix", "/work/shop")];
      },
      projectOf: (cwd: string) => (cwd.startsWith("/work/app") ? "app" : cwd),
    };
    const asker = {
      session: ME,
      cwd: "/work/app",
      env: {},
      paths: { claudeConfigDir: join(home, ".claude"), stateDir: join(home, "state") },
    };
    expect(ownedItems([], asker, sources)).toEqual([]);
    expect(reads).toBe(0);
    const owned = ownedItems(
      [item({ id: 1 }), item({ id: 2, session: PEER, cwd: "/work/shop" })],
      asker,
      sources,
    );
    expect(owned.map((one) => [one.id, one.whose, one.waitsIn?.name ?? null])).toEqual([
      [1, "this session", null],
      [2, "another session", "shop fix"],
    ]);
  });

  test("the lines name what is this session's, where the rest waits, and what nobody answers", () => {
    expect(
      waitingLines([
        { whose: "this session", waitsIn: null },
        { whose: "this session", waitsIn: null },
        { whose: "another session", waitsIn: { name: "shop fix", cwd: "/work/shop" } },
        { whose: "another session", waitsIn: { name: "shop fix", cwd: "/work/shop" } },
        { whose: "another session", waitsIn: null },
        { whose: "no session", waitsIn: null },
      ]),
    ).toEqual([
      "2 items wait for this session: go through them with /cc-smart-dev-kit:user-available.",
      "3 items wait in other sessions, which go through their own: shop fix (2), a session it cannot name (1).",
      "1 item was parked in another project by a session that ended: /cc-smart-dev-kit:user-available asks whether to take it here.",
    ]);
    expect(waitingLines([{ whose: "this session", waitsIn: null }])).toEqual([
      "1 item waits for this session: go through it with /cc-smart-dev-kit:user-available.",
    ]);
    // A session's name is the person's text: it never carries a terminal escape.
    expect(
      waitingLines([
        { whose: "another session", waitsIn: { name: "bad\u001b]0;x\u0007", cwd: "/w" } },
      ])[0],
    ).not.toContain("\u001b");
  });
});
