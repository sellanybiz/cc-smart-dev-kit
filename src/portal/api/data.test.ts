/**
 * The facts B6d added to the API: Claude Code's version and live proof, the Bun the portal runs
 * on, the MCP servers, what holds the router's port, the plan's 5-hour window, the other
 * sessions' state, and the crew caps on Settings.
 *
 * A temp HOME holds every file a reader reads; `claude` and `systemctl` are fakes on the
 * test's own PATH or an injected runner. No test reaches the real machine, its Claude Code or
 * its router.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../../cli/paths";
import { createCrew, type NewCrew, updateCrew } from "../../crew/store";
import { fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import { makeRepo } from "../../testing/hooks";
import { cleanGitEnv, tempDir } from "../../testing/temp";
import { type ActionContext, portalOmnirouteContext, runAction } from "../actions";
import type { PortalContext } from "../context";
import { bunFacts, claudeCodeFacts, mcpRows, planWindow, portHolder } from "../facts";
import type { PageDataDeps } from "../page-data";
import { gatewayKeyState, overviewAnswer, settingsAnswer } from "./data";
import { testPortalContext } from "./test-context";
import { SESSION_WORKING_MS, sessionStateOf, workAnswer } from "./work";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

/**
 * A temp HOME, its paths, and a PATH holding only the scripts given (name → shell body), and
 * the real git when `withGit` (the Work answer finds its repository with it).
 */
function world(
  scripts: Record<string, string> = {},
  over: Partial<PortalContext> & { platform?: NodeJS.Platform } = {},
  withGit = false,
): { ctx: PortalContext; paths: CliPaths } {
  const home = tempDir("data-home");
  const bin = join(home, "bin");
  mkdirSync(bin);
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  if (withGit) symlinkSync(Bun.which("git") ?? "/usr/bin/git", join(bin, "git"));
  const env = {
    ...cleanGitEnv(),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    HOME: home,
    PATH: bin,
  };
  const paths = cliPaths(env);
  return { ctx: testPortalContext(paths, env, () => NOW, over), paths };
}

