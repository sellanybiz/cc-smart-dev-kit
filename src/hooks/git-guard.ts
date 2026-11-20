/**
 * PreToolUse (Bash, PowerShell): asks the person before a git command that destroys work
 * or skips review. Both tools send `tool_input.command`.
 *
 * It asks before:
 * - a force-push (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+`
 *   refspec; not a `--dry-run`); any of these abbreviated the way git accepts (`--forc`);
 * - a push to a protected branch (cc-smart-dev-kit.json `protectedBranches`, default `main`):
 *   named, matched by a wildcard refspec (`'refs/heads/*:refs/heads/*'`), or sent by a bare
 *   `git push` / `HEAD` from a folder on that branch (the folder follows a `cd` /
 *   `Set-Location` earlier on the line). A push that names no branch sends what the repo's
 *   config says (`push.default`, `remote.<name>.push`, a `-c` on the line): with
 *   `push.default=upstream`, a branch whose upstream is `main` pushes to `main`;
 *   `git push --all` / `--mirror`, and the matching refspec `:`;
 * - a branch deleted on the remote (`git push origin :x`, `git push -d origin x`);
 * - any other `git push` while `autoPush` is off (D15; the default): a push leaves the machine.
 *   `autoPush` is read as the merge guard reads its gate (`resolveGate`): the default, the
 *   person's own `workflow.json`, and the project's file as committed on `origin/<base>`, never
 *   this checkout's copy, so a session cannot switch it on in its own worktree. A policy that
 *   cannot be read asks. A `--dry-run` sends nothing and asks nothing;
 * - `git reset --hard`; `git reset --merge` (it throws away changes that are staged but not
 *   committed: a staged change to a tracked file goes back to the target version, and a staged
 *   new file is deleted from the folder — measured on git 2.53; a file whose working copy
 *   differs from the target and has unstaged changes makes it refuse). `git reset --keep` asks
 *   nothing: it never overwrites a working file (it refuses instead), but it still resets the
 *   index, so a version staged and not also in the working file is dropped — commit it first
 *   when it is needed);
 * - `git clean -f` (not a `-n` dry run); `git worktree remove -f`;
 * - a checkout that discards changes: `git checkout -- <path>`, `checkout .`,
 *   `checkout -f`, `git switch -f` / `--discard-changes`, `git restore <path>` without
 *   `--staged`;
 * - `git branch -D` (deletes a branch that may not be merged);
 * - `git stash clear`, and `git stash drop` with no stash named: they throw away work;
 * - when the project works in worktrees (`worktrees` in cc-smart-dev-kit.json): a bare `git stash`
 *   or `git stash pop`, because every worktree shares one stash.
 *
 * A subagent undoing its own work is not asked: a working-folder discard (the `checkout`,
 * `restore` and `switch` forms, `reset --hard`, `reset --merge`, `clean -f`) asks nothing when
 * every folder the line can run it in is provably inside the worktree of the subagent that
 * runs it, `<root>/.claude/worktrees/agent-<agent_id>`: a hook's question cannot be remembered,
 * so each one only interrupts the person. The proof (`ownWorktreeProof`), all of it or the
 * question stays:
 * - the hook input's `agent_id` is the id in the folder's name, and the session's own folder
 *   (the input's `cwd`) is that worktree or inside it;
 * - real paths, never text: a link or a missing folder asks;
 * - every folder change on the line, at any depth (`cd`, `pushd`, `Set-Location`,
 *   `Push-Location`, an `eval`), names a folder the guard can follow and that is inside it,
 *   and every `-C` too; `cd -`, `popd`, `Pop-Location`, `source`, `.`, an `eval` it cannot read
 *   and a `..` in a relative `cd` ask, because where a `cd` really lands (a subshell, a pipe, a
 *   failed `cd`, a loop) is not known, so each folder is judged wherever the line could be;
 * - git itself says the folder's repository starts at that worktree
 *   (`git rev-parse --show-toplevel`): a repository inside it asks;
 * - git's location is not set another way: `--work-tree`, `--git-dir`, `-c core.worktree`, a
 *   wrapper (`env -C x git …`), or a word of the line that names `GIT_DIR`, `GIT_WORK_TREE`,
 *   `GIT_COMMON_DIR`, `GIT_INDEX_FILE` or `GIT_CONFIG_*`, in any case (`GIT_LOCATION`), or one of
 *   them in the guard's own environment.
 * Every other kind (a push, `branch -D`, the stash, `worktree remove -f`) still asks there.
 *
 * "ask", never "deny": the person may mean it, and a hook cannot tell. Every command of a
 * line is read on its own, through the one shell reader (`src/shell/command.ts`), in the
 * dialect of the tool that runs it (Bash or PowerShell; both when it is not told): quoted
 * text, quoted here-doc bodies and comments are data; a substitution (`$( … )`, a backtick,
 * an unquoted here-doc body), the inner command of `bash -c`, `cmd /c`, `pwsh -c`, `eval`,
 * `iex` and `job run` (three levels deep), and the script of a shell that reads it from
 * standard input (`sh <<'EOF' … EOF`, `echo "git push -f" | sh`) are commands. git's own
 * options before the subcommand are read as git reads them (`--config-env x=y`), and one
 * this guard does not know (a newer git's) makes every word after it a possible subcommand.
 * `git send-pack` and a `git -c alias.x=push x` on the line are pushes, and a program the
 * line works out when it runs (`$(which git) push`, `$GIT push`) asks when its words name a
 * push: the guard cannot name the program, so it never stays silent about the push.
 *
 * Known limits: a git alias from the person's own config (one set with `-c` on the line is
 * read), a `branch -f`, a `checkout -B` and a `switch -C` (they move a branch), brace
 * expansion (`{git,push}`), `-EncodedCommand`, `ssh`, a script file, a `cd` it cannot follow
 * (`cd -`, `cd ~/x`, `cd $DIR`) and a branch it cannot read are not asked about; `git
 * checkout <name>` cannot tell a file from a branch, so it stays silent.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isInside } from "../path-compare";
import { CHANGES_FOLDER, type Folder, movedTo } from "../shell/change-dir";
import {
  type Dialect,
  invocationOf,
  isShort,
  isWrapper,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  programsOf,
  type Reading,
  readingsOf,
  shellSteps,
  shortFlags,
  withoutRedirections,
  wordsOf,
} from "../shell/command";
import { type GitCall, gitCalls, longOption } from "../shell/git-calls";
import { GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
import { memoizedRealPath, type RealPath } from "./real-path";
import type { Env } from "./run";
import { subagentWorktreeOf } from "./subagent-worktree";

/** The branches asked about when cc-smart-dev-kit.json names none. */
export const DEFAULT_PROTECTED_BRANCHES = ["main"];

