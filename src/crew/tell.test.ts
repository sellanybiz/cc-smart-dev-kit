/**
 * `crew tell` (`tell.ts`, `tell-format.ts`): one crew session tells another crew session a
 * contract change, or asks it a contract question (D47). Each receiver is checked against the
 * store, the note is recorded for the lead, and one `SendMessage` line is printed per receiver.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { runCrew } from "./command";
import { type CrewRecord, createCrew, listCrew, readCrewEvents, writeLead } from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const SELF = "B1-lookup-1a2b3c";
const SELF_NAME = "C my-app B1 lookup";
const PEER = "B2-api-4d5e6f";
const PEER_NAME = "C my-app B2 api";

const MODEL = { named: "sonnet", resolved: "sonnet", slot: null, tier: null };

/** One crew session's record, working, in a worktree folder that need not exist. */
function record(change: {
  id: string;
  leadSessionId?: string;
  name: string;
  phase: string;
  slug: string;
  state?: string;
}): Parameters<typeof createCrew>[1] {
  return {
    base: null,
    baseRef: "main",
    branch: `crew/${change.phase}-${change.slug}`,
    effort: "high",
    files: [],
    id: change.id,
    kind: "build",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: change.leadSessionId ?? LEAD_SESSION,
    memoryMb: null,
    model: MODEL,
    name: change.name,
    permissionMode: "auto",
    phase: change.phase,
    plan: "master-plan",
    pr: null,
    questions: [],
    repo: "",
    reportPath: null,
    sessionId: null,
    shortId: null,
    slug: change.slug,
    state: change.state ?? "working",
    waitsFor: [],
    worktree: "",
  };
}

/** A world with the sender and one peer recorded; `peer` changes the peer's own fields. */
async function tellWorld(peer: Partial<{ leadSessionId: string; state: string }> = {}) {
  const world = crewWorld();
  await writeLead(
    world.paths.stateDir,
    {
      cwd: world.repo,
      name: "LEAD my-app master-plan",
      plan: "master-plan",
      repo: world.repo,
      sessionId: LEAD_SESSION,
      tag: "my-app",
    },
    T0,
  );
  const add = async (one: Parameters<typeof record>[0]) => {
    const made = record(one);
    await createCrew(
      world.paths.stateDir,
      {
        ...made,
        repo: world.repo,
        sessionId: `${one.id}-0000-1111-2222-333333333333`,
        shortId: one.id.slice(0, 8),
        worktree: join(world.repo, ".claude", "worktrees", `${one.phase}-${one.slug}`),
      },
      T0,
    );
  };
  await add({ id: SELF, name: SELF_NAME, phase: "B1", slug: "lookup" });
  await add({ id: PEER, name: PEER_NAME, phase: "B2", slug: "api", ...peer });
  const env = { CC_SMART_DEV_KIT_CREW: SELF };
  const sender = (): CrewRecord | undefined =>
    listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === SELF);
  return { world, env, sender };
}

