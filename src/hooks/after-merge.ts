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
 *   before, the note gives the exact message to send each other session of this repo. The
 *   message also names the prefixes of `worktrees.bases` whose own base is another one
 *   (`otherBaseCaution`): a session on such a branch must not merge the integration base in,
 *   because that would ship unreleased work.
 *
 * It looks the pull request up once with `gh pr view` (10 s at most). A `gh pr merge` that
 * only arms a merge (`--auto`) or disarms one is no merge, and neither are the words
 * `gh pr merge` in a quote, a here-doc or a comment (`shell-command.ts`). When the shell
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
import { innermostWorktree, listWorktrees, runGit } from "./git";
import { addContext, type HookResult, SILENT, stringField, toolInput } from "./io";
import { runsProjectHook } from "./project-wiring";
import type { Env, HookContext } from "./run";
import { projectSettingsFiles, wiredHandlers } from "./settings-hooks";
import {
  invocationOf,
  isShort,
  MAX_NESTING,
  nestedCommand,
  programName,
  shellSteps,
  shortFlags,
  wordsOf,
} from "./shell-command";

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
    ...fields,
  };
}

/** Commands that change the folder the rest of the line runs in (the git guard reads the same names). */
const CHANGE_DIR = new Set(["cd", "chdir", "popd", "pushd", "set-location", "sl"]);

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
 * caller to look up. `movedBefore` is for the recursive read of a nested command: a `cd`
 * before the shell that runs it moves that one too.
 */
export function pullRequestMerges(
  command: string,
  aliases: ReadonlyMap<string, string> | null = null,
  depth = 0,
  movedBefore: string | null = null,
): MergeCall[] {
  const calls: MergeCall[] = [];
  let moved = movedBefore;
  for (const step of shellSteps(command, { joinLines: true })) {
    const words = wordsOf(step.text);
    // Any mention of `GH_REPO` / `GH_HOST` in a step points the gh calls after it somewhere
    // else — in every spelling (`export GH_REPO=…`, `$env:GH_REPO='…'`, `set GH_REPO=…`),
    // including a step that is nothing but the assignment.
    if (words.some((word) => GH_POINTING_TEXT.test(word))) {
      moved ??=
        "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain";
    }
    const invocation = invocationOf(words);
    // A runner whose own words the line cut in two — `xargs -I{} gh pr merge {}` is two
    // pieces, because the lexer cuts a line at braces — has no invocation of its own
    // (`xargs -I` wants a command that is not there); what follows it is still run by it.
    const runnerWord = RUNNERS[programName(words[0] ?? "")];
    if (invocation === undefined) {
      if (runnerWord !== undefined) moved ??= runnerWord.moved;
      continue;
    }
    const { args, program } = invocation;
    // A later merge acts on whatever the steps before it left: a folder a `cd` / `git -C`
    // moved to, a branch a `git switch` / `checkout` changed (each set AFTER this step's own
    // calls are read, so a step never moves itself).
    if (program === "git") moved ??= gitMoved(args);
    else if (CHANGE_DIR.has(program)) {
      moved ??= `an earlier \`${program}\` in the same command changes the folder it runs in`;
    }
    const runner = runnerOf(program, prefixWords(words, args));
    if (runner === null && runnerWord !== undefined) moved ??= runnerWord.moved;
    if (program === "gh" && runner === null) {
      calls.push(...dispatch(args, moved ?? prefixMoved(words, args), aliases, depth));
      moved ??= ghSwitchReason(args, aliases, depth);
    } else if (runner !== null) {
      // The merge is run by a program the line does not show in full: `xargs` / `parallel`
      // feed its arguments, `find -exec` runs it per match, `watch` over and over, and
      // `sudo` / `doas` / `su` run it with another user's gh config. Never judged.
      calls.push(...runnerCalls(words, runner, moved ?? prefixMoved(words, args), aliases, depth));
    }
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      calls.push(...pullRequestMerges(inner, aliases, depth + 1, moved));
    }
    // `su -c '<script>'` reads its command from a word: the script is a line of its own.
    const script = suScript(program, args);
    if (script !== undefined && depth < MAX_NESTING) {
      calls.push(...runnerCallsOfScript(script, runner ?? SU_RUNNER, moved, aliases, depth));
    }
  }
  return calls;
}