export interface GuardOptions {
  protectedBranches: string[];
  /**
   * The question `autoPush` off puts to the person before every push (D15), or null when it is
   * on. A function, so the policy is read (git, a file) only for a line that really pushes.
   */
  autoPushAsk: () => string | null;
  /**
   * Ask before a bare `git stash` / `stash pop`: the stash list is shared, because the project
   * works in worktrees or this checkout is a linked worktree (a builder's).
   */
  sharedStash: boolean;
  env: Env;
  /** The dialect of the tool that runs the line (`dialectOfTool`); not given, both are read. */
  dialect?: Dialect | undefined;
  /**
   * The hook input's `agent_id`: set when a subagent runs the line, null (or not given) for the
   * main session. With it, a working-folder discard inside that subagent's own worktree asks
   * nothing (`insideOwnWorktree`).
   */
  agentId?: string | null | undefined;
}

/**
 * A discard that would be silent in the subagent's own worktree, kept until the whole line is
 * read: whether it is silent depends on every folder change and every word of the line, before
 * and after it (`ownWorktreeProof`).
 */
interface OwnDiscard {
  /** The question it asks when the proof fails. */
  ask: string;
  /** The folders git's `-C` options move to, in order. */
  dirs: string[];
  dialect: Dialect;
}

/** A command that changes the folder the shell is in (`CHANGES_FOLDER`), as the line wrote it. */
interface FolderChange {
  program: string;
  operands: string[];
  dialect: Dialect;
}

