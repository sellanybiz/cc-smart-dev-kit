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
 *   - `5h 23% · 7d 41%`, and from the warning share a warning with the reset time.
 *
 * It reads two small files and prints; no network. **A fallback or breaker record shows only in a
 * session on its chain** (`sessionGatewayOf`: the `ANTHROPIC_BASE_URL` the command's environment
 * carries is the session's own, `docs/claude-code-contract.md`): the machine's records on the
 * machine's address (or when it carries none), a profile's on that profile's address, none off
 * the gateway. A plan limit shows in every session: the login is one. **The warning share is a setting**
 * (`alerts.usagePercent`, 85 by default): the entry reads it once, at the folder the session
 * is in, with the same reader the alert hooks use (`alertsAt`), so the number lives in one
 * place (`src/workflow/schema.ts`).
 *
 * **It also records the 5-hour window it read** (`recordUsageWindow`, D54): this command is
 * the only one Claude Code tells the number to, and the crew's opus guard reads it from the
 * state file (`src/cli/usage-window.ts`). **And the context window Claude Code reports** for
 * the session's model (`recordClaudeWindow`): `crew self-watch` measures a crew session's
 * hand-off share against it, its one home being `src/crew/context-window.ts`. A recording
 * failure never fails the line: it prints one stderr line and the status line goes on.
 */

import { readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { recordClaudeWindow } from "../crew/context-window";
import { breakerChangeCommand, slotShortName } from "../gateway/breaker";
import {
  currentBreakers,
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
import type { AlertsHere } from "../workflow/alerts";
import { defaultAlerts } from "../workflow/resolve";
import { workflowDefaults } from "../workflow/schema";
import type { CliPaths } from "./paths";
import { FIVE_HOUR_WINDOW, recordUsageWindow, windowOf } from "./usage-window";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
): string {
  const parts: string[] = [];
  const data = isJsonObject(input) ? input : {};
  const model = isJsonObject(data.model) ? data.model.display_name : undefined;
  if (typeof model === "string" && model !== "") parts.push(model);
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
 * address says nothing: the contract proves the session's address there for a `--settings` file
 * and a project's own file (`docs/claude-code-contract.md`), so with none the machine's records
 * show, as they always did. An address decides: Anthropic's own (off), the router's, or a
 * profile's.
 */
function sessionOf(paths: CliPaths, env: Env): Pick<SessionGateway, "gatewayOn" | "profile"> {
  const url = env.ANTHROPIC_BASE_URL;
  if (url === undefined || url === "") return { gatewayOn: true, profile: null };
  return sessionGatewayOf(paths, env);
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
    // The line still prints; without the reading the crew's opus guard simply does not hold.
    console.error(
      `${COMMAND}: the 5-hour usage window was not recorded (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    recordClaudeWindow(paths, input, nowMs);
  } catch (error) {
    // The line still prints; without the reading `crew self-watch` falls back to its own table.
    console.error(
      `${COMMAND}: the context window Claude Code reported was not recorded (${error instanceof Error ? error.message : String(error)})`,
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
  console.log(
    statuslineText(input, state, nowMs, undefined, alerts.alerts.usagePercent.value, session),
  );
  return 0;
}
