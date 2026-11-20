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
 * the line is a plain one and every folder it can run the discard in is provably inside the
 * worktree of the subagent that runs it, `<root>/.claude/worktrees/agent-<agent_id>`: a hook's
 * question cannot be remembered, so each one only interrupts the person. The proof
 * (`ownWorktreeProof`), all of it or the question stays:
 * - the line is plain: every command of it, at any depth, is one of three shapes
 *   (`plainStep`), and anything else asks — a shell trick that moves git cannot hide in a
 *   shape the guard does not know, because no such shape is silent:
 *   1. `git` itself, with nothing in front of it (no wrapper, no variable, no keyword), running
 *      a subcommand of `PLAIN_GIT_SUBCOMMANDS` with no `-c`, `--work-tree` or `--git-dir`;
 *   2. a folder change (`cd`, `chdir`, `pushd`, `Set-Location`, `sl`, `Push-Location`) with one
 *      folder and no option (PowerShell's `-Path` / `-LiteralPath` with its one value);
 *   3. a program of `INERT_PROGRAMS`, which changes neither the shell's folder nor its state
 *      and runs no command it is given; `printf -v` sets a variable, so `printf` with an
 *      option is not one. Read as PowerShell, a word that names the alias, env, function or
 *      variable drive, or a parameter that sets a variable (`-OutVariable`), is not one either;
 *   and its words do nothing more: no `$` or backtick anywhere in the line (`EXPANSION`: an
 *   expansion can assign, `${CDPATH:=x}`, or run a command), no word naming a `.git` path
 *   (`DOT_GIT_PATH`) or a glob on a dot name that could (`DOT_GLOB`), nothing defines a function on the line (`name()`), and, read as
 *   PowerShell, it holds no brace (a script block). The line is judged as the tool runs it
 *   (`toolDialect`);
 * - the hook input's `agent_id` is the id in the folder's name, and the session's own folder
 *   (the input's `cwd`) is that worktree or inside it;
 * - the worktree is real: no link on its path, git says it is a linked worktree whose top is
 *   that folder (`--git-dir` is not `--git-common-dir`), and its git folder's `gitdir` file
 *   points back at its `.git`;
 * - real paths, never text: a link or a missing folder asks;
 * - every folder change of the line, every time it appears, is followed from every folder the
 *   line could be in by then, and every `-C` too, and each folder they reach is inside the
 *   worktree: where a `cd` really lands (a subshell, a pipe, a failed `cd`, a loop) is not
 *   known, so each folder is judged wherever the line could be. A target with `..`, `~`, `$`,
 *   a glob, a brace pair, a backtick, `%VAR%` or a bare drive (`D:`) is not followed, nor a
 *   relative one while the guard's environment sets `CDPATH`;
 * - git itself says the folder's repository starts at that worktree
 *   (`git rev-parse --show-toplevel`): a repository inside it asks;
 * - git's location is not set another way: `--work-tree`, `--git-dir`, a `-c` on that call, or
 *   a word of the line that names `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`,
 *   `GIT_INDEX_FILE`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>` or
 *   `GIT_CONFIG_PARAMETERS`, in any case (`GIT_LOCATION`), or one of them in the guard's own
 *   environment;
 * - every git call of the proof ends inside one deadline (`OWN_WORKTREE_PROOF_BUDGET_MS`), well
 *   inside the hook's own timeout, and there are at most `MAX_PROOF_GIT_CALLS` of them: a git
 *   that is slow to answer, or a line with more distinct folders, asks.
 * Every other kind (a push, `branch -D`, the stash, `worktree remove -f`) is judged there as
 * anywhere else. Limits of the proof: a `CDPATH`, an alias or a function that only the Bash
 * tool's shell snapshot (or `CLAUDE_ENV_FILE`) holds is not seen by the hook, nor a shell option
 * set only there (bash's `dotglob`, so `*` reaches `.git`); a line that
 * changes a folder it checked before git runs (swaps it for a link) is judged as the disk was;
 * the Windows paths are not run on Windows.
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
 * push: the guard cannot name the program, so it never stays silent about the push. Such a
 * program asks too when its words would make git ask (`$GIT reset --hard`), and so does a git
 * subcommand worked out when the line runs (`git $(echo push) --force`) whenever any subcommand
 * the guard judges would ask with the words after it (`SUBCOMMAND_JUDGES`, the one list): since
 * even a bare `git restore` asks, every such call asks. A program and a subcommand both worked
 * out ask beside a danger option, one that makes some judged subcommand ask more than it does
 * alone (`$GIT $SUB --hard`, `-D`, `--force`, `--`); `$EDITOR $FILE` holds none and stays silent.
 * A danger option worked out too (`$GIT $SUB $OPT`) is not read.
 *
 * Known limits: a git alias from the person's own config (one set with `-c` on the line is
 * read), a `branch -f`, a `checkout -B` and a `switch -C` (they move a branch), brace
 * expansion (`{git,push}`), `-EncodedCommand`, `ssh`, a script file, a `cd` it cannot follow
 * (`cd -`, `cd ~/x`, `cd $DIR`) and a branch it cannot read are not asked about; `git
 * checkout <name>` cannot tell a file from a branch, so it stays silent.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isInside, samePath } from "../path-compare";
import { CHANGES_FOLDER, type Folder, movedTo } from "../shell/change-dir";
import {
  type Dialect,
  type Invocation,
  invocationOf,
  isComputedWord,
  isShort,
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
import { type Budget, OWN_WORKTREE_PROOF_BUDGET_MS, startBudget } from "./budget";
import { type GitRun, GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
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
   * The hook input's `agent_id` (as `agentIdKey` gives it): set when a subagent runs the line,
   * null (or not given) for the main session. With it, a working-folder discard inside that
   * subagent's own worktree asks nothing (`ownWorktreeProof`).
   */
  agentId?: string | null | undefined;
  /**
   * The dialect the tool really runs the line in (`dialectOfTool`), for the own-worktree proof
   * alone: the questions read the line every way (`dialect`), but whether a line is plain is
   * judged as it will run. Not given, every reading must be plain.
   */
  toolDialect?: Dialect | undefined;
  /** When the hook started (the frame's `nowMs`): the proof's deadline counts from there. */
  startedAtMs?: number | undefined;
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

/** One way the line was read (`readingsOf`), as the own-worktree proof needs it. */
interface ReadingProof {
  dialect: Dialect;
  /** Every command of the reading, at any depth, is a plain shape (`plainStep`). */
  plain: boolean;
  /** Every folder change of the reading, in order, each time it appears. */
  folderChanges: FolderChange[];
}

/** One guard run: its options, and what it read from git once (a line may push many times). */
interface GuardRun {
  options: GuardOptions;
  branches: Map<string, string | undefined>;
  pushConfigs: Map<string, Map<string, string[]>>;
  /** The discards `callQuestions` left to `ownWorktreeProof`. */
  discards: OwnDiscard[];
  /** Each reading of the line: whether it is plain, and its folder changes. */
  readings: ReadingProof[];
  /** A word of the line, at any depth, names where git works (`GIT_LOCATION`). */
  locationNamed: boolean;
  /** Real paths, remembered for this run. */
  real: RealPath;
  /** Whether git says a real folder's repository starts at the own worktree, per folder. */
  startsAtRoot: Map<string, boolean>;
  /** The one deadline every git call of the proof shares (`OWN_WORKTREE_PROOF_BUDGET_MS`). */
  budget: Budget;
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

/**
 * The question when git, or the subcommand git runs, is worked out when the line runs (`$GIT
 * reset --hard`, `git $(echo push) --force`) and the words beside it would make this guard ask
 * if they followed a subcommand it judges (`SUBCOMMAND_JUDGES`).
 */
const COMPUTED_GIT_ASK =
  "This command runs git, or a git subcommand, that it works out when it runs, so this guard cannot tell what it does: it may be a command this guard asks about (for example `git restore`, `git reset --hard` or `git push --force`). Write the command out in full if you meant it.";

/** True when a command's words name a push, for a program the reader cannot name. */
function namesPush(words: readonly string[]): boolean {
  return words.some((word) => word === "push" || word === "send-pack");
}

/**
 * True when a command's program is computed and a word of that command names a subcommand the
 * guard judges (`SUBCOMMAND_JUDGES`): the program may be git.
 */
function computedGitIn(command: string, dialect?: Dialect): boolean {
  return readingsOf(command, dialect).some((reading) =>
    shellSteps(command, {
      blindWhenOpen: true,
      dialect: reading.dialect,
      joinLines: reading.joinLines,
    }).some((step) => {
      const words = wordsOf(step.text, reading.dialect);
      const invocation = invocationOf(words);
      return invocation?.computed === true && words.some((word) => SUBCOMMAND_JUDGES.has(word));
    }),
  );
}

/**
 * The questions about git's arguments `args`. A subcommand worked out when the line runs
 * (`git $(echo push) --force`, `git $SUB --hard`) is judged as each subcommand the guard knows:
 * when any of them would ask with the words after it, the call asks.
 */
function gitQuestions(args: string[], folder: Folder, dialect: Dialect, run: GuardRun): string[] {
  return gitCalls(args).flatMap((call) => {
    if (!isComputedWord(call.sub)) return callQuestions(call, folder, dialect, run);
    const asks = [...SUBCOMMAND_JUDGES].some(
      ([sub, judge]) => judge({ ...call, sub }, folder, dialect, asMainSession(run)).length > 0,
    );
    return asks ? [COMPUTED_GIT_ASK] : [];
  });
}

/**
 * True when a program worked out when the line runs may be git asking. Either a word of
 * `operands` names a subcommand the guard judges, and that subcommand, with the words after it,
 * asks (`$GIT reset --hard`, `$GIT -C sub checkout -- .`; every word is tried, since the
 * computed word may carry git's own options: `X='git -C'; $X sub reset --hard`). Or a word is
 * worked out too, so it may be any subcommand, and a plain word beside it is a danger option
 * (`dangerOption`: `$GIT $SUB --hard`, `$(echo git) $(echo branch) -D x`). `$EDITOR $FILE` holds
 * no danger option, so it stays silent.
 */
function computedProgramAsks(
  operands: readonly string[],
  folder: Folder,
  dialect: Dialect,
  run: GuardRun,
): boolean {
  const asMain = asMainSession(run);
  const named = operands.some((sub, at) => {
    const judge = SUBCOMMAND_JUDGES.get(sub);
    return (
      judge !== undefined &&
      judge(bareCall(sub, operands.slice(at + 1)), folder, dialect, asMain).length > 0
    );
  });
  if (named) return true;
  if (!operands.some(isComputedWord)) return false;
  const plain = new Set(operands.filter((word) => !isComputedWord(word)));
  return [...plain].some((word) => dangerOption(word, folder, dialect, asMain));
}

/**
 * True when `word` is a danger option of some subcommand the guard judges: with `word` after
 * it, that subcommand asks a question it does not ask with nothing after it (`--hard`,
 * `--force`, `-f`, `-D`, `--`, `--force-with-lease`). Read from the judges themselves
 * (`SUBCOMMAND_JUDGES`), so the set has one home. A word that asks nothing new (`notes.txt`,
 * which a bare `git restore` asks about anyway) is none.
 */
function dangerOption(word: string, folder: Folder, dialect: Dialect, run: GuardRun): boolean {
  return [...SUBCOMMAND_JUDGES].some(([sub, judge]) => {
    const alone = judge(bareCall(sub, []), folder, dialect, run);
    return judge(bareCall(sub, [word]), folder, dialect, run).some((ask) => !alone.includes(ask));
  });
}

/** A git call of `sub` with the words `rest` and none of git's own options. */
function bareCall(sub: string, rest: string[]): GitCall {
  return { config: new Map(), dirs: [], gitDir: null, rest, sub, workTree: null };
}

/**
 * The run judged as the main session: a computed word is never plain, so a discard it might be
 * asks at once instead of waiting for the own-worktree proof.
 */
function asMainSession(run: GuardRun): GuardRun {
  return { ...run, options: { ...run.options, agentId: null } };
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

/** The questions about one git call: a push alias pushes, else its subcommand's judge asks. */
function callQuestions(call: GitCall, folder: Folder, dialect: Dialect, run: GuardRun): string[] {
  const alias = pushAlias(call);
  if (alias !== null) return pushCallQuestions(call, [...alias, ...call.rest], folder, run);
  return SUBCOMMAND_JUDGES.get(call.sub)?.(call, folder, dialect, run) ?? [];
}

/** A push (`git push`, `git send-pack`, a push alias) with its words `args`. */
function pushCallQuestions(call: GitCall, args: string[], folder: Folder, run: GuardRun): string[] {
  const { options } = run;
  const where = folder === null ? null : resolve(folder, ...call.dirs);
  const place: PushPlace = {
    branch: () => (where === null ? undefined : currentBranch(where, run)),
    bare: (remote) => {
      const branch = where === null ? undefined : currentBranch(where, run);
      if (where === null || branch === undefined) return [];
      return bareRefspecs(remote, branch, pushConfig(where, run), call.config);
    },
  };
  return pushQuestions(args, place, options.protectedBranches, options.autoPushAsk);
}

/**
 * A working-folder discard's question, or none when it may be the subagent's own: the proof
 * judges those on the whole line at its end (`ownWorktreeProof`). Every other kind of question
 * reaches outside the worktree (a remote, the branch list, the shared stash). A `-c` on the call
 * may set where git works (`core.worktree`) or a program it runs (a filter, `core.fsmonitor`):
 * it asks.
 */
function unlessOwn(ask: string, call: GitCall, dialect: Dialect, run: GuardRun): string[] {
  const own =
    (run.options.agentId ?? null) !== null &&
    call.workTree === null &&
    call.gitDir === null &&
    call.config.size === 0;
  if (!own) return [ask];
  run.discards.push({ ask, dialect, dirs: call.dirs });
  return [];
}

/** The questions about one call of a subcommand the guard judges. */
type SubcommandJudge = (call: GitCall, folder: Folder, dialect: Dialect, run: GuardRun) => string[];

/** `checkout`, `restore` and `switch`: a discard of the working folder's changes. */
const discardJudge: SubcommandJudge = (call, _folder, dialect, run) =>
  discardsChanges(call.sub, call.rest) ? unlessOwn(discardAsk(call.sub), call, dialect, run) : [];

/**
 * Every git subcommand the guard judges, each with its judge: the one home of that list. A
 * subcommand that is not here never asks. A subcommand the line works out when it runs is
 * judged as each of these (`gitQuestions`, `computedProgramAsks`).
 */
const SUBCOMMAND_JUDGES: ReadonlyMap<string, SubcommandJudge> = new Map<string, SubcommandJudge>([
  ["push", (call, folder, _dialect, run) => pushCallQuestions(call, call.rest, folder, run)],
  ["send-pack", (call, folder, _dialect, run) => pushCallQuestions(call, call.rest, folder, run)],
  [
    "stash",
    (call, _folder, _dialect, run) => {
      const ask = stashAsk(call.rest, run.options.sharedStash);
      return ask === null ? [] : [ask];
    },
  ],
  [
    "worktree",
    (call) => {
      const [first, ...after] = call.rest;
      const force = after.some(
        (arg) =>
          longOption(arg, "--force", 6) ||
          (isShort(arg) && shortFlags(arg, "").flags.includes("f")),
      );
      return first === "remove" && force ? [WORKTREE_REMOVE_ASK] : [];
    },
  ],
  ["checkout", discardJudge],
  ["restore", discardJudge],
  ["switch", discardJudge],
  ["branch", (call) => (forceDeletesBranch(call.rest) ? [BRANCH_DELETE_ASK] : [])],
  [
    "reset",
    (call, _folder, dialect, run) => {
      if (call.rest.some((arg) => longOption(arg, "--hard", 4))) {
        return unlessOwn(RESET_HARD_ASK, call, dialect, run);
      }
      // `--merge` loses staged work too (the measurement is in the file's header); `--keep`
      // loses nothing and stays silent.
      if (call.rest.some((arg) => longOption(arg, "--merge", 4))) {
        return unlessOwn(RESET_MERGE_ASK, call, dialect, run);
      }
      return [];
    },
  ],
  [
    "clean",
    (call, _folder, dialect, run) => {
      const force = call.rest.some(
        (arg) =>
          longOption(arg, "--force", 6) ||
          (isShort(arg) && shortFlags(arg, "e").flags.includes("f")),
      );
      const dryRun = call.rest.some(
        (arg) =>
          longOption(arg, "--dry-run", 4) ||
          (isShort(arg) && shortFlags(arg, "e").flags.includes("n")),
      );
      return force && !dryRun ? unlessOwn(CLEAN_FORCE_ASK, call, dialect, run) : [];
    },
  ],
]);

/**
 * The programs a plain line may run besides `git` and a folder change (`plainStep`). Each one
 * changes neither the folder the shell is in nor the shell's state (a variable, a function, an
 * alias), and runs no command its arguments name: a program run as a child process cannot move
 * the shell, and the shell builtins here (`echo`, `printf`, `pwd`, `test`, `[`, `true`, `false`)
 * only print or test. `printf -v` sets a variable, so `printf` with an option is not plain. Read
 * as PowerShell, several are aliases of the cmdlets below, which run inside the shell: the alias,
 * env, function and variable drives and the parameters that set a variable are kept out
 * (`plainPowerShellWords`). Left out on purpose: shells, interpreters and package runners
 * (`bun`, `node`, `python`, `make`), the runners (`find`, `xargs`, `parallel`, `watch`, `su`,
 * `sudo`), `env`, `eval`, `source`, every wrapper, `rg` (`--pre` runs a program) and `sort`
 * (`--compress-program` runs one). The words matter too, for every program of a plain line: no
 * expansion (`EXPANSION`: `echo ${CDPATH:=x}` sets a variable through an inert program) and no
 * `.git` path (`DOT_GIT_PATH`: `rm .git`).
 */
export const INERT_PROGRAMS: ReadonlySet<string> = new Set([
  "[",
  "cat",
  "cp",
  "diff",
  "echo",
  "false",
  "grep",
  "head",
  "ls",
  "mkdir",
  "mv",
  "printf",
  "pwd",
  "rm",
  "rmdir",
  "tail",
  "tee",
  "test",
  "touch",
  "true",
  "uniq",
  "wc",
  "copy-item",
  "get-childitem",
  "get-content",
  "move-item",
  "new-item",
  "remove-item",
  "test-path",
  "write-host",
  "write-output",
]);

/**
 * The folder changes a plain line may make, each with one folder (`plainFolderChange`): the
 * guard follows them (`followed`). `popd` and `Pop-Location` go back to a folder the line never
 * named, so they are not here.
 */
const FOLLOWED_FOLDER_CHANGES: ReadonlySet<string> = new Set([
  "cd",
  "chdir",
  "pushd",
  "push-location",
  "set-location",
  "sl",
]);

/** A function defined on the line (`git() { … }`, `f ( ) ( … )`): a command may then mean anything. */
const FUNCTION_DEFINITION = /\(\s*\)/;

/**
 * Text the shell works out when the line runs: any `$` (a variable, `${X:=y}` and zsh's
 * `${X::=y}` that assign, `$((X=1))`, `$( … )`, bash 5.3's `${ cmd; }` that runs in this shell)
 * or a backtick. A word that expands can set the shell's state (CDPATH) or run a command the
 * reader never sees, so no plain line holds one, quoted or not, a here-doc body included. A `$`
 * in single quotes is text: it asks anyway, which is safe.
 */
const EXPANSION = /[$`]/;

/**
 * The git subcommands a plain line may run: the discards the proof judges, and ones that cannot
 * move where git works or what its config says (`push` is judged on its own, as anywhere
 * else, and a discard beside it stays the subagent's own). Any other (`config --worktree core.worktree`,
 * `worktree`, `init`, `submodule`, `update-ref`, an alias) makes the line ask.
 */
const PLAIN_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "add",
  "branch",
  "checkout",
  "clean",
  "commit",
  "diff",
  "log",
  "ls-files",
  "mv",
  "push",
  "reset",
  "restore",
  "rev-parse",
  "rm",
  "show",
  "stash",
  "status",
  "switch",
  "tag",
]);

