import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, tempDir } from "../../testing/temp";
import { branchTaskChanges, unmergedBranchTasks } from "./branch";
import { checkProjectTasks } from "./check";
import {
  addProjectNote,
  closeProjectTask,
  createProjectTask,
  projectTasksDir,
  scanProjectTasks,
  updateProjectTask,
} from "./files";
import { type ProjectTask, parseProjectTask, renderProjectTask } from "./format";
import { importNotes } from "./import-notes";
import { releaseList, shippedIdsOn } from "./release";

const now = new Date("2026-11-03T12:00:00Z");
const task: ProjectTask = {
  id: "T-aaaaaa",
  title: 'Drop old: "invite" # functions\nand more',
  kind: "database",
  status: "open",
  when: "next-release",
  weight: "blocks-release",
  flags: ["needs-yes", "twice-safe", "spends-money", "real-people", "destructive"],
  created: "2026-09-01",
  closed: "2026-10-01",
  from: "plan\nphase",
  refs: ["src/missing.ts"],
  evidence: "proof: # yes",
  future: { nested: true },
  body: `# What and why\n${"x".repeat(200_000)}`,
  file: "task.md",
};
function create(dir: string, title = "Deploy", random = () => 0) {
  return createProjectTask(dir, { title, kind: "production" }, { now, random });
}

