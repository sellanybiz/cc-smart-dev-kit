/**
 * PostToolUse and PostToolUseFailure (Bash, PowerShell): right after a session merges a pull
 * request (`gh pr merge`, `gh pr -R owner/repo merge 5`, a `gh api` merge, a `gh` alias that
 * expands to one — `pullRequestMerges` below), for a project that works in worktrees
 * (`worktrees` in cc-smart-dev-kit.json). The moment a merge lands is the moment two things
 * are due, and both were forgotten when they lived only in written rules:
 *
 * - **The worktree that was merged is finished.** When the session works in a worktree whose
 *   branch the pull request was, the note gives the steps that clear it.
 * - **The other sessions now work on an old base.** When the pull request went into
 *   `worktrees.base`, in this repo's own remote, in the last 15 minutes, and was not announced
 *   before, the note gives the exact message to send **the other leads of this repo and the
 *   person's own sessions** — never a crew session, which follows its own lead's branch and
 *   must not take the base in (D55). The message also names the prefixes of `worktrees.bases`
 *   whose own base is another one
 *   (`otherBaseCaution`): a session on such a branch must not merge the integration base in,
 *   because that would ship unreleased work. Each other lead's own watch also hears the merge
 *   from the store, as one `merge` event, so the line arrives without waiting for a message.
 *
 * It looks the pull request up once with `gh pr view` (10 s at most). **The hook has 30 s,
 * and its children (the alias list, `git worktree list`, `gh pr view`, `git remote get-url`)
 * share one budget** (`budget.ts`, 25 s): each call gets the smaller of its own limit and the
 * time left, and a note is skipped when too little is left, so the hook never runs into
 * Claude Code's kill (HK hunch 9; the limits alone added up to 43 s). A `gh pr merge` that
 * only arms a merge (`--auto`) or disarms one is no merge, and neither are the words
 * `gh pr merge` in a quote, a quoted here-doc or a comment (`src/shell/command.ts`, in the
 * dialect of the tool that ran the line). When the shell
 * command failed (PostToolUseFailure), only gh's word that the pull request IS merged
 * counts. Each pull request is announced once: a small file per number in the temp folder.
 * Anything it cannot work out is skipped: a note is not worth a failed tool call.
 *
 * It reads the alias list (`gh alias list`, a local file read) only for a command with a
 * `gh <word>` that is no gh command, and only the first merge of the line is looked up: a
 * note names one pull request.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { appendCrewEvent, type LeadRecord, listLeads } from "../crew/store";
import {
  CHANGE_DIR,
  type Dialect,
  dialectOfTool,
  invocationOf,
  isShort,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  programName,
  readingsOf,
  redirectionTargets,
  shellSteps,
  shortFlags,
  withoutRedirections,
  wordsOf,
} from "../shell/command";
import { startAutoClean } from "../worktrees/auto-start";
import { startBudget } from "./budget";
import { GUARD_GIT_TIMEOUT_MS, innermostWorktree, listWorktrees, runGit } from "./git";
import { gitCalls } from "./git-guard";
import { addContext, type HookResult, SILENT, stringField, toolInput } from "./io";
import type { Env, HookContext } from "./run";
import { isSessionId } from "./session-name";

/**
 * The gh commands this plugin knows (gh 2.102.0: `gh --help` and `gh help reference` read
 * 2026-10-16). A word after `gh` that is not one of these is a name of the person's — an
 * alias, or an extension — and is never guessed: `mergeCalls` reads `gh alias list` for it,
 * and a word that neither is an alias nor expands to a merge is left alone.
 */
const GH_COMMANDS: ReadonlySet<string> = new Set([
  "accessibility",
  "actions",
  "agent-task",
  "alias",
  "api",
  "attestation",
  "auth",
  "browse",
  "cache",
  "co",
  "codespace",
  "completion",
  "config",
  "copilot",
  "discussion",
  "environment",
  "exit-codes",
  "extension",
  "formatting",
  "gist",
  "gpg-key",
  "help",
  "issue",
  "label",
  "licenses",
  "mintty",
  "org",
  "pr",
  "preview",
  "project",
  "reference",
  "release",
  "repo",
  "ruleset",
  "run",
  "search",
  "secret",
  "skill",
  "ssh-key",
  "status",
  "telemetry",
  "variable",
  "workflow",
]);

/**
 * One command of a line that asks GitHub to merge a pull request. This is the one reader of
 * a merge command line: `mergesPullRequest` (what the after-merge note asks), `requestsMerge`
 * and `mergeCalls` (what the merge guard asks) all read what it returns.
 */
export interface MergeCall {
  /**
   * The pull request it names — `ref` null when it names none (the current branch's) — or
   * null when this form names none a caller could look up (`gh api graphql`, a shell alias).
   */
  target: { ref: string | null; repo: string | null } | null;
  /** The reason the guard asks about this call whatever the policy says, or null. */
  refusal: string | null;
  /** What gh could not read, in `notChecked`'s words, or null. */
  unread: string | null;
  /** A `--auto` on the merge's own words: an armed merge, judged like a merge. */
  arms: boolean;
  /** A `--disable-auto`: it takes an armed merge back, so this command merges nothing. */
  disarms: boolean;
  /**
   * An `--admin` (any value) on the merge's own words: gh merges with administrator rights,
   * past the repository's branch protection, so the merge guard always asks.
   */
  admin: boolean;
  /** The word after `gh` that names no gh command: an alias to look up, or an extension. */
  unknown: string | null;
  /**
   * A flag on the merge's own words that this guard does not know (`--frobnicate`), or null.
   * Only gh 2.102.0's own flags are read (`MERGE_FLAGS`); a newer one may change what merges,
   * so the call asks, and it is never the exact known-flag form D31 may allow.
   */
  unknownFlag: string | null;
  /**
   * Not a merge but a pull request opened (`gh pr create`) or made ready (`gh pr ready`): what
   * the project's `openPr` setting governs (D16). Absent on a merge. `pullRequestMerges` and
   * `mergeCalls` never return such a call; `pullRequestOpenings` and `openingCalls` return
   * only these.
   */
  opens?: "create" | "ready";
  /** A `gh pr create --draft`, or a `draft` field the API call sets: it opens as a draft. */
  draft?: boolean;
  /**
   * `gh pr create`'s `--base` / `-B`: the branch the pull request opens into, or null when it
   * names none (gh opens into the repository's default branch). Read only for a `gh pr
   * create` (`cli`), never for a `gh api` opening, which names its base in its own fields.
   */
  base?: string | null;
  /** `gh pr create`'s `--head` / `-H`: the branch the pull request comes from, or null. */
  head?: string | null;
  /** A `gh pr create` / `gh pr new` whose own flags were read (`base`, `head`), not an API call. */
  cli?: true;
}

/**
 * The words in a reason that name what the call does, by kind of call. A reason is written
 * once, with these places marked, and filled in where the call is known: `the merge` or `the
 * command`, `merges in` or `works in`, `merges from` or `acts on`.
 */
const WORDS: Readonly<Record<string, readonly [merge: string, opens: string]>> = {
  the: ["the merge", "the command"],
  acts: ["merges in", "works in"],
  from: ["merges from", "acts on"],
};

/** `reason` with its marked words (`{the}`, `{acts}`, `{from}`) filled in for a merge or an opening. */
function say(reason: string, opens: boolean): string {
  return reason.replace(/\{(the|acts|from)\}/g, (_, key: string) => {
    const words = WORDS[key];
    return (opens ? words?.[1] : words?.[0]) ?? key;
  });
}

/** A merge call with every field the caller did not set at its "no" value. */
function call(fields: Partial<MergeCall> = {}): MergeCall {
  return {
    target: null,
    refusal: null,
    unread: null,
    arms: false,
    disarms: false,
    admin: false,
    unknown: null,
    unknownFlag: null,
    ...fields,
  };
}

/** The word `env` as a program (`env`, `/usr/bin/env`, `env.exe`). */
const ENV_PROGRAM = /^(?:.*[\\/])?env(?:\.(?:exe|cmd))?$/i;

/** `GH_REPO` / `GH_HOST` named anywhere in a step (`export GH_REPO=…`, `$env:GH_REPO='…'`). */
const GH_POINTING_TEXT = /GH_(?:REPO|HOST)/;

/** `GH_REPO=` / `GH_HOST=`: the assignment form, in the merge's own words. */
const GH_POINTING = /^GH_(?:REPO|HOST)=/;

