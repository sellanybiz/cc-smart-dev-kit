/**
 * Changing a JSON file the person (or their formatter) lays out, without laying it out again.
 *
 * `JSON.stringify(data, null, indent)` rewrites every line: `["main"]` becomes three lines, and
 * a project that format-checks its `.claude/` JSON (Biome, Prettier) then fails its own checks.
 * `editJsonText` instead compares the file's object with the object wanted and edits only the
 * text of what differs: a changed value is replaced, a new key is added after the last one, a
 * removed key goes with its line and its comma. Every other byte stays.
 *
 * What it prints new follows Biome and Prettier: a short array of scalars on one line when it
 * fits the line width, otherwise one item per line; an object with its keys on their own lines;
 * `{}` and `[]` empty. The indent is the file's own (`detectIndent`).
 *
 * The text must be a JSON object that `JSON.parse` accepts (no comments, no trailing commas):
 * `readJsonObject` has refused anything else before a writer gets here. The one home of this,
 * so `workflow set`, `workflow unset` and `project init` lay a file out the same way.
 */
import { detectIndent } from "./managed-json";
import { withoutBom } from "./user-json";

type JsonObject = Record<string, unknown>;

/** Biome's and Prettier's default; a file with a longer line shows it is formatted wider. */
const DEFAULT_LINE_WIDTH = 80;
/** Past this, a long line is a long string, not a sign of the formatter's width. */
const MAX_LINE_WIDTH = 120;
/** What a tab counts for in a column: Biome's default `indentWidth`. */
const TAB_COLUMNS = 2;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The columns a run of indentation takes. */
function columns(text: string): number {
  let width = 0;
  for (const char of text) width += char === "\t" ? TAB_COLUMNS : 1;
  return width;
}

/** The line width a file is formatted at, as far as its own lines show. */
function lineWidthOf(text: string): number {
  const longest = Math.max(0, ...text.split("\n").map((line) => columns(line.replace(/\r$/, ""))));
  return Math.min(MAX_LINE_WIDTH, Math.max(DEFAULT_LINE_WIDTH, longest));
}

interface Layout {
  unit: string;
  width: number;
  eol: string;
}

