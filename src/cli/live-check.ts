/**
 * `anymodel doctor --live`: proves, on the Claude Code installed here, the hook behaviour
 * the plugin relies on (`docs/claude-code-contract.md`). It never runs by default: it
 * starts real Claude Code sessions, which use the person's login and cost a few cents.
 *
 * In a temp folder it makes two throwaway repos: one without anymodel.json (Claude Code's
 * default shape) and one with `worktrees` in it, cloned from a local bare "origin". In each
 * it runs one `claude -p` session with this plugin (`--plugin-dir`), only the EnterWorktree
 * and ExitWorktree tools, and a tiny prompt: enter a worktree, then leave it with "remove".
 * Every hook run is logged (`ANYMODEL_HOOK_LOG`), and the check reads that log and git:
 *
 * - the hooks fired: SessionStart, WorktreeCreate and WorktreeRemove;
 * - WorktreeCreate made the right shape (folder and branch);
 * - WorktreeRemove removed the folder and the branch.
 *
 * When every check passes, the Claude Code version is recorded in the state folder
 * (`live-check.json`); plain `doctor` then shows it. The temp folder is removed at the end.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VERSION } from "../build-info";
import { HOOK_LOG_ENV } from "../hooks/run";
import { atomicWrite } from "../setup/write";
import type { CliPaths } from "./paths";

/** The worktree name the live sessions ask for. */
export const LIVE_NAME = "anymodel-live-check";
/** The prefix of the configured repo's worktrees. */
const LIVE_PREFIX = "live-wt-";
/** One live session may take this long. */
const SESSION_TIMEOUT_MS = 240_000;

export interface LiveRecord {
  claudeCode: string;
  plugin: string;
  passedAt: string;
}

export interface LiveCheckLine {
  ok: boolean;
  text: string;
}

export type LiveRunner = (
  argv: string[],
  options: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number },
) => { exitCode: number; output: string };

export interface LiveDeps {
  /** The plugin folder to load: the one holding this CLI's `dist/`. */
  pluginDir: string;
  /** Runs `claude` (and git, to set up the repos). */
  run: LiveRunner;
}

export function liveRecordFile(stateDir: string): string {
  return join(stateDir, "live-check.json");
}

export function readLiveRecord(stateDir: string): LiveRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(liveRecordFile(stateDir), "utf8"),
    ) as Partial<LiveRecord>;
    return typeof parsed.claudeCode === "string" &&
      typeof parsed.plugin === "string" &&
      typeof parsed.passedAt === "string"
      ? { claudeCode: parsed.claudeCode, plugin: parsed.plugin, passedAt: parsed.passedAt }
      : null;
  } catch {
    return null;
  }
}

/** `2.1.300 (Claude Code)` → `2.1.300`; null when it says no version. */
export function parseClaudeVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

/**
 * The prompt each live session gets: two tool calls, nothing else. `discard_changes`:
 * Claude Code cannot check a hook-made worktree outside the repo, and refuses "remove"
 * without it (seen live); the plugin's WorktreeRemove is then the check, and the worktree
 * here holds no work.
 */
export const LIVE_PROMPT =
  `Call the EnterWorktree tool with name "${LIVE_NAME}". Then call the ExitWorktree tool ` +
  'with action "remove" and discard_changes true. Then reply with the single word done. ' +
  "Do nothing else.";

interface LoggedRun {
  hook: string;
  event: string | null;
  exitCode: number;
  stdout: string;
}

function readLog(file: string): LoggedRun[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LoggedRun];
      } catch {
        return [];
      }
    });
}

const GIT_ID = {
  GIT_AUTHOR_NAME: "anymodel live check",
  GIT_AUTHOR_EMAIL: "live-check@example.com",
  GIT_COMMITTER_NAME: "anymodel live check",
  GIT_COMMITTER_EMAIL: "live-check@example.com",
};

