/**
 * The kit's git hooks folder: `<dataDir>/git-hooks/`, one `sh` script under every hook name in
 * `HOOK_NAMES`, all with the same text.
 *
 * A routed `git commit` or `git push` points git at this folder for that one command
 * (`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=<folder>`), so a
 * repo's own heavy hook (tests, a type check) waits for a heavy slot like any other heavy
 * command. Nothing goes into the person's git or Claude settings.
 *
 * The folder is a folder the kit owns whole (`src/setup/managed-folder.ts`): `setup` writes it,
 * the first session start of a new version rewrites it (`refreshGitHooksFolder`), `restore`
 * removes it, and `doctor` checks it (`gitHooksState`). Native Windows has no folder yet: the
 * scripts are `sh`, and the proof through Git for Windows' `sh` is a follow-up.
 */

import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND, PLUGIN } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { findUserInstall } from "../setup/installed-plugins";
import { LAUNCHER_NAME, shellQuote } from "../setup/launcher";
import { withLock } from "../setup/lock";
import {
  type ManagedFolderResult,
  OWNED_FOLDER_MARK,
  readOwnedFolders,
  writeManagedFolder,
} from "../setup/managed-folder";
import { realTarget } from "../setup/write";
import { HOOK_NAMES } from "./git-hooks";

/** The scripts must run: owner, group and others may execute them (git's own check is `X_OK`). */
export const HOOK_FILE_MODE = 0o755;

/** The launcher the scripts call: the one setup writes, by its absolute path. */
export function hookLauncher(paths: CliPaths): string {
  return join(paths.binDir, LAUNCHER_NAME);
}

/**
 * The one script, the same under every name (it reads its own name from `$0`). `launcher` is the
 * absolute path of the kit's command, baked in when setup writes the folder.
 *
 * What it does, in order:
 *
 * 1. Finds the person's real hooks folder and the real file of that name, with git's own switch
 *    for it (`GIT_CONFIG_COUNT=0` throws away the `GIT_CONFIG_*` pair that brought git here).
 *    No file: `exit 0`, as git does for a hook that is not there. husky v9's folder
 *    (`.husky/_`) holds a stub for every name: a stub whose `.husky/<name>` is missing is no
 *    hook either, and it ends here without starting the command. A file git itself would skip
 *    (not executable) gets git's own hint and `exit 0`. husky's `HUSKY=0` skips step 2.
 * 2. Asks `<launcher> job hook <name>`. Only `queue <kind>` changes anything: every other answer,
 *    a missing launcher and a failing one run the hook as it is, so a broken kit never blocks a
 *    commit.
 * 3. `exec`s the real file (or `<launcher> job run --kind <kind> -- <real file>`) with git's
 *    own arguments. Standard input and the environment pass through untouched: `pre-push` reads
 *    the refs from stdin, and `pre-commit` needs `GIT_INDEX_FILE`.
 */
export function hookScript(launcher: string): string {
  return `#!/bin/sh
# ${PLUGIN} git hook. Written by "${COMMAND} setup"; setup rewrites it, so do not edit it.
# A git command that the kit routes uses this folder for that one command. This script runs the
# repo's own hook of the same name: as it is, or inside the heavy-job queue when that hook runs
# heavy work. Every doubt runs the hook as it is, so a broken kit never blocks a commit.
name=\${0##*/}
launcher=${shellQuote(launcher)}
real_dir=$(GIT_CONFIG_COUNT=0 git rev-parse --path-format=absolute --git-path hooks 2>/dev/null) || exit 0
[ -n "$real_dir" ] || exit 0
real=$real_dir/$name
[ -f "$real" ] || exit 0
case $real_dir in
  */.husky/_)
    [ -f "$real_dir/../$name" ] || exit 0
    # HUSKY=0 turns husky's hooks off: its stub ends at once, so it never waits for a slot.
    if [ "\${HUSKY:-}" = 0 ]; then launcher=; fi
    ;;
esac
if [ ! -x "$real" ]; then
  echo "hint: The '$real' hook was ignored because it's not set as executable." >&2
  exit 0
fi
answer=direct
if [ -x "$launcher" ]; then
  answer=$("$launcher" job hook "$name" </dev/null) || answer=direct
fi
case $answer in
  "queue "*)
    kind=\${answer#queue }
    case $kind in
      '' | *[!A-Za-z0-9:._-]*) ;;
      *) exec "$launcher" job run --kind "$kind" -- "$real" "$@" ;;
    esac
    ;;
esac
exec "$real" "$@"
`;
}

