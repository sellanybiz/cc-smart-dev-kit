/**
 * The eval harness's SessionStart hook: it puts the kit's general instructions into an eval
 * session, as `setup`'s import line in `~/.claude/CLAUDE.md` does on a real machine.
 *
 * Why a hook: an eval run loads no CLAUDE.md at all, not even one a scaffold script writes
 * (code.claude.com/docs/en/plugin-evals, "How runs are isolated"). A plugin's hooks do run,
 * so this test-only plugin (`evals/harness/.claude-plugin/plugin.json`) prints the text instead.
 *
 * Why parts: Claude Code caps one hook's output at 10,000 characters and puts a longer one in
 * a file Claude is not asked to read (code.claude.com/docs/en/hooks, "Add context for
 * Claude"). So the text is split at its `## ` headings into parts under that cap, and each of
 * the HOOK_PARTS hooks in `evals/harness/hooks/hooks.json` prints one part.
 *
 * A case adds an opt-in file (`plugin/instructions/optin/<name>.md`) with the environment
 * variable EVAL_KIT_OPTIN, a comma list of names, set in its case.yaml `execution.env`.
 *
 *   bun evals/harness/load-instructions.ts <part number, from 1>
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN } from "../../src/build-info/names";

/** The hooks in `evals/harness/hooks/hooks.json`; each prints the part with its number. */
export const HOOK_PARTS = 4;
/** The longest part, header included: under Claude Code's 10,000-character cap, with room. */
export const PART_LIMIT = 9_000;
/** A line Claude sees when the harness could not load what it should; the cases grade it. */
export const HARNESS_ERROR = "EVAL HARNESS ERROR";

/** The copy under test that `evals/run.ts` builds, so `--without core` reaches this hook too. */
const INSTRUCTIONS = join(import.meta.dir, "..", ".under-test", "plugin", "instructions");

export interface Source {
  /** How a real session names the file it loaded. */
  label: string;
  text: string;
}

/** Splits `text` into blocks, each starting at a line that matches `start` (or at the top). */
function splitAt(text: string, start: RegExp): string[] {
  const lines = text.split(/(?<=\n)/);
  const blocks: string[] = [];
  for (const line of lines) {
    const last = blocks.length - 1;
    if (last < 0 || start.test(line)) blocks.push(line);
    else blocks[last] += line;
  }
  return blocks;
}

/** Packs blocks into chunks of at most `limit` characters, in order. */
function pack(blocks: string[], limit: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (current !== "" && current.length + block.length > limit) {
      chunks.push(current);
      current = "";
    }
    current += block;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

/**
 * Splits `text` into chunks of at most `limit` characters that join back to the same text:
 * at `## ` headings first, a section still too long at its blank lines, and a paragraph still
 * too long at the limit itself.
 */
export function splitText(text: string, limit: number): string[] {
  const blocks = splitAt(text, /^## /).flatMap((section) => {
    if (section.length <= limit) return [section];
    return pack(splitAt(section, /^\s*$/), limit).flatMap((piece) => {
      if (piece.length <= limit) return [piece];
      const hard: string[] = [];
      for (let at = 0; at < piece.length; at += limit) hard.push(piece.slice(at, at + limit));
      return hard;
    });
  });
  return pack(blocks, limit);
}

/** Every part the hooks print, in order: each source split, with the header a session shows. */
export function buildParts(sources: Source[]): string[] {
  return sources.flatMap((source) => {
    const header = (index: number, total: number) =>
      `Contents of ${source.label}${total > 1 ? `, part ${index} of ${total}` : ""}:\n\n`;
    const room = PART_LIMIT - header(9, 9).length;
    const chunks = splitText(source.text, room);
    return chunks.map((chunk, index) => header(index + 1, chunks.length) + chunk);
  });
}

/** What hook `part` (from 1) prints: its part, an error line past the last hook, or nothing. */
export function partOutput(parts: string[], part: number): string {
  if (part === HOOK_PARTS && parts.length > HOOK_PARTS) {
    return `${HARNESS_ERROR}: the instructions need ${parts.length} parts, and only ${HOOK_PARTS} hooks print them. Add hooks to evals/harness/hooks/hooks.json.`;
  }
  return parts[part - 1] ?? "";
}

/** The sources a session gets: core.md, then each opt-in file the case names. */
export function readSources(optIn: string | undefined, folder = INSTRUCTIONS): Source[] {
  const sources: Source[] = [
    {
      label: `~/.claude/${PLUGIN}/instructions/core.md (user's private global instructions for all projects)`,
      text: readFileSync(join(folder, "core.md"), "utf8"),
    },
  ];
  for (const name of (optIn ?? "").split(",").map((item) => item.trim())) {
    if (name === "") continue;
    const file = join(folder, "optin", `${name}.md`);
    if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) {
      throw new Error(`EVAL_KIT_OPTIN names "${name}", which is not a file in optin/`);
    }
    sources.push({
      label: `~/.claude/${PLUGIN}/instructions/optin/${name}.md (project instructions, checked into the codebase)`,
      text: readFileSync(file, "utf8"),
    });
  }
  return sources;
}

if (import.meta.main) {
  const part = Number(process.argv[2]);
  if (!Number.isInteger(part) || part < 1 || part > HOOK_PARTS) {
    console.error(`load-instructions: the part must be a number from 1 to ${HOOK_PARTS}`);
    process.exit(1);
  }
  let output: string;
  try {
    output = partOutput(buildParts(readSources(process.env.EVAL_KIT_OPTIN)), part);
  } catch (error) {
    // Claude never sees a SessionStart hook's stderr, so the first part says it instead.
    const reason = error instanceof Error ? error.message : String(error);
    output = part === 1 ? `${HARNESS_ERROR}: ${reason}` : "";
  }
  if (output !== "") process.stdout.write(output);
}
