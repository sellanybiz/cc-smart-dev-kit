import type { HookSpec } from "../run";
import { verifyGate } from "../verify-gate";

/**
 * The verification gate (`verify-gate.ts`): Stop, one **block** when this session changed
 * files and no Bash call ran the project's fast check (`checks.fast`) after the last change.
 * It names the command, and it is silent on the stop its own block caused
 * (`stop_hook_active`), on a turn that
 * still waits on background work, with no `checks.fast`, and when it cannot read the
 * transcript. Project-scoped: with no cc-smart-dev-kit.json it stays silent. A broken or too
 * new file is one stderr line — an informational hook never stops a person's work.
 */
export const verifyGateHook: HookSpec = {
  name: "verify-gate",
  events: ["Stop"],
  onConfigProblem: (message) => ({ stderr: `cc-smart-dev-kit verify-gate: ${message}` }),
  run: verifyGate,
};
