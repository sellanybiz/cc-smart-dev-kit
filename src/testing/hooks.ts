/**
 * Helpers for the hook tests: throwaway repos, the hook's environment, and a hook run with
 * its JSON input, in this process (`handleHook`) or as Claude Code runs it (a subprocess of
 * `src/entries/<name>.ts` with the input on stdin).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HookResult } from "../hooks/io";
import { type HookSpec, handleHook } from "../hooks/run";
import { subprocessGuard } from "./port-guard";
import { cleanGitEnv, git, tempDir } from "./temp";

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
): Promise<HookResult> {
  return handleHook(spec, JSON.stringify(input), env);
}

const ENTRIES = join(import.meta.dir, "..", "entries");

/** Runs `src/entries/<name>.ts` as Claude Code would: the input on stdin. */
export function runEntry(
  name: string,
  stdin: string,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const guard = subprocessGuard();
  // `process.execPath`, never `bun`: the bun running the suite is the one the repo needs
  // (the preload refuses an older one), and PATH may hold another or none.
  const result = Bun.spawnSync([process.execPath, ...guard.args, join(ENTRIES, `${name}.ts`)], {
    env: { ...env, ...guard.env },
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
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
    JSON.stringify({ pid, sessionId: record.sessionId, cwd: record.cwd, name: record.name }),
  );
}
