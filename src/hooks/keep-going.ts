/**
 * Stop: the main session does not end a turn with a phase of its plan still in progress and
 * nothing that will wake it.
 *
 * In subagent-driven work the main session dispatches each phase's builder and hears it hand
 * back. A turn that ends while a phase is `in_progress`, with no builder running and no word on
 * what it waits for, leaves the plan stalled until the person notices. So the hook blocks such a
 * stop **once per stalled state**, with one plain paragraph: resume the recorded builder, or
 * start a fresh one; start the next ready phase, close the phase, or record why it waits; and a
 * warning against moving the phase back to pending to end the turn. The build
 * skill says the same (`plugin/skills/build/SKILL.md`).
 *
 * It blocks only when all of these hold, cheapest first:
 *
 * 1. **Not the stop its own block caused** (`stop_hook_active`): never a second block.
 * 2. **No background work** (`background_tasks` absent or empty): a subagent or a background
 *    command still running wakes the session when it lands (`docs/claude-code-contract.md`).
 * 3. **No `Waiting for:` line** in the turn's last answer: the input's own
 *    `last_assistant_message`, else the transcript's last answer (`lastAssistantText`). With
 *    neither, the hook cannot tell, and lets the turn end.
 * 4. **A phase in progress** of a plan this Claude process works on: a plan that holds a task
 *    this process has claimed (`openPhasesOf`, the store's claim from `callerOf`). The store is
 *    read first; the caller is looked up only when some phase is in progress, since off Linux
 *    that lists the running processes. Another session's plan is not this one's business.
 * 5. **This reason not already given** (`stopFeedbackGiven`): read only after a phase in
 *    progress is found, from the transcript's default tail (`TRANSCRIPT_TAIL_BYTES`). The same
 *    reason in the session's own Stop feedback, with no subagent started or resumed since
 *    (`Agent`, `Task`, `Workflow`, `SendMessage`), keeps the hook silent: turns that answer the
 *    person without starting a subagent are not blocked again. A changed reason, or new subagent work after the feedback, earns
 *    another reminder. A missing or unreadable transcript keeps the decision above; feedback
 *    older than the tail is not seen.
 *
 * **Fail open everywhere else.** It needs no `cc-smart-dev-kit.json` (the task store is the
 * person's own), and is silent outside git, with no task store, with no caller, and on any read
 * of the task store it cannot make. A store it cannot read and a broken or too-new project file
 * are one stderr line; a crash is the frame's one line. A reminder must never hold a person's
 * work.
 *
 * **`notify` may ask this module's decision** (`keepGoingWouldBlockAt`), as it asks
 * `verify-gate`'s: a stop this hook blocks is not the end of the turn.
 */
import { COMMAND } from "../build-info/names";
import { type CliPaths, cliPaths } from "../cli/paths";
import { locateCheckout, ownHooksOf, type Project } from "../project/resolve";
import { projectKey } from "../tasks/context";
import { TASK_TOOL } from "../tasks/words";
import { callerOf } from "../tasks/work/identity";
import { openPhasesOf, type PhaseRef } from "../tasks/work/phases";
import { AGENT_TOOLS, WORKFLOW_TOOLS } from "./agent-guard";
import { type HookInput, type HookResult, SILENT, stringField } from "./io";
import { SEND_MESSAGE_TOOL } from "./message-guard";
import type { Env, HookContext } from "./run";
import { lastAssistantText, stopFeedbackGiven } from "./transcript";

/** The calls that start or resume a subagent: after one, a given reminder counts as not given. */
const SUBAGENT_WORK: readonly string[] = [...AGENT_TOOLS, ...WORKFLOW_TOOLS, SEND_MESSAGE_TOOL];

/** The hook's name: its bundle, its `ownHooks` entry, its stderr prefix. */
export const KEEP_GOING = "keep-going";

/** The words a line starts with when the turn says what it waits on. */
export const WAIT_MARK = "Waiting for:";

/**
 * The marks a Markdown line may start with: emphasis, a quote, a list dash, a heading's `#`
 * marks, and an ordered list's number (`1.` or `1)`).
 */
