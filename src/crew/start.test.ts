/**
 * `crew start` (`start.ts`), end to end in a temp world: a real git repo, the crew store in a
 * temp state folder, and a fake `claude` on PATH that logs its argv (`src/testing/crew-world.ts`).
 * No test starts a real Claude session.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { recordUsageWindow } from "../cli/usage-window";
import { MCP_VERSIONS, TAVILY_MCP_URL } from "../mcp/versions";
import {
  crewWorld,
  LEAD_SESSION,
  OTHER_SESSION,
  SHORT_ID,
  writeSessionRecord,
} from "../testing/crew-world";
import { defaultResolved } from "../testing/fake-workflow";
import { git, tempDir } from "../testing/temp";
import { launchLine, withCrewCommand } from "./brief";
import { runCrew } from "./command";
import { withPlacesLock } from "./places";
import { chooseLaunch, clashPairKey, crewSettings, filesOverlap, startQueued } from "./start";
import {
  type CrewRecord,
  createCrew,
  crewBriefFile,
  crewSettingsFile,
  listCrew,
  readCrewEvents,
  updateCrew,
  writeLead,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";

/** The one note line an opus start says with no window to read (D54), written by hand. */
const UNREAD =
  "note: the 5-hour usage window cannot be read, so the opus usage guard does not hold: cc-smart-dev-kit setup --statusline records it, and no current reading is stored";

/** A gateway config whose opus slot has a chain in use with its fallback on. */
const OPUS_CHAIN = {
  backends: { omniroute: { apiKey: "test-key", baseUrl: "http://127.0.0.1:20199" } },
  fallback: { "cc-smart-dev-kit-opus": true },
  slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-5.3-flash"] },
  version: 1,
};

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