/**
 * A word that names a `.git` path (`.git`, `src/.GIT/config`, `>.git`, `--output=.git`, any case,
 * either slash): removing or rewriting a worktree's `.git` file sends the next git call to
 * another repository, after the proof read the disk.
 */
const DOT_GIT_PATH = /(?:^|[\\/<>=:])\.git(?:$|[\\/])/i;

/** A glob on a dot name (`.g*`, `.gi?`): the shell may fill in `.git` itself. */
const DOT_GLOB = /(?:^|[\\/<>=:])\.[^\\/]*[*?[]/;

/** PowerShell's drives that hold the shell's own state, not files: `function:git`, `env:X`. */
const SHELL_STATE_DRIVE = /(?:^|[^a-z])(?:alias|env|function|variable):/i;

/** PowerShell's parameters that set a variable, by their full names and their aliases. */
const VARIABLE_PARAMETERS: readonly string[] = [
  "errorvariable",
  "informationvariable",
  "outvariable",
  "pipelinevariable",
  "variable",
  "warningvariable",
];
const VARIABLE_PARAMETER_ALIASES: ReadonlySet<string> = new Set(["ev", "iv", "ov", "pv", "wv"]);

/**
 * True when no word of a PowerShell command reaches the shell's own state: a path on the alias,
 * env, function or variable drive (`New-Item function:git`), or a parameter that sets a
 * variable, by any prefix PowerShell accepts (`-OutVariable`, `-ov`, `-Var`).
 */
function plainPowerShellWords(words: readonly string[]): boolean {
  return words.every((word) => {
    if (SHELL_STATE_DRIVE.test(word)) return false;
    if (!word.startsWith("-")) return true;
    const name = (word.slice(1).split(":")[0] ?? "").toLowerCase();
    if (name.length < 2) return true;
    return (
      !VARIABLE_PARAMETER_ALIASES.has(name) &&
      !VARIABLE_PARAMETERS.some((parameter) => parameter.startsWith(name))
    );
  });
}

/** One folder and no option; PowerShell may name it with `-Path` / `-LiteralPath`. */
function plainFolderChange(operands: readonly string[], dialect: Dialect): boolean {
  const [first = "", second = ""] = operands;
  if (operands.length === 1) return !first.startsWith("-");
  return (
    dialect === "powershell" &&
    operands.length === 2 &&
    /^-(?:literalpath|path)$/i.test(first) &&
    !second.startsWith("-")
  );
}

/**
 * True when a git call is plain: every way git may read it (`gitCalls`) runs a subcommand of
 * `PLAIN_GIT_SUBCOMMANDS`, with no `-c` / `--config-env` (a config can run a program,
 * `core.fsmonitor`, or name an alias) and no `--work-tree` / `--git-dir`. `git` alone, or one
 * that only prints (`git --version`), runs nothing.
 */
function plainGit(args: readonly string[]): boolean {
  return gitCalls(args).every(
    (call) =>
      PLAIN_GIT_SUBCOMMANDS.has(call.sub) &&
      call.config.size === 0 &&
      call.workTree === null &&
      call.gitDir === null,
  );
}

/**
 * True when one command of a line is a shape the own-worktree proof fully understands: `git`
 * with nothing before it, a folder change with one folder, or a program of `INERT_PROGRAMS`.
 * Its first word must be the program itself: not a path, not a wrapper, a variable, a keyword or
 * a redirection before it, not a program that starts another (`Start-Process git`, a package
 * runner), and no inner command (`bash -c`, `| sh`, `eval`). A piece with no words (what a `;` or
 * a brace leaves) runs nothing.
 */
function plainStep(
  words: readonly string[],
  invocation: Invocation | undefined,
  nested: string | undefined,
  dialect: Dialect,
): boolean {
  if (words.length === 0) return true;
  if (invocation === undefined || nested !== undefined) return false;
  if (invocation.computed || invocation.prefix.length > 0) return false;
  const first = (words[0] ?? "").toLowerCase();
  if (first !== invocation.program) return false;
  if (words.some((word) => DOT_GIT_PATH.test(word) || DOT_GLOB.test(word))) return false;
  const operands = withoutRedirections(invocation.args);
  if (dialect === "powershell" && !plainPowerShellWords(operands)) return false;
  if (first === "git") return plainGit(operands);
  if (FOLLOWED_FOLDER_CHANGES.has(first)) return plainFolderChange(operands, dialect);
  if (first === "printf") return !(operands[0] ?? "").startsWith("-");
  return INERT_PROGRAMS.has(first);
}

/** A brace pair (`{a,b}`, `{1..3}`): the shell turns one word into several, which the guard cannot name. */
const BRACE_PAIR = /\{[^}]*(?:,|\.\.)[^}]*\}/;