/** A value as the formatters print it, at `indent` (the indent of the line it starts on). */
function printValue(
  value: unknown,
  layout: Layout,
  indent: string,
  column: number,
  trailing: number,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const scalars = value.every((item) => !Array.isArray(item) && !isObject(item));
    if (scalars) {
      const flat = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (column + flat.length + trailing <= layout.width) return flat;
    }
    const inner = indent + layout.unit;
    const items = value.map((item, index) => {
      const last = index === value.length - 1;
      return `${inner}${printValue(item, layout, inner, columns(inner), last ? 0 : 1)}${last ? "" : ","}`;
    });
    return `[${layout.eol}${items.join(layout.eol)}${layout.eol}${indent}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return "{}";
    const inner = indent + layout.unit;
    const members = entries.map(([key, item], index) => {
      const last = index === entries.length - 1;
      return `${inner}${printMember(key, item, layout, inner, last ? 0 : 1)}${last ? "" : ","}`;
    });
    return `{${layout.eol}${members.join(layout.eol)}${layout.eol}${indent}}`;
  }
  return JSON.stringify(value);
}

/** `"key": value`, the value laid out for the column it starts at. */
function printMember(
  key: string,
  value: unknown,
  layout: Layout,
  indent: string,
  trailing: number,
): string {
  const head = `${JSON.stringify(key)}: `;
  return `${head}${printValue(value, layout, indent, columns(indent) + head.length, trailing)}`;
}

/**
 * A whole JSON file as the formatters would print it: for a file that does not exist yet, so
 * even a new file passes the project's format check. Ends with a newline.
 */
export function printJson(value: JsonObject, unit = "  ", width = DEFAULT_LINE_WIDTH): string {
  return `${printValue(value, { unit, width, eol: "\n" }, "", 0, 0)}\n`;
}

// --- Reading the places in the text ---

interface Member {
  key: string;
  keyStart: number;
  value: Node;
}

interface Node {
  start: number;
  end: number;
  /** The members of an object; `undefined` for any other value. */
  members?: Member[];
}

/** A small reader of text that is already valid JSON: it only has to find where things are. */
class Scanner {
  private at = 0;

  constructor(private readonly text: string) {}

  node(): Node {
    this.skipSpace();
    const start = this.at;
    const char = this.text[start];
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char === '"') this.string();
    else
      while (this.at < this.text.length && !/[\s,\]}]/.test(this.text[this.at] ?? "")) this.at += 1;
    return { start, end: this.at };
  }

  private object(): Node {
    const start = this.at;
    const members: Member[] = [];
    this.at += 1;
    for (;;) {
      this.skipSpace();
      if (this.text[this.at] === "}") break;
      if (this.text[this.at] === ",") {
        this.at += 1;
        continue;
      }
      const keyStart = this.at;
      this.string();
      const key = JSON.parse(this.text.slice(keyStart, this.at)) as string;
      this.skipSpace();
      this.at += 1; // the colon
      members.push({ key, keyStart, value: this.node() });
    }
    this.at += 1;
    return { start, end: this.at, members };
  }

  private array(): Node {
    const start = this.at;
    this.at += 1;
    for (;;) {
      this.skipSpace();
      if (this.text[this.at] === "]") break;
      if (this.text[this.at] === ",") this.at += 1;
      else this.node();
    }
    this.at += 1;
    return { start, end: this.at };
  }

  private string(): void {
    this.at += 1;
    while (this.text[this.at] !== '"') this.at += this.text[this.at] === "\\" ? 2 : 1;
    this.at += 1;
  }

  private skipSpace(): void {
    while (/\s/.test(this.text[this.at] ?? "x")) this.at += 1;
  }
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** The indentation of the line `position` is on. */
function lineIndent(text: string, position: number): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

/** The columns from the start of the line to `position`. */
function columnOf(text: string, position: number): number {
  return columns(text.slice(text.lastIndexOf("\n", position - 1) + 1, position));
}

/** The edits that turn the object at `node` into `after`; `before` is what the text holds. */
function editObject(
  text: string,
  node: Node,
  before: JsonObject,
  after: JsonObject,
  layout: Layout,
  edits: Edit[],
): void {
  const members = node.members ?? [];
  const last = (key: string): Member | undefined => members.findLast((m) => m.key === key);
  const wanted = (key: string): boolean => Object.hasOwn(after, key) && after[key] !== undefined;
  const closeAt = node.end - 1;
  const survivors = members.filter((member) => wanted(member.key));

  // Keys whose value changed: the value's text is replaced, or the object inside is edited.
  for (const key of Object.keys(before)) {
    if (!wanted(key)) continue;
    const member = last(key);
    if (member === undefined) continue;
    const was = before[key];
    const is = after[key];
    if (Bun.deepEquals(was, is, true)) continue;
    if (isObject(was) && isObject(is) && member.value.members !== undefined) {
      editObject(text, member.value, was, is, layout, edits);
      continue;
    }
    const indent = lineIndent(text, member.keyStart);
    const followed = text.slice(member.value.end).match(/^\s*,/) !== null;
    edits.push({
      start: member.value.start,
      end: member.value.end,
      text: printValue(is, layout, indent, columnOf(text, member.value.start), followed ? 1 : 0),
    });
  }

  const added = Object.keys(after).filter(
    (key) => after[key] !== undefined && !Object.hasOwn(before, key),
  );
  const indent = lineIndent(text, node.start);
  const expanded = text.slice(node.start, node.end).includes("\n");
  const memberIndent =
    survivors.length > 0 && expanded
      ? lineIndent(text, (survivors[0] as Member).keyStart)
      : indent + layout.unit;
  const printed = added.map((key, index) =>
    printMember(key, after[key], layout, memberIndent, index === added.length - 1 ? 0 : 1),
  );

  // Nothing of the object stays: its inside is cut out, and only the new keys go in.
  if (survivors.length === 0) {
    if (members.length === 0 && added.length === 0) return;
    const inside =
      printed.length === 0
        ? ""
        : `${layout.eol}${printed.map((line) => memberIndent + line).join(`,${layout.eol}`)}${layout.eol}${indent}`;
    edits.push({ start: node.start + 1, end: closeAt, text: inside });
    return;
  }

  // Removed keys: a key with a later survivor goes up to the next key; the keys after the
  // last survivor go from the survivor's end (so its trailing comma goes with them).
  const lastSurvivor = survivors[survivors.length - 1] as Member;
  let tailRemoved = false;
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index] as Member;
    if (wanted(member.key)) continue;
    if (member.keyStart < lastSurvivor.keyStart) {
      const next = members[index + 1] as Member;
      edits.push({ start: member.keyStart, end: next.keyStart, text: "" });
    } else tailRemoved = true;
  }
  const tail = members[members.length - 1] as Member;
  if (tailRemoved) {
    edits.push({ start: lastSurvivor.value.end, end: tail.value.end, text: "" });
  }

  if (added.length > 0) {
    const at = tail.value.end;
    const inserted = expanded
      ? printed.map((line) => `,${layout.eol}${memberIndent}${line}`).join("")
      : printed.map((line) => `, ${line}`).join("");
    edits.push({ start: at, end: at, text: inserted });
  }
}

/**
 * `text` with its JSON object changed to `after`, and nothing else touched. Returns `text`
 * itself when the object already equals `after` (key order does not count). A byte order mark
 * is dropped, as every writer does. Throws when `text` is not a JSON object.
 */
export function editJsonText(text: string, after: JsonObject): string {
  const source = withoutBom(text);
  const before: unknown = JSON.parse(source);
  if (!isObject(before)) throw new Error("editJsonText: the text is not a JSON object");
  if (Bun.deepEquals(before, after, true) && source === text) return text;
  const layout: Layout = {
    unit: detectIndent(source),
    width: lineWidthOf(source),
    eol: source.includes("\r\n") ? "\r\n" : "\n",
  };
  const root = new Scanner(source).node();
  const edits: Edit[] = [];
  editObject(source, root, before, after, layout, edits);
  // From the end of the text backwards, so an edit never moves the places of the ones before it.
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