/** `--auto` arms a merge for later. */
const isAutoFlag = (word: string) => /^--auto(?:=|$)/.test(word);
/** `--disable-auto` takes an armed merge back. */
const isDisableAutoFlag = (word: string) => /^--disable-auto(?:=|$)/.test(word);

/**
 * Every merge a command line asks GitHub for, in the order it runs them: `gh pr merge`
 * (with gh pr's own flags read first), `gh api`, and a `gh` alias when the caller passes the
 * alias list. A command of the line itself, or the inner command of a `bash -c '…'`, `eval`,
 * … (three levels deep), like every guard reads it.
 *
 * `aliases`: `gh alias list` read as name → expansion, or null when the caller has not read
 * it — then a `gh <word>` that is no gh command comes back with `unknown` set, for the
 * caller to look up. `dialect`: the tool's (`dialectOfTool`); not given, both are read.
 *
 * The line is read every way it may run (`readingsOf`), like the git guard reads it: a line
 * that ends in `\` is read joined to the next and not, because in PowerShell, or at the end
 * of a Windows path, it does not join them. A merge either reading finds is in the list, once.
 */
export function pullRequestMerges(
  command: string,
  aliases: ReadonlyMap<string, string> | null = null,
  dialect?: Dialect,
): MergeCall[] {
  return pullRequestCalls(command, aliases, dialect).filter(isMerge);
}

/**
 * Every pull request a command line opens or makes ready, in the order it runs them (`gh pr
 * create`, `gh pr new`, `gh pr ready`, a `gh api` call to the pulls endpoint, the GraphQL
 * `createPullRequest` / `markPullRequestReadyForReview`): what `openPr` governs (D16). Read
 * exactly as `pullRequestMerges` reads a merge, by the same reader.
 */
export function pullRequestOpenings(
  command: string,
  aliases: ReadonlyMap<string, string> | null = null,
  dialect?: Dialect,
): MergeCall[] {
  return pullRequestCalls(command, aliases, dialect).filter((one) => !isMerge(one));
}

/** A call that is not an opening: a merge, or a word that may expand to one. */
export function isMerge(one: MergeCall): boolean {
  return one.opens === undefined;
}

/** Every call the reader finds, merges and openings together, each once. */
function pullRequestCalls(
  command: string,
  aliases: ReadonlyMap<string, string> | null,
  dialect: Dialect | undefined,
): MergeCall[] {
  const seen = new Set<string>();
  const calls: MergeCall[] = [];
  for (const reading of readingsOf(command, dialect)) {
    for (const one of readMerges(command, reading.dialect, reading.joinLines, aliases, 0, null)) {
      const key = JSON.stringify(one);
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push(one);
    }
  }
  return calls;
}

/**
 * The merges of one reading of a line. `movedBefore` is for the recursive read of a nested
 * command: a `cd` before the shell that runs it moves that one too.
 */