/** The most folder changes, and the most folders they may reach, a proof will follow. */
const MAX_FOLDER_CHANGES = 64;
const MAX_FOLDERS = 32;

/**
 * The most git calls one proof makes (the worktree's own check, then one per distinct folder a
 * discard runs in): beyond it the proof asks rather than start more, whatever time is left.
 */
const MAX_PROOF_GIT_CALLS = 16;

/** Where a relative path starts: no drive, no root, no `~`. */
const isRelativePath = (path: string): boolean => !/^(?:[\\/]|[A-Za-z]:|~)/.test(path);

/**
 * True when the guard may follow a folder a `cd` or a `-C` names: no `..` anywhere (after a link
 * it climbs out of the link's target, which no text can tell), no brace pair, and no bare or
 * drive-relative drive (`D:`, `D:x`: PowerShell goes to that drive's own current folder).
 * `movedTo` refuses the rest (`~`, `$`, a glob, a backtick, `%VAR%`).
 */
function followable(path: string): boolean {
  return (
    !BRACE_PAIR.test(path) &&
    !path.split(/[\\/]/).includes("..") &&
    !/^[A-Za-z]:(?![\\/])/.test(path)
  );
}

/** True when the guard's environment sets `CDPATH`: bash then looks for a relative folder there first. */
function setsCdpath(env: Env): boolean {
  return Object.entries(env).some(
    ([name, value]) => value !== undefined && name.toUpperCase() === "CDPATH",
  );
}

