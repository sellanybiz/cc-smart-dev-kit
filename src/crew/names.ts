/**
 * Session names: the clean title every session's name goes through, and the names that show a
 * lead's or a crew session's role (the owner's ask; the scheme is decision D26):
 *
 *   LEAD <tag> <plan>                 the lead of one plan
 *   C <tag> <plan> <phase> <slug>     one crew phase; a hand-off's next crew session adds ` 2`, ` 3`
 *
 * Agent view has no parent link and no grouping by lead, so the name is how a person (and the
 * portal) groups them. **Role, tag and the lead's plan come first**, so a list that cuts a
 * name still shows whose crew session it is: `C <tag>` always fits in `NAME_VIEW` characters,
 * and the whole name in `MAX_SESSION_NAME` — the plan is cut at `MAX_CREW_PLAN` so the phase
 * always fits whole, and the slug is what a long name loses. **ASCII only, no brackets or
 * quotes**, so a name is safe in a title bar, a shell line and a file name, and it **never ends
 * in `]`**: the message guard reads a trailing ` [ref]` as the one ListAgents prints after a
 * name and drops it (`withoutListRef`), so a name of ours that ended in `]` would not match
 * itself there. State never goes into a name: the name is the address.
 *
 * A crew record keeps the name it was given: one written by 1.1.1 or earlier says
 * `C <tag> <phase> <slug>`, and both shapes are read (`roleOf` recognises each).
 *
 * `<tag>` names the repository: the main checkout's folder name, or `workflow.crew.tag` when
 * the person sets one (`crewTag`). One home for these rules: the launcher, the session-name
 * hook and the workflow schema all read them here.
 */

import { basename } from "node:path";

/** The longest name kept: a tab, a ListAgents row and a /resume line stay readable. */
export const MAX_SESSION_NAME = 60;

/**
 * The start of a name a narrow list shows (agent view's name column, a tab): the role and the
 * tag always fit in it, and usually the lead's plan after them. The width agent view really
 * shows is not proved live yet; until it is, this is the plan's number.
 */
export const NAME_VIEW = 24;

/** The longest tag: `C <tag>` stays inside `NAME_VIEW`. */
export const MAX_TAG = 12;

/**
 * The longest plan a crew session's name carries. With the longest tag and phase the name still
 * fits `MAX_SESSION_NAME` with room for the slug and its hand-off number, so a long plan never
 * crowds out the phase.
 */
export const MAX_CREW_PLAN = 16;

/**
 * The longest phase (`K`, `W1a`, `D17b`, `E1a-E1b`): always whole in a name, whatever the tag
 * and the plan are, because both are cut to their own limit first.
 */
export const MAX_PHASE = 8;

/**
 * The longest slug a crew session's branch and worktree carry (`crew/<phase>-<slug>`,
 * `crew-<phase>-<slug>`): with the longest phase it stays well inside a folder name, and in a
 * name the slug is the part that is cut, never the role or the phase.
 */
export const MAX_SLUG = 32;

/** The first word of a lead's name. */
export const LEAD_ROLE = "LEAD";

/** The first word of a crew session's name. */
export const CREW_ROLE = "C";

/**
 * The first part of a crew session's branch (`crew/<phase>-<slug>`) and of its worktree folder
 * (`crew-<phase>-<slug>`). One home: the launcher and the test world both read it.
 */
export const CREW_REF = "crew";

/** What a session's name says it is. */
export type SessionRole = "lead" | "crew";

/** A name that cannot be made: the message says which part, and why. */
export class SessionNameError extends Error {
  override name = "SessionNameError";
}

/**
 * A name fit to be a title: its first line, control characters and runs of spaces gone, at
 * most MAX_SESSION_NAME characters (counted as characters, so an emoji is never split).
 * Null when nothing is left. Claude Code writes the title into the terminal's title bar
 * with an escape sequence, so every control character goes, ESC and the C1 range included.
 */
export function cleanSessionName(raw: string): string | null {
  const firstLine = raw.split(/\r?\n|\r/)[0] ?? "";
  const plain = firstLine
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain === "") return null;
  return [...plain].slice(0, MAX_SESSION_NAME).join("").trimEnd();
}

/** The `.`, `_` and `-` a part may not start or end with. */
const EDGE_SEPARATORS = /^[._-]+|[._-]+$/g;

/**
 * One word of a name, from any text: accents dropped (`ü` → `u`), every character but an ASCII
 * letter, a digit, `.`, `_` and `-` made a `-`, no `--`, no `.`, `_` or `-` at either end, at
 * most `max` characters. Empty when nothing is left.
 */
export function namePart(raw: string, max: number): string {
  const plain = raw
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(EDGE_SEPARATORS, "");
  return plain.slice(0, Math.max(0, max)).replace(EDGE_SEPARATORS, "");
}

/** What a part of `max` characters may hold, in the words an error says it. */
function partRule(max: number): string {
  return `1-${max} characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"`;
}

/** The tag's rule, as `workflow.crew.tag` refuses a value with it. */
export const TAG_RULE = partRule(MAX_TAG);

/** True when `value` is a tag as written: already clean, at most `MAX_TAG` characters. */
export function isNameTag(value: string): boolean {
  return value !== "" && value.length <= MAX_TAG && namePart(value, MAX_TAG) === value;
}

/** True when `value` is a phase as written: already clean, at most `MAX_PHASE` characters. */
export function isPhase(value: string): boolean {
  return value !== "" && value.length <= MAX_PHASE && namePart(value, MAX_PHASE) === value;
}

