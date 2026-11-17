import { expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { hookEnv } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { scanDeployTasks } from "./deploy/files";
import { createTaskOps } from "./ops";

/** A temp git repo with an optional project file, and the ops over it. */
function deployOps(config?: unknown, options: { refuseBlockingDrop?: boolean } = {}) {
  const cwd = realpathSync(tempDir());
  git(cwd, "init", "-b", "main");
  if (config !== undefined) {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "cc-smart-dev-kit.json"), JSON.stringify(config));
  }
  const ops = createTaskOps({
    stateDir: tempDir(),
    cwd: () => cwd,
    caller: () => null,
    env: hookEnv(),
    ...options,
  });
  return { cwd, dir: join(cwd, ".claude", "tasks"), ops };
}

const OLD_ID_ANSWER =
  "old task ids are gone in 5.0.0: the file is not read; recreate it as a deploy task or delete it";

test("a work task refuses every deploy field, with the way out", () => {
  const { ops } = deployOps();
  try {
    for (const field of [
      { deploy: "before" },
      { pair: true },
      { flags: ["needs-yes"] },
      { refs: ["a.sql"] },
      { from: "branch x" },
    ]) {
      const answer = ops.call("create", { subject: "Plain", ...field });
      expect(answer.ok).toBe(false);
      if (!answer.ok)
        expect(answer.why).toBe(
          `Deploy fields (${Object.keys(field).join(", ")}) need kind prod or staging: a work task has none`,
        );
    }
    expect(ops.call("create", { subject: "Plain" })).toEqual({ ok: true, text: '#1 "Plain"' });
    expect(ops.call("update", { task: "#1", deploy: "after" })).toEqual({
      ok: false,
      why: "Deploy fields (deploy) need kind prod or staging: a work task has none",
    });
  } finally {
    ops.close();
  }
});

test("a prod or staging task needs deploy and type, and the project's environments", () => {
  const { ops, dir, cwd } = deployOps({ tasks: { envs: ["prod"] } });
  try {
    expect(ops.call("create", { subject: "A", kind: "prod", type: "blocking" })).toEqual({
      ok: false,
      why: "A deploy task needs deploy (before or after)",
    });
    expect(ops.call("create", { subject: "A", kind: "prod", deploy: "before" })).toEqual({
      ok: false,
      why: "A deploy task needs type (blocking or non-blocking)",
    });
    expect(
      ops.call("create", { subject: "A", kind: "staging", deploy: "before", type: "blocking" }),
    ).toEqual({
      ok: false,
      why: "staging is not one of this project's environments (tasks.envs: prod)",
    });
    expect(scanDeployTasks(dir, { archive: true }).tasks).toEqual([]);
    const made = ops.call("create", {
      subject: "Migrate",
      kind: "prod",
      deploy: "before",
      type: "blocking",
    });
    if (!made.ok) throw new Error(made.why);
    const task = scanDeployTasks(dir, { archive: false }).tasks[0];
    if (!task) throw new Error("missing task");
    expect(made.text).toBe(
      `${task.id} "Migrate" · ${join(".claude", "tasks", "prod", basename(task.file))} · written in ${cwd}: commit the file with your branch`,
    );
  } finally {
    ops.close();
  }
});

test("a pair writes a staging and a prod file that name each other", () => {
  const { ops, dir, cwd } = deployOps();
  try {
    const made = ops.call("create", {
      subject: "Run the migration",
      kind: "staging",
      pair: true,
      deploy: "before",
      type: "blocking",
    });
    if (!made.ok) throw new Error(made.why);
    const tasks = scanDeployTasks(dir, { archive: false }).tasks;
    const staging = tasks.find((t) => t.env === "staging");
    const prod = tasks.find((t) => t.env === "prod");
    if (!staging || !prod) throw new Error("expected both files");
    expect(staging.twin).toBe(prod.id);
    expect(prod.twin).toBe(staging.id);
    expect(made.text.split("\n")).toHaveLength(2);
    expect(made.text).toContain(staging.id);
    expect(made.text).toContain(prod.id);
    expect(made.text).toContain(`written in ${cwd}`);
    expect(made.text).toContain("commit the file with your branch");
    // A pair is a staging call: prod refuses it.
    expect(
      ops.call("create", {
        subject: "x",
        kind: "prod",
        pair: true,
        deploy: "after",
        type: "blocking",
      }),
    ).toEqual({
      ok: false,
      why: "pair is for kind staging: it creates the staging task and its prod twin",
    });
  } finally {
    ops.close();
  }
  const only = deployOps({ tasks: { envs: ["staging"] } });
  try {
    const answer = only.ops.call("create", {
      subject: "x",
      kind: "staging",
      pair: true,
      deploy: "after",
      type: "blocking",
    });
    expect(answer.ok).toBe(false);
    expect(scanDeployTasks(only.dir, { archive: true }).tasks).toEqual([]);
  } finally {
    only.ops.close();
  }
});

