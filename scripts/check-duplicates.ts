/**
 * One home per rule: fails when the same sentence of 12 or more words appears in two
 * different files of the plugin's instructions, skills, agents or output styles. A rule said
 * twice drifts: one copy gets fixed, the other keeps teaching the old thing.
 *
 *   bun scripts/check-duplicates.ts
 *
 * Sentences are compared after normalizing: lower case, markdown marks removed, whitespace
 * collapsed. Fenced code blocks are skipped (examples, not rules). A deliberate shared
 * sentence goes in `scripts/check-duplicates.allow.json`, with its reason; an entry that no
 * longer matches a duplicate fails too, so the list stays true.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The folders checked, relative to the repo root. */
export const CHECKED_FOLDERS = [
  "plugin/instructions",
  "plugin/skills",
  "plugin/agents",
  "plugin/output-styles",
];
export const ALLOW_FILE = "scripts/check-duplicates.allow.json";
export const MIN_WORDS = 12;

export interface SourceFile {
  /** The path shown in messages, relative to the repo root. */
  path: string;
  text: string;
}

export interface AllowEntry {
  sentence: string;
  reason: string;
}

export interface DuplicatesResult {
  /** Each duplicated sentence (normalized), with the files it appears in. */
  duplicates: { sentence: string; files: string[] }[];
  /** Allow-list entries that match no duplicate any more. */
  stale: string[];
}

/** Lower case, no markdown marks, one space between words. */
export function normalize(sentence: string): string {
  return sentence
    .replace(/[`*_#>|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A line that starts a new block: a heading, a list item, a table row, a quote. */
const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/;

/** The sentences of a markdown text, outside fenced code blocks. */
export function sentences(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    if (current.length > 0) blocks.push(current.join(" "));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (BLOCK_START.test(line)) flush();
    current.push(line.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
  }
  flush();
  return blocks.flatMap((block) => block.split(/(?<=[.!?])\s+|\s+\|\s+/));
}

/** Every sentence of `MIN_WORDS` or more words found in two or more different files. */
export function findDuplicates(files: SourceFile[], allow: AllowEntry[]): DuplicatesResult {
  const seen = new Map<string, Set<string>>();
  for (const file of files) {
    for (const raw of sentences(file.text)) {
      const sentence = normalize(raw);
      if (sentence.split(" ").length < MIN_WORDS) continue;
      const where = seen.get(sentence) ?? new Set<string>();
      where.add(file.path);
      seen.set(sentence, where);
    }
  }
  const allowed = new Set(allow.map((entry) => normalize(entry.sentence)));
  const shared = [...seen].filter(([, where]) => where.size > 1);
  return {
    duplicates: shared
      .filter(([sentence]) => !allowed.has(sentence))
      .map(([sentence, where]) => ({ sentence, files: [...where].sort() }))
      .sort((a, b) => (a.sentence < b.sentence ? -1 : 1)),
    stale: [...allowed].filter((sentence) => !shared.some(([s]) => s === sentence)),
  };
}

/** Every `.md` file under the checked folders, with paths relative to `root`. */
export function readSourceFiles(root: string): SourceFile[] {
  return CHECKED_FOLDERS.filter((folder) => existsSync(join(root, folder)))
    .flatMap((folder) =>
      readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => join(entry.parentPath, entry.name)),
    )
    .sort()
    .map((file) => ({
      path: relative(root, file).split(sep).join("/"),
      text: readFileSync(file, "utf8"),
    }));
}

/** The allow-list; every entry needs a sentence and a reason. */
export function readAllowList(root: string): AllowEntry[] {
  const file = join(root, ALLOW_FILE);
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const entries = (parsed as { allowed?: unknown } | null)?.allowed;
  if (
    !Array.isArray(entries) ||
    !entries.every(
      (entry) =>
        typeof entry?.sentence === "string" &&
        typeof entry?.reason === "string" &&
        entry.reason.trim() !== "",
    )
  ) {
    throw new Error(`${ALLOW_FILE}: expected { "allowed": [{ "sentence", "reason" }] }`);
  }
  return entries as AllowEntry[];
}

/** The messages for a result; empty when it passes. */
export function report(result: DuplicatesResult): string[] {
  return [
    ...result.duplicates.map(
      (dup) => `The same sentence in ${dup.files.join(" and ")}:\n  "${dup.sentence}"`,
    ),
    ...result.stale.map(
      (sentence) => `${ALLOW_FILE}: this entry matches no duplicate any more:\n  "${sentence}"`,
    ),
  ];
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const result = findDuplicates(readSourceFiles(root), readAllowList(root));
  const messages = report(result);
  if (messages.length > 0) {
    console.error(messages.join("\n"));
    console.error(
      "One home per rule: keep the sentence in one file and point to it from the others " +
        `(or, when the repeat is on purpose, add it to ${ALLOW_FILE} with its reason).`,
    );
    process.exitCode = 1;
  } else {
    console.log("One home per rule: no sentence repeats across the plugin's instructions.");
  }
}
