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
 * "ask", never "deny": the person may mean it, and a hook cannot tell. **One exception is a
 * crew session** (a session the crew launcher started: `CC_SMART_DEV_KIT_CREW` is set in its
 * environment). Nobody is at the machine to answer its questions, so its pushes are denied
 * (D24: it commits on its own branch and the lead merges it locally, whatever `autoPush`
 * says), and so is every command that would otherwise ask before it destroys work — a
 * discarding `checkout`, `reset --hard`, `clean -f`, `branch -D`, an unnamed stash — each with
 * the step that does the same job without a question (`CREW_STEPS`). The refusals are the
 * guard's **crew part** (`crewGitAnswer`, `HookSpec.crewLimits`): the frame runs it before
 * `ownHooks` and before the project's file is read, so a project that lists its own
 * `git-guard` in `ownHooks`, and a project with no `cc-smart-dev-kit.json` at all, cannot lose
 * them. Claude Code's background sessions push a worktree's branch on their own when the
 * repository has a remote, which is the reason for the push rule
 * (`docs/claude-code-contract.md`). Every command of a
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
import { isAbsolute, resolve } from "node:path";
import { crewIdOf } from "../crew/session";
import {
  CHANGE_DIR,
  type Dialect,
  dialectOfTool,
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
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { Env } from "./run";

/** The branches asked about when cc-smart-dev-kit.json names none. */
export const DEFAULT_PROTECTED_BRANCHES = ["main"];

/**
 * What the guard does differently for the session that calls it: a crew session never pushes,
 * and never runs a command that destroys work without reading the step that replaces it (D24);
 * `autoPush` off asks before every push (D15).
 */
export interface PushRules {
  /** The session is a crew session: its pushes are denied, and so are its work-destroying asks. */
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

/**
 * What a crew session reads instead of a question about a command that destroys work: the
 * command is denied, and the step does the same job without a person's yes (D24). A crew
 * session runs unattended, and a hook's `ask` cannot be silenced by "don't ask again", so an
 * ask would stall it until the person answers (`.claude/rules/hooks-guards.md` § Fail safe). Each
 * step is mechanical, so the session can go on by itself.
 */
export const CREW_STEPS = {
  /** A `checkout`, `switch -f` or `restore` that overwrites uncommitted changes. */
  discard:
    "A crew session never discards uncommitted changes with `git checkout`, `git switch -f` or " +
    "`git restore`: nobody is at the machine to answer the guard's question, and the changes " +
    "are lost for good. Commit the work in progress first. To undo a deliberate break, copy " +
    "the file before you break it (`cp path path.bak`), copy it back after " +
    "(`cp path.bak path`), delete the copy (`rm path.bak`), then check it with " +
    "`git diff --quiet -- path`.",
  /** `git worktree remove --force`. */
  worktreeRemove:
    "A crew session never runs `git worktree remove --force`: it deletes a worktree even when " +
    "it holds uncommitted or untracked work, and nobody is at the machine to answer the " +
    "guard's question. Look in it first: commit or copy out what it holds, then run `git " +
    "worktree remove <path>` without `--force`, which refuses while anything is left.",
  /** `git branch -D`. */
  branchDelete:
    "A crew session never deletes a branch with `git branch -D`: it can drop commits that " +
    "were never merged, and nobody is at the machine to answer the guard's question. `git log " +
    "--oneline HEAD..<branch>` shows what would be lost: when it lists nothing, `git branch -d " +
    "<branch>` deletes it; when it lists commits, leave the branch and name it in your report.",
  /** `git reset --hard`. */
  resetHard:
    "A crew session never runs `git reset --hard`: it throws away every uncommitted change in " +
    "this folder, and nobody is at the machine to answer the guard's question. Commit the " +
    "work in progress first; `git reset --soft <commit>` moves the branch and keeps the " +
    "changes in the folder. To undo a deliberate break, copy the file back (`cp path.bak " +
    "path`), delete the copy (`rm path.bak`), and check it with `git diff --quiet -- path`.",
  /** `git reset --merge`. */
  resetMerge:
    "A crew session never runs `git reset --merge`: it throws away changes that are staged but " +
    "not committed — a staged change to a tracked file goes back to the target version, and a " +
    "staged new file is deleted for good — and nobody is at the machine to answer the guard's " +
    "question. `git reset --keep <commit>` moves the branch and never overwrites a working " +
    "file (it refuses instead), but it still resets the index, so a version staged and not " +
    "also in the working file is dropped: commit it first when it is needed. To undo a " +
    "deliberate break, copy the file back (`cp path.bak path`), delete the copy (`rm " +
    "path.bak`), and check it with `git diff --quiet -- path`.",
  /** `git clean -f`. */
  clean:
    "A crew session never runs `git clean -f`: it deletes untracked files for good, and nobody " +
    "is at the machine to answer the guard's question. Run `git clean -n` and read the list " +
    "first; commit anything worth keeping (`git add <path>`), then delete the rest with `rm`.",
  /** `git stash clear`. */
  stashClear:
    "A crew session never runs `git stash clear`: it throws away every stash for good, and " +
    "nobody is at the machine to answer the guard's question. `git stash list` shows them " +
    "all; drop only your own by name (`git stash drop stash@{n}`) and leave the rest.",
  /** `git stash drop` with no stash named. */
  stashDrop:
    "A crew session never runs `git stash drop` without a name: it drops the newest stash, " +
    "whoever made it, and nobody is at the machine to answer the guard's question. `git stash " +
    "list` shows them; `git stash drop stash@{n}` names the one you mean.",
  /** A bare `git stash` / `git stash pop`, which takes or restores a shared stash. */
  stashShared:
    "A crew session never runs a bare `git stash`, or `git stash pop`: the stash is shared by " +
    "every worktree of the repo, and nobody is at the machine to answer the guard's question. " +
    "Use the tagged form: `git stash push -u -m <tag>`, then `git stash apply <its sha>`.",
} as const;

/**
 * The guard's crew part (D24): a crew session's `git push`, in any form the guard's own
 * detector reads, is denied, and so is every command that would otherwise ask the person
 * before it destroys work — each with the step that replaces it (`CREW_STEPS`), so the session
 * goes on without waiting on someone who is not there. One detector — the same `guardVerdict`
 * the guard's `run` uses, with only the crew rule on — so a spelling that gets past one gets
 * past both.
 *
 * Not a crew session, or a line that raises nothing: silence, so an ordinary session pays
 * nothing and every other call goes on through the frame's usual steps.
 */
export function crewGitAnswer(input: HookInput, env: Env, cwd: string): HookResult {
  if (crewIdOf(env) === null) return SILENT;
  const command = stringField(toolInput(input).command);
  if (command === null) return SILENT;
  const verdict = guardVerdict(command, cwd, {
    // Only the crew rule is on: a push is denied before `protectedBranches` or `autoPushAsk`
    // is read, and a crew session's stash counts as shared whatever `sharedStash` says.
    protectedBranches: [],
    pushRules: { crew: true, autoPushAsk: () => null },
    sharedStash: false,
    env,
    dialect: dialectOfTool(input.tool_name),
  });
  return verdict.refuse.length === 0 ? SILENT : toolDecision("deny", verdict.refuse.join("\n"));
}

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
  /** What the guard denies (a crew session's push or work-destroying ask), each once. */
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

/**
 * One thing the guard asks about a command, and the deny a crew session reads instead: the
 * command itself, or the step that does its job without a person's yes (D24).
 */
interface AskStep {
  /** The question's words, exactly as a person's session reads them today. */
  ask: string;
  /** The crew session's refusal, naming the step that replaces the command. */
  crew: string;
}

/**
 * The guard's answer to one ask: the question, or — in a crew session, where nobody is at the
 * machine to answer it — the refusal that names the step (D24).
 */
function answer(ask: AskStep | null, run: GuardRun): string[] {
  if (ask === null) return [];
  if (run.options.pushRules.crew) {
    run.refusals.add(ask.crew);
    return [];
  }
  return [ask.ask];
}

/** A discarding `checkout` / `switch -f` / `restore`: the question names the command. */
function discardAsk(sub: string): AskStep {
  return {
    ask:
      `\`git ${sub}\` here overwrites files in this folder with another version, and any ` +
      "uncommitted change in them is lost for good. Approve only if you want them gone; a " +
      "WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask.",
    crew: CREW_STEPS.discard,
  };
}

const WORKTREE_REMOVE_ASK: AskStep = {
  ask:
    "`git worktree remove --force` deletes a worktree even when it holds uncommitted or " +
    "untracked work, and git cannot bring that back. Look in it first.",
  crew: CREW_STEPS.worktreeRemove,
};

const BRANCH_DELETE_ASK: AskStep = {
  ask:
    "`git branch -D` deletes a branch even if it was never merged: its commits are then " +
    "only in the reflog. `git branch -d` deletes a merged branch, and does not ask.",
  crew: CREW_STEPS.branchDelete,
};

const RESET_HARD_ASK: AskStep = {
  ask:
    "`git reset --hard` throws away every uncommitted change in this folder, for good. " +
    "Approve only if you want them gone; a WIP commit keeps the work first.",
  crew: CREW_STEPS.resetHard,
};

const RESET_MERGE_ASK: AskStep = {
  ask:
    "`git reset --merge` throws away changes that are staged but not committed: a staged " +
    "change to a tracked file goes back to the target version, and a staged new file is " +
    "deleted from the folder (measured). Your working files are kept: it refuses rather than " +
    "overwrite one whose working copy differs from the target, including a file with both " +
    "staged and unstaged changes (measured on git 2.53). Approve only if you want the " +
    "staged work gone; a WIP commit keeps it first.",
  crew: CREW_STEPS.resetMerge,
};

const CLEAN_FORCE_ASK: AskStep = {
  ask:
    "`git clean -f` deletes untracked files for good: git cannot bring them back. " +
    "`git clean -n` shows what it would delete, without deleting.",
  crew: CREW_STEPS.clean,
};

const STASH_CLEAR_ASK: AskStep = {
  ask:
    "`git stash clear` throws away every stash for good: git cannot bring them back. " +
    "`git stash list` shows what they hold, `git stash show -p` one of them.",
  crew: CREW_STEPS.stashClear,
};

const STASH_DROP_ASK: AskStep = {
  ask:
    "`git stash drop` with no stash named drops the newest one, whoever made it. " +
    "`git stash list` shows them; `git stash drop stash@{n}` drops the one you mean.",
  crew: CREW_STEPS.stashDrop,
};

const STASH_SHARED_ASK: AskStep = {
  ask:
    "The git stash is shared by every worktree of this repo, so a bare `git stash` or " +
    "`git stash pop` can take or restore another session's work. A WIP commit is safer; " +
    "or `git stash push -u -m <tag>`, then `git stash apply <its sha>`.",
  crew: CREW_STEPS.stashShared,
};

/**
 * The ask a `git stash` line raises, or null when it raises none. `sharedStash`: the stash is
 * shared by every worktree of the repo — the project works in worktrees, or the session is a
 * crew session, which always does.
 */
function stashAsk(args: string[], sharedStash: boolean): AskStep | null {
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

function gitQuestions(args: string[], folder: Folder, run: GuardRun): string[] {
  return gitCalls(args).flatMap((call) => callQuestions(call, folder, run));
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

function callQuestions(call: GitCall, folder: Folder, run: GuardRun): string[] {
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
    // A crew session's push is denied, whatever else it is (D24), and nothing else is asked.
    if (options.pushRules.crew) {
      run.refusals.add(CREW_PUSH_REFUSAL);
      return [];
    }
    return pushQuestions(
      alias === null ? rest : [...alias, ...rest],
      place,
      options.protectedBranches,
      options.pushRules.autoPushAsk,
    );
  }
  // A crew session always works in a worktree, so its stash is shared even when the project
  // does not set `worktrees`: the bare form is denied there like every other ask.
  if (sub === "stash") {
    return answer(stashAsk(rest, options.sharedStash || options.pushRules.crew), run);
  }
  if (sub === "worktree" && rest[0] === "remove") {
    const force = rest
      .slice(1)
      .some(
        (arg) =>
          longOption(arg, "--force", 6) ||
          (isShort(arg) && shortFlags(arg, "").flags.includes("f")),
      );
    if (force) return answer(WORKTREE_REMOVE_ASK, run);
  }
  if ((sub === "checkout" || sub === "restore" || sub === "switch") && discardsChanges(sub, rest)) {
    return answer(discardAsk(sub), run);
  }
  if (sub === "branch" && forceDeletesBranch(rest)) return answer(BRANCH_DELETE_ASK, run);
  if (sub === "reset" && rest.some((arg) => longOption(arg, "--hard", 4))) {
    return answer(RESET_HARD_ASK, run);
  }
  // `--merge` loses staged work too (the measurement is in the file's header); `--keep` loses
  // nothing and stays silent.
  if (sub === "reset" && rest.some((arg) => longOption(arg, "--merge", 4))) {
    return answer(RESET_MERGE_ASK, run);
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
    if (force && !dryRun) return answer(CLEAN_FORCE_ASK, run);
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
    const words = wordsOf(step.text, dialect);
    const invocation = invocationOf(words);
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    // A redirection (`>log`, `2>&1`) is the shell's: git never sees it as a refspec.
    const operands = withoutRedirections(args);
    if (program === "git") found.push(...gitQuestions(operands, folder, run));
    // The program is worked out when the line runs (`$GIT push`, `$(which git) push`): the
    // guard cannot name it, so a line whose words name a push asks, never stays silent. A
    // crew session never pushes (D24), so there the same words are the refusal itself (F5-1):
    // the crew part and the guard's own run both read this one detector, so a spelling that
    // gets past one gets past both.
    if (invocation.computed && namesPush(words)) {
      if (run.options.pushRules.crew) run.refusals.add(CREW_PUSH_REFUSAL);
      else found.push(COMPUTED_PUSH_ASK);
    }
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
  /**
   * Denied, each reason once: the session reads it and does the step (a crew session's push,
   * or a work-destroying command whose step the refusal names).
   */
  refuse: string[];
  /** Asked, each question once; empty when `refuse` is not (a denied call asks nothing). */
  ask: string[];
}

/**
 * `guardQuestions`, and what the guard denies besides: a crew session's push, and every ask
 * that would destroy work — each with the step that replaces it (D24).
 */
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
 * its config), in the tool's dialect, or in both when it is not given. A `$GIT push` counts:
 * the guard cannot name the program, but a push's words are there.
 */
export function runsGit(command: string, dialect?: Dialect): boolean {
  return programsOf(command, dialect).includes("git") || computedPushIn(command, dialect);
}