/**
 * The folders each of `folders` can be in after `change`, or null when the guard cannot name
 * them: no target, two targets (zsh's `cd old new`), a target it may not follow (`followable`,
 * `movedTo`), or a relative one while `CDPATH` is set.
 */
function followed(
  change: FolderChange,
  folders: readonly string[],
  cdpath: boolean,
): string[] | null {
  const named = change.operands.filter((arg) => !arg.startsWith("-"));
  const target = named[0];
  if (named.length !== 1 || target === undefined || !followable(target)) return null;
  if (cdpath && isRelativePath(target)) return null;
  const moved = folders.map((folder) =>
    movedTo(change.program, folder, change.operands, { dialect: change.dialect }),
  );
  return moved.every((folder) => folder !== null) ? (moved as string[]) : null;
}

/**
 * Every folder the readings the tool runs (`toolDialect`) can be in, or null when the guard
 * cannot name them. Each folder change, every time it appears, goes from every folder reached
 * before it: a `cd` that fails, runs in a subshell or runs again in a loop may start anywhere
 * the line has been. So `cd loop; cd loop` reaches `loop/loop`, and that is checked too.
 */
function reachedFolders(
  readings: readonly ReadingProof[],
  start: string,
  cdpath: boolean,
): Set<string> | null {
  const folders = new Set([start]);
  for (const reading of readings) {
    const reached = new Set([start]);
    for (const change of reading.folderChanges) {
      const moved = followed(change, [...reached], cdpath);
      if (moved === null) return null;
      for (const folder of moved) reached.add(folder);
      if (reached.size > MAX_FOLDERS) return null;
    }
    for (const folder of reached) folders.add(folder);
    if (folders.size > MAX_FOLDERS) return null;
  }
  return folders;
}

