import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";

const CLI = join(import.meta.dir, "../entries/cli.ts");

/** A repo with a bare `origin` it has pushed `main` to, and the task command run as a process in it. */
function world(options: { origin?: boolean; git?: boolean } = {}) {
  const home = tempDir();
  const cwd = realpathSync(tempDir());
  if (options.git !== false) {
    git(cwd, "init", "-b", "main");
    git(cwd, "commit", "--allow-empty", "-m", "initial");
    if (options.origin !== false) {
      const origin = tempDir();
      git(origin, "init", "--bare", "-b", "main");
      git(cwd, "remote", "add", "origin", origin);
      git(cwd, "push", "-u", "origin", "main");
    }
  }
  const guard = subprocessGuard();
  const baseEnv: Record<string, string> = {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(process.execPath)}:${dirname(Bun.which("git") ?? "/usr/bin/git")}`,
  };
  async function run(args: string[], extra: Record<string, string> = {}) {
    const child = Bun.spawn([Bun.which("bun") ?? "bun", ...guard.args, CLI, "task", ...args], {
      cwd,
      env: { ...baseEnv, ...extra },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: await child.exited,
      text: await new Response(child.stdout).text(),
      error: await new Response(child.stderr).text(),
    };
  }
  /** Adds a deploy task and returns its id (the first word of the answer). */
  async function add(title: string, env: "prod" | "staging", deploy: string, type: string) {
    const made = await run(["add", title, "--kind", env, "--deploy", deploy, "--type", type]);
    expect(made.code).toBe(0);
    return made.text.split(" ")[0] ?? "";
  }
  const tasks = join(cwd, ".claude", "tasks");
  return { cwd, tasks, run, add };
}

test("add refuses deploy fields on a work task and needs deploy and type on prod", async () => {
  const { run } = world();
  expect(await run(["add", "Plain", "--deploy", "before"])).toEqual({
    code: 1,
    text: "",
    error: "Deploy fields (deploy) need kind prod or staging: a work task has none\n",
  });
  expect(await run(["add", "Plain", "--kind", "prod", "--type", "blocking"])).toEqual({
    code: 1,
    text: "",
    error: "A deploy task needs deploy (before or after)\n",
  });
  expect(await run(["add", "Plain", "--kind", "prod", "--deploy", "after"])).toEqual({
    code: 1,
    text: "",
    error: "A deploy task needs type (blocking or non-blocking)\n",
  });
});

test("add --pair writes a staging and a prod file", async () => {
  const { run, tasks, cwd } = world();
  const made = await run([
    "add",
    "Run the migration",
    "--kind",
    "staging",
    "--pair",
    "--deploy",
    "before",
    "--type",
    "blocking",
  ]);
  expect(made.code).toBe(0);
  const lines = made.text.trimEnd().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith("staging-");
  expect(lines[1]).toStartWith("prod-");
  expect(lines[0]).toContain(`written in ${cwd}: commit the file with your branch`);
  expect(readdirSync(join(tasks, "staging"))).toHaveLength(1);
  expect(readdirSync(join(tasks, "prod"))).toHaveLength(1);
  expect(
    (await run(["add", "x", "--kind", "prod", "--pair", "--deploy", "after", "--type", "blocking"]))
      .code,
  ).toBe(1);
});

test("drop of a blocking deploy task is refused inside Claude Code and allowed in a terminal", async () => {
  const { run, add, cwd } = world();
  const id = await add("Gate", "prod", "before", "blocking");
  const inside = await run(["drop", id, "--note", "no longer owed"], { CLAUDECODE: "1" });
  expect(inside).toEqual({
    code: 1,
    text: "",
    error: `${id} is blocking: only the person drops a blocking deploy task. Ask the person to run \`cc-smart-dev-kit task drop ${id} --note "<reason>"\` in their own terminal, outside Claude Code\n`,
  });
  expect(await run(["drop", id, "--note", "no longer owed"])).toEqual({
    code: 0,
    text: `${id} "Gate" · dropped · .claude/tasks/prod/archive/${id}-gate.md · written in ${cwd}: commit the file with your branch\n`,
    error: "",
  });
});

