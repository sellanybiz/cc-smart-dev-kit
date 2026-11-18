/**
 * A temp world for the kit's git hooks folder (`src/jobs/hook-folder.ts`): a temp home with
 * the paths `cliPaths` gives it, a real git repo, a fake launcher that records every call and
 * answers what a test says, and git run the way a routed command runs it (the `GIT_CONFIG_*`
 * pair that points git at the kit's folder). Nothing here touches the real home or the real
 * git configuration.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { installGitHooksFolder } from "../jobs/hook-folder";
import { LAUNCHER_NAME, shellQuote } from "../setup/launcher";
import { cleanGitEnv, git, tempDir } from "./temp";

export interface GitRun {
  code: number;
  out: string;
  err: string;
}

export interface FakeLauncherAnswer {
  /** What `job hook` prints (one `printf`, so a `\n` inside it is a second line); null: nothing. */
  answer: string | null;
  /** The exit code of `job hook`. */
  exit?: number;
}

export interface GitHookWorld {
  home: string;
  paths: CliPaths;
  /** A real repo with one commit. */
  repo: string;
  /** Every call the fake launcher got, one line each (`job hook pre-commit`, `job run …`). */
  log: string;
  /** Writes the kit's folder into the temp home, as `setup` does. */
  install(): void;
  /** Writes a launcher at the path the scripts call. `job run` runs what comes after `--`. */
  fakeLauncher(answer: FakeLauncherAnswer): void;
  /** The environment of a routed git command: clean git, and the pair that names the kit's folder. */
  routedEnv(): Record<string, string>;
  /** Runs git in `cwd` with `env` (default: the routed one), never throwing. */
  run(cwd: string, args: string[], env?: Record<string, string>): GitRun;
  /** The calls the fake launcher recorded; empty when it never ran. */
  calls(): string[];
}

/** Runs `argv` in `cwd`, never throwing. */
export function runIn(
  cwd: string,
  argv: string[],
  env: Record<string, string>,
  stdin?: string,
): GitRun {
  const result = Bun.spawnSync(argv, {
    cwd,
    env,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode ?? -1,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
}

/** Writes `text` to `file` (folders made) with `mode`. */
export function writeFileIn(file: string, text: string, mode = 0o644): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
}

export function gitHookWorld(label = "git-hooks"): GitHookWorld {
  const home = tempDir(`${label}-home`);
  const paths = cliPaths({ HOME: home });
  const repo = tempDir(`${label}-repo`);
  git(repo, "init", "-q");
  git(repo, "commit", "-q", "--allow-empty", "-m", "first");
  const log = join(tempDir(`${label}-log`), "calls.log");
  const world: GitHookWorld = {
    home,
    paths,
    repo,
    log,
    install: () => {
      installGitHooksFolder(paths);
    },
    fakeLauncher: ({ answer, exit = 0 }) => {
      const hook =
        answer === null ? `exit ${exit}` : `printf '%s\\n' ${shellQuote(answer)}\n  exit ${exit}`;
      writeFileIn(
        join(paths.binDir, LAUNCHER_NAME),
        `#!/bin/sh
printf '%s\\n' "$*" >> ${shellQuote(log)}
if [ "$1" = job ] && [ "$2" = hook ]; then
  cat > /dev/null
  ${hook}
fi
if [ "$1" = job ] && [ "$2" = run ]; then
  shift 4
  [ "$1" = -- ] && shift
  exec "$@"
fi
exit 99
`,
        0o755,
      );
    },
    routedEnv: () => ({
      ...cleanGitEnv(),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: paths.gitHooksFolder,
    }),
    run: (cwd, args, env) => runIn(cwd, ["git", ...args], env ?? world.routedEnv()),
    calls: () => {
      try {
        return readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line !== "");
      } catch {
        return [];
      }
    },
  };
  return world;
}

/** Stages a new file in `repo`, so the next `git commit` has something to commit. */
export function stageFile(repo: string, name = "a.txt", text = "a\n"): void {
  writeFileIn(join(repo, name), text);
  git(repo, "add", name);
}
