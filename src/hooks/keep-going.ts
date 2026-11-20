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
 * 4. **Work to drive** (`openPhasesOf`): a phase in progress that this Claude process works on
 *    (a phase of a plan whose plan task it owns, or a phase it claims a step in), or ready
 *    phases of its plan in flight with none in progress (pending, nothing open blocks them, a
 *    live task each). The store is read first; the caller is looked up only when some phase is
 *    in progress or a plan in flight has a startable phase, since off Linux that lists the
 *    running processes. A parked plan and another session's plan are not this one's business.
 *    **Then the lead's plans** (`leadPlansReason`), only when the own plan gives no reason: a
 *    plan with a running Herdr child names `herdr wait`; a plan closed and still reserved for
 *    this lead (its pull request not merged, and what waits behind it) names `herdr plans --wait`;
 *    a plan whose child is gone names `herdr start --plan <slug>`. They come from the store's
 *    classifier alone (`classifyLeadPlans`): no git, no gh, no hc, and no session record read for
 *    a child that runs. The caller is looked up only when some plan is reserved.
 * 5. **This reason not already given** (`stopFeedbackGiven`): read only after a phase in
 *    progress or a ready phase is found, from the transcript's default tail (`TRANSCRIPT_TAIL_BYTES`). The same
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
import { isHerdrAgent } from "../herdr/labels";
import { locateCheckout, ownHooksOf, type Project } from "../project/resolve";
import { projectKey } from "../tasks/context";
import { TASK_TOOL } from "../tasks/words";
import { CLAIM_PROCESS, callerOf } from "../tasks/work/identity";
import { classifyLeadPlans, type LeadPlan, type LeadPlanState } from "../tasks/work/lead-plans";
import { openPhasesOf, type PhaseRef } from "../tasks/work/phases";
import { allTasks } from "../tasks/work/queries";
import { type ReadState, readWorkStore } from "../tasks/work/read";
import type { ClaimProcess, Who } from "../tasks/work/types";
import { cappedHookList, HOOK_LIST_LIMIT } from "./capped-list";
import { type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { Env, HookContext } from "./run";
import { AGENT_TOOLS, WORKFLOW_TOOLS } from "./session-facts";
import { lastAssistantText, stopFeedbackGiven } from "./transcript";

/** Claude Code's tool that messages another agent or session; it resumes a builder. */
const SEND_MESSAGE_TOOL = "SendMessage";

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

/** The ready phases, in the words a start option names them, capped like every hook list. */
function readyNames(ready: readonly PhaseRef[]): string {
  return cappedHookList(ready, named, TASK_TOOL.list);
}

/**
 * The reason when no phase runs but the plan in flight has phases that could start: name every
 * one, and tell the session to dispatch their builders together.
 */
function readyReason(ready: readonly PhaseRef[]): string {
  const one = ready.length === 1;
  const names = readyNames(ready);
  const head = one
    ? `Phase ${names} is ready to start, and no subagent runs.`
    : `${ready.length} phases are ready to start, and no subagent runs: ${names}.`;
  const start = one
    ? "Start it now (dispatch its builder)"
    : "Start them together now (dispatch one builder for each)";
  return `${head} ${start}, or record why ${one ? "it waits" : "they wait"} with \`${TASK_TOOL.note}\` and end the turn with a \`${WAIT_MARK} <what>\` line. To hold the plan longer, park it (\`${TASK_TOOL.update}\` its plan task to \`pending\`).`;
}

/**
 * The block's reason: the phases in progress, then the ready phases or how to close; with no
 * phase in progress, the ready phases alone (`readyReason`).
 */
export function keepGoingReason(
  inProgress: readonly PhaseRef[],
  ready: readonly PhaseRef[],
): string {
  if (inProgress.length === 0) return readyReason(ready);
  const one = inProgress.length === 1;
  const shown = inProgress.slice(0, HOOK_LIST_LIMIT);
  const refs = shown.map((phase) => `#${phase.number}`).join(", ");
  const names = cappedHookList(inProgress, named, TASK_TOOL.list);
  const head = one
    ? `Phase ${names} is still in progress, and no subagent runs.`
    : `${inProgress.length} phases are still in progress, and no subagent runs: ${names}.`;
  const wait = `end the turn with a \`${WAIT_MARK} <what>\` line`;
  const options: string[] = [];
  for (const phase of shown) {
    if (phase.agent !== null) {
      if (isHerdrAgent(phase.agent)) {
        options.push(
          `wait for Herdr child \`${phase.agent}\` with \`${COMMAND} herdr wait\` in the background, or use \`${COMMAND} herdr send\` to continue it`,
        );
        continue;
      }
      options.push(
        `resume ${one ? "its builder" : `the builder for #${phase.number}`} (\`${phase.agent}\`) with \`${SEND_MESSAGE_TOOL}\` (or start a fresh one)`,
      );
    }
  }
  const fresh = shown.filter((phase) => phase.agent === null);
  if (fresh.length > 0) {
    options.push(
      `start ${fresh.length === 1 ? "a fresh builder" : "fresh builders"} on ${one ? "it" : fresh.map((phase) => `#${phase.number}`).join(", ")}`,
    );
  }
  if (ready.length === 1) options.push(`start ${readyNames(ready)} now (dispatch its builder)`);
  else if (ready.length > 1)
    options.push(`start ${readyNames(ready)} together now (dispatch their builders)`);
  options.push(
    `close ${inProgress.length > shown.length ? "every phase (including those not shown)" : refs} with \`${TASK_TOOL.done}\``,
  );
  options.push(`or record ${one ? "the" : "each"} blocker with \`${TASK_TOOL.note}\` and ${wait}`);
  const recovery = options.join(", ");
  return `${head} ${recovery.charAt(0).toUpperCase()}${recovery.slice(1)}. Never move a phase back to pending only to end the turn.`;
}

/** A plan the lead's reason names: `#<number> <subject>`, with the slug the commands take. */
function planNamed(entry: LeadPlan): string {
  return `#${entry.plan.number} ${entry.plan.subject}`;
}

/**
 * The reason when the lead's own plan gives none but its plans wait on others, in this order and
 * each only when it applies: plans with a running child (`herdr wait`), plans closed and still
 * reserved, whose pull request has not merged (`herdr plans --wait`: the signal that a blocker
 * merged), and plans whose child is gone (`herdr start --plan` resumes in the recorded worktree).
 * Null when nothing of these holds. Plans that only queue, or are ready by the store, give none:
 * the lead hands those out at its own pace.
 */
export function leadPlansReason(led: readonly LeadPlan[]): string | null {
  const ofState = (state: LeadPlanState) => led.filter((entry) => entry.state === state);
  const withChild = ofState("with-child");
  const merging = ofState("merging");
  const gone = ofState("child-gone");
  const names = (entries: readonly LeadPlan[]) =>
    cappedHookList(entries, planNamed, TASK_TOOL.list);
  const parts: string[] = [];
  if (withChild.length > 0)
    parts.push(
      `${withChild.length === 1 ? "Plan" : "Plans"} ${names(withChild)} ${withChild.length === 1 ? "has" : "have"} a Herdr child at work: wait for it with \`${COMMAND} herdr wait\` in the background`,
    );
  if (merging.length > 0)
    parts.push(
      `${merging.length === 1 ? "Plan" : "Plans"} ${names(merging)} ${merging.length === 1 ? "is" : "are"} closed, and ${merging.length === 1 ? "its" : "their"} pull request may not be merged yet: wait for the merge, and for what it frees, with \`${COMMAND} herdr plans --wait\` in the background`,
    );
  if (gone.length > 0)
    parts.push(
      `The child of ${names(gone)} is gone: resume ${gone.length === 1 ? "it" : "each"} with ${gone
        .slice(0, HOOK_LIST_LIMIT)
        .map((entry) => `\`${COMMAND} herdr start --plan ${entry.plan.plan}\``)
        .join(", ")}`,
    );
  if (parts.length === 0) return null;
  return `${parts.join(". ")}. Or record what you wait on with \`${TASK_TOOL.note}\` and end the turn with a \`${WAIT_MARK} <what>\` line.`;
}

