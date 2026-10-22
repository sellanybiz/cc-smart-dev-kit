/**
 * `crew start` (`start.ts`), end to end in a temp world: a real git repo, the crew store in a
 * temp state folder, and a fake `claude` on PATH that logs its argv (`src/testing/crew-world.ts`).
 * No test starts a real Claude session.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  crewWorld,
  LEAD_SESSION,
  OTHER_SESSION,
  SHORT_ID,
  writeSessionRecord,
} from "../testing/crew-world";
import { git, tempDir } from "../testing/temp";
import { runCrew } from "./command";
import {
  type CrewRecord,
  createCrew,
  crewBriefFile,
  crewSettingsFile,
  listCrew,
  readCrewEvents,
  writeLead,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";

/** A world whose session is a registered lead (`crew lead` already ran). */
async function ledWorld() {
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
  const brief = join(tempDir("brief"), "brief.md");
  writeFileSync(brief, "# B6b\n\nBuild the live stream.\n");
  return { ...world, brief };
}

/** The arguments of a plain start of B6b. */
function startArgs(brief: string, ...more: string[]): string[] {
  return ["start", "B6b", "--slug", "portal-live", "--kind", "build", "--brief", brief, ...more];
}

/** The one crew session recorded in the world's repo. */
function onlyCrew(stateDir: string, repo: string): CrewRecord {
  const { records } = listCrew(stateDir, repo);
  expect(records).toHaveLength(1);
  return records[0] as CrewRecord;
}

/** A recorded crew session of another repository, in `state`. */
async function otherCrew(
  stateDir: string,
  n: number,
  state: string,
  phase = `P${n}`,
  tier: null | string = null,
) {
  await createCrew(
    stateDir,
    {
      base: null,
      baseRef: "main",
      branch: `crew/${phase}-x`,
      effort: "high",
      files: [],
      id: `${phase}-x-${n}`,
      kind: "build",
      lastLine: null,
      leadName: "LEAD other plan",
      leadSessionId: "other-lead",
      memoryMb: null,
      model: { named: tier ?? "sonnet", resolved: tier ?? "sonnet", slot: null, tier },
      name: `C other ${phase} x`,
      permissionMode: "auto",
      phase,
      plan: "plan",
      pr: null,
      questions: [],
      repo: "/home/user/other-app",
      reportPath: null,
      sessionId: null,
      shortId: null,
      slug: "x",
      state,
      waitsFor: [],
      worktree: "/home/user/other-app/.claude/worktrees/crew-x",
    },
    T0,
  );
}