function readMerges(
  command: string,
  dialect: Dialect,
  joinLines: boolean,
  aliases: ReadonlyMap<string, string> | null,
  depth: number,
  movedBefore: string | null,
): MergeCall[] {
  const calls: MergeCall[] = [];
  let moved = movedBefore;
  for (const step of shellSteps(command, { dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    // Any mention of `GH_REPO` / `GH_HOST` in a step points the gh calls after it somewhere
    // else — in every spelling (`export GH_REPO=…`, `$env:GH_REPO='…'`, `set GH_REPO=…`),
    // including a step that is nothing but the assignment.
    if (words.some((word) => GH_POINTING_TEXT.test(word))) {
      moved ??=
        "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain";
    }
    const invocation = invocationOf(words);
    // A runner whose own words the line cut in two — in PowerShell, where every brace ends a
    // command, `xargs -I{} gh pr merge {}` is two pieces — has no invocation of its own
    // (`xargs -I` wants a command that is not there); what follows it is still run by it.
    const runnerWord = RUNNERS[programName(words[0] ?? "")];
    if (invocation === undefined) {
      if (runnerWord !== undefined) moved ??= runnerWord.moved;
      continue;
    }
    const { program } = invocation;
    // A redirection (`>log`, `2>&1`) is the shell's: gh never sees it as an argument.
    const args = withoutRedirections(invocation.args);
    // A later merge acts on whatever the steps before it left: a folder a `cd` / `git -C`
    // moved to, a branch a `git switch` / `checkout` changed (each set AFTER this step's own
    // calls are read, so a step never moves itself).
    if (program === "git") moved ??= gitMoved(args);
    else if (CHANGE_DIR.has(program)) {
      moved ??= `an earlier \`${program}\` in the same command changes the folder it runs in`;
    }
    const runner = runnerOf(program, invocation.prefix);
    if (runner === null && runnerWord !== undefined) moved ??= runnerWord.moved;
    const prefix = prefixMoved(invocation.prefix);
    if (program === "gh" && runner === null) {
      calls.push(...dispatch(args, moved ?? prefix, aliases, depth));
      moved ??= ghSwitchReason(args, aliases, depth);
    } else if (runner !== null) {
      // The merge is run by a program the line does not show in full: `xargs` / `parallel`
      // feed its arguments, `find -exec` runs it per match, `watch` over and over, and
      // `sudo` / `doas` / `su` run it with another user's gh config. Never judged.
      calls.push(...runnerCalls(words, runner, aliases, depth, dialect));
    }
    const nested = nestedCommand(program, invocation.args, step.pipedFrom);
    if (nested !== undefined && depth < MAX_NESTING) {
      calls.push(...lineMerges(nested, nestedDialect(program), aliases, depth + 1, moved));
    }
    // `su -c '<script>'` reads its command from a word: the script is a line of its own.
    const script = suScript(program, args);
    if (script !== undefined && depth < MAX_NESTING) {
      const merges = lineMerges(script, "bash", aliases, depth + 1, moved);
      calls.push(...refuseRunner(merges, runner ?? SU_RUNNER));
    }
  }
  return calls;
}

/** The merges of a line a command runs (`bash -c '…'`, a runner's word), read every way it may run. */
function lineMerges(
  line: string,
  dialect: Dialect,
  aliases: ReadonlyMap<string, string> | null,
  depth: number,
  moved: string | null,
): MergeCall[] {
  return readingsOf(line, dialect).flatMap((reading) =>
    readMerges(line, reading.dialect, reading.joinLines, aliases, depth, moved),
  );
}

/** The `-c` of a `su` call (`su -c 'gh pr merge 7'`), or undefined. */
function suScript(program: string, args: string[]): string | undefined {
  if (program !== "su") return undefined;
  const at = args.findIndex((arg) => arg === "-c" || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
  return at === -1 ? undefined : args[at + 1];
}

/**
 * Programs that run a merge with arguments, repeats or an environment the line does not
 * show. `feeds`: the arguments come from outside the line (a pipe, a file list), so the pull
 * request the words name is not the one that merges.
 */
const RUNNERS: Record<string, { feeds: boolean; moved: string; via: string }> = {
  doas: {
    feeds: false,
    moved: "an earlier `doas` in the same command may run {the} as another user",
    via: "under `doas`, with another user's login and gh config",
  },
  find: {
    feeds: false,
    moved: "an earlier `find` in the same command may run {the} once for each match",
    via: "from `find -exec`, once for each match",
  },
  parallel: {
    feeds: true,
    moved:
      "an earlier `parallel` in the same command may feed {the} its arguments from outside the line",
    via: "from `parallel`, whose arguments come from outside the line",
  },
  su: {
    feeds: true,
    moved:
      "an earlier `su` in the same command may run {the} in another shell, with its own environment",
    via: "from `su`, whose command and environment come from outside the line",
  },
  sudo: {
    feeds: false,
    moved: "an earlier `sudo` in the same command may run {the} under another user",
    via: "under `sudo`, with another user's login and gh config",
  },
  watch: {
    feeds: false,
    moved: "an earlier `watch` in the same command may run {the} over and over",
    via: "from `watch`, over and over",
  },
  xargs: {
    feeds: true,
    moved:
      "an earlier `xargs` in the same command may feed {the} its arguments from outside the line",
    via: "from `xargs`, whose arguments come from outside the line",
  },
};

/** The runner `su -c '<script>'` is read through: the script's own line follows it. */
const SU_RUNNER: Runner = {
  feeds: true,
  name: "su",
  via: "from `su`, whose command and environment come from outside the line",
};

/** One runner and how it runs what follows it. */
interface Runner {
  /** The arguments come from outside the line (a pipe, a file list). */
  feeds: boolean;
  name: string;
  /** How it runs the call, after `the merge runs` / `the command runs`. */
  via: string;
}

/** The runner a step's words name (`sudo`, `xargs`, …), or null when it runs the merge itself. */
function runnerOf(program: string, before: string[]): Runner | null {
  for (const word of [program, ...before]) {
    const name = programName(word);
    const spec = RUNNERS[name];
    if (spec !== undefined) return { feeds: spec.feeds, name, via: spec.via };
  }
  return null;
}

/** The merges a runner's own words name (`find . -exec gh pr merge 17 \;`), or none. */
function runnerCalls(
  words: string[],
  runner: Runner,
  aliases: ReadonlyMap<string, string> | null,
  depth: number,
  dialect: Dialect,
): MergeCall[] {
  const at = words.findIndex((word) => programName(word) === "gh");
  if (at !== -1) {
    const ghWords = withoutRedirections(words.slice(at + 1));
    return refuseRunner(dispatch(ghWords, null, aliases, depth), runner);
  }
  // Or the whole merge is one word the runner runs: `parallel 'gh pr merge {}' ::: 5 6`, where
  // the quotes kept it whole. Reading it as a line of its own is the only way to see it.
  const held = words.find(
    (word) => /\bgh\b/i.test(word) && /\b(merge|create|new|ready)\b/i.test(word),
  );
  if (held === undefined) return [];
  return refuseRunner(lineMerges(held, dialect, aliases, depth + 1, null), runner);
}

/**
 * Turns the merges a runner would run into refusals: the guard never judges them, because
 * what their arguments are, how often they run and whose gh config they use is not on the
 * line. A runner that feeds the arguments names no pull request at all.
 */
function refuseRunner(calls: MergeCall[], runner: Runner): MergeCall[] {
  return calls
    .filter((one) => !one.disarms)
    .map((one) =>
      call({
        ...(one.opens === undefined ? {} : { opens: one.opens }),
        target: runner.feeds ? null : one.target,
        refusal: say(`{the} runs ${runner.via}`, one.opens !== undefined),
      }),
    );
}

/** Why a `git` command in the line moves the checkout or the branch a later merge acts on. */
function gitMoved(args: string[]): string | null {
  // git's own options (`git -C dir -c k=v switch x`) come before its subcommand, read as the
  // git guard reads them (`gitCalls`): after one it does not know, every later word may be it.
  const calls = gitCalls(args);
  if (calls.some((one) => one.dirs.length > 0)) {
    return "an earlier `git -C` in the same command runs in another folder";
  }
  const switched = calls.find((one) => one.sub === "switch" || one.sub === "checkout");
  if (switched !== undefined) {
    return `an earlier \`git ${switched.sub}\` in the same command may change the branch it {from}`;
  }
  return null;
}

/**
 * Why the words before the program (`invocationOf`'s `prefix`: what it stepped over) make
 * this merge's own repository or environment uncertain, or null.
 */
function prefixMoved(before: readonly string[]): string | null {
  if (before.some((word) => GH_POINTING.test(word))) {
    return "{the} sets `GH_REPO`/`GH_HOST` itself, so which repository it {acts} is not certain";
  }
  if (before.some((word) => ENV_PROGRAM.test(word))) {
    return "{the} runs through `env`, so which environment gh sees is not certain";
  }
  return null;
}

/** `gh`'s own flags, read before its command word. */
interface Leading {
  /** The words from the command word on. */
  rest: string[];
  /** The `-R` / `--repo` it named, or null. */
  repo: string | null;
  /** A flag this guard does not know (`gh --admin=true pr merge`), or null. */
  unknown: string | null;
  /** A help flag: gh prints help and runs nothing. */
  help: boolean;
}

/**
 * The flags gh itself takes before its command (`gh -R owner/repo pr merge 5`, `gh
 * --repo=owner/repo pr list`): both are live forms of gh 2.102.0 (cobra strips unknown flags
 * to find the subcommand, which then parses them). The ones this guard knows are `-R`/`--repo`
 * (a value: `-R x`, `-Rx`, `--repo x`, `--repo=x`) and the help flags; any other flag is
 * handed back as `unknown`, because what it takes decides where the command word is.
 */
function leadingFlags(words: string[]): Leading {
  let repo: string | null = null;
  let index = 0;
  for (; index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === "--") return { rest: words.slice(index + 1), repo, unknown: null, help: false };
    if (!word.startsWith("-")) break;
    if (word === "-h" || word === "--help") {
      return { rest: [], repo, unknown: null, help: true };
    }
    if (word === "-R" || word === "--repo") repo = words[++index] ?? null;
    else if (word.startsWith("--repo=")) repo = word.slice("--repo=".length) || null;
    else if (isShort(word) && word.startsWith("-R")) repo = word.slice(2) || null;
    else return { rest: words.slice(index + 1), repo, unknown: word, help: false };
  }
  return { rest: words.slice(index), repo, unknown: null, help: false };
}

/** `gh pr` subcommands the guard reads: a merge, and the two that open a pull request (D16). */
const PR_OPENERS: ReadonlySet<string> = new Set(["create", "new", "ready"]);

/**
 * Could these words be a merge, or open a pull request, without reading them? (an alias may
 * run one, `api` decides.)
 */
function couldBeMerge(rest: string[]): boolean {
  const command = rest[0]?.toLowerCase();
  if (command === undefined) return false;
  if (command === "api") return true;
  if (command === "pr") {
    return rest
      .slice(1)
      .some((word) => word.toLowerCase() === "merge" || PR_OPENERS.has(word.toLowerCase()));
  }
  return !GH_COMMANDS.has(command);
}

/** Do these words name a `gh pr` command that opens or readies a pull request, and none that merges? */
function onlyOpens(rest: string[]): boolean {
  if (rest[0]?.toLowerCase() !== "pr") return false;
  const words = rest.slice(1).map((word) => word.toLowerCase());
  return words.some((word) => PR_OPENERS.has(word)) && !words.includes("merge");
}

/**
 * The merges one `gh` invocation asks for. `moved`: why the folder, branch or repository it
 * acts on is already uncertain, or null; `repo`: the `-R` gh itself carried before the
 * command, when one was.
 */
function dispatch(
  words: string[],
  moved: string | null,
  aliases: ReadonlyMap<string, string> | null,
  depth: number,
  repo: string | null = null,
): MergeCall[] {
  const leading = leadingFlags(words);
  const carried = repo ?? leading.repo;
  if (leading.unknown !== null) {
    // Whether the words after an unknown flag are a merge is not readable (`--admin=true pr
    // merge 20`), so it asks when they could be one, and stays quiet when they could not.
    return couldBeMerge(leading.rest)
      ? [
          call({
            // Words that name a `gh pr create` / `ready` and no merge are an opening's: its
            // question is `openPr`'s, not a merge's.
            ...(onlyOpens(leading.rest) ? { opens: "create" as const } : {}),
            refusal: `the command carries \`${leading.unknown}\` before the gh command, which this guard does not know`,
          }),
        ]
      : [];
  }
  const word = leading.rest[0];
  // `gh --version`, `gh --help`, a bare `gh -R x`: no command word, so nothing runs.
  if (word === undefined) return [];
  const command = word.toLowerCase();
  if (command === "pr") return prCalls(leading.rest.slice(1), moved, carried);
  if (command === "api") return apiCalls(leading.rest.slice(1));
  if (GH_COMMANDS.has(command)) return [];
  // A word after `gh` that names no gh command: one of the person's aliases, or an extension.
  const rest = leading.rest.slice(1);
  if (aliases === null) return [call({ unknown: command })];
  const expansion = aliases.get(command);
  if (expansion === undefined) {
    return leading.rest.some((word) => /merge/i.test(word))
      ? [
          call({
            refusal: `\`gh ${command}\` is no gh command or alias, and its words name a merge, which this guard does not judge`,
          }),
        ]
      : [];
  }
  if (expansion.startsWith("!")) {
    return [
      call({ refusal: `\`gh ${command}\` is a shell alias, so what it runs cannot be read` }),
    ];
  }
  if (depth >= MAX_NESTING) {
    return [
      call({
        refusal: `\`gh ${command}\` expands to further commands, which this guard does not follow`,
      }),
    ];
  }
  return dispatch([...wordsOf(expansion), ...rest], moved, aliases, depth + 1, carried);
}

/**
 * Why a `gh` call in the line moves the branch or the repository a LATER merge acts on, or
 * null: `gh pr checkout` / `gh co` switch branch, `gh repo set-default` changes the
 * repository gh defaults to, and an alias is read for what it expands to.
 */
function ghSwitchReason(
  words: string[],
  aliases: ReadonlyMap<string, string> | null,
  depth: number,
): string | null {
  if (depth > MAX_NESTING) return null;
  const leading = leadingFlags(words);
  if (leading.unknown !== null) return null;
  const command = leading.rest[0]?.toLowerCase();
  const args = leading.rest.slice(1);
  if (command === "co") {
    return "an earlier `gh co` in the same command changes the branch gh works on";
  }
  if (command === "pr" && args[0] === "checkout") {
    return "an earlier `gh pr checkout` in the same command changes the branch gh works on";
  }
  if (command === "repo" && args[0] === "set-default") {
    return "an earlier `gh repo set-default` in the same command changes the repository gh works on";
  }
  if (command === undefined || GH_COMMANDS.has(command)) return null;
  const expansion = aliases?.get(command);
  if (expansion === undefined || expansion.startsWith("!")) return null;
  return ghSwitchReason([...wordsOf(expansion), ...args], aliases, depth + 1);
}

/**
 * `gh pr`'s own flags, before its subcommand (`gh pr -R owner/repo merge 5`). A flag this
 * guard does not know — a newer gh's — is a refusal, never a guess at what it takes; the
 * ones gh 2.102.0 has are `-R`/`--repo` (a value) and the help flags.
 */
function prCalls(rest: string[], moved: string | null, carried: string | null): MergeCall[] {
  let repo: string | null = null;
  let index = 0;
  for (; index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      index += 1;
      break;
    }
    if (!word.startsWith("-")) break;
    if (word === "-h" || word === "--help") return [];
    if (word === "-R" || word === "--repo") repo = rest[++index] ?? null;
    else if (word.startsWith("--repo=")) repo = word.slice("--repo=".length) || null;
    else if (isShort(word) && word.startsWith("-R")) repo = word.slice(2) || null;
    else {
      return [
        call({
          refusal: `\`gh pr\` takes a flag this guard does not know (\`${word}\`), so it cannot tell whether this merges or opens a pull request`,
        }),
      ];
    }
  }
  const sub = rest[index];
  const args = rest.slice(index + 1);
  if (sub !== undefined && PR_OPENERS.has(sub)) {
    if (args.some((arg) => arg === "-h" || arg === "--help")) return [];
    return openingCall(sub === "ready" ? "ready" : "create", args, moved, repo ?? carried);
  }
  if (sub !== "merge") return [];
  if (args.some((arg) => arg === "-h" || arg === "--help")) return [];
  const named = mergeArguments(args);
  const refusal =
    moved !== null
      ? say(moved, false)
      : named.unknown === null
        ? null
        : `the merge carries \`${named.unknown}\`, a flag this guard does not know, so it cannot tell what it does`;
  return [
    call({
      target: { ref: named.ref, repo: repo ?? named.repo ?? carried },
      refusal,
      arms: args.some(isAutoFlag),
      disarms: args.some(isDisableAutoFlag),
      admin: named.admin,
      unknownFlag: named.unknown,
    }),
  ];
}

/** `gh pr create` flags that take a value (gh 2.102.0, `gh pr create --help`). */
const CREATE_FLAGS_WITH_VALUE = new Set([
  "--assignee",
  "--attach",
  "--base",
  "--body",
  "--body-file",
  "--head",
  "--label",
  "--milestone",
  "--project",
  "--recover",
  "--repo",
  "--reviewer",
  "--template",
  "--title",
]);

/** Those flags' short letters (`-R` is gh's own), which may carry their value attached. */
const CREATE_SHORT_WITH_VALUE = "aBbFHlmprRTt";

/**
 * The call for a `gh pr create` / `gh pr ready` (D16). `create` reads its own flags the way
 * gh does: a flag's value is never read as a flag (`--title --draft` is a title), nothing after
 * `--` is a flag, and `--draft=false` is no draft. `ready --undo` makes a draft of a pull
 * request, so it opens nothing.
 */
function openingCall(
  kind: "create" | "ready",
  args: string[],
  moved: string | null,
  carried: string | null,
): MergeCall[] {
  let repo: string | null = carried;
  let base: string | null = null;
  let head: string | null = null;
  let draft = false;
  let undo = false;
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "--") break;
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      const value = at === -1 ? undefined : word.slice(at + 1);
      if (name === "--repo") repo = value ?? args[index + 1] ?? repo;
      if (name === "--base") base = value ?? args[index + 1] ?? null;
      if (name === "--head") head = value ?? args[index + 1] ?? null;
      if (name === "--draft") draft = value === undefined || value.toLowerCase() !== "false";
      if (name === "--undo") undo = true;
      if (value === undefined && CREATE_FLAGS_WITH_VALUE.has(name)) index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, CREATE_SHORT_WITH_VALUE);
      // A group of letters: `-fd` is `--fill --draft`; the last letter may take the value.
      const last = flags.slice(-1);
      const own =
        last !== "" && CREATE_SHORT_WITH_VALUE.includes(last) ? flags.slice(0, -1) : flags;
      if (own.includes("d")) draft = true;
      if (last !== "" && CREATE_SHORT_WITH_VALUE.includes(last)) {
        const given = wantsNext ? (args[index + 1] ?? null) : word.slice(flags.length + 1);
        if (last === "R") repo = given === "" ? repo : given;
        if (last === "B") base = given === "" ? null : given;
        if (last === "H") head = given === "" ? null : given;
        if (wantsNext) index += 1;
      }
    }
  }
  if (kind === "ready" && undo) return [];
  return [
    call({
      base: base === "" ? null : base,
      cli: true,
      draft: kind === "create" && draft,
      head: head === "" ? null : head,
      opens: kind,
      refusal: moved === null ? null : say(moved, true),
      target: { ref: null, repo },
    }),
  ];
}

