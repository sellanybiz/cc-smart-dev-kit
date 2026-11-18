import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../../testing/temp";
import { branchTaskChanges, readGitFacts, tasksOn, unmergedBranchTasks } from "./branch";
import { checkDeployTasks } from "./check";
import {
  addDeployNote,
  closeDeployTask,
  createDeployPair,
  createDeployTask,
  deployTasksDir,
  findDeployTask,
  newDeployId,
  oldTaskFiles,
  reopenDeployTask,
  scanDeployTasks,
  takenDeployIds,
  updateDeployTask,
} from "./files";
import {
  DEPLOY_ENVS,
  DEPLOY_ENVS_RISK_FIRST,
  type DeployTask,
  deployIdOfFileName,
  isDeployTaskId,
  parseDeployTask,
  renderDeployTask,
  taskInstant,
} from "./format";
import {
  type GitFacts,
  gateAfter,
  gateBefore,
  judgeAfter,
  judgeBefore,
  releaseList,
} from "./release";

const now = new Date("2026-11-17T14:45:03Z");

test("the risk-first environment order is the release order, reversed, and holds every environment", () => {
  expect([...DEPLOY_ENVS]).toEqual(["staging", "prod"]);
  expect([...DEPLOY_ENVS_RISK_FIRST]).toEqual(["prod", "staging"]);
});

const task: DeployTask = {
  id: "prod-20261117-144503",
  title: 'Drop old: "invite" # functions\nand more',
  env: "prod",
  status: "open",
  deploy: "before",
  type: "blocking",
  twin: "staging-20261117-144503",
  flags: ["needs-yes", "twice-safe", "spends-money", "real-people", "destructive"],
  created: "2026-09-01T08:00:00Z",
  closed: "2026-10-01T08:00:00Z",
  from: "plan\nphase",
  refs: ["src/missing.ts"],
  evidence: "proof: # yes",
  future: { nested: true },
  body: `# What and why\n${"x".repeat(200_000)}`,
  file: "task.md",
};
function create(dir: string, title = "Deploy", env: "prod" | "staging" = "prod", at = now) {
  return createDeployTask(dir, { title, env, deploy: "before", type: "blocking" }, { now: at });
}
/** Writes a task file by hand, in the folder the env says, for the cases the store refuses to make. */
function put(dir: string, env: string, name: string, fields: Partial<DeployTask>, archive = false) {
  const folder = archive ? join(dir, env, "archive") : join(dir, env);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, name);
  writeFileSync(file, renderDeployTask({ ...task, body: "", ...fields }));
  return file;
}
/** A task of the shape the gate reads, never written to disk. */
function mk(fields: Partial<DeployTask>): DeployTask {
  return { ...task, body: "", twin: undefined, ...fields, file: `/t/${fields.id ?? task.id}.md` };
}
const scanOf = (tasks: DeployTask[], broken: { file: string; why: string }[] = []) => ({
  tasks,
  broken,
  duplicates: [],
});

// --- the id and the front matter -------------------------------------------------------------

test("the id shape: env, UTC date, UTC time and an optional counter", () => {
  for (const good of [
    "prod-20261117-144503",
    "staging-20261117-144503",
    "prod-20261117-144503-2",
    "staging-20261117-144503-17",
  ])
    expect(isDeployTaskId(good)).toBe(true);
  for (const bad of [
    "T-abcdef",
    "dev-20261117-144503",
    "prod-2026117-144503",
    "prod-20261117-14450",
    "prod-20261117-144503-",
    "prod-20261117-144503-x",
    "Prod-20261117-144503",
    "prod-20261117-144503-2-3",
    " prod-20261117-144503",
  ])
    expect(isDeployTaskId(bad)).toBe(false);
});

test("the id a file name starts with: the counter only when it is a whole id", () => {
  expect(deployIdOfFileName("prod-20261117-144503-run-the-migration.md")).toBe(
    "prod-20261117-144503",
  );
  expect(deployIdOfFileName("prod-20261117-144503-2-run-the-migration.md")).toBe(
    "prod-20261117-144503-2",
  );
  expect(deployIdOfFileName("prod-20261117-144503-2fa-setup.md")).toBe("prod-20261117-144503");
  expect(deployIdOfFileName("prod-20261117-144503.md")).toBe("prod-20261117-144503");
  expect(deployIdOfFileName("notes.md")).toBeNull();
  expect(deployIdOfFileName("T-abcdef-old.md")).toBeNull();
});

test("front matter round trips every field, unknown keys, punctuation and a large body", () => {
  const text = renderDeployTask(task);
  const parsed = parseDeployTask(text, task.file, "prod");
  expect(parsed).toEqual({ ok: true, task });
  if (parsed.ok) expect(renderDeployTask(parsed.task)).toBe(text);
  expect(text).toContain('created: "2026-09-01T08:00:00Z"');
  expect(text).toContain('env: "prod"');
});

test("invalid front matter gives clear errors", () => {
  for (const text of [
    "no delimiter",
    "---\ntitle: [\n---\n",
    "---\nid: x\n",
    renderDeployTask({ ...task, deploy: "now" } as unknown as DeployTask),
    renderDeployTask({ ...task, type: undefined } as unknown as DeployTask),
    renderDeployTask({ ...task, deploy: undefined } as unknown as DeployTask),
    renderDeployTask({ ...task, id: "T-aaaaaa" }),
  ]) {
    const result = parseDeployTask(text, "bad.md", "prod");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why.length).toBeGreaterThan(5);
  }
});

test("front matter may not use the names body or file: they are the task's own fields", () => {
  for (const key of ["body", "file"]) {
    const text = renderDeployTask(task).replace(
      'id: "prod-20261117-144503"',
      `id: "prod-20261117-144503"\n${key}: "x"`,
    );
    expect(parseDeployTask(text, "bad.md", "prod")).toEqual({
      ok: false,
      why: `bad.md: "${key}" is a reserved name and cannot be a front-matter key`,
    });
  }
});

test("created and closed must be UTC date-times ending in Z, whatever the time zone", () => {
  const was = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      for (const created of [
        "2026-11-17",
        "2026-11-17T14:45:03",
        "2026-11-17T14:45:03+01:00",
        "2026-11-17T14:45:03-05:00",
        "2026-11-17 14:45:03Z",
        "2026-02-31T14:45:03Z",
        "2026-11-17T25:00:00Z",
      ]) {
        const result = parseDeployTask(renderDeployTask({ ...task, created }), "x.md", "prod");
        expect({ zone, created, ok: result.ok }).toEqual({ zone, created, ok: false });
      }
      for (const created of ["2026-11-17T14:45:03Z", "2026-11-17T14:45:03.123Z"])
        expect(parseDeployTask(renderDeployTask({ ...task, created }), "x.md", "prod").ok).toBe(
          true,
        );
      expect(
        parseDeployTask(
          renderDeployTask({ ...task, closed: "2026-11-17T14:45:03" }),
          "x.md",
          "prod",
        ).ok,
      ).toBe(false);
      // The same instant gives the same text and the same id in every zone.
      expect(taskInstant(now)).toBe("2026-11-17T14:45:03Z");
      expect(newDeployId("prod", now, new Set())).toBe("prod-20261117-144503");
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

test("env must equal the folder and the id prefix, or the file is broken", () => {
  const dir = tempDir();
  const wrongEnv = put(dir, "prod", "prod-20261117-144503-a.md", { env: "staging" });
  const wrongPrefix = put(dir, "prod", "prod-20261117-144504-b.md", {
    id: "staging-20261117-144504",
    env: "prod",
  });
  const wrongFolder = put(dir, "staging", "prod-20261117-144505-c.md", {
    id: "prod-20261117-144505",
    env: "prod",
  });
  const wrongArchive = put(
    dir,
    "staging",
    "prod-20261117-144506-d.md",
    { id: "prod-20261117-144506", env: "prod", status: "done" },
    true,
  );
  const fine = put(dir, "prod", "prod-20261117-144507-ok.md", { id: "prod-20261117-144507" });
  const scan = scanDeployTasks(dir, { archive: true });
  expect(scan.tasks.map((one) => one.id)).toEqual(["prod-20261117-144507"]);
  expect(scan.broken.map((item) => item.file).sort()).toEqual(
    [wrongEnv, wrongPrefix, wrongFolder, wrongArchive].sort(),
  );
  expect(scan.broken.find((item) => item.file === wrongEnv)?.why).toContain(
    'env is "staging" but the file is in the prod folder',
  );
  expect(scan.broken.find((item) => item.file === wrongPrefix)?.why).toContain(
    'does not start with "prod-"',
  );
  expect(existsSync(fine)).toBe(true);
});

test("scan skips unrelated files, files outside an env folder, and reports broken files", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "prod"));
  mkdirSync(join(dir, "other"));
  for (const name of ["prod/README.md", "prod/.hidden.md", "prod/other.txt", "other/x.md"])
    writeFileSync(join(dir, name), "bad");
  writeFileSync(join(dir, "prod", "bad.md"), "bad");
  writeFileSync(join(dir, "top-level.md"), "an old task");
  const result = scanDeployTasks(dir, { archive: false });
  expect(result.tasks).toEqual([]);
  expect(result.broken.map((x) => x.file)).toEqual([join(dir, "prod", "bad.md")]);
});

