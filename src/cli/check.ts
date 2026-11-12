/**
 * One line of `doctor`'s report: the one type every check returns, wherever it is made (the
 * plugin's own checks in `doctor.ts`, the gateway's, the browser's, the MCP servers', the
 * companions', the project's). The portal's Machine page shows the same lines.
 *
 * **A failure always carries its fix.** `ok: false` needs `fix`: the command to run, or the one
 * step a person takes when no command does it. The type checker refuses a failed check
 * without one, so `doctor` can print a `Fix:` line under every ✗ (UX-5, UX-13). `text` says
 * what is wrong, and never repeats the fix.
 *
 * Types only, and a small table: nothing here prints. How a check is printed is `out.ts`'s.
 */

/** The word before a fix, wherever one is shown: `doctor`, the portal, the installers. */
export const FIX_LABEL = "Fix:";

/** What a check says, and the mark it is printed with (`out.ts`'s `Mark`). */
interface CheckWords {
  text: string;
  /** Which group of the report it belongs to. `doctorChecks` sets it on every line. */
  group?: CheckGroup;
}

/** A check that passed, or a line that is information (`info`) or a warning (`warn`). */
export interface CheckPassed extends CheckWords {
  ok: true;
  /** Information only: printed with `·`, never a failure. */
  info?: boolean;
  /** A warning: printed with `!`, never a failure. */
  warn?: boolean;
  /** What to do about a warning or a note, when there is something to do. */
  fix?: string;
}

/** A check that failed: what is wrong, and what fixes it. */
export interface CheckFailed extends CheckWords {
  ok: false;
  info?: undefined;
  warn?: undefined;
  /** The command that fixes it, or the one step a person takes. Printed as `Fix: <fix>`. */
  fix: string;
}

export type Check = CheckPassed | CheckFailed;

/** How a check reads: passed, failed, a warning, or information. */
export type CheckStatus = "fail" | "info" | "ok" | "warn";

export function checkStatus(check: Check): CheckStatus {
  if (!check.ok) return "fail";
  if (check.warn === true) return "warn";
  if (check.info === true) return "info";
  return "ok";
}

/**
 * The groups of `doctor`'s report, in the order it prints them, each with the title a person
 * reads. The one home of the list: `doctor`, its `--json` and the portal read it here.
 */
export const CHECK_GROUPS = [
  { id: "plugin", title: "The plugin" },
  { id: "updates", title: "Updates" },
  { id: "companions", title: "Companion plugins" },
  { id: "mcp", title: "MCP servers" },
  { id: "browser", title: "Browser" },
  { id: "alerts", title: "Alerts and limits" },
  { id: "project", title: "This project" },
  { id: "gateway", title: "Gateway" },
  { id: "herdr", title: "Herdr sessions" },
  { id: "live", title: "Live check" },
] as const;

export type CheckGroup = (typeof CHECK_GROUPS)[number]["id"];

/** A group's title, as `doctor` prints it. */
export function groupTitle(group: CheckGroup): string {
  return CHECK_GROUPS.find((entry) => entry.id === group)?.title ?? group;
}
