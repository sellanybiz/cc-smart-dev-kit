/**
 * `cc-smart-dev-kit crew self-watch`: the crew session's own line about its context and its time.
 *
 * The crew session's monitor runs this. It reads the crew session's own transcript tail and the time since
 * it started, and prints **one line** into the crew session's chat when the crew session should act:
 *
 * - at `workflow.crew.handoffTokens` (400 000 tokens) or `workflow.crew.handoffPercent` (70 %)
 *   of its window, whichever comes first, and always `HANDOFF_MARGIN_TOKENS` before the point
 *   Claude Code would auto-compact it at: **hand off** — commit the work in progress and run
 *   `crew report --status handoff`, so the lead starts the next crew session from this head;
 * - at `workflow.crew.softHours` (2): a **note** — the phase is long: tell the lead where it
 *   stands (a `crew step` with a `--note`, which the lead's watch says), or hand off;
 * - at `workflow.crew.maxHours` (4): **hand off** again, now because the time is up.
 *
 * **Nothing else is printed.** A crew session that is fine sees nothing. The line is repeated every
 * 15 minutes while it is ignored, so a crew session that missed it sees it again.
 *
 * **The window.** The model that wrote the last reply decides it (`context-window.ts`): Claude
 * Code's own number when the status line recorded one for that model, the kit's table
 * otherwise, and a backend's own model list for a bare backend model. A model whose window the
 * kit cannot know has no window, and so no percent line — the token cap still applies, and so
 * do the time lines.
 *
 * **The auto-compact point.** A crew session starts with `--autocompact auto`, which skips the
 * person's `autoCompactWindow` settings; only `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and
 * `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` still move it (`claude-settings.ts`). The hand-off line is
 * never at or past it.
 */