function writeAt(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** The page data's deps for one context, with no gateway config. */
function depsOf(ctx: PortalContext): PageDataDeps {
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd: tempDir("data-cwd"),
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  return {
    action,
    doctor: async () => null,
    facts: async () => ({ platform: "linux", portalPort: 0, router: null, version: "0.0.0" }),
    found: { error: "this test reads no gateway config" },
    projectDefaults: action.projectDefaults,
    workflow,
  };
}

describe("Claude Code on the Machine page", () => {
  test("the version `claude --version` says, and the last live proof", async () => {
    const { ctx, paths } = world({ claude: "echo '2.1.312 (Claude Code)'" });
    writeAt(
      join(paths.stateDir, "live-check.json"),
      JSON.stringify({
        claudeCode: "2.1.309",
        passedAt: "2026-10-20T08:00:00.000Z",
        plugin: "1.0.0",
      }),
    );
    expect(await claudeCodeFacts(ctx)).toEqual({
      liveCheck: { claudeCode: "2.1.309", passedAt: "2026-10-20T08:00:00.000Z", plugin: "1.0.0" },
      version: "2.1.312",
      why: null,
    });
  });

  test("no claude on PATH, or one that names no version: a reason, never a number", async () => {
    expect(await claudeCodeFacts(world().ctx)).toEqual({
      liveCheck: null,
      version: null,
      why: "claude is not on PATH",
    });
    expect(await claudeCodeFacts(world({ claude: "echo broken; exit 3" }).ctx)).toEqual({
      liveCheck: null,
      version: null,
      why: "claude --version named no version (exit 3)",
    });
  });
});

describe("the Bun the portal runs on", () => {
  test("its version against the kit's minimum", () => {
    expect(bunFacts(world({}, { bunVersion: "1.4.2" }).ctx)).toEqual({
      minimum: "1.4.3",
      ok: false,
      version: "1.4.2",
    });
    expect(bunFacts(world({}, { bunVersion: "1.5.0" }).ctx).ok).toBe(true);
  });
});

describe("the MCP servers", () => {
  test("every server setup registers, missing on a machine with none", () => {
    const { ctx } = world();
    expect(mcpRows(ctx)).toEqual([
      { name: "playwright", runsWhat: null, state: "missing" },
      { name: "sequential-thinking", runsWhat: null, state: "missing" },
      { name: "tavily-websearch", runsWhat: null, state: "missing" },
    ]);
  });

  test("a Claude Code config that cannot be read: nothing can be said of any", () => {
    const { ctx, paths } = world();
    writeAt(paths.userConfigFile, "{ not json");
    expect(mcpRows(ctx).map((row) => row.state)).toEqual([
      "unreadable",
      "unreadable",
      "unreadable",
    ]);
  });
});

describe("what holds the router's port", () => {
  test("no service on this machine: nothing to show", () => {
    expect(portHolder(world({}, { platform: "darwin" }).ctx, 20_999)).toBe(null);
  });

  test("systemd with no socket unit: doctor's own failure, with its fix", () => {
    const { ctx } = world({ systemctl: "exit 0" });
    const holder = portHolder(ctx, 20_999);
    expect(holder?.kind).toBe("systemd");
    expect(holder?.name).toBe("cc-smart-dev-kit-router.socket");
    expect(holder?.state).toBe("other");
    expect(holder?.check.ok).toBe(false);
    expect(holder?.check.text).toBe(
      "no socket unit at ~/.config/systemd/user/cc-smart-dev-kit-router.socket: a router restart makes new requests fail while the old router drains",
    );
  });
});

describe("the plan's 5-hour window", () => {
  const file = (paths: CliPaths) => join(paths.stateDir, "usage-window.json");

  test("the share the status line recorded, and when it resets", () => {
    const { ctx, paths } = world();
    const resets = Date.UTC(2026, 9, 23, 14, 0, 0) / 1000;
    writeAt(
      file(paths),
      JSON.stringify({
        fiveHour: { percent: 61, resetsAt: resets },
        readAt: "2026-10-23T11:50:00.000Z",
      }),
    );
    expect(planWindow(ctx)).toEqual({ percent: 61, resetsAt: "2026-10-23T14:00:00.000Z" });
  });

  test("a window that is over, or no reading at all: no number", () => {
    const { ctx, paths } = world();
    expect(planWindow(ctx)).toBe(null);
    const past = Date.UTC(2026, 9, 23, 11, 0, 0) / 1000;
    writeAt(
      file(paths),
      JSON.stringify({
        fiveHour: { percent: 99, resetsAt: past },
        readAt: "2026-10-23T10:00:00.000Z",
      }),
    );
    expect(planWindow(ctx)).toBe(null);
  });

  test("the Overview carries it, also on a machine whose gateway is not set up", async () => {
    const { ctx, paths } = world();
    writeAt(
      file(paths),
      JSON.stringify({
        fiveHour: { percent: 12, resetsAt: null },
        readAt: "2026-10-23T11:00:00.000Z",
      }),
    );
    const answer = await overviewAnswer(depsOf(ctx));
    expect(answer.configured).toBe(false);
    expect(answer.fiveHour).toEqual({ percent: 12, resetsAt: null });
  });
});

describe("the gateway's own OmniRoute key on the Machine page (PK1)", () => {
  const config = (apiKey: null | string) => ({
    config: {
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com" as const,
      backends: apiKey === null ? {} : { omniroute: { apiKey, baseUrl: "http://127.0.0.1:20128" } },
      port: 20_197,
      slots: {},
      timeouts: { firstByteMs: 60_000 },
      version: 1 as const,
    },
  });

  test("a word for each state, and never the key", () => {
    expect(gatewayKeyState(config("omni_PLANTED_key"), true)).toBe("set");
    expect(gatewayKeyState(config(""), true)).toBe("none");
    expect(gatewayKeyState(config(null), true)).toBe("none");
    expect(gatewayKeyState({ error: "no config" }, false)).toBe("not-set-up");
    expect(gatewayKeyState({ error: "not JSON" }, true)).toBe("unreadable");
  });
});

describe("another session's state", () => {
  const id = "eeee5555-0000-4000-8000-000000000000";

  test("ended, waiting on a prompt, working, or idle", () => {
    const none = new Set<string>();
    expect(sessionStateOf({ endedCleanly: true, id, lastWrite: NOW }, new Set([id]), NOW)).toBe(
      "ended",
    );
    expect(
      sessionStateOf({ endedCleanly: false, id, lastWrite: NOW - 3_600_000 }, new Set([id]), NOW),
    ).toBe("waiting");
    expect(
      sessionStateOf({ endedCleanly: false, id, lastWrite: NOW - SESSION_WORKING_MS }, none, NOW),
    ).toBe("working");
    expect(
      sessionStateOf(
        { endedCleanly: false, id, lastWrite: NOW - SESSION_WORKING_MS - 1 },
        none,
        NOW,
      ),
    ).toBe("idle");
  });
});

describe("a crew session on Work", () => {
  test("the files it owns, what it waits for, its newest line and its memory, from its store", async () => {
    const { ctx, paths } = world({}, {}, true);
    const repo = makeRepo("data-work");
    const crew: NewCrew = {
      base: null,
      baseRef: "main",
      branch: "crew/K-contracts",
      effort: "high",
      files: ["src/portal/api/**"],
      id: "crew-K-contracts",
      kind: "ui",
      lastLine: null,
      leadName: "LEAD my-app master-plan",
      leadSessionId: "11111111-1111-4111-8111-111111111111",
      memoryMb: null,
      model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
      name: "C my-app K contracts",
      permissionMode: "auto",
      phase: "K",
      plan: ".claude/plans/master-plan.md",
      pr: null,
      questions: [],
      reportPath: null,
      repo,
      sessionId: null,
      shortId: null,
      slug: "contracts",
      state: "starting",
      waitsFor: ["B8"],
      worktree: join(repo, ".claude", "worktrees", "crew-K-contracts"),
    };
    await createCrew(paths.stateDir, crew, NOW - 600_000);
    await updateCrew(
      paths.stateDir,
      repo,
      crew.id,
      { state: "working" },
      NOW - 300_000,
      "started in its worktree",
      310,
    );
    // Another crew session of the same log, with newer events: none of them is this one's.
    await createCrew(
      paths.stateDir,
      { ...crew, branch: "crew/L-other", id: "crew-L-other", name: "C my-app L other", phase: "L" },
      NOW - 240_000,
    );
    await updateCrew(
      paths.stateDir,
      repo,
      "crew-L-other",
      { state: "working" },
      NOW - 60_000,
      "the other one's line",
      900,
    );
    const deps = depsOf(ctx);
    const answer = await workAnswer({ ...deps, action: { ...deps.action, cwd: repo } });
    const summary = answer.crew.find((one) => one.id === crew.id);
    expect(summary?.files).toEqual(["src/portal/api/**"]);
    expect(summary?.waitsFor).toEqual(["B8"]);
    expect(summary?.lastEvent).toEqual({
      at: "2026-10-23T11:55:00.000Z",
      text: "started in its worktree",
      type: "state",
    });
    expect(summary?.memory).toEqual([{ at: "2026-10-23T11:55:00.000Z", mb: 310 }]);
    // Its state began at its own newest state event, never at another event of the log.
    expect(summary?.stateSince).toBe("2026-10-23T11:55:00.000Z");
  });
});

describe("the crew caps on Settings", () => {
  test("the four caps, in the crew card, with their values and where each came from", () => {
    const rows = settingsAnswer(depsOf(world().ctx)).rows.filter((row) => row.card === "crew");
    expect(rows.map((row) => [row.key, row.value, row.source, row.readOnly, row.unit])).toEqual([
      ["crew.perLead", 4, "default", false, undefined],
      ["crew.perLeadOpus", 2, "default", false, undefined],
      ["crew.max", 24, "default", false, undefined],
      ["crew.usagePercent", 85, "default", false, "%"],
    ]);
  });

  test("a cap is written as the person's own setting; a cap out of range is refused", async () => {
    const deps = depsOf(world().ctx);
    const written = await runAction("workflow.set", { key: "crew.perLead", value: 6 }, deps.action);
    expect(written.ok).toBe(true);
    const refused = await runAction("workflow.set", { key: "crew.max", value: 0 }, deps.action);
    expect(refused).toEqual({ lines: ["crew.max is a whole number 1-100"], ok: false });
    expect((deps.workflow as ReturnType<typeof fakeWorkflow>).calls.writePersonalSetting).toEqual([
      { key: "crew.perLead", value: 6 },
    ]);
  });
});
