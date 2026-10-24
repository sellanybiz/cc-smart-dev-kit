/**
 * P1 — an explicit `ANTHROPIC_BASE_URL=https://api.anthropic.com` keeps the claude.ai login.
 *
 * The one probe that uses the person's own config folder and login: one tiny `claude -p
 * --model haiku` in a new empty folder, with no key in the environment and a `--settings` file
 * that sets only that URL (and turns hooks off, so the config's own hooks do not run beside
 * it). The session is not saved. The probe prints only the fields it reads: the init line's
 * `apiKeySource` and model, and the result line. Never the rest of the stream, which names the
 * person's own setup.
 *
 * As a second witness it counts, read-only, the rows the local router's request history holds
 * for this session's id (a request through the router would be one). It never talks to the
 * router.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p1-login.ts`
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { claudeVersion, runClaude, writeJson } from "./lib.ts";

const ANTHROPIC = "https://api.anthropic.com";
const base = process.env.R6_TMP ?? tmpdir();
mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, "r6-p1-"));
const folder = join(root, "empty");
mkdirSync(folder);
const settingsFile = join(root, "settings.json");
writeJson(settingsFile, { env: { ANTHROPIC_BASE_URL: ANTHROPIC }, disableAllHooks: true });

const started = Date.now();
const run = await runClaude({
  cwd: folder,
  args: [
    "-p",
    "--model",
    "haiku",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--settings",
    settingsFile,
    "--output-format",
    "stream-json",
    "--verbose",
    "--",
    "Say ok",
  ],
  // The person's own HOME and config folder (the login); nothing else of this session's.
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: homedir(),
    LANG: "C.UTF-8",
    DISABLE_AUTOUPDATER: "1",
  },
  timeoutMs: 120_000,
});
const ended = Date.now();

const lines = run.stdout
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      return {};
    }
  });
const init = lines.find((l) => l.type === "system" && l.subtype === "init") ?? {};
const result = lines.find((l) => l.type === "result") ?? {};
const sessionId = typeof init.session_id === "string" ? init.session_id : undefined;

// The router's history: rows for this session, and rows from anyone in the same minutes.
const historyFile = join(homedir(), ".local", "state", "cc-smart-dev-kit", "history.db");
let history: Record<string, unknown> = { file: "absent" };
if (existsSync(historyFile) && sessionId) {
  const db = new Database(historyFile, { readonly: true });
  const bySession = db
    .query("SELECT count(*) AS n FROM requests WHERE session = ?")
    .get(sessionId) as { n: number };
  const inWindow = db
    .query("SELECT count(*) AS n FROM requests WHERE at BETWEEN ? AND ?")
    .get(started - 60_000, ended + 60_000) as { n: number };
  db.close();
  history = { rowsForThisSession: bySession.n, rowsFromAnySessionInTheWindow: inWindow.n };
}

const out = {
  proof: "P1",
  claude: await claudeVersion(),
  exitCode: run.exitCode,
  stderrHead: run.stderr.trim().slice(0, 300),
  init: {
    apiKeySource: init.apiKeySource,
    model: init.model,
    permissionMode: init.permissionMode,
    hasSessionId: sessionId !== undefined,
  },
  result: {
    subtype: result.subtype,
    is_error: result.is_error,
    result: result.result,
    total_cost_usd: result.total_cost_usd,
    terminal_reason: result.terminal_reason,
  },
  routerHistory: history,
};
writeJson(join(root, "result.json"), out);
console.log(JSON.stringify(out, null, 2));
