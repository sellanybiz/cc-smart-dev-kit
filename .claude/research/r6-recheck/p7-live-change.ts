/**
 * P7 — a changed `env` value reaches a running session; a removed key does not.
 *
 * One long-lived `claude -p --input-format stream-json` per session, in a trusted git repo, the
 * shell exporting D. Between turns the probe rewrites a settings file and waits a set time,
 * then records which fake the next turn's message request reached. Fakes: B (the first value),
 * C (the changed one), E (a second change), P (the project's shared file), U (the user file),
 * D (the shell).
 *
 * Writes are in place (`writeFileSync`) unless a session says "atomic": a temp file renamed
 * over the old one, the way the kit's managed writers replace a file.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p7-live-change.ts`
 */
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  baseEnv,
  claudeVersion,
  type Fakes,
  git,
  gitRepo,
  makeWorld,
  messagesTo,
  report,
  StreamSession,
  startFakes,
  trust,
  urlSettings,
  type World,
  writeJson,
} from "./lib.ts";

type Step =
  | { turn: string }
  | { write: string | null; atomic?: boolean; file?: "local" | "user" | "shared" }
  | { remove: "local" | "user" }
  | { wait: number };

type SessionPlan = {
  name: string;
  local?: string;
  shared?: string;
  user?: string;
  /** Run the session in a linked worktree whose own settings.local.json names this fake. */
  worktreeLocal?: string;
  steps: Step[];
};

const PLANS: SessionPlan[] = [
  {
    name: "local file: changed, next turn after 0.1 s, then after 3 s more",
    local: "B",
    steps: [
      { turn: "t1" },
      { write: "C" },
      { wait: 100 },
      { turn: "t2" },
      { wait: 3000 },
      { turn: "t3" },
    ],
  },
  {
    name: "local file: changed, next turn after 0.5 s",
    local: "B",
    steps: [{ turn: "t1" }, { write: "C" }, { wait: 500 }, { turn: "t2" }],
  },
  {
    name: "local file: changed after 1 s; then the key removed (3 s, 5 s more), then the file removed",
    local: "B",
    steps: [
      { turn: "t1" },
      { write: "C" },
      { wait: 1000 },
      { turn: "t2" },
      { write: null },
      { wait: 3000 },
      { turn: "t3" },
      { wait: 5000 },
      { turn: "t4" },
      { remove: "local" },
      { wait: 3000 },
      { turn: "t5" },
    ],
  },
  { name: "a fresh session with the key gone", steps: [{ turn: "t1" }] },
  {
    name: "user file: changed after 1.5 s; then the key removed",
    user: "B",
    steps: [
      { turn: "t1" },
      { write: "C", file: "user" },
      { wait: 1500 },
      { turn: "t2" },
      { write: null, file: "user" },
      { wait: 3000 },
      { turn: "t3" },
    ],
  },
  {
    name: "local key removed while the shared file names P",
    local: "B",
    shared: "P",
    steps: [{ turn: "t1" }, { write: null }, { wait: 3000 }, { turn: "t2" }],
  },
  {
    name: "local key removed while the user file names U",
    local: "B",
    user: "U",
    steps: [{ turn: "t1" }, { write: null }, { wait: 3000 }, { turn: "t2" }],
  },
  {
    name: "local file removed while the user file names U",
    local: "B",
    user: "U",
    steps: [{ turn: "t1" }, { remove: "local" }, { wait: 3000 }, { turn: "t2" }],
  },
  {
    name: "local file replaced atomically (rename), twice",
    local: "B",
    steps: [
      { turn: "t1" },
      { write: "C", atomic: true },
      { wait: 1500 },
      { turn: "t2" },
      { write: "E", atomic: true },
      { wait: 1500 },
      { turn: "t3" },
    ],
  },
  {
    name: "in a linked worktree with its own local file (E): the main root's local key removed",
    local: "B",
    user: "U",
    worktreeLocal: "E",
    steps: [{ turn: "t1" }, { write: null }, { wait: 3000 }, { turn: "t2" }],
  },
];

function place(fakes: Fakes, file: string, label: string | null, atomic: boolean): void {
  const value = label === null ? {} : urlSettings(fakes.url(label));
  if (!atomic) {
    writeJson(file, value);
    return;
  }
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

async function runPlan(world: World, fakes: Fakes, index: number, plan: SessionPlan) {
  const dir = await gitRepo(world, join(world.root, `proj-${index + 1}`));
  await trust(world, dir);
  const files = {
    local: join(dir, ".claude", "settings.local.json"),
    shared: join(dir, ".claude", "settings.json"),
    user: join(world.configDir, "settings.json"),
  };
  rmSync(files.user, { force: true });
  if (plan.local) writeJson(files.local, urlSettings(fakes.url(plan.local)));
  if (plan.shared) writeJson(files.shared, urlSettings(fakes.url(plan.shared)));
  if (plan.user) writeJson(files.user, urlSettings(fakes.url(plan.user)));
  let cwd = dir;
  if (plan.worktreeLocal) {
    cwd = join(world.root, `proj-${index + 1}-wt`);
    await git(world, dir, "worktree", "add", "-q", "-b", "wt", cwd);
    await trust(world, cwd);
    writeJson(
      join(cwd, ".claude", "settings.local.json"),
      urlSettings(fakes.url(plan.worktreeLocal)),
    );
  }

  const session = new StreamSession();
  session.start(cwd, baseEnv(world, fakes.url("D")));
  const events: string[] = [];
  let lastWrite = 0;
  for (const step of plan.steps) {
    if ("turn" in step) {
      const from = fakes.log.length;
      const result = await session.turn(`Say ok (${step.turn})`);
      const post = fakes.log
        .slice(from)
        .find((e) => e.method === "POST" && /\/v1\/messages(\?|$)/.test(e.path ?? ""));
      const since = post && lastWrite ? ` (${post.t - lastWrite} ms after the last write)` : "";
      events.push(
        `${step.turn} -> ${messagesTo(fakes.log, from).join(",") || "none"}${since}; answer ${String(result?.result)}`,
      );
    } else if ("write" in step) {
      place(fakes, files[step.file ?? "local"], step.write, step.atomic === true);
      lastWrite = Date.now();
      events.push(
        `${step.file ?? "local"} ${step.write === null ? "key removed ({})" : `-> ${step.write}`}${step.atomic ? " (atomic)" : ""}`,
      );
    } else if ("remove" in step) {
      rmSync(files[step.remove], { force: true });
      lastWrite = Date.now();
      events.push(`${step.remove} file removed`);
    } else {
      await Bun.sleep(step.wait);
      events.push(`waited ${step.wait} ms`);
    }
  }
  const exitCode = await session.close();
  return { session: plan.name, events, exitCode, stderr: session.stderr.trim() };
}

const world = makeWorld("p7");
const fakes = startFakes(["B", "C", "E", "P", "U", "D"]);
const sessions = [];
try {
  for (const [index, plan] of PLANS.entries())
    sessions.push(await runPlan(world, fakes, index, plan));
} finally {
  fakes.stop();
}
report(world, { proof: "P7", claude: await claudeVersion(), sessions }, fakes.log);