/**
 * The test a discard must pass to stay silent in the subagent's own worktree, or null when no
 * discard of this line can (`GuardRun.discards`). The line must be plain (`plainStep`) as the
 * tool runs it. The line's folder is not tracked: where a `cd` really lands (in a subshell, a
 * pipe, a background job, after a failed `cd`) does not matter when the session folder and every
 * folder the line can reach are all inside the worktree. Real paths decide it (`RealPath`), a
 * missing folder is not inside, the worktree must be a real linked worktree with no link on its
 * path, and git itself must say the folder's repository starts at the worktree. Every git call
 * here shares one deadline (`GuardRun.budget`); a call it has no time for asks.
 */
function ownWorktreeProof(run: GuardRun, cwd: string): ((discard: OwnDiscard) => boolean) | null {
  const { options, real } = run;
  const judged = run.readings.filter(
    (reading) => options.toolDialect === undefined || reading.dialect === options.toolDialect,
  );
  if (judged.length === 0 || judged.some((reading) => !reading.plain)) return null;
  if (run.locationNamed || envMovesGit(options.env)) return null;
  const changes = judged.reduce((count, reading) => count + reading.folderChanges.length, 0);
  if (changes > MAX_FOLDER_CHANGES) return null;
  const start = resolve(cwd);
  const root = subagentWorktreeOf(start, options.agentId ?? null);
  if (root === null || !existsSync(root)) return null;
  const realRoot = real(root);
  // No link on the worktree's own path: a link there could lead to any checkout.
  if (!samePath(root, realRoot)) return null;
  let gitCallsLeft = MAX_PROOF_GIT_CALLS;
  const gitIn = (folder: string, args: string[]): GitRun | null => {
    const timeoutMs = run.budget.timeFor(GUARD_GIT_TIMEOUT_MS);
    if (timeoutMs <= 0 || gitCallsLeft <= 0) return null;
    gitCallsLeft--;
    return runGit(folder, args, options.env, timeoutMs);
  };
  if (!isLinkedWorktree(root, realRoot, real, gitIn)) return null;
  run.startsAtRoot.set(realRoot, true);
  // Once per folder for the whole line, not once per discard. A folder whose text is outside the
  // worktree is never read on disk (a link into it from outside asks, which is safe).
  const inside = new Map<string, boolean>();
  const within = (folder: string): boolean => {
    let known = inside.get(folder);
    if (known === undefined) {
      known = isInside(folder, realRoot) && existsSync(folder) && isInside(real(folder), realRoot);
      inside.set(folder, known);
    }
    return known;
  };
  const startsAtRoot = (folder: string): boolean => {
    const key = real(folder);
    let known = run.startsAtRoot.get(key);
    if (known === undefined) {
      const top = gitIn(folder, ["rev-parse", "--show-toplevel"]);
      known = top?.ok === true && top.out !== "" && samePath(real(top.out), realRoot);
      run.startsAtRoot.set(key, known);
    }
    return known;
  };

  const folders = reachedFolders(judged, start, setsCdpath(options.env));
  if (folders === null || ![...folders].every(within)) return null;

  return (discard) =>
    [...folders].every((folder) => {
      let at: string | null = folder;
      for (const dir of discard.dirs) {
        if (!followable(dir)) return false;
        at = movedTo("cd", at, [dir], { dialect: discard.dialect });
        if (at === null) return false;
      }
      return within(at) && startsAtRoot(at);
    });
}