describe("D25: crew start returns at once", () => {
  test("D25: started — one line, the exact launch, the record, its events and its files", async () => {
    const world = await ledWorld();
    const head = git(world.repo, "rev-parse", "HEAD").trim();
    const code = await runCrew(
      startArgs(world.brief, "--files", "src/a.ts, src/b.ts"),
      world.ctx(),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      `started C my-app B6b portal-live (${SHORT_ID}) · sonnet high · crew/B6b-portal-live @ ${head.slice(0, 7)}`,
    ]);
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    const briefFile = crewBriefFile(world.paths.stateDir, world.repo, ID);
    const settingsFile = crewSettingsFile(world.paths.stateDir, world.repo, ID);
    expect(world.claudeCalls()).toEqual([
      [
        "--bg",
        "-w",
        "crew-B6b-portal-live",
        "--name",
        "C my-app B6b portal-live",
        "--model",
        "sonnet",
        "--effort",
        "high",
        "--permission-mode",
        "auto",
        "--autocompact",
        "auto",
        "--settings",
        settingsFile,
        `You are the crew session C my-app B6b portal-live for the lead LEAD my-app master-plan. Work by /cc-smart-dev-kit:crew. Read ${briefFile} first: it is your task, and it says how you report.`,
      ],
      ["agents", "--json", "--all"],
    ]);
    expect(onlyCrew(world.paths.stateDir, world.repo)).toEqual({
      base: { ref: "main", sha: head },
      baseRef: "main",
      branch: "crew/B6b-portal-live",
      // A first crew session for its phase continues no one: only `--continue` records the old id.
      continues: null,
      createdAt: "2026-10-21T10:00:00.000Z",
      effort: "high",
      files: ["src/a.ts", "src/b.ts"],
      id: ID,
      kind: "build",
      lastLine: null,
      leadName: "LEAD my-app master-plan",
      leadSessionId: LEAD_SESSION,
      memoryMb: null,
      model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
      name: "C my-app B6b portal-live",
      permissionMode: "auto",
      phase: "B6b",
      plan: "master-plan",
      pr: null,
      questions: [],
      reportPath: null,
      repo: world.repo,
      sessionId: `${SHORT_ID}-0000-1111-2222-333333333333`,
      shortId: SHORT_ID,
      slug: "portal-live",
      // When its session started: the crew session's own time caps count from here.
      startedAt: "2026-10-21T10:00:00.000Z",
      // `starting` until its own SessionStart hook says it is in its worktree: `claude agents
      // --json` reports the launch folder until a `-w` session has entered it (2.1.308), so the
      // launcher cannot judge the folder.
      state: "starting",
      updatedAt: "2026-10-21T10:00:00.000Z",
      version: 1,
      waitsFor: [],
      worktree,
    });
    expect(
      readCrewEvents(world.paths.stateDir, world.repo).events.map((one) => [
        one.type,
        one.state,
        one.text,
      ]),
    ).toEqual([["created", "starting", null]]);
    // The worktree is the launcher's own, on its branch, at the lead's HEAD.
    expect(git(worktree, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("crew/B6b-portal-live");
    expect(git(worktree, "rev-parse", "HEAD").trim()).toBe(head);
    // The settings file names the crew session to its own session, and turns Claude Code's retry
    // watchdog on with no wait limit (D42): exactly these three keys, and nothing else; both
    // files are the kit's, 0600.
    expect(readFileSync(settingsFile, "utf8")).toBe(
      `{\n  "env": {\n    "CC_SMART_DEV_KIT_CREW": "${ID}",\n    "CLAUDE_CODE_RETRY_WATCHDOG": "1",\n    "CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS": "300000"\n  }\n}\n`,
    );
    expect(statSync(settingsFile).mode & 0o777).toBe(0o600);
    const brief = readFileSync(briefFile, "utf8");
    expect(brief).toStartWith("# B6b\n\nBuild the live stream.\n\n---\n\n## Your frame");
    expect(brief).toContain(
      `Your worktree is \`${worktree}\`, on the branch \`crew/B6b-portal-live\``,
    );
    expect(brief).toContain("The files this phase owns: `src/a.ts`, `src/b.ts`.");
  });

  test("D46: an opus kind starts on opus at xhigh", async () => {
    const world = await ledWorld();
    const args = [
      "start",
      "W1a",
      "--slug",
      "launcher",
      "--kind",
      "architecture",
      "--brief",
      world.brief,
    ];
    expect(await runCrew(args, world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· opus xhigh ·");
    expect(world.claudeCalls()[0]?.slice(5, 9)).toEqual(["--model", "opus", "--effort", "xhigh"]);
  });

  test("the brief from stdin", async () => {
    const world = await ledWorld();
    const ctx = world.ctx({ readStdin: () => Promise.resolve("From stdin.\n") });
    expect(await runCrew(startArgs("-"), ctx)).toBe(0);
    expect(readFileSync(crewBriefFile(world.paths.stateDir, world.repo, ID), "utf8")).toStartWith(
      "From stdin.\n\n---\n",
    );
  });

  test("an empty brief is refused (exit 2), and nothing is recorded", async () => {
    const world = await ledWorld();
    const ctx = world.ctx({ readStdin: () => Promise.resolve("  \n") });
    expect(await runCrew(startArgs("-"), ctx)).toBe(2);
    expect(world.err).toEqual(["crew start: the brief is empty"]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toEqual([]);
  });

  test("a brief file that is not there is refused (exit 1)", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs("/nowhere/brief.md"), world.ctx())).toBe(1);
    expect(world.err[0]).toStartWith("crew start: the brief /nowhere/brief.md cannot be read (");
  });

  test("started from a worktree of the lead: the base is that worktree's branch", async () => {
    const world = await ledWorld();
    const lead = join(world.repo, ".claude", "worktrees", "lead-work");
    git(world.repo, "worktree", "add", "-q", "-b", "feature", lead, "HEAD");
    writeFileSync(join(lead, "feature.txt"), "x\n");
    git(lead, "add", ".");
    git(lead, "commit", "-q", "-m", "feature");
    const featureHead = git(lead, "rev-parse", "HEAD").trim();
    expect(await runCrew(startArgs(world.brief), world.ctx({ cwd: lead }))).toBe(0);
    const record = onlyCrew(world.paths.stateDir, world.repo);
    expect(record.base).toEqual({ ref: "feature", sha: featureHead });
    expect(record.worktree).toBe(join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live"));
  });

  test("--base names the commit to cut from", async () => {
    const world = await ledWorld();
    const first = git(world.repo, "rev-parse", "HEAD").trim();
    writeFileSync(join(world.repo, "two.txt"), "2\n");
    git(world.repo, "add", ".");
    git(world.repo, "commit", "-q", "-m", "two");
    expect(await runCrew(startArgs(world.brief, "--base", first), world.ctx())).toBe(0);
    expect(onlyCrew(world.paths.stateDir, world.repo).base).toEqual({ ref: first, sha: first });
  });

  test("a base ref that does not exist is refused, and nothing is recorded", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief, "--base", "no-such-branch"), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew start: the base no-such-branch is no commit here",
      "Fix: name a branch or a commit with --base",
    ]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toEqual([]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("the .worktreeinclude files are copied into the new worktree", async () => {
    const world = await ledWorld();
    writeFileSync(join(world.repo, ".worktreeinclude"), ".env.local\n");
    git(world.repo, "add", ".worktreeinclude");
    git(world.repo, "commit", "-q", "-m", "include");
    writeFileSync(join(world.repo, ".env.local"), "KEY=1\n");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    expect(readFileSync(join(worktree, ".env.local"), "utf8")).toBe("KEY=1\n");
  });
});

describe("the refusals before anything is recorded", () => {
  test("D34: crew sessions off in this project: the way to turn them on", async () => {
    const world = await ledWorld();
    world.writeConfig({ enabled: false });
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew start: crew sessions are off in this project: turn them on with workflow.crew.enabled",
      "Fix: cc-smart-dev-kit workflow set crew.enabled true --project (this project), or the same without --project (every project of yours)",
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toEqual([]);
  });

  test("D34: the person's own workflow.json turns them on where the project says nothing", async () => {
    const world = await ledWorld();
    writeFileSync(join(world.repo, ".claude", "cc-smart-dev-kit.json"), "{}");
    mkdirSync(join(world.home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(world.paths.workflowConfigFile, '{"crew":{"enabled":true}}');
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
  });

  test("called from a crew session: a crew session never starts crew sessions", async () => {
    const world = await ledWorld();
    const ctx = world.ctx({}, { CC_SMART_DEV_KIT_CREW: "K-contracts-000000" });
    expect(await runCrew(startArgs(world.brief), ctx)).toBe(1);
    expect(world.err).toEqual([
      "crew start: this session is the crew session K-contracts-000000, and a crew session never starts crew sessions",
      'Fix: hand the need to your lead: cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" --option "<choice>"',
    ]);
  });

  test("no lead recorded for this session", async () => {
    const world = crewWorld();
    const brief = join(tempDir("brief"), "b.md");
    writeFileSync(brief, "x");
    expect(await runCrew(startArgs(brief), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew start: this session is no lead in ${world.repo}`,
      "Fix: run cc-smart-dev-kit crew lead --plan <slug> in it first",
    ]);
  });

  test("outside a Claude Code session", async () => {
    const world = await ledWorld();
    const ctx = world.ctx({ processes: { commandLineOf: () => null, parentOf: () => null } });
    expect(await runCrew(startArgs(world.brief), ctx)).toBe(1);
    expect(world.err).toEqual([
      "crew start: no Claude Code session runs this command",
      "Fix: run it from the Bash tool of the session that leads",
    ]);
  });

  test("a lead in bypass mode: its command line, or its settings", async () => {
    const world = await ledWorld();
    const ctx = world.ctx({
      processes: {
        commandLineOf: () => "claude --dangerously-skip-permissions",
        parentOf: (pid) => ({ 300: 1, 400: 300, 500: 400 })[pid] ?? null,
      },
    });
    expect(await runCrew(startArgs(world.brief), ctx)).toBe(1);
    expect(world.err).toEqual([
      "crew start: this session was started in bypassPermissions mode, and a lead there acts on every crew session's message with no question",
      "Fix: restart this session in another permission mode (auto, say)",
    ]);
    world.err.length = 0;
    const local = join(world.repo, ".claude", "settings.local.json");
    writeFileSync(local, '{"permissions":{"defaultMode":"bypassPermissions"}}');
    const plain = world.ctx({
      processes: {
        commandLineOf: () => "claude",
        parentOf: (pid) => ({ 300: 1, 400: 300, 500: 400 })[pid] ?? null,
      },
    });
    expect(await runCrew(startArgs(world.brief), plain)).toBe(1);
    expect(world.err[0]).toBe(
      `crew start: ${local} sets permissions.defaultMode to bypassPermissions, and a lead there acts on every crew session's message with no question`,
    );
  });

  test("claude missing: refused, nothing recorded", async () => {
    const world = await ledWorld();
    const ctx = world.ctx({ which: () => null });
    expect(await runCrew(startArgs(world.brief), ctx)).toBe(1);
    expect(world.err).toEqual([
      "crew start: claude is not on PATH, nor in ~/.local/bin",
      "Fix: install Claude Code, or put its folder on PATH",
    ]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toEqual([]);
  });

  test.each([
    [["start"], "Say which phase: crew start <phase> …"],
    [
      ["start", "B6b", "--kind", "build", "--brief", "-"],
      "Say the crew session's slug: --slug <slug>",
    ],
    [
      ["start", "B6b", "--slug", "x", "--brief", "-"],
      "Say the phase's kind: --kind <build|docs|tests|security|money|permissions|schema|deploy|architecture|ui>",
    ],
    [
      ["start", "B6b", "--slug", "x", "--kind", "magic", "--brief", "-"],
      "Unknown kind: magic (the kinds: build, docs, tests, security, money, permissions, schema, deploy, architecture, ui)",
    ],
    [
      ["start", "B6b", "--slug", "x", "--kind", "build"],
      "Give the crew session its brief: --brief <file>, or --brief - for stdin",
    ],
    [
      ["start", "B6b", "--slug", "x", "--kind", "build", "--brief", "-", "--effort", "low"],
      "Unknown effort: low (a crew session runs at medium, high, xhigh, max)",
    ],
    [
      ["start", "B6b", "--slug", "x y", "--kind", "build", "--brief", "-"],
      'The slug "x y" is not one: a slug is 1-32 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"',
    ],
    [
      ["start", "B6b", "--slug", "x", "--kind", "build", "--brief", "-", "--waits-for", "B6b"],
      "The phase B6b cannot wait for itself",
    ],
    [["start", "B6b", "--slug", "x", "--slug", "y"], "--slug is given twice"],
    [["start", "B6b", "--wait"], "Unknown option: --wait"],
    [["nope"], "Unknown crew command: nope"],
  ])("a wrong command line %j: exit 2, one line and the help", async (argv, line) => {
    const world = crewWorld();
    expect(await runCrew(argv, world.ctx())).toBe(2);
    expect(world.err).toEqual([`${line}\nSee: cc-smart-dev-kit crew --help`]);
  });

  test("an override the agent guard would ask about is refused: opus at max", async () => {
    const world = await ledWorld();
    const code = await runCrew(
      startArgs(world.brief, "--model", "opus", "--effort", "max"),
      world.ctx(),
    );
    expect(code).toBe(2);
    expect(world.err).toEqual([
      "crew start: the agent guard asks the person before opus at effort max (Claude Opus launch at effort `max`: `general-purpose`.), and crew start never asks: pick a model and effort it runs with no question, or the person starts that session themselves",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("an override the agent guard refuses is refused with its words: Fable", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief, "--model", "fable"), world.ctx())).toBe(2);
    expect(world.err[0]).toStartWith(
      "crew start: the agent guard refuses fable at effort high: This launch would run on",
    );
  });

  test("an override the guard allows runs: opus at high", async () => {
    const world = await ledWorld();
    expect(
      await runCrew(startArgs(world.brief, "--model", "opus", "--effort", "high"), world.ctx()),
    ).toBe(0);
    expect(world.out[0]).toContain("· opus high ·");
  });

  test("D50: a ui session starts on opus at high by default", async () => {
    const world = await ledWorld();
    const argv = startArgs(world.brief);
    argv[argv.indexOf("build")] = "ui";
    expect(await runCrew(argv, world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· opus high ·");
    expect(world.claudeCalls()[0]?.slice(5, 9)).toEqual(["--model", "opus", "--effort", "high"]);
  });

  test.each([
    [["--model", "sonnet"]],
    [["--model", "haiku"]],
    [["--effort", "medium"]],
    [["--model", "sonnet", "--effort", "xhigh"]],
  ])("D50: a ui session refuses the override %j, with one plain line", async (more) => {
    const world = await ledWorld();
    const argv = startArgs(world.brief, ...more);
    argv[argv.indexOf("build")] = "ui";
    expect(await runCrew(argv, world.ctx())).toBe(2);
    expect(world.err).toEqual([
      "crew start: UI/UX work runs only on `opus` or `fable` at `high`, `xhigh` or `max` (D50): pick one of those for a `ui` session.",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("D50: a ui session takes an opus override at xhigh, and other kinds keep theirs", async () => {
    const world = await ledWorld();
    const ui = startArgs(world.brief, "--model", "opus", "--effort", "xhigh");
    ui[ui.indexOf("build")] = "ui";
    expect(await runCrew(ui, world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· opus xhigh ·");
    // The rule is the `ui` kind's alone: a build session on sonnet is still routine work.
    const other = await ledWorld();
    expect(await runCrew(startArgs(other.brief, "--model", "sonnet"), other.ctx())).toBe(0);
    expect(other.out[0]).toContain("· sonnet high ·");
  });
});

describe("D25: the queue — still one line, at once", () => {
  test("D25: the cap reached across repositories: queued, no worktree, no session", async () => {
    const world = await ledWorld();
    for (const n of [1, 2, 3, 4, 5, 6]) await otherCrew(world.paths.stateDir, n, "working");
    await otherCrew(world.paths.stateDir, 7, "done");
    await otherCrew(world.paths.stateDir, 8, "queued");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app B6b portal-live: 6 of 6 running; it starts when one finishes",
    ]);
    const record = onlyCrew(world.paths.stateDir, world.repo);
    expect(record).toMatchObject({ base: null, baseRef: "main", state: "queued" });
    expect(existsSync(record.worktree)).toBe(false);
    expect(world.claudeCalls()).toEqual([]);
    // Its brief is written now: the watch starts it later from the record and these files.
    expect(existsSync(crewBriefFile(world.paths.stateDir, world.repo, ID))).toBe(true);
  });

  test("D37: an opus crew session is queued at 2 opus crew sessions running while the total is under 6", async () => {
    const world = await ledWorld();
    await otherCrew(world.paths.stateDir, 1, "working", "P1", "opus");
    await otherCrew(world.paths.stateDir, 2, "blocked", "P2", "opus");
    await otherCrew(world.paths.stateDir, 3, "done", "P3", "opus");
    await otherCrew(world.paths.stateDir, 4, "working");
    const opusArgs = [
      "start",
      "W1a",
      "--slug",
      "launcher",
      "--kind",
      "architecture",
      "--brief",
      world.brief,
    ];
    expect(await runCrew(opusArgs, world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app W1a launcher: 2 of 2 opus crew sessions running; it starts when one of them finishes",
    ]);
    // An override onto opus counts too.
    const onto = startArgs(world.brief, "--model", "opus", "--effort", "high");
    expect(await runCrew(onto, world.ctx({ randomSuffix: () => "000001" }))).toBe(0);
    expect(world.out[1]).toBe(
      "queued C my-app B6b portal-live: 2 of 2 opus crew sessions running; it starts when one of them finishes",
    );
  });

  test("D37: a sonnet crew session still starts then, and its record names no tier", async () => {
    const world = await ledWorld();
    await otherCrew(world.paths.stateDir, 1, "working", "P1", "opus");
    await otherCrew(world.paths.stateDir, 2, "working", "P2", "opus");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out[0]).toStartWith("started C my-app B6b portal-live (");
    expect(onlyCrew(world.paths.stateDir, world.repo).model.tier).toBeNull();
  });

  test("D37: workflow.crew.maxOpus of the project sets the opus cap; an opus crew records its tier", async () => {
    const world = await ledWorld();
    world.writeConfig({ maxOpus: 3 });
    await otherCrew(world.paths.stateDir, 1, "working", "P1", "opus");
    await otherCrew(world.paths.stateDir, 2, "working", "P2", "opus");
    const opusArgs = [
      "start",
      "W1a",
      "--slug",
      "launcher",
      "--kind",
      "architecture",
      "--brief",
      world.brief,
    ];
    expect(await runCrew(opusArgs, world.ctx())).toBe(0);
    expect(world.out[0]).toStartWith("started C my-app W1a launcher (");
    expect(onlyCrew(world.paths.stateDir, world.repo).model).toEqual({
      named: "opus",
      resolved: "opus",
      slot: null,
      tier: "opus",
    });
  });

  test("workflow.crew.max of the project sets the cap", async () => {
    const world = await ledWorld();
    world.writeConfig({ max: 1 });
    await otherCrew(world.paths.stateDir, 1, "blocked");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app B6b portal-live: 1 of 1 running; it starts when one finishes",
    ]);
  });

  test("less free memory than workflow.crew.memoryGb: queued", async () => {
    const world = await ledWorld();
    world.writeConfig({ memoryGb: 3 });
    const ctx = world.ctx({ freeMemoryGb: () => Promise.resolve(2.04) });
    expect(await runCrew(startArgs(world.brief), ctx)).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app B6b portal-live: 2 GB free, a crew session needs 3 GB; it starts when memory frees",
    ]);
  });

  test("--waits-for a phase not done: queued, and the record keeps what it waits for", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief, "--waits-for", "B6a,B7"), world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app B6b portal-live: waits for B6a (not started yet), B7 (not started yet); it starts when each is merged",
    ]);
    expect(onlyCrew(world.paths.stateDir, world.repo).waitsFor).toEqual(["B6a", "B7"]);
  });

  test("--waits-for a phase that is done but not merged: it waits for the merge", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    const first = onlyCrew(world.paths.stateDir, world.repo);
    const { updateCrew } = await import("./store");
    await updateCrew(world.paths.stateDir, world.repo, first.id, { state: "done" }, T0);
    const args = [
      "start",
      "B7",
      "--slug",
      "always-on",
      "--kind",
      "security",
      "--brief",
      world.brief,
    ];
    expect(await runCrew([...args, "--waits-for", "B6b"], world.ctx())).toBe(0);
    expect(world.out[1]).toStartWith("queued C my-app B7 always-on: waits for B6b (done)");
  });

  test("--waits-for a phase the lead merged: it starts", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    const first = onlyCrew(world.paths.stateDir, world.repo);
    const { updateCrew } = await import("./store");
    await updateCrew(world.paths.stateDir, world.repo, first.id, { state: "merged" }, T0);
    const args = [
      "start",
      "B7",
      "--slug",
      "always-on",
      "--kind",
      "security",
      "--brief",
      world.brief,
    ];
    expect(await runCrew([...args, "--waits-for", "B6b"], world.ctx())).toBe(0);
    expect(world.out[1]).toStartWith("started C my-app B7 always-on (");
  });
});

describe("a name already in use", () => {
  test("a crew session of the same phase and slug in the store", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew start: C my-app B6b portal-live is recorded already, starting, on crew/B6b-portal-live",
      'Fix: remove it first (cc-smart-dev-kit crew rm "C my-app B6b portal-live"), or pick another --slug',
    ]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toHaveLength(1);
  });

  test("the branch is there already", async () => {
    const world = await ledWorld();
    git(world.repo, "branch", "crew/B6b-portal-live");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew start: the branch crew/B6b-portal-live is there already, for C my-app B6b portal-live",
      "Fix: delete it, or pick another --slug",
    ]);
  });

  test("the folder is there already", async () => {
    const world = await ledWorld();
    mkdirSync(join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live"), {
      recursive: true,
    });
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(1);
    expect(world.err[0]).toBe(
      `crew start: the folder ${join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live")} is there already`,
    );
  });
});

