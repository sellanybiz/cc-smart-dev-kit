/**
 * The claims signal (`cc-smart-dev-kit workflow claims`): the project's "one home" claims, and
 * the lines a diff adds that write a second definition of a symbol such a claim names.
 *
 * A claim is a sentence in a tracked file that says one place owns a rule ("the one home for
 * prices is `formatPrice`"). A claim with no guard is a finding (`code-structure` § 11): this
 * command hands the claims to a reviewer, and shows where a diff writes a second definition of a
 * name a claim gives to one home. A definition is a second one when, after the change, another
 * file defines the name too: an edit of the home's own line, a home moved to a new file and the
 * first definition of a new home are not. It judges nothing: a hit is a signal the reviewer reads,
 * and the command exits 0 whatever it finds.
 *
 * One `git grep` finds the claims, one `git diff` the added lines, and, only when the diff defines
 * a claimed name, one `git grep` at HEAD finds every file that defines those names. The cost is
 * linear in the size of the repository and the diff, never one git call per file.
 */
import { cappedHookList } from "../hooks/capped-list";
import { type GitRun, runGitRaw } from "../hooks/git";
import type { Env } from "../hooks/run";
import { GENERATED_ATTRIBUTE } from "../project/generated";

/**
 * The phrases that make a sentence a claim, lower case (`git grep -i` finds them in any case).
 * The one home of the list.
 */
export const CLAIM_PHRASES: readonly string[] = [
  "the one home",
  "the one place",
  "one place for",
  "the only place",
  "single source of truth",
  "one home for",
  "the one rule",
];

/**
 * The forms that define a symbol on an added line, one expression each, written for no language
 * in particular. Each has one capture group: the name it defines. A re-export (`export { X }
 * from`) matches none of them, and neither does a type-only import or re-export (`import type X`,
 * `import { type X }`, `export { type X } from`, or `  type X,` on a line of its own in a wrapped
 * one): they define nothing. The one home of the list.
 */