/**
 * Writes the folder from this version's script: into a temporary folder first (the managed
 * writer copies a folder into place whole), then `writeManagedFolder` swaps it in. With `dryRun`
 * nothing of the person's changes: the temporary folder is removed either way.
 */
export function installGitHooksFolder(
  paths: CliPaths,
  options: { dryRun?: boolean } = {},
): ManagedFolderResult {
  const source = mkdtempSync(join(tmpdir(), `${COMMAND}-git-hooks-`));
  try {
    const text = hookScript(hookLauncher(paths));
    for (const name of HOOK_NAMES) writeFileSync(join(source, name), text);
    return writeManagedFolder(paths.gitHooksFolder, source, {
      stateDir: paths.stateDir,
      fileMode: HOOK_FILE_MODE,
      ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
    });
  } finally {
    rmSync(source, { force: true, recursive: true });
  }
}

/** What `doctor` and the refresh find in the folder. */
export type GitHooksState =
  | { kind: "missing" }
  | { kind: "ok" }
  | { kind: "problems"; problems: string[] };

/** True when git may run `file` (its own check is `X_OK`). */
function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The folder as it is: missing, as this version writes it, or with problems, one short phrase
 * each — a name that is missing, is not executable, holds another version's text, or is a file
 * that should not be there (a stray `push-to-checkout` would change how git pushes).
 */
export function gitHooksState(paths: CliPaths): GitHooksState {
  const folder = paths.gitHooksFolder;
  if (!existsSync(folder)) return { kind: "missing" };
  const wanted = hookScript(hookLauncher(paths));
  const problems: string[] = [];
  for (const name of HOOK_NAMES) {
    const file = join(folder, name);
    if (!existsSync(file) || !statSync(file).isFile()) problems.push(`${name} is missing`);
    else if (!isExecutable(file)) problems.push(`${name} is not executable`);
    else if (readFileSync(file, "utf8") !== wanted)
      problems.push(`${name} is from another version`);
  }
  for (const entry of readdirSync(folder)) {
    if (entry !== OWNED_FOLDER_MARK && !HOOK_NAMES.includes(entry)) {
      problems.push(`${entry} should not be there`);
    }
  }
  return problems.length === 0 ? { kind: "ok" } : { kind: "problems", problems };
}

/** True when the record of owned folders names the kit's git hooks folder: the kit wrote it. */
function recordedAsOurs(paths: CliPaths): boolean {
  return readOwnedFolders(paths.stateDir).includes(realTarget(paths.gitHooksFolder));
}

/**
 * Does this session have to rewrite the folder, and may it? Only a folder the kit wrote and
 * that is not as this version writes it, and only the session of the installed version: an old
 * session that resumes after an update must not put its older text back (`refreshMayWrite`).
 * Reads files only.
 */
function refreshDue(paths: CliPaths, version: string): boolean {
  if (!recordedAsOurs(paths)) return false;
  if (gitHooksState(paths).kind !== "problems") return false;
  return findUserInstall(paths.installedPluginsFile)?.version === version;
}

/**
 * The one thing a session start does for the git hooks folder: setup wrote it with the version
 * that ran it, and a plugin update leaves that text behind, so the first session start of a new
 * version brings it up to date. Only a folder setup wrote (never creates one: that is setup's,
 * which shows the change first), under the state lock, and nothing when another process holds
 * the lock (it is doing the work). Returns true when it rewrote the folder.
 */
export async function refreshGitHooksFolder(
  paths: CliPaths,
  version: string,
  options: { waitMs?: number } = {},
): Promise<boolean> {
  if (!refreshDue(paths, version)) return false;
  return withLock(
    paths.stateDir,
    () => {
      if (!refreshDue(paths, version)) return false;
      installGitHooksFolder(paths);
      return true;
    },
    { waitMs: options.waitMs ?? 2_000 },
  );
}