describe("a launch that fails: the crew session is failed, with the reason", () => {
  test("Workspace not trusted: the trust step, and the worktree and branch taken back", async () => {
    const world = await ledWorld();
    const code = await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_BG: "untrusted" }));
    expect(code).toBe(1);
    expect(world.out).toEqual([
      "failed C my-app B6b portal-live: Workspace not trusted: open this repo once with claude and accept the trust prompt",
    ]);
    const record = onlyCrew(world.paths.stateDir, world.repo);
    expect(record.state).toBe("failed");
    expect(existsSync(record.worktree)).toBe(false);
    expect(git(world.repo, "branch", "--list", "crew/B6b-portal-live")).toBe("");
    // The name is free again: a second try after the trust prompt starts. The failed record
    // stays as history, and the phase's newest crew session is the one that counts.
    const retry = world.ctx({ randomSuffix: () => "2b3c4d" });
    expect(await runCrew(startArgs(world.brief), retry)).toBe(0);
    expect(world.out[1]).toStartWith("started C my-app B6b portal-live (");
    expect(
      listCrew(world.paths.stateDir, world.repo).records.map((one) => [one.id, one.state]),
    ).toEqual([
      ["B6b-portal-live-1a2b3c", "failed"],
      ["B6b-portal-live-2b3c4d", "starting"],
    ]);
  });

  test("a failed crew session whose worktree stays still holds its name", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_BG: "noline" }))).toBe(1);
    const retry = world.ctx({ randomSuffix: () => "2b3c4d" });
    expect(await runCrew(startArgs(world.brief), retry)).toBe(1);
    expect(world.err[0]).toBe(
      "crew start: C my-app B6b portal-live is recorded already, failed, on crew/B6b-portal-live",
    );
  });

  test("claude --bg fails: its last line, and nothing left behind", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_BG: "fail" }))).toBe(1);
    expect(world.out).toEqual([
      "failed C my-app B6b portal-live: claude --bg failed (exit 4): something broke",
    ]);
    expect(existsSync(onlyCrew(world.paths.stateDir, world.repo).worktree)).toBe(false);
  });

  test("the backgrounded line missing: failed, and the worktree kept (a session may run)", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_BG: "noline" }))).toBe(1);
    expect(world.out).toEqual([
      "failed C my-app B6b portal-live: claude --bg printed no line backgrounded · <id> · <name>: a session may have started; see claude agents",
    ]);
    expect(world.claudeCalls()).toHaveLength(1);
    expect(existsSync(onlyCrew(world.paths.stateDir, world.repo).worktree)).toBe(true);
  });

  test("H101: agents --json shows the launch folder at once: it starts, starting, and is never stopped", async () => {
    const world = await ledWorld();
    const head = git(world.repo, "rev-parse", "HEAD").trim();
    // `FAKE_AGENTS=other` is agent view saying the session works in the main checkout — what an
    // immediate read reported for every `--bg -w` launch in the first live use (2.1.308). It is
    // not the session's real folder yet, so the launcher must not judge it.
    expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_AGENTS: "other" }))).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      `started C my-app B6b portal-live (${SHORT_ID}) · sonnet high · crew/B6b-portal-live @ ${head.slice(0, 7)}`,
    ]);
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toEqual([]);
    expect(onlyCrew(world.paths.stateDir, world.repo)).toMatchObject({
      sessionId: `${SHORT_ID}-0000-1111-2222-333333333333`,
      shortId: SHORT_ID,
      startedAt: "2026-10-21T10:00:00.000Z",
      state: "starting",
    });
    // Its own SessionStart hook judges the folder (src/hooks/crew-role.ts), never this read.
    expect(
      readCrewEvents(world.paths.stateDir, world.repo).events.map((one) => [one.type, one.state]),
    ).toEqual([["created", "starting"]]);
  });

  test("agents --json without its row, or not JSON: failed, never a retry", async () => {
    for (const [mode, reason] of [
      ["missing", `session ${SHORT_ID} started, but claude agents does not list it`],
      ["broken", `session ${SHORT_ID} started, but claude agents --json could not be read`],
    ] as const) {
      const world = await ledWorld();
      expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_AGENTS: mode }))).toBe(1);
      expect(world.out).toEqual([`failed C my-app B6b portal-live: ${reason}`]);
      expect(world.claudeCalls().map((call) => call[0])).toEqual(["--bg", "agents"]);
    }
  });
});

