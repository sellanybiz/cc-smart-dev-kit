/**
 * SessionStart and UserPromptSubmit: tell Claude what each subagent tier runs now, so it can name
 * the model when it launches. The tier and the effort are chosen by the job, never by the model
 * behind a tier (2.2.0, the owner, 2026-11-05; `/cc-smart-dev-kit:subagent-decision`). Nothing
 * used to tell a session what answered its tiers: the launch judge knew, and the session read
 * "the gateway is on".
 *
 * **What it says.** `tierNote` (`src/models/tier-view.ts`): a header and one line per tier the
 * Agent tool's `model` names, read the launch judge's way (`resolveLaunchModel`) through the
 * session's own gateway view (`sessionGatewayOf`: its effective `ANTHROPIC_BASE_URL`, a profile's
 * chains) — never a second list. The gateway off says that every tier is Claude, in the same
 * lines: the instructions' effort rule reads the note, so a session without a gateway needs it
 * as much as one with.
 *
 * **When.** At every SessionStart (a start, a resume, a clear, a compaction: each builds Claude's
 * context again, and the hook's `hooks.json` entry carries no matcher), and at a
 * UserPromptSubmit **only when the note differs from the one said last in this session** — the
 * owner may change a slot while sessions run, and each line costs context in every session on
 * the machine. The last note is kept in `<TMPDIR>/cc-smart-dev-kit-session-names/<session>.tiers`,
 * beside the session's other marks (`namesDir`), so the OS clears it. A prompt in a session the
 * hook never saw start (the plugin updated mid-session) says it once. A mark that cannot be kept
 * makes a prompt silent: a note that cannot be remembered would repeat at every prompt.
 *
 * **Why UserPromptSubmit and not a PreToolUse on the Agent tool.** A hook there answers a launch
 * after Claude chose its effort; a note there arrives too late and costs a denied call. A
 * prompt's context reaches Claude before it picks.
 *
 * **Why a hook of its own.** `fable-session` runs at the same events but speaks to the person
 * and never to Claude (its contract); `session-name` names the session. Neither has this job.
 *
 * **One more line, while auto mode's safety checks fail** (the owner, 2026-10-27): when the
 * router has recorded that Claude is limited or down and nothing stood in for it
 * (`checksDownNote`, `src/gateway/checks-down.ts`), the session's gateway scope is told once,
 * under the tiers: the checks fail, it cannot fix that, who can and how, and to stop and wait
 * rather than retry. Claude Code's own message to the model says the checker is "temporarily
 * unavailable" and to try again; this line is why it should not. It rides the same marks: said at
 * every start, and at a prompt only when the note differs from the last one said, so it appears
 * when the checks start failing and the tiers' note repeats when they recover. Only a session on
 * the gateway gets it (`sessionGatewayOf`), its own profile's record only.
 *
 * **Machine-wide**, like the launch judge whose view it reads: the note never depends on the
 * project's file, and a folder outside git gets it too (its subagents run on these tiers). A
 * config that cannot be read is said plainly, never a crash; the address
 * of a proxy that is not the kit's gateway (no `gateway.json`) is read as Claude, the guard's
 * way. Never a question and never a block.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { checksDownNote, checksDownNow } from "../gateway/checks-down";
import { scopeOfStateKey } from "../gateway/limit-state";
import { tierNote } from "../models/tier-view";
import { addContext, type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { Env } from "./run";
import { sessionGatewayOf } from "./session-facts";
import { isSessionId, namesDir } from "./session-name";

/** The note when the gateway is on and its config cannot be used: the view is not known. */
export function tierNoteUnknown(): string {
  return `Subagent tiers now: not known — the gateway config cannot be read (\`${COMMAND} doctor\` says why). The launch policy names the effort each launch needs.`;
}

/** The mark that holds the note this session was told last, beside the session's name files. */
export function tierViewMark(env: Env, sessionId: string): string {
  return join(namesDir(env), `${sessionId}.tiers`);
}

/**
 * The note for this session's own gateway view. A session on a gateway address whose
 * `gateway.json` exists but cannot be used has a view nobody can prove: the plain note says so.
 */
export function currentNote(paths: CliPaths, env: Env): string {
  const gateway = sessionGatewayOf(paths, env);
  if (gateway.gatewayOn && gateway.config === null && existsSync(paths.gatewayConfigFile)) {
    return tierNoteUnknown();
  }
  return tierNote(gateway, env);
}

/**
 * The line for this session's gateway scope while auto mode's safety checks fail, or null: no
 * record, a session off the gateway, or a record that went stale (`currentChecksDown`).
 */
export function checksNote(paths: CliPaths, env: Env, nowMs: number): null | string {
  const gateway = sessionGatewayOf(paths, env);
  if (!gateway.gatewayOn) return null;
  const found = checksDownNow(paths.gatewayStateFile, nowMs).find(
    ([key]) => scopeOfStateKey(key).profile === gateway.profile,
  );
  return found === undefined ? null : checksDownNote(found[1], gateway.profile, nowMs);
}

/** The note last said in this session, or null: no mark, or one that cannot be read. */
function lastSaid(mark: string): null | string {
  try {
    return readFileSync(mark, "utf8");
  } catch {
    return null;
  }
}

/** Keeps `note` as the last said. False when the mark cannot be written. */
function keep(mark: string, note: string): boolean {
  try {
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, note);
    return true;
  } catch {
    return false;
  }
}

/**
 * The note as context at a start, or at a prompt when what the tiers run has changed.
 */
export function tierView(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  nowMs: number = Date.now(),
): HookResult {
  const event = stringField(input.hook_event_name);
  if (event !== "SessionStart" && event !== "UserPromptSubmit") return SILENT;
  const sessionId = input.session_id;
  const mark = isSessionId(sessionId) ? tierViewMark(env, sessionId) : null;
  const checks = checksNote(paths, env, nowMs);
  const note =
    checks === null ? currentNote(paths, env) : [currentNote(paths, env), checks].join("\n\n");
  if (event === "SessionStart") {
    // A new context every time: said whatever the mark holds, and kept for the prompts after it.
    if (mark !== null) keep(mark, note);
    return addContext(event, note);
  }
  if (mark === null || !isSessionId(sessionId)) return SILENT;
  // Said only when it can be remembered: else the next prompt would say it again.
  return lastSaid(mark) !== note && keep(mark, note) ? addContext(event, note) : SILENT;
}