// --- ids and files ---------------------------------------------------------------------------

test("create writes <env>/<id>-<slug>.md with a UTC id, and a taken id gets -2, -3", () => {
  const root = tempDir();
  const dir = deployTasksDir(root, {});
  expect(dir).toBe(join(root, ".claude/tasks"));
  const first = create(dir, "Run the orders migration");
  expect(first.id).toBe("prod-20261117-144503");
  expect(first.file).toBe(join(dir, "prod", "prod-20261117-144503-run-the-orders-migration.md"));
  expect(first.created).toBe("2026-11-17T14:45:03Z");
  expect(first.status).toBe("open");
  expect(readFileSync(first.file, "utf8")).toContain('env: "prod"');
  expect(create(dir, "Another").id).toBe("prod-20261117-144503-2");
  expect(create(dir, "A third").id).toBe("prod-20261117-144503-3");
  // Another env, the same second: its own folder, its own id.
  const staging = create(dir, "Staging step", "staging");
  expect(staging.id).toBe("staging-20261117-144503");
  expect(staging.file).toBe(join(dir, "staging", "staging-20261117-144503-staging-step.md"));
  // The next second starts again.
  expect(create(dir, "Later", "prod", new Date("2026-11-17T14:45:04.900Z")).id).toBe(
    "prod-20261117-144504",
  );
});

test("an id taken by a closed task, or only by a file name, is not reused", () => {
  const dir = tempDir();
  const first = create(dir);
  closeDeployTask(dir, first.id, { status: "done", evidence: "ok" }, now);
  expect(create(dir, "Again").id).toBe("prod-20261117-144503-2");
  // A file that does not parse still keeps its id's name reserved.
  writeFileSync(join(dir, "prod", "prod-20261117-144503-3-broken.md"), "not a task");
  expect(takenDeployIds(dir, "prod")).toEqual(
    new Set(["prod-20261117-144503", "prod-20261117-144503-2", "prod-20261117-144503-3"]),
  );
  expect(create(dir, "Third").id).toBe("prod-20261117-144503-4");
});

test("update, an exact log line, and a note", () => {
  const dir = tempDir();
  const first = create(dir);
  const updated = updateDeployTask(
    dir,
    first.id,
    { title: "Deploy: safely", deploy: "after", type: "non-blocking" },
    now,
  );
  expect([updated.title, updated.deploy, updated.type]).toEqual([
    "Deploy: safely",
    "after",
    "non-blocking",
  ]);
  expect(addDeployNote(dir, first.id, "Ready", now).body).toBe("\n## Log\n- 2026-11-17 Ready\n");
  expect(addDeployNote(dir, first.id, "Later", now).body).toEndWith("- 2026-11-17 Later\n");
});

test("close: done needs evidence, dropped needs a note, and a closed task is not closed again", () => {
  const dir = tempDir();
  const one = create(dir);
  expect(() => closeDeployTask(dir, one.id, { status: "done" }, now)).toThrow(
    "needs evidence to be done",
  );
  expect(() => closeDeployTask(dir, one.id, { status: "done", evidence: "  " }, now)).toThrow(
    "needs evidence to be done",
  );
  expect(() =>
    closeDeployTask(dir, one.id, { status: "dropped", evidence: "unused" }, now),
  ).toThrow("needs a note to be dropped");
  expect(existsSync(one.file)).toBe(true);
  const closed = closeDeployTask(
    dir,
    one.id,
    { status: "done", evidence: "verified", note: "Checked" },
    new Date("2026-11-17T15:00:00Z"),
  );
  expect(closed.closed).toBe("2026-11-17T15:00:00Z");
  expect(closed.evidence).toBe("verified");
  expect(closed.body).toEndWith("- 2026-11-17 Checked\n");
  expect(closed.file).toBe(join(dir, "prod", "archive", basename(one.file)));
  expect(existsSync(one.file)).toBe(false);
  expect(() => closeDeployTask(dir, one.id, { status: "done", evidence: "again" }, now)).toThrow(
    `${one.id} is already done`,
  );
  expect(() => closeDeployTask(dir, one.id, { status: "dropped", note: "why" }, now)).toThrow(
    "already done",
  );
  const dropped = create(dir, "Other");
  expect(
    closeDeployTask(dir, dropped.id, { status: "dropped", note: "no longer needed" }, now).status,
  ).toBe("dropped");
  expect(() => findDeployTask(dir, "prod-20990101-000000")).toThrow("not found");
});

test("reopen moves an archived task back, open, with closed and evidence cleared and a log line", () => {
  const dir = tempDir();
  const one = create(dir);
  closeDeployTask(dir, one.id, { status: "done", evidence: "verified" }, now);
  const reopened = reopenDeployTask(
    dir,
    one.id,
    new Date("2026-11-18T09:00:00Z"),
    "deploy rolled back",
  );
  expect(reopened.status).toBe("open");
  expect(reopened.closed).toBeUndefined();
  expect(reopened.evidence).toBeUndefined();
  expect(reopened.file).toBe(one.file);
  expect(existsSync(join(dir, "prod", "archive", basename(one.file)))).toBe(false);
  const text = readFileSync(one.file, "utf8");
  expect(text).not.toContain("closed:");
  expect(text).not.toContain("evidence:");
  expect(text).toContain("- 2026-11-18 reopened: deploy rolled back");
  expect(() => reopenDeployTask(dir, one.id, now)).toThrow("already open");
  // It can be closed again.
  expect(closeDeployTask(dir, one.id, { status: "done", evidence: "second try" }, now).status).toBe(
    "done",
  );
});

test("reopen after a crash: an open task left in archive/, or two copies, is finished by running it again", () => {
  const dir = tempDir();
  // Crash after the first step: the archived file is already open.
  const one = create(dir, "First");
  closeDeployTask(dir, one.id, { status: "done", evidence: "ok" }, now);
  const archivedFile = join(dir, "prod", "archive", basename(one.file));
  writeFileSync(
    archivedFile,
    readFileSync(archivedFile, "utf8")
      .replace('status: "done"', 'status: "open"')
      .replace(/^closed: .*\n/m, "")
      .replace(/^evidence: .*\n/m, ""),
  );
  expect(findDeployTask(dir, one.id).status).toBe("open");
  const moved = reopenDeployTask(dir, one.id, now);
  expect(moved.file).toBe(one.file);
  expect(existsSync(archivedFile)).toBe(false);
  expect(scanDeployTasks(dir, { archive: true }).broken).toEqual([]);
  // Crash after the second step: the open copy is there too, and the archived one is open.
  const two = create(dir, "Second", "prod", new Date("2026-11-17T15:00:00Z"));
  closeDeployTask(dir, two.id, { status: "done", evidence: "ok" }, now);
  const twoArchived = join(dir, "prod", "archive", basename(two.file));
  const openText = readFileSync(twoArchived, "utf8")
    .replace('status: "done"', 'status: "open"')
    .replace(/^closed: .*\n/m, "")
    .replace(/^evidence: .*\n/m, "");
  writeFileSync(twoArchived, openText);
  writeFileSync(two.file, openText);
  expect(scanDeployTasks(dir, { archive: true }).tasks.map((t) => [t.id, t.file])).toContainEqual([
    two.id,
    twoArchived,
  ]);
  expect(reopenDeployTask(dir, two.id, now).file).toBe(two.file);
  expect(existsSync(twoArchived)).toBe(false);
  expect(scanDeployTasks(dir, { archive: true }).broken).toEqual([]);
  // The task is never read as closed along the way, and a plain open task is still refused.
  expect(() => reopenDeployTask(dir, two.id, now)).toThrow("already open");
});

