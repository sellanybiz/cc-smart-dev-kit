/**
 * Helpers for the hook tests: throwaway repos, the hook's environment, and a hook run with
 * its JSON input, in this process (`handleHook`) or as Claude Code runs it (a subprocess of
 * `src/entries/<name>.ts` with the input on stdin).
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import type { DetachedOptions } from "../hooks/detached";
import type { HookResult } from "../hooks/io";
import { type DetachedStarter, type HookSpec, handleHook } from "../hooks/run";
import { bunConfigArg, pluginFolderBeside } from "../setup/bun-config";
import { subprocessGuard } from "./port-guard";
import { sessionProcessIdentity } from "./session-record";
import { cleanGitEnv, git, tempDir } from "./temp";

/**
 * `env` with a fake `git` first on PATH that waits on the calls whose arguments start with `on`
 * (an empty string: every call) and runs the real git for the rest. `wait` is the shell line it
 * runs first: `exec sleep 30` hangs for good (`exec` replaces the shell, so a timeout kills the
 * sleep itself), `sleep 0.7` is slow and then answers.
 *
 * POSIX only: the fake is an extensionless `#!/bin/sh` file, which Windows does not run as
 * `git`. A test that uses it is `skipIf(process.platform === "win32")`.
 */
export function slowGitEnv(
  env: Record<string, string>,
  on: string,
  wait: string,
): Record<string, string> {
  const real = Bun.which("git");
  if (real === null) throw new Error("this test needs git");
  const bin = tempDir("slow-git");
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase "$*" in\n  "${on}"*) ${wait} ;;\nesac\nexec '${real}' "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  return { ...env, PATH: `${bin}${delimiter}${env.PATH ?? ""}` };
}

/** A repo with one commit on `branch`, in a new temp folder: `<temp>/<name>`. */
export function makeRepo(name = "app", branch = "main"): string {
  const repo = join(tempDir("hook-repo"), name);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", branch);
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-q", "-m", "first");
  return repo;
}

/**
 * A bare "origin" with one commit on `main`, and a clone of it, in a new temp folder:
 * `<temp>/origin.git` and `<temp>/<name>`. `origin/HEAD` points at `origin/main`.
 */
export function makeClone(name = "app"): { origin: string; repo: string } {
  const root = tempDir("hook-clone");
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, "README.md"), "hello\n");
  git(seed, "add", "README.md");
  git(seed, "commit", "-q", "-m", "first");
  git(seed, "push", "-q", origin, "main");
  const repo = join(root, name);
  git(root, "clone", "-q", origin, repo);
  return { origin, repo };
}

