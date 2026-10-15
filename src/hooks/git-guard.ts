/**
 * PreToolUse (Bash, PowerShell): asks the person before a git command that destroys work
 * or skips review. Both tools send `tool_input.command`.
 *
 * It asks before:
 * - a force-push (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+`
 *   refspec; not a `--dry-run`);
 * - a push to a protected branch (anymodel.json `protectedBranches`, default `main`):
 *   named, or sent by a bare `git push` / `HEAD` from a folder on that branch (the folder
 *   follows a `cd` / `Set-Location` earlier on the line); `git push --all` / `--mirror`;
 * - `git reset --hard`; `git clean -f` (not a `-n` dry run);
 * - a checkout that discards changes: `git checkout -- <path>`, `checkout .`,
 *   `checkout -f`, `git switch -f` / `--discard-changes`, `git restore <path>` without
 *   `--staged`;
 * - `git branch -D` (deletes a branch that may not be merged);
 * - when the project works in worktrees (`worktrees` in anymodel.json): a bare `git stash`
 *   or `git stash pop`, because every worktree shares one stash.
 *
 * "ask", never "deny": the person may mean it, and a hook cannot tell. Every command of a
 * line is read on its own, through `shell-command.ts`: quoted text, here-doc bodies and
 * comments are data; `$( … )` inside double quotes, and the inner command of `bash -c`,
 * `cmd /c`, `pwsh -c`, `eval` and `iex` (three levels deep), are commands.
 *
 * Known limits: a backtick substitution, `-EncodedCommand`, `xargs`, `ssh`, a script file, a
 * `cd` it cannot follow (`cd -`, `cd ~/x`, `cd $DIR`) and a branch it cannot read are not
 * asked about; `git checkout <name>` cannot tell a file from a branch, so it stays silent.
 */
import { isAbsolute, resolve } from "node:path";
import { runGit } from "./git";
import type { Env } from "./run";
import { invocationOf, MAX_NESTING, nestedCommand, shellSegments, wordsOf } from "./shell-command";

/** The branches asked about when anymodel.json names none. */
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

/** `git push` options that take the next word as their value. */
const PUSH_VALUE_OPTIONS = new Set(["--exec", "--push-option", "--receive-pack", "--repo"]);

/** Commands that change the folder the rest of the line runs in (bash, cmd, PowerShell). */
const CHANGE_DIR = new Set(["cd", "chdir", "popd", "pushd", "set-location", "sl"]);

/**
 * The letters of a short option group (`-fdx` → `fdx`), up to the first one that takes a
 * value (the rest of the word, or the next word when nothing is attached).
 */
function shortFlags(arg: string, valued: string): { flags: string; wantsNext: boolean } {
  let flags = "";
  for (let i = 1; i < arg.length; i++) {
    const letter = arg.charAt(i);
    flags += letter;
    if (valued.includes(letter)) return { flags, wantsNext: i === arg.length - 1 };
  }
  return { flags, wantsNext: false };
}

/** `-x` or `-xyz`, not `--long` and not a bare `-`. */
function isShort(arg: string): boolean {
  return /^-[^-]/.test(arg);
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
  const run = runGit(where, ["symbolic-ref", "--short", "-q", "HEAD"], env, 5000);
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
      const name = arg.split("=")[0] ?? arg;
      if (["--force", "--force-if-includes", "--force-with-lease"].includes(name)) force = true;
      if (name === "--all" || name === "--mirror") everyBranch = true;
      if (name === "--dry-run") dryRun = true;
      if (name === "--tags") tagsOnly = true;
      if (name === "--repo") repoGiven = true;
      if (PUSH_VALUE_OPTIONS.has(arg)) i++;
    } else if (isShort(arg)) {
      const { flags, wantsNext } = shortFlags(arg, "o");
      if (flags.includes("f")) force = true;
      if (flags.includes("n")) dryRun = true;
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

function stashQuestions(args: string[]): string[] {
  const sub = args[0];
  const tagged = args.some(
    (arg) =>
      arg === "--message" ||
      arg.startsWith("--message=") ||
      (isShort(arg) && shortFlags(arg, "m").flags.includes("m")),
  );
  // `git stash` and `git stash -u` are a push with no tag, and so is `save` with no message
  // word; `pop` takes the newest stash, whoever made it. `list`, `apply <sha>` and `drop`
  // are how a tagged stash is handled.
  const untaggedPush = (sub === undefined || sub.startsWith("-") || sub === "push") && !tagged;
  const saveWithoutMessage = sub === "save" && !args.slice(1).some((arg) => !arg.startsWith("-"));
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
        arg === "--force" ||
        arg === "--discard-changes" ||
        (isShort(arg) && shortFlags(arg, "cC").flags.includes("f")),
    );
  }
  if (sub === "checkout") {
    const dashes = rest.indexOf("--");
    const pathsGiven = dashes !== -1 && dashes < rest.length - 1;
    const force = rest.some(
      (arg) => arg === "--force" || (isShort(arg) && shortFlags(arg, "bB").flags.includes("f")),
    );
    return pathsGiven || force || rest.slice(0, dashes === -1 ? undefined : dashes).includes(".");
  }
  // `restore` puts files back in the working folder, unless it only unstages them.
  const staged = rest.some(
    (arg) => arg === "--staged" || (isShort(arg) && shortFlags(arg, "s").flags.includes("S")),
  );
  const worktree = rest.some(
    (arg) => arg === "--worktree" || (isShort(arg) && shortFlags(arg, "s").flags.includes("W")),
  );
  return !staged || worktree;
}

/** `git branch -D`, `-d -f`, `--delete --force`: deletes a branch even if it was never merged. */
function forceDeletesBranch(rest: string[]): boolean {
  const has = (long: string | undefined, short: string) =>
    rest.some((arg) => arg === long || (isShort(arg) && shortFlags(arg, "").flags.includes(short)));
  return has(undefined, "D") || (has("--delete", "d") && has("--force", "f"));
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
  if (sub === "stash") return options.sharedStash ? stashQuestions(rest) : [];
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
  if (sub === "reset" && rest.includes("--hard")) {
    return [
      "`git reset --hard` throws away every uncommitted change in this folder, for good. " +
        "Approve only if you want them gone; a WIP commit keeps the work first.",
    ];
  }
  if (sub === "clean") {
    const force = rest.some(
      (arg) => arg === "--force" || (isShort(arg) && shortFlags(arg, "e").flags.includes("f")),
    );
    const dryRun = rest.some(
      (arg) => arg === "--dry-run" || (isShort(arg) && shortFlags(arg, "e").flags.includes("n")),
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
  for (const segment of shellSegments(command, { blindWhenOpen: true, joinLines })) {
    const invocation = invocationOf(wordsOf(segment));
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    if (program === "git") found.push(...gitQuestions(args, folder, options));
    if (CHANGE_DIR.has(program)) folder = movedTo(program, folder, args);
    const inner = nestedCommand(program, args);
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
  const runs = (line: string, depth: number): boolean =>
    shellSegments(line, { blindWhenOpen: true, joinLines: true }).some((segment) => {
      const invocation = invocationOf(wordsOf(segment));
      if (invocation === undefined) return false;
      if (invocation.program === "git") return true;
      const inner = nestedCommand(invocation.program, invocation.args);
      return inner !== undefined && depth < MAX_NESTING && runs(inner, depth + 1);
    });
  return runs(command, 0);
}