/** `gh pr merge` flags that take a value, so the value is not taken for the pull request. */
const MERGE_FLAGS_WITH_VALUE = new Set([
  "--author-email",
  "--body",
  "--body-file",
  "--match-head-commit",
  "--repo",
  "--subject",
]);

/** Those flags' short letters, which may carry their value attached (`-Rorg/app`). */
const MERGE_SHORT_WITH_VALUE = "AbtFR";

/**
 * The `gh pr merge` flags this guard knows (gh 2.102.0, `gh pr merge --help` read live). A
 * flag that is not one of these — a newer gh's, a typo — may change what the merge does, so
 * the call asks, and it is never the exact form D31 allows.
 */
const MERGE_FLAGS: ReadonlySet<string> = new Set([
  "--admin",
  "--author-email",
  "--auto",
  "--body",
  "--body-file",
  "--delete-branch",
  "--disable-auto",
  "--match-head-commit",
  "--merge",
  "--rebase",
  "--squash",
  "--subject",
  "--repo",
]);

/** Those flags' short letters (`-A`, `-b`, `-F`, `-d`, `-m`, `-r`, `-s`, `-t`, `-R`). */
const MERGE_LETTERS = "AbFdmrstR";

/**
 * What a `gh pr merge`'s own words say, read the way gh reads them: `ref` null when they name
 * no pull request (the current branch's), else the number, URL or branch; `repo` the
 * `--repo` / `-R`; `admin` an `--admin` flag, with or without a value; `unknown` the first
 * flag this guard does not know. A flag's value is never read as a flag (`--subject --admin`
 * is a subject), and nothing after `--` is a flag.
 */
function mergeArguments(words: string[]): {
  ref: string | null;
  repo: string | null;
  admin: boolean;
  unknown: string | null;
} {
  let ref: string | null = null;
  let repo: string | null = null;
  let admin = false;
  let unknown: string | null = null;
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === "--") {
      ref ??= words[index + 1] || null;
      break;
    }
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      const value = at === -1 ? undefined : word.slice(at + 1);
      if (!MERGE_FLAGS.has(name)) unknown ??= name;
      if (name === "--repo") repo = value ?? words[index + 1] ?? null;
      if (name === "--admin") admin = true;
      // A flag that takes a value, written without `=`: the next word is its value, never the
      // pull request's name.
      if (value === undefined && MERGE_FLAGS_WITH_VALUE.has(name)) index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, MERGE_SHORT_WITH_VALUE);
      for (const letter of flags) {
        if (!MERGE_LETTERS.includes(letter)) unknown ??= `-${letter}`;
      }
      const letter = flags.slice(-1);
      if (letter !== "" && MERGE_SHORT_WITH_VALUE.includes(letter)) {
        const value = wantsNext ? (words[index + 1] ?? null) : word.slice(flags.length + 1);
        if (letter === "R") repo = value === "" ? null : value;
        if (wantsNext) index += 1;
      }
      continue;
    }
    ref ??= word || null;
  }
  return { ref, repo, admin, unknown };
}

