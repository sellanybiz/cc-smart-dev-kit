/**
 * PreToolUse (Bash, PowerShell): asks the person before a git command that destroys work
 * or skips review. Both tools send `tool_input.command`.
 *
 * It asks before:
 * - a force-push (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+`
 *   refspec; not a `--dry-run`); any of these abbreviated the way git accepts (`--forc`);
 * - a push to a protected branch (cc-smart-dev-kit.json `protectedBranches`, default `main`):
 *   named, or sent by a bare `git push` / `HEAD` from a folder on that branch (the folder
 *   follows a `cd` / `Set-Location` earlier on the line); `git push --all` / `--mirror`;
 * - a branch deleted on the remote (`git push origin :x`, `git push -d origin x`);
 * - `git reset --hard`; `git clean -f` (not a `-n` dry run); `git worktree remove -f`;
 * - a checkout that discards changes: `git checkout -- <path>`, `checkout .`,
 *   `checkout -f`, `git switch -f` / `--discard-changes`, `git restore <path>` without
 *   `--staged`;
 * - `git branch -D` (deletes a branch that may not be merged);
 * - `git stash clear`, and `git stash drop` with no stash named: they throw away work;
 * - when the project works in worktrees (`worktrees` in cc-smart-dev-kit.json): a bare `git stash`
 *   or `git stash pop`, because every worktree shares one stash.
 *
 * "ask", never "deny": the person may mean it, and a hook cannot tell. Every command of a
 * line is read on its own, through `shell-command.ts`: quoted text, here-doc bodies and
 * comments are data; `$( … )` inside double quotes, the inner command of `bash -c`,
 * `cmd /c`, `pwsh -c`, `eval` and `iex` (three levels deep), and the script of a shell that
 * reads it from standard input (`sh <<'EOF' … EOF`, `echo "git push -f" | sh`) are commands.
 *
 * Known limits: a git alias (`-c alias.x=… x`, or one in the user's config), a `branch -f`,
 * a `checkout -B` and a `switch -C` (they move a branch), a backtick substitution,
 * `-EncodedCommand`, `ssh`, a script file, a `cd` it cannot follow (`cd -`, `cd ~/x`,
 * `cd $DIR`) and a branch it cannot read are not asked about; `git checkout <name>` cannot
 * tell a file from a branch, so it stays silent.
 */