/** One throwaway session in `repo`, and what it proved. */
function proveIn(
  label: string,
  repo: string,
  expected: { folder: string; branch: string },
  deps: LiveDeps,
  env: Record<string, string | undefined>,
): LiveCheckLine[] {
  const log = join(dirname(repo), `${label}-hooks.log`);
  const session = deps.run(
    [
      "claude",
      "-p",
      "--plugin-dir",
      deps.pluginDir,
      "--permission-mode",
      "bypassPermissions",
      "--tools",
      "EnterWorktree,ExitWorktree",
      "--strict-mcp-config",
      "--no-session-persistence",
      LIVE_PROMPT,
    ],
    { cwd: repo, env: { ...env, [HOOK_LOG_ENV]: log }, timeoutMs: SESSION_TIMEOUT_MS },
  );
  const runs = readLog(log);
  const fired = (event: string) => runs.some((run) => run.event === event);
  const created = runs.find((run) => run.event === "WorktreeCreate" && run.exitCode === 0);
  const removed = runs.find((run) => run.event === "WorktreeRemove");
  const branchLeft = deps.run(
    ["git", "rev-parse", "--verify", "--quiet", `refs/heads/${expected.branch}`],
    {
      cwd: repo,
      env,
      timeoutMs: 10_000,
    },
  );
  const lines: LiveCheckLine[] = [];
  const events = ["SessionStart", "WorktreeCreate", "WorktreeRemove"];
  const missing = events.filter((event) => !fired(event));
  lines.push(
    missing.length === 0
      ? { ok: true, text: `${label}: the plugin's hooks fired (${events.join(", ")})` }
      : {
          ok: false,
          text: `${label}: no ${missing.join(", ")} hook ran. claude exited ${session.exitCode}: ${session.output.trim().split("\n").slice(-3).join(" ")}`,
        },
  );
  lines.push(
    created?.stdout === expected.folder
      ? { ok: true, text: `${label}: WorktreeCreate made ${expected.folder}` }
      : {
          ok: false,
          text: `${label}: WorktreeCreate gave ${created?.stdout || "no folder"}, expected ${expected.folder}`,
        },
  );
  const gone = !existsSync(expected.folder) && branchLeft.exitCode !== 0;
  lines.push(
    gone && removed?.exitCode === 0
      ? {
          ok: true,
          text: `${label}: WorktreeRemove removed the folder and the branch ${expected.branch}`,
        }
      : {
          ok: false,
          text: `${label}: after WorktreeRemove (${removed === undefined ? "did not run" : `exit ${removed.exitCode}`}) ${existsSync(expected.folder) ? "the folder is still there" : "the folder is gone"}, ${branchLeft.exitCode === 0 ? `the branch ${expected.branch} is still there` : "the branch is gone"}`,
        },
  );
  return lines;
}

/**
 * Runs the live check. Returns its lines; records the Claude Code version in the state
 * folder when every line passed.
 */
export function runLiveCheck(
  paths: CliPaths,
  env: Record<string, string | undefined>,
  deps: LiveDeps,
): LiveCheckLine[] {
  const version = parseClaudeVersion(
    deps.run(["claude", "--version"], { cwd: tmpdir(), env, timeoutMs: 20_000 }).output,
  );
  if (version === null) {
    return [
      { ok: false, text: "live: `claude --version` gave no version: is Claude Code installed?" },
    ];
  }
  // The real path: a hook prints real paths (macOS puts the temp folder behind a link).
  const root = realpathSync(mkdtempSync(join(tmpdir(), "anymodel-live-")));
  try {
    const gitEnv = { ...env, ...GIT_ID };
    const git = (cwd: string, ...args: string[]) => {
      const result = deps.run(["git", ...args], { cwd, env: gitEnv, timeoutMs: 20_000 });
      if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.output}`);
    };
    // Without anymodel.json: Claude Code's default shape.
    const plain = join(root, "plain");
    mkdirSync(plain);
    git(plain, "init", "-q", "-b", "main");
    writeFileSync(join(plain, "README.md"), "live check\n");
    git(plain, "add", "README.md");
    git(plain, "commit", "-q", "-m", "first");
    // With anymodel.json: beside the repo, from origin/main.
    const origin = join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    const configured = join(root, "configured");
    git(root, "clone", "-q", origin, configured);
    writeFileSync(join(configured, "README.md"), "live check\n");
    mkdirSync(join(configured, ".claude"));
    writeFileSync(
      join(configured, ".claude", "anymodel.json"),
      `${JSON.stringify({ worktrees: { base: "main", prefix: LIVE_PREFIX } })}\n`,
    );
    git(configured, "add", "README.md", ".claude/anymodel.json");
    git(configured, "commit", "-q", "-m", "first");
    git(configured, "push", "-q", "origin", "main");

    const lines = [
      ...proveIn(
        "without anymodel.json",
        plain,
        {
          folder: join(plain, ".claude", "worktrees", LIVE_NAME),
          branch: `worktree-${LIVE_NAME}`,
        },
        deps,
        env,
      ),
      ...proveIn(
        "with anymodel.json",
        configured,
        { folder: join(root, `${LIVE_PREFIX}${LIVE_NAME}`), branch: LIVE_NAME },
        deps,
        env,
      ),
    ].map((line) => ({ ...line, text: `live, ${line.text}` }));
    if (lines.every((line) => line.ok)) {
      mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
      const record: LiveRecord = {
        claudeCode: version,
        plugin: VERSION,
        passedAt: new Date().toISOString(),
      };
      atomicWrite(liveRecordFile(paths.stateDir), `${JSON.stringify(record, null, 2)}\n`, 0o600);
      lines.push({ ok: true, text: `live: passed on Claude Code ${version}; recorded` });
    }
    return lines;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
