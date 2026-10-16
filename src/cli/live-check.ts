/**
 * `cc-smart-dev-kit doctor --live`: proves, on the Claude Code installed here, the hook behaviour
 * the plugin relies on (`docs/claude-code-contract.md`). It never runs by default: it
 * starts real Claude Code sessions, which use the person's login and cost a few cents.
 *
 * In a temp folder it makes two throwaway repos: one without cc-smart-dev-kit.json, where Claude
 * Code makes its own worktrees, and one that turned the worktree engine on (`worktrees` in
 * cc-smart-dev-kit.json, and the three `cc-smart-dev-kit hook` lines in its `.claude/settings.json`, exactly
 * as the README says, each running **the plugin being checked**: this CLI's own
 * `plugin/dist/cli.js` with the bun running it, never the installed launcher). It clones the
 * second from a local bare "origin". In each it runs one `claude -p` session with this
 * plugin (`--plugin-dir`), only the EnterWorktree, ExitWorktree and Bash tools, permission
 * for exactly those calls (no permission mode that skips the checks), and a tiny prompt:
 * enter a worktree, run `git status` there, leave it with "remove". Every hook run is logged
 * (`CC_SMART_DEV_KIT_HOOK_LOG`), with what the hook's own parser read (`logFacts`), and the check
 * reads that log and git:
 *
 * - the plugin's hooks fired: SessionStart, and the git guard before the Bash call;
 * - the git guard read the command (its log names the programs it parsed: `git`);
 * - without cc-smart-dev-kit.json: no WorktreeCreate hook ran, Claude Code made its own worktree,
 *   and the session worked in it (the git guard's `cwd`); ExitWorktree removed it;
 * - with the engine: its WorktreeCreate made the configured folder, through the plugin under
 *   test, and the session worked there; its WorktreeRemove removed the folder and the branch.
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
import { projectHookSettings } from "../hooks/project-wiring";
import { HOOK_LOG_ENV } from "../hooks/run";
import { shellQuote } from "../setup/launcher";
import { atomicWrite } from "../setup/write";
import type { CliPaths } from "./paths";

/** The worktree name the live sessions ask for. */
export const LIVE_NAME = "cc-smart-dev-kit-live-check";
/** The prefix of the configured repo's worktrees. */
const LIVE_PREFIX = "live-wt-";
/** One live session may take this long. */
const SESSION_TIMEOUT_MS = 240_000;
/** The only tools a live session has. */
export const LIVE_TOOLS = "EnterWorktree,ExitWorktree,Bash";
/** The calls a live session may make without asking: nothing else runs. */
export const LIVE_ALLOWED = "EnterWorktree,ExitWorktree,Bash(git status:*)";

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
  /**
   * How each project hook runs in the temp repo. The plugin under test, never the installed
   * launcher `~/.local/bin/cc-smart-dev-kit`: a live check proves this plugin, whatever version is
   * installed (`liveHookCommand`).
   */
  hookCommand: (name: string) => string;
  /** Runs `claude` (and git, to set up the repos). */
  run: LiveRunner;
}

/**
 * How a project's hooks run in the live check: the plugin folder this CLI belongs to, its
 * `dist/cli.js` run with `bunPath` (the bun running this CLI). The launcher is not used: it
 * always runs the *installed* version, which is not what `doctor --live` checks.
 *
 * `--no-env-file`, like every other run of this plugin's own bundles: a hook sees the
 * environment it was given, never the working folder's `.env` files.
 */
