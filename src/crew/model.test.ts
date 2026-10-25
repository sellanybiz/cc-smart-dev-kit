/**
 * `crew model` (`model.ts`): the lead changes a crew session's model or effort (MC1). A real git
 * repo, the store in a temp folder, a fake `claude` that logs its calls (`boardWorld`). No real
 * Claude session runs.
 */
import { describe, expect, test } from "bun:test";
import { COMMAND } from "../build-info/names";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { type BoardWorld, boardWorld, NOW } from "../testing/board-world";
import { resolveWorkflow } from "../workflow/resolve";
import { parseModelArgs, runCrew } from "./command";
import { applyPendingModels } from "./model";
import {
  crewMcpFile,
  crewSettingsFile,
  listCrew,
  readCrew,
  readCrewEvents,
  updateCrew,
} from "./store";

const OPUS = { named: "opus", resolved: "opus", slot: null, tier: "opus" };
const SONNET = { named: "sonnet", resolved: "sonnet", slot: null, tier: null };
const NAME = "C my-app B1 help";

/** A live process for the default session, as `claude agents --json` lists one. */
function liveView(world: BoardWorld): string {
  return JSON.stringify([
    {
      cwd: world.repo,
      id: "a1b2c3d4",
      pid: 4242,
      sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
      state: "working",
    },
  ]);
}

/** The `claude --bg --resume` a model change runs: the new flags, the record's files, the prompt. */
function resumeCall(
  world: BoardWorld,
  id: string,
  flags: { effort: string; model: string },
  text: string,
): string[] {
  return [
    "--bg",
    "--resume",
    "a1b2c3d4-0000-1111-2222-333333333333",
    "--model",
    flags.model,
    "--effort",
    flags.effort,
    "--permission-mode",
    "auto",
    "--autocompact",
    "auto",
    "--strict-mcp-config",
    "--mcp-config",
    crewMcpFile(world.paths.stateDir, world.repo, id),
    "--settings",
    crewSettingsFile(world.paths.stateDir, world.repo, id),
    "--",
    text,
  ];
}

describe("crew model: a running crew session", () => {
  test("opus → sonnet: stopped, resumed with the new flags, and the record says so", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ effort: "xhigh", model: OPUS });
    const code = await runCrew(
      ["model", NAME, "--model", "sonnet"],
      world.ctx({}, { FAKE_AGENTS_JSON: liveView(world) }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      ["stop", "a1b2c3d4"],
      resumeCall(
        world,
        record.id,
        { effort: "high", model: "sonnet" },
        "Your lead changed your model from opus to sonnet and your effort from xhigh to high. Go on from where you stopped.",
      ),
    ]);
    expect(world.out).toEqual([`${NAME}: opus xhigh → sonnet high · resumed (a1b2c3d4)`]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "high",
      model: SONNET,
      state: "working",
    });
  });

  test("an effort change alone keeps the model and resumes at the new effort", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const code = await runCrew(["model", NAME, "--effort", "xhigh"], world.ctx());
    expect(code).toBe(0);
    // The fake `claude agents` lists the session as live only while a launch left its state, so
    // here agent view lists no process: the session is gone, and nothing is stopped first.
    expect(world.claudeVerbs()).toEqual(["agents", "--bg"]);
    expect(world.claudeCalls()[1]).toEqual(
      resumeCall(
        world,
        record.id,
        { effort: "xhigh", model: "sonnet" },
        "Your lead changed your effort from high to xhigh. Go on from where you stopped.",
      ),
    );
    expect(world.out).toEqual([`${NAME}: sonnet high → sonnet xhigh · resumed (a1b2c3d4)`]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "xhigh",
      model: SONNET,
      state: "working",
    });
  });

  test("a resume that fails keeps the new values for the next resume, and says so", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const code = await runCrew(
      ["model", NAME, "--effort", "medium"],
      world.ctx({}, { FAKE_BG: "fail" }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      `crew model: ${NAME}: sonnet high → sonnet medium · claude --bg --resume a1b2c3d4-0000-1111-2222-333333333333 failed (exit 4): something broke; the new values are kept for the next resume (${COMMAND} crew resume "${NAME}")`,
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "medium",
    });
  });
});