import { isAbsolute, resolve } from "node:path";
import { GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
import type { Env } from "./run";
import {
  invocationOf,
  isShort,
  MAX_NESTING,
  nestedCommand,
  programsOf,
  shellSteps,
  shortFlags,
  wordsOf,
} from "./shell-command";

/** The branches asked about when cc-smart-dev-kit.json names none. */
export const DEFAULT_PROTECTED_BRANCHES = ["main"];

export interface GuardOptions {
  protectedBranches: string[];
  /** Ask before a bare `git stash` / `stash pop`: the project works in worktrees. */
  sharedStash: boolean;
  env: Env;
}

/**
 * The folder a command runs in: a path, or null when a `cd` went somewhere this guard
 * cannot follow.
 */
type Folder = string | null;

/** `git push` options that take the next word as their value, and the shortest prefix git accepts. */
const PUSH_VALUE_OPTIONS: Array<[string, number]> = [
  ["--exec", 4],
  ["--push-option", 4],
  ["--receive-pack", 5],
  ["--repo", 6],
];

/** Commands that change the folder the rest of the line runs in (bash, cmd, PowerShell). */
const CHANGE_DIR = new Set(["cd", "chdir", "popd", "pushd", "set-location", "sl"]);

/**
 * True when `arg` is the long option `full`, or a prefix of it that git accepts (git takes
 * any unique prefix: `--har` is `--hard`, `--force-w` is `--force-with-lease`). `min` is the
 * shortest prefix that still names one option of that subcommand.
 */
function longOption(arg: string, full: string, min: number): boolean {
  const name = arg.split("=")[0] ?? arg;
  return name.length >= min && name.length <= full.length && full.startsWith(name);
}

/**
 * Where a `cd` / `Set-Location` / `pushd` goes, from `folder`: null when it cannot be worked
 * out (`cd -`, `cd`, `cd ~/x`, `cd $DIR`, `popd`).
 */
function movedTo(program: string, folder: Folder, args: string[]): Folder {
  if (program === "popd") return null;
  // `-Path x` / `-LiteralPath x` (PowerShell), `/d x` (cmd), `-P x` (bash): the first word that is no option.
  const target = args.find((arg) => !arg.startsWith("-") && arg.toLowerCase() !== "/d");
  if (target === undefined || /^[~%]|[$`]/.test(target)) return null;
  // Git Bash on Windows writes `D:\x` as `/d/x`.
  const path =
    process.platform === "win32" ? target.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:") : target;
  if (isAbsolute(path)) return resolve(path);
  return folder === null ? null : resolve(folder, path);
}

/** The branch checked out in `dir` (relative to `folder`), or undefined: detached, unknown, no git. */
function currentBranch(folder: Folder, dir: string | undefined, env: Env): string | undefined {
  if (folder === null) return undefined;
  const where = dir === undefined ? folder : resolve(folder, dir);
  const run = runGit(where, ["symbolic-ref", "--short", "-q", "HEAD"], env, GUARD_GIT_TIMEOUT_MS);
  return run.ok && run.out !== "" ? run.out : undefined;
}

function pushQuestions(
  args: string[],
  branchHere: () => string | undefined,
  protectedBranches: string[],
): string[] {
  const found: string[] = [];
  const positional: string[] = [];
  let dryRun = false;
  let force = false;
  let deleting = false;
  let everyBranch = false;
  let repoGiven = false;
  let tagsOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      if (
        longOption(arg, "--force", 6) ||
        longOption(arg, "--force-if-includes", 9) ||
        longOption(arg, "--force-with-lease", 9)
      ) {
        force = true;
      }
      if (longOption(arg, "--all", 4) || longOption(arg, "--mirror", 6)) everyBranch = true;
      if (longOption(arg, "--dry-run", 4)) dryRun = true;
      if (longOption(arg, "--tags", 4)) tagsOnly = true;
      if (longOption(arg, "--delete", 5)) deleting = true;
      if (longOption(arg, "--repo", 6)) repoGiven = true;
      if (
        !arg.includes("=") &&
        PUSH_VALUE_OPTIONS.some(([full, min]) => longOption(arg, full, min))
      )
        i++;
    } else if (isShort(arg)) {
      const { flags, wantsNext } = shortFlags(arg, "o");
      if (flags.includes("f")) force = true;
      if (flags.includes("n")) dryRun = true;
      if (flags.includes("d")) deleting = true;
      if (wantsNext) i++;
    } else {
      positional.push(arg);
    }
  }
  // A dry run sends nothing, whatever it would have sent.
  if (dryRun) return found;
  // The first word is the remote; the rest are refspecs (`[+]source[:destination]`).
  const refspecs = repoGiven ? positional : positional.slice(1);

  if (force || refspecs.some((refspec) => refspec.startsWith("+"))) {
    found.push(
      "This is a force-push: it can overwrite commits that other people or other sessions " +
        "already pushed, and those commits can be lost. Approve only if you meant it.",
    );
  }
  if (everyBranch) {
    found.push(
      `\`git push --all\` / \`--mirror\` pushes every branch, ${protectedBranches.map((b) => `\`${b}\``).join(", ")} included.`,
    );
  }
  // A branch deleted on the remote: `git push origin :x`, or `--delete x`.
  const deleted = refspecs
    .map((refspec) => refspec.replace(/^\+/, ""))
    .map((spec) => (deleting ? spec : spec.startsWith(":") && spec.length > 1 ? spec.slice(1) : ""))
    .filter((name) => name !== "")
    .map((name) => name.replace(/^refs\/heads\//, ""));
  if (deleted.length > 0) {
    found.push(
      `This deletes ${deleted.map((name) => `\`${name}\``).join(", ")} on the remote: the ` +
        "commits on it are gone for everyone, and a teammate may still be working on it. " +
        "Approve only if you meant to delete it.",
    );
  }

  const targets: string[] = [];
  for (const refspec of refspecs) {
    const spec = refspec.replace(/^\+/, "");
    const colon = spec.indexOf(":");
    const destination = colon === -1 ? spec : spec.slice(colon + 1);
    // `git push origin HEAD` sends the branch that is checked out here.
    if (colon === -1 && (spec === "HEAD" || spec === "@")) {
      const here = branchHere();
      if (here !== undefined) targets.push(here);
    } else {
      targets.push(destination.replace(/^refs\/heads\//, ""));
    }
  }
  // `git push` and `git push origin` send the branch that is checked out here.
  if (refspecs.length === 0 && !tagsOnly) {
    const here = branchHere();
    if (here !== undefined) targets.push(here);
  }
  const protectedTarget = targets.find((target) => protectedBranches.includes(target));
  if (protectedTarget !== undefined) {
    found.push(
      `This pushes straight to \`${protectedTarget}\`, a protected branch: work usually reaches ` +
        "it through a pull request. Approve only if you meant to push there.",
    );
  }
  return found;
}

