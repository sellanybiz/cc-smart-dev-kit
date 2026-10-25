/**
 * A world for the `crew` commands: a temp home and Claude config folder, a real git repo with
 * a kit config that turns crew sessions on, a process tree with a Claude Code session record at its
 * top, and a fake `claude` first on PATH that logs every call and answers like the real one
 * (`backgrounded · <id> · <name>`, `agents --json`). No test starts a real Claude session.
 *
 * The fake's answers are chosen per test through its environment:
 *   FAKE_BG       `untrusted` (Workspace not trusted), `fail` (exit 4), `noline` (no
 *                 backgrounded line); unset: it starts.
 *   FAKE_RESUME   for `--bg --resume <id>`: `copy` (the stderr note 2.1.310 prints when the
 *                 flags we pass start a copy, and `backgrounded · <SHORT_ID>`; FAKE_COPY_AS
 *                 names another id in the note only); unset: it continues under the same id,
 *                 `backgrounded · <the id's first 8>` (2.1.310 drops ` · <name>` when it has none).
 *   FAKE_AGENTS   `other` (the session works in the main checkout), `missing` (no row),
 *                 `broken` (not JSON); unset: the row names the `-w` worktree.
 *   FAKE_AGENTS_JSON  the exact JSON `agents --json` prints (the watch's own view).
 *   FAKE_STOP     `fail` (`claude stop` exits 1); unset: it stops.
 *   FAKE_PLUGINS  the exact JSON `plugin list --json` prints (the lean start's plugin list);
 *                 unset: no output, which a lean start reads as "no list", and turns nothing off.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { realRunProgram } from "../crew/claude";
import type { CrewContext } from "../crew/context";
import { sessionRecordFile } from "../crew/session";
import { locateCheckout } from "../project/resolve";
import type { CleanLock } from "../worktrees/clean";
import { cleanGitEnv, git, tempDir } from "./temp";

/** The lead session's id in every world. */
export const LEAD_SESSION = "c00f9bb5-1111-2222-3333-444444444444";

/** The second session a test registers as another lead. */
export const OTHER_SESSION = "d11fabc6-5555-6666-7777-888888888888";

/** The short id the fake `claude --bg` prints. */
export const SHORT_ID = "a1b2c3d4";

/** The pid of the session process, and of this command, in the fake process tree. */
export const SESSION_PID = 300;
export const COMMAND_PID = 500;

/**
 * How a fake `claude` answers `--bg --resume <id>`, as 2.1.310 does (`docs/claude-code-contract.md`):
 * `backgrounded · <short id>` on stdout — no ` · <name>` when it has none — and, when it started a
 * copy, a note on stderr naming the copy. FAKE_RESUME `copy`: the note the flags we pass cause
 * ("keeps its own saved options"), and the copy is `SHORT_ID` (FAKE_COPY_AS names another id in
 * the note only); unset: it continues under the same id. One home for both fakes (this one and
 * `board-world.ts`'s); it sits in the `--bg)` branch, and lets a call without `--resume` through.
 */
export const FAKE_RESUME_SH = `    resumed=""; prev=""
    for a in "$@"; do [ "$prev" = "--resume" ] && resumed="$a"; prev="$a"; done
    if [ -n "$resumed" ]; then
      old="$(printf '%s' "$resumed" | cut -c1-8)"
      case "$FAKE_RESUME" in
        copy)
          echo "note: background session $old keeps its own saved options, so the flags you passed started a copy as \${FAKE_COPY_AS:-${SHORT_ID}}. Without flags, the same command continues $old itself." >&2
          echo "backgrounded · ${SHORT_ID}"
          ;;
        *) echo "backgrounded · $old" ;;
      esac
      exit 0
    fi
`;

/** The fake `claude`: logs its argv (one argument per line, `----` after each call) and its folder. */
const FAKE_CLAUDE = `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a" >> "$FAKE_CLAUDE_LOG"; done
printf -- '----\\n' >> "$FAKE_CLAUDE_LOG"
printf '%s\\n' "$(pwd -P)" >> "$FAKE_CLAUDE_CWD_LOG"
case "$1" in
  --bg)
    case "$FAKE_BG" in
      untrusted) echo "Error: Workspace not trusted. Run claude in this folder first." >&2; exit 1 ;;
      fail) echo "something broke" >&2; exit 4 ;;
      noline) echo "started something"; exit 0 ;;
    esac
${FAKE_RESUME_SH}    prev=""; tree=""; name=""
    for a in "$@"; do
      [ "$prev" = "-w" ] && tree="$a"
      [ "$prev" = "--name" ] && name="$a"
      prev="$a"
    done
    printf '%s' "$(pwd -P)/.claude/worktrees/$tree" > "$FAKE_CLAUDE_STATE"
    echo "Warning: --session-id is ignored with --bg" >&2
    echo "backgrounded · ${SHORT_ID} · $name"
    ;;
  agents)
    if [ -n "$FAKE_AGENTS_JSON" ]; then printf '%s\\n' "$FAKE_AGENTS_JSON"; exit 0; fi
    case "$FAKE_AGENTS" in
      missing) echo "[]"; exit 0 ;;
      broken) echo "not json"; exit 0 ;;
      other) cwd="$(pwd -P)" ;;
      *) read -r cwd < "$FAKE_CLAUDE_STATE" ;;
    esac
    printf '[{"id":"${SHORT_ID}","sessionId":"${SHORT_ID}-0000-1111-2222-333333333333","cwd":"%s","kind":"background","state":"working","pid":4242}]\\n' "$cwd"
    ;;
  plugin)
    if [ -n "$FAKE_PLUGINS" ]; then printf '%s\\n' "$FAKE_PLUGINS"; fi
    exit 0
    ;;
  stop)
    if [ "$FAKE_STOP" = fail ]; then echo "no such session" >&2; exit 1; fi
    exit 0
    ;;
esac
`;