test("done needs evidence; reopen moves the file back; an old id is answered", async () => {
  const { run, add, tasks, cwd } = world();
  const id = await add("Cache", "staging", "after", "blocking");
  expect((await run(["done", id])).code).toBe(1);
  expect((await run(["done", id, "--evidence", "ran it: ok"])).code).toBe(0);
  expect(existsSync(join(tasks, "staging", "archive"))).toBe(true);
  expect(await run(["reopen", id])).toEqual({
    code: 0,
    text: `${id} "Cache" · open again · .claude/tasks/staging/${id}-cache.md · written in ${cwd}: commit the file with your branch\n`,
    error: "",
  });
  expect(readdirSync(join(tasks, "staging")).filter((name) => name.endsWith(".md"))).toHaveLength(
    1,
  );
  expect(readdirSync(join(tasks, "staging", "archive"))).toHaveLength(0);
  expect(await run(["reopen", id])).toMatchObject({ code: 1, error: `${id} is already open\n` });
  expect(await run(["done", "T-abcdef", "--evidence", "x"])).toEqual({
    code: 1,
    text: "",
    error:
      "old task ids are gone in 5.0.0: the file is not read; recreate it as a deploy task or delete it\n",
  });
});

test("release with no flag lists the open tasks by environment, deploy step and type", async () => {
  const { run, add } = world();
  const before = await add("Migrate", "prod", "before", "blocking");
  const after = await add("Warm cache", "prod", "after", "non-blocking");
  const listing = await run(["release"]);
  expect(listing.code).toBe(0);
  expect(listing.text).toBe(
    `prod · before · blocking\n${before} [before · blocking] Migrate\nprod · after · non-blocking\n${after} [after · non-blocking] Warm cache\n`,
  );
  const one = await run(["release", "staging"]);
  expect(one).toEqual({ code: 0, text: "No open staging tasks.\n", error: "" });
});

test("release --before: refuses on an open blocking task, passes once it is closed", async () => {
  const { run, add, cwd } = world();
  git(cwd, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  const id = await add("Migrate", "prod", "before", "blocking");
  const head = git(cwd, "rev-parse", "HEAD").trim();
  const refused = await run(["release", "prod", "--before"]);
  expect(refused.code).toBe(1);
  expect(refused.text).toContain(`Ref: origin/main (${head})`);
  expect(refused.text).toContain(`Blocking task is open: ${id} "Migrate"`);
  expect(refused.text).toContain("Not ready: 1 reason to stop");
  expect((await run(["done", id, "--evidence", "ran it: ok"])).code).toBe(0);
  const passed = await run(["release", "prod", "--before"]);
  expect(passed.code).toBe(0);
  expect(passed.text).toContain("Ready:");
  const json = await run(["release", "prod", "--before", "--json"]);
  expect(JSON.parse(json.text)).toEqual({
    ref: "origin/main",
    commit: head,
    ok: true,
    refusals: [],
    notes: [],
    warnings: [],
  });
});

test("release --before names the deploy-branch commands when HEAD is not the ref", async () => {
  const { run, cwd } = world();
  writeFileSync(join(cwd, "feature.txt"), "x");
  git(cwd, "add", "feature.txt");
  git(cwd, "commit", "-m", "feature");
  const refused = await run(["release", "prod", "--before"]);
  expect(refused.code).toBe(1);
  expect(refused.text).toContain("git fetch origin");
  expect(refused.text).toContain("git switch --no-track -c deploy/prod-");
  expect(refused.text).toContain("origin/main");
});

test("both gates refuse on the base branch and never print a push to it", async () => {
  const { run, add, cwd } = world();
  const id = await add("Warm cache", "prod", "after", "blocking");
  expect((await run(["done", id, "--evidence", "warm: ok"])).code).toBe(0);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "close the deploy task on main");
  for (const step of ["--before", "--after"]) {
    const gate = await run(["release", "prod", step]);
    expect(gate.code).toBe(1);
    expect(gate.text).toContain(
      "HEAD is on main, the branch deploys ship to: the closes must reach it through a deploy branch's pull request, never by a push to it.",
    );
    expect(gate.text).toContain("git switch --no-track -c deploy/prod-");
    expect(gate.text).not.toContain("git push");
  }
  // --ref changes the commit judged, never the base the run must stay off.
  expect((await run(["release", "prod", "--after", "--ref", "HEAD"])).code).toBe(1);
});