export function liveHookCommand(pluginDir: string, bunPath: string): (name: string) => string {
  const command = `${shellQuote(bunPath)} --no-env-file ${shellQuote(join(pluginDir, "dist", "cli.js"))}`;
  return (name) => `${command} hook ${name}`;
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
 * The prompt each live session gets: three tool calls, nothing else. `discard_changes`:
 * Claude Code cannot check a hook-made worktree outside the repo, and refuses "remove"
 * without it (seen live); the engine's WorktreeRemove is then the check, and the worktree
 * here holds no work.
 */
export const LIVE_PROMPT =
  `Call the EnterWorktree tool with name "${LIVE_NAME}". Then run the Bash command ` +
  '`git status`. Then call the ExitWorktree tool with action "remove" and discard_changes ' +
  "true. Then reply with the single word done. Do nothing else.";

interface LoggedRun {
  hook: string;
  event: string | null;
  cwd: string | null;
  exitCode: number;
  stdout: string;
  /** What the hook's own parser read (its spec's `logFacts`): the git guard's programs. */
  facts?: { programs?: string[] };
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
  GIT_AUTHOR_NAME: "cc-smart-dev-kit live check",
  GIT_AUTHOR_EMAIL: "live-check@example.com",
  GIT_COMMITTER_NAME: "cc-smart-dev-kit live check",
  GIT_COMMITTER_EMAIL: "live-check@example.com",
};

interface Expected {
  /** Who makes the worktree: Claude Code itself, or the engine the project wired. */
  maker: "claude-code" | "engine";
  folder: string;
  branch: string;
}

/** One throwaway session in `repo`, and what it proved. */
function proveIn(
  label: string,
  repo: string,
  expected: Expected,
  deps: LiveDeps,
  env: Record<string, string | undefined>,
): LiveCheckLine[] {
  const log = join(dirname(repo), `${label.replace(/[^a-z]+/gi, "-")}-hooks.log`);
  const session = deps.run(
    [
      "claude",
      "-p",
      "--plugin-dir",
      deps.pluginDir,
      "--tools",
      LIVE_TOOLS,
      "--allowedTools",
      LIVE_ALLOWED,
      "--strict-mcp-config",
      "--no-session-persistence",
      LIVE_PROMPT,
    ],
    { cwd: repo, env: { ...env, [HOOK_LOG_ENV]: log }, timeoutMs: SESSION_TIMEOUT_MS },
  );
  const runs = readLog(log);
  const said = `claude exited ${session.exitCode}: ${session.output.trim().split("\n").slice(-3).join(" ")}`;
  const fired = (event: string) => runs.some((run) => run.event === event);
  const created = runs.find((run) => run.event === "WorktreeCreate");
  const removed = runs.find((run) => run.event === "WorktreeRemove");
  const guarded = runs.filter((run) => run.hook === "git-guard" && run.event === "PreToolUse");
  const guardedThere = guarded.some((run) => run.cwd === expected.folder);
  // Firing is not answering: the guard logs the programs its own parser read in the command.
  const guardParsed = guarded.some((run) => run.facts?.programs?.includes("git") === true);
  const branchLeft = deps.run(
    ["git", "rev-parse", "--verify", "--quiet", `refs/heads/${expected.branch}`],
    { cwd: repo, env, timeoutMs: 10_000 },
  );

  const lines: LiveCheckLine[] = [];
  const events =
    expected.maker === "engine"
      ? ["SessionStart", "WorktreeCreate", "PreToolUse", "WorktreeRemove"]
      : ["SessionStart", "PreToolUse"];
  const missing = events.filter((event) => !fired(event));
  lines.push(
    missing.length === 0
      ? { ok: true, text: `${label}: the hooks fired (${events.join(", ")})` }
      : { ok: false, text: `${label}: no ${missing.join(", ")} hook ran. ${said}` },
  );

  const where = guarded.length === 0 ? "no Bash call" : guarded.map((run) => run.cwd).join(", ");
  lines.push(
    guardParsed
      ? {
          ok: true,
          text: `${label}: the git guard read the command line (it parsed git) before the Bash call`,
        }
      : {
          ok: false,
          text: `${label}: the git guard ${guarded.length === 0 ? "never ran" : `ran in ${where} without parsing a command`}: its log names no git program. ${said}`,
        },
  );
  if (expected.maker === "engine") {
    lines.push(
      created?.exitCode === 0 && created.stdout === expected.folder && guardedThere
        ? {
            ok: true,
            text: `${label}: WorktreeCreate made ${expected.folder}, and the session worked there`,
          }
        : {
            ok: false,
            text: `${label}: WorktreeCreate gave ${created?.stdout || `no folder (exit ${created?.exitCode ?? "none"})`}, the git guard ran in ${where}; expected ${expected.folder}`,
          },
    );
  } else {
    lines.push(
      created === undefined && guardedThere
        ? {
            ok: true,
            text: `${label}: no WorktreeCreate hook ran; Claude Code made ${expected.folder}, and the session worked there`,
          }
        : {
            ok: false,
            text: `${label}: ${created === undefined ? "" : "a WorktreeCreate hook ran; "}the git guard ran in ${where}; expected Claude Code's own ${expected.folder}`,
          },
    );
  }

  const gone = !existsSync(expected.folder) && branchLeft.exitCode !== 0;
  const remover = expected.maker === "engine" ? "WorktreeRemove" : "ExitWorktree";
  // Claude Code's own removal runs no hook: the worktree must have been there (the session
  // worked in it), or "gone" proves nothing.
  const removerOk = expected.maker === "engine" ? removed?.exitCode === 0 : guardedThere;
  lines.push(
    gone && removerOk
      ? {
          ok: true,
          text: `${label}: ${remover} removed the folder and the branch ${expected.branch}`,
        }
      : {
          ok: false,
          text: `${label}: after ${remover}${expected.maker === "engine" ? ` (${removed === undefined ? "did not run" : `exit ${removed.exitCode}`})` : guardedThere ? "" : " (the session never worked in it)"} ${existsSync(expected.folder) ? "the folder is still there" : "the folder is gone"}, ${branchLeft.exitCode === 0 ? `the branch ${expected.branch} is still there` : "the branch is gone"}`,
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cc-smart-dev-kit-live-")));
  try {
    const gitEnv = { ...env, ...GIT_ID };
    const git = (cwd: string, ...args: string[]) => {
      const result = deps.run(["git", ...args], { cwd, env: gitEnv, timeoutMs: 20_000 });
      if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.output}`);
    };
    // Without cc-smart-dev-kit.json: Claude Code's own worktrees.
    const plain = join(root, "plain");
    mkdirSync(plain);
    git(plain, "init", "-q", "-b", "main");
    writeFileSync(join(plain, "README.md"), "live check\n");
    git(plain, "add", "README.md");
    git(plain, "commit", "-q", "-m", "first");
    // The worktree engine turned on, as the README says: beside the repo, from origin/main.
    const origin = join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    const configured = join(root, "configured");
    git(root, "clone", "-q", origin, configured);
    writeFileSync(join(configured, "README.md"), "live check\n");
    mkdirSync(join(configured, ".claude"));
    writeFileSync(
      join(configured, ".claude", "cc-smart-dev-kit.json"),
      `${JSON.stringify({ worktrees: { base: "main", prefix: LIVE_PREFIX } })}\n`,
    );
    writeFileSync(
      join(configured, ".claude", "settings.json"),
      `${JSON.stringify(projectHookSettings(deps.hookCommand), null, 2)}\n`,
    );
    git(configured, "add", "README.md", ".claude/cc-smart-dev-kit.json", ".claude/settings.json");
    git(configured, "commit", "-q", "-m", "first");
    git(configured, "push", "-q", "origin", "main");

    const lines = [
      ...proveIn(
        "Claude Code's worktrees",
        plain,
        {
          maker: "claude-code",
          folder: join(plain, ".claude", "worktrees", LIVE_NAME),
          branch: `worktree-${LIVE_NAME}`,
        },
        deps,
        env,
      ),
      ...proveIn(
        "the worktree engine",
        configured,
        {
          maker: "engine",
          folder: join(root, `${LIVE_PREFIX}${LIVE_NAME}`),
          branch: LIVE_NAME,
        },
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
