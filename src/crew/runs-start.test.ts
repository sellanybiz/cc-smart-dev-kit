/**
 * `crew start` and the plan's own folder (PL1): the brief a start takes when `--brief` is left
 * out, the lines that say which file it took, and the run record the start writes.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crewWorld, LEAD_SESSION, SHORT_ID } from "../testing/crew-world";
import { tempDir } from "../testing/temp";
import { runCrew } from "./command";
import { type CrewRecord, listCrew, listLeads, writeLead } from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
/** The sha-256 of the brief text below, from `printf … | sha256sum`. */
const BRIEF_SHA = "50dad91b5a7732afbf56f2d1892b64a824006dabc5f976511d22c61808ceb917";
const BRIEF_TEXT = "# B6b\n\nBuild the live stream.\n";
const NO_BRIEF = ["start", "B6b", "--slug", "portal-live", "--kind", "build"];

/** A world whose lead holds a plan file, with the brief of B6b in the plan's folder. */
async function plannedWorld(options: { brief?: boolean; planFile?: boolean } = {}) {
  const world = crewWorld();
  const plans = join(world.repo, ".claude", "plans");
  mkdirSync(plans, { recursive: true });
  const planFile = join(plans, "2026-10-21-master-plan.md");
  writeFileSync(planFile, "# the plan\n");
  const brief = join(plans, "2026-10-21-master-plan", "briefs", "B6b-portal-live.md");
  if (options.brief !== false) {
    mkdirSync(dirname(brief), { recursive: true });
    writeFileSync(brief, BRIEF_TEXT);
  }
  await writeLead(
    world.paths.stateDir,
    {
      cwd: world.repo,
      name: "LEAD my-app master-plan",
      plan: "master-plan",
      ...(options.planFile === false ? {} : { planFile }),
      repo: world.repo,
      sessionId: LEAD_SESSION,
      tag: "my-app",
    },
    T0,
  );
  return { ...world, brief, planFile };
}

/** The only crew session of the world. */
function onlyCrew(world: { paths: { stateDir: string }; repo: string }): CrewRecord {
  const { records } = listCrew(world.paths.stateDir, world.repo);
  expect(records).toHaveLength(1);
  return records[0] as CrewRecord;
}

/** The run record file of a crew session, parsed. */
function runOf(world: { brief: string }, record: CrewRecord) {
  return JSON.parse(
    readFileSync(join(dirname(dirname(world.brief)), "runs", `${record.id}.json`), "utf8"),
  );
}

describe("PL1: crew start and the plan's own folder", () => {
  test("no --brief: the plan's folder holds it, the line says which file, and the run is recorded", async () => {
    const world = await plannedWorld();
    expect(await runCrew(NO_BRIEF, world.ctx())).toBe(0);
    expect(world.out[0]).toBe(`brief: ${world.brief} (the plan's folder)`);
    expect(world.out[1]).toStartWith("started C my-app master-plan B6b portal-live");
    const record = onlyCrew(world);
    expect(record.planFile).toBe(world.planFile);
    expect(record.briefSource).toEqual({ path: world.brief, sha256: BRIEF_SHA });
    const run = runOf(world, record);
    expect(run.brief).toEqual({ path: world.brief, sha256: BRIEF_SHA });
    expect(run.lead).toEqual({ name: "LEAD my-app master-plan", sessionId: LEAD_SESSION });
    expect(run.sessions.map((one: { shortId: string }) => one.shortId)).toEqual([SHORT_ID]);
    expect(run.events.map((one: { kind: string }) => one.kind)).toEqual(["created", "session"]);
  });

  test("no --brief and none in the plan's folder: refused with the path it looked for", async () => {
    const world = await plannedWorld({ brief: false });
    expect(await runCrew(NO_BRIEF, world.ctx())).toBe(1);
    expect(world.err).toHaveLength(2);
    expect(world.err[0]).toStartWith(`crew start: the brief ${world.brief} cannot be read`);
    expect(world.err[1]).toBe("Fix: write the brief at that path, or pass --brief <file>");
    expect(listCrew(world.paths.stateDir, world.repo).records).toEqual([]);
  });

  test("no --brief and no plan file anywhere: refused, and the fix names crew lead --plan-file", async () => {
    const world = await plannedWorld({ planFile: false });
    // The lookup finds a plan file by its slug in the repo's plans folder: take it away.
    rmSync(world.planFile);
    expect(await runCrew(NO_BRIEF, world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew start: no --brief was given, and this lead has no plan file to find the brief in",
      "Fix: pass --brief <file>, or run cc-smart-dev-kit crew lead --plan-file <path> first",
    ]);
  });

  test("a lead recorded before its plan was written finds the plan file at the next start", async () => {
    const world = await plannedWorld({ planFile: false });
    expect(await runCrew(NO_BRIEF, world.ctx())).toBe(0);
    expect(onlyCrew(world).planFile).toBe(world.planFile);
    expect(listLeads(world.paths.stateDir, world.repo).records[0]?.planFile).toBe(world.planFile);
  });

  test("--brief still works, and the run keeps that file as its brief", async () => {
    const world = await plannedWorld();
    const other = join(tempDir("brief"), "other.md");
    writeFileSync(other, BRIEF_TEXT);
    expect(await runCrew([...NO_BRIEF, "--brief", other], world.ctx())).toBe(0);
    expect(world.out[0]).toStartWith("started ");
    expect(onlyCrew(world).briefSource?.path).toBe(other);
  });

  test("a queued start is recorded too, with no session yet", async () => {
    const world = await plannedWorld();
    expect(await runCrew([...NO_BRIEF, "--waits-for", "A1"], world.ctx())).toBe(0);
    const record = onlyCrew(world);
    expect(record.state).toBe("queued");
    const run = runOf(world, record);
    expect(run.sessions).toEqual([]);
    expect(run.times.startedAt).toBeNull();
  });
});