/** The words before the program: assignments, keywords and wrappers `invocationOf` stepped over. */
function prefixWords(words: string[], args: string[]): string[] {
  return words.slice(0, Math.max(0, words.length - args.length - 1));
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
const RUNNERS: Record<string, { feeds: boolean; moved: string; reason: string }> = {
  doas: {
    feeds: false,
    moved: "an earlier `doas` in the same command may run the merge as another user",
    reason: "the merge runs under `doas`, with another user's login and gh config",
  },
  find: {
    feeds: false,
    moved: "an earlier `find` in the same command may run the merge once for each match",
    reason: "the merge runs from `find -exec`, once for each match",
  },
  parallel: {
    feeds: true,
    moved:
      "an earlier `parallel` in the same command may feed the merge its arguments from outside the line",
    reason: "the merge runs from `parallel`, whose arguments come from outside the line",
  },
  su: {
    feeds: true,
    moved:
      "an earlier `su` in the same command may run the merge in another shell, with its own environment",
    reason: "the merge runs from `su`, whose command and environment come from outside the line",
  },
  sudo: {
    feeds: false,
    moved: "an earlier `sudo` in the same command may run the merge under another user",
    reason: "the merge runs under `sudo`, with another user's login and gh config",
  },
  watch: {
    feeds: false,
    moved: "an earlier `watch` in the same command may run the merge over and over",
    reason: "the merge runs from `watch`, over and over",
  },
  xargs: {
    feeds: true,
    moved:
      "an earlier `xargs` in the same command may feed the merge its arguments from outside the line",
    reason: "the merge runs from `xargs`, whose arguments come from outside the line",
  },
};

/** The runner `su -c '<script>'` is read through: the script's own line follows it. */
const SU_RUNNER: Runner = {
  feeds: true,
  name: "su",
  reason: "the merge runs from `su`, whose command and environment come from outside the line",
};

/** One runner and how it runs what follows it. */
interface Runner {
  /** The arguments come from outside the line (a pipe, a file list). */
  feeds: boolean;
  name: string;
  reason: string;
}

/** The runner a step's words name (`sudo`, `xargs`, …), or null when it runs the merge itself. */
function runnerOf(program: string, before: string[]): Runner | null {
  for (const word of [program, ...before]) {
    const name = programName(word);
    const spec = RUNNERS[name];
    if (spec !== undefined) return { feeds: spec.feeds, name, reason: spec.reason };
  }
  return null;
}

/** The merges a runner's own words name (`find . -exec gh pr merge 17 \;`), or none. */
function runnerCalls(
  words: string[],
  runner: Runner,
  moved: string | null,
  aliases: ReadonlyMap<string, string> | null,
  depth: number,
): MergeCall[] {
  const at = words.findIndex((word) => programName(word) === "gh");
  if (at !== -1) return refuseRunner(dispatch(words.slice(at + 1), null, aliases, depth), runner);
  // Or the whole merge is one word the runner runs: `parallel 'gh pr merge {}' ::: 5 6`, where
  // the quotes kept it whole. Reading it as a line of its own is the only way to see it.
  const held = words.find((word) => /\bgh\b/i.test(word) && /\bmerge\b/i.test(word));
  if (held === undefined) return [];
  return refuseRunner(pullRequestMerges(held, aliases, depth + 1, moved), runner);
}

/** The merges a script run by a runner names (`su -c 'gh pr merge 7'`), or none. */
function runnerCallsOfScript(
  script: string,
  runner: Runner,
  moved: string | null,
  aliases: ReadonlyMap<string, string> | null,
  depth: number,
): MergeCall[] {
  return refuseRunner(pullRequestMerges(script, aliases, depth + 1, moved), runner);
}

/**
 * Turns the merges a runner would run into refusals: the guard never judges them, because
 * what their arguments are, how often they run and whose gh config they use is not on the
 * line. A runner that feeds the arguments names no pull request at all.
 */
function refuseRunner(calls: MergeCall[], runner: Runner): MergeCall[] {
  return calls
    .filter((one) => !one.disarms)
    .map((one) => call({ target: runner.feeds ? null : one.target, refusal: runner.reason }));
}

/** Why a `git` command in the line moves the checkout or the branch a later merge acts on. */
function gitMoved(args: string[]): string | null {
  // git's own options (`git -C dir -c k=v switch x`) come before its subcommand.
  let index = 0;
  let otherFolder = false;
  for (; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-C") {
      otherFolder = true;
      index += 1;
    } else if (["--git-dir", "--namespace", "--work-tree", "-c"].includes(arg)) {
      index += 1;
    } else if (!arg.startsWith("-")) {
      break;
    }
  }
  if (otherFolder) return "an earlier `git -C` in the same command runs in another folder";
  const sub = args[index];
  if (sub === "switch" || sub === "checkout") {
    return `an earlier \`git ${sub}\` in the same command may change the branch it merges from`;
  }
  return null;
}

