/** `worker lead` (`lead.ts`): the calling session recorded as a lead, and its name as data (D26). */
import { describe, expect, test } from "bun:test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { git } from "../testing/temp";
import { LEAD_SESSION, workerWorld } from "../testing/worker-world";
import { runWorker } from "./command";
import { listLeads, readLead } from "./store";

describe("D26: worker lead", () => {
  test("D26: the session's record, its LEAD <tag> <plan> name, and the /rename line", async () => {
    const world = workerWorld();
    expect(await runWorker(["lead", "--plan", "master-plan"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      `lead LEAD my-app master-plan (c00f9bb5): the workers this session starts in ${world.repo} report to it; to show the name now, type the next line in this session`,
      "/rename LEAD my-app master-plan",
    ]);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)).toEqual({
      createdAt: "2026-10-21T10:00:00.000Z",
      cwd: world.repo,
      name: "LEAD my-app master-plan",
      plan: "master-plan",
      repo: world.repo,
      sessionId: LEAD_SESSION,
      tag: "my-app",
      updatedAt: "2026-10-21T10:00:00.000Z",
      version: 1,
    });
  });

  test("D26: --tag, else workflow.workers.tag, else the main checkout's folder name", async () => {
    const world = workerWorld();
    world.writeConfig({ tag: "kit" });
    expect(await runWorker(["lead", "--plan", "p"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.name).toBe("LEAD kit p");
    expect(await runWorker(["lead", "--plan", "p", "--tag", "app2"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.name).toBe("LEAD app2 p");
  });

  test("the plan: --plan, else the plan this session leads already, else the branch", async () => {
    const world = workerWorld();
    expect(await runWorker(["lead"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.plan).toBe("main");
    expect(await runWorker(["lead", "--plan", "master-plan"], world.ctx())).toBe(0);
    expect(await runWorker(["lead"], world.ctx())).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.plan).toBe("master-plan");
  });

  test("recorded again: the first time stays, and it is still one record", async () => {
    const world = workerWorld();
    await runWorker(["lead", "--plan", "a"], world.ctx());
    const later = world.ctx({ now: () => Date.parse("2026-10-21T11:00:00.000Z") });
    await runWorker(["lead", "--plan", "b"], later);
    expect(
      listLeads(world.paths.stateDir, world.repo).records.map((one) => [
        one.plan,
        one.createdAt,
        one.updatedAt,
      ]),
    ).toEqual([["b", "2026-10-21T10:00:00.000Z", "2026-10-21T11:00:00.000Z"]]);
  });

  test("from a worktree of the repository: the lead belongs to the main checkout's store", async () => {
    const world = workerWorld();
    const lead = join(world.repo, ".claude", "worktrees", "lead-work");
    git(world.repo, "worktree", "add", "-q", "-b", "plan-branch", lead, "HEAD");
    expect(await runWorker(["lead"], world.ctx({ cwd: lead }))).toBe(0);
    expect(readLead(world.paths.stateDir, world.repo, LEAD_SESSION)).toMatchObject({
      cwd: lead,
      plan: "plan-branch",
      repo: world.repo,
    });
  });

  test("a detached HEAD and no --plan: exit 2, say the plan", async () => {
    const world = workerWorld();
    git(world.repo, "checkout", "-q", "--detach", "HEAD");
    expect(await runWorker(["lead"], world.ctx())).toBe(2);
    expect(world.err).toEqual([
      "worker lead: this checkout is on no branch, so the plan has no name",
      "Fix: pass --plan <slug>",
    ]);
  });

  test("a folder name that leaves no tag asks for one", async () => {
    const world = workerWorld();
    const odd = join(world.repo, "..", "日本");
    renameSync(world.repo, odd);
    const ctx = world.ctx({ cwd: odd });
    expect(await runWorker(["lead", "--plan", "p"], ctx)).toBe(2);
    expect(world.err[0]).toStartWith(
      "worker lead: \"日本\" leaves no tag for a lead's or a worker's name",
    );
  });

  test("refused: outside a Claude Code session, in a worker, with workers off", async () => {
    const world = workerWorld();
    const outside = world.ctx({ processes: { commandLineOf: () => null, parentOf: () => null } });
    expect(await runWorker(["lead"], outside)).toBe(1);
    expect(world.err).toEqual([
      "worker lead: no Claude Code session runs this command",
      "Fix: run it from the Bash tool of the session that leads",
    ]);
    world.err.length = 0;
    expect(await runWorker(["lead"], world.ctx({}, { CC_SMART_DEV_KIT_WORKER: "x-1" }))).toBe(1);
    expect(world.err[0]).toBe(
      "worker lead: this session is the worker x-1, and a worker never leads",
    );
    world.err.length = 0;
    world.writeConfig({ enabled: false });
    expect(await runWorker(["lead"], world.ctx())).toBe(1);
    expect(world.err[0]).toBe(
      "worker lead: workers are off in this project: turn them on with workflow.workers.enabled",
    );
    expect(listLeads(world.paths.stateDir, world.repo).records).toEqual([]);
  });

  test("outside git", async () => {
    const world = workerWorld();
    const plain = join(world.home, "plain");
    mkdirSync(plain);
    expect(await runWorker(["lead"], world.ctx({ cwd: plain }))).toBe(1);
    expect(world.err).toEqual([
      "worker lead: this folder is not in a git project",
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
    const world = workerWorld();
    expect(await runWorker(argv, world.ctx())).toBe(2);
    expect(world.err).toEqual([`${line}\nSee: cc-smart-dev-kit worker --help`]);
  });
});

describe("the usage", () => {
  test("--help prints it, with every kind from the table", async () => {
    const world = workerWorld();
    expect(await runWorker(["--help"], world.ctx())).toBe(0);
    expect(await runWorker(["start", "--help"], world.ctx())).toBe(0);
    const [text] = world.out;
    expect(text).toStartWith("Usage: cc-smart-dev-kit worker <command>");
    expect(text).toContain("  build         sonnet: routine building");
    expect(text).toContain("  architecture  opus: architecture and design");
    expect(text).toContain("  ui            opus: UI and UX judgment");
    expect(world.out[1]).toBe(text);
  });

  test("no command: exit 2", async () => {
    const world = workerWorld();
    expect(await runWorker([], world.ctx())).toBe(2);
    expect(world.err).toEqual([
      "Say which worker command: lead or start\nSee: cc-smart-dev-kit worker --help",
    ]);
  });
});
