import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/** A fresh temp folder (real path, no symlinks), removed after each test. */
export function tempDir(label = "test"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `cc-smart-dev-kit-${label}-`)));
  created.push(dir);
  return dir;
}

/** Removes every temp folder made so far. Runs after each test (bunfig.toml preloads setup.ts). */
export function removeTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * Variables a test never inherits from the process that runs it: the Claude session that
 * started the suite, and the desktop it is on. A hook reads them as facts about the machine (a
 * background session, an SSH terminal, a desktop), so a suite run from inside Claude Code would
 * otherwise test another machine than CI. A test that wants one sets it on its own env.
 */
const SESSION_VARIABLES: readonly string[] = [
  "CLAUDECODE",
  "TERM_PROGRAM",
  "LC_TERMINAL",
  "TMUX",
  "DISPLAY",
  "WAYLAND_DISPLAY",
];
const SESSION_PREFIXES: readonly string[] = ["ANTHROPIC_", "CLAUDE_", "SSH_", "WARP_"];

/**
 * The environment without any GIT_* variable, so git in a test never reaches a real repo; and
 * without the Claude session's own variables (`SESSION_VARIABLES`, `SESSION_PREFIXES`), so a
 * test run from a session sees the same clean machine as CI. `CLAUDE_PROJECT_DIR` goes with
 * them: a test run from a session must not read that session's project.
 */
export function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("GIT_")) continue;
    if (SESSION_VARIABLES.includes(key)) continue;
    if (SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return {
    ...env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

/** Runs git in `cwd`; throws with git's own message when it fails. */
export function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: cleanGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/**
 * The environment with a `git` first on PATH that says it is `version` (`git --version`) and
 * runs the real git for everything else: how a check for an older git is tested on a new one.
 */
export function withGitVersion(
  env: Record<string, string>,
  version: string,
): Record<string, string> {
  const dir = tempDir("old-git");
  const real = Bun.which("git") ?? "/usr/bin/git";
  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version ${version}"; exit 0; fi\nexec "${real}" "$@"\n`,
  );
  chmodSync(join(dir, "git"), 0o755);
  return { ...env, PATH: `${dir}:${env.PATH ?? ""}` };
}
