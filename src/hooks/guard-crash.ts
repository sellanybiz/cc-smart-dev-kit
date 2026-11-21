/**
 * A guard's answer when its own code throws. It has its own module so a hook spec can use it
 * without importing `specs.ts` (which imports every spec): that would be an import cycle, and
 * a cycle throws when the bundle loads — and `user-away` runs with `onFailure: block`.
 */
import { type HookInput, type HookResult, SILENT, toolDecision } from "./io";
import type { HookSpec } from "./run";

/** Said to the person when a guard cannot read the project's cc-smart-dev-kit.json. */
function cannotCheck(what: string, message: string): string {
  return `cc-smart-dev-kit cannot check ${what}: ${message}`;
}

/**
 * A guard's answer when its own code throws: **ask the person about the call in the
 * guard's own domain**. A crash must never let a call through — that is the whole point of
 * the answer — and a guard that cannot judge a call asks.
 *
 * `inDomain` says whether the call is one the guard judges: a call outside its domain is
 * none of its business, and the guard stays silent. With an input the frame could not read
 * (the hook input was not JSON) the guard asks in general: it cannot tell what the call is.
 * A domain check that throws itself is no reason to let the call through: the guard asks.
 *
 * The event: a guard's bundle runs on PreToolUse, where it answers; the agent guard also
 * runs on PostToolUse, to record a launch that ran. A crash there has nothing to ask about —
 * the call already ran — so it says nothing, and the frame's one line on stderr is all. An
 * event the frame could not read counts as the guard's own, PreToolUse.
 */
export function guardCrash(
  what: string,
  inDomain: (input: HookInput) => boolean,
): NonNullable<HookSpec["onCrash"]> {
  return (why: string, input: HookInput | null, event: string): HookResult => {
    if (event !== "" && event !== "PreToolUse") return SILENT;
    if (input !== null && !judgesCall(inDomain, input)) return SILENT;
    return toolDecision("ask", cannotCheck(what, why));
  };
}

/** True when the guard judges this call; true too when the check itself throws. */
function judgesCall(inDomain: (input: HookInput) => boolean, input: HookInput): boolean {
  try {
    return inDomain(input);
  } catch {
    return true;
  }
}