// --- copies and collisions -------------------------------------------------------------------

test("a create that loses a race for its file name or its id takes the next id and never writes over", () => {
  const dir = tempDir();
  // Another creator takes the same file name between the id being chosen and the file written.
  let raced = false;
  const sameName = createDeployTask(
    dir,
    { title: "Deploy", env: "prod", deploy: "before", type: "blocking" },
    {
      now,
      beforeClaim: (planned) => {
        if (raced) return;
        raced = true;
        mkdirSync(join(dir, "prod"), { recursive: true });
        writeFileSync(planned.file, "someone else's task, not ours to overwrite");
      },
    },
  );
  expect(sameName.id).toBe("prod-20261117-144503-2");
  expect(readFileSync(join(dir, "prod", "prod-20261117-144503-deploy.md"), "utf8")).toBe(
    "someone else's task, not ours to overwrite",
  );
  // Another creator with a different title takes the same id under another file name: the names
  // differ, so only the id check stops a duplicate.
  const other = tempDir();
  let rivalled = false;
  const made = createDeployTask(
    other,
    { title: "Deploy", env: "prod", deploy: "before", type: "blocking" },
    {
      now,
      beforeClaim: (planned) => {
        if (rivalled) return;
        rivalled = true;
        put(other, "prod", "prod-20261117-144503-other-title.md", {
          id: planned.id,
          title: "Other",
        });
      },
    },
  );
  expect(made.id).toBe("prod-20261117-144503-2");
  const scan = scanDeployTasks(other, { archive: true });
  expect(scan.duplicates).toEqual([]);
  expect(scan.tasks.map((t) => t.id).sort()).toEqual([
    "prod-20261117-144503",
    "prod-20261117-144503-2",
  ]);
  expect(readdirSync(join(other, "prod")).filter((name) => name.startsWith("."))).toEqual([]);
});

test("a pair that loses a race for one half leaves no half pair behind", () => {
  const dir = tempDir();
  let raced = false;
  const { staging, prod } = createDeployPair(
    dir,
    { title: "Both", deploy: "before", type: "blocking" },
    {
      now,
      beforeClaim: (planned) => {
        if (raced || planned.env !== "prod") return;
        raced = true;
        writeFileSync(planned.file, "someone else's task");
      },
    },
    ["staging", "prod"],
  );
  expect(prod.id).toBe("prod-20261117-144503-2");
  expect(staging.twin).toBe(prod.id);
  expect(prod.twin).toBe(staging.id);
  const scan = scanDeployTasks(dir, { archive: true });
  expect(scan.tasks.map((t) => t.id).sort()).toEqual([staging.id, prod.id].sort());
});

test("the gate reads the folder itself, closed tasks included: an archived twin is closed, an open one blocks", () => {
  const dir = tempDir();
  const staging = create(dir, "Staging half", "staging");
  const prod = createDeployTask(
    dir,
    { title: "Prod half", env: "prod", deploy: "after", type: "non-blocking", twin: staging.id },
    { now },
  );
  const refusals = gateBefore("prod", {
    dir,
    facts: cleanFacts,
    envs: both,
    baseBranch: "main",
    now,
  }).refusals;
  expect(refusals).toEqual([
    `${prod.id} "Prod half" waits for its staging twin ${staging.id}, which is still open: finish staging first, or its close waits on an unmerged branch: \`task list --branches\``,
  ]);
  closeDeployTask(dir, staging.id, { status: "done", evidence: "ok" }, now);
  expect(
    gateBefore("prod", { dir, facts: cleanFacts, envs: both, baseBranch: "main", now }).ok,
  ).toBe(true);
  expect(
    gateAfter("staging", { dir, facts: cleanFacts, envs: both, baseBranch: "main", now }).ok,
  ).toBe(true);
  // A broken file in an archive/ folder counts: the gate reads every folder, not only the open ones.
  mkdirSync(join(dir, "staging", "archive"), { recursive: true });
  const badArchived = join(dir, "staging", "archive", "bad.md");
  writeFileSync(badArchived, "not a task");
  expect(
    gateAfter("staging", { dir, facts: cleanFacts, envs: both, baseBranch: "main", now })
      .refusals[0],
  ).toContain(`${badArchived} cannot be read`);
  rmSync(badArchived);
  expect(
    gateAfter("prod", { dir, facts: cleanFacts, envs: both, baseBranch: "main", now }).refusals,
  ).toEqual([
    `Task is open: ${prod.id} "Prod half" (after the deploy, non-blocking): close it with evidence, or drop it with a reason`,
  ]);
});

test("a second copy of one id and one file name is a crash copy: the archived copy wins", () => {
  // A close writes the closed copy into archive/ first, then removes the open file. A crash between
  // the two leaves both; the task must never vanish or read as two tasks.
  const dir = tempDir();
  const open = create(dir);
  const text = readFileSync(open.file, "utf8");
  mkdirSync(join(dir, "prod", "archive"), { recursive: true });
  const archived = join(dir, "prod", "archive", basename(open.file));
  writeFileSync(
    archived,
    text
      .replace('status: "open"', 'status: "done"')
      .replace(/\n---\n/, '\nclosed: "2026-11-17T15:00:00Z"\n---\n'),
  );
  const scan = scanDeployTasks(dir, { archive: true });
  expect(scan.tasks.map((one) => [one.id, one.status, one.file])).toEqual([
    [open.id, "done", archived],
  ]);
  expect(scan.duplicates).toEqual([]);
  expect(scan.broken).toEqual([
    {
      file: open.file,
      why: `a second copy of ${open.id}: the one in archive/ is kept; remove this file`,
    },
  ]);
  expect(updateDeployTask(dir, open.id, { from: "x" }, now).file).toBe(archived);
});

