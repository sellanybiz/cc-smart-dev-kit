/**
 * One deadline for a hook that calls children (git, gh) one after another.
 *
 * Each call has its own limit, and the limits add up: three calls of 10 s are 30 s, the whole
 * of a hook's time. A hook Claude Code has to kill answers nothing, so a PreToolUse guard that
 * overran let the call it guards run unguarded (fail-open), and a PostToolUse note was lost.
 * So a hook starts a budget, and each call gets the smaller of its own limit and the time that
 * is left (`Budget.timeFor`). When too little is left for the next call, `timeFor` is zero or
 * less, and the hook does not make it: a guard asks, a note is skipped.
 */
import type { Env } from "./run";

/** The budget of a hook that has 30 s (`plugin/hooks/hooks.json`): the rest is room to answer. */
export const GUARD_BUDGET_MS = 25_000;

/**
 * The budget of a hook that has 10 s (`job-route`'s question about `workflow propose`; every other
 * guard but the merge guard): the same share, and the same room to answer.
 */
export const SHORT_GUARD_BUDGET_MS = 8_000;

/** What is kept back when a call is handed its time: the answer itself, and Claude Code reading it. */
export const BUDGET_MARGIN_MS = 2_000;

/**
 * Where a test sets the budget: `CC_SMART_DEV_KIT_GUARD_BUDGET_MS`, in milliseconds, so the
 * deadline can be proved to bite without waiting 25 s. A hook never sets it; a value that is
 * not a positive number leaves the default, and a larger one is cut to the hook's own budget — the
 * variable can only shorten a hook's budget, never make it overrun. (A project's own
 * `settings.json` `env` reaches the hooks, and a guard that overran would be killed.)
 */
export const GUARD_BUDGET_ENV = "CC_SMART_DEV_KIT_GUARD_BUDGET_MS";

/**
 * `ceilingMs` (a hook's own budget: `GUARD_BUDGET_MS` unless told otherwise), or what `env`
 * shortens it to (a test's own budget, in milliseconds).
 */
export function budgetMs(env: Env, ceilingMs: number = GUARD_BUDGET_MS): number {
  const given = Number(env[GUARD_BUDGET_ENV]);
  return Number.isFinite(given) && given > 0 ? Math.min(given, ceilingMs) : ceilingMs;
}

/** A running budget: what is left for one more call. */
export interface Budget {
  /**
   * The time one call may take: `limitMs`, or what is left of the budget less the margin,
   * whichever is smaller. Zero or less: nothing is left, so the call is not made.
   */
  timeFor: (limitMs: number) => number;
}

/**
 * Starts the budget of this run: `budgetMs(env, ceilingMs)` from now, or from `startedAtMs` when
 * the hook knows when it started (the frame's `nowMs`), so the time spent before the hook's own
 * code ran — the frame looks the project up first — is already out of it.
 */
export function startBudget(
  env: Env,
  now: () => number = Date.now,
  ceilingMs: number = GUARD_BUDGET_MS,
  startedAtMs?: number,
): Budget {
  const budgetAt = (startedAtMs ?? now()) + budgetMs(env, ceilingMs);
  return { timeFor: (limitMs) => Math.min(limitMs, budgetAt - now() - BUDGET_MARGIN_MS) };
}