/** A recorded crew session of another repository, in `state`, for `lead` (another lead by default). */
async function otherCrew(
  stateDir: string,
  n: number,
  state: string,
  phase = `P${n}`,
  tier: null | string = null,
  lead = "other-lead",
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
      leadSessionId: lead,
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
  test("a failed launch that started nothing is nothing to warn about", async () => {
    const world = await ledWorld();
    await createCrew(
      world.paths.stateDir,
      {
        base: null,
        baseRef: "main",
        branch: "crew/B6b-lost",
        effort: "high",
        files: [],
        id: "B6b-lost-aaaaaa",
        kind: "build",
        lastLine: null,
        leadName: "LEAD my-app master-plan",
        leadSessionId: LEAD_SESSION,
        memoryMb: null,
        model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
        name: "C my-app B6b lost",
        permissionMode: "auto",
        phase: "B6b",
        plan: "master-plan",
        pr: null,
        questions: [],
        repo: world.repo,
        reportPath: null,
        sessionId: null,
        shortId: null,
        slug: "lost",
        state: "failed",
        waitsFor: [],
        worktree: join(world.repo, ".claude", "worktrees", "crew-B6b-lost"),
      },
      T0,
    );
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out).toHaveLength(1);
    expect(world.out[0]).toStartWith("started C my-app master-plan B6b portal-live");
  });

  test("a phase that already has a live crew session gets one line naming it, to remove it first", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    world.out.length = 0;
    // Another slug of the same phase: inUse sees no branch, so only this line warns the lead —
    // the bug of 2026-10-23 was two crew sessions started for one phase.
    const code = await runCrew(
      ["start", "B6b", "--slug", "again", "--kind", "build", "--brief", world.brief],
      world.ctx(),
    );
    expect(code).toBe(0);
    expect(world.out.slice(1)).toEqual([
      `note: C my-app master-plan B6b portal-live is already on phase B6b (starting) — remove it first: ${COMMAND} crew rm "C my-app master-plan B6b portal-live"`,
    ]);
  });

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
      `started C my-app master-plan B6b portal-live (${SHORT_ID}) · sonnet high · crew/B6b-portal-live @ ${head.slice(0, 7)}`,
      'warning: --files "src/a.ts" matches no file yet: fine for a file this phase creates; else check the path — not blocked',
      'warning: --files "src/b.ts" matches no file yet: fine for a file this phase creates; else check the path — not blocked',
    ]);
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    const briefFile = crewBriefFile(world.paths.stateDir, world.repo, ID);
    const settingsFile = crewSettingsFile(world.paths.stateDir, world.repo, ID);
    const mcpFile = join(dirname(settingsFile), "mcp.json");
    expect(world.claudeCalls()).toEqual([
      // The plugins this machine runs, read before anything is recorded: a lean launch knows
      // what to turn off. A fake with no answer is no list, and nothing is turned off.
      ["plugin", "list", "--json"],
      [
        "--bg",
        "-w",
        "crew-B6b-portal-live",
        "--name",
        "C my-app master-plan B6b portal-live",
        "--model",
        "sonnet",
        "--effort",
        "high",
        "--permission-mode",
        "auto",
        "--autocompact",
        "auto",
        "--strict-mcp-config",
        "--mcp-config",
        mcpFile,
        "--settings",
        settingsFile,
        "--",
        withCrewCommand(
          launchLine("C my-app master-plan B6b portal-live", "LEAD my-app master-plan", briefFile),
        ),
      ],
      ["agents", "--json", "--all"],
    ]);
    expect(onlyCrew(world.paths.stateDir, world.repo)).toEqual({
      base: { ref: "main", sha: head },
      baseRef: "main",
      branch: "crew/B6b-portal-live",
      // Where the brief came from and a hash of its text, kept for the run record (PL1).
      briefSource: {
        path: world.brief,
        sha256: "50dad91b5a7732afbf56f2d1892b64a824006dabc5f976511d22c61808ceb917",
      },
      // A first crew session for its phase continues no one: only `--continue` records the old id.
      continues: null,
      createdAt: "2026-10-21T10:00:00.000Z",
      effort: "high",
      files: ["src/a.ts", "src/b.ts"],
      id: ID,
      kind: "build",
      lastLine: null,
      launchedAt: "2026-10-21T10:00:00.000Z",
      leadName: "LEAD my-app master-plan",
      leadSessionId: LEAD_SESSION,
      memoryMb: null,
      model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
      name: "C my-app master-plan B6b portal-live",
      permissionMode: "auto",
      phase: "B6b",
      plan: "master-plan",
      // This lead has no plan file: its run is not recorded.
      planFile: null,
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
    // The settings file names the crew session to its own session, turns Claude Code's retry
    // watchdog on with no wait limit (D42), drops the claude.ai connectors, and keeps Remote
    // Control off; with no plugin list read, it turns no plugin off. The `--mcp-config` file
    // passes no server, because this world has no Tavily key. All three files are the kit's, 0600.
    expect(readFileSync(settingsFile, "utf8")).toBe(
      `{\n  "permissions": {\n    "allow": [\n      "mcp__cc-smart-dev-kit-tasks__*"\n    ]\n  },\n  "env": {\n    "CC_SMART_DEV_KIT_CREW": "${ID}",\n    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1",\n    "CLAUDE_CODE_RETRY_WATCHDOG": "1",\n    "CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS": "300000"\n  },\n  "disableClaudeAiConnectors": true,\n  "remoteControlAtStartup": false\n}\n`,
    );
    expect(statSync(settingsFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(mcpFile, "utf8"))).toEqual({
      mcpServers: {
        "cc-smart-dev-kit-tasks": {
          alwaysLoad: true,
          args: ["task", "mcp"],
          command: join(world.paths.binDir, COMMAND),
        },
      },
    });
    expect(statSync(mcpFile).mode & 0o777).toBe(0o600);
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
    expect(world.claudeCalls()[1]?.slice(5, 9)).toEqual(["--model", "opus", "--effort", "xhigh"]);
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
    // The plugin list is read before the base is checked; nothing else runs.
    expect(world.claudeCalls()).toEqual([["plugin", "list", "--json"]]);
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

describe("a lean start: the plugins and servers the phase uses, and no others", () => {
  /** What `claude plugin list --json` prints here: this machine's plugins, one already off. */
  const PLUGINS = JSON.stringify([
    { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit", scope: "user", version: "1.0.1" },
    { enabled: true, id: "claude-mem@thedotmack", scope: "user", version: "13.40.0" },
    { enabled: true, id: "stripe@claude-plugins-official", scope: "user", version: "0.11.17" },
    { enabled: false, id: "frontend-design@claude-plugins-official", scope: "user", version: "1" },
  ]);

  test("the other plugins go off but one this plugin depends on stays on, Tavily is kept and passed, and the launch names both files", async () => {
    const world = await ledWorld();
    const code = await runCrew(
      startArgs(world.brief),
      world.ctx({}, { FAKE_PLUGINS: PLUGINS, TAVILY_API_KEY: "tvly-test-key" }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const settingsFile = crewSettingsFile(world.paths.stateDir, world.repo, ID);
    const mcpFile = join(dirname(settingsFile), "mcp.json");
    expect(readFileSync(settingsFile, "utf8")).toBe(
      `{\n  "permissions": {\n    "allow": [\n      "mcp__cc-smart-dev-kit-tasks__*"\n    ]\n  },\n  "env": {\n    "CC_SMART_DEV_KIT_CREW": "${ID}",\n    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1",\n    "CLAUDE_CODE_RETRY_WATCHDOG": "1",\n    "CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS": "300000"\n  },\n  "enabledPlugins": {\n    "stripe@claude-plugins-official": false\n  },\n  "disableClaudeAiConnectors": true,\n  "remoteControlAtStartup": false\n}\n`,
    );
    // The registration is the kit's own, with Claude Code's placeholder, never a key.
    expect(readFileSync(mcpFile, "utf8")).toBe(
      `{\n  "mcpServers": {\n    "tavily-websearch": {\n      "headers": {\n        "Authorization": "Bearer \${TAVILY_API_KEY}"\n      },\n      "timeout": 300000,\n      "type": "http",\n      "url": "${TAVILY_MCP_URL}"\n    },\n    "cc-smart-dev-kit-tasks": {\n      "command": "${join(world.paths.binDir, COMMAND)}",\n      "args": [\n        "task",\n        "mcp"\n      ],\n      "alwaysLoad": true\n    }\n  }\n}\n`,
    );
    const launched = world.claudeCalls()[1] ?? [];
    expect(launched.slice(0, 2)).toEqual(["--bg", "-w"]);
    expect(launched.slice(-6, -2)).toEqual(["--mcp-config", mcpFile, "--settings", settingsFile]);
    expect(launched).toContain("--strict-mcp-config");
  });

  test("a ui session keeps the browser too; a build session does not", async () => {
    const world = await ledWorld();
    const args = (kind: string) => [
      "start",
      "W1a",
      "--slug",
      "portal-look",
      "--kind",
      kind,
      "--brief",
      world.brief,
    ];
    expect(
      await runCrew(args("ui"), world.ctx({}, { FAKE_PLUGINS: PLUGINS, TAVILY_API_KEY: "tvly-k" })),
    ).toBe(0);
    const record = onlyCrew(world.paths.stateDir, world.repo);
    const settingsFile = crewSettingsFile(world.paths.stateDir, world.repo, record.id);
    const mcpFile = join(dirname(settingsFile), "mcp.json");
    const servers = Object.keys(
      (JSON.parse(readFileSync(mcpFile, "utf8")) as { mcpServers: object }).mcpServers,
    );
    expect(servers).toEqual(["playwright", "tavily-websearch", "cc-smart-dev-kit-tasks"]);
  });

  test("workflow.crew.keep keeps a plugin on and adds a server every kind lacks", async () => {
    const world = await ledWorld();
    world.writeConfig({ keep: ["plugin:acme-tools@acme", "server:sequential-thinking"] });
    const plugins = JSON.stringify([
      { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit" },
      { enabled: true, id: "acme-tools@acme" },
      { enabled: true, id: "claude-mem@thedotmack" },
      { enabled: true, id: "stripe@claude-plugins-official" },
    ]);
    expect(
      await runCrew(
        startArgs(world.brief),
        world.ctx({}, { FAKE_PLUGINS: plugins, TAVILY_API_KEY: "tvly-test-key" }),
      ),
    ).toBe(0);
    const settingsFile = crewSettingsFile(world.paths.stateDir, world.repo, ID);
    const mcpFile = join(dirname(settingsFile), "mcp.json");
    expect(readFileSync(settingsFile, "utf8")).toContain(
      `"enabledPlugins": {\n    "stripe@claude-plugins-official": false\n  }`,
    );
    const mcp = JSON.parse(readFileSync(mcpFile, "utf8")) as {
      mcpServers: Record<string, { args?: string[]; command?: string }>;
    };
    expect(Object.keys(mcp.mcpServers)).toEqual([
      "sequential-thinking",
      "tavily-websearch",
      "cc-smart-dev-kit-tasks",
    ]);
    expect(mcp.mcpServers["sequential-thinking"]).toEqual({
      args: [
        "-y",
        `@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}`,
      ],
      command: "bunx",
    });
  });

  test("a kept plugin this machine does not run is refused, and nothing is recorded", async () => {
    const world = await ledWorld();
    world.writeConfig({ keep: ["plugin:acme-tools@acme"] });
    const code = await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_PLUGINS: PLUGINS }));
    expect(code).toBe(1);
    expect(world.out).toEqual([]);
    expect(world.err).toEqual([
      'crew start: workflow.crew.keep names plugin "acme-tools@acme", which is not enabled in this Claude Code',
      "Fix: set workflow.crew.keep in .claude/cc-smart-dev-kit.json",
    ]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toEqual([]);
    expect(world.claudeCalls()).toEqual([["plugin", "list", "--json"]]);
  });

  test("a keep entry in the person's own defaults names their file in the fix line", async () => {
    const world = await ledWorld();
    const file = world.paths.workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ crew: { keep: ["plugin:acme-tools@acme"] } })}\n`);
    expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_PLUGINS: PLUGINS }))).toBe(1);
    expect(world.err).toEqual([
      'crew start: workflow.crew.keep names plugin "acme-tools@acme", which is not enabled in this Claude Code',
      "Fix: set workflow.crew.keep in ~/.config/cc-smart-dev-kit/workflow.json",
    ]);
  });

  test("a settings file that cannot be written fails before any worktree is made", async () => {
    const world = await ledWorld();
    // A folder where `mcp.json` goes: `settings.json` is written, the second write fails.
    const settingsFile = crewSettingsFile(world.paths.stateDir, world.repo, ID);
    mkdirSync(join(dirname(settingsFile), "mcp.json"), { recursive: true });
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(1);
    expect(world.out[0]).toContain(
      "failed C my-app master-plan B6b portal-live: its settings could not be written",
    );
    // Written before anything is made, so nothing is left to take back or to free the name.
    expect(existsSync(join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live"))).toBe(
      false,
    );
    expect(world.claudeCalls().map((call) => call[0])).toEqual(["plugin"]);
  });
});

describe("a lean start: a queued crew session is lean when it starts", () => {
  /** What the machine runs at the time the queued crew session starts. */
  const PLUGINS = JSON.stringify([
    { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit" },
    { enabled: true, id: "claude-mem@thedotmack" },
    { enabled: true, id: "stripe@claude-plugins-official" },
  ]);

  /** A queued crew session of B6b, as `crew start` records one when no place is free. */
  async function queuedHere(world: Awaited<ReturnType<typeof ledWorld>>): Promise<CrewRecord> {
    return await createCrew(
      world.paths.stateDir,
      {
        base: null,
        baseRef: "main",
        branch: "crew/B6b-portal-live",
        continues: null,
        effort: "high",
        files: [],
        id: ID,
        kind: "build",
        lastLine: null,
        leadName: "LEAD my-app master-plan",
        leadSessionId: LEAD_SESSION,
        memoryMb: null,
        model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
        // A record written before 1.1.2 keeps its old-shape name: it is still started as it is.
        name: "C my-app B6b portal-live",
        permissionMode: "auto",
        phase: "B6b",
        plan: "master-plan",
        pr: null,
        questions: [],
        repo: world.repo,
        reportPath: null,
        sessionId: null,
        shortId: null,
        slug: "portal-live",
        state: "queued",
        waitsFor: [],
        worktree: join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live"),
      },
      T0,
    );
  }

  test("the plugins it turns off are read when it starts, and both files are written", async () => {
    const world = await ledWorld();
    const record = await queuedHere(world);
    await startQueued(
      record,
      world.ctx({}, { FAKE_PLUGINS: PLUGINS, TAVILY_API_KEY: "tvly-test-key" }),
      defaultResolved(),
    );
    const settingsFile = crewSettingsFile(world.paths.stateDir, world.repo, ID);
    const mcpFile = join(dirname(settingsFile), "mcp.json");
    expect(readFileSync(settingsFile, "utf8")).toContain(
      `"enabledPlugins": {\n    "stripe@claude-plugins-official": false\n  }`,
    );
    expect(
      Object.keys((JSON.parse(readFileSync(mcpFile, "utf8")) as { mcpServers: object }).mcpServers),
    ).toEqual(["tavily-websearch", "cc-smart-dev-kit-tasks"]);
    expect(onlyCrew(world.paths.stateDir, world.repo).state).toBe("starting");
  });

  test("MC1: it starts on the model and effort the record has now, not the ones the watch listed", async () => {
    const world = await ledWorld();
    const listed = await queuedHere(world);
    // `crew model` changed the record after the watch listed it.
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      listed.id,
      { effort: "xhigh", model: { named: "opus", resolved: "opus", slot: null, tier: "opus" } },
      T0,
    );
    await startQueued(listed, world.ctx({}, { FAKE_PLUGINS: PLUGINS }), defaultResolved());
    const launch = world.claudeCalls().find((call) => call[0] === "--bg") ?? [];
    expect(launch.slice(launch.indexOf("--model"), launch.indexOf("--model") + 4)).toEqual([
      "--model",
      "opus",
      "--effort",
      "xhigh",
    ]);
    expect(onlyCrew(world.paths.stateDir, world.repo)).toMatchObject({
      effort: "xhigh",
      model: { named: "opus" },
    });
  });

  test("MC1: a crew session that left the queue since the watch listed it is not started", async () => {
    const world = await ledWorld();
    const listed = await queuedHere(world);
    await updateCrew(world.paths.stateDir, world.repo, listed.id, { state: "failed" }, T0);
    await startQueued(listed, world.ctx({}, { FAKE_PLUGINS: PLUGINS }), defaultResolved());
    expect(world.claudeCalls()).toEqual([]);
    expect(onlyCrew(world.paths.stateDir, world.repo).state).toBe("failed");
  });

  test("IN1: a model change that lands while the start waits for the places lock is the model it starts on", async () => {
    const world = await ledWorld();
    const listed = await queuedHere(world);
    const ctx = world.ctx({}, { FAKE_PLUGINS: PLUGINS });
    let started: Promise<void> = Promise.resolve();
    await withPlacesLock(world.paths.stateDir, async () => {
      // The start reads the record at once, then waits for the lock; `crew model` lands meanwhile.
      started = startQueued(listed, ctx, defaultResolved());
      await updateCrew(
        world.paths.stateDir,
        world.repo,
        listed.id,
        { effort: "xhigh", model: { named: "opus", resolved: "opus", slot: null, tier: "opus" } },
        T0,
      );
    });
    await started;
    const launch = world.claudeCalls().find((call) => call[0] === "--bg") ?? [];
    expect(launch.slice(launch.indexOf("--model"), launch.indexOf("--model") + 4)).toEqual([
      "--model",
      "opus",
      "--effort",
      "xhigh",
    ]);
  });

  test("IN1: a crew session removed while the start waits for the places lock is not started", async () => {
    const world = await ledWorld();
    const listed = await queuedHere(world);
    const ctx = world.ctx({}, { FAKE_PLUGINS: PLUGINS });
    let started: Promise<void> = Promise.resolve();
    await withPlacesLock(world.paths.stateDir, async () => {
      started = startQueued(listed, ctx, defaultResolved());
      await updateCrew(world.paths.stateDir, world.repo, listed.id, { state: "failed" }, T0);
    });
    await started;
    expect(world.claudeCalls()).toEqual([]);
    expect(onlyCrew(world.paths.stateDir, world.repo).state).toBe("failed");
  });

  test("two starters of one queued record start it once, the second finding it no longer queued", async () => {
    const world = await ledWorld();
    const record = await queuedHere(world);
    const ctx = world.ctx({}, { FAKE_PLUGINS: PLUGINS });
    // Both hold the same stale copy, as a lead's watch and its successor do after a takeover.
    await Promise.all([
      startQueued(record, ctx, defaultResolved()),
      startQueued(record, ctx, defaultResolved()),
    ]);
    const launches = world.claudeCalls().filter((call) => call.includes("--bg"));
    expect(launches).toHaveLength(1);
    // The second starter did not go on to a second worktree add that fails and marks the first's
    // crew session failed.
    const texts = readCrewEvents(world.paths.stateDir, world.repo).events.map((one) => one.text);
    expect(texts.filter((text) => text === "started from the queue")).toHaveLength(1);
    expect(texts.some((text) => text?.includes("worktree add failed"))).toBe(false);
    expect(onlyCrew(world.paths.stateDir, world.repo).state).toBe("starting");
  });

  test("a record that is no longer queued is left alone", async () => {
    const world = await ledWorld();
    const record = await queuedHere(world);
    await updateCrew(world.paths.stateDir, world.repo, record.id, { state: "stopped" }, T0);
    await startQueued(record, world.ctx({}, { FAKE_PLUGINS: PLUGINS }), defaultResolved());
    expect(onlyCrew(world.paths.stateDir, world.repo).state).toBe("stopped");
    expect(world.claudeCalls()).toEqual([]);
  });

  test("the queue holds a queued crew session while the load is past the limit", async () => {
    const world = await ledWorld();
    const record = await queuedHere(world);
    const busy = world.ctx(
      { load: () => ({ cores: 4, oneMinute: 40 }) },
      { FAKE_PLUGINS: PLUGINS },
    );
    await startQueued(record, busy, defaultResolved());
    expect(onlyCrew(world.paths.stateDir, world.repo).state).toBe("queued");
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a keep entry this machine does not run fails it, and it makes no worktree", async () => {
    const world = await ledWorld();
    const record = await queuedHere(world);
    const resolved = defaultResolved();
    resolved.crew.keep = { source: "project", value: ["plugin:acme-tools@acme"] };
    await startQueued(record, world.ctx({}, { FAKE_PLUGINS: PLUGINS }), resolved);
    const [after] = listCrew(world.paths.stateDir, world.repo).records;
    expect(after?.state).toBe("failed");
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    expect(events[events.length - 1]?.text).toContain(
      'crew start: workflow.crew.keep names plugin "acme-tools@acme"',
    );
    expect(existsSync(record.worktree)).toBe(false);
    expect(world.claudeCalls()).toEqual([["plugin", "list", "--json"]]);
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
    expect(world.claudeCalls()[1]?.slice(5, 9)).toEqual(["--model", "opus", "--effort", "high"]);
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

describe("RV3: a crew session runs on the PROJECT's gateway, not the user's file alone", () => {
  const ROUTER = "http://127.0.0.1:20199";
  const CHAINS = {
    backends: { omniroute: { apiKey: "test-key", baseUrl: ROUTER } },
    port: 20199,
    slots: {
      "cc-smart-dev-kit-opus": ["omniroute:glm-5.3-flash"],
      "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash"],
    },
    version: 1,
  };

  /** A led world whose gateway config has affordable chains; `machine`/`project` are the addresses. */
  async function gatewayWorld(machine: null | string, project: null | string) {
    const world = await ledWorld();
    mkdirSync(dirname(world.paths.gatewayConfigFile), { mode: 0o700, recursive: true });
    writeFileSync(world.paths.gatewayConfigFile, `${JSON.stringify(CHAINS)}\n`, { mode: 0o600 });
    const write = (file: string, url: string) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: url } }));
    };
    if (machine !== null) write(world.paths.settingsFile, machine);
    // The project's personal file, at the main checkout's root (P6).
    if (project !== null) write(join(world.repo, ".claude", "settings.local.json"), project);
    return world;
  }

  test("the machine is off and the project is on: the project's chain answers, at the kind's own effort", async () => {
    const world = await gatewayWorld(null, ROUTER);
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· sonnet → omniroute:glm-5.3-flash high ·");
  });

  test("D50: a ui session under the project's gateway stays on the opus tier at high: the name is the tier, whatever answers it", async () => {
    const world = await gatewayWorld(null, ROUTER);
    const argv = startArgs(world.brief);
    argv[argv.indexOf("build")] = "ui";
    expect(await runCrew(argv, world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· opus → omniroute:glm-5.3-flash high ·");
  });

  test("the machine is on and the project is off: Claude answers, at the same effort", async () => {
    const world = await gatewayWorld(ROUTER, "https://api.anthropic.com");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· sonnet high ·");
  });

  test("the machine is on and the project says nothing: the machine's gateway answers, at the kind's own effort", async () => {
    const world = await gatewayWorld(ROUTER, null);
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· sonnet → omniroute:glm-5.3-flash high ·");
  });

  test.each(["medium", "high", "xhigh", "max"])(
    "an affordable backend takes --effort %s, like Claude (the owner, 2026-10-26)",
    async (effort) => {
      const world = await gatewayWorld(null, ROUTER);
      expect(await runCrew(startArgs(world.brief, "--effort", effort), world.ctx())).toBe(0);
      expect(world.out[0]).toContain(`· sonnet → omniroute:glm-5.3-flash ${effort} ·`);
    },
  );

  test("a model asked for alone on a backend runs at the kind's effort, not at max", async () => {
    const world = await gatewayWorld(null, ROUTER);
    expect(await runCrew(startArgs(world.brief, "--model", "sonnet"), world.ctx())).toBe(0);
    expect(world.out[0]).toContain("· sonnet → omniroute:glm-5.3-flash high ·");
  });

  describe("chooseLaunch, with no process started (the owner, 2026-10-26)", () => {
    const choose = async (override: { effort: null | string; model: null | string }) => {
      const world = await gatewayWorld(null, ROUTER);
      const { env, paths } = world.ctx();
      return chooseLaunch("build", override, { env, paths }, world.repo);
    };

    test("the kind's own effort on a backend: high, not max", async () => {
      expect(await choose({ effort: null, model: null })).toMatchObject({
        effort: "high",
        model: "sonnet",
      });
      expect(await choose({ effort: null, model: "sonnet" })).toMatchObject({ effort: "high" });
    });

    test.each(["medium", "high", "xhigh", "max"])(
      "--effort %s on a backend is allowed",
      async (effort) => {
        const chosen = await choose({ effort, model: null });
        expect(chosen).toMatchObject({ effort, model: "sonnet" });
        expect("refusal" in chosen).toBe(false);
      },
    );

    test("`low` stays refused on a backend, by the guard", async () => {
      const chosen = await choose({ effort: "low", model: null });
      expect(chosen).toHaveProperty("refusal");
    });
  });
});

describe("D25: the queue — still one line, at once", () => {
  test("D54: the machine's ceiling reached across repositories: queued, no worktree, no session", async () => {
    const world = await ledWorld();
    world.writePersonal({ max: 6 });
    for (const n of [1, 2, 3, 4, 5, 6]) await otherCrew(world.paths.stateDir, n, "working");
    await otherCrew(world.paths.stateDir, 7, "done");
    await otherCrew(world.paths.stateDir, 8, "queued");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app master-plan B6b portal-live: 6 of 6 crew sessions running on this machine; it starts when one finishes",
    ]);
    const record = onlyCrew(world.paths.stateDir, world.repo);
    expect(record).toMatchObject({ base: null, baseRef: "main", state: "queued" });
    expect(existsSync(record.worktree)).toBe(false);
    // The plugin list is read before the queue decision (a lean launch needs it); nothing is launched.
    expect(world.claudeCalls()).toEqual([["plugin", "list", "--json"]]);
    // Its brief is written now: the watch starts it later from the record and these files.
    expect(existsSync(crewBriefFile(world.paths.stateDir, world.repo, ID))).toBe(true);
  });

  test("D54: a lead's cap holds its next crew session; another lead's do not count", async () => {
    const world = await ledWorld();
    world.writePersonal({ perLead: 2 });
    await otherCrew(world.paths.stateDir, 1, "working", "P1", null, LEAD_SESSION);
    await otherCrew(world.paths.stateDir, 2, "blocked", "P2", null, LEAD_SESSION);
    await otherCrew(world.paths.stateDir, 3, "working");
    await otherCrew(world.paths.stateDir, 4, "working");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app master-plan B6b portal-live: its lead has 2 of 2 crew sessions running; it starts when one of them finishes",
    ]);
  });

  test("D54: a lead's opus cap holds its next opus crew session while its sonnet one starts", async () => {
    const world = await ledWorld();
    await otherCrew(world.paths.stateDir, 1, "working", "P1", "opus", LEAD_SESSION);
    await otherCrew(world.paths.stateDir, 2, "blocked", "P2", "opus", LEAD_SESSION);
    await otherCrew(world.paths.stateDir, 3, "done", "P3", "opus", LEAD_SESSION);
    await otherCrew(world.paths.stateDir, 4, "working", "P4", null, LEAD_SESSION);
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
      "queued C my-app master-plan W1a launcher: its lead has 2 of 2 opus crew sessions running; it starts when one of them finishes",
    ]);
    // An override onto opus counts too.
    const onto = startArgs(world.brief, "--model", "opus", "--effort", "high");
    expect(await runCrew(onto, world.ctx({ randomSuffix: () => "000001" }))).toBe(0);
    expect(world.out[1]).toBe(
      "queued C my-app master-plan B6b portal-live: its lead has 2 of 2 opus crew sessions running; it starts when one of them finishes",
    );
  });

  test("D37: a sonnet crew session still starts then, and its record names no tier", async () => {
    const world = await ledWorld();
    await otherCrew(world.paths.stateDir, 1, "working", "P1", "opus", LEAD_SESSION);
    await otherCrew(world.paths.stateDir, 2, "working", "P2", "opus", LEAD_SESSION);
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out[0]).toStartWith("started C my-app master-plan B6b portal-live (");
    expect(onlyCrew(world.paths.stateDir, world.repo).model.tier).toBeNull();
  });

  test("D54: workflow.crew.maxOpus, when a person sets it, caps the opus tier across leads", async () => {
    const world = await ledWorld();
    world.writePersonal({ maxOpus: 2 });
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
    expect(world.out).toEqual([
      "queued C my-app master-plan W1a launcher: 2 of 2 opus crew sessions running on this machine; it starts when one of them finishes",
    ]);
    // With no machine-wide count set, the same two crew sessions hold nothing back.
    world.writePersonal({});
    const second = [
      "start",
      "W1b",
      "--slug",
      "launcher",
      "--kind",
      "architecture",
      "--brief",
      world.brief,
    ];
    expect(await runCrew(second, world.ctx({ randomSuffix: () => "000002" }))).toBe(0);
    expect(world.out[1]).toStartWith("started C my-app master-plan W1b launcher (");
    const started = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.phase === "W1b",
    );
    expect(started?.model).toEqual({ named: "opus", resolved: "opus", slot: null, tier: "opus" });
  });

  test("D71: the person's workflow.crew.max sets the ceiling; a project's own value is ignored", async () => {
    const world = await ledWorld();
    world.writePersonal({ max: 1 });
    // A project file written before 1.8.0 may still set the limit: it parses, and changes nothing.
    writeFileSync(
      join(world.repo, ".claude", "cc-smart-dev-kit.json"),
      JSON.stringify({ workflow: { crew: { enabled: true, max: 5 } } }),
    );
    await otherCrew(world.paths.stateDir, 1, "blocked");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app master-plan B6b portal-live: 1 of 1 crew sessions running on this machine; it starts when one finishes",
    ]);
  });

  test("D54: past 85% of the 5-hour window, a new opus crew session is queued with that reason", async () => {
    const world = await ledWorld();
    world.writePersonal({ usagePercent: 85 });
    recordUsageWindow(
      world.paths,
      { rate_limits: { five_hour: { resets_at: T0 / 1000 + 3600, used_percentage: 90 } } },
      T0,
    );
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
      "queued C my-app master-plan W1a launcher: the 5-hour usage window is at 90%, past 85%; it starts when the window resets, or when the opus slot has a fallback chain",
    ]);
    // A sonnet crew session is not held by the window.
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(world.out[1]).toStartWith("started C my-app master-plan B6b portal-live (");
  });

  test("D54: the gateway's opus slot with its fallback chain on lifts the guard; the window still holds without it", async () => {
    const world = await ledWorld();
    recordUsageWindow(
      world.paths,
      { rate_limits: { five_hour: { resets_at: T0 / 1000 + 3600, used_percentage: 90 } } },
      T0,
    );
    // A chain saved but the gateway off: no fallback answers, so the window still holds.
    mkdirSync(dirname(world.paths.gatewayConfigFile), { mode: 0o700, recursive: true });
    writeFileSync(world.paths.gatewayConfigFile, `${JSON.stringify(OPUS_CHAIN)}\n`, {
      mode: 0o600,
    });
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
    expect(world.out[0]).toStartWith(
      "queued C my-app master-plan W1a launcher: the 5-hour usage window is at 90%",
    );
    // The gateway on, the chain in use with its fallback on: the guard does not hold.
    mkdirSync(dirname(world.paths.settingsFile), { recursive: true });
    writeFileSync(
      world.paths.settingsFile,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" } }),
    );
    const lifted = [
      "start",
      "W1b",
      "--slug",
      "launcher",
      "--kind",
      "architecture",
      "--brief",
      world.brief,
    ];
    expect(await runCrew(lifted, world.ctx())).toBe(0);
    expect(world.out[1]).toStartWith("started C my-app master-plan W1b launcher (");
    // The guard never watches while the chain answers past the window: no note line.
    expect(world.out).toHaveLength(2);
  });

  test("D54: with no reading, the note is silent when the opus slot's chain lifts the guard", async () => {
    const world = await ledWorld();
    mkdirSync(dirname(world.paths.gatewayConfigFile), { mode: 0o700, recursive: true });
    writeFileSync(world.paths.gatewayConfigFile, `${JSON.stringify(OPUS_CHAIN)}\n`, {
      mode: 0o600,
    });
    writeFileSync(
      world.paths.settingsFile,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" } }),
    );
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
    // The guard never watches while the chain answers past the window: no note line.
    expect(world.out).toHaveLength(1);
    expect(world.out[0]).toStartWith("started C my-app master-plan W1a launcher (");
  });

  test("D54: a window that cannot be read never holds, and the start says so once", async () => {
    const world = await ledWorld();
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
    expect(world.out[0]).toStartWith("started C my-app master-plan W1a launcher (");
    expect(world.out[1]).toBe(UNREAD);
    // A sonnet crew session has nothing to say about the window.
    expect(await runCrew(startArgs(world.brief), world.ctx({ randomSuffix: () => "000004" }))).toBe(
      0,
    );
    expect(world.out).toHaveLength(3);
  });

  test("less free memory than workflow.crew.memoryGb: queued", async () => {
    const world = await ledWorld();
    world.writePersonal({ memoryGb: 3 });
    const ctx = world.ctx({ freeMemoryGb: () => Promise.resolve(2.04) });
    expect(await runCrew(startArgs(world.brief), ctx)).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app master-plan B6b portal-live: 2 GB free, a crew session needs 3 GB; it starts when memory frees",
    ]);
  });

  test("a load past workflow.crew.loadPerCore for each core: queued, with the load and the limit", async () => {
    const world = await ledWorld();
    world.writePersonal({ loadPerCore: 2 });
    const busy = world.ctx({ load: () => ({ cores: 16, oneMinute: 85 }) });
    expect(await runCrew(startArgs(world.brief), busy)).toBe(0);
    expect(world.out).toEqual([
      "queued C my-app master-plan B6b portal-live: the load is 85 on 16 cores, past 32 (2 for each core); it starts when the load falls",
    ]);
    expect(onlyCrew(world.paths.stateDir, world.repo).state).toBe("queued");
  });

  test("a load under the limit starts, and no load average does not hold", async () => {
    const world = await ledWorld();
    world.writePersonal({ loadPerCore: 2 });
    const calm = world.ctx({ load: () => ({ cores: 16, oneMinute: 31 }) });
    expect(await runCrew(startArgs(world.brief), calm)).toBe(0);
    expect(world.out[0]).toStartWith("started C my-app master-plan B6b portal-live (");

    const none = await ledWorld();
    expect(await runCrew(startArgs(none.brief), none.ctx({ load: () => null }))).toBe(0);
    expect(none.out[0]).toStartWith("started C my-app master-plan B6b portal-live (");
  });

  test("--waits-for a phase not done: queued, and the record keeps what it waits for", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief, "--waits-for", "B6a,B7"), world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "note: phase task dependencies skipped: no task yet for B6a, B7",
      "queued C my-app master-plan B6b portal-live: waits for B6a (not started yet), B7 (not started yet); it starts when each is merged",
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
    expect(world.out[1]).toStartWith(
      "queued C my-app master-plan B7 always-on: waits for B6b (done)",
    );
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
    expect(
      await runCrew([...args, "--waits-for", "B6b"], world.ctx({ now: () => T0 + 60_000 })),
    ).toBe(0);
    expect(world.out[1]).toStartWith("started C my-app master-plan B7 always-on (");
  });
});

describe("a name already in use", () => {
  test("a crew session of the same phase and slug in the store", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(0);
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew start: C my-app master-plan B6b portal-live is recorded already, starting, on crew/B6b-portal-live",
      'Fix: remove it first (cc-smart-dev-kit crew rm "C my-app master-plan B6b portal-live"), or pick another --slug',
    ]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toHaveLength(1);
  });

  test("the same name, from two slugs a long name cuts to the same words", async () => {
    // The longest tag (12), plan (16) and phase (8) leave only 17-19 characters of the slug, so
    // two slugs that share a longer prefix make the SAME name. The branches differ — the branch
    // check passes — and the name does not, so the message guard's own lookup takes whichever
    // record it finds first. The name is an address: it may not be shared.
    const world = await ledWorld();
    world.writeConfig({ tag: "my-app-tools" });
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: "LEAD my-app-tools release-2026-q4",
        plan: "release-2026-q4-big",
        repo: world.repo,
        sessionId: LEAD_SESSION,
        tag: "my-app-tools",
      },
      T0,
    );
    const args = (slug: string) => [
      "start",
      "E1a-E1b",
      "--slug",
      slug,
      "--kind",
      "build",
      "--brief",
      world.brief,
    ];
    expect(await runCrew(args("review-fixes-for-the-guard"), world.ctx())).toBe(0);
    const held = "C my-app-tools release-2026-q4 E1a-E1b review-fixes-for-the";
    expect(onlyCrew(world.paths.stateDir, world.repo).name).toBe(held);
    world.err.length = 0;
    expect(await runCrew(args("review-fixes-for-the-merge"), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew start: ${held} is recorded already, starting, on crew/E1a-E1b-review-fixes-for-the-guard`,
      `Fix: pick a shorter --slug, another plan or another tag, so this name is not cut to the same words, or remove it first (${COMMAND} crew rm "${held}")`,
    ]);
    expect(listCrew(world.paths.stateDir, world.repo).records).toHaveLength(1);
  });

  test("the branch is there already", async () => {
    const world = await ledWorld();
    git(world.repo, "branch", "crew/B6b-portal-live");
    expect(await runCrew(startArgs(world.brief), world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew start: the branch crew/B6b-portal-live is there already, for C my-app master-plan B6b portal-live",
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
      "failed C my-app master-plan B6b portal-live: Workspace not trusted: open this repo once with claude and accept the trust prompt",
    ]);
    const record = onlyCrew(world.paths.stateDir, world.repo);
    expect(record.state).toBe("failed");
    expect(existsSync(record.worktree)).toBe(false);
    expect(git(world.repo, "branch", "--list", "crew/B6b-portal-live")).toBe("");
    // The name is free again: a second try after the trust prompt starts. The failed record
    // stays as history, and the phase's newest crew session is the one that counts.
    const retry = world.ctx({ randomSuffix: () => "2b3c4d" });
    expect(await runCrew(startArgs(world.brief), retry)).toBe(0);
    expect(world.out[1]).toStartWith("started C my-app master-plan B6b portal-live (");
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
      "crew start: C my-app master-plan B6b portal-live is recorded already, failed, on crew/B6b-portal-live",
    );
  });

  test("claude --bg fails: its last line, and nothing left behind", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_BG: "fail" }))).toBe(1);
    expect(world.out).toEqual([
      "failed C my-app master-plan B6b portal-live: claude --bg failed (exit 4): something broke",
    ]);
    expect(existsSync(onlyCrew(world.paths.stateDir, world.repo).worktree)).toBe(false);
  });

  test("the backgrounded line missing: failed, and the worktree kept (a session may run)", async () => {
    const world = await ledWorld();
    expect(await runCrew(startArgs(world.brief), world.ctx({}, { FAKE_BG: "noline" }))).toBe(1);
    expect(world.out).toEqual([
      "failed C my-app master-plan B6b portal-live: claude --bg printed no line backgrounded · <id> · <name>: a session may have started; see claude agents",
    ]);
    expect(world.claudeCalls()).toHaveLength(2);
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
      `started C my-app master-plan B6b portal-live (${SHORT_ID}) · sonnet high · crew/B6b-portal-live @ ${head.slice(0, 7)}`,
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
      expect(world.out).toEqual([`failed C my-app master-plan B6b portal-live: ${reason}`]);
      expect(world.claudeCalls().map((call) => call[0])).toEqual(["plugin", "--bg", "agents"]);
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

/**
 * A crew session in this repository, in `state`, holding `files`: the state the file-clash check
 * reads (D55).
 */
async function otherLeadCrew(
  world: Awaited<ReturnType<typeof ledWorld>>,
  change: {
    files: string[];
    id: string;
    name: string;
    state: string;
    leadName?: string;
    leadSessionId?: string;
  },
): Promise<CrewRecord> {
  return await createCrew(
    world.paths.stateDir,
    {
      base: null,
      baseRef: "main",
      branch: `crew/${change.id}`,
      effort: "high",
      files: change.files,
      id: change.id,
      kind: "build",
      lastLine: null,
      leadName: change.leadName ?? "LEAD my-app docs-plan",
      leadSessionId: change.leadSessionId ?? OTHER_SESSION,
      memoryMb: null,
      model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
      name: change.name,
      permissionMode: "auto",
      phase: "C5b",
      plan: "docs-plan",
      pr: null,
      questions: [],
      repo: world.repo,
      reportPath: null,
      sessionId: null,
      shortId: null,
      slug: "trim",
      state: change.state,
      waitsFor: [],
      worktree: join(world.repo, ".claude", "worktrees", "crew-C5b-trim"),
    },
    T0,
  );
}

/** The file-clash events of the world's repository. */
function clashEvents(world: ReturnType<typeof crewWorld>) {
  return readCrewEvents(world.paths.stateDir, world.repo).events.filter(
    (one) => one.type === "clash",
  );
}

/** The line the start of B6b prints after its own line when it clashes over `README.md`. */
const CLASH_LINE =
  "clash: C my-app C5b trim (LEAD my-app docs-plan) may change the same files: README.md — not blocked; two leads may mean to share a file";

describe("D55: a file clash between two leads, warned at crew start", () => {
  test("shared files: one line naming the other lead, its crew session and the files", async () => {
    const world = await ledWorld();
    const other = await otherLeadCrew(world, {
      files: ["README.md"],
      id: "C5b-trim-4d5e6f",
      name: "C my-app C5b trim",
      state: "working",
    });
    const head = git(world.repo, "rev-parse", "HEAD").trim().slice(0, 7);
    const code = await runCrew(startArgs(world.brief, "--files", "README.md"), world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      `started C my-app master-plan B6b portal-live (${SHORT_ID}) · sonnet high · crew/B6b-portal-live @ ${head}`,
      CLASH_LINE,
    ]);
    expect(clashEvents(world)).toMatchObject([
      { crew: other.id, lead: OTHER_SESSION, name: other.name, state: "working", text: CLASH_LINE },
    ]);
  });

  test("disjoint files: no line and no event", async () => {
    const world = await ledWorld();
    await otherLeadCrew(world, {
      files: ["README.md"],
      id: "C5b-trim-4d5e6f",
      name: "C my-app C5b trim",
      state: "working",
    });
    expect(await runCrew(startArgs(world.brief, "--files", ".gitignore"), world.ctx())).toBe(0);
    expect(world.out).toHaveLength(1);
    expect(clashEvents(world)).toEqual([]);
  });

  test("a crew session of the same lead is no clash: one lead means one plan", async () => {
    const world = await ledWorld();
    await otherLeadCrew(world, {
      files: ["README.md"],
      id: "C5b-trim-4d5e6f",
      leadName: "LEAD my-app master-plan",
      leadSessionId: LEAD_SESSION,
      name: "C my-app C5b trim",
      state: "working",
    });
    expect(await runCrew(startArgs(world.brief, "--files", "README.md"), world.ctx())).toBe(0);
    expect(world.out).toHaveLength(1);
    expect(clashEvents(world)).toEqual([]);
  });

  test("a queued crew session of another lead clashes too", async () => {
    const world = await ledWorld();
    await otherLeadCrew(world, {
      files: ["README.md"],
      id: "C5b-trim-4d5e6f",
      name: "C my-app C5b trim",
      state: "queued",
    });
    expect(await runCrew(startArgs(world.brief, "--files", "README.md"), world.ctx())).toBe(0);
    expect(world.out[1]).toBe(CLASH_LINE);
    expect(clashEvents(world).map((one) => one.state)).toEqual(["queued"]);
  });

  test("two globs that match no file yet, under one prefix, overlap", async () => {
    const world = await ledWorld();
    await otherLeadCrew(world, {
      files: ["src/crew/**"],
      id: "C5b-trim-4d5e6f",
      name: "C my-app C5b trim",
      state: "working",
    });
    expect(await runCrew(startArgs(world.brief, "--files", "src/crew/new.ts"), world.ctx())).toBe(
      0,
    );
    expect(world.out[1]).toBe(
      'warning: --files "src/crew/new.ts" matches no file yet: fine for a file this phase creates; else check the path — not blocked',
    );
    expect(world.out[2]).toBe(
      "clash: C my-app C5b trim (LEAD my-app docs-plan) may change the same files: src/crew/new.ts and src/crew/** (no file matches both yet) — not blocked; two leads may mean to share a file",
    );
    // The rule on its own: the tracked files decide when they can; a glob against a path that
    // does not exist yet is exact (the glob says whether it names it); two globs or two paths
    // are judged by their fixed prefixes; different folders never clash.
    expect(filesOverlap(["src/crew/**"], ["src/crew/new.ts"], ["README.md"])).toEqual({
      files: [],
      patterns: ["src/crew/**", "src/crew/new.ts"],
    });
    expect(filesOverlap(["src/crew/new.ts"], ["src/crew/*.ts"], [])).toEqual({
      files: [],
      patterns: ["src/crew/new.ts", "src/crew/*.ts"],
    });
    expect(filesOverlap(["src/crew/*.ts"], ["src/other/new.ts"], [])).toBeNull();
    // `*` does not cross `/`, so `src/crew/*.ts` can never name the file in `deep/`: the glob
    // is asked, and it says no.
    expect(
      filesOverlap(["src/crew/*.ts"], ["src/crew/deep/new.ts"], ["src/crew/start.ts"]),
    ).toBeNull();
    // A pattern that starts with a wildcard names no fixed place: `*.md` is never under a
    // folder, while `**/*.ts` may reach anywhere.
    expect(filesOverlap(["*.md"], ["src/brand-new.ts"], ["README.md"])).toBeNull();
    expect(filesOverlap(["*.md"], ["*.ts"], ["README.md"])).toBeNull();
    expect(filesOverlap(["**/*.ts"], ["src/brand-new.ts"], ["README.md"])).toEqual({
      files: [],
      patterns: ["**/*.ts", "src/brand-new.ts"],
    });
    // A `./` prefix is the same path as git spells it.
    expect(filesOverlap(["./README.md"], ["README.md"], ["README.md"])).toEqual({
      files: ["README.md"],
      patterns: null,
    });
    // A bare folder names everything under it, so a glob whose own fixed prefix is inside that
    // folder can only name files the folder holds.
    expect(filesOverlap(["src/crew/*.ts"], ["src/crew"], ["README.md"])).toEqual({
      files: [],
      patterns: ["src/crew/*.ts", "src/crew"],
    });
    expect(filesOverlap(["src/crew/*.ts"], ["src/crew/deep"], ["README.md"])).toBeNull();
    // Two globs that both match real files are decided by the files they match.
    expect(
      filesOverlap(["src/crew/*.ts"], ["src/crew/**"], ["src/crew/start.ts", "src/crew/diff.ts"]),
    ).toEqual({ files: ["src/crew/diff.ts", "src/crew/start.ts"], patterns: null });
  });

  test("the other lead's watch says the clash as one line, once", async () => {
    const world = await ledWorld();
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
    await otherLeadCrew(world, {
      files: ["README.md"],
      id: "C5b-trim-4d5e6f",
      name: "C my-app C5b trim",
      state: "working",
    });
    expect(await runCrew(startArgs(world.brief, "--files", "README.md"), world.ctx())).toBe(0);
    world.out.length = 0;
    expect(
      await runCrew(["watch", "--lead", OTHER_SESSION, "--once", "--timeout", "0"], world.ctx()),
    ).toBe(0);
    expect(world.out).toEqual([CLASH_LINE]);
    // Once: the next pass says nothing new.
    world.out.length = 0;
    expect(
      await runCrew(["watch", "--lead", OTHER_SESSION, "--once", "--timeout", "0"], world.ctx()),
    ).toBe(0);
    expect(world.out).toEqual([]);
  });
});

describe("WN1: a clash pair is said once, and a glob that matches too much is warned", () => {
  /** A start of B6b under `slug`, holding `files`. */
  function startSlug(world: Awaited<ReturnType<typeof ledWorld>>, slug: string, files: string) {
    return runCrew(
      ["start", "B6b", "--slug", slug, "--kind", "build", "--brief", world.brief, "--files", files],
      world.ctx(),
    );
  }

  /** A start of `phase` holding `files`. */
  function startPhase(world: Awaited<ReturnType<typeof ledWorld>>, phase: string, files: string) {
    return runCrew(
      ["start", phase, "--slug", "x", "--kind", "build", "--brief", world.brief, "--files", files],
      world.ctx(),
    );
  }

  /** 30 tracked files under `docs/`. */
  function trackDocs(world: Awaited<ReturnType<typeof ledWorld>>): number {
    mkdirSync(join(world.repo, "docs"), { recursive: true });
    for (let i = 0; i < 30; i += 1) writeFileSync(join(world.repo, "docs", `p${i}.md`), "x\n");
    git(world.repo, "add", "-A");
    git(world.repo, "commit", "-m", "docs");
    return git(world.repo, "ls-files").trim().split("\n").length;
  }

  test("three starts of one phase that clash with one session say the pair once", async () => {
    const world = await ledWorld();
    await otherLeadCrew(world, {
      files: ["README.md"],
      id: "C5b-trim-4d5e6f",
      name: "C my-app C5b trim",
      state: "working",
    });
    expect(await startSlug(world, "first", "README.md")).toBe(0);
    expect(world.out.filter((line) => line.startsWith("clash:"))).toEqual([CLASH_LINE]);
    for (const slug of ["second", "third"]) {
      world.out.length = 0;
      expect(await startSlug(world, slug, "README.md")).toBe(0);
      expect(world.out.filter((line) => line.startsWith("clash:"))).toEqual([]);
    }
    // One event for the other lead's watch, not three.
    expect(clashEvents(world)).toHaveLength(1);
  });

  test("a new pair is said", async () => {
    const world = await ledWorld();
    await otherLeadCrew(world, {
      files: ["README.md"],
      id: "C5b-trim-4d5e6f",
      name: "C my-app C5b trim",
      state: "working",
    });
    expect(await startPhase(world, "B6b", "README.md")).toBe(0);
    world.out.length = 0;
    // Another phase of this lead against the same session is another pair.
    expect(await startPhase(world, "B6d", "README.md")).toBe(0);
    expect(world.out.filter((line) => line.startsWith("clash:"))).toEqual([CLASH_LINE]);
    expect(clashEvents(world)).toHaveLength(2);
  });

  test("the pair is the same from either lead", () => {
    expect(clashPairKey({ lead: "s1", phase: "B6b" }, { lead: "s2", phase: "C5b" })).toBe(
      clashPairKey({ lead: "s2", phase: "C5b" }, { lead: "s1", phase: "B6b" }),
    );
    expect(clashPairKey({ lead: "s1", phase: "B6b" }, { lead: "s2", phase: "C5b" })).not.toBe(
      clashPairKey({ lead: "s1", phase: "B6c" }, { lead: "s2", phase: "C5b" }),
    );
  });

  test("a glob that matches a large share of the tracked files is warned, never refused", async () => {
    const world = await ledWorld();
    const tracked = trackDocs(world);
    expect(await startSlug(world, "wide", "docs/**/*.md")).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out.filter((line) => line.startsWith("warning:"))).toEqual([
      `warning: --files "docs/**/*.md" matches 30 of ${tracked} tracked files (${Math.round((30 / tracked) * 100)}%), far more than one phase usually changes — it makes every other crew session that holds a file under it clash with this one; name the files the phase owns — not blocked`,
    ]);
  });

  test("an unmatched files glob warns but still starts", async () => {
    const world = await ledWorld();
    expect(await startSlug(world, "newfile", "src/new-*.ts")).toBe(0);
    expect(world.out.filter((line) => line.startsWith("warning:"))).toEqual([
      'warning: --files "src/new-*.ts" matches no file yet: fine for a file this phase creates; else check the path — not blocked',
    ]);
  });

  test("a repository under 20 tracked files has no broad glob", async () => {
    const world = await ledWorld();
    expect(await startSlug(world, "small", "**/*")).toBe(0);
    expect(world.out.filter((line) => line.startsWith("warning:"))).toEqual([]);
  });

  test("a bare folder that holds most of the repository is warned", async () => {
    const world = await ledWorld();
    trackDocs(world);
    expect(await startSlug(world, "folder", "docs/")).toBe(0);
    expect(world.out.filter((line) => line.startsWith("warning:"))).toHaveLength(1);
  });

  test("a narrow glob and a path are not warned", async () => {
    const world = await ledWorld();
    trackDocs(world);
    expect(await startSlug(world, "narrow", "docs/p3*.md, docs/p2.md")).toBe(0);
    expect(world.out.filter((line) => line.startsWith("warning:"))).toEqual([]);
  });
});

describe("Remote Control: off in every crew session", () => {
  test("the settings file a launch writes holds remoteControlAtStartup false, beside a plugin list or none", () => {
    // Setup turns auto-connect on for the person's own sessions; a crew session's `--settings`
    // file is the one source that turns it off for that session alone (a project file cannot
    // turn it on, and need not turn it off). No process is started here, so it runs anywhere.
    expect(crewSettings("c1", [])).toEqual({
      permissions: { allow: ["mcp__cc-smart-dev-kit-tasks__*"] },
      disableClaudeAiConnectors: true,
      env: {
        CC_SMART_DEV_KIT_CREW: "c1",
        CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
        CLAUDE_CODE_RETRY_WATCHDOG: "1",
        CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: "300000",
      },
      remoteControlAtStartup: false,
    });
    expect(crewSettings("c2", ["stripe@claude-plugins-official"])).toMatchObject({
      enabledPlugins: { "stripe@claude-plugins-official": false },
      remoteControlAtStartup: false,
    });
  });
});