function stashQuestions(args: string[], sharedStash: boolean): string[] {
  const sub = args[0];
  const named = args.slice(1).some((arg) => !arg.startsWith("-"));
  if (sub === "clear") {
    return [
      "`git stash clear` throws away every stash for good: git cannot bring them back. " +
        "`git stash list` shows what they hold, `git stash show -p` one of them.",
    ];
  }
  if (sub === "drop" && !named) {
    return [
      "`git stash drop` with no stash named drops the newest one, whoever made it. " +
        "`git stash list` shows them; `git stash drop stash@{n}` drops the one you mean.",
    ];
  }
  if (!sharedStash) return [];
  const tagged = args.some(
    (arg) =>
      longOption(arg, "--message", 6) || (isShort(arg) && shortFlags(arg, "m").flags.includes("m")),
  );
  // `git stash` and `git stash -u` are a push with no tag, and so is `save` with no message
  // word; `pop` takes the newest stash, whoever made it. `list`, `apply <sha>` and
  // `drop <stash>` are how a tagged stash is handled.
  const untaggedPush = (sub === undefined || sub.startsWith("-") || sub === "push") && !tagged;
  const saveWithoutMessage = sub === "save" && !named;
  if (sub !== "pop" && !untaggedPush && !saveWithoutMessage) return [];
  return [
    "The git stash is shared by every worktree of this repo, so a bare `git stash` or " +
      "`git stash pop` can take or restore another session's work. A WIP commit is safer; " +
      "or `git stash push -u -m <tag>`, then `git stash apply <its sha>`.",
  ];
}

/** `git checkout` / `restore` / `switch` forms that overwrite changes in the working folder. */
function discardsChanges(sub: string, rest: string[]): boolean {
  if (sub === "switch") {
    // `-c` / `-C` take the new branch's name; `-f`, `--force` and `--discard-changes` throw
    // the uncommitted changes away instead of refusing to switch.
    return rest.some(
      (arg) =>
        longOption(arg, "--force", 6) ||
        longOption(arg, "--discard-changes", 8) ||
        (isShort(arg) && shortFlags(arg, "cC").flags.includes("f")),
    );
  }
  if (sub === "checkout") {
    const dashes = rest.indexOf("--");
    const pathsGiven = dashes !== -1 && dashes < rest.length - 1;
    const force = rest.some(
      (arg) =>
        longOption(arg, "--force", 6) ||
        (isShort(arg) && shortFlags(arg, "bB").flags.includes("f")),
    );
    return pathsGiven || force || rest.slice(0, dashes === -1 ? undefined : dashes).includes(".");
  }
  // `restore` puts files back in the working folder, unless it only unstages them.
  const staged = rest.some(
    (arg) =>
      longOption(arg, "--staged", 6) || (isShort(arg) && shortFlags(arg, "s").flags.includes("S")),
  );
  const worktree = rest.some(
    (arg) =>
      longOption(arg, "--worktree", 6) ||
      (isShort(arg) && shortFlags(arg, "s").flags.includes("W")),
  );
  return !staged || worktree;
}

/** `git branch -D`, `-d -f`, `--delete --force`: deletes a branch even if it was never merged. */
function forceDeletesBranch(rest: string[]): boolean {
  const has = (long: string | undefined, min: number, short: string) =>
    rest.some(
      (arg) =>
        (long !== undefined && longOption(arg, long, min)) ||
        (isShort(arg) && shortFlags(arg, "").flags.includes(short)),
    );
  return has(undefined, 0, "D") || (has("--delete", 5, "d") && has("--force", 6, "f"));
}