import { COMMAND } from "../build-info/names";
import { compactEnvOf } from "../machine/claude-settings";
import { readCrewSelf, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { COMPACT_RESERVE_TOKENS, compactPointOf, windowWatch } from "./context-window";
import { runningCrew } from "./places";
import { readCrew, readSelfWatchState, writeSelfWatchState } from "./store";
import { type ContextUse, contextPercent, contextUseOf, transcriptFile } from "./transcript";

/** How long the crew session waits before it says the same line again. */
export const SELF_WATCH_REPEAT_MS = 15 * 60_000;

/** How often the self-watch looks: a transcript tail and a clock cost almost nothing. */
export const SELF_WATCH_POLL_MS = 60_000;

/** What the crew session should hear, or null when it should hear nothing. */
export interface SelfAdvice {
  /** The line, in the crew session's own chat. */
  line: string;
  /** Which advice it is: the context ran out, the phase is long, or the time is up. */
  kind: "context" | "long" | "time";
}

/** The thresholds a crew session watches itself against. */
export interface SelfThresholds {
  /** The share of the window, in percent, at which it hands off. */
  handoffPercent: number;
  /** The tokens of context at which it hands off, whatever the window. */
  handoffTokens: number;
  /** The hours after which the lead gets a note about it. */
  softHours: number;
  /** The hours after which it hands off. */
  maxHours: number;
}

/** How long the crew session has been at it, in hours (a fraction of an hour counts). */
export function hoursSince(startedAtMs: number, nowMs: number): number {
  return Math.max(0, (nowMs - startedAtMs) / 3_600_000);
}

/** How far below the point Claude Code compacts at the hand-off line stays: one more reserve. */
export const HANDOFF_MARGIN_TOKENS = COMPACT_RESERVE_TOKENS;

/** What one poll knows about the crew session's context. */
export interface ContextFacts {
  /** The context size at which Claude Code compacts; null when the kit cannot tell. */
  compactPoint: null | number;
  /** What the last reply used; null when there is no reply. */
  use: ContextUse | null;
  /** The model's window; null when the kit cannot know it. */
  window: null | number;
}

/**
 * The context size, in tokens, at which the crew session hands off: the smallest of the token
 * cap, the share of the window (when the window is known) and `HANDOFF_MARGIN_TOKENS` below the
 * point Claude Code compacts at (when that is known). Never below 1.
 */
export function handoffTokensOf(context: ContextFacts, thresholds: SelfThresholds): number {
  const lines = [thresholds.handoffTokens];
  if (context.window !== null) {
    lines.push(Math.floor((context.window * thresholds.handoffPercent) / 100));
  }
  if (context.compactPoint !== null) lines.push(context.compactPoint - HANDOFF_MARGIN_TOKENS);
  return Math.max(1, Math.min(...lines));
}

/** `412345` → `412k`: the tokens as the crew session reads them. */
function thousands(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * The line the crew session needs, or null when it needs none. `context` is what its last reply
 * used and the window and the compaction point that use is measured against; `hours` is how
 * long it has run.
 */
export function adviceFor(
  context: ContextFacts,
  hours: number,
  thresholds: SelfThresholds,
): SelfAdvice | null {
  if (hours >= thresholds.maxHours) {
    return {
      kind: "time",
      line: `${hours.toFixed(1)} hours into this phase: hand off now — commit your work in progress, then run \`cc-smart-dev-kit crew report --status handoff\``,
    };
  }
  if (context.use !== null && context.use.tokens >= handoffTokensOf(context, thresholds)) {
    const percent = contextPercent(context.use, context.window);
    return {
      kind: "context",
      line: `context at ${thousands(context.use.tokens)} tokens${percent === null ? "" : ` (${percent}%)`}: hand off now — commit your work in progress, then run \`cc-smart-dev-kit crew report --status handoff\``,
    };
  }
  if (hours >= thresholds.softHours) {
    return {
      kind: "long",
      line: `${hours.toFixed(1)} hours into this phase: it is long. Tell the lead where it stands (\`${COMMAND} crew step <the step you are at> --note "<where you stand>"\`), or hand off.`,
    };
  }
  return null;
}

/** The thresholds of this project. */
export function thresholdsOf(resolved: {
  crew: {
    handoffPercent: { value: number };
    handoffTokens: { value: number };
    maxHours: { value: number };
    softHours: { value: number };
  };
}): SelfThresholds {
  return {
    handoffPercent: resolved.crew.handoffPercent.value,
    handoffTokens: resolved.crew.handoffTokens.value,
    maxHours: resolved.crew.maxHours.value,
    softHours: resolved.crew.softHours.value,
  };
}

/** `crew self-watch`; the exit code. */
export async function runCrewSelfWatch(ctx: CrewContext, once = false): Promise<number> {
  // A plugin's monitor is a process of the host: it may not carry the settings' `env`, so the
  // crew session is found by its worktree when the variable is not there.
  const self = readCrewSelf(ctx, "crew self-watch", { byWorktree: true });
  if (!self.ok) {
    for (const line of self.lines) ctx.error(line);
    return 1;
  }
  const { repo, resolved } = self.self;
  let { record } = self.self;
  const thresholds = thresholdsOf(resolved);
  // What it learns about windows is kept between polls: the gateway config once, and a
  // backend's list for its own lifetime (`context-window.ts`).
  const windows = windowWatch({ paths: ctx.paths });
  // A line that is ignored is said again when its time is up, and the watch keeps looking —
  // until the crew session's phase is over: a crew session that hands off or reports ends its work, and
  // its monitor has nothing more to say.
  for (;;) {
    const now = ctx.now();
    const usage =
      record.sessionId === null
        ? null
        : contextUseOf(transcriptFile(ctx.paths.projectsDir, record.worktree, record.sessionId));
    // The model that wrote the last reply is the truth about the window (a fallback target may
    // have answered); the record's own model stands in before there is a reply.
    const window = await windows.of(usage?.model ?? record.model.resolved, now);
    // Read at every poll: a few small files, and the person may change them while it runs.
    const compactPoint = compactPointOf(
      window,
      compactEnvOf({
        configDir: ctx.paths.claudeConfigDir,
        env: ctx.env,
        projectFolder: record.worktree,
      }),
    );
    const hours = hoursSince(Date.parse(record.startedAt ?? record.createdAt), now);
    const advice = adviceFor({ compactPoint, use: usage, window }, hours, thresholds);
    if (advice !== null) {
      // The same advice is said again only after its time is up: a crew session that ignored it sees
      // it again, and a crew session that acted does not.
      const said = readSelfWatchState(ctx.paths.stateDir, repo, record.id);
      if (said === null || said.kind !== advice.kind || now - said.at >= SELF_WATCH_REPEAT_MS) {
        try {
          writeSelfWatchState(ctx.paths.stateDir, repo, record.id, { at: now, kind: advice.kind });
        } catch (error) {
          ctx.error(`crew self-watch: the store could not record the line: ${reasonOf(error)}`);
        }
        ctx.print(advice.line);
      }
    }
    if (once) return 0;
    await ctx.sleep(SELF_WATCH_POLL_MS);
    try {
      const fresh = readCrew(ctx.paths.stateDir, repo, record.id);
      if (fresh === null || runningCrew([fresh]).length === 0) return 0;
      record = fresh;
    } catch {
      // The record cannot be read this round: keep the one we have, and look again.
    }
  }
}