/**
 * Why the words before the program make this merge's own repository or environment
 * uncertain, or null. `invocationOf` steps over those words, so the ones it left are
 * `words` without the program and its arguments.
 */
function prefixMoved(words: string[], args: string[]): string | null {
  const before = words.slice(0, Math.max(0, words.length - args.length - 1));
  if (before.some((word) => GH_POINTING.test(word))) {
    return "the merge sets `GH_REPO`/`GH_HOST` itself, so which repository it merges in is not certain";
  }
  if (before.some((word) => ENV_PROGRAM.test(word))) {
    return "the merge runs through `env`, so which environment gh sees is not certain";
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

/** Could these words be a merge, without reading them? (an alias may run one, `api` decides.) */
function couldBeMerge(rest: string[]): boolean {
  const command = rest[0]?.toLowerCase();
  if (command === undefined) return false;
  if (command === "api") return true;
  if (command === "pr") return rest.slice(1).some((word) => word.toLowerCase() === "merge");
  return !GH_COMMANDS.has(command);
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
          refusal: `\`gh pr\` takes a flag this guard does not know (\`${word}\`), so it cannot tell whether this is a merge`,
        }),
      ];
    }
  }
  if (rest[index] !== "merge") return [];
  const args = rest.slice(index + 1);
  if (args.some((arg) => arg === "-h" || arg === "--help")) return [];
  const named = mergeArguments(args);
  return [
    call({
      target: { ref: named.ref, repo: repo ?? named.repo ?? carried },
      refusal: moved,
      arms: args.some(isAutoFlag),
      disarms: args.some(isDisableAutoFlag),
      admin: named.admin,
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
 * What a `gh pr merge`'s own words say, read the way gh reads them: `ref` null when they name
 * no pull request (the current branch's), else the number, URL or branch; `repo` the
 * `--repo` / `-R`; `admin` an `--admin` flag, with or without a value. A flag's value is
 * never read as a flag (`--subject --admin` is a subject), and nothing after `--` is a flag.
 */
function mergeArguments(words: string[]): {
  ref: string | null;
  repo: string | null;
  admin: boolean;
} {
  let ref: string | null = null;
  let repo: string | null = null;
  let admin = false;
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
      if (name === "--repo") repo = value ?? words[index + 1] ?? null;
      if (name === "--admin") admin = true;
      // A flag that takes a value, written without `=`: the next word is its value, never the
      // pull request's name.
      if (value === undefined && MERGE_FLAGS_WITH_VALUE.has(name)) index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, MERGE_SHORT_WITH_VALUE);
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
  return { ref, repo, admin };
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
            refusal: `\`gh api\` takes a flag this guard does not know (\`${name}\`), so it cannot tell whether this is a merge`,
          }),
        ];
      }
      if (name === "--input") body = true;
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
            refusal: `\`gh api\` takes a flag this guard does not know (\`-${unknown}\`), so it cannot tell whether this is a merge`,
          }),
        ];
      }
      const letter = flags.slice(-1);
      if (letter === "" || !API_VALUE_LETTERS.includes(letter)) continue;
      const value = wantsNext ? (rest[index + 1] ?? "") : word.slice(flags.length + 1);
      if (wantsNext) index += 1;
      if (letter === "f" || letter === "F") fields.push(value);
      continue;
    }
    endpoint ??= word;
  }
  if (endpoint === null) return [];
  if (isGraphqlEndpoint(endpoint)) return graphqlCalls(fields, body);
  // A path cut short: the lexer splits a line at braces, so an unquoted
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
  return merged === null ? [] : [call({ target: merged, refusal: API_MERGE_REFUSAL })];
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
    if (/mergePullRequest|enablePullRequestAutoMerge/i.test(query)) {
      return [
        call({
          refusal:
            "the GraphQL query it sends merges a pull request (`mergePullRequest`), which this guard does not judge",
        }),
      ];
    }
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

