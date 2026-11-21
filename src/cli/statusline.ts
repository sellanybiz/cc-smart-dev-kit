/**
 * `cc-smart-dev-kit statusline`: rows for Claude Code's status bar.
 *
 * Claude Code runs the status line command after each reply and passes a JSON object on
 * stdin (docs/claude-code-contract.md). The usage numbers come from there:
 * `rate_limits.five_hour` / `rate_limits.seven_day`, each with `used_percentage` (0 to 100)
 * and `resets_at` (Unix seconds). Claude Code fills them from the
 * `anthropic-ratelimit-unified-*` headers of Anthropic's answers, which the router passes
 * on unchanged; they are there only for a Claude subscription, after the first answer.
 *
 * First row, parts joined by ` · `:
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
 *     the current work on rows of its own (`taskSegment`: the plan, its phases, the tasks, then
 *     a lead's `Plans · 2 with children · 1 waiting · 1 ready` row from the store's classifier alone).
 *
 * It reads the router's state file and the gateway's config (the config to tell a profile's
 * address from the machine's, `sessionGatewayOf`, and for a slot target's pinned effort) and
 * Claude Code's settings files (the auto-compact window, each file once, `compactWindowsOf`), and
 * prints; no network. The task lookup resolves the project through git. **A fallback, breaker or
 * failing-checks record shows only in a session on its chain** (`sessionGatewayOf`: the
 * `ANTHROPIC_BASE_URL` the command's environment carries is the session's own,
 * `docs/claude-code-contract.md`): the machine's records on the machine's address (or when it
 * carries none), a profile's on that profile's address, none off the gateway. A plan limit shows
 * in every session: the login is one.
 *
 * **The warning share is a setting** (`alerts.usagePercent`, 85 by default): the command reads it
 * once, after stdin, at the folder the session is in (`cwd` in the input, else the process's own),
 * with the same reader the alert hooks use (`alertsAt`), so the number lives in one place
 * (`src/workflow/schema.ts`). That folder's checkout is located once (`locateSessionCheckout`)
 * and the task rows read the same one.
 *
 * It also records the 5-hour and 7-day usage windows (`usage-window.ts`) and the last cache miss
 * shown (`cache-miss.ts`) for other readers. A recording failure prints one stderr line without
 * failing the status line.
 */

import { readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { breakerChangeCommand, slotShortName } from "../gateway/breaker";
import { checksDownStatusline } from "../gateway/checks-down";
import { type LastAnswer, lastAnswer } from "../gateway/history-read";
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
import { answerTargetName } from "../gateway/target-label";
import { JUDGE_SLOT, withoutContextSuffix } from "../gateway/targets";
import type { Env } from "../hooks/run";
import { type SessionGateway, sessionGatewayOf } from "../hooks/session-facts";
import { compactWindowsOf, mainCheckoutOfFolder } from "../machine/claude-settings";
import { type Checkout, locateCheckout } from "../project/resolve";
import { projectKeyOf } from "../tasks/context";
import { CLAIM_PROCESS, callerOf } from "../tasks/work/identity";
import { classifyLeadPlans, type LeadPlanState } from "../tasks/work/lead-plans";
import { planProgress, readWorkStore } from "../tasks/work/read";
import type { ClaimProcess, Who } from "../tasks/work/types";
import { type AlertsHere, alertsAt } from "../workflow/alerts";

/** ` · 2 queued, 1 parked` for the plans that wait behind the current one; nothing when none. */
function waitingWords(waiting: { queued: number; parked: number } | null): string {
  if (waiting === null) return "";
  const parts = [
    ...(waiting.queued > 0 ? [`${waiting.queued} queued`] : []),
    ...(waiting.parked > 0 ? [`${waiting.parked} parked`] : []),
  ];
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

/** Each plan state the row counts, in the order the row shows them, with its words (`own` is the `Plan` row's). */
const PLAN_STATE_WORDS: readonly (readonly [LeadPlanState, (count: number) => string])[] = [
  ["with-child", (n) => `${n} with ${n === 1 ? "child" : "children"}`],
  ["child-gone", (n) => `${n} ${n === 1 ? "child" : "children"} gone`],
  ["merging", (n) => `${n} merging`],
  ["waiting", (n) => `${n} waiting`],
  ["no-files", (n) => `${n} ${n === 1 ? "needs" : "need"} files`],
  ["ready", (n) => `${n} ready`],
];

/** The states that mean a plan is reserved for this lead: a session with none of them is no lead. */
const RESERVED_STATES: readonly LeadPlanState[] = ["own", "with-child", "child-gone", "merging"];

/**
 * The lead's plans in one row: `Plans · 2 with children · 1 waiting · 1 ready`, zero counts left
 * out; null when nothing is counted. It reads the store's classifier alone (`classifyLeadPlans`):
 * no git, no gh, no hc, and no session record while a child's process runs, so it stays cheap
 * enough for every status line.
 *
 * With `claimsWork` (the own rows are shown), the row appears only when a plan is reserved for
 * this lead, itself or a child: a session that only has queued plans keeps its `· 2 queued`
 * words on the `Plan` row and gains nothing.
 */
function plansRow(
  paths: { stateDir: string },
  project: string,
  who: Who,
  claimsWork: boolean,
  claimProcess: ClaimProcess,
): string | null {
  const read = readWorkStore(paths, (db) => classifyLeadPlans(db, project, who, claimProcess));
  if (read.state !== "ready") return null;
  const led = read.value;
  if (claimsWork && !led.some((plan) => RESERVED_STATES.includes(plan.state))) return null;
  const parts = PLAN_STATE_WORDS.flatMap(([state, words]) => {
    const count = led.filter((plan) => plan.state === state).length;
    return count > 0 ? [words(count)] : [];
  });
  return parts.length > 0 ? `Plans · ${parts.join(" · ")}` : null;
}

/**
 * The current work, a row per layer: `Plan · <title>` (with `· 2 queued, 1 parked` when the
 * session's other open plans wait behind it), then `Phases 5/25 · <current phase>` when
 * the plan has phases, then `Tasks 1/3` with the current task's title when it is one. A task of
 * a phased plan under no phase has no `Tasks` row: its title is the last row. A loose task is its
 * title alone. Each title is whole.
 *
 * A lead's plans add one row (`plansRow`): below those rows, or alone when this process claims
 * no work (a coordinator).
 */
export function taskSegment(
  paths: { stateDir: string },
  project: string,
  who: Who,
  /** The machine's answers about a child's process; the real ones by default. */
  claimProcess: ClaimProcess = CLAIM_PROCESS,
): string | null {
  const claimed = claimedRows(paths, project, who);
  const plans = plansRow(paths, project, who, claimed !== null, claimProcess);
  return [claimed, plans].filter((row) => row !== null).join("\n") || null;
}

/** The rows of the work this process claims; null when it claims none. */
function claimedRows(paths: { stateDir: string }, project: string, who: Who): string | null {
  const read = planProgress(paths, project, who);
  if (read.state !== "ready" || read.value === null) return null;
  const { task, plan, phase, phases, tasks, waiting } = read.value;
  // Plan membership is the task's own `plan` column: the plan task's row may be gone.
  if (task.plan === null) return task.subject;
  const count = (word: string, of: { closed: number; total: number }, title?: string) =>
    `${word} ${of.closed}/${of.total}${title === undefined ? "" : ` · ${title}`}`;
  const own = task.kind === "task" ? task.subject : undefined;
  return [
    `Plan · ${plan?.subject ?? task.plan}${waitingWords(waiting)}`,
    phases === null ? null : count("Phases", phases, phase?.subject),
    tasks === null ? (own ?? null) : count("Tasks", tasks, own),
  ]
    .filter((row) => row !== null)
    .join("\n");
}

/**
 * Where the session's checkout is, found once for the usage alerts and the task rows: `checkout`
 * is null outside git, and `ok: false` when the folder cannot be read at all (it is gone, git is
 * too old, or git did not answer in time). The status bar never fails on it: each reader shows
 * its own empty answer.
 */
type SessionCheckout = { checkout: Checkout | null; ok: true } | { ok: false };

function locateSessionCheckout(folder: string, env: Env): SessionCheckout {
  try {
    return { checkout: locateCheckout(folder, { env }), ok: true };
  } catch {
    // The folder is gone, git is too old or did not answer: no project to read, no task rows.
    return { ok: false };
  }
}

/** The folder Claude Code says the session is in; null when the input names none. */
function sessionFolderOf(input: unknown): null | string {
  return isJsonObject(input) && typeof input.cwd === "string" && input.cwd !== ""
    ? input.cwd
    : null;
}

function currentTask(
  paths: CliPaths,
  sessionFolder: null | string,
  located: SessionCheckout,
  env: Env,
): string | null {
  if (sessionFolder === null || !located.ok) return null;
  try {
    const who = callerOf({ env, cwd: sessionFolder, claudeConfigDir: paths.claudeConfigDir });
    if (who === null) return null;
    return taskSegment(paths, projectKeyOf(located.checkout, sessionFolder), who);
  } catch {
    // The status bar must still work when the session or task store is unavailable.
    return null;
  }
}

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
  answer: LastAnswer | null = null,
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
  const bannerTargets = new Set<string>();
  if (state !== null) {
    const hidden = new Set(
      Object.entries(state.limits)
        .filter(([, record]) => {
          if (record.claim !== "five_hour" && record.claim !== "seven_day") return false;
          const window = windowOf(data, record.claim);
          return (
            window !== null &&
            window.resetsAt !== null &&
            record.resetsAt !== null &&
            window.resetsAt !== record.resetsAt
          );
        })
        .map(([model]) => model),
    );
    for (const [key, record] of currentFallbacks(state, nowMs)) {
      if (hidden.has(record.model)) continue;
      // The judge is no fallback, whichever chain's record an older router wrote.
      if (scopeOfStateKey(key).slot === JUDGE_SLOT || !aboutThisSession(key)) continue;
      covered.add(record.model);
      bannerTargets.add(record.target);
      parts.push(`⚠ ${record.model} at its limit → ${record.target}${until(record.resetsAt)}`);
    }
    for (const [limited, record] of currentLimits(state, nowMs)) {
      if (!hidden.has(limited) && !covered.has(limited))
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
  const id =
    isJsonObject(data.model) && typeof data.model.id === "string"
      ? withoutContextSuffix(data.model.id)
      : null;
  if (
    answer !== null &&
    session?.gatewayOn &&
    id !== null &&
    withoutContextSuffix(answer.model) === id &&
    answerTargetName(answer.target) !== null &&
    answerTargetName(answer.target) !== model &&
    withoutContextSuffix(answer.target) !== id &&
    !bannerTargets.has(answer.target) &&
    typeof model === "string" &&
    parts[0] === model
  ) {
    parts[0] = `${model} → ${answerTargetName(answer.target)}`;
  }
  return parts.join(" · ");
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
 * Runs the command: stdin from Claude Code, the router's state file; prints the main row and, when present, a task row.
 * Stdin is read first: the session's folder (`cwd` in it, else this process's own) is located once,
 * and the usage alerts and the task rows both read that checkout. One line on stderr says so when
 * a settings file could not be read and the defaults decided.
 */
export async function runStatusline(
  paths: CliPaths,
  readStdin: () => Promise<string>,
  nowMs: number,
  /** The environment Claude Code gave the command: its `ANTHROPIC_BASE_URL` is the session's. */
  env: Env = {},
): Promise<number> {
  let input: unknown = null;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    // Run by hand, or a newer Claude Code: show what the state file knows.
    input = null;
  }
  const sessionFolder = sessionFolderOf(input);
  const located = locateSessionCheckout(sessionFolder ?? process.cwd(), env);
  const alerts: AlertsHere = alertsAt(paths, located.ok ? located.checkout : null);
  if (alerts.problem !== null) console.error(alerts.problem);
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
  const gateway = sessionGatewayOf(paths, env);
  const session = isJsonObject(input)
    ? env.ANTHROPIC_BASE_URL === undefined
      ? { ...gateway, config: null, gatewayOn: true }
      : gateway
    : null;
  const cacheMiss = cacheMissSegment(input, paths.stateDir, nowMs);
  const task = currentTask(paths, sessionFolder, located, env);
  const text = statuslineText(
    input,
    state,
    nowMs,
    undefined,
    alerts.alerts.usagePercent.value,
    session,
    contextFactsOf(paths, input, env, state, session, nowMs),
    session?.gatewayOn &&
      isJsonObject(input) &&
      typeof input.session_id === "string" &&
      isJsonObject(input.model) &&
      typeof input.model.id === "string" &&
      gateway.gatewayOn
      ? lastAnswer(paths.historyDbFile, input.session_id, null, session.profile, input.model.id)
      : null,
  );
  const firstRow = [text, cacheMiss].filter((part) => part !== null && part !== "").join(" · ");
  console.log([firstRow, task].filter((part) => part !== null && part !== "").join("\n"));
  return 0;
}