describe("crew tell", () => {
  test("D47: a contract note is recorded for the lead, and printed as the line to send", async () => {
    const { world, env, sender } = await tellWorld();
    const code = await runCrew(
      [
        "tell",
        PEER_NAME,
        "--kind",
        "contract",
        "--",
        "the lookup index now returns Item[]\nrunGitLookup is gone; use lookup(query)",
      ],
      world.ctx({}, { ...env, CC_SMART_DEV_KIT_CREW: SELF }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      'SendMessage {"to":"C my-app B2 api","message":"[B1] CONTRACT: the lookup index now returns Item[]\\nrunGitLookup is gone; use lookup(query)\\nNo reply needed."}',
    ]);
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    expect(events).toHaveLength(3); // two `created` and the note
    expect(events[2]).toMatchObject({
      crew: SELF,
      lead: LEAD_SESSION,
      name: SELF_NAME,
      state: "working",
      tell: { kind: "contract", to: [PEER_NAME] },
      text: "[B1] CONTRACT: the lookup index now returns Item[]",
      type: "tell",
    });
    // The note is not the sender's state: nothing else changed.
    expect(sender()?.state).toBe("working");
  });

  test("D47: a contract note ends 'No reply needed.', and a question does not", async () => {
    const { world } = await tellWorld();
    const env = { CC_SMART_DEV_KIT_CREW: SELF };
    await runCrew(
      ["tell", PEER_NAME, "--kind", "question", "does your endpoint page after 50?"],
      world.ctx({}, env),
    );
    expect(world.out).toEqual([
      'SendMessage {"to":"C my-app B2 api","message":"[B1] QUESTION: does your endpoint page after 50?"}',
    ]);
    world.out.length = 0;
    await runCrew(
      ["tell", PEER_NAME, "--kind", "contract", "x.ts:lookup is gone"],
      world.ctx({}, env),
    );
    expect(world.out).toEqual([
      'SendMessage {"to":"C my-app B2 api","message":"[B1] CONTRACT: x.ts:lookup is gone\\nNo reply needed."}',
    ]);
  });

  test("D47: one line per receiver, the same note to each, and one event", async () => {
    const { world } = await tellWorld();
    await createCrew(
      world.paths.stateDir,
      {
        ...record({ id: "B3-docs-7a8b9c", name: "C my-app B3 docs", phase: "B3", slug: "docs" }),
        repo: world.repo,
        sessionId: "B3-docs-0000-1111-2222-333333333333",
        shortId: "B3-docs-",
        worktree: join(world.repo, ".claude", "worktrees", "B3-docs"),
      },
      T0,
    );
    const code = await runCrew(
      ["tell", PEER_NAME, "C my-app B3 docs", "--kind", "contract", "x.ts:lookup is gone"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: SELF }),
    );
    expect(code).toBe(0);
    expect(world.out).toEqual([
      'SendMessage {"to":"C my-app B2 api","message":"[B1] CONTRACT: x.ts:lookup is gone\\nNo reply needed."}',
      'SendMessage {"to":"C my-app B3 docs","message":"[B1] CONTRACT: x.ts:lookup is gone\\nNo reply needed."}',
    ]);
    const notes = readCrewEvents(world.paths.stateDir, world.repo).events.filter(
      (one) => one.type === "tell",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.tell).toEqual({ kind: "contract", to: [PEER_NAME, "C my-app B3 docs"] });
  });

  test("D47: a name the store does not know is refused, and nothing is recorded or printed", async () => {
    const { world } = await tellWorld();
    const code = await runCrew(
      ["tell", "C my-app B9 ghost", "--kind", "contract", "x.ts:lookup is gone"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: SELF }),
    );
    expect(code).toBe(1);
    expect(world.out).toEqual([]);
    expect(world.err).toEqual([
      'crew tell: no crew session of this repository is "C my-app B9 ghost"',
      "Fix: cc-smart-dev-kit crew list shows them, and --all those of every repository",
    ]);
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.map((one) => one.type)).toEqual([
      "created",
      "created",
    ]);
  });

  test("D47: a crew session whose session is not running is refused, and says where it is", async () => {
    const { world } = await tellWorld({ state: "done" });
    const code = await runCrew(
      ["tell", PEER_NAME, "--kind", "question", "does your endpoint page?"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: SELF }),
    );
    expect(code).toBe(1);
    expect(world.out).toEqual([]);
    expect(world.err).toEqual([
      "crew tell: C my-app B2 api is done, so a message to it goes nowhere",
    ]);
  });

  test("D47: a crew session of another lead is refused: only your own lead's crew is told", async () => {
    const { world } = await tellWorld({ leadSessionId: "d11fabc6-5555-6666-7777-888888888888" });
    const code = await runCrew(
      ["tell", PEER_NAME, "--kind", "contract", "x.ts:lookup is gone"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: SELF }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew tell: C my-app B2 api works for another lead (LEAD my-app master-plan), and a crew session tells only the crew of its own lead",
    ]);
  });

  test("D47: telling the lead or yourself is refused, and points at crew report", async () => {
    const { world } = await tellWorld();
    const env = { CC_SMART_DEV_KIT_CREW: SELF };
    expect(
      await runCrew(
        ["tell", "LEAD my-app master-plan", "--kind", "contract", "x"],
        world.ctx({}, env),
      ),
    ).toBe(1);
    expect(world.err).toEqual([
      "crew tell: LEAD my-app master-plan is your lead, not a crew session: it hears you through crew report",
      'Fix: cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" --option "<choice>"',
    ]);
    world.err.length = 0;
    expect(await runCrew(["tell", SELF_NAME, "--kind", "contract", "x"], world.ctx({}, env))).toBe(
      1,
    );
    expect(world.err).toEqual(["crew tell: you cannot tell yourself"]);
  });

  test("D47: a third kind is a usage mistake, and names the two there are", async () => {
    const { world } = await tellWorld();
    const code = await runCrew(
      ["tell", PEER_NAME, "--kind", "status", "all good"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: SELF }),
    );
    expect(code).toBe(2);
    expect(world.out).toEqual([]);
    expect(world.err).toEqual([
      "Unknown kind: status (a crew session tells contract or question, nothing else)\nSee: cc-smart-dev-kit crew tell --help",
    ]);
    expect(
      await runCrew(
        ["tell", PEER_NAME, "--kind", "contract", "x"],
        world.ctx({}, { CC_SMART_DEV_KIT_CREW: SELF }),
      ),
    ).toBe(0);
  });

  test("D47: a session that is not a crew session cannot tell", async () => {
    const { world } = await tellWorld();
    const code = await runCrew(
      ["tell", PEER_NAME, "--kind", "contract", "x"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: "no-such-crew" }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      `crew tell: no crew session "no-such-crew" is recorded for ${world.repo}`,
    ]);
    world.err.length = 0;
    expect(await runCrew(["tell", PEER_NAME, "--kind", "contract", "x"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew tell: this session is not a crew session, and only a crew records its own steps and reports",
    ]);
  });

  test("D47: the kind, the text and the receivers are each required", async () => {
    const { world } = await tellWorld();
    const ctx = world.ctx({}, { CC_SMART_DEV_KIT_CREW: SELF });
    expect(await runCrew(["tell", PEER_NAME, "x"], ctx)).toBe(2);
    expect(world.err).toEqual([
      "Say the kind of the note: --kind <contract|question>\nSee: cc-smart-dev-kit crew tell --help",
    ]);
    world.err.length = 0;
    expect(await runCrew(["tell", "--kind", "contract", "x"], ctx)).toBe(2);
    expect(world.err).toEqual([
      'Say who you tell: crew tell <name…> --kind contract "<text>"\nSee: cc-smart-dev-kit crew tell --help',
    ]);
    world.err.length = 0;
    expect(await runCrew(["tell", PEER_NAME, "--kind", "contract", "  "], ctx)).toBe(2);
    expect(world.err).toEqual([
      'Say what you tell: crew tell <name…> --kind contract "<text>"\nSee: cc-smart-dev-kit crew tell --help',
    ]);
  });

  test("D47: `crew tell --help` is its own text, not the whole crew usage", async () => {
    const { world } = await tellWorld();
    expect(await runCrew(["tell", "--help"], world.ctx())).toBe(0);
    expect(world.out[0]).toStartWith("Usage: cc-smart-dev-kit crew tell <name…>");
    expect(world.out[0]).toContain("[<phase>] CONTRACT:");
  });
});