describe("crew model: a session with no process to move", () => {
  test("a stopped one keeps its state and takes the new values at its next resume", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    expect(
      await runCrew(["model", NAME, "--model", "opus", "--effort", "xhigh"], world.ctx()),
    ).toBe(0);
    expect(world.claudeCalls()).toEqual([]);
    expect(world.out).toEqual([`${NAME}: sonnet high → opus xhigh · stored for the next resume`]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "xhigh",
      model: OPUS,
      state: "stopped",
    });
    // The next resume reads them from the record: one home for the flags.
    world.out.length = 0;
    expect(await runCrew(["resume", NAME], world.ctx())).toBe(0);
    expect(world.claudeCalls().at(-1)).toEqual([
      "--bg",
      "--resume",
      "a1b2c3d4-0000-1111-2222-333333333333",
      "--model",
      "opus",
      "--effort",
      "xhigh",
      "--permission-mode",
      "auto",
      "--autocompact",
      "auto",
      "--strict-mcp-config",
      "--mcp-config",
      crewMcpFile(world.paths.stateDir, world.repo, record.id),
      "--settings",
      crewSettingsFile(world.paths.stateDir, world.repo, record.id),
    ]);
  });

  test("a paused one stays paused, with its wait", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({
      state: "paused",
      waitingFor: {
        kind: "slot",
        since: new Date(NOW).toISOString(),
        slot: "cc-smart-dev-kit-worker",
      },
    });
    expect(await runCrew(["model", NAME, "--effort", "max"], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([]);
    expect(world.out).toEqual([`${NAME}: sonnet high → sonnet max · stored for the next resume`]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "max",
      state: "paused",
    });
  });

  test("a queued one starts on the new values", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ shortId: null, state: "queued", worktree: false });
    expect(await runCrew(["model", NAME, "--model", "opus"], world.ctx())).toBe(0);
    expect(world.out).toEqual([`${NAME}: sonnet high → opus high · stored for its start`]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "high",
      model: OPUS,
      state: "queued",
    });
  });

  test("no change is said, and nothing runs", async () => {
    const world = await boardWorld();
    await world.addCrew();
    expect(await runCrew(["model", NAME, "--effort", "high"], world.ctx())).toBe(0);
    expect(world.out).toEqual([`${NAME}: already sonnet high · nothing changed`]);
    expect(world.claudeCalls()).toEqual([]);
  });
});