/** Writes JSON to `<folder>/.claude/<file>`. */
export function writeClaudeFile(folder: string, file: string, value: unknown): string {
  mkdirSync(join(folder, ".claude"), { recursive: true });
  const path = join(folder, ".claude", file);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

/** A settings file that wires one hook of the project's own for `event` (and `matcher`). */
export function wireProjectHook(
  folder: string,
  event: string,
  matcher?: string,
  file = "settings.json",
): string {
  return writeClaudeFile(folder, file, {
    hooks: {
      [event]: [
        {
          ...(matcher === undefined ? {} : { matcher }),
          hooks: [{ type: "command", command: "true" }],
        },
      ],
    },
  });
}

/**
 * The environment a hook runs with in a test: no outside git, and HOME, the Claude config
 * folder and the temp folder all inside a fresh temp folder.
 */
export function hookEnv(): Record<string, string> {
  const home = tempDir("hook-home");
  const tmp = join(home, "tmp");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(tmp);
  const env: Record<string, string> = {
    ...cleanGitEnv(),
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    TMPDIR: tmp,
  };
  // `cleanGitEnv` drops the running session's own variables, so the suite tests the same
  // machine in a session as in CI; a test that wants one (a background session, SSH, a
  // desktop) sets it on the env it passes.
  return env;
}

/** Runs a hook in this process on `input`, the way its entry does. */
export function runHook(
  spec: HookSpec,
  input: Record<string, unknown>,
  env: Record<string, string>,
  start: DetachedStarter = noBackground,
): Promise<HookResult> {
  return handleHook(spec, JSON.stringify(input), env, Date.now(), start);
}

/**
 * The starter a hook test gets unless it hands in its own recorder: it starts nothing. A hook
 * that starts a background program (the worktree clean, `src/worktrees/auto-start.ts`) must
 * never launch a real process from a test that is about something else.
 */
const noBackground: DetachedStarter = () => undefined;

const ENTRIES = join(import.meta.dir, "..", "entries");

/** What a hook run as a subprocess leaves: its exit code and what it printed. */
export interface EntryRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `src/entries/<name>.ts` as Claude Code would: the input on stdin. */
export function runEntry(name: string, stdin: string, env: Record<string, string>): EntryRun {
  return runBundle(join(ENTRIES, `${name}.ts`), stdin, env);
}

/**
 * Runs one script as Claude Code runs a hook: a bun subprocess with the input on stdin, and
 * the two flags the shim `plugin/bin/cc-smart-dev-kit-bun.sh` gives every hook run
 * (`--no-env-file`, and `--config=` the plugin's own empty `bunfig.toml`, spelled by
 * `bunConfigArg`). So the script neither loads the working folder's `.env` files nor reads
 * its `bunfig.toml`, as in production. The script is a source entry (`runEntry`) or a built
 * bundle, the file Claude Code really runs.
 */
export function runBundle(file: string, stdin: string, env: Record<string, string>): EntryRun {
  const guard = subprocessGuard();
  // `process.execPath`, never `bun`: the bun running the suite is the one the repo needs
  // (the preload refuses an older one), and PATH may hold another or none.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--no-env-file",
      bunConfigArg(pluginFolderBeside(import.meta.dir)),
      ...guard.args,
      file,
    ],
    {
      env: { ...env, ...guard.env },
      stdin: Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** A live-session record, as Claude Code writes one, for a running process (this test's). */
export function writeSessionRecord(
  env: Record<string, string>,
  record: { sessionId: string; cwd: string; name: string; pid?: number },
): void {
  const dir = join(env.CLAUDE_CONFIG_DIR ?? "", "sessions");
  mkdirSync(dir, { recursive: true });
  const pid = record.pid ?? process.pid;
  writeFileSync(
    join(dir, `${pid}.json`),
    JSON.stringify({ ...record, pid, ...sessionProcessIdentity(pid) }),
  );
}

/** One background program a hook asked to start. */
export interface StartedProgram {
  argv: string[];
  options: DetachedOptions;
  platform: NodeJS.Platform;
}

/**
 * A starter that records what a hook asked to start and starts nothing: the test asserts the
 * spawn was asked for, and that nothing ran in the hook's own process.
 */
export function recordingStarter(): { start: DetachedStarter; started: StartedProgram[] } {
  const started: StartedProgram[] = [];
  return {
    started,
    start: (platform, argv, options) => {
      started.push({ argv, options, platform });
    },
  };
}

/**
 * Commits the project's file in `repo` and points `origin/<branch>` at that commit for every
 * branch named: the policy a guard judges with is the one committed on a base
 * (`resolveGate`), never the working copy. A plain ref, no fetch: the guards fetch nothing.
 */
export function commitConfig(repo: string, config: unknown, branches: Iterable<string>): void {
  writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
  git(repo, "add", ".claude/cc-smart-dev-kit.json");
  git(repo, "commit", "-q", "-m", "the project's policy");
  for (const branch of branches) git(repo, "update-ref", `refs/remotes/origin/${branch}`, "HEAD");
}

/** Writes the person's own workflow settings (`workflow.json`) where the hook `env` reads them. */
export function writePersonalWorkflow(env: Record<string, string>, workflow: unknown): void {
  const file = cliPaths(env).workflowConfigFile;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`);
}