function gitQuestions(args: string[], folder: Folder, options: GuardOptions): string[] {
  // Skip git's own options (`git -C dir -c k=v push …`) to reach the subcommand.
  let dir: string | undefined;
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-C") dir = args[++index];
    else if (["--git-dir", "--namespace", "--work-tree", "-c"].includes(arg)) index++;
    else if (!arg.startsWith("-")) break;
  }
  const sub = args[index];
  const rest = args.slice(index + 1);

  if (sub === "push") {
    return pushQuestions(
      rest,
      () => currentBranch(folder, dir, options.env),
      options.protectedBranches,
    );
  }
  if (sub === "stash") return stashQuestions(rest, options.sharedStash);
  if (sub === "worktree" && rest[0] === "remove") {
    const force = rest
      .slice(1)
      .some(
        (arg) =>
          longOption(arg, "--force", 6) ||
          (isShort(arg) && shortFlags(arg, "").flags.includes("f")),
      );
    if (force) {
      return [
        "`git worktree remove --force` deletes a worktree even when it holds uncommitted or " +
          "untracked work, and git cannot bring that back. Look in it first.",
      ];
    }
  }
  if ((sub === "checkout" || sub === "restore" || sub === "switch") && discardsChanges(sub, rest)) {
    return [
      `\`git ${sub}\` here overwrites files in this folder with another version, and any ` +
        "uncommitted change in them is lost for good. Approve only if you want them gone; a " +
        "WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask.",
    ];
  }
  if (sub === "branch" && forceDeletesBranch(rest)) {
    return [
      "`git branch -D` deletes a branch even if it was never merged: its commits are then " +
        "only in the reflog. `git branch -d` deletes a merged branch, and does not ask.",
    ];
  }
  if (sub === "reset" && rest.some((arg) => longOption(arg, "--hard", 4))) {
    return [
      "`git reset --hard` throws away every uncommitted change in this folder, for good. " +
        "Approve only if you want them gone; a WIP commit keeps the work first.",
    ];
  }
  if (sub === "clean") {
    const force = rest.some(
      (arg) =>
        longOption(arg, "--force", 6) || (isShort(arg) && shortFlags(arg, "e").flags.includes("f")),
    );
    const dryRun = rest.some(
      (arg) =>
        longOption(arg, "--dry-run", 4) ||
        (isShort(arg) && shortFlags(arg, "e").flags.includes("n")),
    );
    if (force && !dryRun) {
      return [
        "`git clean -f` deletes untracked files for good: git cannot bring them back. " +
          "`git clean -n` shows what it would delete, without deleting.",
      ];
    }
  }
  return [];
}

/**
 * Every question about a command line, each command of it read on its own, in order, so a
 * `cd` changes the folder the later commands run in. `joinLines`: a line that ends in `\`
 * or a backtick goes on in the next.
 */
function inspect(
  command: string,
  cwd: Folder,
  joinLines: boolean,
  options: GuardOptions,
  depth = 0,
): string[] {
  const found: string[] = [];
  let folder = cwd;
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  for (const step of shellSteps(command, { blindWhenOpen: true, joinLines })) {
    const invocation = invocationOf(wordsOf(step.text));
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    if (program === "git") found.push(...gitQuestions(args, folder, options));
    if (CHANGE_DIR.has(program)) folder = movedTo(program, folder, args);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      found.push(...inspect(inner, folder, joinLines, options, depth + 1));
    }
  }
  return found;
}

/**
 * The questions to put to the person about `command`, run in `cwd`, each once. Empty when
 * nothing in it destroys work.
 */
export function guardQuestions(command: string, cwd: string, options: GuardOptions): string[] {
  // A line that ends in `\` (bash) or a backtick (PowerShell) goes on in the next. A trailing
  // backslash may also just end a Windows path, so the line is read both ways.
  const continues = /[\\`][ \t]*\r?\n/.test(command);
  const found = [
    ...inspect(command, cwd, false, options),
    ...(continues ? inspect(command, cwd, true, options) : []),
  ];
  return [...new Set(found)];
}

/** True when the command line runs git at all (what the guard asks about when it cannot read its config). */
export function runsGit(command: string): boolean {
  return programsOf(command).includes("git");
}
