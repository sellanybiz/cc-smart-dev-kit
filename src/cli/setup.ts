import { existsSync, readFileSync } from "node:fs";
import { MARKETPLACE, MARKETPLACE_ADD_COMMAND, PLUGIN_INSTALL_COMMAND } from "../build-info";
import { installLauncher } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { applyManagedJson, formatKeyPath, type KeyPath } from "../setup/managed-json";
import { type CliPaths, tildify } from "./paths";

/** The key that turns on auto-update for the cc-agentic marketplace. Claude Code's install leaves it out. */
export const AUTO_UPDATE_KEY: KeyPath = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];

function show(value: unknown): string {
  return value === undefined ? "(none)" : JSON.stringify(value);
}

/** True when settings.json knows the cc-agentic marketplace (written by `claude plugin install`). */
function marketplaceKnown(settingsFile: string): boolean {
  if (!existsSync(settingsFile)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as {
      extraKnownMarketplaces?: Record<string, unknown>;
    };
    const entry = settings.extraKnownMarketplaces?.[MARKETPLACE];
    return typeof entry === "object" && entry !== null;
  } catch {
    return false;
  }
}

export async function runSetup(paths: CliPaths, options: { dryRun: boolean }): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);

  if (!marketplaceKnown(paths.settingsFile)) {
    console.error(
      `${short(paths.settingsFile)} does not list the ${MARKETPLACE} marketplace yet.\n` +
        `Run first: ${MARKETPLACE_ADD_COMMAND}\n` +
        `Then:      ${PLUGIN_INSTALL_COMMAND}`,
    );
    return 1;
  }

  return withLock(
    paths.stateDir,
    () => {
      const lines: string[] = [];
      const launcher = installLauncher(paths.binDir, {
        stateDir: paths.stateDir,
        bunPath: process.execPath,
        dryRun: options.dryRun,
      });
      if (launcher.outcome !== "unchanged") {
        const mark = launcher.outcome === "created" ? "+" : "~";
        lines.push(`${mark} ${short(launcher.path)}: launcher ${launcher.outcome}`);
      }

      const settings = applyManagedJson({
        file: paths.settingsFile,
        stateDir: paths.stateDir,
        set: [[AUTO_UPDATE_KEY, true]],
        dryRun: options.dryRun,
      });
      for (const change of settings.changes) {
        lines.push(
          `~ ${short(settings.file)}: ${formatKeyPath(change.path)}: ${show(change.before)} -> ${show(change.after)}`,
        );
      }
      for (const skip of settings.skipped) {
        lines.push(`  ${short(settings.file)}: ${formatKeyPath(skip.path)}: ${skip.reason}`);
      }

      if (options.dryRun) {
        console.log(lines.length > 0 ? lines.join("\n") : "Nothing to change.");
        console.log("Dry run: nothing was written.");
      } else if (lines.length === 0) {
        console.log("Nothing to change. Setup is up to date.");
      } else {
        console.log(lines.join("\n"));
        console.log("Done. Each changed file has a backup beside it (.bak-cc-agentic-<time>).");
      }

      const pathDirs = (process.env.PATH ?? "").split(":");
      if (!pathDirs.includes(paths.binDir)) {
        console.log(
          `Note: ${short(paths.binDir)} is not on your PATH. Add it, so the cc-agentic command works.`,
        );
      }
      return 0;
    },
    { waitMs: 10_000 },
  );
}