test("one id under two different file names is a duplicate-id: both paths named, find refuses", () => {
  const dir = tempDir();
  const first = put(dir, "prod", "prod-20261117-144503-one.md", { id: "prod-20261117-144503" });
  const second = put(dir, "prod", "prod-20261117-144503-two.md", { id: "prod-20261117-144503" });
  const scan = scanDeployTasks(dir, { archive: true });
  expect(scan.duplicates).toEqual([{ id: "prod-20261117-144503", files: [first, second] }]);
  expect(scan.broken).toEqual([]);
  // Neither copy is chosen: both stay listed.
  expect(scan.tasks.map((one) => one.file)).toEqual([first, second]);
  let message = "";
  try {
    findDeployTask(dir, "prod-20261117-144503");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("ambiguous");
  expect(message).toContain(first);
  expect(message).toContain(second);
  expect(message).toContain("Rename the id");
  expect(message.toLowerCase()).not.toContain("remove this file");
  expect(message.toLowerCase()).not.toContain("delete");
  expect(() =>
    closeDeployTask(dir, "prod-20261117-144503", { status: "done", evidence: "x" }, now),
  ).toThrow("ambiguous");
  const findings = checkDeployTasks({ checkoutRoot: dir, dir, settings: {}, now });
  const clash = findings.find((finding) => finding.kind === "duplicate-id");
  expect(clash?.id).toBe("prod-20261117-144503");
  expect(clash?.text).toContain(first);
  expect(clash?.text).toContain(second);
});

// --- the linked pair -------------------------------------------------------------------------

test("a pair is a staging and a prod task, each naming the other as its twin", () => {
  const dir = tempDir();
  const { staging, prod } = createDeployPair(
    dir,
    { title: "Backfill the column", deploy: "before", type: "blocking", flags: ["destructive"] },
    { now },
    ["staging", "prod"],
  );
  expect([staging.id, prod.id]).toEqual(["staging-20261117-144503", "prod-20261117-144503"]);
  expect(staging.twin).toBe(prod.id);
  expect(prod.twin).toBe(staging.id);
  const scan = scanDeployTasks(dir, { archive: false });
  expect(scan.tasks.map((one) => [one.id, one.twin])).toEqual([
    ["staging-20261117-144503", "prod-20261117-144503"],
    ["prod-20261117-144503", "staging-20261117-144503"],
  ]);
  expect(scan.tasks.every((one) => one.flags?.[0] === "destructive")).toBe(true);
  // A second pair in the same second gets the counter in both envs.
  const second = createDeployPair(
    dir,
    { title: "Another", deploy: "after", type: "non-blocking" },
    { now },
    ["staging", "prod"],
  );
  expect([second.staging.id, second.prod.id]).toEqual([
    "staging-20261117-144503-2",
    "prod-20261117-144503-2",
  ]);
});

test("a pair is refused when the project lacks either environment, and writes nothing", () => {
  const dir = tempDir();
  for (const envs of [["prod"], ["staging"]] as const)
    expect(() =>
      createDeployPair(dir, { title: "x", deploy: "before", type: "blocking" }, { now }, envs),
    ).toThrow("needs both environments");
  expect(scanDeployTasks(dir, { archive: true }).tasks).toEqual([]);
  expect(existsSync(join(dir, "prod"))).toBe(false);
});

// --- the gates, over plain data ---------------------------------------------------------------

const cleanFacts: GitFacts = {
  ref: "origin/main",
  refBranch: "main",
  refCommit: "a".repeat(40),
  headCommit: "a".repeat(40),
  changedPaths: [],
  tasksPath: ".claude/tasks",
  refIsAncestor: true,
  uncommitted: [],
  uncommittedOutside: [],
  push: {
    branch: "deploy/prod-20261117-1445",
    remote: "origin/deploy/prod-20261117-1445",
    ahead: 0,
  },
};
const both = ["staging", "prod"] as const;
function before(
  env: "prod" | "staging",
  tasks: DeployTask[],
  facts = cleanFacts,
  envs: readonly ("prod" | "staging")[] = both,
  baseBranch = "main",
) {
  return judgeBefore(env, { scan: scanOf(tasks), facts, envs, baseBranch, now });
}
function after(
  env: "prod" | "staging",
  tasks: DeployTask[],
  facts = cleanFacts,
  scan = scanOf(tasks),
  baseBranch = "main",
) {
  return judgeAfter(env, { scan, facts, envs: both, baseBranch, now });
}

test("gate before: passes with no open blocking before-task", () => {
  expect(before("prod", [])).toEqual({ ok: true, refusals: [], notes: [], warnings: [] });
  const result = before("prod", [
    mk({ id: "prod-20261117-100000", title: "Warm cache", type: "non-blocking" }),
    mk({ id: "prod-20261117-100001", title: "Done one", status: "done" }),
    mk({ id: "prod-20261117-100002", title: "After only", deploy: "after" }),
    mk({ id: "staging-20261117-100003", env: "staging", title: "Other env", type: "blocking" }),
  ]);
  expect(result.ok).toBe(true);
  expect(result.refusals).toEqual([]);
  expect(result.notes).toEqual([
    'Non-blocking, still open: prod-20261117-100000 "Warm cache": do it now, or drop it with a reason',
  ]);
});

test("gate before: an open blocking before-task refuses", () => {
  const result = before("prod", [mk({ id: "prod-20261117-100000", title: "Migrate" })]);
  expect(result.ok).toBe(false);
  expect(result.refusals).toEqual([
    'Blocking task is open: prod-20261117-100000 "Migrate": do it, then close it with evidence',
  ]);
});

test("gate before: HEAD that is not the ref refuses with the branch commands; task-folder changes are fine", () => {
  const behind = {
    ...cleanFacts,
    headCommit: "b".repeat(40),
    changedPaths: ["src/app.ts", ".claude/tasks/prod/x.md"],
  };
  const refused = before("prod", [], behind);
  expect(refused.ok).toBe(false);
  expect(refused.refusals).toHaveLength(1);
  expect(refused.refusals[0]).toContain("bbbbbbbbbbbb is not origin/main (aaaaaaaaaaaa)");
  expect(refused.refusals[0]).toContain("1 path(s) outside .claude/tasks");
  expect(refused.refusals[0]).toContain("git fetch origin");
  expect(refused.refusals[0]).toContain(
    "git switch --no-track -c deploy/prod-20261117-1445 origin/main",
  );
  expect(refused.refusals[0]).not.toContain("worktree add");
  const closesOnly = {
    ...cleanFacts,
    headCommit: "b".repeat(40),
    changedPaths: [".claude/tasks/prod/x.md", ".claude/tasks/prod/archive/x.md"],
  };
  expect(before("prod", [], closesOnly).ok).toBe(true);
  // A folder that only starts with the tasks path is not the tasks folder.
  expect(before("prod", [], { ...closesOnly, changedPaths: [".claude/tasks-old/x.md"] }).ok).toBe(
    false,
  );
  // HEAD that lacks the ref's commits refuses even when every changed path is a task file: the
  // ref may hold a blocking task this checkout has never seen.
  const missing = before("prod", [], { ...closesOnly, refIsAncestor: false });
  expect(missing.ok).toBe(false);
  expect(missing.refusals).toHaveLength(1);
  expect(missing.refusals[0]).toContain("does not contain origin/main (aaaaaaaaaaaa)");
  expect(missing.refusals[0]).toContain("rebase or merge the deploy branch onto origin/main");
  // On the ref itself nothing else is asked.
  expect(before("prod", [], { ...cleanFacts, refIsAncestor: false }).ok).toBe(true);
});

test("gate before: a broken file or a duplicate id refuses", () => {
  const broken = judgeBefore("prod", {
    scan: scanOf([], [{ file: "/t/prod/bad.md", why: "bad.md: invalid YAML: x" }]),
    facts: cleanFacts,
    envs: both,
    baseBranch: "main",
    now,
  });
  expect(broken.ok).toBe(false);
  expect(broken.refusals[0]).toContain("/t/prod/bad.md cannot be read");
  const duplicate = judgeBefore("prod", {
    scan: { tasks: [], broken: [], duplicates: [{ id: "prod-1", files: ["/t/a.md", "/t/b.md"] }] },
    facts: cleanFacts,
    envs: both,
    baseBranch: "main",
    now,
  });
  expect(duplicate.ok).toBe(false);
  expect(duplicate.refusals[0]).toBe(
    "Task id prod-1 is claimed by /t/a.md and /t/b.md: rename the id inside one of them",
  );
});

test("gate before: prod refuses while the staging twin is open; staging does not", () => {
  const staging = mk({
    id: "staging-20261117-100000",
    env: "staging",
    title: "Staging half",
    deploy: "after",
    twin: "prod-20261117-100000",
  });
  const prod = mk({
    id: "prod-20261117-100000",
    title: "Prod half",
    deploy: "after",
    type: "non-blocking",
    twin: "staging-20261117-100000",
  });
  const refused = before("prod", [staging, prod]);
  expect(refused.ok).toBe(false);
  expect(refused.refusals).toEqual([
    'prod-20261117-100000 "Prod half" waits for its staging twin staging-20261117-100000, which is still open: finish staging first, or its close waits on an unmerged branch: `task list --branches`',
  ]);
  expect(before("staging", [staging, prod]).ok).toBe(true);
  // Once the twin is closed, prod goes on. A twin that names no task, live or archived, is
  // refused with the way out: it must not pass for a finished one.
  expect(before("prod", [{ ...staging, status: "done" }, prod]).ok).toBe(true);
  expect(before("prod", [{ ...prod, twin: "staging-20990101-000000" }]).refusals).toEqual([
    'prod-20261117-100000 "Prod half" names its staging twin staging-20990101-000000, but no task has that id: remove the `twin` line from /t/prod-20261117-100000.md, or drop prod-20261117-100000 (only the person drops a blocking one) and make a new pair with `cc-smart-dev-kit task add "<title>" --kind staging --pair --deploy <before|after> --type <blocking|non-blocking>`',
  ]);
  // Staging never waits on a twin.
  expect(before("staging", [{ ...staging, twin: "prod-20990101-000000" }]).ok).toBe(true);
});

test("gate before warns, never refuses, for uncommitted changes outside the tasks folder", () => {
  const dirty = { ...cleanFacts, uncommittedOutside: ["src/app.ts", "notes.txt"] };
  expect(before("prod", [], dirty)).toEqual({
    ok: true,
    refusals: [],
    notes: [],
    warnings: [
      "2 uncommitted change(s) outside .claude/tasks (src/app.ts, notes.txt): this gate judged committed code only, so a deploy from this folder may ship them",
    ],
  });
  // The after gate judges the closes only: it says nothing of other files.
  expect(after("prod", [], dirty).warnings).toEqual([]);
});

test("gate before and after: an environment outside tasks.envs refuses", () => {
  expect(before("staging", [], cleanFacts, ["prod"]).refusals).toEqual([
    "staging is not one of this project's environments (tasks.envs: prod)",
  ]);
  expect(
    judgeAfter("staging", {
      scan: scanOf([]),
      facts: cleanFacts,
      envs: ["prod"],
      baseBranch: "main",
      now,
    }).ok,
  ).toBe(false);
});

test("gate after: passes when nothing of the env is open, committed and pushed", () => {
  expect(
    after("prod", [
      mk({ id: "prod-20261117-100000", status: "done" }),
      mk({ id: "prod-20261117-100001", status: "dropped" }),
      mk({ id: "staging-20261117-100002", env: "staging" }),
    ]),
  ).toEqual({ ok: true, refusals: [], notes: [], warnings: [] });
});

test("gate after: any open task of the env refuses, before or after, either type", () => {
  const result = after("prod", [
    mk({ id: "prod-20261117-100000", title: "A", deploy: "before", type: "non-blocking" }),
    mk({ id: "prod-20261117-100001", title: "B", deploy: "after", type: "blocking" }),
  ]);
  expect(result.ok).toBe(false);
  expect(result.refusals).toEqual([
    'Task is open: prod-20261117-100000 "A" (before the deploy, non-blocking): close it with evidence, or drop it with a reason',
    'Task is open: prod-20261117-100001 "B" (after the deploy, blocking): close it with evidence, or drop it with a reason',
  ]);
});

test("gate after: uncommitted closes, an unpushed branch and a broken file refuse", () => {
  const uncommitted = after("prod", [], {
    ...cleanFacts,
    uncommitted: [".claude/tasks/prod/archive/a.md", ".claude/tasks/prod/a.md"],
  });
  expect(uncommitted.refusals).toHaveLength(1);
  expect(uncommitted.refusals[0]).toContain("2 uncommitted change(s) under .claude/tasks");
  expect(
    after("prod", [], { ...cleanFacts, push: { branch: "b", remote: null, ahead: 0 } }).refusals,
  ).toEqual(["Branch b is not pushed: run `git push -u origin b`"]);
  expect(
    after("prod", [], { ...cleanFacts, push: { branch: "b", remote: "origin/b", ahead: 2 } })
      .refusals,
  ).toEqual(["Branch b is 2 commit(s) ahead of origin/b: run `git push origin b`"]);
  expect(
    after("prod", [], { ...cleanFacts, push: { branch: null, remote: null, ahead: 0 } }).refusals,
  ).toEqual([`HEAD is detached: the closes need a branch to be committed and pushed from. ${CUT}`]);
  const broken = after("prod", [], cleanFacts, scanOf([], [{ file: "/t/x.md", why: "why" }]));
  expect(broken.ok).toBe(false);
  expect(broken.refusals[0]).toContain("/t/x.md cannot be read");
});

test("both gates refuse on the base branch, print the branch to cut, and never print a push to it", () => {
  const onMain = {
    ...cleanFacts,
    push: { branch: "main", remote: "origin/main", ahead: 1 },
  };
  const cut =
    "Start the run on a deploy branch cut from the commit that ships: `git fetch origin`, then `git switch --no-track -c deploy/prod-20261117-1445 origin/main` in this checkout";
  const refusal = `HEAD is on main, the branch deploys ship to: the closes must reach it through a deploy branch's pull request, never by a push to it. ${cut}`;
  expect(before("prod", [], onMain)).toEqual({
    ok: false,
    refusals: [refusal],
    notes: [],
    warnings: [],
  });
  expect(after("prod", [], onMain)).toEqual({
    ok: false,
    refusals: [refusal],
    notes: [],
    warnings: [],
  });
  // An unpushed base is the same refusal, not a `git push` line naming main.
  const neverPushed = { ...cleanFacts, push: { branch: "main", remote: null, ahead: 0 } };
  expect(after("prod", [], neverPushed).refusals).toEqual([refusal]);
  // The base is the project's, not a fixed name.
  expect(
    before("prod", [], { ...onMain, ref: "origin/release", refBranch: "release" }, both, "release")
      .ok,
  ).toBe(true);
});

const CUT =
  "Start the run on a deploy branch cut from the commit that ships: `git fetch origin`, then `git switch --no-track -c deploy/prod-20261117-1445 origin/main` in this checkout";

test("both gates refuse a detached HEAD and the ref's own branch, each with the branch to cut", () => {
  const detached = { ...cleanFacts, push: { branch: null, remote: null, ahead: 0 } };
  const detachedRefusal = `HEAD is detached: the closes need a branch to be committed and pushed from. ${CUT}`;
  expect(before("prod", [], detached).refusals).toEqual([detachedRefusal]);
  expect(after("prod", [], detached).refusals).toEqual([detachedRefusal]);
  // A ref that is not the base: `origin/trunk` is the branch `trunk`.
  const onTrunk = {
    ...cleanFacts,
    ref: "origin/trunk",
    refBranch: "trunk",
    push: { branch: "trunk", remote: "origin/trunk", ahead: 2 },
  };
  const trunkRefusal = `HEAD is on trunk, the branch this run ships from (origin/trunk): the closes must reach it through a deploy branch's pull request, never by a push to it. ${CUT.replace("origin/main", "origin/trunk")}`;
  expect(before("prod", [], onTrunk).refusals).toEqual([trunkRefusal]);
  expect(after("prod", [], onTrunk).refusals).toEqual([trunkRefusal]);
  // A deploy branch of any other name is fine.
  expect(before("prod", [], { ...onTrunk, push: { ...onTrunk.push, branch: "deploy/x" } }).ok).toBe(
    true,
  );
  // The gate compares git's answer, never the ref's text: `upstream/trunk` is the branch `trunk`.
  const onUpstreamTrunk = { ...onTrunk, ref: "upstream/trunk" };
  const upstreamRefusal = `HEAD is on trunk, the branch this run ships from (upstream/trunk): the closes must reach it through a deploy branch's pull request, never by a push to it. ${CUT.replace("origin/main", "upstream/trunk")}`;
  expect(before("prod", [], onUpstreamTrunk).refusals).toEqual([upstreamRefusal]);
  expect(after("prod", [], onUpstreamTrunk).refusals).toEqual([upstreamRefusal]);
  // A ref git names no branch for (a tag, a commit) refuses no branch by its text.
  const onTag = {
    ...cleanFacts,
    ref: "v1",
    refBranch: null,
    push: { ...onTrunk.push, branch: "v1" },
  };
  expect(before("prod", [], onTag).ok).toBe(true);
});

test("the branch to cut is printed once: a wrong branch leaves it out of the HEAD refusal", () => {
  const onMainBehind = {
    ...cleanFacts,
    headCommit: "b".repeat(40),
    refIsAncestor: false,
    push: { branch: "main", remote: "origin/main", ahead: 0 },
  };
  const refusals = before("prod", [], onMainBehind).refusals;
  expect(refusals).toHaveLength(2);
  expect(refusals.join("\n").split("git switch --no-track").length - 1).toBe(1);
  expect(refusals[1]).toBe(
    "HEAD bbbbbbbbbbbb does not contain origin/main (aaaaaaaaaaaa): the ref has commits this branch has not taken in, and may hold tasks it cannot see. The deploy branch to cut above starts from origin/main, so it holds what the ref holds.",
  );
  // On a deploy branch the HEAD refusal keeps its own fix.
  const onDeploy = { ...onMainBehind, push: cleanFacts.push };
  expect(before("prod", [], onDeploy).refusals[0]).toContain("git switch --no-track");
  // Detached HEAD, the same: the pointer, not a second branch command.
  const detachedBehind = { ...onMainBehind, push: { branch: null, remote: null, ahead: 0 } };
  expect(before("prod", [], detachedBehind).refusals[1]).toContain(
    "The deploy branch to cut above starts from origin/main",
  );
  // A HEAD that holds the ref but differs outside the tasks folder: the same pointer, once.
  const onMainChanged = {
    ...onMainBehind,
    refIsAncestor: true,
    changedPaths: ["src/app.ts"],
  };
  const changed = before("prod", [], onMainChanged).refusals;
  expect(changed).toHaveLength(2);
  expect(changed.join("\n").split("git switch --no-track").length - 1).toBe(1);
  expect(changed[1]).toBe(
    "HEAD bbbbbbbbbbbb is not origin/main (aaaaaaaaaaaa): it differs in 1 path(s) outside .claude/tasks. The deploy branch to cut above starts from origin/main, so it holds what the ref holds.",
  );
  // On a deploy branch that line keeps its own fix.
  expect(before("prod", [], { ...onMainChanged, push: cleanFacts.push }).refusals).toEqual([
    `HEAD bbbbbbbbbbbb is not origin/main (aaaaaaaaaaaa): it differs in 1 path(s) outside .claude/tasks. ${CUT}`,
  ]);
});

test("git facts: the ref's branch is read by git, never cut from the text", () => {
  const { repo, remote, dir } = repoWithRemote();
  const env = cleanGitEnv();
  git(repo, "remote", "add", "upstream", remote);
  git(repo, "fetch", "-q", "upstream");
  git(repo, "tag", "v1");
  const sha = git(repo, "rev-parse", "HEAD").trim();
  const branchOf = (ref: string) => readGitFacts(repo, dir, ref, env).refBranch;
  expect(branchOf("origin/main")).toBe("main");
  expect(branchOf("upstream/main")).toBe("main");
  expect(branchOf("refs/remotes/origin/main")).toBe("main");
  expect(branchOf("main")).toBe("main");
  expect(branchOf("v1")).toBeNull();
  expect(branchOf(sha)).toBeNull();
  expect(branchOf("HEAD")).toBeNull();
  expect(branchOf("@")).toBeNull();
  // A remote whose name holds "/".
  git(repo, "remote", "add", "my/fork", remote);
  git(repo, "fetch", "-q", "my/fork");
  expect(branchOf("my/fork/main")).toBe("main");
  // `git remote add` refuses `my` beside `my/fork`, a config edit does not: the longest name wins.
  git(repo, "config", "remote.my.url", remote);
  git(repo, "config", "remote.my.fetch", "+refs/heads/*:refs/remotes/my/*");
  expect(git(repo, "remote").split("\n")).toContain("my");
  expect(branchOf("my/fork/main")).toBe("main");
  // A short name that matches more than one ref: git ships the first, so the gate stops.
  git(repo, "branch", "rel2");
  git(repo, "tag", "rel2");
  expect(() => branchOf("rel2")).toThrow(
    "rel2 names more than one ref (refs/tags/rel2, refs/heads/rel2): name the one that ships in full with --ref, or delete the one that should not be there",
  );
  expect(branchOf("refs/heads/rel2")).toBe("rel2");
  expect(branchOf("refs/tags/rel2")).toBeNull();
});

test("git facts: a stray local branch or a tag named like origin's branch stops the gate", () => {
  const env = cleanGitEnv();
  // A stray local branch `origin/main`, no tag: both are named, the tag is not.
  const stray = repoWithRemote();
  git(stray.repo, "branch", "origin/main");
  expect(() => readGitFacts(stray.repo, stray.dir, "origin/main", env)).toThrow(
    "origin/main names more than one ref (refs/heads/origin/main, refs/remotes/origin/main): name the one that ships in full with --ref, or delete the one that should not be there",
  );
  expect(readGitFacts(stray.repo, stray.dir, "refs/remotes/origin/main", env).refBranch).toBe(
    "main",
  );
  // A tag `origin/main` beside origin's branch, no local branch: git would ship the tag.
  const tagged = repoWithRemote();
  git(tagged.repo, "tag", "origin/main");
  expect(() => readGitFacts(tagged.repo, tagged.dir, "origin/main", env)).toThrow(
    "origin/main names more than one ref (refs/tags/origin/main, refs/remotes/origin/main)",
  );
});

test("the gates read the base branch from the input, never a fixed name", () => {
  const onRelease = {
    ...cleanFacts,
    push: { branch: "release", remote: "origin/release", ahead: 0 },
  };
  expect(before("prod", [], onRelease, both, "release").refusals).toHaveLength(1);
  expect(before("prod", [], onRelease).ok).toBe(true);
});

test("the no-flag listing groups open tasks by env, deploy and type, blocking first", () => {
  const tasks = [
    mk({ id: "prod-1", title: "p-after-nb", deploy: "after", type: "non-blocking" }),
    mk({ id: "prod-2", title: "p-before-nb", deploy: "before", type: "non-blocking" }),
    mk({ id: "prod-3", title: "p-before-b", deploy: "before", type: "blocking" }),
    mk({ id: "prod-4", title: "closed", status: "done" }),
    mk({ id: "staging-5", env: "staging", title: "s-before-b" }),
  ];
  expect(
    releaseList(tasks).map((group) => [
      group.env,
      group.deploy,
      group.type,
      group.tasks.map((t) => t.title),
    ]),
  ).toEqual([
    ["staging", "before", "blocking", ["s-before-b"]],
    ["prod", "before", "blocking", ["p-before-b"]],
    ["prod", "before", "non-blocking", ["p-before-nb"]],
    ["prod", "after", "non-blocking", ["p-after-nb"]],
  ]);
  expect(releaseList(tasks, "staging").map((group) => group.env)).toEqual(["staging"]);
  expect(releaseList([])).toEqual([]);
});

// --- git: the facts the gate reads, and the branch readers ------------------------------------

/** A repo with one commit on main, pushed to a local bare remote. Returns both folders. */
function repoWithRemote() {
  const remote = tempDir("remote");
  git(remote, "init", "--bare", "-b", "main");
  const repo = tempDir("repo");
  git(repo, "init", "-b", "main");
  writeFileSync(join(repo, "README.md"), "repo");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  return { repo, remote, dir: join(repo, ".claude/tasks") };
}

test("git facts: HEAD on the ref, and ahead of it with only task changes (behind it: see below)", () => {
  const { repo, dir } = repoWithRemote();
  const env = cleanGitEnv();
  const onRef = readGitFacts(repo, dir, "origin/main", env);
  expect(onRef.headCommit).toBe(onRef.refCommit);
  expect(onRef.changedPaths).toEqual([]);
  expect(onRef.tasksPath).toBe(".claude/tasks");
  expect(onRef.ref).toBe("origin/main");
  expect(onRef.refIsAncestor).toBe(true);
  git(repo, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  const one = create(dir);
  git(repo, "add", ".");
  git(repo, "commit", "-m", "task");
  const withTask = readGitFacts(repo, dir, "origin/main", env);
  expect(withTask.changedPaths).toEqual([`.claude/tasks/prod/${basename(one.file)}`]);
  expect(before("prod", [], withTask).ok).toBe(true);
  writeFileSync(join(repo, "src.ts"), "x");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "code");
  const withCode = readGitFacts(repo, dir, "origin/main", env);
  expect(withCode.changedPaths).toContain("src.ts");
  expect(before("prod", [], withCode).ok).toBe(false);
  expect(() => readGitFacts(repo, dir, "origin/nope", env)).toThrow("git rev-parse failed");
});

test("git facts: the tasks folder dirty, staged, untracked, then committed, then pushed", () => {
  const { repo, dir } = repoWithRemote();
  const env = cleanGitEnv();
  git(repo, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  const one = create(dir);
  const rel = (file: string) => file.slice(repo.length + 1);
  // Untracked.
  expect(readGitFacts(repo, dir, "origin/main", env).uncommitted).toEqual([rel(one.file)]);
  git(repo, "add", ".");
  git(repo, "commit", "-m", "task");
  expect(readGitFacts(repo, dir, "origin/main", env).uncommitted).toEqual([]);
  // The close: an unstaged edit plus an untracked archive file.
  const closed = closeDeployTask(dir, one.id, { status: "done", evidence: "ok" }, now);
  expect(readGitFacts(repo, dir, "origin/main", env).uncommitted).toEqual(
    [rel(one.file), rel(closed.file)].sort(),
  );
  git(repo, "add", "-A", ".");
  expect(readGitFacts(repo, dir, "origin/main", env).uncommitted).toHaveLength(2);
  git(repo, "commit", "-m", "close");
  const committed = readGitFacts(repo, dir, "origin/main", env);
  expect(committed.uncommitted).toEqual([]);
  // A change outside the tasks folder is not a close, but the before gate says it did not judge it.
  const outside = { outside: true };
  expect(readGitFacts(repo, dir, "origin/main", env, outside).uncommittedOutside).toEqual([]);
  writeFileSync(join(repo, "scratch.txt"), "x");
  writeFileSync(join(repo, "README.md"), "changed");
  expect(readGitFacts(repo, dir, "origin/main", env, outside).uncommitted).toEqual([]);
  expect(readGitFacts(repo, dir, "origin/main", env, outside).uncommittedOutside).toEqual([
    "README.md",
    "scratch.txt",
  ]);
  // The after gate reads the tasks folder only: it never lists the rest.
  expect(readGitFacts(repo, dir, "origin/main", env).uncommittedOutside).toEqual([]);
  // Not on origin yet.
  expect(committed.push).toEqual({ branch: "deploy/prod-20261117-1445", remote: null, ahead: 0 });
  expect(after("prod", scanDeployTasks(dir, { archive: true }).tasks, committed).ok).toBe(false);
  git(repo, "push", "-u", "origin", "deploy/prod-20261117-1445");
  const pushed = readGitFacts(repo, dir, "origin/main", env);
  expect(pushed.push).toEqual({
    branch: "deploy/prod-20261117-1445",
    remote: "origin/deploy/prod-20261117-1445",
    ahead: 0,
  });
  expect(after("prod", scanDeployTasks(dir, { archive: true }).tasks, pushed)).toEqual({
    ok: true,
    refusals: [],
    notes: [],
    warnings: [],
  });
  // One more local commit is ahead of origin's copy of the branch.
  writeFileSync(join(repo, "more.txt"), "x");
  git(repo, "add", "more.txt");
  git(repo, "commit", "-m", "more");
  expect(readGitFacts(repo, dir, "origin/main", env).push.ahead).toBe(1);
  // A detached HEAD has no branch.
  git(repo, "checkout", "--detach");
  expect(readGitFacts(repo, dir, "origin/main", env).push.branch).toBeNull();
});

/** A second clone of `remote`: another person's checkout, which can push to main. */
function secondClone(remote: string): string {
  const parent = tempDir("clone");
  git(parent, "clone", "-q", remote, "other");
  return join(parent, "other");
}
const envs = ["staging", "prod"] as const;

test("a blocking task pushed to the ref after the deploy branch was cut refuses the gate", () => {
  const { repo, remote, dir } = repoWithRemote();
  const env = cleanGitEnv();
  git(repo, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  // A teammate pushes a commit to main that only adds a blocking prod task.
  const other = secondClone(remote);
  const theirs = create(join(other, ".claude/tasks"), "Run the migration");
  git(other, "add", ".");
  git(other, "commit", "-m", "task");
  git(other, "push", "-q", "origin", "HEAD:main");
  git(repo, "fetch", "-q", "origin");
  const facts = readGitFacts(repo, dir, "origin/main", env);
  // Every changed path is a task file, which used to look like closes made on the deploy branch.
  expect(facts.changedPaths).toEqual([`.claude/tasks/prod/${basename(theirs.file)}`]);
  expect(facts.refIsAncestor).toBe(false);
  // This checkout has never seen the task, so a scan of its folder is empty.
  expect(scanDeployTasks(dir, { archive: true }).tasks).toEqual([]);
  const gate = gateBefore("prod", { dir, facts, envs, baseBranch: "main", now });
  expect(gate.ok).toBe(false);
  expect(gate.refusals).toHaveLength(1);
  expect(gate.refusals[0]).toContain("does not contain origin/main");
  // After the branch takes the ref in, the task is seen and it blocks.
  git(repo, "merge", "-q", "--no-edit", "origin/main");
  const merged = readGitFacts(repo, dir, "origin/main", env);
  expect(merged.refIsAncestor).toBe(true);
  expect(merged.headCommit).toBe(merged.refCommit);
  expect(
    gateBefore("prod", { dir, facts: merged, envs, baseBranch: "main", now }).refusals,
  ).toEqual([
    `Blocking task is open: ${theirs.id} "Run the migration": do it, then close it with evidence`,
  ]);
});

test("a deploy branch behind the ref, over code, refuses; cut from the ref it passes", () => {
  const { repo, remote, dir } = repoWithRemote();
  const env = cleanGitEnv();
  git(repo, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  const other = secondClone(remote);
  writeFileSync(join(other, "app.ts"), "x");
  git(other, "add", ".");
  git(other, "commit", "-m", "code");
  git(other, "push", "-q", "origin", "HEAD:main");
  git(repo, "fetch", "-q", "origin");
  const facts = readGitFacts(repo, dir, "origin/main", env);
  expect(facts.refIsAncestor).toBe(false);
  expect(facts.changedPaths).toEqual(["app.ts"]);
  expect(gateBefore("prod", { dir, facts, envs, baseBranch: "main", now }).ok).toBe(false);
  git(repo, "switch", "--no-track", "-c", "deploy/prod-20261117-1500", "origin/main");
  const fresh = readGitFacts(repo, dir, "origin/main", env);
  expect(fresh.headCommit).toBe(fresh.refCommit);
  expect(gateBefore("prod", { dir, facts: fresh, envs, baseBranch: "main", now }).ok).toBe(true);
});

test("pushed is judged against origin's copy of the branch, not the branch's upstream", () => {
  const { repo, dir } = repoWithRemote();
  const env = cleanGitEnv();
  // Cut the way a plain `git switch -c` does: the upstream is origin/main.
  git(repo, "switch", "-c", "deploy/prod-20261117-1445", "origin/main");
  expect(git(repo, "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe("origin/main");
  const one = create(dir);
  git(repo, "add", ".");
  git(repo, "commit", "-m", "task");
  closeDeployTask(dir, one.id, { status: "done", evidence: "ok" }, now);
  git(repo, "add", "-A", ".");
  git(repo, "commit", "-m", "close");
  const unpushed = readGitFacts(repo, dir, "origin/main", env);
  expect(unpushed.push).toEqual({ branch: "deploy/prod-20261117-1445", remote: null, ahead: 0 });
  const refused = gateAfter("prod", { dir, facts: unpushed, envs, baseBranch: "main", now });
  expect(refused.refusals).toEqual([
    "Branch deploy/prod-20261117-1445 is not pushed: run `git push -u origin deploy/prod-20261117-1445`",
  ]);
  // Pushed by name, with no -u: the upstream stays origin/main, and the branch is still pushed.
  git(repo, "push", "-q", "origin", "deploy/prod-20261117-1445");
  expect(git(repo, "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe("origin/main");
  const pushed = readGitFacts(repo, dir, "origin/main", env);
  expect(pushed.push).toEqual({
    branch: "deploy/prod-20261117-1445",
    remote: "origin/deploy/prod-20261117-1445",
    ahead: 0,
  });
  expect(gateAfter("prod", { dir, facts: pushed, envs, baseBranch: "main", now })).toEqual({
    ok: true,
    refusals: [],
    notes: [],
    warnings: [],
  });
  writeFileSync(join(repo, "more.txt"), "x");
  git(repo, "add", "more.txt");
  git(repo, "commit", "-m", "more");
  const ahead = readGitFacts(repo, dir, "origin/main", env);
  expect(ahead.push.ahead).toBe(1);
  expect(gateAfter("prod", { dir, facts: ahead, envs, baseBranch: "main", now }).refusals).toEqual([
    "Branch deploy/prod-20261117-1445 is 1 commit(s) ahead of origin/deploy/prod-20261117-1445: run `git push origin deploy/prod-20261117-1445`",
  ]);
});

test("branch changes, archived tasks, deleted paths and unmerged branches read the nested folders", () => {
  const root = tempDir();
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "README.md"), "repo");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const dir = join(root, "tasks");
  const first = create(dir);
  git(root, "add", ".");
  git(root, "commit", "-m", "task");
  git(root, "checkout", "-b", "work");
  closeDeployTask(dir, first.id, { status: "done", evidence: "ok" }, now);
  const added = create(dir, "New", "staging", new Date("2026-11-17T15:00:00Z"));
  git(root, "add", ".");
  git(root, "commit", "-m", "changes");
  updateDeployTask(dir, added.id, { title: "Changed locally" }, now);
  const untracked = create(dir, "Untracked", "prod", new Date("2026-11-17T16:00:00Z"));
  const changes = branchTaskChanges(root, dir, "main");
  expect(changes.find((c) => c.task?.id === added.id)?.task?.title).toBe("Changed locally");
  expect(changes.find((c) => c.task?.id === untracked.id)?.change).toBe("added");
  expect(
    changes.some((c) => c.change === "deleted" && c.file === `tasks/prod/${basename(first.file)}`),
  ).toBe(true);
  expect(changes.some((c) => c.change === "closed" && c.task?.id === first.id)).toBe(true);
  expect(
    tasksOn(root, dir, "work")
      .tasks.map((t) => t.id)
      .sort(),
  ).toEqual([first.id, added.id].sort());
  updateDeployTask(dir, added.id, { title: "New" }, now);
  git(root, "checkout", "main");
  const unmerged = unmergedBranchTasks(root, dir, "main");
  expect(unmerged.tasks.map((t) => [t.branch, t.task.id])).toEqual([["work", added.id]]);
  expect(unmerged.broken).toEqual([]);
});

test("a close pushed on an unmerged branch is reported for a task the base still has open", () => {
  const root = tempDir();
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "README.md"), "repo");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const dir = join(root, "tasks");
  const open = create(dir, "Staging gate", "staging");
  git(root, "add", ".");
  git(root, "commit", "-m", "task");
  git(root, "checkout", "-b", "deploy/staging-1");
  closeDeployTask(dir, open.id, { status: "done", evidence: "ran it: ok" }, now);
  // Created and closed on the branch: the base never had it open, so nothing waits on it.
  const own = create(dir, "Own", "prod", new Date("2026-11-17T15:00:00Z"));
  closeDeployTask(dir, own.id, { status: "dropped", note: "not needed" }, now);
  git(root, "add", ".");
  git(root, "commit", "-m", "closes");
  git(root, "checkout", "main");
  const unmerged = unmergedBranchTasks(root, dir, "main");
  expect(unmerged.closed.map((t) => [t.branch, t.task.id, t.task.status])).toEqual([
    ["deploy/staging-1", open.id, "done"],
  ]);
  expect(unmerged.tasks).toEqual([]);
  // Once the branch is merged, nothing is listed.
  git(root, "merge", "--no-ff", "-m", "merge", "deploy/staging-1");
  expect(unmergedBranchTasks(root, dir, "main").closed).toEqual([]);
});

test("a broken file on one branch is reported with its branch and the others are still read", () => {
  const root = tempDir();
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "README.md"), "repo");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const dir = join(root, "tasks");
  git(root, "checkout", "-b", "a-broken");
  mkdirSync(join(dir, "prod"), { recursive: true });
  writeFileSync(join(dir, "prod", "prod-20261117-100000-bad.md"), "not a task");
  git(root, "add", ".");
  git(root, "commit", "-m", "broken");
  git(root, "checkout", "main");
  git(root, "checkout", "-b", "b-good");
  const good = create(dir, "Good one");
  git(root, "add", ".");
  git(root, "commit", "-m", "good");
  git(root, "checkout", "main");
  const result = unmergedBranchTasks(root, dir, "main");
  expect(result.tasks.map((t) => [t.branch, t.task.id])).toEqual([["b-good", good.id]]);
  expect(result.broken).toEqual([
    {
      branch: "a-broken",
      file: "tasks/prod/prod-20261117-100000-bad.md",
      why: "tasks/prod/prod-20261117-100000-bad.md: missing front matter --- delimiters",
    },
  ]);
});

// --- check -----------------------------------------------------------------------------------

test("check reports each finding and does not treat closed tasks as stale", () => {
  const root = tempDir();
  const dir = join(root, "tasks");
  put(dir, "prod", "prod-20260901-080000-one.md", {
    id: "prod-20260901-080000",
    twin: "staging-20990101-000000",
  });
  put(dir, "prod", "prod-20260901-080001-two.md", {
    id: "prod-20260901-080001",
    title: task.title.toUpperCase(),
    refs: [],
    twin: undefined,
  });
  put(
    dir,
    "prod",
    "prod-20260901-080002-closed.md",
    { id: "prod-20260901-080002", status: "done", twin: undefined },
    true,
  );
  put(dir, "prod", "prod-20260901-080003-a.md", {
    id: "prod-20260901-080003",
    twin: undefined,
    title: "dup-id",
  });
  put(dir, "prod", "prod-20260901-080003-b.md", {
    id: "prod-20260901-080003",
    twin: undefined,
    title: "dup-id 2",
  });
  writeFileSync(join(dir, "prod", "bad.md"), "bad");
  writeFileSync(join(dir, "old-task.md"), "old");
  writeFileSync(join(dir, "T-abcdef-old.md"), "old");
  writeFileSync(join(dir, "README.md"), "read");
  const findings = checkDeployTasks({ checkoutRoot: root, dir, settings: {}, now });
  expect(new Set(findings.map((f) => f.kind))).toEqual(
    new Set([
      "stale",
      "broken-ref",
      "duplicate-title",
      "broken-file",
      "duplicate-id",
      "twin-missing",
      "old-files",
    ]),
  );
  expect(new Set(findings.filter((f) => f.kind === "stale").map((f) => f.id))).toEqual(
    new Set(["prod-20260901-080000", "prod-20260901-080001", "prod-20260901-080003"]),
  );
  expect(findings.filter((f) => f.kind === "twin-missing").map((f) => f.id)).toEqual([
    "prod-20260901-080000",
  ]);
  const old = findings.filter((f) => f.kind === "old-files");
  expect(old).toHaveLength(1);
  expect(old[0]?.text).toBe(
    "2 old task file(s) are not read since 5.0.0: recreate each as a deploy task, or delete it (T-abcdef-old.md, old-task.md)",
  );
  expect(oldTaskFiles(dir)).toEqual([join(dir, "T-abcdef-old.md"), join(dir, "old-task.md")]);
});

test("check: a young open task is not stale, a twin that exists is fine, no old files means no finding", () => {
  const root = tempDir();
  const dir = join(root, "tasks");
  const pair = createDeployPair(
    dir,
    { title: "Both", deploy: "before", type: "blocking" },
    { now },
    ["staging", "prod"],
  );
  expect(pair.prod.twin).toBe(pair.staging.id);
  expect(checkDeployTasks({ checkoutRoot: root, dir, settings: { staleDays: 30 }, now })).toEqual(
    [],
  );
  const later = new Date(now.getTime() + 31 * 86_400_000);
  expect(
    checkDeployTasks({ checkoutRoot: root, dir, settings: { staleDays: 30 }, now: later }).map(
      (f) => f.kind,
    ),
  ).toEqual(["stale", "stale"]);
  expect(oldTaskFiles(join(root, "missing"))).toEqual([]);
});
