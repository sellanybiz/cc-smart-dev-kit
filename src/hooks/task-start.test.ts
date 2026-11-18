import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { mcpRecordsFile } from "../mcp/records";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";
import { projectKey } from "../tasks/context";
import { closeDeployTask, createDeployTask } from "../tasks/deploy/files";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { planProgress, startView } from "../tasks/work/read";
import { createTask } from "../tasks/work/store";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { addContext } from "./io";
import { taskStartHook } from "./specs";

test("a 500-task store stays capped and startView and planProgress fit the hook budget", async () => {
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
  const progressStarted = performance.now();
  const progress = planProgress(paths, project, who);
  const progressMs = performance.now() - progressStarted;
  console.info(
    `500-task reads: startView ${startMs.toFixed(3)} ms; planProgress ${progressMs.toFixed(3)} ms`,
  );
  expect(view.state).toBe("ready");
  expect(progress.state).toBe("ready");
  expect(startMs).toBeLessThan(10);
  expect(progressMs).toBeLessThan(10);
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

test("D76: the start block marks non-blocking work and a task that is blocked", async () => {
  const { repo } = makeClone();
  const env = hookEnv();
  const paths = cliPaths(env);
  const project = projectKey(repo);
  const nobody = { sessionId: "other", crewId: null, pid: null, procStart: null };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const at = Date.now() - 60_000;
  const first = createTask(db, { project, subject: "First" }, nobody, at);
  if (!first.ok) throw new Error(first.why);
  const second = createTask(
    db,
    { project, subject: "Second", type: "non-blocking", blockedBy: [first.value.id] },
    nobody,
    at + 1,
  );
  if (!second.ok) throw new Error(second.why);
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
      "Open tasks here (the kit's task list):\n#2 [pending · non-blocking · blocked] Second\n#1 [pending] First",
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

describe("the deploy task line", () => {
  const NOW = new Date("2026-11-17T14:45:03Z");
  const LINE_END = " — /cc-smart-dev-kit:tasks";

  /** A clone with the task server recorded, so the only line a start can say is the deploy one. */
  function world(options: { optedIn?: boolean } = {}) {
    const { repo } = makeClone();
    // The project opted in with its file: only then are old files counted.
    if (options.optedIn !== false) writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const records = mcpRecordsFile(cliPaths(env).stateDir);
    mkdirSync(dirname(records), { recursive: true });
    writeFileSync(
      records,
      JSON.stringify({ servers: { [TASKS_SERVER_NAME]: { at: "2026-11-03", json: "{}" } } }),
    );
    const dir = join(repo, ".claude", "tasks");
    const start = (source = "startup") =>
      runHook(taskStartHook, { hook_event_name: "SessionStart", source, cwd: repo }, env);
    return { repo, env, dir, start };
  }
  const made = (
    dir: string,
    env: "prod" | "staging",
    title: string,
    deploy: "before" | "after" = "before",
    type: "blocking" | "non-blocking" = "blocking",
  ) => createDeployTask(dir, { title, env, deploy, type }, { now: NOW });

  test("a project with no deploy tasks, no old files and no unreadable files says nothing", async () => {
    const { dir, start } = world();
    expect(await start()).toEqual({});
    mkdirSync(join(dir, "prod"), { recursive: true });
    mkdirSync(join(dir, "staging"), { recursive: true });
    expect(await start()).toEqual({});
  });

  test("open tasks are counted per environment, with the blocking ones owed before the deploy", async () => {
    const { dir, start } = world();
    made(dir, "prod", "Run the migration");
    made(dir, "prod", "Tell support", "after", "non-blocking");
    expect(await start()).toEqual(
      addContext(
        "SessionStart",
        `Deploy tasks open: prod 2 (1 blocking before the deploy), staging 0${LINE_END}`,
      ),
    );
  });

  test("a blocking task owed after the deploy, or a non-blocking one, is not owed before it", async () => {
    const { dir, start } = world();
    made(dir, "staging", "Check the dashboard", "after");
    made(dir, "staging", "Warm the cache", "before", "non-blocking");
    expect(await start()).toEqual(
      addContext("SessionStart", `Deploy tasks open: prod 0, staging 2${LINE_END}`),
    );
  });

  test("unreadable files, a duplicate id and old files each add their count", async () => {
    const { dir, start } = world();
    const task = made(dir, "prod", "Run the migration");
    writeFileSync(join(dir, "prod", "prod-20260101-000000-broken.md"), "not a task");
    writeFileSync(join(dir, "prod", "prod-20260102-000000-bad.md"), "also not a task");
    copyFileSync(task.file, join(dir, "prod", `${task.id}-twin.md`));
    writeFileSync(join(dir, "T-abcd-old.md"), "an old task");
    writeFileSync(join(dir, "T-efgh-old.md"), "an old task");
    writeFileSync(join(dir, "T-ijkl-old.md"), "an old task");
    expect(await start()).toEqual(
      addContext(
        "SessionStart",
        `Deploy tasks open: prod 1 (1 blocking before the deploy), staging 0; 2 unreadable; 1 duplicate id; 3 old files not read${LINE_END}`,
      ),
    );
  });

  test("a single unreadable file or old file is worded in the singular", async () => {
    const { dir, start } = world();
    mkdirSync(join(dir, "staging"), { recursive: true });
    writeFileSync(join(dir, "staging", "staging-20260101-000000-broken.md"), "not a task");
    writeFileSync(join(dir, "T-abcd-old.md"), "an old task");
    expect(await start()).toEqual(
      addContext(
        "SessionStart",
        `Deploy tasks open: prod 0, staging 0; 1 unreadable; 1 old file not read${LINE_END}`,
      ),
    );
  });

  test("only old files: the line still shows, with no open task", async () => {
    const { dir, start } = world();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "T-abcd-old.md"), "an old task");
    expect(await start()).toEqual(
      addContext(
        "SessionStart",
        `Deploy tasks open: prod 0, staging 0; 1 old file not read${LINE_END}`,
      ),
    );
  });

  test("a project with no .claude/cc-smart-dev-kit.json: Markdown in .claude/tasks is not counted as old files", async () => {
    const { dir, start } = world({ optedIn: false });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.md"), "unrelated notes");
    expect(await start()).toEqual({});
  });

  test("an unreadable work store: its stderr note stays, and the deploy line still shows", async () => {
    const { env, dir, start } = world();
    made(dir, "prod", "Run the migration");
    const file = workDbFile(cliPaths(env));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "not a database");
    expect(await start()).toEqual({
      ...addContext(
        "SessionStart",
        `Deploy tasks open: prod 1 (1 blocking before the deploy), staging 0${LINE_END}`,
      ),
      stderr: "cc-smart-dev-kit task-start: file is not a database",
    });
  });

  test("a scan that throws: the work list still shows, and stderr is one line", async () => {
    const { repo, env, dir, start } = world();
    const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
    const nobody = { sessionId: "other", crewId: null, pid: null, procStart: null };
    const created = createTask(
      db,
      { project: projectKey(repo), subject: "Step" },
      nobody,
      Date.now() - 60_000,
    );
    if (!created.ok) throw new Error(created.why);
    db.close();
    mkdirSync(dir, { recursive: true });
    // `prod` is a file, not a folder: listing it throws.
    writeFileSync(join(dir, "prod"), "not a folder");
    const result = await start();
    expect(result.stdout).toBe(
      addContext("SessionStart", "Open tasks here (the kit's task list):\n#1 [pending] Step")
        .stdout,
    );
    expect(result.stderr).toStartWith("cc-smart-dev-kit task-start: deploy tasks not read: ");
    expect(result.stderr).not.toContain("\n");
  });

  test("archive/ is never scanned: closed tasks and a broken file there add nothing", async () => {
    const { dir, start } = world();
    const done = made(dir, "prod", "Run the migration");
    closeDeployTask(dir, done.id, { status: "done", evidence: "ran it" }, NOW);
    mkdirSync(join(dir, "prod", "archive"), { recursive: true });
    writeFileSync(join(dir, "prod", "archive", "prod-20260101-000000-broken.md"), "not a task");
    expect(existsSync(join(dir, "prod", "archive", basename(done.file)))).toBe(true);
    expect(await start()).toEqual({});
  });

  test("an environment the project does not deploy to is left out of the counts", async () => {
    const { repo, dir, start } = world();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { tasks: { envs: ["prod"] } });
    made(dir, "prod", "Run the migration");
    expect(await start()).toEqual(
      addContext(
        "SessionStart",
        `Deploy tasks open: prod 1 (1 blocking before the deploy)${LINE_END}`,
      ),
    );
  });

  test("the line shows after every kind of start and sits with the work-list lines", async () => {
    const { repo, env, dir, start } = world();
    made(dir, "prod", "Run the migration");
    const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
    const nobody = { sessionId: "other", crewId: null, pid: null, procStart: null };
    const created = createTask(
      db,
      { project: projectKey(repo), subject: "Step" },
      nobody,
      Date.now() - 60_000,
    );
    if (!created.ok) throw new Error(created.why);
    db.close();
    for (const source of ["startup", "resume", "clear", "compact"]) {
      expect(await start(source)).toEqual(
        addContext(
          "SessionStart",
          `Open tasks here (the kit's task list):\n#1 [pending] Step\nDeploy tasks open: prod 1 (1 blocking before the deploy), staging 0${LINE_END}`,
        ),
      );
    }
  });
});