/** One guard run: its options, and what it read from git once (a line may push many times). */
interface GuardRun {
  options: GuardOptions;
  branches: Map<string, string | undefined>;
  pushConfigs: Map<string, Map<string, string[]>>;
  /** The discards `callQuestions` left to `ownWorktreeProof`. */
  discards: OwnDiscard[];
  /** Every folder change of the line, at any depth. */
  folderChanges: FolderChange[];
  /** A word of the line, at any depth, names where git works (`GIT_LOCATION`). */
  locationNamed: boolean;
  /** The line changes the shell's folder or state in a way the guard cannot read. */
  unreadable: boolean;
  /** Real paths, remembered for this run. */
  real: RealPath;
  /** Whether git says a real folder's repository starts at the own worktree, per folder. */
  startsAtRoot: Map<string, boolean>;
}

/**
 * The environment variables that move where git reads and writes, or what it reads from its
 * config (git(1), Environment Variables): the repository, the working folder, the shared
 * repository, the index, and the config git takes from the environment (`core.worktree` can
 * be one of its keys). Any case: PowerShell on Windows reads names without case. A line or a
 * guard environment that names one makes the folder git works in unknowable from the line's
 * own `cd` and `-C`.
 */
const GIT_LOCATION =
  /GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS))/i;

/** True when a word of the line names a variable of `GIT_LOCATION`, however it uses it. */
function namesGitLocation(words: readonly string[]): boolean {
  return words.some((word) => GIT_LOCATION.test(word));
}

/** True when the guard's own environment sets a variable of `GIT_LOCATION`. */
function envMovesGit(env: Env): boolean {
  return Object.entries(env).some(
    ([name, value]) => value !== undefined && GIT_LOCATION.test(name),
  );
}

/** `git push` options that take the next word as their value, and the shortest prefix git accepts. */
const PUSH_VALUE_OPTIONS: Array<[string, number]> = [
  ["--exec", 4],
  ["--push-option", 4],
  ["--receive-pack", 5],
  ["--repo", 6],
];

/**
 * A word of the push the shell works out when the line runs (`$(echo -f)`, `` `cat opts` ``) may
 * become any option, so one that holds a force-push spelling — a short group with `f`,
 * `--force…`, a `+` before a branch name — asks as a force-push does (`hooks.md`: a guard whose
 * domain words are in a computed command asks).
 */