test("release lists the non-blocking before tasks as notes, not refusals", async () => {
  const { run, add, cwd } = world();
  git(cwd, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  const id = await add("Tidy", "prod", "before", "non-blocking");
  const passed = await run(["release", "prod", "--before"]);
  expect(passed.code).toBe(0);
  expect(passed.text).toContain(`Non-blocking, still open: ${id} "Tidy"`);
});

test("release --before warns, and still passes, for uncommitted changes outside the tasks folder", async () => {
  const { run, cwd } = world();
  git(cwd, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  writeFileSync(join(cwd, "app.ts"), "x");
  const passed = await run(["release", "prod", "--before"]);
  expect(passed.code).toBe(0);
  expect(passed.text).toContain(
    "1 uncommitted change(s) outside .claude/tasks (app.ts): this gate judged committed code only, so a deploy from this folder may ship them",
  );
  expect(passed.text).toContain("Ready:");
  const json = JSON.parse((await run(["release", "prod", "--before", "--json"])).text);
  expect(json.warnings).toHaveLength(1);
  // The close gate does not warn about files it never reads.
  expect(JSON.parse((await run(["release", "prod", "--after", "--json"])).text).warnings).toEqual(
    [],
  );
});

test("release --before refuses a prod task whose twin names no task", async () => {
  const { run, cwd } = world();
  git(cwd, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  const made = await run([
    "add",
    "Migrate",
    "--kind",
    "staging",
    "--pair",
    "--deploy",
    "after",
    "--type",
    "non-blocking",
  ]);
  expect(made.code).toBe(0);
  const [stagingId = "", prodId = ""] = made.text.split("\n").map((line) => line.split(" ")[0]);
  // While the twin exists and is open, prod waits for it.
  expect((await run(["release", "prod", "--before"])).text).toContain("waits for its staging twin");
  expect((await run(["delete", stagingId])).code).toBe(0);
  const refused = await run(["release", "prod", "--before"]);
  expect(refused.code).toBe(1);
  expect(refused.text).toContain(
    `${prodId} "Migrate" names its staging twin ${stagingId}, but no task has that id: remove the \`twin\` line from ${cwd}/.claude/tasks/prod/${prodId}-migrate.md, or drop ${prodId} (only the person drops a blocking one) and make a new pair with \`cc-smart-dev-kit task add "<title>" --kind staging --pair --deploy <before|after> --type <blocking|non-blocking>\``,
  );
  const checked = await run(["check"]);
  // `task check` ends each finding with its file, so the fix says "this file" instead.
  expect(checked.text).toContain(
    `twin-missing: Its twin ${stagingId} is not a task: remove the \`twin\` line from this file, or drop ${prodId} (only the person drops a blocking one) and make a new pair with \`cc-smart-dev-kit task add "<title>" --kind staging --pair --deploy <before|after> --type <blocking|non-blocking>\` · ${cwd}/.claude/tasks/prod/${prodId}-migrate.md`,
  );
});

test("release --after refuses an open task, an uncommitted close and an unpushed branch", async () => {
  const { run, add, cwd } = world();
  git(cwd, "switch", "--no-track", "-c", "deploy/prod-20261117-1445", "origin/main");
  const id = await add("Warm cache", "prod", "after", "blocking");
  const open = await run(["release", "prod", "--after"]);
  expect(open.code).toBe(1);
  expect(open.text).toContain(`Task is open: ${id} "Warm cache"`);
  expect((await run(["done", id, "--evidence", "warm: ok"])).code).toBe(0);
  const uncommitted = await run(["release", "prod", "--after"]);
  expect(uncommitted.code).toBe(1);
  expect(uncommitted.text).toContain("uncommitted change(s)");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "close the deploy task");
  const ahead = await run(["release", "prod", "--after"]);
  expect(ahead.code).toBe(1);
  expect(ahead.text).toContain("not pushed: run `git push -u origin deploy/prod-20261117-1445`");
  git(cwd, "push", "-u", "origin", "deploy/prod-20261117-1445");
  const pushed = await run(["release", "prod", "--after"]);
  expect(pushed.code).toBe(0);
  expect(pushed.text).toContain("Ready:");
});

test("release exits 1 outside git and for an unknown ref, 2 for a wrong command", async () => {
  const outside = world({ git: false });
  const nowhere = await outside.run(["release", "prod", "--before"]);
  expect(nowhere.code).toBe(1);
  expect(nowhere.text).toBe("");
  expect(nowhere.error).not.toBe("");
  const { run } = world();
  const unknown = await run(["release", "prod", "--before", "--ref", "no-such-ref"]);
  expect(unknown.code).toBe(1);
  expect(unknown.error).toContain("no-such-ref");
  expect((await run(["release", "prod", "--before", "--after"])).code).toBe(2);
  expect((await run(["release", "--before"])).code).toBe(2);
  expect((await run(["release", "qa", "--before"])).code).toBe(2);
  expect((await run(["release", "prod", "--ref", "origin/main"])).code).toBe(2);
});

test("check prints each finding and exits 1; an open task in archive/ says to reopen again", async () => {
  const { run, add, tasks } = world();
  expect(await run(["check"])).toEqual({
    code: 0,
    text: "Deploy tasks: no problems found.\n",
    error: "",
  });
  const id = await add("Half reopened", "prod", "before", "blocking");
  const folder = join(tasks, "prod");
  const name = readdirSync(folder).find((file) => file.startsWith(id)) ?? "";
  mkdirSync(join(folder, "archive"));
  renameSync(join(folder, name), join(folder, "archive", name));
  const found = await run(["check"]);
  expect(found.code).toBe(1);
  expect(found.text).toContain(
    `open-in-archive: ${id} is open but sits in archive/: run \`cc-smart-dev-kit task reopen ${id}\` again`,
  );
});

test("list --branches keeps listing when one branch has a broken file", async () => {
  const { run, add, cwd, tasks } = world();
  git(cwd, "switch", "-c", "broken-branch");
  mkdirSync(join(tasks, "prod"), { recursive: true });
  writeFileSync(join(tasks, "prod", "garbage.md"), "not a task");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "a broken file");
  git(cwd, "switch", "main");
  git(cwd, "switch", "-c", "good-branch");
  const id = await add("Real", "prod", "before", "blocking");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "a real task");
  git(cwd, "switch", "main");
  const listed = await run(["list", "--branches"]);
  expect(listed.code).toBe(0);
  expect(listed.text).toContain(`good-branch: ${id} [before · blocking] Real`);
  expect(listed.text).toContain("broken-branch:");
  expect(listed.text).toContain("garbage.md");
});