/** The slug's rule, as `crew start` refuses a `--slug` with it. */
export const SLUG_RULE = partRule(MAX_SLUG);

/**
 * True when `value` is a slug as written: already clean, at most `MAX_SLUG` characters. Like a
 * phase, a slug is part of a crew session's identity (its branch and its worktree), so one that is not
 * clean is refused rather than changed.
 */
export function isSlug(value: string): boolean {
  return value !== "" && value.length <= MAX_SLUG && namePart(value, MAX_SLUG) === value;
}

/** The phase's rule, in the words a refusal says it. */
export const PHASE_RULE = partRule(MAX_PHASE);

/**
 * The tag of a repository's names: `configured` (`workflow.crew.tag`) when the person set
 * one, else the main checkout's folder name, made clean and short (`namePart`). Throws when
 * nothing is left of it, and says to set the tag.
 */
export function crewTag(mainCheckout: string, configured: null | string | undefined): string {
  const raw = configured ?? basename(mainCheckout);
  const tag = namePart(raw, MAX_TAG);
  if (tag === "") {
    throw new SessionNameError(
      `"${raw}" leaves no tag for a lead's or a crew session's name: set workflow.crew.tag (${TAG_RULE})`,
    );
  }
  return tag;
}

/** A part made clean, or the error that names it when nothing is left. */
function requiredPart(raw: string, max: number, what: string): string {
  const part = namePart(raw, max);
  if (part === "") {
    throw new SessionNameError(`the ${what} "${raw}" has no letter or digit a name can keep`);
  }
  return part;
}

/** The ` 2`, ` 3` a hand-off's next crew session carries; nothing for the first. */
function handoffSuffix(n: number | undefined): string {
  if (n === undefined || n === 1) return "";
  if (!Number.isInteger(n) || n < 2) {
    throw new SessionNameError(`a hand-off number is a whole number of 2 or more, not ${n}`);
  }
  return ` ${n}`;
}

/** `LEAD <tag> <plan>`: the plan is cut to fit `MAX_SESSION_NAME`. */
export function leadName(tag: string, plan: string): string {
  const head = `${LEAD_ROLE} ${requiredPart(tag, MAX_TAG, "tag")} `;
  return `${head}${requiredPart(plan, MAX_SESSION_NAME - head.length, "plan")}`;
}

/**
 * `C <tag> <plan> <phase> <slug>`, and ` <n>` for a hand-off's next crew session (`n` 2 or more).
 * The plan is the lead's (`leadName`), so the two names line up. The phase must already be clean
 * (`isPhase`): it is the crew session's identity, so it is refused rather than changed. The plan
 * is cut at `MAX_CREW_PLAN` so the phase always fits whole, and the slug is cut to what is left,
 * never the suffix, so two crew sessions of one phase never share a name.
 */
export function crewName(
  tag: string,
  plan: string,
  phase: string,
  slug: string,
  n?: number,
): string {
  const cleanTag = requiredPart(tag, MAX_TAG, "tag");
  const cleanPlan = requiredPart(plan, MAX_CREW_PLAN, "plan");
  if (!isPhase(phase)) {
    throw new SessionNameError(
      `the phase "${phase}" cannot be part of a name: a phase is ${PHASE_RULE}`,
    );
  }
  const suffix = handoffSuffix(n);
  const head = `${CREW_ROLE} ${cleanTag} ${cleanPlan} ${phase} `;
  return `${head}${requiredPart(slug, MAX_SESSION_NAME - head.length - suffix.length, "slug")}${suffix}`;
}

/**
 * A name without the ` [ref]` ListAgents prints after it, trimmed. The one home of that rule:
 * the message guard looks a target up by the name this leaves.
 */
export function withoutListRef(name: string): string {
  return name.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
}

/** One word of a name of ours. */
const PART = "[A-Za-z0-9._-]+";

/** A hand-off's number: a whole number of 2 or more, as `handoffSuffix` writes it. */
const HANDOFF = "(?:[2-9]|[1-9][0-9]+)";

/** A lead's name, whole or cut after its tag. */
const LEAD_SHAPE = new RegExp(`^${LEAD_ROLE}( ${PART}){1,2}$`);

/**
 * A crew session's name, with or without a hand-off number, whole or cut after its phase, as a
 * narrow list shows it. It takes both shapes: `C <tag> <plan> <phase> <slug>` (1.1.2 on) and
 * `C <tag> <phase> <slug>` (1.1.1 and earlier, whose records keep their names). A fifth word is
 * read only as a hand-off number, so a person's `C …` name with five words is not ours; every
 * cut of a name of ours keeps at most four words before the number.
 */
const CREW_SHAPE = new RegExp(`^${CREW_ROLE}( ${PART}){2,4}( ${HANDOFF})?$`);

/**
 * The role a name shows: `lead`, `crew`, or null for any other name (a person's own). It reads
 * the name's shape only — a ListAgents ` [ref]` read past — so a person may name a session in
 * that shape by hand.
 *
 * **Nothing reads a name's shape to act on it.** No crew command calls this: the commands
 * resolve a name through the store's records (`findNamed`, which matches the name and the ids),
 * and the message guard does the same after `withoutListRef` drops the ` [ref]`. It is the shape
 * check the tests hold the names to, and the check a caller with no store to read would need.
 */
export function roleOf(name: string): SessionRole | null {
  const plain = withoutListRef(name);
  if (LEAD_SHAPE.test(plain)) return "lead";
  if (CREW_SHAPE.test(plain)) return "crew";
  return null;
}
