/**
 * The portal's crew actions and `worktrees.clean`, on their own: each run the CLI's own
 * command in a child (`Bun.spawn`), in the record's own repository, so the server's loop stays
 * free — and the two that end something refuse without the page's confirmation.
 *
 * A temp plugin folder's `dist/cli.js` stands in for the CLI: it records each run (its
 * arguments, the folder, and the crew variable) and starts at once. The portal's own folder is
 * a temp home that is no git project, as the starter starts it ([D10]).
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { createCrew, crewStoreDir, type NewCrew } from "../crew/store";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { makeRepo } from "../testing/hooks";
import { cleanGitEnv, tempDir } from "../testing/temp";
import { type ActionContext, crewTimeoutLine, portalOmnirouteContext, runAction } from "./actions";
import { testPortalContext } from "./api/test-context";

/** The lead every record in this test answers to. */
const LEAD = "11111111-1111-4111-8111-111111111111";

/** One queued crew record of `repo`, as the store writes one. */
function crewRecord(repo: string, id: string, over: Partial<NewCrew> = {}): NewCrew {
  return {
    base: null,
    baseRef: "main",
    branch: `crew/${id}`,
    effort: "high",
    files: [],
    id,
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: LEAD,
    memoryMb: null,
    model: { named: "sonnet", resolved: "claude-sonnet-5-5", slot: null, tier: null },
    name: `C my-app ${id}`,
    permissionMode: "auto",
    phase: "P",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    questions: [],
    reportPath: null,
    repo,
    sessionId: null,
    shortId: null,
    slug: "x",
    state: "queued",
    waitsFor: [],
    worktree: join(repo, ".claude", "worktrees", id),
    ...over,
  };
}

/**
 * A plugin folder whose `dist/cli.js` stands in for the CLI: it logs every run as it starts
 * (its arguments, the folder it ran in, and the crew variable it was given), sleeps when
 * `FAKE_CLI_SLEEP` is set, then writes a done file and exits as `FAKE_CLI_EXIT` says.
 */
function fakePlugin(): { done: string; folder: string; log: string } {
  const folder = tempDir("plugin");
  const log = join(folder, "runs.log");
  const done = join(folder, "done");
  mkdirSync(join(folder, "dist"), { recursive: true });
  writeFileSync(join(folder, "bunfig.toml"), "");
  writeFileSync(
    join(folder, "dist", "cli.js"),
    `import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), config: process.env.CLAUDE_CONFIG_DIR, crew: process.env.CC_SMART_DEV_KIT_CREW ?? null, cwd: process.cwd() }) + "\\n");
if (process.env.FAKE_CLI_SLEEP === "1") await Bun.sleep(400);
writeFileSync(${JSON.stringify(done)}, "done\\n");
console.log(process.argv[2] === "crew" && process.argv[3] === "cleanup" ? process.env.FAKE_CLEANUP_JSON ?? "{}" : "crew " + process.argv.slice(2).join(" ") + ": done");
process.exit(process.env.FAKE_CLI_EXIT === undefined ? 0 : Number(process.env.FAKE_CLI_EXIT));
`,
  );
  return { done, folder, log };
}

/** Every run the fake CLI logged. */
function runsOf(
  log: string,
): { args: string[]; config: string; crew: null | string; cwd: string }[] {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return [];
  }
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