test("list --branches shows a close that waits on an unmerged branch", async () => {
  const { run, add, cwd } = world();
  const id = await add("Gate", "staging", "before", "blocking");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "the task");
  // The listing reads origin's base, so the task must be there for the close to be the news.
  git(cwd, "push", "origin", "main");
  git(cwd, "switch", "-c", "deploy/staging-20261117-1445");
  expect((await run(["done", id, "--evidence", "ran it: ok"])).code).toBe(0);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "close it");
  git(cwd, "switch", "main");
  expect(await run(["list", "--branches"])).toEqual({
    code: 0,
    text: `closed on deploy/staging-20261117-1445, not merged: ${id} [before · blocking] Gate · done\n`,
    error: "",
  });
});

test("set and delete of a blocking deploy task are refused inside Claude Code and work in a terminal", async () => {
  const { run, add, tasks, cwd } = world();
  const id = await add("Gate", "prod", "before", "blocking");
  const refusal = (action: string, command: string) =>
    `${id} is blocking: only the person ${action}. Ask the person to run \`cc-smart-dev-kit task ${command}\` in their own terminal, outside Claude Code\n`;
  const inside = { CLAUDECODE: "1" };
  expect(await run(["set", id, "--type", "non-blocking"], inside)).toEqual({
    code: 1,
    text: "",
    error: refusal("weakens a blocking deploy task", `set ${id} --type non-blocking`),
  });
  expect(await run(["set", id, "--deploy", "after"], inside)).toEqual({
    code: 1,
    text: "",
    error: refusal("weakens a blocking deploy task", `set ${id} --deploy after`),
  });
  expect(await run(["delete", id], inside)).toEqual({
    code: 1,
    text: "",
    error: refusal("deletes a blocking deploy task", `delete ${id}`),
  });
  expect(readdirSync(join(tasks, "prod"))).toHaveLength(1);
  // The person's own terminal may do each of them.
  expect(await run(["set", id, "--type", "non-blocking"])).toEqual({
    code: 0,
    text: `${id} "Gate" · updated · .claude/tasks/prod/${id}-gate.md · written in ${cwd}: commit the file with your branch\n`,
    error: "",
  });
  expect(await run(["set", id, "--deploy", "after"])).toMatchObject({ code: 0 });
  expect(await run(["delete", id])).toEqual({
    code: 0,
    text: `${id} · deleted · .claude/tasks/prod/${id}-gate.md · removed from ${cwd}\n`,
    error: "",
  });
  expect(readdirSync(join(tasks, "prod"))).toHaveLength(0);
});

