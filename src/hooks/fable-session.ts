/**
 * SessionStart, PostModelSwitch and Stop: a line to the person, once in a session each, about
 * the model the session's lead runs on (the owner, 2026-10-16; fixed 2026-10-17; the lead hint,
 * 2.2.0, 2026-11-05). Two lines, each with its own mark:
 *
 *   - **the Fable line** (`.fable`): the session's own model is the **`fable` tier**. It spends
 *     the plan's limits faster than Opus, and the person may not have meant it;
 *   - **the lead hint** (`.lead`): the session's own model is anything but Claude Opus — another
 *     Claude family, a backend, or the `opus` tier answered by a backend. The kit works best with
 *     the lead on Claude Opus at high effort; it recommends, it never switches. A person who leads
 *     on a backend on purpose turns it off with `switches.leadHint` (their own workflow file,
 *     `resolveLeadHint`; on by default).
 *
 * A Fable session gets the Fable line only. A session that got the lead hint and later moves to
 * Fable gets the Fable line too: each line has its own mark, so neither hides the other.
 *
 * **Claude never cares which model runs the main session.** Nothing is said to Claude — no
 * `additionalContext`, no error, never a block. The person is told through the `systemMessage`
 * output field ("Display a message to the user (all hooks)", `src/hooks/io.ts` and
 * `docs/claude-code-contract.md`), which costs no model tokens.
 *
 * Which model, at which event:
 *   - **SessionStart**: the `model` the input names, and nothing else (it may be missing, for
 *     example after `/clear` or a recovery: then Stop judges);
 *   - **PostModelSwitch**: `to_model` — the model the session runs AFTER the switch, in Claude
 *     Code's own words ("Resolved model id the session runs after the switch"). So a `/model`
 *     switch is judged at the switch itself;
 *   - **Stop**: the model that last answered in the transcript (`sessionModelOf`, the same
 *     reading the Agent guard's fork rule uses), then `ANTHROPIC_MODEL`. At Stop the last
 *     assistant message IS the answer that just finished, so this is the model that really
 *     answered — the catch-all for a Claude Code that fires no PostModelSwitch. **Stop's input
 *     has no model field**, so every Stop still reads the transcript's tail; nothing here can
 *     save that read.
 *
 * **Why not UserPromptSubmit (the bug this fixes, live 2026-10-17).** It read the transcript's
 * last assistant message at every prompt, which is the PREVIOUS answer's model: the hook ran one
 * turn behind. It missed the switch to Fable, and it fired after the person had switched back to
 * Opus — a warning about Fable, said while on Opus. Stop cannot do that: it judges the answer
 * that just ended, and a switch back is a different answer.
 *
 * The model is read the Agent guard's way (`resolveLaunchModel`: the family name, a Claude id,
 * the family's slot chain while the gateway is on, `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`), so there
 * is no second list of what counts as Fable or Opus — and a tier a backend answers is named by
 * the model that answers it. The gateway is the session's own (`sessionGatewayOf`: its
 * `ANTHROPIC_BASE_URL`, a profile's chains), as in the Agent guard — never the machine's file.
 *
 * **What it costs.** Once both lines are said, the hook stops at the two marks. Otherwise each
 * model is judged once a session: the judgment leaves a mark named after the model (`.judged-…`,
 * `judgedMark`), and a later event for the same model stops there — before the gateway config,
 * Claude Code's settings and the workflow file are read. So an Opus session pays one transcript
 * tail and one `existsSync` per Stop. The judgment is not taken again when a slot or the switch
 * changes mid-session for a model already judged: the hint is a once-a-session note. A session
 * nobody watches (`claude -p`) is told nothing and keeps no mark.
 *
 * **The marks** are `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.<kind>`, beside the
 * session's own name files (`namesDir`, one home), so the OS clears them. A line's mark is made
 * with `wx`, so two runs that race cannot both speak; EEXIST means this session was told. (The
 * owner's live report, 2026-10-17: the line WAS seen, so `systemMessage` reaches the person on
 * UserPromptSubmit at least; that it reaches them on PostModelSwitch and Stop is not proved live
 * yet — `docs/claude-code-contract.md`.)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND, PLUGIN } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { answeringFamily, type LaunchModel, resolveLaunchModel } from "../models/launch-policy";
import { resolveLeadHint } from "../workflow/resolve";
import { sessionGatewayOf, sessionModelOf } from "./agent-guard";
import { type HookInput, type HookResult, SILENT, stringField, systemMessage } from "./io";
import type { Env } from "./run";
import { isSessionId, namesDir } from "./session-name";

/** The Fable line the person sees, once a session: `named` is how the message calls the model. */
export function fableSessionMessage(named: string): string {
  return `${COMMAND}: this session runs on ${named}, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.`;
}

/**
 * The lead hint the person sees, once a session: `named` is how it calls the model. When a
 * backend answers the `opus` tier itself (`viaGateway`), `/model` cannot fix it — choosing Opus
 * reaches the same slot — so the hint names the gateway's opus slot and a session on plain Claude.
 */
