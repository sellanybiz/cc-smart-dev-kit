/**
 * The reader of a raw WRITE to GitHub's issues (decision D67), for the merge guard: `gh issue
 * create | edit | comment | close | reopen | delete | transfer | lock | pin | develop …`, and `gh
 * api` with POST, PATCH, PUT or DELETE to a repository's `issues` endpoints or a GraphQL query
 * that names an issue mutation. An issue is text that leaves the machine, so a session's own
 * write is the person's yes; the kit's way is `cc-smart-dev-kit issue file`, which is not a
 * `gh` command and is never read here. A crew session is denied (`merge-guard.ts`).
 *
 * Read with the one shell reader (`invocationsOf`, `src/shell/command.ts`): wrappers, `bash -c`
 * and the dialect of the tool are stepped through like every guard does. A read (`gh issue
 * list`, `view`, `status`, a GET) and `--help` are no write; a subcommand this reader does not
 * know counts as one (a guard fails closed). **Not read**, as for the merge guard: a `gh`
 * alias, a script file, `xargs`-style runners. The program of a line worked out when it runs
 * (`$GH issue create`) is a risk of its own (`computedIssueRisk`).
 */
import { type Dialect, invocationsOf, isShort, shortFlags } from "../shell/command";
import {
  API_PLAIN_FLAGS,
  API_VALUE_FLAGS,
  API_VALUE_LETTERS,
  computedInvocationRisk,
} from "./after-merge";

/** `gh issue` subcommands that only read (or print help). Every other subcommand writes. */
const ISSUE_READS: ReadonlySet<string> = new Set(["help", "list", "ls", "status", "view"]);

/** The methods that change something. */
const WRITE_METHODS: ReadonlySet<string> = new Set(["DELETE", "PATCH", "POST", "PUT"]);

/** `gh`'s own options that take a value, so a value is never read as the subcommand. */
const GH_VALUED: ReadonlySet<string> = new Set(["-R", "--repo", "--hostname"]);

/** A repository's issues endpoints: `repos/<o>/<r>/issues`, below it, or by repository id. */
const ISSUES_PATH = /^(?:repos\/[^/]+\/[^/]+|repositories\/[^/]+)\/issues(?:\/.*)?$/i;

/** The GraphQL mutations that write an issue, a comment on one, or its labels. */
const ISSUE_MUTATION =
  /\b(?:createIssue|updateIssue|deleteIssue|closeIssue|reopenIssue|transferIssue|pinIssue|unpinIssue|addComment|updateIssueComment|deleteIssueComment|lockLockable|unlockLockable|addLabelsToLabelable|removeLabelsFromLabelable)\b/;

/** The endpoint as a path: no host, no query, no outer slashes. */
function apiPath(endpoint: string): string {
  return endpoint
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
}

/** Does the endpoint reach GitHub's GraphQL API? */
function isGraphql(endpoint: string): boolean {
  const path = apiPath(endpoint).toLowerCase();
  return path === "graphql" || path.endsWith("/graphql");
}

/** What a `gh api …` call writes to the issues, named; null when it writes none. */
function apiIssueWrite(rest: readonly string[]): string | null {
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
    if (word === "-h" || word === "--help") return null;
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      // A flag this reader does not know is the merge reader's refusal already (`apiCalls`).
      if (!API_VALUE_FLAGS.has(name) && !API_PLAIN_FLAGS.has(name)) return null;
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
  if (endpoint === null) return null;
  if (isGraphql(endpoint)) {
    for (const field of fields) {
      if (!field.startsWith("query=")) continue;
      const mutation = ISSUE_MUTATION.exec(field)?.[0];
      if (mutation !== undefined) return `a gh api graphql mutation (${mutation})`;
    }
    return null;
  }
  // gh sends GET, and POST once a parameter or a body is added (`gh api --help`).
  const used = (method ?? (fields.length > 0 || body ? "POST" : "GET")).toUpperCase();
  const path = apiPath(endpoint);
  return WRITE_METHODS.has(used) && ISSUES_PATH.test(path) ? `a gh api ${used} to ${path}` : null;
}

/** What a `gh …` invocation writes to the issues, named; null when it writes none. */
function ghIssueWrite(args: readonly string[]): string | null {
  // `--help` prints the usage and does nothing (before a `--`, as gh's own parser reads it).
  const dashes = args.indexOf("--");
  if ((dashes === -1 ? args : args.slice(0, dashes)).some((w) => w === "-h" || w === "--help")) {
    return null;
  }
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (word.startsWith("-")) {
      if (!word.includes("=") && GH_VALUED.has(word)) index += 1;
      continue;
    }
    positional.push(word);
    // `gh api` reads its own flags; the rest of the line is its.
    if (positional[0] === "api") return apiIssueWrite(args.slice(index + 1));
    if (positional.length === 2) break;
  }
  const [group, sub] = positional;
  if (group !== "issue" || sub === undefined) return null;
  const name = sub.toLowerCase();
  if (ISSUE_READS.has(name)) return null;
  // `gh issue develop --list` only lists the branches of an issue.
  if (name === "develop" && args.some((word) => word === "-l" || word === "--list")) return null;
  return `gh issue ${name}`;
}

/**
 * Every raw issue write a command line makes, named, in the order it runs them: `gh issue
 * close`, `a gh api PATCH to repos/o/r/issues/5`. `dialect`: the tool's; not given, both are
 * read.
 */
export function issueWrites(command: string, dialect?: Dialect): string[] {
  const found: string[] = [];
  for (const run of invocationsOf(command, dialect)) {
    if (run.program !== "gh" || run.computed) continue;
    const write = ghIssueWrite(run.args);
    if (write !== null && !found.includes(write)) found.push(write);
  }
  return found;
}

/**
 * True when a command's program is worked out when it runs (`$GH`, `$(which gh)`) and its
 * words name an issue (`issue`, a path with `/issues`): the guard cannot tell whether it
 * writes one, so it asks (a crew session: denied), like a computed merge.
 */
export function computedIssueRisk(command: string, dialect?: Dialect): boolean {
  return computedInvocationRisk(command, dialect, (words) =>
    words.some((word) => /(?:^|\/)issues?(?:\/|$)/i.test(word) || /^issues?$/i.test(word)),
  );
}

/** Does the line write to GitHub's issues, or might it (a computed program)? */
export function requestsIssueWrite(command: string, dialect?: Dialect): boolean {
  return issueWrites(command, dialect).length > 0 || computedIssueRisk(command, dialect);
}