test("add --kind with a retired or unknown kind is a usage error", async () => {
  const { run } = world();
  expect(await run(["add", "x", "--kind", "follow-up"])).toEqual({
    code: 2,
    text: "",
    error:
      "Unknown kind: follow-up (work, staging, prod); follow-up and teammate are gone in 5.0.0\nSee: cc-smart-dev-kit task --help\n",
  });
});

test("release reports a ref git cannot resolve, and any other git failure as it is", async () => {
  const bare = world({ origin: false });
  // No origin/main in this repo: the default ref cannot be resolved.
  const noOrigin = await bare.run(["release", "prod", "--before"]);
  expect(noOrigin.code).toBe(1);
  expect(noOrigin.error).toContain("Cannot read origin/main");
  expect(noOrigin.error).toContain("git fetch origin");
  // A ref that resolves, in a repo whose HEAD has no commit: git's own message, no fetch advice.
  const empty = world();
  git(empty.cwd, "checkout", "--orphan", "fresh");
  const unborn = await empty.run(["release", "prod", "--before", "--ref", "main"]);
  expect(unborn.code).toBe(1);
  expect(unborn.error).toContain("git rev-parse failed");
  expect(unborn.error).not.toContain("Cannot read");
  // A name that matches a tag and a branch: git would ship the first match, so the gate stops.
  const both = world();
  git(both.cwd, "branch", "rel2");
  git(both.cwd, "tag", "rel2");
  const ambiguous = await both.run(["release", "prod", "--before", "--ref", "rel2"]);
  expect(ambiguous).toEqual({
    code: 1,
    text: "",
    error:
      "rel2 names more than one ref (refs/tags/rel2, refs/heads/rel2): name the one that ships in full with --ref, or delete the one that should not be there\n",
  });
});

