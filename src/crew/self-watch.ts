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
 * - **the lead's answer** to its question (AN1): the monitor looks every few seconds
 *   (`ANSWER_WATCH_POLL_MS`) and prints an answer that is on record and not yet delivered, as one
 *   line (`deliveryLine`), once. The line is a notification, which wakes an idle crew session, so a
 *   blocked one needs nobody to send it anything. The answer is marked delivered *before* the line
 *   is printed, under the store's lock (`markAnswerDelivered`): two monitors of one crew session
 *   (the original and a copy a resume started) never both print it. The monitor also writes a
 *   heartbeat, which `crew answer` reads to know the answer will arrive. It looks at the crew
 *   record only when its file changed (a stat, never a re-read each tick).
 *
 * **Nothing else is printed.** A crew session with no answer waiting and room to work sees nothing. The line is repeated every
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
import { statSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { compactEnvOf } from "../machine/claude-settings";
import { deliveryLine } from "./answer";
import { readCrewSelf, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { COMPACT_SUMMARY_BUFFER_TOKENS, compactPointOf, windowWatch } from "./context-window";
import { runningCrew } from "./places";
import {
  ANSWER_BEAT_EVERY_MS,
  ANSWER_WATCH_POLL_MS,
  type CrewRecord,
  crewFile,
  lastHeardAnswer,
  markAnswerDelivered,
  markNoteDelivered,
  readCrew,
  readSelfWatchState,
  undeliveredAnswerIndexes,
  writeAnswerWatchBeat,
  writeSelfWatchState,
} from "./store";
import { type ContextUse, contextPercent, contextUseOf, transcriptFile } from "./transcript";

/** How long the crew session waits before it says the same line again. */
export const SELF_WATCH_REPEAT_MS = 15 * 60_000;

/**
 * How often the self-watch looks at the context and the clock: a transcript tail costs almost
 * nothing, but nothing needs it more often. (The answer is looked for every
 * `ANSWER_WATCH_POLL_MS`, a stat of the record's file.)
 */
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

/**
 * How far below the point Claude Code compacts at the hand-off line stays: one more summary
 * buffer, the room a crew session needs to commit and report. (A 200k window then still hands
 * off at its 70 %, 140k, and not earlier.)
 */
export const HANDOFF_MARGIN_TOKENS = COMPACT_SUMMARY_BUFFER_TOKENS;

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
 * point Claude Code compacts at (when that is known and leaves room for it). Never below 1.
 */
export function handoffTokensOf(context: ContextFacts, thresholds: SelfThresholds): number {
  const lines = [thresholds.handoffTokens];
  if (context.window !== null) {
    lines.push(Math.floor((context.window * thresholds.handoffPercent) / 100));
  }
  // A window so small that Claude Code's own reserve leaves nothing is judged by the other two.
  const guard = context.compactPoint === null ? 0 : context.compactPoint - HANDOFF_MARGIN_TOKENS;
  if (guard > 0) lines.push(guard);
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
  const file = crewFile(ctx.paths.stateDir, repo, record.id);
  let seen: null | string = null;
  let lastBeat = Number.NEGATIVE_INFINITY;
  let lastAdvice = Number.NEGATIVE_INFINITY;
  for (;;) {
    const now = ctx.now();
    // The record is read when its file changed, and that read also ends the watch with the phase.
    const changed = mtimeOf(file);
    if (changed !== seen) {
      seen = changed;
      try {
        const fresh = readCrew(ctx.paths.stateDir, repo, record.id);
        if (fresh === null || runningCrew([fresh]).length === 0) return 0;
        record = fresh;
      } catch {
        // The record cannot be read this round: keep the one we have, and look again.
      }
    }
    // A one-shot run is no monitor: its heartbeat would tell `crew answer` an answer will be delivered.
    if (!once && now - lastBeat >= ANSWER_BEAT_EVERY_MS) {
      lastBeat = now;
      try {
        writeAnswerWatchBeat(ctx.paths.stateDir, repo, record.id, now);
      } catch (error) {
        ctx.error(`crew self-watch: the store could not record the heartbeat: ${reasonOf(error)}`);
      }
    }
    await deliverAnswer(ctx, repo, record, now);
    if (now - lastAdvice >= SELF_WATCH_POLL_MS) {
      lastAdvice = now;
      await adviseOnce(ctx, repo, record, thresholds, windows, now);
    }
    if (once) return 0;
    await ctx.sleep(ANSWER_WATCH_POLL_MS);
  }
}

/**
 * A stamp of the file's last change: its mtime, size and inode (a write is an atomic rename, so the
 * inode moves even where two writes share one timestamp); null when it cannot be read (the record
 * read says why).
 */
function mtimeOf(file: string): null | string {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return null;
  }
}

/**
 * Prints the lead's answers that are on record and not delivered yet (AN1), oldest first: the claim
 * comes first (`markAnswerDelivered`, atomic), so only the monitor that wins it prints — and an
 * answer is printed at most once, even when the line then fails to print. The words say when the
 * answer replaces an earlier one the session heard.
 */
async function deliverAnswer(
  ctx: CrewContext,
  repo: string,
  record: CrewRecord,
  now: number,
): Promise<void> {
  for (const index of undeliveredAnswerIndexes(record)) {
    let claimed: Awaited<ReturnType<typeof markAnswerDelivered>>;
    try {
      claimed = await markAnswerDelivered(ctx.paths.stateDir, repo, record.id, index, now);
    } catch (error) {
      // Not claimed, so the next tick tries again: an answer is never lost to a busy lock.
      ctx.error(`crew self-watch: the store could not claim the answer: ${reasonOf(error)}`);
      continue;
    }
    if (claimed === null || claimed.answer === null) continue;
    // The claim came first, so a line that fails to print is not printed again: at most once.
    ctx.print(
      `Question ${index + 1} (${JSON.stringify(claimed.question.slice(0, 100))}): ${deliveryLine(claimed.question, claimed.answer, lastHeardAnswer(claimed, false))}`,
    );
  }
  for (const [index, note] of (record.notes ?? []).entries()) {
    if (note.deliveredAt !== null) continue;
    try {
      const claimed = await markNoteDelivered(ctx.paths.stateDir, repo, record.id, index, now);
      if (claimed !== null) ctx.print(`Your lead's note: ${JSON.stringify(claimed.text)}`);
    } catch (error) {
      ctx.error(`crew self-watch: the store could not claim the note: ${reasonOf(error)}`);
    }
  }
}

/** The context and time advice for this look (the same lines as ever), said once per its time. */
async function adviseOnce(
  ctx: CrewContext,
  repo: string,
  record: CrewRecord,
  thresholds: SelfThresholds,
  windows: ReturnType<typeof windowWatch>,
  now: number,
): Promise<void> {
  const usage =
    record.sessionId === null
      ? null
      : contextUseOf(transcriptFile(ctx.paths.projectsDir, record.worktree, record.sessionId));
  // The model that wrote the last reply is the truth about the window (a fallback target may
  // have answered); the record's own model stands in before there is a reply.
  const window = await windows.of(usage?.model ?? record.model.resolved, now);
  // Claude Code compacts by the window of the model it was started on, not by a backend's that
  // answered (`record.model.resolved`); the answering model's window measures the share above.
  // The variables are read at every look: a few small files, and the person may change them.
  const compactPoint = compactPointOf(
    await windows.of(record.model.resolved, now),
    compactEnvOf({
      configDir: ctx.paths.claudeConfigDir,
      env: ctx.env,
      mainCheckout: repo,
      projectFolder: record.worktree,
    }),
  );
  const hours = hoursSince(Date.parse(record.startedAt ?? record.createdAt), now);
  const advice = adviceFor({ compactPoint, use: usage, window }, hours, thresholds);
  if (advice === null) return;
  // The same advice is said again only after its time is up: a crew session that ignored it sees
  // it again, and a crew session that acted does not.
  const said = readSelfWatchState(ctx.paths.stateDir, repo, record.id);
  if (said !== null && said.kind === advice.kind && now - said.at < SELF_WATCH_REPEAT_MS) return;
  try {
    writeSelfWatchState(ctx.paths.stateDir, repo, record.id, { at: now, kind: advice.kind });
  } catch (error) {
    ctx.error(`crew self-watch: the store could not record the line: ${reasonOf(error)}`);
  }
  ctx.print(advice.line);
}
