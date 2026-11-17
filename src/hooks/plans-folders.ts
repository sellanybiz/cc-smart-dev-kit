/**
 * Where plan mode writes a session's plan: the one home of reading `plansDirectory`.
 * `verify-gate` leaves a plan out of "files the session changed" (`plansFolders`), and the
 * main-folder guard lets a plan through into the main checkout (`plansDirectory`), so both ask
 * this.
 */
import { join, resolve } from "node:path";
import { cliPaths } from "../cli/paths";
import { readJsonObject } from "../setup/managed-json";
import { realPath } from "./git";
import { stringField } from "./io";
import type { Env } from "./run";

/**
 * The folder plan mode writes this session's plans in, as a real path: the `plansDirectory`
 * setting (the person's settings, then the project's, then its local ones; the last one that
 * sets it wins; `~/` is the home folder, any other path is read from the project's `root`), or
 * `<claudeConfigDir>/plans` when none sets it.
 */
export function plansDirectory(root: string, env: Env): string {
  const paths = cliPaths(env);
  let plans = join(paths.claudeConfigDir, "plans");
  for (const settings of [
    paths.settingsFile,
    join(root, ".claude/settings.json"),
    join(root, ".claude/settings.local.json"),
  ]) {
    const configured = stringField(readJsonObject(settings).data.plansDirectory);
    if (configured !== null)
      plans = configured.startsWith("~/")
        ? join(paths.home, configured.slice(2))
        : resolve(root, configured);
  }
  return realPath(plans);
}

/**
 * Every folder a plan may be in, for a check that must not count a plan as work: the
 * `plansDirectory`, and always `<root>/.claude/plans`, the project's own plans folder.
 */
export function plansFolders(root: string, env: Env): string[] {
  return [plansDirectory(root, env), realPath(join(root, ".claude/plans"))];
}
