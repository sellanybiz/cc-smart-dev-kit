import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { hookEnv } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { scanDeployTasks } from "./deploy/files";
import { createTaskOps } from "./ops";

/** Two repos: a session recorded in `session`, and a command run in `shell` (an explicit `cwd`). */
function twoCheckouts() {
  const session = realpathSync(tempDir());
  const shell = realpathSync(tempDir());
  git(session, "init", "-b", "main");
  git(shell, "init", "-b", "main");
  const ops = createTaskOps({
    stateDir: tempDir(),
    cwd: () => shell,
    caller: () => ({ sessionId: "s", pid: null, procStart: null, cwd: session }),
    env: hookEnv(),
  });
  return { session, shell, ops };
}

test("a deploy task acts in the folder the command runs in, not the session record's", () => {
  const { session, shell, ops } = twoCheckouts();
  try {
    const made = ops.call("create", {
      subject: "Gate",
      kind: "staging",
      deploy: "after",
      type: "blocking",
    });
    if (!made.ok) throw new Error(made.why);
    const id = made.text.split(" ")[0] ?? "";
    expect(made.text).toContain(`written in ${shell}: commit the file with your branch`);
    expect(scanDeployTasks(join(shell, ".claude", "tasks"), { archive: true }).tasks).toHaveLength(
      1,
    );
    expect(scanDeployTasks(join(session, ".claude", "tasks"), { archive: true }).tasks).toEqual([]);
    // The close finds the file in the shell's checkout and says where it landed.
    const closed = ops.call("done", { task: id, evidence: "ran it, ok" });
    if (!closed.ok) throw new Error(closed.why);
    expect(closed.text).toBe(
      `${id} "Gate" · done · ${join(".claude", "tasks", "staging", "archive", `${id}-gate.md`)} · written in ${shell}: commit the file with your branch`,
    );
  } finally {
    ops.close();
  }
});

test("every deploy-task answer names the checkout it wrote in", () => {
  const { shell, ops } = twoCheckouts();
  try {
    const made = ops.call("create", {
      subject: "Gate",
      kind: "staging",
      deploy: "after",
      type: "non-blocking",
    });
    if (!made.ok) throw new Error(made.why);
    const id = made.text.split(" ")[0] ?? "";
    const file = (folder: string) => join(".claude", "tasks", folder, `${id}-gate.md`);
    const tail = `written in ${shell}: commit the file with your branch`;
    expect(ops.call("note", { task: id, text: "seen" })).toEqual({
      ok: true,
      text: `${id} · note saved · ${file("staging")} · ${tail}`,
    });
    expect(ops.call("update", { task: id, subject: "Gate 2" })).toEqual({
      ok: true,
      text: `${id} "Gate 2" · updated · ${file("staging")} · ${tail}`,
    });
    expect(ops.call("done", { task: id, outcome: "dropped", note: "not needed" })).toEqual({
      ok: true,
      text: `${id} "Gate 2" · dropped · ${file("staging/archive")} · ${tail}`,
    });
    expect(ops.call("update", { task: id, status: "open" })).toEqual({
      ok: true,
      text: `${id} "Gate 2" · open again · ${file("staging")} · ${tail}`,
    });
    expect(ops.call("delete", { task: id })).toEqual({
      ok: true,
      text: `${id} · deleted · ${file("staging")} · removed from ${shell}`,
    });
  } finally {
    ops.close();
  }
});
