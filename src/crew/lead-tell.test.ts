/**
 * `crew lead tell` (`lead-tell.ts`, `tell-format.ts`): one lead tells another lead of the same
 * repository a contract change, or asks it a contract question (D55). Each receiver is a lead
 * the store records for this repository; the note is recorded in the store, so the receiving
 * lead's watch prints one line, and one `SendMessage` line is printed per lead.
 */
import { describe, expect, test } from "bun:test";
import { crewWorld, LEAD_SESSION, OTHER_SESSION } from "../testing/crew-world";
import { runCrew } from "./command";
import { type LeadRecord, listLeads, readCrewEvents, writeLead } from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const SELF_NAME = "LEAD my-app master-plan";
const PEER_NAME = "LEAD my-app other-plan";

/** A world whose session is a registered lead, with `leads` recorded beside it. */
async function leadWorld(
  leads: Array<Partial<LeadRecord> & { name: string; sessionId: string }> = [],
) {
  const world = crewWorld();
  const add = async (one: Partial<LeadRecord> & { name: string; sessionId: string }) => {
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        plan: "master-plan",
        repo: world.repo,
        tag: "my-app",
        ...one,
      },
      T0,
    );
  };
  await add({ name: SELF_NAME, sessionId: LEAD_SESSION });
  for (const one of leads) await add(one);
  return world;
}

/** The world with a second lead of this repository. */
async function twoLeadWorld() {
  return await leadWorld([{ name: PEER_NAME, plan: "other-plan", sessionId: OTHER_SESSION }]);
}

/** The notes recorded in the store, oldest first. */
function notes(world: ReturnType<typeof crewWorld>) {
  return readCrewEvents(world.paths.stateDir, world.repo).events.filter(
    (one) => one.type === "lead-tell",
  );
}