/**
 * True when `root` is a linked worktree whose top is `root` itself: one `git rev-parse` there
 * names its top, its own git folder and the repository's shared one, and a linked worktree's two
 * differ. Its git folder's own `gitdir` file must also point back at `root/.git`: a plain folder
 * whose `.git` file points at another worktree's git folder passes git's own test, and a discard
 * there would rewrite that worktree's index and HEAD. A main checkout, a plain folder with the
 * worktree's name, a folder git cannot read and a `gitdir` file that cannot be read all give false.
 */
function isLinkedWorktree(
  root: string,
  realRoot: string,
  real: RealPath,
  gitIn: (folder: string, args: string[]) => GitRun | null,
): boolean {
  const read = gitIn(root, ["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"]);
  if (read === null || !read.ok) return false;
  const [top, gitDir, commonDir] = read.out.split(/\r?\n/);
  if (top === undefined || gitDir === undefined || commonDir === undefined) return false;
  if (top === "" || gitDir === "" || commonDir === "") return false;
  const ownGitDir = resolve(root, gitDir);
  if (!samePath(real(top), realRoot) || samePath(real(ownGitDir), real(resolve(root, commonDir)))) {
    return false;
  }
  let pointsAt: string;
  try {
    pointsAt = readFileSync(join(ownGitDir, "gitdir"), "utf8").trim();
  } catch {
    return false; // no back-pointer to read: not proved, so the discard asks
  }
  return pointsAt !== "" && samePath(real(resolve(ownGitDir, pointsAt)), real(join(root, ".git")));
}