test("done needs evidence and dropped needs a note on a deploy task", () => {
  const { ops, dir } = deployOps();
  try {
    ops.call("create", { subject: "Warm", kind: "prod", deploy: "after", type: "non-blocking" });
    const id = scanDeployTasks(dir, { archive: false }).tasks[0]?.id ?? "";
    expect(ops.call("done", { task: id })).toMatchObject({ ok: false });
    expect(ops.call("done", { task: id, outcome: "dropped" })).toMatchObject({ ok: false });
    expect(ops.call("done", { task: id, evidence: "ran it: ok" }).ok).toBe(true);
    expect(ops.call("done", { task: id, evidence: "again" })).toMatchObject({ ok: false });
  } finally {
    ops.close();
  }
});

for (const refuse of [true, false]) {
  test(`a blocking deploy task drop is ${refuse ? "refused" : "allowed"} when refuseBlockingDrop is ${refuse}`, () => {
    const { ops, dir } = deployOps(undefined, { refuseBlockingDrop: refuse });
    try {
      ops.call("create", { subject: "Gate", kind: "prod", deploy: "before", type: "blocking" });
      ops.call("create", { subject: "Soft", kind: "prod", deploy: "before", type: "non-blocking" });
      const idOf = (title: string) =>
        scanDeployTasks(dir, { archive: false }).tasks.find((t) => t.title === title)?.id ?? "";
      const gate = idOf("Gate");
      // A non-blocking task is dropped with a note either way.
      expect(
        ops.call("done", { task: idOf("Soft"), outcome: "dropped", note: "not needed" }).ok,
      ).toBe(true);
      const answer = ops.call("done", { task: gate, outcome: "dropped", note: "no longer owed" });
      expect(answer.ok).toBe(!refuse);
      if (!answer.ok)
        expect(answer.why).toBe(
          `${gate} is blocking: only the person drops a blocking deploy task. Run \`cc-smart-dev-kit task drop ${gate} --note "<reason>"\` in your own terminal, outside Claude Code`,
        );
      expect(scanDeployTasks(dir, { archive: false }).tasks.some((t) => t.id === gate)).toBe(
        refuse,
      );
    } finally {
      ops.close();
    }
  });
}

test("task_update with status open reopens a closed deploy task, and only that", () => {
  const { ops, dir } = deployOps();
  try {
    ops.call("create", { subject: "Cache", kind: "staging", deploy: "after", type: "blocking" });
    const id = scanDeployTasks(dir, { archive: false }).tasks[0]?.id ?? "";
    expect(ops.call("update", { task: id, status: "open" })).toMatchObject({ ok: false });
    expect(ops.call("done", { task: id, evidence: "ok" }).ok).toBe(true);
    expect(scanDeployTasks(dir, { archive: false }).tasks).toEqual([]);
    expect(ops.call("update", { task: id, status: "open" })).toEqual({
      ok: true,
      text: `${id} "Cache" · open again`,
    });
    const [task] = scanDeployTasks(dir, { archive: true }).tasks;
    expect(task?.status).toBe("open");
    expect(task?.file).toBe(join(dir, "staging", basename(task?.file ?? "")));
    expect(task?.closed).toBeUndefined();
    // Closing goes through task_done, never through update.
    expect(ops.call("update", { task: id, status: "done" })).toMatchObject({ ok: false });
    // A work task has no "open".
    ops.call("create", { subject: "Plain" });
    expect(ops.call("update", { task: "#1", status: "open" })).toMatchObject({ ok: false });
  } finally {
    ops.close();
  }
});

test("an old T- reference is answered, never read", () => {
  const { ops } = deployOps();
  try {
    for (const [operation, input] of [
      ["update", { task: "T-abcdef", subject: "x" }],
      ["done", { task: "T-abcdef", evidence: "x" }],
      ["note", { task: "T-abcdef", text: "x" }],
      ["get", { task: "T-abcdef" }],
      ["delete", { task: "T-abcdef" }],
    ] as const) {
      expect(ops.call(operation, input)).toEqual({ ok: false, why: OLD_ID_ANSWER });
    }
    expect(ops.call("create", { subject: "x", parent: "T-abcdef" })).toEqual({
      ok: false,
      why: OLD_ID_ANSWER,
    });
  } finally {
    ops.close();
  }
});
