import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { hookEnv } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { scanDeployTasks } from "./deploy/files";
import { createTaskOps } from "./ops";

function deployOps(refuseBlockingDrop: boolean) {
  const cwd = realpathSync(tempDir());
  git(cwd, "init", "-b", "main");
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  const ops = createTaskOps({
    stateDir: tempDir(),
    cwd: () => cwd,
    caller: () => null,
    env: hookEnv(),
    refuseBlockingDrop,
  });
  return { dir: join(cwd, ".claude", "tasks"), ops };
}

const personOnly = (id: string, action: string, command: string) =>
  `${id} is blocking: only the person ${action}. Ask the person to run \`${command}\` in their own terminal, outside Claude Code`;

for (const refuse of [true, false]) {
  test(`weakening or deleting an open blocking deploy task is ${refuse ? "refused" : "allowed"} when refuseBlockingDrop is ${refuse}`, () => {
    const { ops, dir } = deployOps(refuse);
    try {
      for (const title of ["A", "B", "C"])
        ops.call("create", { subject: title, kind: "prod", deploy: "before", type: "blocking" });
      const idOf = (title: string) =>
        scanDeployTasks(dir, { archive: true }).tasks.find((t) => t.title === title)?.id ?? "";
      const [a, b, c] = [idOf("A"), idOf("B"), idOf("C")];
      // Editing what does not weaken the task is always allowed.
      expect(ops.call("update", { task: a, subject: "A renamed" }).ok).toBe(true);
      const weaker = ops.call("update", { task: a, type: "non-blocking" });
      expect(weaker.ok).toBe(!refuse);
      if (!weaker.ok)
        expect(weaker.why).toBe(
          personOnly(
            a,
            "weakens a blocking deploy task",
            `cc-smart-dev-kit task set ${a} --type non-blocking`,
          ),
        );
      const later = ops.call("update", { task: b, deploy: "after" });
      expect(later.ok).toBe(!refuse);
      if (!later.ok)
        expect(later.why).toBe(
          personOnly(
            b,
            "weakens a blocking deploy task",
            `cc-smart-dev-kit task set ${b} --deploy after`,
          ),
        );
      const deleted = ops.call("delete", { task: c });
      expect(deleted.ok).toBe(!refuse);
      if (!deleted.ok)
        expect(deleted.why).toBe(
          personOnly(c, "deletes a blocking deploy task", `cc-smart-dev-kit task delete ${c}`),
        );
      const left = scanDeployTasks(dir, { archive: true }).tasks;
      expect(left.find((t) => t.id === a)?.type).toBe(refuse ? "blocking" : "non-blocking");
      expect(left.find((t) => t.id === b)?.deploy).toBe(refuse ? "before" : "after");
      expect(left.some((t) => t.id === c)).toBe(refuse);
    } finally {
      ops.close();
    }
  });
}

test("a closed blocking deploy task cannot be weakened and reopened in one call", () => {
  const { ops, dir } = deployOps(true);
  try {
    ops.call("create", { subject: "Gate", kind: "prod", deploy: "before", type: "blocking" });
    const id = scanDeployTasks(dir, { archive: false }).tasks[0]?.id ?? "";
    expect(ops.call("done", { task: id, evidence: "ok" }).ok).toBe(true);
    expect(ops.call("update", { task: id, status: "open", type: "non-blocking" }).ok).toBe(false);
    const [task] = scanDeployTasks(dir, { archive: true }).tasks;
    expect(task?.status).toBe("done");
    expect(task?.type).toBe("blocking");
    // Reopening alone is fine.
    expect(ops.call("update", { task: id, status: "open" }).ok).toBe(true);
  } finally {
    ops.close();
  }
});

test("a work task takes pair false and empty lists as not given", () => {
  const { ops } = deployOps(false);
  try {
    expect(ops.call("create", { subject: "Plain", pair: false, flags: [], refs: [] })).toEqual({
      ok: true,
      text: '#1 "Plain"',
    });
  } finally {
    ops.close();
  }
});