export function leadHintMessage(named: string, viaGateway = false): string {
  const fix = viaGateway
    ? `Put Claude Opus first in the gateway's opus slot (/${PLUGIN}:gateway), or start the session with ${COMMAND} launch --no-gateway.`
    : "Switch with /model.";
  return `${COMMAND}: this session runs on ${named}. The kit works best with the lead on Claude Opus at high effort. ${fix} (To stop this hint: ${COMMAND} workflow set switches.leadHint false.)`;
}

/**
 * How a line names the model behind the session. A Claude model by its family (`Claude Fable`,
 * `Claude Sonnet`), read from the model that answers — never the NAME's family, which
 * `resolveLaunchModel` keeps through a slot. A backend by its tier or family and the model that
 * answers it (`the \`opus\` model, omniroute:glm-x`). Anything else as it is named.
 */
export function sessionModelName(real: LaunchModel): string {
  if (real.claude) {
    const family = answeringFamily(real);
    return family === null
      ? real.model
      : `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)}`;
  }
  const tier = real.tier ?? real.family;
  return tier === null ? real.model : `the \`${tier}\` model, ${real.model}`;
}

/** The marks the hook keeps, per session, beside the session's own name files. */
export type SessionMarkKind = "fable" | "lead";

/** The mark that says this session was told one line. */
export function sessionMark(env: Env, sessionId: string, kind: SessionMarkKind): string {
  return join(namesDir(env), `${sessionId}.${kind}`);
}

/** The mark that says this session was told the Fable line. */
export function fableSessionMark(env: Env, sessionId: string): string {
  return sessionMark(env, sessionId, "fable");
}

/**
 * The mark that says `model` was judged in this session: nothing new can be said about it. Named
 * by a short hash, since a model text may hold `:`, `/` or `[`.
 */
export function judgedMark(env: Env, sessionId: string, model: string): string {
  const hash = createHash("sha256").update(model).digest("hex").slice(0, 16);
  return join(namesDir(env), `${sessionId}.judged-${hash}`);
}

/**
 * True the first time this mark is made. It is created with `wx`, so a run that races another
 * cannot speak as well. False when it is there already (EEXIST) — another run told this session —
 * or when it cannot be made at all: a line is never said twice, so not at all then.
 */
function firstTime(mark: string): boolean {
  try {
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/** What the session's model calls for: the Fable line, the lead hint, or nothing. */
export type LeadVerdict = "fable" | "lead" | "none";

/**
 * The verdict for a session whose model resolves to `real`: the `fable` tier → the Fable line;
 * the `opus` tier answered by Claude Opus, or by Claude Fable the person mapped behind it (the
 * owner, 2026-11-11) → nothing; anything else — another Claude family, a backend, the `opus` tier
 * a backend answers, a name no rule reads as a family — → the lead hint.
 */
export function leadVerdict(real: LaunchModel): LeadVerdict {
  if (real.tier === "fable") return "fable";
  const answered = answeringFamily(real);
  if (real.tier === "opus" && (answered === "opus" || answered === "fable")) return "none";
  return "lead";
}

/** The current model per event; null when the event names none. */
function currentModel(event: string, input: HookInput, env: Env): null | string {
  // A start names it, a switch names the model it moved TO (`to_model`), and a stop is judged by
  // the answer that just finished — the only reading that cannot fire for a model the session
  // has already left.
  if (event === "SessionStart") return stringField(input.model);
  if (event === "PostModelSwitch") return stringField(input.to_model);
  return sessionModelOf(input, env);
}

/** One `systemMessage` when this session's model calls for a line not said yet. Else silent. */
export function fableSession(input: HookInput, env: Env, paths: CliPaths): HookResult {
  const event = stringField(input.hook_event_name);
  const sessionId = input.session_id;
  if (event === null || !isSessionId(sessionId)) return SILENT;
  // Nobody watches a `claude -p` session: no line, and no mark either.
  if ((env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0") return SILENT;
  const fableMark = sessionMark(env, sessionId, "fable");
  const leadMark = sessionMark(env, sessionId, "lead");
  // Both lines said: nothing left to say, and nothing to read. This hook runs at every stop.
  if (existsSync(fableMark) && existsSync(leadMark)) return SILENT;
  const model = currentModel(event, input, env);
  if (model === null) return SILENT;
  const judged = judgedMark(env, sessionId, model);
  if (existsSync(judged)) return SILENT;
  // The gateway THIS session runs on (its own `ANTHROPIC_BASE_URL`, a profile's chains), never
  // the machine's file: a project set to `off` is on the login, a profile has its own chains.
  const real = resolveLaunchModel(model, sessionGatewayOf(paths, env), env);
  const verdict = leadVerdict(real);
  let said: HookResult = SILENT;
  if (verdict === "fable" && firstTime(fableMark)) {
    said = systemMessage(fableSessionMessage(sessionModelName(real)));
  } else if (verdict === "lead" && resolveLeadHint(paths).value && firstTime(leadMark)) {
    const viaGateway = real.tier === "opus" && !real.claude;
    said = systemMessage(leadHintMessage(sessionModelName(real), viaGateway));
  }
  // Judged: whatever the verdict, this model has nothing more to say in this session. A mark
  // that cannot be made only means the next event judges it again.
  firstTime(judged);
  return said;
}
