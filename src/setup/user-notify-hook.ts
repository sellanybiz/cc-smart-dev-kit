import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { LAUNCHER_IN_SHELL } from "./launcher";
import { type HookEntry, isHookEntry, removeManagedHooks, runsPluginNotify } from "./managed-hook";
import { isObject, readJsonObject } from "./managed-json";
import { removeManagedLines } from "./managed-line";
import { forgetManagedLines, readChanged, realTarget } from "./write";

/** Retirement identifiers only. No notification implementation remains. */
export const USER_NOTIFY_COMMAND = `${LAUNCHER_IN_SHELL} hook notify`;
export const USER_NOTIFY_ENTRY: HookEntry = {
  matcher: "agent_needs_input|agent_completed",
  hooks: [{ type: "command", command: USER_NOTIFY_COMMAND, timeout: 10 }],
};
const TMUX_LINE = "set -g allow-passthrough all";

export function runsHookNotify(command: string): boolean {
  const escaped = COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s/"'])${escaped}["']?\\s+hook\\s+notify(\\s|;|$)`).test(command);
}

export function isEditedNotify(entry: HookEntry): boolean {
  return entry.hooks.some(
    (handler) => runsHookNotify(handler.command) || runsPluginNotify(handler.command),
  );
}

/** Retires only exact recorded entries. Call under setup's lock, or read-only in dry-run. */
export function retireNotifications(
  paths: CliPaths,
  dryRun: boolean,
): { changes: string[]; info: string[] } {
  const changes: string[] = [];
  const info: string[] = [];
  try {
    const result = removeManagedHooks(paths.stateDir, paths.settingsFile, {
      dryRun,
      matches: (event, entry) =>
        event === "Notification" && Bun.deepEquals(entry, USER_NOTIFY_ENTRY, true),
    });
    if (result.removed.length > 0)
      changes.push(`${paths.settingsFile}: removed the retired notification hook`);
    const { data } = readJsonObject(paths.settingsFile);
    if (isObject(data.hooks) && Array.isArray(data.hooks.Notification)) {
      const remaining = data.hooks.Notification.filter(
        (entry) => isHookEntry(entry) && isEditedNotify(entry),
      );
      if (remaining.length > (dryRun ? result.removed.length : 0)) {
        info.push(
          `${paths.settingsFile}: an edited or unowned notification hook stays; remove the stale hook notify or dist/notify.js command by hand`,
        );
      }
    }
  } catch (error) {
    info.push(
      `Notification hooks were left unchanged: ${error instanceof Error ? error.message : String(error)}. Check the ownership record and remove stale notification commands by hand.`,
    );
  }
  try {
    const record = readChanged(paths.stateDir)[realTarget(paths.tmuxConfFile)];
    if (record?.kinds.includes("file-line") && record.lines?.includes(TMUX_LINE)) {
      const result = removeManagedLines({
        file: paths.tmuxConfFile,
        lines: [TMUX_LINE],
        stateDir: paths.stateDir,
        dryRun,
      });
      if (result.removed.length > 0)
        changes.push(
          `${paths.tmuxConfFile}: removed the retired notification passthrough line; the running tmux server was not changed`,
        );
      else if (existsSync(paths.tmuxConfFile)) {
        info.push(
          `${paths.tmuxConfFile}: the recorded notification passthrough line was edited or removed; the file stays unchanged; check it by hand if passthrough is no longer needed`,
        );
      }
      // Removal succeeded (or the person already changed it). A later copy is theirs.
      if (!dryRun) forgetManagedLines(paths.stateDir, paths.tmuxConfFile, [TMUX_LINE]);
    } else if (
      existsSync(paths.tmuxConfFile) &&
      readFileSync(paths.tmuxConfFile, "utf8").split("\n").includes(TMUX_LINE)
    ) {
      info.push(
        `${paths.tmuxConfFile}: the unowned notification passthrough line stays; remove it by hand if no other tool needs it`,
      );
    }
  } catch (error) {
    info.push(
      `The tmux file was left unchanged: ${error instanceof Error ? error.message : String(error)}. Check the ownership record before removing notification passthrough by hand.`,
    );
  }
  return { changes, info };
}
