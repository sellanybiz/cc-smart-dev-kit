/**
 * The repos on this machine that still carry a piece of the retired worktree engine (D20, D33):
 * a `worktrees.prefix|setup|engine` field in `.claude/cc-smart-dev-kit.json`, which 1.0.0 refuses,
 * or a `cc-smart-dev-kit hook worktree-create|…` line in `.claude/settings.json` or
 * `.claude/settings.local.json`, which fails on every run. `setup` lists them on every run, and
 * `update` before it installs a new major version, so the person fixes each one with
 * `project init` before its hooks fail closed.
 *
 * Where the repos come from: the folders Claude Code's saved sessions name
 * (`sessionWorkFolders`), each taken to its own checkout root and, beside it, to the main
 * checkout. A linked worktree reads its own cc-smart-dev-kit.json first (`loadProjectConfig`),
 * so a long-lived worktree on an older branch is its own finding; a worktree's own settings
 * files are read the same way. A folder that is gone, or not in git, is skipped. Read-only: it
 * never changes another repo; it names the command that does.
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
import { type Checkout, locateCheckout, locateCheckoutAsync } from "../project/resolve";
import { sessionWorkFolders } from "../sessions/command";
import { shellWord } from "../setup/launcher";
import { parseUserJson } from "../setup/user-json";

type Env = Record<string, string | undefined>;

/** One repo that still carries a retired piece, and what it is, in words. */
export interface RetiredRepo {
  /**
   * The checkout that carries the retired piece: the main checkout, or a linked worktree of it
   * (whose own cc-smart-dev-kit.json wins over the main checkout's).
   */
  repo: string;
  /** The main checkout, when `repo` is a linked worktree of it; null when `repo` is the main one. */
  mainCheckout: null | string;
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

/**
 * The main checkout and the root of a located checkout; null outside git. The one mapping
 * both readers below use (a worktree is folded into the main checkout it belongs to).
 */
export function checkoutFold(checkout: Checkout | null): null | { main: string; root: string } {
  if (checkout === null) return null;
  return { main: checkout.mainCheckout ?? checkout.root, root: checkout.root };
}

/**
 * The checkout a folder is in, with the main checkout of its repo; null when it is gone, not
 * a folder, or not in git.
 */
export function checkoutOf(folder: string, env: Env): null | { main: string; root: string } {
  if (!existsSync(folder)) return null;
  try {
    return checkoutFold(locateCheckout(folder, { env }));
  } catch {
    // Not a folder, a main checkout git cannot find, git too old: nothing to read there.
    return null;
  }
}

/**
 * `checkoutOf`, without blocking: the same answer through `Bun.spawn`. The portal's Projects
 * page folds every worktree into its main checkout inside the server's own process, where a
 * blocking spawn freezes every page and the live stream (`.claude/rules/portal.md`).
 */
export async function checkoutOfAsync(
  folder: string,
  env: Env,
): Promise<null | { main: string; root: string }> {
  if (!existsSync(folder)) return null;
  try {
    return checkoutFold(await locateCheckoutAsync(folder, { env }));
  } catch {
    return null;
  }
}

/** What one checkout still carries; null when it carries nothing retired. */
export function retiredPartsOf(
  repo: string,
  mainCheckout: null | string = null,
): null | RetiredRepo {
  const config = join(repo, ".claude", "cc-smart-dev-kit.json");
  let fields: string[] = [];
  let error: null | string = null;
  if (existsSync(config)) {
    try {
      // The one reader of a JSON file a person may have edited: it skips a Windows editor's
      // byte order mark, which `JSON.parse` refuses (src/setup/user-json.ts).
      fields = retiredFieldsOf(parseUserJson(readFileSync(config, "utf8"))).map(
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
  return { engineFiles, error, fields, mainCheckout, repo };
}

/** Every checkout the saved sessions name that still carries a retired piece, by path. */
export function reposWithRetiredParts(paths: CliPaths, env: Env): RetiredRepo[] {
  // Each checkout a saved session worked in, not only its main checkout: a linked worktree's
  // own cc-smart-dev-kit.json wins over the main checkout's (`loadProjectConfig`), so a
  // long-lived worktree that still sets a retired field is its own finding. The main checkout
  // is read too, for the sessions that work there.
  const checkouts = new Map<string, string>();
  for (const folder of sessionWorkFolders(paths.projectsDir)) {
    const found = checkoutOf(folder, env);
    if (found === null) continue;
    checkouts.set(found.root, found.main);
    if (!checkouts.has(found.main)) checkouts.set(found.main, found.main);
  }
  return [...checkouts]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([root, main]) => retiredPartsOf(root, main === root ? null : main))
    .filter((found): found is RetiredRepo => found !== null);
}

/** One `!` line for a repo: what it carries, and the command that takes it out. */
export function retiredRepoLine(found: RetiredRepo, home: string): string {
  const fix = `cd ${shellWord(found.repo)} && ${COMMAND} project init`;
  const where =
    found.mainCheckout === null
      ? tildify(found.repo, home)
      : `${tildify(found.repo, home)} (a worktree of ${tildify(found.mainCheckout, home)})`;
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
