/**
 * The switches that leave the machine and the words that tell a person how to turn one on.
 * Like `auto-merge.ts`, each is a decision with the words the person reads, and nothing here
 * runs a command. The values are read as `merge-check` reads its gate (`resolveGate`): the
 * built-in default, the person's own `workflow.json`, and the project's file **as committed on
 * `origin/<base>`**. `base` is the branch whose committed file the value was read from, or null
 * when none was named.
 */
import { COMMAND } from "../build-info/names";
import { CONFIG_PATH } from "../project/resolve";
import { type ResolvedWorkflow, sourceLabel } from "./resolve";

/**
 * How a person turns a switch on, in the words of every question below and of `issue file`'s
 * refusals (one home). A dotted key (`issues.enabled`) is written nested in the project's file.
 */
export function turnOn(
  key: "autoPush" | "issues.allowPublic" | "issues.enabled" | "openPr",
  value: string,
  base: string | null,
): string {
  const where = base ?? "the integration base (worktrees.base)";
  const literal = value === "true" ? "true" : `"${value}"`;
  const json = key.split(".").reduceRight((inner, part) => `{"${part}": ${inner}}`, literal);
  return `turn it on for yourself with \`${COMMAND} workflow set ${key} ${value}\`, or for the project in ${CONFIG_PATH} ("workflow": ${json}), committed to ${where} and pushed`;
}

/**
 * Why `issue file` refuses, or null when `issues.enabled` is on. The switch is on by default
 * (the owner's choice, 5.0.0), so this refuses only where a person or project set it off. An
 * issue is text that leaves the machine for GitHub (D67).
 */
export function issuesOff(resolved: ResolvedWorkflow, base: string | null): string | null {
  if (resolved.issues.enabled.value) return null;
  return `issues.enabled is off (${sourceLabel(resolved.issues.enabled, base)}), so the kit files no GitHub issue: ${turnOn("issues.enabled", "true", base)}`;
}

/**
 * Why `issue file` refuses a PUBLIC repository, or null when `issues.allowPublic` is on: an
 * issue there is read by everyone, so it is its own yes.
 */
export function publicIssuesOff(resolved: ResolvedWorkflow, base: string | null): string | null {
  if (resolved.issues.allowPublic.value) return null;
  return `this repository is public, where everyone reads an issue, and issues.allowPublic is off (${sourceLabel(resolved.issues.allowPublic, base)}): ${turnOn("issues.allowPublic", "true", base)}`;
}