test("list --branch groups the branch's task changes under their environment", async () => {
  const { run, add, cwd } = world();
  git(cwd, "switch", "-c", "deploy-branch");
  const id = await add("Seed data", "staging", "after", "non-blocking");
  const listed = await run(["list", "--branch"]);
  expect(listed.code).toBe(0);
  expect(listed.text).toBe(`staging\nadded: ${id} [after · non-blocking] Seed data\n`);
});

test("release --check judges the task files alone: 1 with a blocking task, 0 once it is closed, notes never refuse", async () => {
  // No origin, and a detached HEAD: the check reads no git facts beyond finding the checkout.
  const { run, add, cwd } = world({ origin: false });
  git(cwd, "checkout", "--detach");
  const id = await add("Migrate", "prod", "before", "blocking");
  const note = await add("Warm cache", "prod", "before", "non-blocking");
  const blocking = `Blocking task is open: ${id} "Migrate": do it, then close it with evidence`;
  const noted = `Non-blocking, still open: ${note} "Warm cache": do it now, or drop it with a reason`;
  const refused = await run(["release", "prod", "--check"]);
  expect(refused.code).toBe(1);
  expect(refused.error).toBe("");
  expect(refused.text).toBe(
    `Release check: prod\n✗ ${blocking}\n· ${noted}\n✗ Not ready: 1 reason to stop. Fix each one, then run this again.\n`,
  );
  expect(JSON.parse((await run(["release", "prod", "--check", "--json"])).text)).toEqual({
    ok: false,
    refusals: [blocking],
    notes: [noted],
  });
  expect((await run(["done", id, "--evidence", "ran it: ok"])).code).toBe(0);
  const passed = await run(["release", "prod", "--check"]);
  expect(passed.code).toBe(0);
  expect(passed.text).toBe(
    `Release check: prod\n· ${noted}\n✓ Ready: prod has no open task that holds a deploy.\n`,
  );
  expect(JSON.parse((await run(["release", "prod", "--check", "--json"])).text)).toEqual({
    ok: true,
    refusals: [],
    notes: [noted],
  });
  // Only the asked environment counts.
  await add("Staging step", "staging", "before", "blocking");
  expect((await run(["release", "prod", "--check"])).code).toBe(0);
  expect((await run(["release", "staging", "--check"])).code).toBe(1);
});

test("release --check refuses an environment outside tasks.envs", async () => {
  const { run, cwd } = world();
  mkdirSync(join(cwd, ".claude"));
  writeFileSync(
    join(cwd, ".claude", "cc-smart-dev-kit.json"),
    JSON.stringify({ requires: ">=5.0", tasks: { envs: ["staging"] } }),
  );
  const refused = await run(["release", "prod", "--check", "--json"]);
  expect(refused.code).toBe(1);
  expect(JSON.parse(refused.text)).toEqual({
    ok: false,
    refusals: ["prod is not one of this project's environments (tasks.envs: staging)"],
    notes: [],
  });
});

test("release --check is a usage error (2) with no environment, or with --before, --after or --ref", async () => {
  const { run } = world();
  const none = await run(["release", "--check"]);
  expect(none.code).toBe(2);
  expect(none.text).toBe("");
  expect(none.error).toContain("--check needs an environment: release <staging|prod> --check");
  for (const extra of [["--before"], ["--after"], ["--ref", "origin/main"]]) {
    const answer = await run(["release", "prod", "--check", ...extra]);
    expect(answer.code).toBe(2);
    expect(answer.error).toContain("--check does not take --before, --after or --ref");
  }
  expect((await run(["release", "qa", "--check"])).code).toBe(2);
});

/**
 * A world where origin's `main` holds a deploy task that the local `main` has not fetched yet:
 * the local `main` sits one commit behind. A branch cut from `origin/main` then adds its own task.
 * Returns the id of the task already on origin and the one only the branch has.
 */