/**
 * Every merge a command line asks GitHub for, with the person's gh aliases read when a
 * `gh <word>` needs them — `gh m 5`, when `m` is their alias for `pr merge`: an alias that
 * expands to a merge is judged like the expansion, and a shell alias (`!…`) is a refusal.
 *
 * `gh alias list` reads the local config (`~/.config/gh/config.yml`), no network; it runs
 * only for a command with such a word, and gets `timeoutMs` (the caller's own time left). A
 * list it cannot read is `unread`, which the guard asks about: whether `gh <word>` merges is
 * then unknown.
 */
export function mergeCalls(
  command: string,
  folder: string,
  env: Env,
  timeoutMs = ALIAS_TIMEOUT_MS,
): MergeCall[] {
  const unread = pullRequestMerges(command);
  if (!unread.some((one) => one.unknown !== null)) return unread;
  const aliases = readGhAliases(folder, env, timeoutMs);
  if (aliases === null) {
    return [...unread.filter((one) => one.unknown === null), call({ unread: "its aliases" })];
  }
  return pullRequestMerges(command, aliases);
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
export function mergesPullRequest(command: string): boolean {
  return pullRequestMerges(command).some(
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
export function requestsMerge(command: string): boolean {
  return pullRequestMerges(command).some((one) => !one.disarms);
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

/**
 * True when the plugin's own WorktreeRemove hook (`cc-smart-dev-kit hook worktree-remove`) is
 * wired where Claude Code reads hooks for this session: the person's settings and the
 * project's two settings files, in the folder the session started in (`CLAUDE_PROJECT_DIR`,
 * else the main checkout). Only then does something check a worktree before `discard_changes`
 * removes it: that hook keeps a folder with uncommitted work, and a branch with commits that
 * are nowhere else (`worktree-remove.ts`). A project with an engine of its own, or none, has
 * no such check.
 */
export function pluginRemovesWorktrees(context: HookContext): boolean {
  const { env, paths, project } = context;
  const started = env.CLAUDE_PROJECT_DIR;
  const projectDir =
    started !== undefined && started !== "" ? started : (project.mainCheckout ?? project.root);
  return [paths.settingsFile, ...projectSettingsFiles(projectDir)].some((file) =>
    wiredHandlers(file, "WorktreeRemove", null).some((handler) =>
      runsProjectHook(handler.command, "worktree-remove"),
    ),
  );
}

/**
 * The note that clears the session's own worktree once its pull request merged. `checked`:
 * the plugin's WorktreeRemove hook is wired (`pluginRemovesWorktrees`), so `discard_changes
 * true` is safe — Claude Code cannot check a worktree outside the repo, and that hook does.
 * Without it, nothing would check: the note never offers `discard_changes`, so Claude Code's
 * own check keeps uncommitted work, and the fallback is the plugin's own finished-worktree
 * check (`cc-smart-dev-kit worktrees --remove`, `src/worktrees/`).
 */
export function clearWorktreeNote(path: string, branch: string, checked: boolean): string {
  const exit = checked
    ? `ExitWorktree with action "remove" and discard_changes true. Claude Code cannot check a worktree outside the repo, so the ${COMMAND} hook does: it removes the folder only when nothing in it is uncommitted, and the branch only when every commit on it is on another branch.`
    : `ExitWorktree with action "remove", without discard_changes: no ${COMMAND} hook removes this project's worktrees, so Claude Code's own check is what keeps uncommitted work, and it refuses when there is some.`;
  return [
    `That merged the pull request of this worktree's branch, ${branch}. Clear the worktree now, unless the user wants more work on this branch:`,
    exit,
    `If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), run in the main checkout: ${COMMAND} worktrees --remove "${path}" — it removes the folder and the branch only when the worktree is finished.`,
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
): string {
  const caution = otherBaseCaution(bases, base);
  const message =
    `${base} now has #${pr.number} (${quotableTitle(pr.title)}). At your next stop, once your current work is committed: ` +
    `git fetch origin ${base}, then git merge origin/${base}, and fix any conflict. ` +
    `${caution === null ? "" : `${caution} `}No reply needed.`;
  return [
    `That merged #${pr.number} into ${base}.`,
    "Tell the other sessions of this repo, once, after your last merge this turn: ListAgents, then one SendMessage to each session working in this repo (not this session, not a subagent, not another project) with exactly this text:",
    `"${message}"`,
    "Merged several pull requests this turn? Send each session one message, naming every merged number.",
  ].join("\n");
}

/** The pull request `ref` names (or the current branch's), or null when gh cannot say. */
function viewPullRequest(
  ref: string | null,
  repo: string | null,
  folder: string,
  env: Env,
): PullRequestView | null {
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
      { cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: GH_TIMEOUT_MS },
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

export function afterMerge(context: HookContext): HookResult {
  const { project, input, event, env, cwd } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined) return SILENT;
  const command = stringField(toolInput(input).command);
  if (command === null) return SILENT;
  // The alias list is read only for a `gh <word>` that is no gh command (`mergeCalls`), and
  // what it cannot work out — a shell alias, a GraphQL merge — names no pull request, so the
  // note is skipped rather than guessed (`mergeTargetOf`). An armed merge (`--auto`) lands
  // later, with nobody watching, so it is no merge here.
  const calls = mergeCalls(command, cwd, env).filter((one) => !one.arms && !one.disarms);
  const target = mergeTargetOf(calls);
  if (target === null) return SILENT;
  const repo = project.mainCheckout ?? project.root;

  let worktree: { branch: string | null; path: string } | null = null;
  const [, ...linked] = listWorktrees(repo, env);
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

  const pr = viewPullRequest(target.ref, target.repo, cwd, env);
  const origin = runGit(repo, ["remote", "get-url", "origin"], env);
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
    notes.push(
      clearWorktreeNote(outcome.clear.path, outcome.clear.branch, pluginRemovesWorktrees(context)),
    );
  if (outcome.announce !== null && record !== null) {
    notes.push(tellSessionsNote(outcome.announce, base, project.config?.worktrees?.bases ?? {}));
    mkdirSync(join(record, ".."), { recursive: true });
    writeFileSync(record, "");
  }
  return notes.length === 0 ? SILENT : addContext(event, notes.join("\n\n"));
}
