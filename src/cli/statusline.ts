/**
 * `cc-smart-dev-kit statusline`: one line for Claude Code's status bar.
 *
 * Claude Code runs the status line command after each reply and passes a JSON object on
 * stdin (docs/claude-code-contract.md). The usage numbers come from there:
 * `rate_limits.five_hour` / `rate_limits.seven_day`, each with `used_percentage` (0 to 100)
 * and `resets_at` (Unix seconds). Claude Code fills them from the
 * `anthropic-ratelimit-unified-*` headers of Anthropic's answers, which the router passes
 * on unchanged; they are there only for a Claude subscription, after the first answer.
 *
 * What it shows, parts joined by ` · `:
 *   - the model's display name;
 *   - the session's context use and reasoning effort, always (`ctx 312k · 78% of 400k · xhigh`,
 *     `statusline-context.ts`): measured against the auto-compact window the person set, and
 *     warning from the same share as the 5h and 7d segments;
 *   - a slot whose first target, a Claude model, is at its plan limit, answering from its
 *     next target (`⚠ claude-opus-5-5 at its limit → omniroute:… until 13:00`). A judge
 *     record an older router wrote is not shown: from 0.5.0 the judge is no fallback, it
 *     judges every check once the person gives it a chain;
 *   - a plan limit the router saw, with no fallback (`⛔ claude-opus-5-5 at its plan limit
 *     until 13:00`): a refused request brings Claude Code no new numbers, so only the
 *     router's state file (`limit-state.ts`) knows it;
 *   - a slot whose breaker is open (`worker slot: every target limited since 21:05 →
 *     gateway slot worker <targets>`, `currentBreakers`): every target is limited or down, so
 *     the router holds its requests and then asks Claude Code to retry; a profile's record
 *     reads `worker slot in profile <name>` and names `gateway profile <name> slot worker
 *     <targets>`, never the `gateway slot` command, which would change the machine's chain;
 *   - auto mode's safety checks failing (`⛔ auto mode's safety checks are failing since 14:05:
 *     Claude is at its plan limit … until 18:00, and no worker target has passed the judge test →
 *     cc-smart-dev-kit gateway setup`, `currentChecksDown`): Claude is limited or down and nothing
 *     stood in, so auto mode approves nothing. The words and the exact fix are
 *     `checks-down.ts`'s, the same in `gateway status`, `doctor` and the session's note; a
 *     profile's record reads `in profile <name>` and names the profile's own command;
 *   - `5h 23% · 7d 41%`, and from the warning share a warning with the reset time;
 *   - `cache miss: tools_changed`, for a minute after a prompt-cache miss (`cache-miss.ts`:
 *     `prompt_cache.last_miss_at` and `last_miss_cause`, `CACHE_MISS_SHOW_MS`, no state), before
 *     the current task.
 *
 * It reads the router's state file and the gateway's config (the config to tell a profile's
 * address from the machine's, `sessionGatewayOf`, and for a slot target's pinned effort) and
 * Claude Code's settings files (the auto-compact window, each file once, `compactWindowsOf`), and
 * prints; no network, no git. **A fallback, breaker or
 * failing-checks record shows only in a session on its chain** (`sessionGatewayOf`: the
 * `ANTHROPIC_BASE_URL` the command's environment carries is the session's own,
 * `docs/claude-code-contract.md`): the machine's records on the machine's address (or when it
 * carries none), a profile's on that profile's address, none off the gateway. A plan limit shows
 * in every session: the login is one.
 *
 * **The warning share is a setting** (`alerts.usagePercent`, 85 by default): the entry reads it
 * once, at the folder the session is in, with the same reader the alert hooks use (`alertsAt`),
 * so the number lives in one place (`src/workflow/schema.ts`).
 *
 * It also records the 5-hour and 7-day usage windows (`usage-window.ts`) and the last cache miss
 * shown (`cache-miss.ts`) for other readers. A recording failure prints one stderr line without
 * failing the status line.
 */

import { readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { breakerChangeCommand, slotShortName } from "../gateway/breaker";
import { checksDownStatusline } from "../gateway/checks-down";
import {
  currentBreakers,
  currentChecksDown,
  currentFallbacks,
  currentLimits,
  formatClock,
  type LimitState,
  parseLimitState,
  scopeOfStateKey,
} from "../gateway/limit-state";
import { JUDGE_SLOT } from "../gateway/targets";
import { type SessionGateway, sessionGatewayOf } from "../hooks/agent-guard";
import type { Env } from "../hooks/run";
import { compactWindowsOf, mainCheckoutOfFolder } from "../machine/claude-settings";
import { taskContext } from "../tasks/context";
import { callerOf } from "../tasks/work/identity";
import { statusTask } from "../tasks/work/read";
import type { Who } from "../tasks/work/types";
import type { AlertsHere } from "../workflow/alerts";

/** Keep long task titles from taking over the status bar. */
const TASK_SUBJECT_MAX = 60;
export function taskSegment(paths: { stateDir: string }, project: string, who: Who): string | null {
  const read = statusTask(paths, project, who);
  if (read.state !== "ready" || read.value === null) return null;
  const task = read.value;
  const subject =
    task.subject.length > TASK_SUBJECT_MAX
      ? `${task.subject.slice(0, TASK_SUBJECT_MAX - 1)}…`
      : task.subject;
  return `#${task.number} ${subject}${task.total > 0 ? ` · ${task.closed}/${task.total}` : ""}`;
}

function currentTask(paths: CliPaths, input: unknown, env: Env): string | null {
  if (!isJsonObject(input) || typeof input.cwd !== "string") return null;
  try {
    const who = callerOf({ env, cwd: input.cwd, claudeConfigDir: paths.claudeConfigDir });
    if (who === null) return null;
    const context = taskContext(input.cwd, env);
    return context.ok ? taskSegment(paths, context.project, who) : null;
  } catch {
    // The status bar must still work when the session or task store is unavailable.
    return null;
  }
}

import { defaultAlerts } from "../workflow/resolve";
import { workflowDefaults } from "../workflow/schema";
import { cacheMissSegment } from "./cache-miss";
import type { CliPaths } from "./paths";
import { contextSegment, contextUseOf, effortOf, pinnedEffortOf } from "./statusline-context";
import { FIVE_HOUR_WINDOW, recordUsageWindow, windowOf } from "./usage-window";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What the context segment needs from outside the input. */
export interface ContextFacts {
  /** The auto-compact window the variable or the settings keys give; null for none. */
  compactWindow: null | number;
  /** The effort the slot's backend target pins on this session's chain; null for none. */
  pinnedEffort: null | string;
}

const NO_CONTEXT_FACTS: ContextFacts = { compactWindow: null, pinnedEffort: null };

/** The status line for this input and state, at `nowMs`. */
export function statuslineText(
  input: unknown,
  state: LimitState | null,
  nowMs: number,
  timeZone?: string,
  /** From this share of a plan window, the line warns (`alerts.usagePercent`). */
  warnPercent: number = workflowDefaults.alerts.usagePercent,
  /**
   * The gateway this session runs on (`sessionGatewayOf`). A fallback or breaker record is about
   * one chain: the machine's, or a profile's (`<profile>/<slot>`). It shows only in a session on
   * that chain; a session off the gateway shows none. Null: no session to judge by (run by
   * hand, no input from Claude Code), every record shows.
   */
  session: Pick<SessionGateway, "gatewayOn" | "profile"> | null = null,
  /**
   * The context segment's two outside facts: the auto-compact window the person set (the
   * variable, else the settings keys), and the effort the slot's backend target pins. Null: none.
   */
  context: ContextFacts = NO_CONTEXT_FACTS,
): string {
  const parts: string[] = [];
  const data = isJsonObject(input) ? input : {};
  const model = isJsonObject(data.model) ? data.model.display_name : undefined;
  if (typeof model === "string" && model !== "") parts.push(model);
  const segment = contextSegment(
    contextUseOf(data),
    context.compactWindow,
    context.pinnedEffort ?? effortOf(data),
    warnPercent,
  );
  if (segment !== null) parts.push(segment);
  const until = (resetsAt: null | number) =>
    resetsAt === null ? "" : ` until ${formatClock(resetsAt, nowMs, timeZone)}`;

  const aboutThisSession = (key: string): boolean =>
    session === null || (session.gatewayOn && scopeOfStateKey(key).profile === session.profile);
  const covered = new Set<string>();
  if (state !== null) {
    for (const [key, record] of currentFallbacks(state, nowMs)) {
      // The judge is no fallback, whichever chain's record an older router wrote.
      if (scopeOfStateKey(key).slot === JUDGE_SLOT || !aboutThisSession(key)) continue;
      covered.add(record.model);
      parts.push(`⚠ ${record.model} at its limit → ${record.target}${until(record.resetsAt)}`);
    }
    for (const [limited, record] of currentLimits(state, nowMs)) {
      if (!covered.has(limited))
        parts.push(`⛔ ${limited} at its plan limit${until(record.resetsAt)}`);
    }
    for (const [key, record] of currentBreakers(state, nowMs)) {
      if (!aboutThisSession(key)) continue;
      // A profile's record is keyed `<profile>/<slot>` (owner D29): its chain is not the
      // `gateway slot` one, so the line names the profile's own command (one home with the
      // router's answer and the alert: `breakerChangeCommand`).
      const { profile, slot } = scopeOfStateKey(key);
      const short = slotShortName(slot);
      const where = profile === null ? `${short} slot` : `${short} slot in profile ${profile}`;
      parts.push(
        `${where}: every target limited since ${formatClock(Math.floor(record.since / 1000), nowMs, timeZone)} → ${breakerChangeCommand(slot, profile)}`,
      );
    }
    // Auto mode's safety checks that fail with nothing standing in: the same scope rule.
    for (const [key, record] of currentChecksDown(state, nowMs)) {
      if (!aboutThisSession(key)) continue;
      parts.push(checksDownStatusline(record, scopeOfStateKey(key).profile, nowMs, timeZone));
    }
  }

  for (const [name, label] of [
    [FIVE_HOUR_WINDOW, "5h"],
    ["seven_day", "7d"],
  ] as const) {
    const numbers = windowOf(data, name);
    if (numbers === null) continue;
    const percent = Math.round(numbers.percent);
    parts.push(
      percent >= warnPercent
        ? `⚠ ${label} ${percent}%${numbers.resetsAt === null ? "" : ` (resets ${formatClock(numbers.resetsAt, nowMs, timeZone)})`}`
        : `${label} ${percent}%`,
    );
  }
  return parts.join(" · ");
}

/**
 * The gateway the session runs on, for the records its line shows. An environment with no
 * address at all says nothing: the contract proves the session's address there for a `--settings`
 * file and a project's own file (`docs/claude-code-contract.md`), so with none the machine's
 * records show, as they always did. An address decides, as `sessionGatewayOf` reads it for the
 * guards: Anthropic's own or an empty one (off), the router's, a profile's, and any other
 * address counts as the machine's gateway.
 */
function sessionOf(
  paths: CliPaths,
  env: Env,
): Pick<SessionGateway, "config" | "gatewayOn" | "profile"> {
  if (env.ANTHROPIC_BASE_URL === undefined) return { config: null, gatewayOn: true, profile: null };
  return sessionGatewayOf(paths, env);
}

/**
 * The context segment's outside facts for this input. The folder is the session's project folder
 * (`workspace.project_dir`, else `cwd`, else this process's); each settings file is read once.
 * The pinned effort needs the session's own gateway view and answers only on the gateway.
 */
function contextFactsOf(
  paths: CliPaths,
  input: unknown,
  env: Env,
  state: LimitState | null,
  session: Pick<SessionGateway, "config" | "gatewayOn" | "profile"> | null,
  nowMs: number,
): ContextFacts {
  if (!isJsonObject(input)) return NO_CONTEXT_FACTS;
  const modelId = isJsonObject(input.model) ? input.model.id : undefined;
  const id = typeof modelId === "string" && modelId.trim() !== "" ? modelId : null;
  let compactWindow: null | number = null;
  if (id !== null && contextUseOf(input) !== null) {
    const workspace = isJsonObject(input.workspace) ? input.workspace : {};
    const folder = [workspace.project_dir, input.cwd, workspace.current_dir].find(
      (value): value is string => typeof value === "string" && value !== "",
    );
    const projectFolder = folder ?? process.cwd();
    const windows = compactWindowsOf(
      {
        configDir: paths.claudeConfigDir,
        env,
        mainCheckout: mainCheckoutOfFolder(projectFolder),
        projectFolder,
      },
      id,
    );
    // Claude Code's order: the variable, then the keys, then the model's own window.
    compactWindow = windows.env.window ?? windows.settings;
  }
  const pinnedEffort =
    session?.gatewayOn === true
      ? pinnedEffortOf(session.config, id, state, session.profile, nowMs)
      : null;
  return { compactWindow, pinnedEffort };
}

/**
 * Runs the command: stdin from Claude Code, the router's state file; prints one line.
 * `alerts` is what the entry read once (`alertsAt`); one line on stderr says so when a
 * settings file could not be read and the defaults decided.
 */
export async function runStatusline(
  paths: CliPaths,
  readStdin: () => Promise<string>,
  nowMs: number,
  alerts: AlertsHere = { alerts: defaultAlerts(), problem: null },
  /** The environment Claude Code gave the command: its `ANTHROPIC_BASE_URL` is the session's. */
  env: Env = {},
): Promise<number> {
  if (alerts.problem !== null) console.error(alerts.problem);
  let input: unknown = null;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    // Run by hand, or a newer Claude Code: show what the state file knows.
    input = null;
  }
  try {
    recordUsageWindow(paths, input, nowMs);
  } catch (error) {
    // The line still prints even when the reading cannot be saved.
    console.error(
      `${COMMAND}: the usage windows were not recorded (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  let state: LimitState | null = null;
  try {
    state = parseLimitState(readFileSync(paths.gatewayStateFile, "utf8"));
  } catch {
    // No router state yet.
    state = null;
  }
  const session = isJsonObject(input) ? sessionOf(paths, env) : null;
  const cacheMiss = cacheMissSegment(input, paths.stateDir, nowMs);
  const task = currentTask(paths, input, env);
  const text = statuslineText(
    input,
    state,
    nowMs,
    undefined,
    alerts.alerts.usagePercent.value,
    session,
    contextFactsOf(paths, input, env, state, session, nowMs),
  );
  console.log([text, cacheMiss, task].filter((part) => part !== null && part !== "").join(" · "));
  return 0;
}
