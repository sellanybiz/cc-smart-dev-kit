import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCrew } from "../crew/command";
import { leadFile, listCrew, writeLead } from "../crew/store";
import type { SessionRecord } from "../hooks/sessions";
import { crewWorld, LEAD_SESSION, OTHER_SESSION } from "../testing/crew-world";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import type { ParkedItem } from "./state";
import { type OwnerFacts, ownedItems, ownerFacts, ownerOf, waitingLines } from "./whose";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const PEER = "bbbbbbbb-0000-0000-0000-000000000002";
const GONE = "cccccccc-0000-0000-0000-000000000003";
const LEAD = "dddddddd-0000-0000-0000-000000000004";

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
    crew: "",
    cwd: "/work/app",
    at: "2026-11-03T00:00:00.000Z",
    ...over,
  };
}

function record(sessionId: string, name: string, cwd: string): SessionRecord {
  return { pid: 1, sessionId, cwd, name };
}

/** The asker is ME in project "app"; PEER runs in "shop"; the crew session UA1-x-1's lead is LEAD. */
function facts(over: Partial<OwnerFacts> = {}): OwnerFacts {
  return {
    session: ME,
    project: "app",
    live: [record(ME, "kit session", "/work/app"), record(PEER, "shop fix", "/work/shop")],
    crewLead: (crew) => (crew === "UA1-x-1" ? [LEAD] : null),
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

  test("a crew session's item is its lead's, even while the crew session runs", () => {
    const crewItem = item({ session: PEER, crew: "UA1-x-1", cwd: "/work/app" });
    // The asking lead runs, as an asker always does, and so does its crew session.
    const leadAsks = facts({
      session: LEAD,
      live: [record(LEAD, "LEAD app plan", "/work/app"), record(PEER, "C UA1", "/work/app")],
    });
    expect(ownerOf(crewItem, leadAsks)).toEqual({ whose: "this session", waitsIn: null });
    // Its lead runs elsewhere: the item waits there, not in the crew session or in this one.
    const live = [record(LEAD, "LEAD app plan", "/work/app"), record(PEER, "C UA1", "/work/app")];
    expect(ownerOf(crewItem, facts({ live }))).toEqual({
      whose: "another session",
      waitsIn: { name: "LEAD app plan", cwd: "/work/app" },
    });
    // Its lead ended: the project's sessions answer it, through `crew answer`.
    expect(ownerOf(crewItem, facts())).toEqual({ whose: "this session", waitsIn: null });
  });

  test("an item this session parked for a crew session stays its own, whoever leads that crew", () => {
    const live = [
      record(ME, "kit session", "/work/app"),
      record(LEAD, "LEAD app plan", "/work/app"),
    ];
    expect(ownerOf(item({ session: ME, crew: "UA1-x-1" }), facts({ live }))).toEqual({
      whose: "this session",
      waitsIn: null,
    });
  });

  test("a crew session no record names is judged by the session that parked it", () => {
    expect(ownerOf(item({ session: PEER, crew: "UA9-gone-1" }), facts())).toEqual({
      whose: "another session",
      waitsIn: { name: "shop fix", cwd: "/work/shop" },
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

  test("a crew session's lead, by the crew session's id or name, and the lead's later session", async () => {
    const world = crewWorld();
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: "LEAD my-app plan",
        plan: "plan",
        repo: world.repo,
        sessionId: LEAD_SESSION,
        tag: "my-app",
      },
      Date.parse("2026-11-03T00:00:00Z"),
    );
    const brief = join(world.paths.home, "brief.md");
    writeFileSync(brief, "# Build it\n");
    expect(
      await runCrew(
        ["start", "P1", "--slug", "store", "--kind", "build", "--brief", brief],
        world.ctx(),
      ),
    ).toBe(0);
    const crew = listCrew(world.paths.stateDir, world.repo).records[0];
    if (!crew) throw new Error("no crew record");
    const factsOf = () =>
      ownerFacts(
        {
          session: OTHER_SESSION,
          cwd: world.repo,
          env: cleanGitEnv(),
          paths: world.paths,
        },
        { sessions: () => [], projectOf: (cwd) => cwd },
      );
    expect(factsOf().crewLead(crew.id)).toEqual([LEAD_SESSION]);
    expect(factsOf().crewLead(crew.name)).toEqual([LEAD_SESSION]);
    expect(factsOf().crewLead("UA9-none-1")).toBeNull();
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: "LEAD my-app plan",
        plan: "plan",
        repo: world.repo,
        sessionId: OTHER_SESSION,
        tag: "my-app",
      },
      Date.parse("2026-11-03T01:00:00Z"),
    );
    // A lead that moved to a new session lists the one before it, which the crew record may
    // still name: the new session leads it too.
    const file = leadFile(world.paths.stateDir, world.repo, OTHER_SESSION);
    const moved = JSON.parse(readFileSync(file, "utf8"));
    moved.earlierSessions = [{ sessionId: LEAD_SESSION, shortId: LEAD_SESSION.slice(0, 8) }];
    writeFileSync(file, JSON.stringify(moved));
    expect(factsOf().crewLead(crew.id)).toEqual([LEAD_SESSION, OTHER_SESSION]);
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