export const DEFINITION_FORMS: readonly RegExp[] = [
  /\bfunction\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  // A specifier is followed by `,`, `}`, `as` or the line's end; the name is never cut short.
  /(?<![{,]\s*|\bimport\s+)\btype\s+([A-Za-z_$][\w$]*)(?![\w$]|\s*(?:[,}]|$|as\b))/g,
  /\binterface\s+([A-Za-z_$][\w$]*)/g,
  /\bdef\s+([A-Za-z_$][\w$]*)/g,
  /\bfn\s+([A-Za-z_$][\w$]*)/g,
  /\bfunc\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=\s*\(/g,
];

/**
 * Folders of build output and installed dependencies, at any depth: no claim or definition is
 * read from one, and no slop audit area is made of one (`slop.ts`). The one home of the list.
 */
export const BUILD_OUTPUT_FOLDERS: readonly string[] = ["dist", "node_modules"];

/**
 * The kit's plan and research folders: they describe what was true then, so no claim or
 * definition is read from one, and no slop audit area is made of one (`slop.ts`). Named here, not
 * read from `plansFolders` (`hooks/plans-folders.ts`): that answers with real absolute paths, the
 * person's own plans folder outside the repository among them, and a pathspec takes neither.
 */
export const HISTORY_FOLDERS: readonly string[] = [".claude/plans", ".claude/research"];

/**
 * Paths a claim or a definition is never read from: lockfiles, build output, generated bundles,
 * and what describes the past. Git pathspecs (`*` crosses `/`), so a folder matches at any depth.
 */
const SKIPPED_PATHS: readonly string[] = [
  "*.lock",
  "*.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "*.min.js",
  "*.map",
  ...BUILD_OUTPUT_FOLDERS.flatMap((folder) => [`${folder}/*`, `*/${folder}/*`]),
  "CHANGELOG*",
  "*/CHANGELOG*",
  ...HISTORY_FOLDERS.map((folder) => `${folder}/*`),
];

/**
 * The files a project marks generated (`linguist-generated`, set or `true`): the mark the review
 * count leaves out too (`review-cover.ts`), read here as git's attribute pathspec.
 */
const GENERATED_PATHS: readonly string[] = [
  `:(exclude,attr:${GENERATED_ATTRIBUTE})`,
  `:(exclude,attr:${GENERATED_ATTRIBUTE}=true)`,
];

/**
 * Test files: a test that defines a claimed name builds a fixture, not a second home, and a claim
 * written in one is fixture text, not the project's own.
 */
const TEST_PATHS: readonly string[] = [
  "*.test.*",
  "*.spec.*",
  "*_test.*",
  "*_spec.*",
  "test_*.py",
  "*/test_*.py",
  "__tests__/*",
  "*/__tests__/*",
];

const excluded = (paths: readonly string[]) => paths.map((path) => `:(exclude)${path}`);

/** The pathspec of every git call here: every tracked file but the skipped, test and generated ones. */
const PATHSPEC = [".", ...excluded(SKIPPED_PATHS), ...excluded(TEST_PATHS), ...GENERATED_PATHS];

/** A name shorter than this is too common a word to treat as a symbol a claim names. */
const MIN_NAME_LENGTH = 3;

/** One call may read a large repository: longer than a rev-parse, still never a hang. */
const CLAIMS_GIT_TIMEOUT_MS = 30_000;

/** A claim phrase standing as whole words: "the one place" is not in "the one placeholder". */
const CLAIM_PHRASE = new RegExp(`\\b(?:${CLAIM_PHRASES.join("|")})\\b`, "i");

/** A backticked word that is an identifier, with or without call parentheses. */
const BACKTICKED_NAME = /`([A-Za-z_$][\w$]*)(?:\(\))?`/g;

/** A file of prose: a definition written in one is an example, never code, and no audit area. */
export const PROSE_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;

/** A line that is a comment in the common languages: its words are prose. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|--)/;

/** An indented `const`, `let` or `var` is a local variable inside a body, never a home. */
const LOCAL_BINDING = /^\s+(?:const|let|var)\s/;

/** The head of a `for (const x of …)` loop: its binding is a local, wherever the loop stands. */
const LOOP_HEAD = /\bfor\s*(?:await\s*)?\(\s*(?:const|let|var)\s+/g;

export interface Claim {
  file: string;
  line: number;
  phrase: string;
  names: string[];
}

export interface Hit {
  file: string;
  line: number;
  name: string;
  claim: { file: string; line: number };
}

export interface ClaimsReport {
  claims: Claim[];
  hits: Hit[];
  /** Why no diff was read; null when it was. */
  diffWhy: string | null;
}

/** Where the diff starts: a ref git can name, or the reason there is none. */
export type DiffBase = { ref: string } | { why: string };

/** One line a diff adds, with the file and the line number it has after the change. */
export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** The symbols a claim line names: its backticked identifiers, each once. */
function namesIn(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(BACKTICKED_NAME)) {
    const name = match[1];
    if (name !== undefined && name.length >= MIN_NAME_LENGTH) names.add(name);
  }
  return [...names];
}

/** The claims `git grep` printed (`-z -n`: `path NUL line NUL text`), one record a line. */
export function parseClaims(output: string): Claim[] {
  const claims: Claim[] = [];
  for (const record of output.split("\n")) {
    const [file, line, ...rest] = record.split("\0");
    if (file === undefined || line === undefined || rest.length === 0) continue;
    const text = rest.join("\0");
    const phrase = CLAIM_PHRASE.exec(text)?.[0].toLowerCase();
    if (phrase === undefined) continue;
    claims.push({ file, line: Number(line), phrase, names: namesIn(text) });
  }
  return claims;
}

/** The bytes git writes as a C-style escape in a quoted path, by the character after the backslash. */
const GIT_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

/**
 * A path git quoted in a diff header because it holds a double quote, a backslash or a control
 * character (`"b/a\"b.ts"`): the quotes taken off, each escape undone, an octal escape read as
 * one byte, and the bytes read as UTF-8.
 */
function unquoteGitPath(quoted: string): string {
  const bytes: number[] = [];
  for (const [, escaped, plain] of quoted.slice(1, -1).matchAll(/\\([0-7]{3}|.)|([^\\]+)/gs)) {
    if (plain !== undefined) bytes.push(...Buffer.from(plain, "utf8"));
    else if (escaped !== undefined && /^[0-7]{3}$/.test(escaped)) {
      bytes.push(Number.parseInt(escaped, 8));
    } else if (escaped !== undefined) bytes.push(GIT_ESCAPES[escaped] ?? escaped.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The lines `git diff --unified=0` adds: each with its file and its line number in the new file.
 * A hunk's header says how many lines it holds, and those are read as content, so an added line
 * that starts with `++ ` (`+++ ` in the diff) is never taken for a file header.
 */
export function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | null = null;
  let next = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const text of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith("+")) {
        if (file !== null) added.push({ file, line: next, text: text.slice(1) });
        next += 1;
        newLeft -= 1;
      } else if (text.startsWith("-")) oldLeft -= 1;
      else if (text.startsWith(" ")) {
        next += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (text.startsWith("+++ ")) {
      const header = text.slice(4).replace(/\t.*$/, "");
      const path = header.startsWith('"') ? unquoteGitPath(header) : header;
      file = path.startsWith("b/") ? path.slice(2) : null;
      continue;
    }
    // A count left out is 1 (`@@ -20 +22 @@`).
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk !== null) {
      oldLeft = Number(hunk[1] ?? 1);
      next = Number(hunk[2]);
      newLeft = Number(hunk[3] ?? 1);
    }
  }
  return added;
}

/**
 * The names line `text` of `file` defines (`DEFINITION_FORMS`). None in a prose file, a comment
 * line or a local binding (an indented `const`, `let` or `var`, or a loop's own variable).
 */
function definitionsIn(file: string, text: string): Set<string> {
  const names = new Set<string>();
  if (PROSE_FILE.test(file) || COMMENT_LINE.test(text) || LOCAL_BINDING.test(text)) return names;
  const code = text.replace(LOOP_HEAD, "for (");
  for (const form of DEFINITION_FORMS) {
    for (const match of code.matchAll(form)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

/**
 * The added lines that define a name a claim gives to one home, in a file other than the
 * claim's own. Each is a hit only when the name has a second home (`secondHomes`). One scan of
 * each added line, whatever the number of claims.
 */
export function claimedDefinitions(claims: readonly Claim[], added: readonly AddedLine[]): Hit[] {
  const claimed = new Map<string, Claim[]>();
  for (const claim of claims) {
    for (const name of claim.names) claimed.set(name, [...(claimed.get(name) ?? []), claim]);
  }
  const found: Hit[] = [];
  for (const one of added) {
    for (const name of definitionsIn(one.file, one.text)) {
      const claim = claimed.get(name)?.find((candidate) => candidate.file !== one.file);
      if (claim !== undefined) {
        found.push({
          file: one.file,
          line: one.line,
          name,
          claim: { file: claim.file, line: claim.line },
        });
      }
    }
  }
  return found;
}

/** The files that define each name after the change, as one `git grep` at HEAD found them. */
export type DefiningFiles = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The definitions whose name another file also defines after the change: a second home. An edit
 * of the home's own line, a home moved to another file and the first definition of a new home
 * have no other file; a definition beside the old home, or one the diff writes in two files, has.
 */
export function secondHomes(definitions: readonly Hit[], defining: DefiningFiles): Hit[] {
  return definitions.filter((one) =>
    [...(defining.get(one.name) ?? [])].some((file) => file !== one.file),
  );
}

/** A failed git call as one sentence: git's own words, or that it timed out. */
function failure(run: GitRun): string {
  return run.err === "" ? `git exited with ${String(run.code)}` : run.err;
}

/**
 * The claims of the project in `folder`, and, when `base` names a ref, the lines `base...HEAD`
 * adds that write a second home of a symbol they name. A diff git cannot read is a sentence in
 * the report, never a throw: this is a signal. A `git grep` that fails is the error it returns.
 */
export function collectClaims(
  folder: string,
  env: Env,
  base: DiffBase,
): ClaimsReport | { error: string } {
  const grep = runGitRaw(
    folder,
    [
      "grep",
      "-n",
      "-z",
      "-I",
      "-i",
      "-E",
      ...CLAIM_PHRASES.flatMap((phrase) => ["-e", phrase]),
      "--",
      ...PATHSPEC,
    ],
    env,
    CLAIMS_GIT_TIMEOUT_MS,
  );
  // git grep exits 1 when nothing matches: that is an answer, not a failure.
  if (!grep.ok && grep.code !== 1) return { error: `git grep failed: ${failure(grep)}` };
  const claims = parseClaims(grep.ok ? grep.out : "");
  if ("why" in base) return { claims, hits: [], diffWhy: base.why };
  const diff = runGitRaw(
    folder,
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      `${base.ref}...HEAD`,
      "--",
      ...PATHSPEC,
    ],
    env,
    CLAIMS_GIT_TIMEOUT_MS,
  );
  if (!diff.ok) {
    return { claims, hits: [], diffWhy: `git diff ${base.ref}...HEAD failed: ${failure(diff)}` };
  }
  const definitions = claimedDefinitions(claims, parseAddedLines(diff.out));
  if (definitions.length === 0) return { claims, hits: [], diffWhy: null };
  const defining = definingFiles(folder, env, new Set(definitions.map((one) => one.name)));
  if ("error" in defining) return defining;
  return { claims, hits: secondHomes(definitions, defining), diffWhy: null };
}

/** The prefix `git grep` puts before each path it finds in a commit's tree. */
const AT_HEAD = "HEAD:";

/**
 * The files that define each of `names` at HEAD, the commit the diff ends at: one `git grep` for
 * the names as whole words, each line it finds read with the same forms as an added line.
 */
function definingFiles(
  folder: string,
  env: Env,
  names: ReadonlySet<string>,
): DefiningFiles | { error: string } {
  const grep = runGitRaw(
    folder,
    [
      "grep",
      "-z",
      "-I",
      "-w",
      "-F",
      ...[...names].flatMap((name) => ["-e", name]),
      "HEAD",
      "--",
      ...PATHSPEC,
    ],
    env,
    CLAIMS_GIT_TIMEOUT_MS,
  );
  if (!grep.ok && grep.code !== 1) {
    return { error: `git grep for the claimed names at HEAD failed: ${failure(grep)}` };
  }
  const defining = new Map<string, Set<string>>();
  for (const record of grep.ok ? grep.out.split("\n") : []) {
    const at = record.indexOf("\0");
    if (at === -1) continue;
    const file = record.slice(AT_HEAD.length, at);
    for (const name of definitionsIn(file, record.slice(at + 1))) {
      if (names.has(name)) defining.set(name, (defining.get(name) ?? new Set()).add(file));
    }
  }
  return defining;
}

/**
 * The report as a person reads it: the claims, then what the diff re-defines. The claims stop at
 * the kit's usual cap and say how to read the rest (`rest`: the command that prints them all).
 * The hits are never cut: a reviewer reads this output and is told not to run the command.
 */
export function claimsLines(report: ClaimsReport, rest: string): string[] {
  const lines = [`Claims (${report.claims.length}):`];
  const claimLine = (claim: Claim) =>
    `  ${claim.file}:${claim.line} — ${claim.phrase} — names: ${claim.names.length === 0 ? "none" : claim.names.join(", ")}`;
  if (report.claims.length > 0) {
    lines.push(...cappedHookList(report.claims, claimLine, rest, "\n").split("\n"));
  }
  if (report.diffWhy !== null) {
    lines.push(`No diff was read: ${report.diffWhy}`);
    return lines;
  }
  lines.push(`Re-defined in this diff (${report.hits.length}):`);
  for (const hit of report.hits) {
    lines.push(
      `  ${hit.file}:${hit.line} defines ${hit.name}, which ${hit.claim.file}:${hit.claim.line} calls its one home`,
    );
  }
  return lines;
}
