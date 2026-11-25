/**
 * The claims signal (`cc-smart-dev-kit workflow claims`): the project's "one home" claims, and
 * the lines a diff adds that define a symbol such a claim names, in a file other than the claim's.
 *
 * A claim is a sentence in a tracked file that says one place owns a rule ("the one home for
 * prices is `formatPrice`"). A claim with no guard is a finding (`code-structure` § 11): this
 * command hands the claims to a reviewer, and shows where a diff writes a second definition of a
 * name a claim gives to one home. It judges nothing: a hit is a signal the reviewer reads, and the
 * command exits 0 whatever it finds.
 *
 * One `git grep` finds the claims and one `git diff` the added lines, so the cost is linear in
 * the size of the repository and the diff, never one git call per file.
 */
import { cappedHookList } from "../hooks/capped-list";
import { type GitRun, runGitRaw } from "../hooks/git";
import type { Env } from "../hooks/run";

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
 * from`) matches none of them: it defines nothing. The one home of the list.
 */
export const DEFINITION_FORMS: readonly RegExp[] = [
  /\bfunction\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\btype\s+([A-Za-z_$][\w$]*)/g,
  /\binterface\s+([A-Za-z_$][\w$]*)/g,
  /\bdef\s+([A-Za-z_$][\w$]*)/g,
  /\bfn\s+([A-Za-z_$][\w$]*)/g,
  /\bfunc\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=\s*\(/g,
];

/**
 * Paths a claim or a definition is never read from: lockfiles, dependency folders, build output
 * and generated bundles. Git pathspecs (`*` crosses `/`), so a folder matches at any depth.
 */
const SKIPPED_PATHS: readonly string[] = [
  "*.lock",
  "*.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "*.min.js",
  "*.map",
  "dist/*",
  "*/dist/*",
  "node_modules/*",
  "*/node_modules/*",
];

/** The pathspec that reads every tracked file but the skipped ones. */
const PATHSPEC = [".", ...SKIPPED_PATHS.map((path) => `:(exclude)${path}`)];

/** A name shorter than this is too common a word to treat as a symbol a claim names. */
const MIN_NAME_LENGTH = 3;

/** One call may read a large repository: longer than a rev-parse, still never a hang. */
const CLAIMS_GIT_TIMEOUT_MS = 30_000;

/** A backticked word that is an identifier, with or without call parentheses. */
const BACKTICKED_NAME = /`([A-Za-z_$][\w$]*)(?:\(\))?`/g;

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
    const lower = text.toLowerCase();
    const phrase = CLAIM_PHRASES.find((one) => lower.includes(one));
    if (phrase === undefined) continue;
    claims.push({ file, line: Number(line), phrase, names: namesIn(text) });
  }
  return claims;
}

/** The lines `git diff --unified=0` adds: each with its file and its line number in the new file. */
export function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | null = null;
  let next = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) {
      const path = text.slice(4).replace(/\t.*$/, "");
      file = path.startsWith("b/") ? path.slice(2) : null;
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) {
      next = Number(hunk[1]);
      continue;
    }
    if (file !== null && text.startsWith("+")) {
      added.push({ file, line: next, text: text.slice(1) });
      next += 1;
    }
  }
  return added;
}

/**
 * The added lines that define a name a claim gives to one home, in a file other than the
 * claim's own. One scan of each added line, whatever the number of claims.
 */
export function findHits(claims: readonly Claim[], added: readonly AddedLine[]): Hit[] {
  const claimed = new Map<string, Claim[]>();
  for (const claim of claims) {
    for (const name of claim.names) claimed.set(name, [...(claimed.get(name) ?? []), claim]);
  }
  const hits: Hit[] = [];
  for (const one of added) {
    const defined = new Set<string>();
    for (const form of DEFINITION_FORMS) {
      for (const match of one.text.matchAll(form)) {
        if (match[1] !== undefined) defined.add(match[1]);
      }
    }
    for (const name of defined) {
      const claim = claimed.get(name)?.find((candidate) => candidate.file !== one.file);
      if (claim !== undefined) {
        hits.push({
          file: one.file,
          line: one.line,
          name,
          claim: { file: claim.file, line: claim.line },
        });
      }
    }
  }
  return hits;
}

/** A failed git call as one sentence: git's own words, or that it timed out. */
function failure(run: GitRun): string {
  return run.err === "" ? `git exited with ${String(run.code)}` : run.err;
}

/**
 * The claims of the project in `folder`, and, when `base` names a ref, the lines `base...HEAD`
 * adds that define a symbol they name. A claims search that git cannot answer, or a diff it
 * cannot read, is a sentence in the report, never a throw: this is a signal.
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
  return { claims, hits: findHits(claims, parseAddedLines(diff.out)), diffWhy: null };
}

/**
 * The report as a person reads it: the claims, then what the diff re-defines. Each list stops at
 * the kit's usual cap and says how to read the rest (`rest`: the command that prints them all).
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
  const hitLine = (hit: Hit) =>
    `  ${hit.file}:${hit.line} defines ${hit.name}, which ${hit.claim.file}:${hit.claim.line} calls its one home`;
  if (report.hits.length > 0)
    lines.push(...cappedHookList(report.hits, hitLine, rest, "\n").split("\n"));
  return lines;
}