describe("two leads in one repository", () => {
  test("each crew names the lead whose session started it", async () => {
    const world = await ledWorld();
    // A second session (pid 600 under its own shell 700) registers as a lead of another plan.
    writeSessionRecord(world.paths, 600, OTHER_SESSION, world.repo);
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: "LEAD my-app docs-plan",
        plan: "docs-plan",
        repo: world.repo,
        sessionId: OTHER_SESSION,
        tag: "my-app",
      },
      T0,
    );
    const other = world.ctx({
      pid: 800,
      processes: {
        commandLineOf: () => "claude",
        parentOf: (pid) => ({ 600: 1, 700: 600, 800: 700 })[pid] ?? null,
      },
      randomSuffix: () => "4d5e6f",
    });
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    const docs = ["start", "C5b", "--slug", "trim", "--kind", "docs", "--brief", world.brief];
    expect(await runCrew(docs, other)).toBe(0);
    const leads = listCrew(world.paths.stateDir, world.repo).records.map((one) => [
      one.phase,
      one.leadSessionId,
      one.leadName,
      one.plan,
    ]);
    expect(leads).toEqual([
      ["B6b", LEAD_SESSION, "LEAD my-app master-plan", "master-plan"],
      ["C5b", OTHER_SESSION, "LEAD my-app docs-plan", "docs-plan"],
    ]);
  });
});