/** `gh api` flags that take a value (gh 2.102.0, `gh api --help`): `=value`, or the next word. */
const API_VALUE_FLAGS = new Set([
  "--cache",
  "--field",
  "--header",
  "--hostname",
  "--input",
  "--jq",
  "--method",
  "--preview",
  "--raw-field",
  "--template",
  "-F",
  "-H",
  "-X",
  "-f",
  "-p",
  "-q",
  "-t",
]);

/** `gh api` flags that take no value. */
const API_PLAIN_FLAGS = new Set([
  "--allow-escape-sequences",
  "--include",
  "--paginate",
  "--silent",
  "--slurp",
  "--verbose",
  "-i",
]);

/** The short letters of `gh api` that take a value. */
const API_VALUE_LETTERS = "FHXfpqt";

/** The refusal every `gh api` merge gets: the guard does not judge that form. */
const API_MERGE_REFUSAL = "it merges with `gh api`, a form this guard does not judge";

/**
 * The merges a `gh api` invocation asks for — never judged, always a refusal: a call to the
 * pull-request merge endpoint (any method spelling: the endpoint alone decides), or a
 * GraphQL query that names `mergePullRequest` / `enablePullRequestAutoMerge`. A GraphQL
 * query that cannot be read at all (a file, the shell) is a refusal too. Anything else is no
 * merge, so `gh api graphql -f query='{ viewer { login } }'` stays silent.
 */
function apiCalls(rest: string[]): MergeCall[] {
  const fields: string[] = [];
  let endpoint: string | null = null;
  let body = false;
  let method: string | null = null;
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      endpoint ??= rest[index + 1] ?? null;
      break;
    }
    if (word === "-h" || word === "--help") return [];
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      if (!API_VALUE_FLAGS.has(name) && !API_PLAIN_FLAGS.has(name)) {
        return [
          call({
            refusal: `\`gh api\` takes a flag this guard does not know (\`${name}\`), so it cannot tell whether this merges or opens a pull request`,
          }),
        ];
      }
      if (name === "--input") body = true;
      if (name === "--method") method = at === -1 ? (rest[index + 1] ?? "") : word.slice(at + 1);
      if (name === "--field" || name === "--raw-field") {
        fields.push(at === -1 ? (rest[index + 1] ?? "") : word.slice(at + 1));
      }
      if (at === -1 && API_VALUE_FLAGS.has(name)) index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, API_VALUE_LETTERS);
      const unknown = flags
        .split("")
        .find((one) => one !== "i" && !API_VALUE_LETTERS.includes(one));
      if (unknown !== undefined) {
        return [
          call({
            refusal: `\`gh api\` takes a flag this guard does not know (\`-${unknown}\`), so it cannot tell whether this merges or opens a pull request`,
          }),
        ];
      }
      const letter = flags.slice(-1);
      if (letter === "" || !API_VALUE_LETTERS.includes(letter)) continue;
      const value = wantsNext ? (rest[index + 1] ?? "") : word.slice(flags.length + 1);
      if (wantsNext) index += 1;
      if (letter === "f" || letter === "F") fields.push(value);
      if (letter === "X") method = value;
      continue;
    }
    endpoint ??= word;
  }
  if (endpoint === null) return [];
  if (isGraphqlEndpoint(endpoint)) return graphqlCalls(fields, body);
  // gh sends GET, and POST once a parameter or a body is added (`gh api --help`).
  const posts = (method ?? (fields.length > 0 || body ? "POST" : "GET")).toUpperCase() === "POST";
  // A path cut short: in PowerShell every brace ends a command, so an unquoted
  // `repos/{owner}/{repo}/pulls/5/merge` reaches this point as `repos/`. A path the guard
  // cannot read whole must ask, never be guessed at.
  if (endpoint.endsWith("/")) {
    return [
      call({
        refusal:
          "the `gh api` path is cut short (gh's `{owner}`-style placeholders are read as parts of the command line), so this guard cannot tell which API path it reaches",
      }),
    ];
  }
  const merged = pullRequestMergePath(endpoint);
  if (merged !== null) return [call({ target: merged, refusal: API_MERGE_REFUSAL })];
  const created = pullRequestsPath(endpoint);
  if (created === null || !posts) return [];
  const draft = fields.some((field) => /^draft=true$/i.test(field));
  return [call({ draft, opens: "create", target: { ref: null, repo: created.repo } })];
}

/** Does the endpoint `gh api` names reach GitHub's GraphQL API (`graphql`, `/graphql`, a URL)? */
function isGraphqlEndpoint(endpoint: string): boolean {
  const path = endpoint
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return path === "graphql" || path.endsWith("/graphql");
}

