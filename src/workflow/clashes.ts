/**
 * The workflow settings that cannot work together (D16). One pure function, called by
 * everything that shows or writes a setting — `workflow show`, `workflow set`, `project init`
 * and the portal's Settings page — so a person hears about the same conflict in the same words
 * everywhere, with the fix.
 *
 * A "cannot work" pair is not an error. It is a setting
 * that will never do what the person meant, which is worth knowing before a session waits for
 * something that never happens.
 */
import { COMMAND } from "../build-info/names";
import type { ResolvedWorkflow } from "./resolve";

/** The settings the rules below read. */
export interface ClashInput {
  openPr: "off" | "draft" | "ready";
  autoPush: boolean;
  autoMerge: boolean;
}

/** One conflict: the setting it is about, the `!` line a screen shows, and the fix. */
export interface Clash {
  setting: "autoMerge" | "autoPush" | "openPr";
  /** What cannot work, and why. */
  line: string;
  /** What to change, as the person would. */
  fix: string;
}

/**
 * Every conflict `input` holds, in the order a person reads them. Empty when the settings
 * work together.
 */
export function workflowClashes(input: ClashInput): Clash[] {
  const clashes: Clash[] = [];
  // A pull request needs the branch pushed. With autoPush off a session does not push, so the
  // pull request waits for a person who was not expecting to be asked.
  if (input.openPr !== "off" && !input.autoPush) {
    clashes.push({
      fix: `turn autoPush on (\`${COMMAND} workflow set autoPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`)`,
      line: "openPr opens a pull request, but autoPush is off: a session does not push, and that pull request needs the push, so it waits for you every time",
      setting: "openPr",
    });
  }
  // A draft pull request is never merged, so autoMerge can never act on the one a session opens.
  if (input.autoMerge && input.openPr === "draft") {
    clashes.push({
      fix: `set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn autoMerge off (\`${COMMAND} workflow set autoMerge false\`)`,
      line: "openPr is draft and autoMerge is on: a draft pull request is never merged, so autoMerge never acts on the pull request a session opens",
      setting: "openPr",
    });
  }
  return clashes;
}

/** The conflicts of a resolved policy. */
export function clashesOf(resolved: ResolvedWorkflow): Clash[] {
  return workflowClashes({
    autoMerge: resolved.autoMerge.value,
    autoPush: resolved.autoPush.value,
    openPr: resolved.openPr.value,
  });
}

/** One clash as the person reads it: what cannot work, then the fix. */
export function clashNote(clash: Clash): string {
  return `${clash.line}. Fix: ${clash.fix}.`;
}

/** The `!` lines a screen shows for those conflicts: each line, then its fix. */
export function clashLines(clashes: readonly Clash[]): string[] {
  return clashes.map((one) => `! ${clashNote(one)}`);
}
