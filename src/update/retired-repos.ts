/**
 * The repos on this machine that still carry a piece of the retired worktree engine (D20, D33):
 * a `worktrees.prefix|setup|engine` field in `.claude/cc-smart-dev-kit.json`, which 1.0.0 refuses,
 * or a `cc-smart-dev-kit hook worktree-create|…` line in `.claude/settings.json` or
 * `.claude/settings.local.json`, which fails on every run. `setup` lists them on every run, and
 * `update` before it installs a new major version, so the person fixes each one with
 * `project init` before its hooks fail closed.
 *
 * Where the repos come from: the folders Claude Code's saved sessions name
 * (`sessionWorkFolders`), each taken to its main checkout. A folder that is gone, or not in
 * git, is skipped. Read-only: it never changes another repo; it names the command that does.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import {
  allWiredHandlers,
  projectSettingsFiles,
  retiredEngineHookOf,
} from "../hooks/settings-hooks";
import { retiredFieldsOf, WORKTREE_ENGINE_RETIRED_IN } from "../project/config";
import { locateCheckout } from "../project/resolve";
import { sessionWorkFolders } from "../sessions/command";
import { shellWord } from "../setup/launcher";

type Env = Record<string, string | undefined>;

/** One repo that still carries a retired piece, and what it is, in words. */
export interface RetiredRepo {
  /** The main checkout. */
  repo: string;
  /** The retired fields its cc-smart-dev-kit.json sets (`worktrees.prefix`, …). */
  fields: string[];
  /** Its settings files that still run an engine hook, relative to the repo. */
  engineFiles: string[];
  /** Why its cc-smart-dev-kit.json could not be read (not JSON); null when it could. */
  error: null | string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The main checkout a folder is in; null when it is gone, not a folder, or not in git. */
function mainCheckoutOf(folder: string, env: Env): null | string {
  if (!existsSync(folder)) return null;
  try {
    const checkout = locateCheckout(folder, { env });
    return checkout === null ? null : (checkout.mainCheckout ?? checkout.root);
  } catch {
    // Not a folder, a main checkout git cannot find, git too old: nothing to read there.
    return null;
  }
}

/** What one repo still carries; null when it carries nothing retired. */
export function retiredPartsOf(repo: string): null | RetiredRepo {
  const config = join(repo, ".claude", "cc-smart-dev-kit.json");
  let fields: string[] = [];
  let error: null | string = null;
  if (existsSync(config)) {
    try {
      fields = retiredFieldsOf(JSON.parse(readFileSync(config, "utf8"))).map(
        (field) => `worktrees.${field}`,
      );
    } catch (cause) {
      error = messageOf(cause);
    }
  }
  const engineFiles = projectSettingsFiles(repo)
    .filter((file) =>
      allWiredHandlers(file).some((handler) => retiredEngineHookOf(handler.command) !== null),
    )
    .map((file) => relative(repo, file));
  if (fields.length === 0 && engineFiles.length === 0 && error === null) return null;
  return { engineFiles, error, fields, repo };
}

/** Every repo the saved sessions name that still carries a retired piece, by path. */
export function reposWithRetiredParts(paths: CliPaths, env: Env): RetiredRepo[] {
  const repos = new Set<string>();
  for (const folder of sessionWorkFolders(paths.projectsDir)) {
    const repo = mainCheckoutOf(folder, env);
    if (repo !== null) repos.add(repo);
  }
  return [...repos]
    .sort()
    .map(retiredPartsOf)
    .filter((found): found is RetiredRepo => found !== null);
}

/** One `!` line for a repo: what it carries, and the command that takes it out. */
export function retiredRepoLine(found: RetiredRepo, home: string): string {
  const fix = `cd ${shellWord(found.repo)} && ${COMMAND} project init`;
  const where = tildify(found.repo, home);
  const config = join(".claude", "cc-smart-dev-kit.json");
  if (found.error !== null) {
    return `! ${where}: ${config} cannot be read (${found.error}), so whether it still sets a field retired in ${WORKTREE_ENGINE_RETIRED_IN} is unknown. Fix it, then: ${fix}`;
  }
  const parts = [
    ...(found.fields.length > 0 ? [`${found.fields.join(", ")} in ${config}`] : []),
    ...found.engineFiles.map((file) => `an engine hook line in ${file}`),
  ];
  return `! ${where} still has ${parts.join(" and ")}, retired in ${WORKTREE_ENGINE_RETIRED_IN}: ${fix}`;
}

/** The `!` lines `setup` and `update` print: one per repo, none when every repo is clean. */
export function retiredRepoLines(paths: CliPaths, env: Env): string[] {
  return reposWithRetiredParts(paths, env).map((found) => retiredRepoLine(found, paths.home));
}