/** The merges a `gh api graphql` call asks for: only a query the guard can read is judged. */
function graphqlCalls(fields: string[], body: boolean): MergeCall[] {
  // The query is the `query` field (`-f query=…`, `-F query=…`); `--input` carries the body.
  if (body) {
    return [
      call({
        refusal:
          "the GraphQL request is read from a file or standard input, so this guard cannot read the query",
      }),
    ];
  }
  for (const field of fields) {
    if (!field.startsWith("query=")) continue;
    const query = field.slice("query=".length);
    if (query.startsWith("@") || /\$\(|\$\{|`/.test(query)) {
      return [
        call({
          refusal:
            "the GraphQL query is read from a file or built by the shell, so this guard cannot read it",
        }),
      ];
    }
    const calls: MergeCall[] = [];
    if (/mergePullRequest|enablePullRequestAutoMerge/i.test(query)) {
      calls.push(
        call({
          refusal:
            "the GraphQL query it sends merges a pull request (`mergePullRequest`), which this guard does not judge",
        }),
      );
    }
    if (/createPullRequest/i.test(query)) {
      calls.push(call({ draft: /draft\s*:\s*true/i.test(query), opens: "create" }));
    }
    if (/markPullRequestReadyForReview/i.test(query)) calls.push(call({ opens: "ready" }));
    if (calls.length > 0) return calls;
  }
  return [];
}

/** The pull request a `gh api` merge path names (`repos/o/r/pulls/5/merge`), or null. */
function pullRequestMergePath(
  endpoint: string,
): { ref: string | null; repo: string | null } | null {
  const path = endpoint
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
  const match = /^repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/merge$/.exec(path);
  const [, owner, name, number] = match ?? [];
  if (owner === undefined || name === undefined || number === undefined) return null;
  const placeholder = (part: string) => part.includes("{");
  // `{owner}` / `{repo}` are filled in by gh from the folder's own repository.
  return {
    ref: number,
    repo: placeholder(owner) || placeholder(name) ? null : `${owner}/${name}`,
  };
}

/** The repository a `gh api` call to the pull request collection names (`repos/o/r/pulls`), or null. */
function pullRequestsPath(endpoint: string): { repo: string | null } | null {
  const path = endpoint
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
  const match = /^repos\/([^/]+)\/([^/]+)\/pulls$/.exec(path);
  const [, owner, name] = match ?? [];
  if (owner === undefined || name === undefined) return null;
  const placeholder = (part: string) => part.includes("{");
  return { repo: placeholder(owner) || placeholder(name) ? null : `${owner}/${name}` };
}

/**
 * Every merge a command line asks GitHub for, with the person's gh aliases read when a
 * `gh <word>` needs them — `gh m 5`, when `m` is their alias for `pr merge`: an alias that
 * expands to a merge is judged like the expansion, and a shell alias (`!…`) is a refusal.
 *
 * `gh alias list` reads the local config (`~/.config/gh/config.yml`), no network; it runs
 * only for a command with such a word, and gets `timeoutMs` (the caller's own time left). A
 * list it cannot read is `unread`, which the guard asks about: whether `gh <word>` merges is
 * then unknown. `dialect`: the tool's; not given, both are read.
 */
export function mergeCalls(
  command: string,
  folder: string,
  env: Env,
  timeoutMs = ALIAS_TIMEOUT_MS,
  dialect?: Dialect,
): MergeCall[] {
  return pullRequestCallsWithAliases(command, folder, env, timeoutMs, dialect).filter(isMerge);
}

/**
 * Merges and openings together (`MergeCall.opens` tells them apart), with the person's gh
 * aliases read when a `gh <word>` needs them, exactly as `mergeCalls` does: one alias read
 * serves both. An alias list that cannot be read leaves the `unread` call, which the merge
 * guard asks about.
 */
export function pullRequestCallsWithAliases(
  command: string,
  folder: string,
  env: Env,
  timeoutMs: number = ALIAS_TIMEOUT_MS,
  dialect?: Dialect,
): MergeCall[] {
  const unread = pullRequestCalls(command, null, dialect);
  if (!unread.some((one) => one.unknown !== null)) return unread;
  const aliases = readGhAliases(folder, env, timeoutMs);
  if (aliases === null) {
    return [...unread.filter((one) => one.unknown === null), call({ unread: "its aliases" })];
  }
  return pullRequestCalls(command, aliases, dialect);
}

/** How long one `gh` call in this hook may take: both hooks allow a gh call 10 s. */
const GH_TIMEOUT_MS = 10_000;

/**
 * How long `gh alias list` may take. It reads the person's own config file (no network), so a
 * gh that hangs on it is broken — and a guard has 30 s of its own, which its other gh calls
 * already need.
 */
const ALIAS_TIMEOUT_MS = 3_000;

/**
 * The person's gh aliases (`gh alias list`, read-only), or null when gh could not list them.
 * gh exits non-zero with "no aliases configured" when there are none (its own message, from
 * the 2.102.0 source): that is an empty list, not a failure. No time left at all (`timeoutMs`
 * or less): null, never a call — the guard asks rather than overruns.
 */
function readGhAliases(
  folder: string,
  env: Env,
  timeoutMs: number = ALIAS_TIMEOUT_MS,
): Map<string, string> | null {
  if (timeoutMs <= 0) return null;
  try {
    const run = Bun.spawnSync(["gh", "alias", "list"], {
      cwd: folder,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    const out = run.stdout.toString();
    if (run.exitCode !== 0) {
      // gh's own answer for a person with no aliases at all (checked against 2.102.0's source).
      return /no aliases configured/i.test(`${out}${run.stderr.toString()}`) ? new Map() : null;
    }
    return parseAliasList(out);
  } catch {
    // No gh on PATH, or a call that timed out.
    return null;
  }
}

/**
 * The aliases `gh alias list` prints, or null when a line is not the `name: expansion` shape
 * this reads. gh encodes its alias map as YAML (one `name: expansion` line each, the value
 * quoted when it needs it), so a folded or otherwise unreadable shape must ask, never guess.
 */
function parseAliasList(text: string): Map<string, string> | null {
  const aliases = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const match = /^([^\s:][^:]*):[ \t]?(.*)$/.exec(line);
    const name = match?.[1]?.trim();
    const rest = match?.[2]?.trim();
    if (name === undefined || rest === undefined) return null;
    const expansion = unquoteYaml(rest);
    if (expansion === null) return null;
    aliases.set(name, expansion);
  }
  return aliases;
}

/** A YAML scalar as gh writes one (`pr merge`, `'!pr merge'`, `"pr merge"`), or null. */
function unquoteYaml(value: string): string | null {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  // A block scalar, an anchor or an alias: a shape this reader does not know.
  if (/^[|>&*]/.test(value)) return null;
  return value;
}

/**
 * Did this shell command merge a pull request just now? (An `--auto` only arms it for later.)
 * A call the guard refuses still merged one — a `gh api` merge, a runner's (`xargs`), a shell
 * alias's — it is only a pull request this cannot be named from the line; a `gh <word>` that
 * may or may not be an alias of a merge (`unknown`) says nothing either way.
 */
export function mergesPullRequest(command: string, dialect?: Dialect): boolean {
  return pullRequestMerges(command, null, dialect).some(
    (one) => !one.arms && !one.disarms && (one.target !== null || one.refusal !== null),
  );
}

/**
 * Did this shell command ask GitHub to merge a pull request — now, or with `--auto` for
 * later, once the checks pass? What the merge guard watches: an armed merge lands with
 * nobody watching, so it is judged like a merge, and a `gh <word>` that is no gh command may
 * be an alias that merges, so it is looked at too. A `--disable-auto` only takes an armed
 * one back, so it is not.
 */
export function requestsMerge(command: string, dialect?: Dialect): boolean {
  return pullRequestMerges(command, null, dialect).some((one) => !one.disarms);
}

/**
 * The question when a line's program is worked out when it runs (`$GH`, `$(which gh)`) and
 * its words name a merge: the guard cannot tell whether it merges a pull request.
 */
export const COMPUTED_MERGE =
  "This command runs a program it works out when it runs, and its words name a merge, so this guard cannot tell whether it merges a pull request. Write the command out in full if you meant it.";

/**
 * True when a command's program is worked out when it runs (`$GH`, `$(which gh)`) and the
 * words of that command, as the reader sees them, say `names`. One reader for every
 * computed-program risk, so the merge check and the opening check can never disagree.
 */
function computedInvocationRisk(
  command: string,
  dialect: Dialect | undefined,
  names: (words: readonly string[]) => boolean,
): boolean {
  return readingsOf(command, dialect).some((reading) =>
    shellSteps(command, {
      blindWhenOpen: true,
      dialect: reading.dialect,
      joinLines: reading.joinLines,
    }).some((step) => {
      const words = wordsOf(step.text, reading.dialect);
      const invocation = invocationOf(words);
      return invocation?.computed === true && names(words);
    }),
  );
}

/**
 * True when a command's program is computed (`$GH`, `$(which gh)`) and the words of that
 * command name a merge. The one reader of a merge command line answers it for the merge
 * guard, its fail-closed answers, and every other caller.
 */
export function computedMergeRisk(command: string, dialect?: Dialect): boolean {
  return computedInvocationRisk(command, dialect, (words) =>
    words.some((word) => /merge/i.test(word)),
  );
}

/**
 * Do these words name a pull request change: an opening (`pr create`, `pr new`, `pr ready`)
 * or a merge? Read the way `couldBeMerge` reads a `gh pr` command, over a line whose program
 * cannot be named.
 */
function namesPullRequestChange(words: readonly string[]): boolean {
  const lower = words.map((word) => word.toLowerCase());
  if (lower.some((word) => /merge/i.test(word))) return true;
  return lower.includes("pr") && lower.some((word) => PR_OPENERS.has(word));
}

/**
 * True when a command's program is computed (`$GH`, `$(which gh)`) and the words of that
 * command name a pull request opening or merge. The program cannot be named, so a guard that
 * must refuse both cannot tell the line's work apart: a crew session's crew part denies on it
 * (D24, F5-1), the same way the merge guard asks about a computed merge.
 */
export function computedPullRequestRisk(command: string, dialect?: Dialect): boolean {
  return computedInvocationRisk(command, dialect, namesPullRequestChange);
}

/**
 * Did this shell command ask GitHub to merge a pull request, or open or ready one? What the
 * merge guard watches (D16): one cheap read, so an ordinary Bash call finds nothing and pays
 * nothing. A computed program whose words name a merge, an opening or making one ready counts:
 * the guard asks (or a crew session's crew part denies) rather than stay silent.
 */
export function requestsPullRequestChange(command: string, dialect?: Dialect): boolean {
  return (
    pullRequestCalls(command, null, dialect).some((one) => !one.disarms) ||
    computedPullRequestRisk(command, dialect)
  );
}

/**
 * The one merge a line is, when the WHOLE line is exactly `gh pr merge <n>` with flags this
 * guard knows (D31). Only that form may the merge guard answer `allow` for: an `allow` skips
 * auto mode's own "Merge Without Review" rule for the whole tool call (proved live, L1a.5),
 * and any other work on the line — a second command, a pipe, a wrapper or an assignment
 * before gh (`timeout 60 gh pr merge 7`), an alias, a `bash -c` — would skip that rule for
 * work the guard never judged. A redirection that writes a file, or a pull request named by a
 * branch or a URL rather than a number, is no exact merge either. So is an armed merge
 * (`--auto`): it lands later, once the checks pass, with nobody watching, so a commit pushed
 * after this check would merge unread — it stays silent, and auto mode's rule still applies.
 *
 * Null when the line is anything else. Read with the one shell reader, in the tool's dialect;
 * an unknown dialect (both readings) is never exact.
 */
export function exactMergeOf(command: string, dialect?: Dialect): MergeCall | null {
  const readings = readingsOf(command, dialect);
  if (readings.length !== 1) return null;
  const reading = readings[0];
  if (reading === undefined) return null;
  const steps = shellSteps(command, { dialect: reading.dialect, joinLines: reading.joinLines });
  const step = steps[0];
  if (steps.length !== 1 || step === undefined || step.pipedFrom !== null) return null;
  const words = wordsOf(step.text, reading.dialect);
  if (redirectionTargets(words).length > 0) return null;
  const invocation = invocationOf(words);
  if (invocation === undefined || invocation.program !== "gh") return null;
  // An assignment or a wrapper before gh (`env`, `sudo`, `timeout`) runs more than the merge.
  if (invocation.prefix.length > 0) return null;
  const calls = pullRequestCalls(step.text, null, reading.dialect);
  const one = calls[0];
  if (calls.length !== 1 || one === undefined || !isMerge(one)) return null;
  if (one.refusal !== null || one.unread !== null || one.unknown !== null) return null;
  if (one.unknownFlag !== null || one.admin || one.disarms || one.arms) return null;
  const ref = one.target?.ref ?? null;
  return ref !== null && /^\d+$/.test(ref) ? one : null;
}

/**
 * The pull request a set of merge calls merges: the first real one, else the first an armed
 * or disarmed one names. Null when none of them names one a caller could look up.
 */
export function mergeTargetOf(
  calls: MergeCall[],
): { ref: string | null; repo: string | null } | null {
  const named = calls.filter((one) => one.target !== null);
  const chosen = named.find((one) => !one.arms && !one.disarms) ?? named[0];
  return chosen?.target ?? null;
}

/** The facts `gh pr view --json <PULL_REQUEST_FIELDS>` gives. */
export interface PullRequestView {
  number: number;
  title: string;
  base: string;
  head: string;
  state: string;
  url: string;
  /** When it was merged (ISO time), or null. */
  mergedAt: string | null;
}

export const PULL_REQUEST_FIELDS = "number,title,baseRefName,headRefName,state,url,mergedAt";

export function parsePullRequestView(json: string): PullRequestView | null {
  try {
    const view = JSON.parse(json) as Record<string, unknown>;
    const { baseRefName, headRefName, mergedAt, number, state, title, url } = view;
    if (
      typeof baseRefName !== "string" ||
      typeof headRefName !== "string" ||
      typeof number !== "number" ||
      typeof state !== "string" ||
      typeof title !== "string" ||
      typeof url !== "string"
    ) {
      return null;
    }
    return {
      number,
      title,
      base: baseRefName,
      head: headRefName,
      state,
      url,
      mergedAt: typeof mergedAt === "string" && mergedAt !== "" ? mergedAt : null,
    };
  } catch {
    return null;
  }
}

/** `owner/name` from a GitHub pull request URL, lower case. */
function pullRequestRepository(url: string): string | null {
  const match = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\//i.exec(url);
  return match === null ? null : `${match[1] ?? ""}/${match[2] ?? ""}`.toLowerCase();
}

/**
 * `owner/name` from a repository as a person or git writes one — an https or ssh address
 * (`git@github.com:o/r.git`), an ssh alias, `OWNER/REPO`, or `HOST/OWNER/REPO` (`-R`'s
 * form) — lower case for comparing. Its last two parts; null when it names fewer.
 */
export function repositoryKey(spec: string): string | null {
  const parts = spec
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .split(/[/:]/)
    .filter((part) => part !== "");
  if (parts.length < 2) return null;
  const [owner, name] = parts.slice(-2);
  return owner === undefined || name === undefined ? null : `${owner}/${name}`.toLowerCase();
}

/** Is the pull request at `prUrl` one of the repository `origin` points at? */
export function sameRepository(prUrl: string, origin: string): boolean {
  const pr = pullRequestRepository(prUrl);
  return pr !== null && pr === repositoryKey(origin);
}

/** A merge older than this is not news: the command only named an old pull request. */
export const ANNOUNCE_WINDOW_MS = 15 * 60_000;

export interface MergeOutcome {
  /** The pull request to announce to the other sessions. */
  announce: PullRequestView | null;
  /** The worktree to clear: the session's own, when its branch was the one merged. */
  clear: { path: string; branch: string } | null;
}

/**
 * Decides the notes. `pr` is what gh said (null when it could not say); a pull request it
 * reports as not merged gets no note. `failed`: the shell command exited non-zero.
 */
export function mergeOutcome(params: {
  announced: boolean;
  base: string;
  failed: boolean;
  now: number;
  pr: PullRequestView | null;
  sameRepo: boolean;
  target: { ref: string | null };
  worktree: { branch: string | null; path: string } | null;
}): MergeOutcome {
  const { announced, base, failed, now, pr, sameRepo, target, worktree } = params;
  const none = { announce: null, clear: null };
  if (pr === null ? failed : pr.state !== "MERGED" || !sameRepo) return none;
  const branch = worktree?.branch ?? null;
  // Merged without a name: the current branch's. Named: by its branch, or gh's head branch.
  const mergedHere =
    worktree !== null &&
    branch !== null &&
    (target.ref === null || target.ref === branch || pr?.head === branch);
  const clear = mergedHere && branch !== null ? { path: worktree.path, branch } : null;
  const mergedAt = pr === null || pr.mergedAt === null ? Number.NaN : Date.parse(pr.mergedAt);
  const recent = now - mergedAt <= ANNOUNCE_WINDOW_MS;
  const announce = pr !== null && pr.base === base && !announced && recent ? pr : null;
  return { announce, clear };
}

/** A title safe to quote in a message: one line, no quotes, short. */
function quotableTitle(title: string): string {
  const line = title.replace(/["`]/g, "'").replace(/\s+/g, " ").trim();
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/** True when a worktree lives under `<repo>/.claude/worktrees/`, where Claude Code made it. */
export function insideClaudeWorktrees(path: string): boolean {
  return /(^|[\\/])\.claude[\\/]worktrees[\\/]/.test(path);
}

/**
 * The note that clears the session's own worktree once its pull request merged. Claude Code
 * checks a worktree under `.claude/worktrees/` itself; one outside it may be refused, and then
 * the session checks it by hand before `discard_changes`. The fallback is the plugin's own
 * finished-worktree check (`worktrees --remove`, `src/worktrees/`), which removes the folder
 * and the branch only when the worktree is finished.
 */
export function clearWorktreeNote(path: string, branch: string): string {
  return [
    `That merged the pull request of this worktree's branch, ${branch}. Clear the worktree now, unless the user wants more work on this branch:`,
    insideClaudeWorktrees(path)
      ? 'ExitWorktree with action "remove": Claude Code checks a worktree under .claude/worktrees/ itself and says when work is left.'
      : 'ExitWorktree with action "remove". A worktree outside .claude/worktrees/ may be refused because Claude Code cannot check it: if the refusal is only for the merged commits, check that `git status --porcelain` is empty and `git log @{u}..` shows nothing, then call it again with discard_changes true.',
    `If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), run in the main checkout: ${COMMAND} worktrees --remove "${path}" — it removes the folder and the branch only when the worktree is finished. A subagent never calls ExitWorktree: it is already isolated and leaves its worktree to the session that launched it.`,
  ].join("\n");
}

/**
 * A session on a branch whose pull request goes into ANOTHER base must not merge the
 * integration base in: that base holds work its own base has not released yet, so the merge
 * would ship it early. Named as the prefixes of `worktrees.bases` (`hotfix/`, `release/`),
 * and only those whose base is not `base` itself.
 */
export function otherBaseCaution(bases: Record<string, string>, base: string): string | null {
  const elsewhere = Object.entries(bases)
    .filter(([, target]) => target !== base)
    .map(([prefix]) => prefix);
  if (elsewhere.length === 0) return null;
  return (
    `One exception: a branch whose pull request goes into another base (${elsewhere.join(", ")}) must NOT merge ${base} in, ` +
    `because that would ship unreleased work. A branch there stays as it is.`
  );
}

export function tellSessionsNote(
  pr: PullRequestView,
  base: string,
  bases: Record<string, string> = {},
  otherLeads: readonly string[] | null = null,
): string {
  const caution = otherBaseCaution(bases, base);
  const message =
    `${base} now has #${pr.number} (${quotableTitle(pr.title)}). At your next stop, once your current work is committed: ` +
    `git fetch origin ${base}, then git merge origin/${base}, and fix any conflict. ` +
    `Never commit unfinished work just to take the merge. After the merge, run the install your project uses if the merge changed a lock file. Run the tests the merge touched. ` +
    `${caution === null ? "" : `${caution} `}No reply needed.`;
  // D55: the other leads of this repo hear it too, and a crew session never does: it works on
  // its own lead's branch, cut from that lead's work, and the base has no place in it. `null`:
  // the store was not read, so nothing is claimed about which leads there are.
  const leads =
    otherLeads === null
      ? "The other leads here are the sessions named `LEAD …` in that list."
      : otherLeads.length === 0
        ? "No other lead is recorded in this repo."
        : `The other leads here: ${otherLeads.join(", ")}.`;
  return [
    `That merged #${pr.number} into ${base}.`,
    "Tell the other leads of this repo and the person's own sessions, once, after your last merge this turn: ListAgents, then one SendMessage to each session working in this repo that is not this session, not a subagent, and not a crew session (a session named `C …`), with exactly this text:",
    `"${message}"`,
    `${leads} Never send it to a crew session: it follows its own lead's branch, and merging ${base} into it would be wrong.`,
    "Merged several pull requests this turn? Send each session one message, naming every merged number.",
  ].join("\n");
}

/** The line each other lead's watch prints for a merge into the base (D55). */
export function mergedLine(pr: PullRequestView, base: string, who: string): string {
  return `${who} merged #${pr.number} (${quotableTitle(pr.title)}) into ${base} — at your next stop, merge origin/${base} into your branch`;
}

/** The leads of `repo` other than the session that merged, and that session's lead record. */
function leadsOf(
  stateDir: string,
  repo: string,
  sessionId: string | null,
): { merger: LeadRecord | null; others: LeadRecord[] } {
  const leads = listLeads(stateDir, repo).records;
  // No session id: which lead merged is unknown, so every lead is another one to tell.
  if (sessionId === null) return { merger: null, others: leads };
  return {
    merger: leads.find((one) => one.sessionId === sessionId) ?? null,
    others: leads.filter((one) => one.sessionId !== sessionId),
  };
}

/**
 * Records one `merge` event per other lead (D55), so that lead's own watch says the line
 * without waiting for the message the merging session sends. `found` is the store's leads as
 * the caller read them, so the store is read once. News, never a guard: an event that cannot be
 * written costs nothing — the note still says to send the message — and the events stop when
 * the hook's own time is spent, so the note it answers with is never lost to them.
 */
async function recordMerged(
  context: HookContext,
  repo: string,
  pr: PullRequestView,
  base: string,
  sessionId: string,
  found: { merger: LeadRecord | null; others: LeadRecord[] },
  timeFor: (limitMs: number) => number,
): Promise<void> {
  const who = found.merger?.name ?? "a session";
  const line = mergedLine(pr, base, who);
  for (const one of found.others) {
    if (timeFor(1) <= 0) return;
    try {
      await appendCrewEvent(
        context.paths.stateDir,
        repo,
        {
          crew: sessionId,
          lead: one.sessionId,
          name: who,
          state: "working",
          text: line,
          type: "merge",
        },
        context.nowMs,
      );
    } catch {
      // A line that cannot be written is not worth an error on the person's screen.
    }
  }
}

/**
 * The pull request `ref` names (or the current branch's), or null when gh cannot say.
 * `timeoutMs`: the time this call may take (the caller's own limit or what is left).
 */
function viewPullRequest(
  ref: string | null,
  repo: string | null,
  folder: string,
  env: Env,
  timeoutMs: number,
): PullRequestView | null {
  // Nothing left: the call is not made at all (a spawn with `timeout: 0` has no limit).
  if (timeoutMs <= 0) return null;
  try {
    const view = Bun.spawnSync(
      [
        "gh",
        "pr",
        "view",
        ...(ref === null ? [] : [ref]),
        ...(repo === null ? [] : ["--repo", repo]),
        "--json",
        PULL_REQUEST_FIELDS,
      ],
      { cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs },
    );
    return view.exitCode === 0 ? parsePullRequestView(view.stdout.toString()) : null;
  } catch {
    // No gh on PATH.
    return null;
  }
}

/** The file that records one announced pull request of one repo. */
function announcedFile(repo: string, number: number, env: Env): string {
  const key = createHash("sha256").update(repo).digest("hex").slice(0, 16);
  return join(env.TMPDIR || tmpdir(), "cc-smart-dev-kit-merges", `${key}-${number}`);
}

export async function afterMerge(context: HookContext): Promise<HookResult> {
  const { project, input, event, env, cwd } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined) return SILENT;
  const command = stringField(toolInput(input).command);
  if (command === null) return SILENT;
  // The alias list is read only for a `gh <word>` that is no gh command (`mergeCalls`), and
  // what it cannot work out — a shell alias, a GraphQL merge — names no pull request, so the
  // note is skipped rather than guessed (`mergeTargetOf`). An armed merge (`--auto`) lands
  // later, with nobody watching, so it is no merge here. The line is read in the dialect of
  // the tool that ran it.
  const dialect = dialectOfTool(input.tool_name);
  // One budget for every child the hook starts (above): a call with no time left is not made.
  const { timeFor } = startBudget(env);
  const calls = mergeCalls(command, cwd, env, timeFor(ALIAS_TIMEOUT_MS), dialect).filter(
    (one) => !one.arms && !one.disarms,
  );
  const target = mergeTargetOf(calls);
  if (target === null) return SILENT;
  const repo = project.mainCheckout ?? project.root;

  let worktree: { branch: string | null; path: string } | null = null;
  const listLeft = timeFor(GUARD_GIT_TIMEOUT_MS);
  if (listLeft <= 0) return SILENT;
  const [, ...linked] = listWorktrees(repo, env, listLeft);
  const mine = innermostWorktree(
    cwd,
    linked.map((listed) => listed.path),
  );
  if (mine !== null) {
    worktree = {
      path: mine,
      branch: linked.find((listed) => listed.path === mine)?.branch ?? null,
    };
  }

  const viewLeft = timeFor(GH_TIMEOUT_MS);
  if (viewLeft <= 0) return SILENT;
  const pr = viewPullRequest(target.ref, target.repo, cwd, env, viewLeft);
  const originLeft = timeFor(GUARD_GIT_TIMEOUT_MS);
  if (originLeft <= 0) return SILENT;
  const origin = runGit(repo, ["remote", "get-url", "origin"], env, originLeft);
  const record = pr === null ? null : announcedFile(repo, pr.number, env);
  const outcome = mergeOutcome({
    announced: record !== null && existsSync(record),
    base,
    failed: event === "PostToolUseFailure",
    now: Date.now(),
    pr,
    sameRepo: pr !== null && origin.ok && sameRepository(pr.url, origin.out),
    target,
    worktree,
  });
  const notes: string[] = [];
  if (outcome.clear !== null)
    notes.push(clearWorktreeNote(outcome.clear.path, outcome.clear.branch));
  if (outcome.announce !== null && record !== null) {
    const pr = outcome.announce;
    // The other leads of this repo (D55): the note names them, and each one's watch also gets
    // the merge from the store, so the line arrives without waiting for a message. A store that
    // cannot be read leaves the note without lead names — never claiming there are none.
    const mergedBy = isSessionId(input.session_id) ? input.session_id : null;
    let found: { merger: LeadRecord | null; others: LeadRecord[] } | null = null;
    try {
      found = leadsOf(context.paths.stateDir, repo, mergedBy);
    } catch {
      // A store that cannot be read leaves the note without lead names.
    }
    notes.push(
      tellSessionsNote(
        pr,
        base,
        project.config?.worktrees?.bases ?? {},
        found?.others.map((one) => one.name) ?? null,
      ),
    );
    // The marker first: a merge event written twice is worse than a note the next merge
    // command says again, and a marker that cannot be written leaves no event behind.
    mkdirSync(join(record, ".."), { recursive: true });
    writeFileSync(record, "");
    if (mergedBy !== null && found !== null)
      await recordMerged(context, repo, pr, base, mergedBy, found, timeFor);
  }
  // A merge into the base (announced once per pull request): finished worktrees clean
  // themselves, in a detached process (D48, `src/worktrees/auto-start.ts`).
  if (outcome.announce !== null) startAutoClean(context, repo, "merge");
  return notes.length === 0 ? SILENT : addContext(event, notes.join("\n\n"));
}