function computedForce(arg: string): boolean {
  // The spelling stands where the shell starts a word, or where `${x:-…}` gives its default; a
  // group of short letters ends at a word's end (`cut -f2` is no `-f`).
  const spelling =
    /(?:^|[\s(`'"]|:[-=+])(?:-[A-Za-z]*f[A-Za-z]*(?=$|[\s)`'"}])|--force|\+[A-Za-z])/;
  return /\$[({\w]|`/.test(arg) && spelling.test(arg);
}

/** The branch checked out in `where`, or undefined: detached, unknown, no git. Read once a run. */
function currentBranch(where: string, run: GuardRun): string | undefined {
  if (!run.branches.has(where)) {
    const read = runGit(
      where,
      ["symbolic-ref", "--short", "-q", "HEAD"],
      run.options.env,
      GUARD_GIT_TIMEOUT_MS,
    );
    run.branches.set(where, read.ok && read.out !== "" ? read.out : undefined);
  }
  return run.branches.get(where);
}

/** The config keys that decide what a push with no refspec sends (git-config(1), `push`). */
const PUSH_CONFIG_KEYS =
  "^(push\\.default|remote\\.pushdefault|branch\\..*\\.(remote|pushremote|merge)|remote\\..*\\.push)$";

/**
 * Those keys as `where`'s git config holds them, key → values (one `git config` call, read
 * once a run). Section and key names are lowercase there; a branch or remote name keeps its
 * case. Nothing set, or no repo: an empty map.
 */
function pushConfig(where: string, run: GuardRun): Map<string, string[]> {
  const cached = run.pushConfigs.get(where);
  if (cached !== undefined) return cached;
  const read = runGit(
    where,
    ["config", "--get-regexp", PUSH_CONFIG_KEYS],
    run.options.env,
    GUARD_GIT_TIMEOUT_MS,
  );
  const config = new Map<string, string[]>();
  for (const line of read.ok ? read.out.split("\n") : []) {
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    if (key !== "")
      config.set(key, [...(config.get(key) ?? []), space === -1 ? "" : line.slice(space + 1)]);
  }
  run.pushConfigs.set(where, config);
  return config;
}

/**
 * The refspecs a push that names none sends to `remote` (null: the default one), as git
 * picks them (git-push(1), git-config(1) `push.default`): the remote's own `push` refspecs
 * when it has some; else `push.default` — `simple` and `current` send the branch to its own
 * name, `upstream` to the branch it tracks, `matching` every branch both sides have (the
 * refspec `:`), `nothing` nothing. A value set on the line with `--config-env` cannot be
 * read, so it counts as `:` — every branch.
 */
function bareRefspecs(
  remote: string | null,
  branch: string,
  config: Map<string, string[]>,
  onLine: ReadonlyMap<string, string | null>,
): string[] {
  let unknown = false;
  const values = (key: string): string[] => {
    if (!onLine.has(key)) return config.get(key) ?? [];
    const value = onLine.get(key);
    if (value === null || value === undefined) unknown = true;
    return value === null || value === undefined ? [] : [value];
  };
  const one = (key: string) => values(key)[0];
  const target =
    remote ??
    one(`branch.${branch}.pushremote`) ??
    one("remote.pushdefault") ??
    one(`branch.${branch}.remote`) ??
    "origin";
  const configured = values(`remote.${target}.push`);
  const mode = (one("push.default") ?? "simple").toLowerCase();
  const merge = one(`branch.${branch}.merge`);
  if (unknown) return [":"];
  if (configured.length > 0) return configured;
  if (mode === "nothing") return [];
  if (mode === "matching") return [":"];
  if (mode === "upstream" || mode === "tracking") {
    return merge === undefined ? [] : [`${branch}:${merge}`];
  }
  return [branch];
}

/**
 * The protected branch a push destination reaches, or undefined. A destination may be a
 * glob (`refs/heads/*`, `*`, `release/*`): git's `*` matches any text, slashes included.
 */
function protectedMatch(destination: string, protectedBranches: string[]): string | undefined {
  const name = destination.replace(/^refs\/heads\//, "");
  if (!destination.includes("*")) return protectedBranches.find((branch) => branch === name);
  const glob = (pattern: string) =>
    new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
  const asRef = glob(destination);
  const asName = glob(name);
  return protectedBranches.find(
    (branch) => asRef.test(`refs/heads/${branch}`) || asName.test(branch),
  );
}

/** Where a push runs: the branch checked out there, and what a push with no refspec sends. */
interface PushPlace {
  branch: () => string | undefined;
  bare: (remote: string | null) => string[];
}

function pushQuestions(
  args: string[],
  place: PushPlace,
  protectedBranches: string[],
  autoPushAsk: () => string | null,
): string[] {
  const found: string[] = [];
  const positional: string[] = [];
  let dryRun = false;
  let force = false;
  let deleting = false;
  let everyBranch = false;
  let repo: string | null = null;
  let repoGiven = false;
  let tagsOnly = false;
  // A computed word may become a force option or a `+` refspec, before `--` or after it.
  if (args.some(computedForce)) force = true;
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
      if (longOption(arg, "--repo", 6)) {
        repoGiven = true;
        repo = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : (args[i + 1] ?? null);
      }
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
  // Every push leaves the machine; `autoPush` off asks about each one (D15).
  const autoPush = autoPushAsk();
  if (autoPush !== null) found.push(autoPush);
  // The first word is the remote; the rest are refspecs (`[+]source[:destination]`). With
  // none, git sends what the config says for that remote (`bareRefspecs`).
  const given = repoGiven ? positional : positional.slice(1);
  const remote = repoGiven ? repo : (positional[0] ?? null);
  const refspecs = given.length === 0 && !tagsOnly && !everyBranch ? place.bare(remote) : given;

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
  // A branch deleted on the remote: `git push origin :x`, or `--delete x` (which needs a name).
  const deleted = (deleting ? given : refspecs)
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
    if (spec === ":") {
      // The matching refspec: every branch that both sides have, a protected one included.
      targets.push(...protectedBranches);
    } else if (colon === -1 && (spec === "HEAD" || spec === "@")) {
      // `git push origin HEAD` sends the branch that is checked out here.
      const here = place.branch();
      if (here !== undefined) targets.push(here);
    } else {
      targets.push(destination);
    }
  }
  const protectedTarget = targets
    .map((target) => protectedMatch(target, protectedBranches))
    .find((match) => match !== undefined);
  if (protectedTarget !== undefined) {
    found.push(
      `This pushes straight to \`${protectedTarget}\`, a protected branch: work usually reaches ` +
        "it through a pull request. Approve only if you meant to push there.",
    );
  }
  return found;
}

/** A discarding `checkout` / `switch -f` / `restore`: the question names the command. */
function discardAsk(sub: string): string {
  return (
    `\`git ${sub}\` here overwrites files in this folder with another version, and any ` +
    "uncommitted change in them is lost for good. Approve only if you want them gone; a " +
    "WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask."
  );
}

const WORKTREE_REMOVE_ASK =
  "`git worktree remove --force` deletes a worktree even when it holds uncommitted or " +
  "untracked work, and git cannot bring that back. Look in it first.";

const BRANCH_DELETE_ASK =
  "`git branch -D` deletes a branch even if it was never merged: its commits are then " +
  "only in the reflog. `git branch -d` deletes a merged branch, and does not ask.";

const RESET_HARD_ASK =
  "`git reset --hard` throws away every uncommitted change in this folder, for good. " +
  "Approve only if you want them gone; a WIP commit keeps the work first.";

const RESET_MERGE_ASK =
  "`git reset --merge` throws away changes that are staged but not committed: a staged " +
  "change to a tracked file goes back to the target version, and a staged new file is " +
  "deleted from the folder (measured). Your working files are kept: it refuses rather than " +
  "overwrite one whose working copy differs from the target, including a file with both " +
  "staged and unstaged changes (measured on git 2.53). Approve only if you want the " +
  "staged work gone; a WIP commit keeps it first.";

const CLEAN_FORCE_ASK =
  "`git clean -f` deletes untracked files for good: git cannot bring them back. " +
  "`git clean -n` shows what it would delete, without deleting.";

const STASH_CLEAR_ASK =
  "`git stash clear` throws away every stash for good: git cannot bring them back. " +
  "`git stash list` shows what they hold, `git stash show -p` one of them.";

const STASH_DROP_ASK =
  "`git stash drop` with no stash named drops the newest one, whoever made it. " +
  "`git stash list` shows them; `git stash drop stash@{n}` drops the one you mean.";

const STASH_SHARED_ASK =
  "The git stash is shared by every worktree of this repo, so a bare `git stash` or " +
  "`git stash pop` can take or restore another session's work. A WIP commit is safer; " +
  "or `git stash push -u -m <tag>`, then `git stash apply <its sha>`.";

/**
 * The ask a `git stash` line raises, or null when it raises none. `sharedStash`: the stash is
 * shared by every worktree of the repo — the project works in worktrees.
 */
function stashAsk(args: string[], sharedStash: boolean): string | null {
  const sub = args[0];
  const named = args.slice(1).some((arg) => !arg.startsWith("-"));
  if (sub === "clear") return STASH_CLEAR_ASK;
  if (sub === "drop" && !named) return STASH_DROP_ASK;
  if (!sharedStash) return null;
  const tagged = args.some(
    (arg) =>
      longOption(arg, "--message", 6) || (isShort(arg) && shortFlags(arg, "m").flags.includes("m")),
  );
  // `git stash` and `git stash -u` are a push with no tag, and so is `save` with no message
  // word; `pop` takes the newest stash, whoever made it. `list`, `apply <sha>` and
  // `drop <stash>` are how a tagged stash is handled.
  const untaggedPush = (sub === undefined || sub.startsWith("-") || sub === "push") && !tagged;
  const saveWithoutMessage = sub === "save" && !named;
  if (sub !== "pop" && !untaggedPush && !saveWithoutMessage) return null;
  return STASH_SHARED_ASK;
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

/**
 * The question when the line's program is worked out when it runs (`$GIT`, `$(which git)`)
 * and its words name a push: the guard cannot tell whether it pushes, so it asks.
 */
const COMPUTED_PUSH_ASK =
  "This command runs a program it works out when it runs, and its words name a push, so this guard cannot tell whether it pushes. Write the command out in full (for example `git push …`) if you meant it.";

/** True when a command's words name a push, for a program the reader cannot name. */
function namesPush(words: readonly string[]): boolean {
  return words.some((word) => word === "push" || word === "send-pack");
}

/** True when a command's program is computed and the words of that command name a push. */
function computedPushIn(command: string, dialect?: Dialect): boolean {
  return readingsOf(command, dialect).some((reading) =>
    shellSteps(command, {
      blindWhenOpen: true,
      dialect: reading.dialect,
      joinLines: reading.joinLines,
    }).some((step) => {
      const words = wordsOf(step.text, reading.dialect);
      const invocation = invocationOf(words);
      return invocation?.computed === true && namesPush(words);
    }),
  );
}

/**
 * True when nothing before `git` can move where it works: a wrapper (`env -C x git …`, `sudo`)
 * or an option on the prefix (`Start-Process -WorkingDirectory x`) can. A shell keyword, a
 * redirection and a variable (`LANG=C`) move nothing. git's own `--work-tree`, `--git-dir` and
 * `-c core.worktree` are read from the call itself, and a variable that names git's location
 * from the whole line (`namesGitLocation`).
 */
function plainPrefix(prefix: readonly string[]): boolean {
  return !prefix.some((word) => isWrapper(word) || word.startsWith("-"));
}

function gitQuestions(
  args: string[],
  folder: Folder,
  prefix: readonly string[],
  dialect: Dialect,
  run: GuardRun,
): string[] {
  const plain = plainPrefix(prefix);
  return gitCalls(args).flatMap((call) => callQuestions(call, folder, plain, dialect, run));
}

/**
 * The words a `-c alias.<name>=push` (or `=send-pack`) gives the subcommand it names, or
 * null when the subcommand is no push alias. `git -c alias.p=push p origin main` pushes.
 */
function pushAlias(call: GitCall): string[] | null {
  const value = call.config.get(`alias.${call.sub.toLowerCase()}`);
  if (value === null || value === undefined) return null;
  const words = wordsOf(value);
  const first = words[0] ?? "";
  return first === "push" || first === "send-pack" ? words.slice(1) : null;
}

function callQuestions(
  call: GitCall,
  folder: Folder,
  plain: boolean,
  dialect: Dialect,
  run: GuardRun,
): string[] {
  const { options } = run;
  const { rest, sub } = call;
  const alias = pushAlias(call);
  // `git send-pack` pushes, and so does an alias a `-c` on the line expands to a push.
  if (sub === "push" || sub === "send-pack" || alias !== null) {
    const where = folder === null ? null : resolve(folder, ...call.dirs);
    const place: PushPlace = {
      branch: () => (where === null ? undefined : currentBranch(where, run)),
      bare: (remote) => {
        const branch = where === null ? undefined : currentBranch(where, run);
        if (where === null || branch === undefined) return [];
        return bareRefspecs(remote, branch, pushConfig(where, run), call.config);
      },
    };
    return pushQuestions(
      alias === null ? rest : [...alias, ...rest],
      place,
      options.protectedBranches,
      options.autoPushAsk,
    );
  }
  if (sub === "stash") {
    const ask = stashAsk(rest, options.sharedStash);
    return ask === null ? [] : [ask];
  }
  if (sub === "worktree" && rest[0] === "remove") {
    const force = rest
      .slice(1)
      .some(
        (arg) =>
          longOption(arg, "--force", 6) ||
          (isShort(arg) && shortFlags(arg, "").flags.includes("f")),
      );
    if (force) return [WORKTREE_REMOVE_ASK];
  }
  // The working-folder discards below ask nothing inside the subagent's own worktree, when the
  // whole line proves it (`ownWorktreeProof`); every other kind of this function reaches
  // outside it (a remote, the branch list, the shared stash).
  const unlessOwn = (ask: string): string[] => {
    const own =
      plain &&
      (options.agentId ?? null) !== null &&
      call.workTree === null &&
      call.gitDir === null &&
      !call.config.has("core.worktree");
    if (!own) return [ask];
    run.discards.push({ ask, dialect, dirs: call.dirs });
    return [];
  };
  if ((sub === "checkout" || sub === "restore" || sub === "switch") && discardsChanges(sub, rest)) {
    return unlessOwn(discardAsk(sub));
  }
  if (sub === "branch" && forceDeletesBranch(rest)) return [BRANCH_DELETE_ASK];
  if (sub === "reset" && rest.some((arg) => longOption(arg, "--hard", 4))) {
    return unlessOwn(RESET_HARD_ASK);
  }
  // `--merge` loses staged work too (the measurement is in the file's header); `--keep` loses
  // nothing and stays silent.
  if (sub === "reset" && rest.some((arg) => longOption(arg, "--merge", 4))) {
    return unlessOwn(RESET_MERGE_ASK);
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
    if (force && !dryRun) return unlessOwn(CLEAN_FORCE_ASK);
  }
  return [];
}

/**
 * Programs that change the shell's folder or state where the guard cannot follow: `source` and
 * `.` run a script in this shell, and `Pop-Location` goes back to a folder the line never named.
 */
const UNFOLLOWED: ReadonlySet<string> = new Set([".", "pop-location", "source"]);

/** Programs that run the text they are given in this shell (a `cd` in it is a folder change). */
const EVALUATES: ReadonlySet<string> = new Set(["eval", "iex", "invoke-expression"]);

/** A brace pair (`{a,b}`, `{1..3}`): the shell turns one word into several, which the guard cannot name. */
const BRACE_PAIR = /\{[^}]*(?:,|\.\.)[^}]*\}/;

/** The most folder changes, and the most folders they may reach, a proof will follow. */
const MAX_FOLDER_CHANGES = 64;
const MAX_FOLDERS = 32;

/** Where a relative path starts: no drive, no root, no `~`. */
const isRelativePath = (path: string): boolean => !/^(?:[\\/]|[A-Za-z]:|~)/.test(path);

/**
 * The folders each of `folders` can be in after `change`, or null when the guard cannot name
 * them: no target, two targets (zsh's `cd old new`), a `cd -` or `popd`, a `~`, a `$`, a glob
 * or a brace pair (`movedTo`, `BRACE_PAIR`), and a `..` in a relative target. The last one is
 * why a `cd` that may not take effect, or may take effect again in a loop, cannot walk out of the
 * worktree: a relative target only goes down.
 */
function followed(change: FolderChange, folders: readonly string[]): string[] | null {
  const named = change.operands.filter((arg) => !arg.startsWith("-") && arg.toLowerCase() !== "/d");
  const target = named[0];
  if (named.length !== 1 || target === undefined || BRACE_PAIR.test(target)) return null;
  if (isRelativePath(target) && target.split(/[\\/]/).includes("..")) return null;
  const moved = folders.map((folder) =>
    movedTo(change.program, folder, change.operands, { dialect: change.dialect }),
  );
  return moved.every((folder) => folder !== null) ? (moved as string[]) : null;
}

/**
 * The test a discard must pass to stay silent in the subagent's own worktree, or null when no
 * discard of this line can (`GuardRun.discards`). The line's folder is not tracked: where a
 * `cd` really lands (in a subshell, a pipe, a background job, after a failed `cd`) does not
 * matter when the session folder and every folder the line names are all inside the worktree.
 * Real paths decide it (`RealPath`), a missing folder is not inside, and git itself must say the
 * folder's repository starts at the worktree: a link, a missing folder and a repository of its
 * own inside it all ask.
 */
function ownWorktreeProof(run: GuardRun, cwd: string): ((discard: OwnDiscard) => boolean) | null {
  const { options, real } = run;
  if (run.locationNamed || run.unreadable || envMovesGit(options.env)) return null;
  if (run.folderChanges.length > MAX_FOLDER_CHANGES) return null;
  const start = resolve(cwd);
  const root = subagentWorktreeOf(start, options.agentId ?? null);
  if (root === null || !existsSync(root)) return null;
  const realRoot = real(root);
  const within = (folder: string): boolean =>
    existsSync(folder) && isInside(real(folder), realRoot);
  const startsAtRoot = (folder: string): boolean => {
    const key = real(folder);
    let known = run.startsAtRoot.get(key);
    if (known === undefined) {
      const top = runGit(
        folder,
        ["rev-parse", "--show-toplevel"],
        options.env,
        GUARD_GIT_TIMEOUT_MS,
      );
      known =
        top.ok &&
        top.out !== "" &&
        isInside(real(top.out), realRoot) &&
        isInside(realRoot, real(top.out));
      run.startsAtRoot.set(key, known);
    }
    return known;
  };

  // The same folder change is met once for every way the line is read (both dialects when the
  // tool is not known, a nested text read again): the readings are alternatives, not a
  // sequence. So each distinct change is followed once, from the folders before it, in every
  // dialect it was read in. A repeated `cd src; cd src` counts once too: a relative target only
  // goes down, so a second step stays inside or fails where it stands.
  const changes = new Map<string, Map<Dialect, FolderChange>>();
  for (const change of run.folderChanges) {
    const key = [change.program, ...change.operands].join("\0");
    changes.set(key, (changes.get(key) ?? new Map()).set(change.dialect, change));
  }
  const folders = new Set([start]);
  for (const variants of changes.values()) {
    const before = [...folders];
    for (const change of variants.values()) {
      const reached = followed(change, before);
      if (reached === null) return null;
      for (const folder of reached) folders.add(folder);
    }
    if (folders.size > MAX_FOLDERS) return null;
  }
  if (![...folders].every(within)) return null;

  return (discard) =>
    [...folders].every((folder) => {
      let at: string | null = folder;
      for (const dir of discard.dirs) {
        if (BRACE_PAIR.test(dir)) return false;
        at = movedTo("cd", at, [dir], { dialect: discard.dialect });
        if (at === null) return false;
      }
      return within(at) && startsAtRoot(at);
    });
}

/** The questions the discards that looked silent still owe, once the whole line is read. */
function ownDiscardAsks(run: GuardRun, cwd: string): string[] {
  if (run.discards.length === 0) return [];
  const proof = ownWorktreeProof(run, cwd);
  return run.discards.filter((discard) => proof === null || !proof(discard)).map((d) => d.ask);
}

/**
 * Every question about a command line read one way (`reading`), each command of it read on
 * its own, in order, so a `cd` changes the folder the later commands run in.
 */
function inspect(
  command: string,
  cwd: Folder,
  reading: Reading,
  run: GuardRun,
  depth = 0,
): string[] {
  const found: string[] = [];
  let folder = cwd;
  const { dialect, joinLines } = reading;
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  for (const step of shellSteps(command, { blindWhenOpen: true, dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    // Before the early exit: `GIT_DIR=x` alone, and `export GIT_DIR=x`, run no program of ours.
    if (namesGitLocation(words)) run.locationNamed = true;
    const invocation = invocationOf(words);
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    // A redirection (`>log`, `2>&1`) is the shell's: git never sees it as a refspec.
    const operands = withoutRedirections(args);
    if (UNFOLLOWED.has(program)) run.unreadable = true;
    if (CHANGES_FOLDER.has(program)) run.folderChanges.push({ dialect, operands, program });
    if (program === "git") {
      found.push(...gitQuestions(operands, folder, invocation.prefix, dialect, run));
    }
    // The program is worked out when the line runs (`$GIT push`, `$(which git) push`): the
    // guard cannot name it, so a line whose words name a push asks, never stays silent.
    if (invocation.computed && namesPush(words)) found.push(COMPUTED_PUSH_ASK);
    if (CHANGES_FOLDER.has(program)) folder = movedTo(program, folder, operands);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined) {
      // A folder change below the nesting limit, or in text the shell works out, is not read.
      if (depth >= MAX_NESTING || (EVALUATES.has(program) && /[$`]/.test(inner))) {
        run.unreadable = true;
      } else {
        for (const nested of readingsOf(inner, nestedDialect(program))) {
          found.push(...inspect(inner, folder, nested, run, depth + 1));
        }
      }
    }
  }
  return found;
}

/**
 * The questions to put to the person about `command`, run in `cwd`, each once. Empty when
 * nothing in it destroys work. The line is read every way it may run (`readingsOf`): in the
 * tool's dialect (both when it is not given), and, when a line ends in the escape, both
 * joined to the next and not, since a trailing `\` may just end a Windows path.
 */
export function guardQuestions(command: string, cwd: string, options: GuardOptions): string[] {
  const run: GuardRun = {
    options,
    branches: new Map(),
    pushConfigs: new Map(),
    discards: [],
    folderChanges: [],
    locationNamed: false,
    unreadable: false,
    real: memoizedRealPath(),
    startsAtRoot: new Map(),
  };
  const found = readingsOf(command, options.dialect).flatMap((reading) =>
    inspect(command, cwd, reading, run),
  );
  // The discards that look like a subagent's own are judged on the whole line, at its end.
  found.push(...ownDiscardAsks(run, cwd));
  return [...new Set(found)];
}

/**
 * True when the command line runs git at all (what the guard asks about when it cannot read
 * its config), in the tool's dialect, or in both when it is not given. A `$GIT push` counts:
 * the guard cannot name the program, but a push's words are there.
 */
export function runsGit(command: string, dialect?: Dialect): boolean {
  return programsOf(command, dialect).includes("git") || computedPushIn(command, dialect);
}