test("front matter round trips every field, unknown keys, punctuation and a large body", () => {
  const text = renderProjectTask(task);
  const parsed = parseProjectTask(text, task.file);
  expect(parsed).toEqual({ ok: true, task });
  if (parsed.ok) expect(renderProjectTask(parsed.task)).toBe(text);
  expect(text).toContain(
    'title: "Drop old: \\"invite\\" # functions\\nand more"'.replaceAll('\\\\"', '\\"'),
  );
});
test("invalid front matter gives clear errors", () => {
  for (const text of [
    "no delimiter",
    "---\ntitle: [\n---\n",
    "---\nid: x\n",
    renderProjectTask({ ...task, kind: "wrong" } as unknown as ProjectTask),
  ]) {
    const result = parseProjectTask(text, "bad.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why.length).toBeGreaterThan(5);
  }
});
test("create, collision across archive, update, exact log and close move", () => {
  const root = tempDir();
  const dir = projectTasksDir(root, {});
  expect(dir).toBe(join(root, ".claude/tasks"));
  const first = create(dir);
  expect(first.id).toBe("T-aaaaaa");
  const updated = updateProjectTask(dir, first.id, { title: "Deploy: safely", when: "now" }, now);
  expect(updated.title).toBe("Deploy: safely");
  const noted = addProjectNote(dir, first.id, "Ready", now);
  expect(noted.body).toBe("\n## Log\n- 2026-11-03 Ready\n");
  const closed = closeProjectTask(
    dir,
    first.id,
    { status: "done", evidence: "verified", note: "Checked" },
    now,
  );
  expect(closed.closed).toBe("2026-11-03");
  expect(closed.evidence).toBe("verified");
  expect(closed.body).toEndWith("- 2026-11-03 Checked\n");
  expect(existsSync(first.file)).toBe(false);
  expect(closed.file).toContain("/archive/");
  let calls = 0;
  const second = create(dir, "Another", () => (calls++ < 6 ? 0 : 1 / 32));
  expect(second.id).toBe("T-bbbbbb");
  expect(scanProjectTasks(dir, { archive: true }).tasks).toHaveLength(2);
  expect(addProjectNote(dir, first.id, "Later", now).body).toEndWith("- 2026-11-03 Later\n");
});
test("a second copy of one id: the closed copy in archive wins, the open copy is reported", () => {
  // A close writes the closed copy into archive/ first, then removes the open file. A crash between
  // the two leaves both; the task must never vanish or read as two tasks.
  const root = tempDir();
  const dir = projectTasksDir(root, {});
  const open = create(dir);
  const text = readFileSync(open.file, "utf8");
  mkdirSync(join(dir, "archive"), { recursive: true });
  const archived = join(dir, "archive", open.file.split("/").pop() ?? "");
  writeFileSync(archived, text.replace('status: "open"', 'status: "done"'));
  const scan = scanProjectTasks(dir, { archive: true });
  expect(scan.tasks.map((one) => [one.id, one.status, one.file])).toEqual([
    [open.id, "done", archived],
  ]);
  expect(scan.broken).toEqual([
    {
      file: open.file,
      why: `a second copy of ${open.id}: the one in archive/ is kept; remove this file`,
    },
  ]);
  expect(updateProjectTask(dir, open.id, { from: "x" }, now).file).toBe(archived);
});
test("front matter may not use the names body or file: they are the task's own fields", () => {
  for (const key of ["body", "file"]) {
    const text = renderProjectTask(task).replace('id: "T-aaaaaa"', `id: "T-aaaaaa"\n${key}: "x"`);
    expect(parseProjectTask(text, "bad.md")).toEqual({
      ok: false,
      why: `bad.md: "${key}" is a reserved name and cannot be a front-matter key`,
    });
  }
});
test("scan skips unrelated files and reports broken files", () => {
  const dir = tempDir();
  for (const name of ["README.md", ".hidden.md", "other.txt", "bad.md"])
    writeFileSync(join(dir, name), "bad");
  const result = scanProjectTasks(dir, { archive: false });
  expect(result.tasks).toEqual([]);
  expect(result.broken.map((x) => x.file)).toEqual([join(dir, "bad.md")]);
});
test("release groups open operational tasks and all next-release tasks", () => {
  const tasks = [
    { ...task, weight: "blocks-release" as const },
    { ...task, id: "T-bbbbbb", weight: "after-deploy" as const },
    { ...task, id: "T-cccccc", weight: "owner" as const },
    { ...task, id: "T-dddddd", weight: undefined },
    { ...task, id: "T-eeeeee", kind: "teammate" as const },
    { ...task, id: "T-ffffff", status: "done" as const },
  ];
  const list = releaseList(tasks, { shippedIds: new Set([task.id]) });
  expect(list.groups["blocks-release"].map((t) => t.id)).toEqual(["T-aaaaaa"]);
  expect(list.groups["after-deploy"]).toHaveLength(1);
  expect(list.groups.owner).toHaveLength(1);
  expect(list.groups.none).toHaveLength(1);
  expect(list.nextRelease).toHaveLength(5);
  expect(list.missed.map((t) => t.id)).toEqual(["T-aaaaaa"]);
});
test("check reports each finding and does not treat closed tasks as stale", () => {
  const root = tempDir();
  const dir = join(root, "tasks");
  mkdirSync(dir);
  writeFileSync(join(dir, "one.md"), renderProjectTask({ ...task, body: "" }));
  writeFileSync(
    join(dir, "two.md"),
    renderProjectTask({
      ...task,
      id: "T-bbbbbb",
      title: task.title.toUpperCase(),
      status: "open",
      refs: [],
      body: "",
    }),
  );
  writeFileSync(
    join(dir, "closed.md"),
    renderProjectTask({ ...task, id: "T-cccccc", status: "done", body: "" }),
  );
  writeFileSync(join(dir, "bad.md"), "bad");
  const legacy = join(root, "notes");
  mkdirSync(legacy);
  writeFileSync(join(legacy, "old.md"), "old");
  writeFileSync(join(legacy, "README.md"), "read");
  const findings = checkProjectTasks({
    checkoutRoot: root,
    dir,
    settings: {},
    now,
    shippedIds: new Set([task.id]),
    legacyFolders: ["notes"],
  });
  expect(new Set(findings.map((f) => f.kind))).toEqual(
    new Set([
      "stale",
      "missed-release",
      "broken-ref",
      "duplicate-title",
      "broken-file",
      "legacy-notes",
    ]),
  );
  expect(findings.filter((f) => f.kind === "stale").map((f) => f.id)).toEqual([
    "T-aaaaaa",
    "T-bbbbbb",
  ]);
  expect(findings.find((f) => f.kind === "legacy-notes")?.text).toContain(
    "task import notes notes --kind <kind>",
  );
});
test("notes import preserves bodies and dates, skips templates, dry runs and deduplicates", () => {
  const root = tempDir();
  const folder = join(root, "notes");
  const dir = join(root, "tasks");
  mkdirSync(join(folder, "archive"), { recursive: true });
  for (const name of ["README.md", "TEMPLATE.md", "archive/old.md"])
    writeFileSync(join(folder, name), "ignore");
  const body = "intro\n# Database work\n\nKeep exactly.\n";
  writeFileSync(join(folder, "2026-09-02-db.md"), body);
  writeFileSync(join(folder, "team-setup.md"), "No heading");
  let n = 0;
  const random = () => (n++ % 32) / 32;
  const options = { folder, dir, kind: "database" as const, now, random };
  const planned = importNotes({ ...options, dryRun: true });
  expect(planned.tasks).toHaveLength(2);
  expect(existsSync(dir)).toBe(false);
  const { tasks } = importNotes({ ...options, dryRun: false });
  expect(tasks[0]?.created).toBe("2026-09-02");
  expect(tasks[0]?.body).toBe(body);
  expect(tasks[1]?.title).toBe("team setup");
  expect(tasks[1]?.created).toBe("2026-11-03");
  expect(importNotes({ ...options, dryRun: false }).tasks).toEqual([]);
  expect(readFileSync(join(folder, "2026-09-02-db.md"), "utf8")).toBe(body);
});
test("since splits older, boundary, newer and undated notes identically on dry run", () => {
  const root = tempDir();
  const folder = join(root, "notes");
  const dir = join(root, "tasks");
  mkdirSync(folder);
  for (const name of ["2026-10-01-old.md", "2026-10-02-on.md", "2026-10-03-new.md", "undated.md"])
    writeFileSync(join(folder, name), `# ${name}\n`);
  let n = 0;
  const options = {
    folder,
    dir,
    kind: "follow-up" as const,
    since: "2026-10-02",
    now,
    random: () => (n++ % 32) / 32,
  };
  const dry = importNotes({ ...options, dryRun: true });
  const real = importNotes({ ...options, dryRun: false });
  expect(dry.skipped).toEqual([
    { file: join(folder, "2026-10-01-old.md"), reason: "older than 2026-10-02" },
  ]);
  expect(real.skipped).toEqual(dry.skipped);
  expect(dry.noDate).toEqual([join(folder, "undated.md")]);
  expect(real.noDate).toEqual(dry.noDate);
  expect(real.tasks.map((t) => t.title)).toEqual([
    "2026-10-02-on.md",
    "2026-10-03-new.md",
    "undated.md",
  ]);
  expect(dry.tasks.map((t) => t.title)).toEqual(real.tasks.map((t) => t.title));
});
test("git branch changes, archived tasks, deleted paths, unmerged branches and release ids", () => {
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
  closeProjectTask(dir, first.id, { status: "done" }, now);
  const added = create(dir, "New", () => 1 / 32);
  git(root, "add", ".");
  git(root, "commit", "-m", "changes");
  updateProjectTask(dir, added.id, { title: "Changed locally" }, now);
  const untracked = create(dir, "Untracked", () => 2 / 32);
  const changes = branchTaskChanges(root, dir, "main");
  expect(changes.find((c) => c.task?.id === added.id)?.task?.title).toBe("Changed locally");
  expect(changes.find((c) => c.task?.id === untracked.id)?.change).toBe("added");
  expect(changes.some((c) => c.change === "deleted" && c.file.endsWith("t-deploy.md"))).toBe(false);
  expect(changes.some((c) => c.change === "deleted" && c.file.endsWith("T-aaaaaa-deploy.md"))).toBe(
    true,
  );
  expect(changes.some((c) => c.change === "closed" && c.task?.id === first.id)).toBe(true);
  expect(shippedIdsOn(root, dir, "work")).toEqual(new Set([first.id, added.id]));
  updateProjectTask(dir, added.id, { title: "New" }, now);
  git(root, "checkout", "main");
  expect(unmergedBranchTasks(root, dir, "main").map((t) => [t.branch, t.task.id])).toEqual([
    ["work", added.id],
  ]);
});
