/**
 * The CI path of `task release <env> --check`: a CI job fetches the built `cli.js` ALONE, runs it with Bun in a shallow, detached clone, with a clean environment, a
 * temp HOME and an empty bunfig (so the project's own `bunfig.toml` never loads). This test builds
 * the bundle the way `scripts/build.ts` does, copies that one file to a folder of its own, and
 * runs exactly that line.
 */
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { closeDeployTask, createDeployTask } from "./deploy/files";

const entries = join(import.meta.dir, "..", "entries");
const created = new Date("2026-11-18T09:00:00Z");

/** Builds `src/entries/cli.ts` as `scripts/build.ts` does (target bun, ESM, not minified). */
async function buildCli(outdir: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(entries, "cli.ts")],
    outdir,
    root: entries,
    target: "bun",
    format: "esm",
    minify: false,
    naming: "[name].js",
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  return join(outdir, "cli.js");
}

test("cli.js alone, in a shallow detached clone: --check exits 1 on a blocking task and 0 once closed", async () => {
  // The kit as a CI job has it: one file, and an empty bunfig beside it.
  const built = await buildCli(tempDir("ci-build"));
  const kit = tempDir("ci-kit");
  copyFileSync(built, join(kit, "kit.js"));
  writeFileSync(join(kit, "bunfig.toml"), "");
  expect(readdirSync(kit).sort()).toEqual(["bunfig.toml", "kit.js"]);

  // The project's side: a repo whose main branch holds a blocking prod task, and a shallow clone.
  const source = realpathSync(tempDir("ci-source"));
  git(source, "init", "-b", "main");
  const task = createDeployTask(
    join(source, ".claude", "tasks"),
    { title: "Run the migration", env: "prod", deploy: "before", type: "blocking" },
    { now: created },
  );
  // A bunfig of the project's own must not load: this one would fail the run if it did.
  writeFileSync(join(source, "bunfig.toml"), 'preload = ["./missing-preload.ts"]\n');
  git(source, "add", "-A");
  git(source, "commit", "-m", "task");
  const clone = join(tempDir("ci-clone"), "work");
  mkdirSync(dirname(clone), { recursive: true });
  git(dirname(clone), "clone", "--depth", "1", `file://${source}`, clone);
  git(clone, "checkout", "--detach");
  expect(git(clone, "rev-parse", "--is-shallow-repository").trim()).toBe("true");
  expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("HEAD");

  const guard = subprocessGuard();
  const home = tempDir("ci-home");
  const env: Record<string, string> = {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(process.execPath)}:${dirname(Bun.which("git") ?? "/usr/bin/git")}`,
  };
  async function check(...extra: string[]) {
    const child = Bun.spawn(
      [
        process.execPath,
        ...guard.args,
        "--no-env-file",
        `--config=${join(kit, "bunfig.toml")}`,
        join(kit, "kit.js"),
        "task",
        "release",
        "prod",
        "--check",
        ...extra,
      ],
      { cwd: clone, env, stdout: "pipe", stderr: "pipe" },
    );
    return {
      code: await child.exited,
      text: await new Response(child.stdout).text(),
      error: await new Response(child.stderr).text(),
    };
  }

  const refused = await check("--json");
  expect(refused.error).toBe("");
  expect(refused.code).toBe(1);
  expect(JSON.parse(refused.text)).toEqual({
    ok: false,
    refusals: [
      `Blocking task is open: ${task.id} "Run the migration": do it, then close it with evidence`,
    ],
    notes: [],
  });

  closeDeployTask(
    join(clone, ".claude", "tasks"),
    task.id,
    { status: "done", evidence: "ran it: ok" },
    created,
  );
  const passed = await check("--json");
  expect(passed.error).toBe("");
  expect(passed.code).toBe(0);
  expect(JSON.parse(passed.text)).toEqual({ ok: true, refusals: [], notes: [] });
  // The text form, for a CI log.
  const log = await check();
  expect(log.code).toBe(0);
  expect(log.text).toContain("Ready: prod has no open task that holds a deploy.");
}, 120_000);
