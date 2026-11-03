import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../../cli/paths";
import { localDay } from "../../gateway/safety-checks";
import { fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import { makeRepo } from "../../testing/hooks";
import { cleanGitEnv, tempDir } from "../../testing/temp";
import { type ActionContext, portalOmnirouteContext } from "../actions";
import { PAGE_READ_FRESH_MS } from "../cli-child";
import type { PageDataDeps } from "../page-data";
import { readPortalAgents } from "./agents-read";
import { testPortalContext } from "./test-context";
import { historyAnswer, workAnswer } from "./work";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

function world() {
  const home = tempDir("work-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const ctx = testPortalContext(
    paths,
    {
      ...cleanGitEnv(),
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: home,
      PATH: process.env.PATH ?? "",
    },
    () => NOW,
    { which: () => null },
  );
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  const deps: PageDataDeps = {
    action,
    doctor: async () => null,
    facts: async () => ({ platform: "linux", portalPort: 0, router: null, version: "0.0.0" }),
    found: { error: "this test reads no gateway config" },
    projectDefaults: action.projectDefaults,
    workflow,
  };
  return { deps, home, paths, repoA: makeRepo("work-a"), repoB: makeRepo("work-b") };
}

describe("auto mode's safety checks beside the history (F6)", () => {
  /**
   * A file the router wrote, holding `checks` checks today and `oldChecks` three local days
   * back. The days are keyed by `localDay` with no zone — as the router keys them and the
   * portal reads them — so the same zone is used on both sides, whatever the test machine is.
   */
  function seedChecks(paths: CliPaths, checks: number, oldChecks = 0): void {
    const side = (count: number) => ({
      cacheRead: 0,
      cacheWrite: 0,
      checks: count,
      input: 0,
      output: 0,
    });
    const day = (count: number) => ({ anthropic: side(count), checks: count, fallback: side(0) });
    mkdirSync(dirname(paths.safetyChecksFile), { recursive: true });
    writeFileSync(
      paths.safetyChecksFile,
      JSON.stringify({
        days: {
          [localDay(NOW)]: day(checks),
          [localDay(NOW - 3 * 24 * 3_600_000)]: day(oldChecks),
        },
        version: 1,
      }),
    );
  }

  test("the count of the local days the range covers travels with the history", () => {
    const w = world();
    seedChecks(w.paths, 9, 100);
    // One hour, one day: today's nine checks, and not the hundred of three days back.
    expect(historyAnswer(w.deps, "1h", "target").safetyChecks).toEqual({ checks: 9, days: 1 });
    // A day reaches back past one midnight but not three days: still today's day alone. The
    // days are the ones the count covers, not the width of the range.
    expect(historyAnswer(w.deps, "1d", "target").safetyChecks).toEqual({ checks: 9, days: 1 });
    // A week holds both counted days, and adds them.
    expect(historyAnswer(w.deps, "7d", "target").safetyChecks).toEqual({ checks: 109, days: 2 });
    // No request was ever logged in this temp HOME: the checks still travel, and it says so.
    const hour = historyAnswer(w.deps, "1h", "target");
    expect(hour.available).toBe(true);
    expect(hour.note).toContain("no request has been logged yet");
  });

  test("no file counted anything yet: the count is unknown, never 0", () => {
    const w = world();
    expect(historyAnswer(w.deps, "1d", "target").safetyChecks).toEqual({ checks: null, days: 0 });
  });
});

function finishedAgent(w: ReturnType<typeof world>, state = "done") {
  const bin = tempDir("portal-agent");
  const binary = join(bin, "claude");
  const rows = [
    {
      id: "abcd1234",
      sessionId: "finished-session",
      name: "background task",
      cwd: w.repoB,
      kind: "background",
      state,
    },
  ];
  writeFileSync(
    binary,
    `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(rows))});\n`,
  );
  chmodSync(binary, 0o755);
  w.deps.action.portal.which = (name) => (name === "claude" ? binary : null);
  const job = join(w.paths.claudeConfigDir, "jobs", "abcd1234");
  mkdirSync(job, { recursive: true });
  writeFileSync(
    join(job, "state.json"),
    JSON.stringify({
      sessionId: "finished-session",
      state,
      updatedAt: "2026-10-21T12:00:00.000Z",
      lastTerminalAt: "2026-10-21T12:00:00.000Z",
    }),
  );
  return binary;
}

describe("a page read starts one child inside the cache window (RX3)", () => {
  /** A `claude` that logs each start, then runs `body`; the count of starts comes back. */
  function countingClaude(w: ReturnType<typeof world>, body: string): () => number {
    const bin = tempDir("portal-count-agent");
    const binary = join(bin, "claude");
    const log = join(bin, "starts");
    writeFileSync(
      binary,
      `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, "x");\n${body}\n`,
    );
    chmodSync(binary, 0o755);
    w.deps.action.portal.which = (name) => (name === "claude" ? binary : null);
    return () => (existsSync(log) ? readFileSync(log, "utf8").length : 0);
  }

  test("two overlapping and one later read of /api/work start one agent-list child", async () => {
    const w = world();
    const starts = countingClaude(w, 'console.log("[]");');
    await Promise.all([workAnswer(w.deps), workAnswer(w.deps)]);
    await workAnswer(w.deps);
    expect(starts()).toBe(1);
    w.deps.action.portal.now = () => NOW + PAGE_READ_FRESH_MS;
    await workAnswer(w.deps);
    expect(starts()).toBe(2);
  });

  test("a removal's own read is never the page's: the agent list is asked every time", async () => {
    const w = world();
    const starts = countingClaude(w, 'console.log("[]");');
    await workAnswer(w.deps);
    await readPortalAgents(w.deps.action.portal, w.deps.action.cwd);
    await readPortalAgents(w.deps.action.portal, w.deps.action.cwd);
    expect(starts()).toBe(3);
  });

  test("a failed read is shown and not kept: the next look asks again", async () => {
    const w = world();
    const starts = countingClaude(w, "process.exit(3);");
    await workAnswer(w.deps);
    await workAnswer(w.deps);
    expect(starts()).toBe(2);
  });
});

test("Work keeps finished background sessions and reports no-project context", async () => {
  const w = world();
  finishedAgent(w);
  const answer = await workAnswer(w.deps);
  expect(answer.finishedSessions.map((session) => session.id)).toEqual(["abcd1234"]);
  expect(answer.finishedSessionsError).toBeNull();
  expect(answer.sessions).toEqual([]);
  expect(answer.folderNote).toContain("not in a project");
  expect(Object.hasOwn(answer, "crew")).toBe(false);
});
