/**
 * The one up-front refusal for task writes (#931): a project file this kit cannot use (a
 * `requires` it does not meet, or a broken file) stops every writing tool before anything
 * changes, the claim move of a resumed session too, while the reads still answer and name it.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo } from "../testing/hooks";
import { createTaskOps, type TaskAnswer } from "./ops";
import { workDbFile } from "./work/db";
import type { Who } from "./work/types";

// One session in two processes: the first ran the work and is gone, the second resumed it.
const FIRST: Who = { sessionId: "resumed", pid: 999999981, procStart: "111" };
const RESUMED: Who = { sessionId: "resumed", pid: 999999982, procStart: "222" };

const TOO_NEW = { requires: ">=99.0" };
const UPDATE = "claude plugin update cc-smart-dev-kit@cc-smart-dev-kit";
const NOTHING_KNOWN =
  "If the kit on disk already meets it, restart this session to load it; after an update, restart it too.";

function said(answer: TaskAnswer): string {
  if (!answer.ok) throw new Error(answer.why);
  return answer.text;
}

/**
 * A repo whose first process laid plan #1, phase #2 (running, claimed by that process) and step
 * #3, with no project file yet; `projectFile` then writes one.
 */
function gateWorld() {
  const repo = makeRepo();
  const env = hookEnv();
  const paths = cliPaths(env);
  const file = join(repo, ".claude", "cc-smart-dev-kit.json");
  const opsFor = (who: Who) =>
    createTaskOps({
      stateDir: paths.stateDir,
      env,
      cwd: () => repo,
      caller: () => ({ ...who, cwd: repo }),
    });
  const first = opsFor(FIRST);
  try {
    said(first.call("create", { subject: "Plan", plan: "big" }));
    said(first.call("create", { subject: "Area", plan: "big", phase: "A" }));
    said(first.call("create", { subject: "Step", parent: "#2" }));
    said(first.call("update", { task: "#2", status: "in_progress" }));
  } finally {
    first.close();
  }
  const projectFile = (text: string) => {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(file, text);
  };
  /** Every row of every table in the store: what a refused call must leave as it was. */
  const store = () => {
    const raw = new Database(workDbFile(paths), { readonly: true });
    try {
      const tables = raw
        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      return Object.fromEntries(
        tables.map(({ name }) => [name, raw.query(`SELECT * FROM "${name}"`).all()]),
      );
    } finally {
      raw.close();
    }
  };
  return { env, paths, file, opsFor, projectFile, store };
}

/** Each writing tool on the world's tasks, as a session would call it. */
const WRITES = [
  ["create", { subject: "Another", plan: "other" }],
  ["update", { task: "#1", files: ["src/"] }],
  ["update", { task: "#3", status: "in_progress" }],
  ["create", { subject: "Loose" }],
  ["note", { task: "#3", text: "a note" }],
  ["done", { task: "#3", evidence: "ran it" }],
  ["take", { task: "#1" }],
  ["delete", { task: "#3" }],
] as const;

test("a requires this kit does not meet refuses every write the same way, and writes nothing", () => {
  const { file, opsFor, projectFile, store } = gateWorld();
  projectFile(JSON.stringify(TOO_NEW));
  const refusal = `Task writes are refused: ${file}: this project needs cc-smart-dev-kit >=99.0; you have ${VERSION}; run ${UPDATE}. ${NOTHING_KNOWN}`;
  const before = store();
  const ops = opsFor(RESUMED);
  try {
    for (const [operation, input] of WRITES)
      expect({ operation, answer: ops.call(operation, input) }).toEqual({
        operation,
        answer: { ok: false, why: refusal },
      });
  } finally {
    ops.close();
  }
  // Nothing changed: no row, no note, no history, and the first process still holds its claim.
  expect(store()).toEqual(before);
});

test("a broken project file refuses every write with its own message", () => {
  const { file, opsFor, projectFile, store } = gateWorld();
  projectFile("{ not json");
  const before = store();
  const ops = opsFor(RESUMED);
  try {
    const answers = WRITES.map(([operation, input]) => ops.call(operation, input));
    const first = answers[0];
    if (first === undefined || first.ok) throw new Error("expected a refusal");
    expect(first.why).toStartWith(`Task writes are refused: Invalid ${file}: not valid JSON (`);
    expect(first.why).toEndWith(". Fix that file; task reads still answer.");
    expect(answers).toEqual(WRITES.map(() => first));
  } finally {
    ops.close();
  }
  expect(store()).toEqual(before);
});

test("the reads still answer and name the problem; the project list says deploy tasks were not read", () => {
  const { file, opsFor, projectFile } = gateWorld();
  projectFile(JSON.stringify(TOO_NEW));
  const problem = `Task writes are refused: ${file}: this project needs cc-smart-dev-kit >=99.0; you have ${VERSION}; run ${UPDATE}. ${NOTHING_KNOWN}`;
  const ops = opsFor(RESUMED);
  try {
    const mine = said(ops.call("list", {})).split("\n");
    expect(mine.at(0)).toStartWith("#1 [in progress · plan] Plan");
    expect(mine.at(-1)).toBe(problem);
    const project = said(ops.call("list", { scope: "project" })).split("\n");
    expect(project.slice(-2)).toEqual([problem, "Deploy tasks were not read."]);
    const found = said(ops.call("search", { text: "Step" })).split("\n");
    expect(found.slice(-2)).toEqual([problem, "Deploy tasks were not read."]);
    const got = said(ops.call("get", { task: "#3" })).split("\n");
    expect(got.at(0)).toStartWith('#3 "Step"');
    expect(got.at(-1)).toBe(problem);
  } finally {
    ops.close();
  }
});

test("the fix says restart when the kit on disk already meets requires, and update otherwise", () => {
  const { env, paths, file, projectFile } = gateWorld();
  projectFile(JSON.stringify(TOO_NEW));
  const installed = (version: string) => {
    mkdirSync(join(paths.claudeConfigDir, "plugins"), { recursive: true });
    writeFileSync(
      paths.installedPluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "cc-smart-dev-kit@cc-smart-dev-kit": [
            { scope: "user", installPath: join(paths.claudeConfigDir, "kit"), version },
          ],
        },
      }),
    );
  };
  const refusal = () => {
    const ops = createTaskOps({ stateDir: paths.stateDir, env, cwd: () => join(file, "..", "..") });
    try {
      const answer = ops.call("create", { subject: "Loose" });
      if (answer.ok) throw new Error("expected a refusal");
      return answer.why.slice(answer.why.indexOf(`run ${UPDATE}. `) + `run ${UPDATE}. `.length);
    } finally {
      ops.close();
    }
  };
  installed("99.1.0");
  expect(refusal()).toBe(
    "The kit on disk (99.1.0) already meets it: restart this session to load it.",
  );
  installed("1.0.0");
  expect(refusal()).toBe("After an update, restart this session to load it.");
  installed(VERSION);
  expect(refusal()).toBe("After an update, restart this session to load it.");
});
