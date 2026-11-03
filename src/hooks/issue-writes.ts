/**
 * The reader of a raw WRITE to GitHub's issues (decision D67), for the merge guard: `gh issue
 * create | edit | comment | close | reopen | delete | transfer | lock | pin | develop …`, `gh
 * label create | edit | delete | clone`, and `gh api` with POST, PATCH, PUT or DELETE to a
 * repository's `issues` or `labels` endpoints, or with a GraphQL mutation. An issue is text that
 * leaves the machine, and a label can make an issue "ready" that nobody labelled, so a session's
 * own write is the person's yes; the kit's way is `cc-smart-dev-kit issue file`, which is not a
 * `gh` command and is never read here. The merge guard asks the person (`merge-guard.ts`).
 *
 * Read with the one shell reader (`invocationsOf`, `src/shell/command.ts`): wrappers, `bash -c`
 * and the dialect of the tool are stepped through like every guard does. A read (`gh issue
 * list`, `view`, `status`, a GET) and `--help` are no write; a subcommand this reader does not
 * know counts as one (a guard fails closed). Flags are read the way gh reads them: before the
 * subcommand an option takes the next word, a `-h` after an option is that option's value, and
 * `-X=POST` is `POST`. The runners (`find -exec`, `watch`, `su -c`, `parallel`, `xargs`) are the
 * reader's own (`nestedCommand`, `WRAPPERS`): `invocationsOf` already hands back the `gh` they run.
 *
 * **Text it cannot read whole fails closed.** A write method to an endpoint the shell fills in
 * (a `$` expansion or a backtick outside single quotes: the reader asks the shell reader, which
 * knows the quotes, `RunInvocation.filled`), a GraphQL query it fills in, a request body from a file
 * (`--input`, `query=@file`), and a `gh` alias that runs a shell command or expands too deep all
 * count as a write. A `gh <word>` is looked up in the person's aliases when the caller gives the
 * list (`issueWritesWithAliases`, like the merge reader); a word that is neither a gh command nor
 * an alias is handed back in the reading's `unnamed` list, and is no write.
 * **Not read:** a script file. The program of a line worked out when it runs (`$GH issue create`)
 * is a risk of its own (`computedIssueRisk`).
 */
import {
  anyFill,
  type Dialect,
  type FillTest,
  fillTest,
  invocationsOf,
  isShort,
  MAX_NESTING,
  shortFlags,
  wordsOf,
} from "../shell/command";
import {
  type AliasReader,
  API_PLAIN_FLAGS,
  API_VALUE_FLAGS,
  API_VALUE_LETTERS,
  type ApiText,
  computedInvocationRisk,
  GH_COMMANDS,
} from "./after-merge";

/** `gh issue` subcommands that only read (or print help). Every other subcommand writes. */
const ISSUE_READS: ReadonlySet<string> = new Set(["help", "list", "ls", "status", "view"]);

/** `gh label` subcommands that only read (or print help). Every other subcommand writes. */
const LABEL_READS: ReadonlySet<string> = new Set(["help", "list", "ls"]);

/** The methods that change something. */
const WRITE_METHODS: ReadonlySet<string> = new Set(["DELETE", "PATCH", "POST", "PUT"]);

/**
 * A repository's issues and labels endpoints: `repos/<o>/<r>/issues`, below it (a comment, a
 * label on an issue), or by repository id.
 */
const ISSUES_PATH = /^(?:repos\/[^/]+\/[^/]+|repositories\/[^/]+)\/(?:issues|labels)(?:\/.*)?$/i;

/**
 * The GraphQL mutations of pull requests: the merge guard judges these (a merge, an opening, a
 * ready mark), so they are no issue write. Any other mutation is one: it may touch an issue, a
 * comment, a label, a sub-issue or an assignee, and GitHub adds more.
 */
const PULL_REQUEST_MUTATIONS: ReadonlySet<string> = new Set([
  "createPullRequest",
  "enablePullRequestAutoMerge",
  "markPullRequestReadyForReview",
  "mergePullRequest",
]);

