/**
 * The two switches that leave the machine and that a hook enforces (D15, D16): `autoPush`,
 * which the git guard reads before any `git push`, and `openPr`, which the merge guard reads
 * before `gh pr create` and `gh pr ready`. Like `auto-merge.ts`, each is a decision with the
 * words the person reads when the guard asks, and nothing here runs a command.
 *
 * Both are read as the merge guard reads its gate (`resolveGate`): the built-in default, the
 * person's own `workflow.json`, and the project's file **as committed on `origin/<base>`**,
 * never a checkout's working copy, which a session can edit. `base` is the branch whose
 * committed file the value was read from, or null when none was named.
 */
import { COMMAND } from "../build-info/names";
import { CONFIG_PATH } from "../project/resolve";
import { type ResolvedWorkflow, sourceLabel } from "./resolve";

/** How a person turns a switch on, in the words of every question below. */
function turnOn(key: "autoPush" | "openPr", value: string, base: string | null): string {
  const where = base ?? "the integration base (worktrees.base)";
  return `turn it on for yourself with \`${COMMAND} workflow set ${key} ${value}\`, or for the project in ${CONFIG_PATH} ("workflow": {"${key}": ${value === "true" ? "true" : `"${value}"`}}), committed to ${where} and pushed`;
}

/**
 * Why the git guard asks before a `git push`, or null when `autoPush` is on. A push leaves
 * the machine, and an undone commit is easy while a pushed one is not (D15); `autoCommit`
 * stays guidance, because a commit is local.
 */
export function autoPushOff(resolved: ResolvedWorkflow, base: string | null): string | null {
  if (resolved.autoPush.value) return null;
  return `autoPush is off (${sourceLabel(resolved.autoPush, base)}), so a push is yours to approve: ${turnOn("autoPush", "true", base)}`;
}

/** What a command does to a pull request that `openPr` governs. */
export interface Opening {
  kind: "create" | "ready";
  /** It opens as a draft (`gh pr create --draft`). */
  draft: boolean;
}

/**
 * Why the merge guard asks before this pull request is opened or made ready, or null when
 * `openPr` allows it: `ready` allows both; `draft` allows a pull request that opens as a draft
 * and asks for one that opens ready and for every `gh pr ready`; `off` allows neither.
 */
export function openPrRefusal(
  resolved: ResolvedWorkflow,
  base: string | null,
  opening: Opening,
): string | null {
  const { value } = resolved.openPr;
  const from = sourceLabel(resolved.openPr, base);
  if (value === "ready") return null;
  if (value === "draft") {
    if (opening.kind === "create" && opening.draft) return null;
    return opening.kind === "ready"
      ? `openPr is draft (${from}), so marking a pull request ready for review is yours to decide: ${turnOn("openPr", "ready", base)}`
      : `openPr is draft (${from}), and this pull request does not open as a draft (add \`--draft\`): ${turnOn("openPr", "ready", base)}`;
  }
  return `openPr is off (${from}), so opening or readying a pull request is yours to approve: ${turnOn("openPr", "draft", base)}`;
}