/** A portal whose folder is a temp home (no git project), a fake plugin, and two repositories. */
function world(options: { exit?: number; sleep?: boolean } = {}) {
  const home = tempDir("portal-actions-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const plugin = fakePlugin();
  const ctx = testPortalContext(
    paths,
    {
      ...cleanGitEnv(),
      // The portal's own environment may name the crew session whose start began it (D52).
      CC_SMART_DEV_KIT_CREW: "B1-x-1a2b3c",
      ...(options.sleep === true ? { FAKE_CLI_SLEEP: "1" } : {}),
      ...(options.exit === undefined ? {} : { FAKE_CLI_EXIT: String(options.exit) }),
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: home,
      PATH: process.env.PATH ?? "",
    },
    () => Date.now(),
    { pluginFolder: () => ({ folder: plugin.folder }) },
  );
  const agentBinary = join(home, "fake-claude");
  writeFileSync(agentBinary, `#!${process.execPath}\nconsole.log("[]");\n`);
  chmodSync(agentBinary, 0o755);
  ctx.which = (name) => (name === "claude" ? agentBinary : null);
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  return {
    action,
    crewIn: async (repo: string, id: string, over: Partial<NewCrew> = {}) => {
      await createCrew(paths.stateDir, crewRecord(repo, id, over), Date.now());
      return id;
    },
    done: plugin.done,
    home,
    log: plugin.log,
    paths,
    repoA: makeRepo("actions-a"),
    repoB: makeRepo("actions-b"),
  };
}

describe("a crew action runs the CLI's own command in a child", () => {
  test("crew.stop acts in the record's own repository, and another action answers while it runs", async () => {
    const w = world({ sleep: true });
    const id = await w.crewIn(w.repoB, "crew-P-stop", { state: "working" });
    const started = performance.now();
    let firedAfter = Number.POSITIVE_INFINITY;
    setTimeout(() => {
      firedAfter = performance.now() - started;
    }, 10);
    const slow = runAction("crew.stop", { confirm: true, crew: id }, w.action);
    // Another action, answered by the same server's loop while the child is still running.
    const quick = await runAction("workflow.set", { key: "crew.perLead", value: 6 }, w.action);
    expect(quick.ok).toBe(true);
    expect(existsSync(w.done)).toBe(false);
    const stopped = await slow;
    expect(stopped.ok).toBe(true);
    expect(existsSync(w.done)).toBe(true);
    // A synchronous spawn would have held the loop for the child's 400 ms: no timer could fire.
    expect(firedAfter).toBeLessThan(300);
    expect(runsOf(w.log)).toEqual([
      { args: ["crew", "stop", id], config: w.paths.claudeConfigDir, crew: null, cwd: w.repoB },
    ]);
  });

  test("a record is found on the machine, across repositories, and acted on in its own", async () => {
    const w = world();
    await w.crewIn(w.repoA, "crew-P-a", { state: "stopped" });
    const idB = await w.crewIn(w.repoB, "crew-P-b", { state: "stopped" });
    const resumed = await runAction("crew.resume", { crew: idB }, w.action);
    expect(resumed.ok).toBe(true);
    expect(runsOf(w.log)).toMatchObject([{ args: ["crew", "resume", idB], cwd: w.repoB }]);
  });

  test("crew.answer runs the CLI as the person, in the record's repository", async () => {
    // `crew answer` resumes a stopped crew session with a synchronous `claude` call, so it
    // runs in a child too; `--as-person` is the click (D52), and the bare `--` keeps an
    // answer that starts with two dashes an answer.
    const w = world();
    const id = await w.crewIn(w.repoA, "crew-P-answer", { state: "blocked" });
    const answered = await runAction("crew.answer", { answer: "-- port 3210", crew: id }, w.action);
    expect(answered.ok).toBe(true);
    expect(runsOf(w.log)).toEqual([
      {
        args: ["crew", "answer", "--as-person", "--", id, "-- port 3210"],
        config: w.paths.claudeConfigDir,
        crew: null,
        cwd: w.repoA,
      },
    ]);
  });

  test("worktrees.clean runs the CLI's own worktrees --clean in the portal's folder", async () => {
    const w = world();
    const cleaned = await runAction("worktrees.clean", { confirm: true }, w.action);
    expect(cleaned.ok).toBe(true);
    expect(runsOf(w.log)).toMatchObject([{ args: ["worktrees", "--clean"], cwd: w.home }]);
  });

  test("a child that fails answers with its own lines and its exit code", async () => {
    const w = world({ exit: 1 });
    const id = await w.crewIn(w.repoA, "crew-P-fail", { state: "stopped" });
    const result = await runAction("crew.resume", { crew: id }, w.action);
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([`crew crew resume ${id}: done`]);
  });

  test("a crew action cut at its timeout says part of its work may be done, and points at crew status", () => {
    // `crew rm` makes several calls with 30 s limits each: one cut at the child's own timeout
    // may have removed the worktree, the record, or neither.
    expect(crewTimeoutLine("rm", "crew-P-rm")).toBe(
      "crew rm did not answer in time, so it may have done part of its work: run it again, or cc-smart-dev-kit crew status crew-P-rm to see where it is.",
    );
  });

  test("an id no record of the machine has is refused, and nothing runs", async () => {
    const w = world();
    expect(await runAction("crew.stop", { confirm: true, crew: "crew-ghost" }, w.action)).toEqual({
      lines: ['No crew session on this machine has the id "crew-ghost": the Work page lists them.'],
      ok: false,
    });
    expect(runsOf(w.log)).toEqual([]);
  });

  test("no plugin folder: the action says why, and nothing runs", async () => {
    const w = world();
    const id = await w.crewIn(w.repoA, "crew-P-nofolder", { state: "stopped" });
    const action = {
      ...w.action,
      portal: {
        ...w.action.portal,
        pluginFolder: () => ({ error: "the plugin's folder is gone" }),
      },
    };
    const resumed = await runAction("crew.resume", { crew: id }, action);
    expect(resumed).toEqual({ lines: ["the plugin's folder is gone"], ok: false });
    expect(runsOf(w.log)).toEqual([]);
  });
});

function sessionCandidate(w: ReturnType<typeof world>, state = "done") {
  const folder = tempDir("session-agent");
  const binary = join(folder, "claude");
  const now = w.action.portal.now();
  w.action.portal.now = () => now;
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
  w.action.portal.which = (name) => (name === "claude" ? binary : null);
  const job = join(w.paths.claudeConfigDir, "jobs", "abcd1234");
  mkdirSync(job, { recursive: true });
  const at = new Date(now - 2 * 86400000).toISOString();
  writeFileSync(
    join(job, "state.json"),
    JSON.stringify({ sessionId: "finished-session", state, updatedAt: at, lastTerminalAt: at }),
  );
  return binary;
}

describe("finished session removal", () => {
  test("asks first, revalidates shared eligibility, and runs the targeted CLI in the session folder", async () => {
    const w = world();
    sessionCandidate(w);
    expect((await runAction("sessions.rm", { id: "abcd1234" }, w.action)).ok).toBe(false);
    expect(runsOf(w.log)).toEqual([]);
    const removed = await runAction("sessions.rm", { id: "abcd1234", confirm: true }, w.action);
    expect(removed.ok).toBe(true);
    expect(runsOf(w.log)).toEqual([
      {
        args: ["sessions", "--finished", "--remove", "--yes", "--id", "abcd1234"],
        config: w.paths.claudeConfigDir,
        crew: null,
        cwd: w.repoB,
      },
    ]);
  });

  test("a resumed session, unknown agent view, renamed crew session and broken store never run removal", async () => {
    const resumed = world();
    sessionCandidate(resumed, "working");
    expect(
      (await runAction("sessions.rm", { id: "abcd1234", confirm: true }, resumed.action)).ok,
    ).toBe(false);
    expect(runsOf(resumed.log)).toEqual([]);
    const unknown = world();
    const binary = sessionCandidate(unknown);
    writeFileSync(binary, `#!${process.execPath}\nconsole.log("not JSON");`);
    expect(
      (await runAction("sessions.rm", { id: "abcd1234", confirm: true }, unknown.action)).ok,
    ).toBe(false);
    expect(runsOf(unknown.log)).toEqual([]);
    const owned = world();
    sessionCandidate(owned);
    await owned.crewIn(owned.repoA, "renamed", { sessionId: "finished-session" });
    expect(
      (await runAction("sessions.rm", { id: "abcd1234", confirm: true }, owned.action)).ok,
    ).toBe(false);
    expect(runsOf(owned.log)).toEqual([]);
    const broken = world();
    sessionCandidate(broken);
    const dir = join(crewStoreDir(broken.paths.stateDir, broken.repoA), "crew");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.json"), "{");
    expect(
      (await runAction("sessions.rm", { id: "abcd1234", confirm: true }, broken.action)).ok,
    ).toBe(false);
    expect(runsOf(broken.log)).toEqual([]);
  });

  test("crew removal fails closed when any ownership record is broken", async () => {
    const w = world();
    const id = await w.crewIn(w.repoA, "crew-P-rm", { state: "done" });
    const dir = join(crewStoreDir(w.paths.stateDir, w.repoB), "crew");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.json"), "{");
    const removed = await runAction("crew.rm", { crew: id, confirm: true }, w.action);
    expect(removed.ok).toBe(false);
    expect(removed.lines.join(" ")).toContain("record");
    expect(runsOf(w.log)).toEqual([]);
  });

  test("discard revalidates the shared preview token and passes it to the CLI, never a stale confirmation", async () => {
    const w = world();
    const id = await w.crewIn(w.repoB, "crew-discard", { state: "stopped" });
    const token = "a".repeat(64);
    w.action.portal.env.FAKE_CLEANUP_JSON = JSON.stringify({
      error: null,
      stopped: [
        {
          crew: { id, name: "C my-app crew-discard", shortId: null, state: "stopped" },
          repo: w.repoB,
          since: "2026-10-20T12:00:00.000Z",
          days: 2,
          unmergedCommits: 1,
          line: "shared reminder",
          discard: {
            error: null,
            facts: {
              token,
              head: "b".repeat(40),
              archiveRef: "refs/crew-discarded/crew/crew-discard",
              unmergedCommits: { count: 1, subjects: ["work"] },
              changedFiles: ["work.txt"],
              ignoredFiles: [],
              lines: ["shared exact confirmation words"],
              question: "shared question",
            },
          },
        },
      ],
    });
    const body = {
      crew: id,
      confirm: true,
      discard: true,
      discardConfirm: true,
      discardToken: "c".repeat(64),
    };
    const stale = await runAction("crew.rm", body, w.action);
    expect(stale.ok).toBe(false);
    expect(stale.lines.join(" ")).toContain("changed");
    expect(runsOf(w.log).map((one) => one.args)).toEqual([["crew", "cleanup", "--json"]]);
    const removed = await runAction("crew.rm", { ...body, discardToken: token }, w.action);
    expect(removed.ok).toBe(true);
    expect(runsOf(w.log).at(-1)).toEqual({
      args: ["crew", "rm", id, "--discard", "--yes", "--discard-token", token],
      config: w.paths.claudeConfigDir,
      crew: null,
      cwd: w.repoB,
    });
  });

  test("crew removal refuses an unknown agent view before any CLI removal", async () => {
    const w = world();
    const id = await w.crewIn(w.repoA, "crew-unknown", { state: "stopped" });
    w.action.portal.which = () => null;
    const removed = await runAction("crew.rm", { crew: id, confirm: true }, w.action);
    expect(removed.ok).toBe(false);
    expect(removed.lines.join(" ")).toContain("agent");
    expect(runsOf(w.log)).toEqual([]);
  });

  test("discard is never silently downgraded to normal removal", async () => {
    const w = world();
    const id = await w.crewIn(w.repoA, "crew-discard", { state: "stopped" });
    const removed = await runAction(
      "crew.rm",
      { crew: id, confirm: true, discard: true },
      w.action,
    );
    expect(removed.ok).toBe(false);
    expect(runsOf(w.log)).toEqual([]);
  });
});

describe("the actions that end something ask first", () => {
  test("crew.rm and crew.stop refuse without the page's confirmation, and nothing runs", async () => {
    const w = world();
    const id = await w.crewIn(w.repoA, "crew-P-rm", { state: "done" });
    expect(await runAction("crew.rm", { crew: id }, w.action)).toEqual({
      lines: ["Nothing was removed: the page's confirmation did not come with the request."],
      ok: false,
    });
    expect(await runAction("crew.stop", { crew: id }, w.action)).toEqual({
      lines: ["Nothing was stopped: the page's confirmation did not come with the request."],
      ok: false,
    });
    expect(runsOf(w.log)).toEqual([]);
    // With the page's yes, the CLI's own command runs in the record's repository.
    const removed = await runAction("crew.rm", { confirm: true, crew: id }, w.action);
    expect(removed.ok).toBe(true);
    expect(runsOf(w.log)).toMatchObject([{ args: ["crew", "rm", id], cwd: w.repoA }]);
  });
});