/** The endpoint as a path: no host, no query, no outer slashes, no GitHub Enterprise `api/v3`. */
function apiPath(endpoint: string): string {
  return endpoint
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^api\/v3\//i, "");
}

/** Does the endpoint reach GitHub's GraphQL API? */
function isGraphql(endpoint: string): boolean {
  const path = apiPath(endpoint).toLowerCase();
  return path === "graphql" || path.endsWith("/graphql");
}

/**
 * What a GraphQL request writes, named, or null. Every GitHub mutation is `name(input: …)`, so
 * the names are the words before `(input:`; a mutation made only of pull request mutations is
 * the merge guard's. A request the guard cannot read (a file, text the shell fills in) counts as
 * a write: it cannot be told from a mutation. A `$` GraphQL names its own variables with
 * (`query($n: Int!)`) is text, not the shell's.
 */
function graphqlWrite(fields: readonly ApiText[], body: boolean): string | null {
  if (body) {
    return "a gh api graphql request that cannot be read (its body comes from a file or standard input)";
  }
  for (const { filled, value } of fields) {
    if (!value.startsWith("query=")) continue;
    const query = value.slice("query=".length);
    if (query.startsWith("@") || filled) {
      return "a gh api graphql request that cannot be read (its query comes from a file or the shell)";
    }
    if (!/\bmutation\b/i.test(query)) continue;
    // GraphQL ignores commas, comments and the byte order mark between tokens: read through them.
    const tokens = query.replace(/#[^\r\n]*|[,﻿]/g, " ");
    const named = [...tokens.matchAll(/\b([A-Za-z_]\w*)\s*\(\s*input\s*:/g)].map((one) => one[1]);
    const issueWrites = named.filter(
      (name) => name !== undefined && !PULL_REQUEST_MUTATIONS.has(name),
    );
    if (named.length > 0 && issueWrites.length === 0) continue;
    return issueWrites.length > 0
      ? `a gh api graphql mutation (${[...new Set(issueWrites)].join(", ")})`
      : "a gh api graphql mutation";
  }
  return null;
}

/**
 * What a `gh api …` call writes to the issues or labels, named; null when it writes none.
 * `isFilled`: the shell fills in this word (`RunInvocation.filled`); a value counts as text the
 * guard cannot read only when the word it came from is one.
 */
function apiIssueWrite(rest: readonly string[], isFilled: FillTest): string | null {
  const fields: ApiText[] = [];
  let endpoint: ApiText | null = null;
  let body = false;
  let method: ApiText | null = null;
  /** `value`, taken out of `word`: filled when `word` is. */
  const from = (word: string, value: string): ApiText => ({ filled: isFilled(word), value });
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      const after = rest[index + 1];
      if (endpoint === null && after !== undefined) endpoint = from(after, after);
      break;
    }
    if (word === "-h" || word === "--help") return null;
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      // A flag this reader does not know is the merge reader's refusal already (`apiCalls`).
      if (!API_VALUE_FLAGS.has(name) && !API_PLAIN_FLAGS.has(name)) return null;
      if (name === "--input") body = true;
      // The value is the next word, or what follows the `=` of this one.
      const source = at === -1 ? (rest[index + 1] ?? "") : word;
      const value = at === -1 ? source : word.slice(at + 1);
      if (name === "--method") method = from(source, value);
      if (name === "--field" || name === "--raw-field") fields.push(from(source, value));
      if (at === -1 && API_VALUE_FLAGS.has(name)) index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, value: attached, wantsNext } = shortFlags(word, API_VALUE_LETTERS);
      const letter = flags.slice(-1);
      if (letter === "" || !API_VALUE_LETTERS.includes(letter)) continue;
      const source = wantsNext ? (rest[index + 1] ?? "") : word;
      const value = wantsNext ? source : attached;
      if (wantsNext) index += 1;
      if (letter === "f" || letter === "F") fields.push(from(source, value));
      if (letter === "X") method = from(source, value);
      continue;
    }
    endpoint ??= from(word, word);
  }
  if (endpoint === null) return null;
  // gh sends GET, and POST once a parameter or a body is added (`gh api --help`).
  const used = (method?.value ?? (fields.length > 0 || body ? "POST" : "GET")).toUpperCase();
  // A method the shell fills in could be any of them: it is read as a write.
  if (!WRITE_METHODS.has(used) && method?.filled !== true) return null;
  // An endpoint the shell fills in cannot be read: the call may reach any issue or label.
  if (endpoint.filled) {
    return `a gh api ${used} to an endpoint that cannot be read (${endpoint.value})`;
  }
  if (isGraphql(endpoint.value)) return graphqlWrite(fields, body);
  const path = apiPath(endpoint.value);
  return ISSUES_PATH.test(path) ? `a gh api ${used} to ${path}` : null;
}