export interface CrewWorld {
  home: string;
  paths: CliPaths;
  /** The main checkout (a real path). */
  repo: string;
  /** The folder of the fake `claude`. */
  bin: string;
  /** Every call the fake `claude` got, each as its argv. */
  claudeCalls: () => string[][];
  /** The folder each call ran in, in order: a resume runs in the crew session's worktree. */
  cwdCalls: () => string[];
  /**
   * The world's own clean lock (`CrewContext.holdCleanLock`): never the machine's, which another
   * suite or the person's clean may hold at that moment. `held` is true while a test holds it.
   */
  cleanLock: { held: boolean; hold: () => Promise<null | CleanLock> };
  /** What the commands printed, and wrote to stderr. */
  out: string[];
  err: string[];
  /** A context for a command, with `change` over the world's defaults. */
  ctx: (change?: Partial<CrewContext>, env?: Record<string, string>) => CrewContext;
  /** The kit config the repo gets (`workflow.crew` over `enabled: true`). */
  writeConfig: (crew: Record<string, unknown>) => void;
}

/** A Claude Code session record for `pid`, as Claude Code writes it. */
export function writeSessionRecord(
  paths: CliPaths,
  pid: number,
  sessionId: string,
  cwd: string,
): void {
  const file = sessionRecordFile(paths.claudeConfigDir, pid);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ cwd, jobId: sessionId.slice(0, 8), kind: "bg", name: "lead", pid, sessionId }),
  );
}

/** Builds the world: the repo on `main` with one commit, crew sessions on, the session at pid 300. */
export function crewWorld(): CrewWorld {
  const home = tempDir("home");
  const paths = cliPaths({ HOME: home });
  let repo = join(tempDir("parent"), "my-app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  // The repo as every command finds it (`locateCheckout` resolves the real path): a Windows
  // temp folder may be named with an 8.3 short name (`C:\Users\SHORTN~1\…`), and git reports
  // the long one.
  repo = locateCheckout(repo, { env: cleanGitEnv() })?.root ?? repo;
  writeFileSync(join(repo, "README.md"), "app\n");
  writeFileSync(join(repo, ".gitignore"), ".claude/worktrees/\n.env.local\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  const bin = tempDir("bin");
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);
  const log = join(bin, "calls.log");
  writeFileSync(log, "");
  const cwdLog = join(bin, "cwd.log");
  writeFileSync(cwdLog, "");
  const gitDir = dirname(Bun.which("git") ?? "/usr/bin/git");
  const out: string[] = [];
  const err: string[] = [];
  const cleanLock: CrewWorld["cleanLock"] = {
    held: false,
    hold: () => {
      if (cleanLock.held) return Promise.resolve(null);
      cleanLock.held = true;
      return Promise.resolve({
        close: () => {
          cleanLock.held = false;
        },
      });
    },
  };
  writeSessionRecord(paths, SESSION_PID, LEAD_SESSION, repo);
  const writeConfig = (crew: Record<string, unknown>): void => {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "cc-smart-dev-kit.json"),
      JSON.stringify({ workflow: { crew: { enabled: true, ...crew } } }),
    );
  };
  writeConfig({});
  const ctx = (change: Partial<CrewContext> = {}, env: Record<string, string> = {}) => {
    const fullEnv = {
      ...cleanGitEnv(),
      FAKE_CLAUDE_CWD_LOG: cwdLog,
      FAKE_CLAUDE_LOG: log,
      FAKE_CLAUDE_STATE: join(bin, "state"),
      HOME: home,
      // The platform's own separator: `:` splits a PATH on macOS and Linux, `;` on Windows.
      PATH: `${bin}${delimiter}${gitDir}`,
      // The host's key never reaches a test's launch: an empty value is "no key" to
      // `readTavilyKey`, so the world's crew sessions keep no Tavily server unless a test says so.
      TAVILY_API_KEY: "",
      ...env,
    };
    return {
      cwd: repo,
      env: fullEnv,
      error: (line: string) => err.push(line),
      freeMemoryGb: () => Promise.resolve(64),
      holdCleanLock: cleanLock.hold,
      now: () => Date.parse("2026-10-21T10:00:00.000Z"),
      paths,
      pid: COMMAND_PID,
      platform: "linux" as const,
      print: (line: string) => out.push(line),
      processes: {
        commandLineOf: (pid: number) => (pid === SESSION_PID ? "claude --bg" : null),
        parentOf: (pid: number) => ({ 300: 1, 400: 300, 500: 400 })[pid] ?? null,
      },
      randomSuffix: () => "1a2b3c",
      readStdin: () => Promise.resolve(""),
      runProgram: realRunProgram,
      // No test waits for real: a loop under test is driven by the `sleep` it hands in.
      sleep: () => Promise.resolve(),
      which: (command: string) => Bun.which(command, { PATH: fullEnv.PATH }),
      ...change,
    };
  };
  const claudeCalls = (): string[][] =>
    readFileSync(log, "utf8")
      .split("----\n")
      .filter((call) => call !== "")
      .map((call) => call.replace(/\n$/, "").split("\n"));
  const cwdCalls = (): string[] =>
    readFileSync(cwdLog, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  return { bin, claudeCalls, cleanLock, ctx, cwdCalls, err, home, out, paths, repo, writeConfig };
}