/**
 * The lead's plans, when some plan of the project is reserved at all: a plan with no lead needs
 * no caller, so the caller (which may list processes off Linux) is looked up only then. Read from
 * the store alone, like `openPhasesOf`.
 */
function leadPlansOf(
  paths: CliPaths,
  project: string,
  caller: () => Who | null,
  claimProcess: ClaimProcess,
): ReadState<LeadPlan[]> {
  return readWorkStore(paths, (db) => {
    if (!allTasks(db, project).some((task) => task.kind === "plan" && task.lead !== null))
      return [];
    const who = caller();
    return who === null ? [] : classifyLeadPlans(db, project, who, claimProcess);
  });
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
  /** The machine's answers about a child's process; the real ones by default. */
  claimProcess: ClaimProcess = CLAIM_PROCESS,
): HookResult {
  if (input.stop_hook_active === true) return SILENT;
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) return SILENT;
  const said = lastSaid(input);
  if (said === null || waitsOnSomething(said)) return SILENT;
  const cwd = stringField(input.cwd);
  if (cwd === null) return SILENT;
  const key = projectKey(project.mainCheckout ?? project.root);
  // Asked once for both reads: the plans' read may follow the phases'.
  let found: { who: Who | null } | undefined;
  const caller = (): Who | null => {
    found ??= { who: findCaller({ env, cwd, claudeConfigDir: paths.claudeConfigDir }) };
    return found.who;
  };
  // The caller is looked up only once the store has a phase in progress or a startable phase (`openPhasesOf`).
  const view = openPhasesOf(paths, key, caller);
  if (view.state === "unreadable") return { stderr: `${COMMAND} ${KEEP_GOING}: ${view.why}` };
  if (view.state === "none") return SILENT;
  let reason: string | null = null;
  if (view.value.inProgress.length > 0 || view.value.ready.length > 0) {
    // The caller's own plan first: the children and the merge wait come only when it gives no reason.
    reason = keepGoingReason(view.value.inProgress, view.value.ready);
  } else {
    const plans = leadPlansOf(paths, key, caller, claimProcess);
    if (plans.state === "unreadable") return { stderr: `${COMMAND} ${KEEP_GOING}: ${plans.why}` };
    if (plans.state === "ready") reason = leadPlansReason(plans.value);
  }
  // Nothing runs, nothing is ready to start and no child or merge is awaited: nothing to keep going on.
  if (reason === null) return SILENT;
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