async function behindOriginWorld(base = "main") {
  const w = world();
  if (base !== "main") {
    git(w.cwd, "switch", "-c", base);
    git(w.cwd, "push", "-u", "origin", base);
  }
  const onOrigin = await w.add("Already shipped", "prod", "before", "blocking");
  git(w.cwd, "add", "-A");
  git(w.cwd, "commit", "-m", "a task origin already has");
  git(w.cwd, "push", "origin", base);
  git(w.cwd, "reset", "--hard", "HEAD~1");
  git(w.cwd, "switch", "-c", "deploy-branch", `origin/${base}`);
  const onBranch = await w.add("Branch only", "staging", "after", "non-blocking");
  git(w.cwd, "add", "-A");
  git(w.cwd, "commit", "-m", "the branch task");
  return { ...w, onOrigin, onBranch };
}

test("list --branch reads origin's base for a bare name, not a local main that is behind", async () => {
  const { run, onBranch } = await behindOriginWorld();
  const expected = `staging\nadded: ${onBranch} [after · non-blocking] Branch only\n`;
  const byDefault = await run(["list", "--branch"]);
  expect(byDefault).toEqual({ code: 0, text: expected, error: "" });
  expect(await run(["list", "--branch", "--base", "main"])).toEqual({
    code: 0,
    text: expected,
    error: "",
  });
  expect(await run(["list", "--branch", "--base", "origin/main"])).toEqual({
    code: 0,
    text: expected,
    error: "",
  });
});

test("list --branches reads origin's base: a branch origin already holds is not unmerged", async () => {
  const { run, cwd, onBranch } = await behindOriginWorld();
  git(cwd, "switch", "-c", "other-branch", "origin/main");
  const other = await run([
    "add",
    "Parked",
    "--kind",
    "prod",
    "--deploy",
    "after",
    "--type",
    "non-blocking",
  ]);
  expect(other.code).toBe(0);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "another task");
  git(cwd, "switch", "main");
  const listed = await run(["list", "--branches"]);
  expect(listed.code).toBe(0);
  expect(listed.text).toContain(`deploy-branch: ${onBranch} [after · non-blocking] Branch only`);
  expect(listed.text).toContain("other-branch: ");
  // The task origin's main already holds is not "on an unmerged branch".
  expect(listed.text).not.toContain("Already shipped");
  expect(listed.text.trim().split("\n")).toHaveLength(2);
});

test("list reads origin/<base> for a project whose base is not main", async () => {
  const { run, onBranch } = await behindOriginWorld("develop");
  const listed = await run(["list", "--branch", "--base", "develop"]);
  expect(listed).toEqual({
    code: 0,
    text: `staging\nadded: ${onBranch} [after · non-blocking] Branch only\n`,
    error: "",
  });
});

test("list with no origin remote reads the local branch and says so in one line", async () => {
  const { run, add, cwd } = world({ origin: false });
  git(cwd, "switch", "-c", "deploy-branch");
  const id = await add("Seed data", "staging", "after", "non-blocking");
  const note = "No origin remote: read against the local branch main.";
  expect(await run(["list", "--branch"])).toEqual({
    code: 0,
    text: `${note}\nstaging\nadded: ${id} [after · non-blocking] Seed data\n`,
    error: "",
  });
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "the task");
  git(cwd, "switch", "main");
  expect(await run(["list", "--branches"])).toEqual({
    code: 0,
    text: `${note}\ndeploy-branch: ${id} [after · non-blocking] Seed data\n`,
    error: "",
  });
});

test("list with an origin that has no such base gives the gates' fetch hint", async () => {
  const { run } = world();
  const missing = await run(["list", "--branch", "--base", "release"]);
  expect(missing.code).toBe(1);
  expect(missing.text).toBe("");
  expect(missing.error).toContain("Cannot read origin/release (");
  expect(missing.error).toContain("run `git fetch origin`, or name the base with --base <ref>");
  const written = await run(["list", "--branch", "--base", "origin/release"]);
  expect(written.code).toBe(1);
  expect(written.error).toContain("Cannot read origin/release (");
  expect(written.error).not.toContain("origin/origin");
});