describe("crew model: the caps", () => {
  test("to opus past perLeadOpus: queued with the reason, and the session runs on", async () => {
    const world = await boardWorld();
    world.writeConfig({ perLeadOpus: 1 });
    await world.addCrew({ model: OPUS, phase: "B2", slug: "other", suffix: "2b2b2b" });
    const record = await world.addCrew();
    expect(await runCrew(["model", NAME, "--model", "opus"], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([]);
    expect(world.out).toEqual([
      `${NAME}: sonnet high → opus high · queued (its lead has 1 of 1 opus crew sessions running; it starts when one of them finishes)`,
    ]);
    const after = await readCrew(world.paths.stateDir, world.repo, record.id);
    expect(after).toMatchObject({ effort: "high", model: SONNET, state: "working" });
    expect(after?.pendingLaunch).toMatchObject({
      effort: "high",
      model: OPUS,
      why: "its lead has 1 of 1 opus crew sessions running; it starts when one of them finishes",
    });
  });

  test("the watch applies a queued change once a place is free, and not before", async () => {
    const world = await boardWorld();
    world.writeConfig({ perLeadOpus: 1 });
    const other = await world.addCrew({
      model: OPUS,
      phase: "B2",
      slug: "other",
      suffix: "2b2b2b",
    });
    const record = await world.addCrew();
    await runCrew(["model", NAME, "--model", "opus"], world.ctx());
    const checkout = locateCheckout(world.repo, { env: world.ctx().env });
    if (checkout === null) throw new Error("no checkout");
    const resolved = resolveWorkflow(world.paths, loadProjectConfig(checkout).config);
    const lines: string[] = [];
    // Still full: nothing happens.
    const records = () => listCrew(world.paths.stateDir, world.repo).records;
    await applyPendingModels(records(), world.ctx(), resolved, (line) => lines.push(line));
    expect(lines).toEqual([]);
    expect((await readCrew(world.paths.stateDir, world.repo, record.id))?.model).toEqual(SONNET);
    // The other opus session ends: the change goes through.
    await updateCrew(world.paths.stateDir, world.repo, other.id, { state: "done" }, NOW);
    await applyPendingModels(records(), world.ctx(), resolved, (line) => lines.push(line));
    expect(lines).toEqual([`${NAME}: sonnet high → opus high · resumed (a1b2c3d4)`]);
    const after = await readCrew(world.paths.stateDir, world.repo, record.id);
    expect(after).toMatchObject({ effort: "high", model: OPUS, state: "working" });
    expect(after?.pendingLaunch).toBeUndefined();
  });

  test("a change that moves off opus is never held by a cap", async () => {
    const world = await boardWorld();
    world.writeConfig({ perLeadOpus: 1 });
    await world.addCrew({ model: OPUS, phase: "B2", slug: "other", suffix: "2b2b2b" });
    await world.addCrew({ model: OPUS });
    expect(await runCrew(["model", NAME, "--model", "sonnet"], world.ctx())).toBe(0);
    expect(world.out[0]).toContain("→ sonnet high · resumed");
  });
});

describe("crew model: the refusals", () => {
  test("a ui session is never put on an affordable model", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ kind: "ui", model: OPUS, effort: "high" });
    expect(await runCrew(["model", NAME, "--model", "sonnet"], world.ctx())).toBe(2);
    expect(world.err).toEqual([
      "crew model: UI/UX work runs only on `opus` or `fable` at `high`, `xhigh` or `max` (D50): pick one of those for a `ui` session.",
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "high",
      model: OPUS,
    });
  });

  test("a ui session keeps UI_POLICY's effort floor", async () => {
    const world = await boardWorld();
    await world.addCrew({ kind: "ui", model: OPUS, effort: "high" });
    expect(await runCrew(["model", NAME, "--effort", "medium"], world.ctx())).toBe(2);
    expect(world.err[0]).toStartWith("crew model: UI/UX work runs only on");
  });

  test("a name nobody has", async () => {
    const world = await boardWorld();
    await world.addCrew();
    expect(await runCrew(["model", "C my-app B9 nope", "--effort", "max"], world.ctx())).toBe(1);
    expect(world.err[0]).toBe(
      'crew model: no crew session of this repository is "C my-app B9 nope"',
    );
  });

  test("a removed record, and one that ended its phase", async () => {
    for (const state of ["removed", "merged", "done"]) {
      const world = await boardWorld();
      await world.addCrew({ state });
      expect(await runCrew(["model", NAME, "--effort", "max"], world.ctx())).toBe(1);
      expect(world.err[0]).toContain(`${NAME} is ${state}`);
      expect(world.claudeCalls()).toEqual([]);
    }
  });

  test("a crew session never changes a model", async () => {
    const world = await boardWorld();
    await world.addCrew();
    const code = await runCrew(
      ["model", NAME, "--effort", "max"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: "B1-help-1a2b3c" }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("a crew session never changes a crew session's model or effort");
  });

  test("an effort the policy refuses is refused before anything runs", async () => {
    const world = await boardWorld();
    await world.addCrew();
    expect(parseModelArgs([NAME, "--effort", "low"])).toEqual({
      error: "Unknown effort: low (a crew session runs at medium, high, xhigh, max)",
    });
  });
});

describe("crew model: the arguments", () => {
  test("a name and at least one of --model and --effort", () => {
    expect(parseModelArgs([NAME, "--model", "opus", "--effort", "XHIGH"])).toEqual({
      crew: NAME,
      effort: "xhigh",
      model: "opus",
    });
    expect(parseModelArgs([NAME])).toEqual({
      error: "Say what changes: --model <model> or --effort <effort>, or both",
    });
    expect(parseModelArgs(["--effort", "high"])).toEqual({
      error: "Say which crew session: crew model <name|id> [--model <model>] [--effort <effort>]",
    });
  });

  test("the usage names the command", async () => {
    const world = await boardWorld();
    expect(await runCrew(["model", "--help"], world.ctx())).toBe(0);
    expect(world.out.join("\n")).toContain(`${COMMAND} crew model`);
  });
});

describe("crew model: events", () => {
  test("a resumed session is working again, and the log has no second state event for a session that already was", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    await runCrew(["model", NAME, "--effort", "xhigh"], world.ctx());
    const states = readCrewEvents(world.paths.stateDir, world.repo).events.filter(
      (one) => one.crew === record.id && one.type === "state",
    );
    expect(states).toEqual([]);
  });
});