describe("crew lead tell", () => {
  test("a contract note is recorded for the other lead, and printed as the line to send", async () => {
    const world = await twoLeadWorld();
    const code = await runCrew(
      ["lead", "tell", PEER_NAME, "--kind", "contract", "src/x.ts:lookup is gone; use lookup(q)"],
      world.ctx(),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      'SendMessage {"to":"LEAD my-app other-plan","message":"[LEAD my-app master-plan] CONTRACT: src/x.ts:lookup is gone; use lookup(q)\\nNo reply needed."}',
    ]);
    expect(notes(world)).toMatchObject([
      {
        crew: LEAD_SESSION,
        lead: OTHER_SESSION,
        name: SELF_NAME,
        state: "working",
        tell: { kind: "contract", to: [PEER_NAME] },
        text: "src/x.ts:lookup is gone; use lookup(q)",
        type: "lead-tell",
      },
    ]);
  });

  test("the receiving lead's watch prints the note as one line", async () => {
    const world = await twoLeadWorld();
    await runCrew(
      ["lead", "tell", PEER_NAME, "--kind", "contract", "src/x.ts:lookup is gone"],
      world.ctx(),
    );
    world.out.length = 0;
    const code = await runCrew(
      ["watch", "--lead", OTHER_SESSION, "--once", "--timeout", "0"],
      world.ctx(),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      "LEAD my-app master-plan: contract from another lead · src/x.ts:lookup is gone",
    ]);
  });

  test("a question note asks, and does not end 'No reply needed.'", async () => {
    const world = await twoLeadWorld();
    await runCrew(
      ["lead", "tell", PEER_NAME, "--kind", "question", "does your branch take the merge?"],
      world.ctx(),
    );
    expect(world.out).toEqual([
      'SendMessage {"to":"LEAD my-app other-plan","message":"[LEAD my-app master-plan] QUESTION: does your branch take the merge?"}',
    ]);
  });

  test("one note to two leads: one event each, so each lead's watch hears it", async () => {
    const third = "e22fbc7d-9999-aaaa-bbbb-cccccccccccc";
    const world = await leadWorld([
      { name: PEER_NAME, plan: "other-plan", sessionId: OTHER_SESSION },
      { name: "LEAD my-app third-plan", plan: "third-plan", sessionId: third },
    ]);
    const code = await runCrew(
      ["lead", "tell", PEER_NAME, "LEAD my-app third-plan", "--kind", "contract", "x.ts:y is gone"],
      world.ctx(),
    );
    expect(code).toBe(0);
    expect(world.out).toEqual([
      'SendMessage {"to":"LEAD my-app other-plan","message":"[LEAD my-app master-plan] CONTRACT: x.ts:y is gone\\nNo reply needed."}',
      'SendMessage {"to":"LEAD my-app third-plan","message":"[LEAD my-app master-plan] CONTRACT: x.ts:y is gone\\nNo reply needed."}',
    ]);
    expect(notes(world).map((one) => one.lead)).toEqual([OTHER_SESSION, third]);
  });

  test("a session id, whole or its first 8 characters, names a lead like its name does", async () => {
    const world = await twoLeadWorld();
    const env = world.ctx();
    expect(
      await runCrew(["lead", "tell", OTHER_SESSION.slice(0, 8), "--kind", "contract", "a"], env),
    ).toBe(0);
    world.err.length = 0;
    expect(
      await runCrew(["lead", "tell", OTHER_SESSION, "--kind", "question", "b"], world.ctx()),
    ).toBe(0);
    expect(world.err).toEqual([]);
  });

  test("an unknown lead is refused, and nothing is recorded or printed", async () => {
    const world = await twoLeadWorld();
    const code = await runCrew(
      ["lead", "tell", "LEAD my-app ghost", "--kind", "contract", "x"],
      world.ctx(),
    );
    expect(code).toBe(1);
    expect(world.out).toEqual([]);
    expect(world.err).toEqual([
      'crew lead tell: no lead of this repository is "LEAD my-app ghost"',
      "Fix: name one of the leads here: LEAD my-app master-plan, LEAD my-app other-plan",
    ]);
    expect(notes(world)).toEqual([]);
  });

  test("a lead of another repository is no lead of this one: the same refusal", async () => {
    // Another repository's leads live in its own store; this command reads this one's only.
    const world = await twoLeadWorld();
    const code = await runCrew(
      ["lead", "tell", "LEAD other-app master-plan", "--kind", "contract", "x"],
      world.ctx(),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toBe(
      'crew lead tell: no lead of this repository is "LEAD other-app master-plan"',
    );
    expect(notes(world)).toEqual([]);
  });

  test("one receiver refused refuses the whole note: all or none", async () => {
    const world = await twoLeadWorld();
    const code = await runCrew(
      ["lead", "tell", PEER_NAME, "LEAD my-app ghost", "--kind", "contract", "x.ts:y is gone"],
      world.ctx(),
    );
    expect(code).toBe(1);
    expect(world.out).toEqual([]);
    expect(notes(world)).toEqual([]);
  });

  test("telling yourself is refused", async () => {
    const world = await twoLeadWorld();
    const code = await runCrew(["lead", "tell", SELF_NAME, "--kind", "contract", "x"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual(["crew lead tell: you cannot tell yourself"]);
    expect(notes(world)).toEqual([]);
  });

  test("a crew session may not tell another lead: it talks to its own lead", async () => {
    const world = await twoLeadWorld();
    const code = await runCrew(
      ["lead", "tell", PEER_NAME, "--kind", "contract", "x"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: "B1-x-1a2b3c" }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew lead tell: this session is the crew session B1-x-1a2b3c, and a crew session never tells another lead",
      'Fix: hand the need to your lead: cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" --option "<choice>"',
    ]);
    expect(notes(world)).toEqual([]);
  });

  test("a session that never ran crew lead cannot tell", async () => {
    const world = crewWorld();
    const code = await runCrew(
      ["lead", "tell", "LEAD my-app other-plan", "--kind", "contract", "x"],
      world.ctx(),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew lead tell: this session is not a lead of this repository",
      "Fix: cc-smart-dev-kit crew lead --plan <slug>",
    ]);
  });

  test("a name two leads share is refused, and both are named", async () => {
    const world = await leadWorld([
      { name: PEER_NAME, sessionId: OTHER_SESSION },
      { name: PEER_NAME, sessionId: "e22fbc7d-9999-aaaa-bbbb-cccccccccccc" },
    ]);
    const code = await runCrew(["lead", "tell", PEER_NAME, "--kind", "contract", "x"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual([
      'crew lead tell: "LEAD my-app other-plan" is two leads',
      `  ${OTHER_SESSION}  ${PEER_NAME}`,
      "  e22fbc7d-9999-aaaa-bbbb-cccccccccccc  LEAD my-app other-plan",
      "Fix: name one by its session id",
    ]);
    expect(notes(world)).toEqual([]);
  });

  test("the kind, the text and the receivers are each required", async () => {
    const world = await twoLeadWorld();
    const ctx = world.ctx();
    expect(await runCrew(["lead", "tell", PEER_NAME, "x"], ctx)).toBe(2);
    expect(world.err).toEqual([
      "Say the kind of the note: --kind <contract|question>\nSee: cc-smart-dev-kit crew lead tell --help",
    ]);
    world.err.length = 0;
    expect(await runCrew(["lead", "tell", "--kind", "contract", "x"], ctx)).toBe(2);
    expect(world.err).toEqual([
      'Say which leads you tell: crew lead tell <lead…> --kind contract "<text>"\nSee: cc-smart-dev-kit crew lead tell --help',
    ]);
    world.err.length = 0;
    expect(await runCrew(["lead", "tell", PEER_NAME, "--kind", "contract", "  "], ctx)).toBe(2);
    expect(world.err).toEqual([
      'Say what you tell: crew lead tell <lead…> --kind contract "<text>"\nSee: cc-smart-dev-kit crew lead tell --help',
    ]);
    world.err.length = 0;
    expect(await runCrew(["lead", "tell", PEER_NAME, "--kind", "status", "x"], ctx)).toBe(2);
    expect(world.err).toEqual([
      "Unknown kind: status (a lead tells contract or question, nothing else)\nSee: cc-smart-dev-kit crew lead tell --help",
    ]);
  });

  test("`crew lead tell --help` is its own text, not the whole crew usage", async () => {
    const world = await twoLeadWorld();
    expect(await runCrew(["lead", "tell", "--help"], world.ctx())).toBe(0);
    expect(world.out[0]).toStartWith("Usage: cc-smart-dev-kit crew lead tell <lead…>");
    expect(world.out[0]).toContain("[<your lead name>] CONTRACT:");
  });

  test("the leads of the store are what this command reads: none, none to tell", async () => {
    const world = crewWorld();
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: SELF_NAME,
        plan: "master-plan",
        repo: world.repo,
        sessionId: LEAD_SESSION,
        tag: "my-app",
      },
      T0,
    );
    // The sender itself is the only lead: there is no other to name.
    expect(listLeads(world.paths.stateDir, world.repo).records).toHaveLength(1);
    expect(await runCrew(["lead", "tell", PEER_NAME, "--kind", "contract", "x"], world.ctx())).toBe(
      1,
    );
    expect(world.err).toEqual([
      `crew lead tell: no lead of this repository is "${PEER_NAME}"`,
      `Fix: name one of the leads here: ${SELF_NAME}`,
    ]);
  });
});
