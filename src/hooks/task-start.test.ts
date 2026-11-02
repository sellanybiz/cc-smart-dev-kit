import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cliPaths } from "../cli/paths";
import { CREW_ENV } from "../crew/session";
import { mcpRecordsFile } from "../mcp/records";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";
import { projectKey } from "../tasks/context";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { startView, statusTask } from "../tasks/work/read";
import { createTask } from "../tasks/work/store";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { addContext } from "./io";
import { taskStartHook } from "./specs";

test("a 500-task store stays capped and both reads fit the hook budget", async () => {
  const { repo } = makeClone();
  const env = hookEnv();
  const paths = cliPaths(env);
  const project = projectKey(repo);
  const who = { sessionId: "s", crewId: null, pid: 7, procStart: "70" };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  // Touched a minute ago, one millisecond apart: none is stale, and the newest sorts first.
  const base = Date.now() - 60_000;
  for (let n = 1; n <= 500; n++) {
    const made = createTask(
      db,
      { project, subject: `Step ${n}`, status: n === 1 ? "in_progress" : "pending" },
      who,
      base + n,
    );
    if (!made.ok) throw new Error(made.why);
  }
  db.close();
  writeFileSync(
    mcpRecordsFile(paths.stateDir),
    JSON.stringify({ servers: { [TASKS_SERVER_NAME]: { at: "2026-11-03", json: "{}" } } }),
  );
  const started = performance.now();
  const view = startView(paths, project, who, { limit: 8 });
  const startMs = performance.now() - started;
  const statusStarted = performance.now();
  const status = statusTask(paths, project, who);
  const statusMs = performance.now() - statusStarted;
  console.info(
    `500-task reads: startView ${startMs.toFixed(3)} ms; statusTask ${statusMs.toFixed(3)} ms`,
  );
  expect(view.state).toBe("ready");
  expect(status.state).toBe("ready");
  expect(startMs).toBeLessThan(10);
  expect(statusMs).toBeLessThan(10);
  expect(
    await runHook(
      taskStartHook,
      { hook_event_name: "SessionStart", source: "clear", cwd: repo },
      env,
    ),
  ).toEqual(
    addContext(
      "SessionStart",
      "Open tasks here (the kit's task list):\n#1 [in progress] Step 1\n#500 [pending] Step 500\n#499 [pending] Step 499\n#498 [pending] Step 498\n#497 [pending] Step 497\n#496 [pending] Step 496\n#495 [pending] Step 495\n#494 [pending] Step 494\n+492 more: task_list",
    ),
  );
});

test("work untouched past the project's tasks.staleDays is counted, not listed", async () => {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", { tasks: { staleDays: 7 } });
  const env = hookEnv();
  const paths = cliPaths(env);
  const project = projectKey(repo);
  const nobody = { sessionId: "other", crewId: null, pid: null, procStart: null };
  const day = 86_400_000;
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  for (const [subject, age] of [
    ["Old one", 10 * day],
    ["Older one", 20 * day],
    ["Fresh one", day],
  ] as const) {
    const made = createTask(db, { project, subject }, nobody, Date.now() - age);
    if (!made.ok) throw new Error(made.why);
  }
  db.close();
  writeFileSync(
    mcpRecordsFile(paths.stateDir),
    JSON.stringify({ servers: { [TASKS_SERVER_NAME]: { at: "2026-11-03", json: "{}" } } }),
  );
  expect(
    await runHook(
      taskStartHook,
      { hook_event_name: "SessionStart", source: "startup", cwd: repo },
      env,
    ),
  ).toEqual(
    addContext(
      "SessionStart",
      'Open tasks here (the kit\'s task list):\n#3 [pending] Fresh one\n2 open tasks untouched for 7 days or more, not shown: task_list with scope "project", then finish or drop them.',
    ),
  );
});

test("an unreadable store says one stderr line and no context", async () => {
  const { repo } = makeClone();
  const env = hookEnv();
  const file = workDbFile(cliPaths(env));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "not a database");
  const result = await runHook(
    taskStartHook,
    { hook_event_name: "SessionStart", source: "compact", cwd: repo },
    env,
  );
  expect(result.stdout).toBeUndefined();
  expect(result.stderr).toBe("cc-smart-dev-kit task-start: file is not a database");
});

const SETUP =
  "The kit's task list is not set up on this machine yet: run `cc-smart-dev-kit setup`.";

test("a start outside git still names setup when the server has no record", async () => {
  expect(
    await runHook(
      taskStartHook,
      { hook_event_name: "SessionStart", source: "startup", cwd: tempDir() },
      hookEnv(),
    ),
  ).toEqual(addContext("SessionStart", SETUP));
});

test("a project with no file gets the machine's setup note on every source", async () => {
  const { repo } = makeClone();
  for (const source of ["startup", "resume", "clear", "compact"]) {
    expect(
      await runHook(
        taskStartHook,
        { hook_event_name: "SessionStart", source, cwd: repo },
        hookEnv(),
      ),
    ).toEqual(addContext("SessionStart", SETUP));
  }
});

test("a crew session gets its list from its role card, not this hook", async () => {
  const { repo } = makeClone();
  expect(
    await runHook(
      taskStartHook,
      { hook_event_name: "SessionStart", source: "resume", cwd: repo },
      { ...hookEnv(), [CREW_ENV]: "crew-a" },
    ),
  ).toEqual({});
});

test("ownHooks can silence the machine-wide start note", async () => {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["task-start"] });
  expect(
    await runHook(
      taskStartHook,
      { hook_event_name: "SessionStart", source: "compact", cwd: repo },
      hookEnv(),
    ),
  ).toEqual({});
});
