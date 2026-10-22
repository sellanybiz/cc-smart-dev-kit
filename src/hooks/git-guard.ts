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
 * - `git reset --hard`; `git clean -f` (not a `-n` dry run); `git worktree remove -f`;
 * - a checkout that discards changes: `git checkout -- <path>`, `checkout .`,
 *   `checkout -f`, `git switch -f` / `--discard-changes`, `git restore <path>` without
 *   `--staged`;
 * - `git branch -D` (deletes a branch that may not be merged);
 * - `git stash clear`, and `git stash drop` with no stash named: they throw away work;
 * - when the project works in worktrees (`worktrees` in cc-smart-dev-kit.json): a bare `git stash`
 *   or `git stash pop`, because every worktree shares one stash.
 *
 * "ask", never "deny": the person may mean it, and a hook cannot tell. **One exception: a crew
 * session never pushes** (D24). A session the crew launcher started (`CC_SMART_DEV_KIT_CREW`
 * is set in its environment) commits on its own branch and the lead merges it locally, so any
 * `git push` from it is denied, whatever `autoPush` says. Claude Code's background sessions
 * push a worktree's branch on their own when the repository has a remote, which is the reason
 * for the rule (`docs/claude-code-contract.md`). Every command of a
 * line is read on its own, through the one shell reader (`src/shell/command.ts`), in the
 * dialect of the tool that runs it (Bash or PowerShell; both when it is not told): quoted
 * text, quoted here-doc bodies and comments are data; a substitution (`$( … )`, a backtick,
 * an unquoted here-doc body), the inner command of `bash -c`, `cmd /c`, `pwsh -c`, `eval`,
 * `iex` and `job run` (three levels deep), and the script of a shell that reads it from
 * standard input (`sh <<'EOF' … EOF`, `echo "git push -f" | sh`) are commands. git's own
 * options before the subcommand are read as git reads them (`--config-env x=y`), and one
 * this guard does not know (a newer git's) makes every word after it a possible subcommand.
 *
 * Known limits: a git alias (`-c alias.x=… x`, or one in the user's config), a `branch -f`,
 * a `checkout -B` and a `switch -C` (they move a branch), brace expansion (`{git,push}`), a
 * program named at run time (`$(…)`, a variable), `-EncodedCommand`, `ssh`, a script file,
 * a `cd` it cannot follow (`cd -`, `cd ~/x`, `cd $DIR`) and a branch it cannot read are not
 * asked about; `git checkout <name>` cannot tell a file from a branch, so it stays silent.
 */
import { isAbsolute, resolve } from "node:path";
import { crewIdOf } from "../crew/session";
import {
  CHANGE_DIR,
  type Dialect,
  invocationOf,
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
import { GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
import type { Env } from "./run";

/** The branches asked about when cc-smart-dev-kit.json names none. */
export const DEFAULT_PROTECTED_BRANCHES = ["main"];

/**
 * What the guard does about a push besides the questions about force and protected branches:
 * a crew session never pushes (D24), and `autoPush` off asks (D15).
 */
export interface PushRules {
  /** The session is a crew session: any `git push` is denied. */
  crew: boolean;
  /**
   * The question `autoPush` off puts to the person, or null when it is on. A function, so the
   * policy is read (git, a file) only for a line that really pushes.
   */
  autoPushAsk: () => string | null;
}

/** Pushes need no question of this kind: `autoPush` is on, and the session is nobody's crew. */
export const PUSH_FREE: PushRules = { crew: false, autoPushAsk: () => null };

/** The rules of the session whose environment is `env`: the crew variable decides `crew`. */
export function pushRulesFor(env: Env, autoPushAsk: () => string | null): PushRules {
  return { crew: crewIdOf(env) !== null, autoPushAsk };
}

/** Why a crew session's push is denied: the one reason, in the words the session reads. */
export const CREW_PUSH_REFUSAL =
  "A crew session never pushes: it commits on its own branch, and the lead merges that branch " +
  "locally (`git merge`). Only the lead's final push reaches the remote, and the person " +
  "approves that one. Stop at your commit and say so in your report.";

export interface GuardOptions {
  protectedBranches: string[];
  /** What a push may do here (`PushRules`). */
  pushRules: PushRules;
  /** Ask before a bare `git stash` / `stash pop`: the project works in worktrees. */
  sharedStash: boolean;
  env: Env;
  /** The dialect of the tool that runs the line (`dialectOfTool`); not given, both are read. */
  dialect?: Dialect | undefined;
}

/** One guard run: its options, and what it read from git once (a line may push many times). */
interface GuardRun {
  options: GuardOptions;
  /** What the guard denies (a crew session's push), each once; the questions are separate. */
  refusals: Set<string>;
  branches: Map<string, string | undefined>;
  pushConfigs: Map<string, Map<string, string[]>>;
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

/** A config key as git compares it: section and key lowercase, a subsection as it is. */
function configKey(raw: string): string {
  const parts = raw.split(".");
  if (parts.length < 2) return raw.toLowerCase();
  const first = (parts[0] ?? "").toLowerCase();
  const last = (parts[parts.length - 1] ?? "").toLowerCase();
  return [first, ...parts.slice(1, -1), last].join(".");
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

/** git's own options that take the next word as their value (git 2.53, `git --help`). */
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--attr-source",
  "--config-env",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
]);

/** git's own options that take no value. git takes no abbreviation of any of them. */
const GIT_FLAGS = new Set([
  "-P",
  "-p",
  "--bare",
  "--glob-pathspecs",
  "--icase-pathspecs",
  "--literal-pathspecs",
  "--no-advice",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-pager",
  "--no-replace-objects",
  "--noglob-pathspecs",
  "--paginate",
]);

/** git's own options after which git prints something and runs no subcommand. */
const GIT_PRINTS = new Set([
  "-h",
  "-v",
  "--exec-path",
  "--help",
  "--html-path",
  "--info-path",
  "--man-path",
  "--version",
]);

/** One way git may read its own options: where it runs, its subcommand, and its `-c` settings. */
export interface GitCall {
  /** The folders `-C` moves to, in order (each relative to the one before). */
  dirs: string[];
  sub: string;
  rest: string[];
  /** `-c key=value` on the line, key → value; a `--config-env` value (read from the environment) is null. */
  config: Map<string, string | null>;
}

/**
 * The subcommand git runs and its arguments, behind git's own options (`git -C dir
 * --config-env k=ENV push …`). One reading, or none when git only prints (`git --version`).
 * After an option this guard does not know (a newer git's, which may take values), every
 * later word may be the subcommand, so each is one reading: a guard asks if any of them
 * would. The one home of git's option list: the merge reader reads it too.
 */
export function gitCalls(args: readonly string[]): GitCall[] {
  const dirs: string[] = [];
  const config = new Map<string, string | null>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const name = arg.startsWith("--") ? (arg.split("=")[0] ?? arg) : arg;
    const attached = arg.startsWith("--") && arg.includes("=");
    if (arg === "-C") {
      const dir = args[++index];
      if (dir !== undefined) dirs.push(dir);
    } else if (arg === "-c" || name === "--config-env") {
      const setting = attached ? arg.slice(name.length + 1) : (args[++index] ?? "");
      const equals = setting.indexOf("=");
      const key = configKey(equals === -1 ? setting : setting.slice(0, equals));
      config.set(key, arg === "-c" ? (equals === -1 ? "true" : setting.slice(equals + 1)) : null);
    } else if (GIT_VALUE_OPTIONS.has(arg)) {
      index++;
    } else if (GIT_PRINTS.has(arg) || name === "--list-cmds") {
      return [];
    } else if ((attached && GIT_VALUE_OPTIONS.has(name)) || name === "--exec-path") {
      // `--git-dir=x`, `--exec-path=x`: one word.
    } else if (!GIT_FLAGS.has(arg) && arg.startsWith("-")) {
      const later = args.slice(index + 1);
      return later.flatMap((word, at) =>
        word.startsWith("-")
          ? []
          : [{ config, dirs: [...dirs], rest: later.slice(at + 1), sub: word }],
      );
    } else if (!arg.startsWith("-")) {
      return [{ config, dirs, rest: args.slice(index + 1), sub: arg }];
    }
  }
  return [];
}

function gitQuestions(args: string[], folder: Folder, run: GuardRun): string[] {
  return gitCalls(args).flatMap((call) => callQuestions(call, folder, run));
}

function callQuestions(call: GitCall, folder: Folder, run: GuardRun): string[] {
  const { options } = run;
  const { rest, sub } = call;
  if (sub === "push") {
    const where = folder === null ? null : resolve(folder, ...call.dirs);
    const place: PushPlace = {
      branch: () => (where === null ? undefined : currentBranch(where, run)),
      bare: (remote) => {
        const branch = where === null ? undefined : currentBranch(where, run);
        if (where === null || branch === undefined) return [];
        return bareRefspecs(remote, branch, pushConfig(where, run), call.config);
      },
    };
    // A crew session's push is denied, whatever else it is (D24), and nothing else is asked.
    if (options.pushRules.crew) {
      run.refusals.add(CREW_PUSH_REFUSAL);
      return [];
    }
    return pushQuestions(rest, place, options.protectedBranches, options.pushRules.autoPushAsk);
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
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    // A redirection (`>log`, `2>&1`) is the shell's: git never sees it as a refspec.
    const operands = withoutRedirections(args);
    if (program === "git") found.push(...gitQuestions(operands, folder, run));
    if (CHANGE_DIR.has(program)) folder = movedTo(program, folder, operands);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      for (const nested of readingsOf(inner, nestedDialect(program))) {
        found.push(...inspect(inner, folder, nested, run, depth + 1));
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
  return guardVerdict(command, cwd, options).ask;
}

/** What the guard says about a command line: what it denies, and what it asks the person. */
export interface GuardVerdict {
  /** Denied, each reason once: the session reads it and stops (a crew session's push). */
  refuse: string[];
  /** Asked, each question once; empty when `refuse` is not (a denied call asks nothing). */
  ask: string[];
}

/** `guardQuestions`, and what the guard denies besides: a crew session's push (D24). */
export function guardVerdict(command: string, cwd: string, options: GuardOptions): GuardVerdict {
  const run: GuardRun = {
    options,
    refusals: new Set(),
    branches: new Map(),
    pushConfigs: new Map(),
  };
  const found = readingsOf(command, options.dialect).flatMap((reading) =>
    inspect(command, cwd, reading, run),
  );
  const refuse = [...run.refusals];
  return { refuse, ask: refuse.length > 0 ? [] : [...new Set(found)] };
}

/**
 * True when the command line runs git at all (what the guard asks about when it cannot read
 * its config), in the tool's dialect, or in both when it is not given.
 */
export function runsGit(command: string, dialect?: Dialect): boolean {
  return programsOf(command, dialect).includes("git");
}