const LEADING_MARKS = /^(?:[*_>#\- ]|\d+[.)])+/;

/**
 * True when a line of the answer starts with `Waiting for:` (any case), after the marks a
 * Markdown line may start with (`LEADING_MARKS`).
 */
export function waitsOnSomething(said: string): boolean {
  const mark = WAIT_MARK.toLowerCase();
  return said
    .split(/\r?\n/)
    .some((line) => line.trim().replace(LEADING_MARKS, "").toLowerCase().startsWith(mark));
}

/** The turn's last answer: the input's own field, else the transcript's; null when neither. */
function lastSaid(input: HookInput): string | null {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  const transcript = stringField(input.transcript_path);
  return transcript === null ? null : lastAssistantText(transcript);
}

function named(phase: PhaseRef): string {
  return `#${phase.number} ${phase.subject}`;
}

/** The block's reason: the phases in progress, then the next ready phase or how to close. */
export function keepGoingReason(
  inProgress: readonly PhaseRef[],
  ready: readonly PhaseRef[],
): string {
  const one = inProgress.length === 1;
  const refs = inProgress.map((phase) => `#${phase.number}`).join(", ");
  const head = `${one ? "Phase" : "Phases"} ${inProgress.map(named).join(", ")} ${one ? "is" : "are"} still in progress, and no subagent runs.`;
  const wait = `end the turn with a \`${WAIT_MARK} <what>\` line`;
  const next = ready[0];
  const options: string[] = [];
  for (const phase of inProgress) {
    if (phase.agent !== null) {
      options.push(
        `resume ${one ? "its builder" : `the builder for #${phase.number}`} (\`${phase.agent}\`) with \`${SEND_MESSAGE_TOOL}\` (or start a fresh one)`,
      );
    }
  }
  const fresh = inProgress.filter((phase) => phase.agent === null);
  if (fresh.length > 0) {
    options.push(
      `start ${fresh.length === 1 ? "a fresh builder" : "fresh builders"} on ${one ? "it" : fresh.map((phase) => `#${phase.number}`).join(", ")}`,
    );
  }
  if (next !== undefined) options.push(`start ${named(next)} now (dispatch its builder)`);
  options.push(`close ${refs} with \`${TASK_TOOL.done}\``);
  options.push(`or record ${one ? "the" : "each"} blocker with \`${TASK_TOOL.note}\` and ${wait}`);
  const recovery = options.join(", ");
  return `${head} ${recovery.charAt(0).toUpperCase()}${recovery.slice(1)}. Never move a phase back to pending only to end the turn.`;
}

/**
 * The answer at a Stop of the project found (`root`, `mainCheckout`): the block, one stderr
 * line for a store it cannot read, or silence.
 */
export function keepGoingAnswer(
  input: HookInput,
  project: Pick<Project, "mainCheckout" | "root">,
  paths: CliPaths,
  env: Env,
  findCaller: typeof callerOf = callerOf,
): HookResult {
  if (input.stop_hook_active === true) return SILENT;
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) return SILENT;
  const said = lastSaid(input);
  if (said === null || waitsOnSomething(said)) return SILENT;
  const cwd = stringField(input.cwd);
  if (cwd === null) return SILENT;
  // The caller is looked up only once the store has a phase in progress (`openPhasesOf`).
  const view = openPhasesOf(paths, projectKey(project.mainCheckout ?? project.root), () =>
    findCaller({ env, cwd, claudeConfigDir: paths.claudeConfigDir }),
  );
  if (view.state === "unreadable") return { stderr: `${COMMAND} ${KEEP_GOING}: ${view.why}` };
  if (view.state === "none" || view.value.inProgress.length === 0) return SILENT;
  const reason = keepGoingReason(view.value.inProgress, view.value.ready);
  // Once per stalled state: the same reason, given with no subagent work since, stays given.
  const transcript = stringField(input.transcript_path);
  if (transcript !== null && stopFeedbackGiven(transcript, reason, SUBAGENT_WORK)) return SILENT;
  return { stdout: JSON.stringify({ decision: "block", reason }) };
}

export function keepGoing(context: HookContext): HookResult {
  if (context.event !== "Stop") return SILENT;
  return keepGoingAnswer(context.input, context.project, context.paths, context.env);
}

/**
 * `keepGoing`'s decision at the input's own folder, read the way the frame reads it: the
 * project's `ownHooks` first; its file is never read (a broken one judges the same). For a
 * sibling Stop hook (the notifier). Never throws: what cannot be read blocks nothing.
 */
export function keepGoingWouldBlockAt(input: HookInput, env: Env): boolean {
  const cwd = stringField(input.cwd);
  if (cwd === null) return false;
  try {
    const checkout = locateCheckout(cwd, { env });
    if (checkout === null || ownHooksOf(checkout).includes(KEEP_GOING)) return false;
    return keepGoingAnswer(input, checkout, cliPaths(env), env).stdout !== undefined;
  } catch {
    return false;
  }
}