/**
 * True when `words[index]` is a help flag gh answers with usage and no work: `-h` or `--help`,
 * and NOT the value of the option before it (gh's flag library hands an option the next word
 * whatever it looks like: `--title -h` is a title). A help flag that follows another option is
 * read as that option's value, so the reader errs toward "a write".
 */
function isHelpAt(words: readonly string[], index: number): boolean {
  const word = words[index] ?? "";
  if (word !== "-h" && word !== "--help") return false;
  const before = words[index - 1] ?? "";
  return !(before.startsWith("-") && !before.includes("="));
}

/** What one reading of a line found: the writes, and the `gh` words that name no command. */
interface Reading {
  writes: string[];
  unnamed: string[];
}

/**
 * What a `gh <alias> …` writes: the alias is looked up in `aliases` (null: not read, so the
 * word is handed back), and its expansion is read like a `gh` line. `named`: the alias the
 * person typed, for the question's words when a chain of them is too long.
 */
function aliasWrite(
  word: string,
  rest: readonly string[],
  aliases: ReadonlyMap<string, string> | null,
  found: Reading,
  depth: number,
  named: string,
  isFilled: FillTest,
): string | null {
  const expansion = aliases?.get(word);
  if (expansion === undefined) {
    if (!found.unnamed.includes(word)) found.unnamed.push(word);
    return null;
  }
  if (expansion.startsWith("!")) {
    return `a gh alias that runs a shell command (\`gh ${named}\`)`;
  }
  if (depth >= MAX_NESTING) {
    return `a gh alias that expands to further commands (\`gh ${named}\`)`;
  }
  // The expansion is the person's own config, read by no shell of this line: a `$` in it is
  // gh's (`$1`) or a variable of its own, so its words fail closed by their text.
  const own = wordsOf(expansion);
  const filled: FillTest = (text) => (own.includes(text) && anyFill(text)) || isFilled(text);
  return ghIssueWrite([...own, ...rest], aliases, found, filled, depth + 1, named);
}

/** What a `gh …` invocation writes to the issues or labels, named; null when it writes none. */
function ghIssueWrite(
  args: readonly string[],
  aliases: ReadonlyMap<string, string> | null,
  found: Reading,
  isFilled: FillTest,
  depth = 0,
  named = "",
): string | null {
  // `--help` prints the usage and does nothing (before a `--`, as gh's own parser reads it).
  const dashes = args.indexOf("--");
  const words = dashes === -1 ? args : args.slice(0, dashes);
  if (words.some((_, index) => isHelpAt(words, index))) return null;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (word.startsWith("-")) {
      // Before the subcommand cobra strips the flags it may not know to find the command word
      // (`gh issue -t view create` runs `create`, with `view` as `-t`'s value): an option
      // without an `=` takes the next word, so that word is never read as the subcommand.
      if (!word.includes("=") && word !== "-h" && word !== "--help") index += 1;
      continue;
    }
    positional.push(word);
    if (positional.length === 1) {
      const command = word.toLowerCase();
      // `gh api` reads its own flags; the rest of the line is its.
      if (command === "api") return apiIssueWrite(args.slice(index + 1), isFilled);
      // A command the shell fills in (`gh "$CMD" create`) cannot be read: it may be any.
      if (isFilled(word)) return `a gh command the shell fills in (\`gh ${word}\`)`;
      // A word that names no gh command: one of the person's aliases, or an extension. gh's
      // commands are found in any case, its aliases only as typed.
      if (!GH_COMMANDS.has(command)) {
        const rest = args.slice(index + 1);
        const alias = named === "" ? word : named;
        return aliasWrite(word, rest, aliases, found, depth, alias, isFilled);
      }
      if (command !== "issue" && command !== "label") return null;
    }
    if (positional.length === 2) break;
  }
  const [group, sub] = positional;
  if (sub === undefined) return null;
  const name = sub.toLowerCase();
  if (group?.toLowerCase() === "label") {
    return LABEL_READS.has(name) ? null : `gh label ${name}`;
  }
  if (ISSUE_READS.has(name)) return null;
  // `gh issue develop --list` only lists the branches of an issue.
  if (name === "develop" && args.some((word) => word === "-l" || word === "--list")) return null;
  return `gh issue ${name}`;
}

