/**
 * `crew model` (`model.ts`): the lead changes a crew session's model or effort (MC1). A real git
 * repo, the store in a temp folder, a fake `claude` that logs its calls (`boardWorld`). No real
 * Claude session runs.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { type BoardWorld, boardWorld, LEAD_NAME, NOW } from "../testing/board-world";
import { LEAD_SESSION } from "../testing/crew-world";
import { tempDir } from "../testing/temp";
import { resolveWorkflow } from "../workflow/resolve";
import { parseModelArgs, runCrew } from "./command";
import { applyPendingModels } from "./model";
import { readRunFile, runFile } from "./runs";
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

describe("crew model: a running session that cannot be moved keeps the truth", () => {
  test("an agent view that cannot be read changes nothing, and the record stays as it was", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const code = await runCrew(
      ["model", NAME, "--effort", "xhigh"],
      world.ctx({}, { FAKE_AGENTS_JSON: "not json" }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("agent view could not be read");
    expect(world.err[0]).toEndWith("nothing changed");
    expect(world.claudeVerbs()).toEqual(["agents"]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "high",
      state: "working",
    });
  });

  test("a stop that fails changes nothing: the process runs on, so the record goes back", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ effort: "xhigh", model: OPUS });
    const code = await runCrew(
      ["model", NAME, "--model", "sonnet"],
      world.ctx({}, { FAKE_AGENTS_JSON: liveView(world), FAKE_STOP: "fail" }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("claude stop a1b2c3d4 failed");
    expect(world.err[0]).toEndWith("nothing changed");
    expect(world.claudeVerbs()).toEqual(["agents", "stop", "agents"]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "xhigh",
      model: OPUS,
      state: "working",
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
    // Agent view is read; the session is neither stopped nor resumed.
    expect(world.claudeCalls()).toEqual([["agents", "--json", "--all"]]);
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

  test("workflow.crew.maxOpus holds a move onto opus across leads", async () => {
    const world = await boardWorld();
    world.writeConfig({ maxOpus: 1, perLeadOpus: 3 });
    await world.addCrew({
      leadSessionId: "other-lead-session",
      model: OPUS,
      phase: "B2",
      slug: "other",
      suffix: "2b2b2b",
    });
    await world.addCrew();
    expect(await runCrew(["model", NAME, "--model", "opus"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      `${NAME}: sonnet high → opus high · queued (1 of 1 opus crew sessions running on this machine; it starts when one of them finishes)`,
    ]);
  });

  test("a queued change that was replaced or dropped since the watch read it is not applied", async () => {
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
    const stale = await readCrew(world.paths.stateDir, world.repo, record.id);
    if (stale === null) throw new Error("no record");
    // The lead asks for what it runs on: the queued change is dropped. A place is free now.
    await runCrew(["model", NAME, "--model", "sonnet"], world.ctx());
    await updateCrew(world.paths.stateDir, world.repo, other.id, { state: "done" }, NOW);
    const checkout = locateCheckout(world.repo, { env: world.ctx().env });
    if (checkout === null) throw new Error("no checkout");
    const resolved = resolveWorkflow(world.paths, loadProjectConfig(checkout).config);
    const lines: string[] = [];
    await applyPendingModels([stale], world.ctx(), resolved, (line) => lines.push(line));
    expect(lines).toEqual([]);
    expect((await readCrew(world.paths.stateDir, world.repo, record.id))?.model).toEqual(SONNET);
  });

  test("a queued change of a crew session that ended is dropped", async () => {
    const world = await boardWorld();
    world.writeConfig({ perLeadOpus: 1 });
    await world.addCrew({ model: OPUS, phase: "B2", slug: "other", suffix: "2b2b2b" });
    const record = await world.addCrew();
    await runCrew(["model", NAME, "--model", "opus"], world.ctx());
    await updateCrew(world.paths.stateDir, world.repo, record.id, { state: "done" }, NOW);
    const checkout = locateCheckout(world.repo, { env: world.ctx().env });
    if (checkout === null) throw new Error("no checkout");
    const resolved = resolveWorkflow(world.paths, loadProjectConfig(checkout).config);
    await applyPendingModels(
      listCrew(world.paths.stateDir, world.repo).records,
      world.ctx(),
      resolved,
      () => undefined,
    );
    const after = await readCrew(world.paths.stateDir, world.repo, record.id);
    expect(after?.pendingLaunch).toBeUndefined();
    expect(after?.model).toEqual(SONNET);
  });

  test("IN1: a busy machine does not hold a change: it adds no place, so the load is not asked", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    // Load 40 on 4 cores is far past the limit that holds a start (`crew.loadPerCore`).
    const busy = world.ctx({ load: () => ({ cores: 4, oneMinute: 40 }) });
    expect(await runCrew(["model", NAME, "--model", "opus"], busy)).toBe(0);
    expect(world.err).toEqual([]);
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

  test("a blocked session waits for its answer first, and nothing is touched", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "blocked" });
    expect(await runCrew(["model", NAME, "--effort", "xhigh"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew model: ${NAME} is blocked, waiting for your answer; answer its question first (${COMMAND} crew answer), then change its model`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect((await readCrew(world.paths.stateDir, world.repo, record.id))?.effort).toBe("high");
  });

  test("a quiet session is moved like a working one", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "quiet" });
    expect(await runCrew(["model", NAME, "--effort", "xhigh"], world.ctx())).toBe(0);
    expect(world.out).toEqual([`${NAME}: sonnet high → sonnet xhigh · resumed (a1b2c3d4)`]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "xhigh",
      state: "working",
    });
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

describe("IN1: crew model and the plan's run record", () => {
  const LEAD = { name: LEAD_NAME, sessionId: LEAD_SESSION };

  /** A plan file in a temp folder: the run record of a crew session that names it is written beside it. */
  function planFileOf(): string {
    const plans = tempDir("plans");
    mkdirSync(plans, { recursive: true });
    const file = join(plans, "2026-10-21-master-plan.md");
    writeFileSync(file, "# the plan\n");
    return file;
  }

  /** The `note` lines of a crew session's run record. */
  function notesOf(planFile: string, id: string) {
    const run = readRunFile(runFile(planFile, id));
    return (run?.events ?? [])
      .filter((one) => one.kind === "note")
      .map((one) => ({ by: one.by, detail: one.detail, text: one.text }));
  }

  test("a change that lands is one line in the run: who changed it, from what and to what", async () => {
    const world = await boardWorld();
    const planFile = planFileOf();
    const record = await world.addCrew({ effort: "xhigh", model: OPUS, planFile });
    const code = await runCrew(
      ["model", NAME, "--model", "sonnet"],
      world.ctx({}, { FAKE_AGENTS_JSON: liveView(world) }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(notesOf(planFile, record.id)).toEqual([
      {
        by: LEAD,
        detail: {
          from: { effort: "xhigh", model: "opus" },
          to: { effort: "high", model: "sonnet" },
        },
        text: "model changed: opus xhigh → sonnet high",
      },
    ]);
  });

  test("an effort change alone is a line too, for a session with no process to move", async () => {
    const world = await boardWorld();
    const planFile = planFileOf();
    const record = await world.addCrew({ planFile, state: "stopped" });
    expect(await runCrew(["model", NAME, "--effort", "xhigh"], world.ctx())).toBe(0);
    expect(notesOf(planFile, record.id)).toEqual([
      {
        by: LEAD,
        detail: {
          from: { effort: "high", model: "sonnet" },
          to: { effort: "xhigh", model: "sonnet" },
        },
        text: "model changed: sonnet high → sonnet xhigh",
      },
    ]);
  });

  test("a stop that fails puts the record back, and the run says the change was undone", async () => {
    const world = await boardWorld();
    const planFile = planFileOf();
    const record = await world.addCrew({ effort: "xhigh", model: OPUS, planFile });
    const code = await runCrew(
      ["model", NAME, "--model", "sonnet"],
      world.ctx({}, { FAKE_AGENTS_JSON: liveView(world), FAKE_STOP: "fail" }),
    );
    expect(code).toBe(1);
    // Never a history that says it runs on sonnet when the record, and the process, say opus.
    expect(notesOf(planFile, record.id).map((one) => one.text)).toEqual([
      "model changed: opus xhigh → sonnet high",
      "model change undone: sonnet high → opus xhigh (the session could not be stopped)",
    ]);
  });

  test("a change an opus cap holds is no change yet: the run has no line until the watch applies it", async () => {
    const world = await boardWorld();
    world.writeConfig({ perLeadOpus: 1 });
    const planFile = planFileOf();
    const other = await world.addCrew({
      model: OPUS,
      phase: "B2",
      slug: "other",
      suffix: "2b2b2b",
    });
    const record = await world.addCrew({ planFile });
    expect(await runCrew(["model", NAME, "--model", "opus"], world.ctx())).toBe(0);
    expect(notesOf(planFile, record.id)).toEqual([]);
    const checkout = locateCheckout(world.repo, { env: world.ctx().env });
    if (checkout === null) throw new Error("no checkout");
    const resolved = resolveWorkflow(world.paths, loadProjectConfig(checkout).config);
    await updateCrew(world.paths.stateDir, world.repo, other.id, { state: "done" }, NOW);
    await applyPendingModels(
      listCrew(world.paths.stateDir, world.repo).records,
      world.ctx(),
      resolved,
      () => undefined,
    );
    expect(notesOf(planFile, record.id).map((one) => one.text)).toEqual([
      "model changed: sonnet high → opus high",
    ]);
  });

  test("asking for what it runs on changes nothing and writes no line", async () => {
    const world = await boardWorld();
    const planFile = planFileOf();
    const record = await world.addCrew({ planFile });
    expect(await runCrew(["model", NAME, "--effort", "high"], world.ctx())).toBe(0);
    expect(notesOf(planFile, record.id)).toEqual([]);
  });

  test("a crew session with no plan file has no run record, and the change goes on", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    expect(await runCrew(["model", NAME, "--effort", "xhigh"], world.ctx())).toBe(0);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      effort: "xhigh",
    });
  });
});
