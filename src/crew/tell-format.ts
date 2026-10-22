/**
 * The words of a note one crew session tells another (D47), in one place: `crew tell` writes
 * them (`tell.ts`) and the message guard checks them (`src/hooks/message-guard.ts`), so the two
 * can never disagree about what a tagged message is. A note one **lead** tells another lead of
 * the same repository (D55, `lead-tell.ts`) is the same two kinds under the sender's lead name,
 * and the words of both live here too.
 *
 * Only two kinds cross between crew sessions, and between leads. A **contract** note says
 * "I changed X you use" (file, symbol, commit) and needs no reply. A **question** asks what
 * another session's contract accepts. Status and "done" are never told to a peer: they go to
 * the lead with `crew report`.
 *
 * The first line of the message is the tag and the point: `[<phase>] CONTRACT: <what>` between
 * crew sessions, `[<lead name>] CONTRACT: <what>` between leads. It is the preview line the
 * receiver sees, so it says the whole thing.
 */

/** The two kinds, in the order the help lists them. */
export const TELL_KINDS = ["contract", "question"] as const;
export type TellKind = (typeof TELL_KINDS)[number];

/** True when `value` is a kind a crew session may tell. */
export function isTellKind(value: string): value is TellKind {
  return (TELL_KINDS as readonly string[]).includes(value);
}

/** The label each kind carries in the first line of its message. */
const LABELS: Record<TellKind, string> = { contract: "CONTRACT", question: "QUESTION" };

/** The line a contract note ends with. */
export const NO_REPLY = "No reply needed.";

/** The tag that starts a message: `[<phase>] CONTRACT:`. */
export function tellTag(phase: string, kind: TellKind): string {
  return `[${phase}] ${LABELS[kind]}:`;
}

/** The first non-empty line of `text`, trimmed; empty when there is none. */
export function firstLineOf(text: string): string {
  return (text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim();
}

/** The first line of the message `crew tell` makes: the tag, then the first line of the text. */
export function tellHeadline(phase: string, kind: TellKind, text: string): string {
  return `${tellTag(phase, kind)} ${firstLineOf(text)}`;
}

/**
 * The first line of a note one lead tells another lead (D55): the sender's lead name is the tag,
 * because the receiver has to know which plan of this repository it comes from.
 */
export function leadTellHeadline(leadName: string, kind: TellKind, text: string): string {
  return `[${leadName}] ${LABELS[kind]}: ${firstLineOf(text)}`;
}

/**
 * The whole message: its first line, then the rest of the text as given, and for a contract
 * note the line that says no reply is needed.
 */
function messageLines(firstLine: string, kind: TellKind, text: string): string {
  const rest = text.trim().split(/\r?\n/).slice(1).join("\n").trimEnd();
  const parts = [firstLine];
  if (rest !== "") parts.push(rest);
  if (kind === "contract") parts.push(NO_REPLY);
  return parts.join("\n");
}

/** The whole message `crew tell` makes, from its headline. */
export function tellMessage(phase: string, kind: TellKind, text: string): string {
  return messageLines(tellHeadline(phase, kind, text), kind, text);
}

/** The whole message one lead sends another lead, from its headline. */
export function leadTellMessage(leadName: string, kind: TellKind, text: string): string {
  return messageLines(leadTellHeadline(leadName, kind, text), kind, text);
}

/** True when the first line of `message` starts with a tag of `phase`, of either kind. */
export function hasTellTag(message: string, phase: string): boolean {
  const first = message.trimStart().split(/\r?\n/, 1)[0] ?? "";
  return TELL_KINDS.some((kind) => first.startsWith(tellTag(phase, kind)));
}
