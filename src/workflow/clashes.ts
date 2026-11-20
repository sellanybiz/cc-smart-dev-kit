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
  allowPush: boolean;
  allowMerge: boolean;
}

/** One conflict: the setting it is about, the `!` line a screen shows, and the fix. */
export interface Clash {
  setting: "allowMerge" | "allowPush" | "openPr";
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
  // A pull request needs the branch pushed. With allowPush off a session does not push, so the
  // pull request waits for a person who was not expecting to be asked.
  if (input.openPr !== "off" && !input.allowPush) {
    clashes.push({
      fix: `turn allowPush on (\`${COMMAND} workflow set allowPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`)`,
      line: "openPr opens a pull request, but allowPush is off: a session does not push, and that pull request needs the push, so it waits for you every time",
      setting: "openPr",
    });
  }
  // A draft pull request is never merged, so allowMerge can never act on the one a session opens.
  if (input.allowMerge && input.openPr === "draft") {
    clashes.push({
      fix: `set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn allowMerge off (\`${COMMAND} workflow set allowMerge false\`)`,
      line: "openPr is draft and allowMerge is on: a draft pull request is never merged, so allowMerge never acts on the pull request a session opens",
      setting: "openPr",
    });
  }
  return clashes;
}

/** The conflicts of a resolved policy. */
export function clashesOf(resolved: ResolvedWorkflow): Clash[] {
  return workflowClashes({
    allowMerge: resolved.allowMerge.value,
    allowPush: resolved.allowPush.value,
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