/** Read a line once: every raw issue or label write, and the `gh` words that name no command. */
function readLine(
  command: string,
  dialect: Dialect | undefined,
  aliases: ReadonlyMap<string, string> | null,
): Reading {
  const found: Reading = { writes: [], unnamed: [] };
  for (const run of invocationsOf(command, dialect)) {
    if (run.computed || run.program !== "gh") continue;
    const write = ghIssueWrite(run.args, aliases, found, fillTest(run.filled));
    if (write !== null && !found.writes.includes(write)) found.writes.push(write);
  }
  return found;
}

/**
 * Every raw issue or label write a command line makes, named, in the order it runs them: `gh
 * issue close`, `a gh api PATCH to repos/o/r/issues/5`. `dialect`: the tool's; not given, both
 * are read. `aliases`: the person's `gh alias list` as name → expansion; not given, a `gh
 * <word>` is no write (`issueWritesWithAliases` hands the word back in `unnamed`).
 */
export function issueWrites(
  command: string,
  dialect?: Dialect,
  aliases: ReadonlyMap<string, string> | null = null,
): string[] {
  return readLine(command, dialect, aliases).writes;
}

/**
 * `issueWrites` with the person's gh aliases read when a `gh <word>` needs them, as the merge
 * reader does (`pullRequestCallsWithAliases`), and the words after `gh` that name no gh command
 * and no alias (`unnamed`: `gh dash`, an extension). `gh alias list` reads the local config, no
 * network, and `readAliases` runs only for a line with such a word (the caller passes one
 * `onceAliases` reader to this and to the pull request reader). A list that cannot be read
 * leaves the alias a write of its own — whether `gh <word>` writes is then unknown, and a guard
 * asks.
 */
export function issueWritesWithAliases(
  command: string,
  readAliases: AliasReader,
  dialect?: Dialect,
): Reading {
  const plain = readLine(command, dialect, null);
  if (plain.unnamed.length === 0) return plain;
  const aliases = readAliases();
  if (aliases === null) {
    const words = plain.unnamed.map((word) => `gh ${word}`).join(", ");
    return {
      writes: [...plain.writes, `a gh alias that cannot be read (${words})`],
      unnamed: plain.unnamed,
    };
  }
  return readLine(command, dialect, aliases);
}

/**
 * True when a command's program is worked out when it runs (`$GH`, `$(which gh)`) and its
 * words name an issue or a label (`issue`, `label`, a path with `/issues` or `/labels`): the
 * guard cannot tell whether it writes one, so it asks, like a computed merge.
 */
export function computedIssueRisk(command: string, dialect?: Dialect): boolean {
  return computedInvocationRisk(command, dialect, (words) =>
    words.some(
      (word) =>
        /(?:^|\/)(?:issue|label)s?(?:\/|$)/i.test(word) || /^(?:issue|label)s?$/i.test(word),
    ),
  );
}

/** Does the line write to GitHub's issues, or might it (a computed program)? */
export function requestsIssueWrite(command: string, dialect?: Dialect): boolean {
  return issueWrites(command, dialect).length > 0 || computedIssueRisk(command, dialect);
}