/** The questions the discards that looked silent still owe, once the whole line is read. */
function ownDiscardAsks(run: GuardRun, cwd: string): string[] {
  if (run.discards.length === 0) return [];
  const proof = ownWorktreeProof(run, cwd);
  return run.discards.filter((discard) => proof === null || !proof(discard)).map((d) => d.ask);
}

/**
 * Every question about a command line read one way (`reading`), each command of it read on
 * its own, in order, so a `cd` changes the folder the later commands run in. What the
 * own-worktree proof needs of this reading goes into `proof`.
 */
function inspect(
  command: string,
  cwd: Folder,
  reading: Reading,
  run: GuardRun,
  proof: ReadingProof,
  depth = 0,
): string[] {
  const found: string[] = [];
  let folder = cwd;
  const { dialect, joinLines } = reading;
  // PowerShell reads every brace as a script block or a hashtable: no plain shape holds one.
  if (dialect === "powershell" && /[{}]/.test(command)) proof.plain = false;
  // Anything the shell works out when the line runs: the whole text, so a here-doc body counts.
  if (EXPANSION.test(command)) proof.plain = false;
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  for (const step of shellSteps(command, { blindWhenOpen: true, dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    // Before the early exit: `GIT_DIR=x` alone, and `export GIT_DIR=x`, run no program of ours.
    if (namesGitLocation(words)) run.locationNamed = true;
    const invocation = invocationOf(words);
    const inner =
      invocation === undefined
        ? undefined
        : nestedCommand(invocation.program, invocation.args, step.pipedFrom);
    if (!plainStep(words, invocation, inner, dialect)) proof.plain = false;
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    // A redirection (`>log`, `2>&1`) is the shell's: git never sees it as a refspec.
    const operands = withoutRedirections(args);
    if (CHANGES_FOLDER.has(program)) proof.folderChanges.push({ dialect, operands, program });
    if (program === "git") found.push(...gitQuestions(operands, folder, dialect, run));
    // The program is worked out when the line runs (`$GIT push`, `$(which git) reset --hard`):
    // the guard cannot name it, so a line whose words name a push, or whose words would make
    // git ask, asks, never stays silent.
    if (invocation.computed && namesPush(words)) found.push(COMPUTED_PUSH_ASK);
    else if (invocation.computed && computedProgramAsks(operands, folder, dialect, run)) {
      found.push(COMPUTED_GIT_ASK);
    }
    if (CHANGES_FOLDER.has(program)) folder = movedTo(program, folder, operands);
    if (inner !== undefined && depth < MAX_NESTING) {
      for (const nested of readingsOf(inner, nestedDialect(program))) {
        found.push(...inspect(inner, folder, nested, run, proof, depth + 1));
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
    readings: [],
    locationNamed: false,
    real: memoizedRealPath(),
    startsAtRoot: new Map(),
    budget: startBudget(options.env, Date.now, OWN_WORKTREE_PROOF_BUDGET_MS, options.startedAtMs),
  };
  // A function defined anywhere on the line can give any command a new meaning.
  const definesFunction = FUNCTION_DEFINITION.test(command);
  const found = readingsOf(command, options.dialect).flatMap((reading) => {
    const proof: ReadingProof = {
      dialect: reading.dialect,
      plain: !definesFunction,
      folderChanges: [],
    };
    run.readings.push(proof);
    return inspect(command, cwd, reading, run, proof);
  });
  // The discards that look like a subagent's own are judged on the whole line, at its end.
  found.push(...ownDiscardAsks(run, cwd));
  return [...new Set(found)];
}

/**
 * True when the command line runs git at all (what the guard asks about when it cannot read
 * its config), in the tool's dialect, or in both when it is not given. A `$GIT push` or a
 * `$GIT reset --hard` counts: the guard cannot name the program, but git's words are there.
 */
export function runsGit(command: string, dialect?: Dialect): boolean {
  return programsOf(command, dialect).includes("git") || computedGitIn(command, dialect);
}
