/** `crew lead` (`lead.ts`): the calling session recorded as a lead, and its name as data (D26). */
import { describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { namesDir } from "../hooks/session-name";
import { crewWorld, LEAD_SESSION, SESSION_PID, writeSessionRecord } from "../testing/crew-world";
import { git, tempDir } from "../testing/temp";
import { runCrew } from "./command";
import { runCrewLead } from "./lead";
import { CREW_STEPS } from "./step";
import { listLeads, readLead } from "./store";

/** What `crew lead` says first when it finds no plan file for the plan (PL1). */
const NO_PLAN_FILE =
  "no plan file for master-plan: its briefs and run records are off; pass --plan-file <path>";

describe("D26: crew lead", () => {
  test("an explicitly ended lead is recorded; recording the plan again reopens it", async () => {
    const world = crewWorld();
    await runCrewLead({ plan: "master-plan", tag: null }, world.ctx());
    expect(await runCrewLead({ plan: null, tag: null, end: true }, world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.endedAt).toBe(
      "2026-10-21T10:00:00.000Z",
    );
    expect(world.out.at(-1)).toBe(
      "ended lead LEAD my-app master-plan; its crew work is kept unless the project base holds it",
    );
    await runCrewLead({ plan: null, tag: null }, world.ctx());
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.endedAt).toBeNull();
  });
  test("D26: the session's record, its LEAD <tag> <plan> name, and the next prompt's name", async () => {
    const world = crewWorld();
    expect(await runCrew(["lead", "--plan", "master-plan"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      NO_PLAN_FILE,
      `lead LEAD my-app master-plan (c00f9bb5): the crew this session starts in ${world.repo} report to it; this session takes that name at its next prompt`,
    ]);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)).toEqual({
      createdAt: "2026-10-21T10:00:00.000Z",
      cwd: world.repo,
      name: "LEAD my-app master-plan",
      plan: "master-plan",
      planFile: null,
      repo: world.repo,
      sessionId: LEAD_SESSION,
      tag: "my-app",
      updatedAt: "2026-10-21T10:00:00.000Z",
      version: 1,
    });
  });

  test("LD1: a session id no name record can be made for: the /rename line is the fallback", async () => {
    const world = crewWorld();
    writeSessionRecord(world.paths, SESSION_PID, "plain-session-id", world.repo);
    expect(await runCrew(["lead", "--plan", "master-plan"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, "plain-session-id")?.name).toBe(
      "LEAD my-app master-plan",
    );
    expect(world.out).toEqual([
      NO_PLAN_FILE,
      `lead LEAD my-app master-plan (plain-se): the crew this session starts in ${world.repo} report to it; this session's id cannot carry a session name, so type the next line in this session`,
      "/rename LEAD my-app master-plan",
    ]);
  });

  test("LD1: this project runs its own lead-notes hook: the /rename line too", async () => {
    const world = crewWorld();
    writeFileSync(
      join(world.repo, ".claude", "cc-smart-dev-kit.json"),
      JSON.stringify({ ownHooks: ["lead-notes"], workflow: { crew: { enabled: true } } }),
    );
    expect(await runCrew(["lead", "--plan", "master-plan"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      NO_PLAN_FILE,
      `lead LEAD my-app master-plan (c00f9bb5): the crew this session starts in ${world.repo} report to it; this project runs its own lead-notes hook, so type the next line if the name does not appear`,
      "/rename LEAD my-app master-plan",
    ]);
  });

  test("LD1: a name the kit already set: no promise of another prompt", async () => {
    const world = crewWorld();
    const env = { TMPDIR: tempDir("names") };
    mkdirSync(namesDir(env), { recursive: true });
    writeFileSync(join(namesDir(env), LEAD_SESSION), "LEAD my-app master-plan");
    expect(await runCrew(["lead", "--plan", "master-plan"], world.ctx({}, env))).toBe(0);
    expect(world.out).toEqual([
      NO_PLAN_FILE,
      `lead LEAD my-app master-plan (c00f9bb5): the crew this session starts in ${world.repo} report to it; this session already took that name, and a name given with /rename stays`,
    ]);
  });

  test("D26: --tag, else workflow.crew.tag, else the main checkout's folder name", async () => {
    const world = crewWorld();
    world.writeConfig({ tag: "kit" });
    expect(await runCrew(["lead", "--plan", "p"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.name).toBe("LEAD kit p");
    expect(await runCrew(["lead", "--plan", "p", "--tag", "app2"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.name).toBe("LEAD app2 p");
  });

  test("the plan: --plan, else the plan this session leads already, else the branch", async () => {
    const world = crewWorld();
    expect(await runCrew(["lead"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.plan).toBe("main");
    expect(await runCrew(["lead", "--plan", "master-plan"], world.ctx())).toBe(0);
    expect(await runCrew(["lead"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.plan).toBe("master-plan");
  });

  test("recorded again: the first time stays, and it is still one record", async () => {
    const world = crewWorld();
    await runCrew(["lead", "--plan", "a"], world.ctx());
    const later = world.ctx({ now: () => Date.parse("2026-10-21T11:00:00.000Z") });
    await runCrew(["lead", "--plan", "b"], later);
    expect(
      listLeads(world.paths.stateDir, world.repo).records.map((one) => [
        one.plan,
        one.createdAt,
        one.updatedAt,
      ]),
    ).toEqual([["b", "2026-10-21T10:00:00.000Z", "2026-10-21T11:00:00.000Z"]]);
  });

  test("from a worktree of the repository: the lead belongs to the main checkout's store", async () => {
    const world = crewWorld();
    const lead = join(world.repo, ".claude", "worktrees", "lead-work");
    git(world.repo, "worktree", "add", "-q", "-b", "plan-branch", lead, "HEAD");
    expect(await runCrew(["lead"], world.ctx({ cwd: lead }))).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)).toMatchObject({
      cwd: lead,
      plan: "plan-branch",
      repo: world.repo,
    });
  });

  test("a detached HEAD and no --plan: exit 2, say the plan", async () => {
    const world = crewWorld();
    git(world.repo, "checkout", "-q", "--detach", "HEAD");
    expect(await runCrew(["lead"], world.ctx())).toBe(2);
    expect(world.err).toEqual([
      "crew lead: this checkout is on no branch, so the plan has no name",
      "Fix: pass --plan <slug>",
    ]);
  });

  test("a folder name that leaves no tag asks for one", async () => {
    const world = crewWorld();
    const odd = join(world.repo, "..", "日本");
    renameSync(world.repo, odd);
    const ctx = world.ctx({ cwd: odd });
    expect(await runCrew(["lead", "--plan", "p"], ctx)).toBe(2);
    expect(world.err[0]).toStartWith(
      "crew lead: \"日本\" leaves no tag for a lead's or a crew session's name",
    );
  });

  test("refused: outside a Claude Code session, in a crew session, with crew sessions off", async () => {
    const world = crewWorld();
    const outside = world.ctx({ processes: { commandLineOf: () => null, parentOf: () => null } });
    expect(await runCrew(["lead"], outside)).toBe(1);
    expect(world.err).toEqual([
      "crew lead: no Claude Code session runs this command",
      "Fix: run it from the Bash tool of the session that leads",
    ]);
    world.err.length = 0;
    expect(await runCrew(["lead"], world.ctx({}, { CC_SMART_DEV_KIT_CREW: "x-1" }))).toBe(1);
    expect(world.err[0]).toBe(
      "crew lead: this session is the crew session x-1, and a crew session never leads",
    );
    world.err.length = 0;
    world.writeConfig({ enabled: false });
    expect(await runCrew(["lead"], world.ctx())).toBe(1);
    expect(world.err[0]).toBe(
      "crew lead: crew sessions are off in this project: turn them on with workflow.crew.enabled",
    );
    expect(listLeads(world.paths.stateDir, world.repo).records).toEqual([]);
  });

  test("outside git", async () => {
    const world = crewWorld();
    const plain = join(world.home, "plain");
    mkdirSync(plain);
    expect(await runCrew(["lead"], world.ctx({ cwd: plain }))).toBe(1);
    expect(world.err).toEqual([
      "crew lead: this folder is not in a git project",
      "Fix: run it in the project's folder",
    ]);
  });

  test.each([
    [
      ["lead", "--tag", "My App"],
      'The tag "My App" is not one: a tag is 1-12 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"',
    ],
    [["lead", "extra"], "Unknown argument: extra"],
    [["lead", "--plan"], "--plan needs a value"],
  ])("a wrong command line %j: exit 2", async (argv, line) => {
    const world = crewWorld();
    expect(await runCrew(argv, world.ctx())).toBe(2);
    expect(world.err).toEqual([`${line}\nSee: cc-smart-dev-kit crew --help`]);
  });
});

describe("the usage", () => {
  test("--help prints it, with every kind from the table", async () => {
    const world = crewWorld();
    expect(await runCrew(["--help"], world.ctx())).toBe(0);
    expect(await runCrew(["start", "--help"], world.ctx())).toBe(0);
    const [text] = world.out;
    expect(text).toStartWith("Usage: cc-smart-dev-kit crew <command>");
    expect(text).toContain("  build         sonnet: routine building");
    expect(text).toContain("  architecture  opus: architecture and design");
    expect(text).toContain("  ui            opus: UI and UX judgment");
    expect(world.out[1]).toBe(text);
  });

  test("--help names every step of a crew session's phase, in lines that fit the usage's width", async () => {
    const world = crewWorld();
    expect(await runCrew(["--help"], world.ctx())).toBe(0);
    const text = world.out[0] ?? "";
    for (const step of CREW_STEPS) expect(text).toContain(step);
    const stepLines = text
      .split("\n")
      .filter((line) => CREW_STEPS.some((step) => line.includes(step)));
    // The list is long enough to wrap, and no line of it runs past the usage's 80 columns.
    expect(stepLines.length).toBeGreaterThan(2);
    for (const line of stepLines) expect(line.length).toBeLessThanOrEqual(80);
  });

  test("no command: exit 2", async () => {
    const world = crewWorld();
    expect(await runCrew([], world.ctx())).toBe(2);
    expect(world.err).toEqual(["Say which crew command\nSee: cc-smart-dev-kit crew --help"]);
  });
});
