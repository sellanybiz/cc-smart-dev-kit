/**
 * `cc-smart-dev-kit crew tell <name…> --kind contract|question "<text>"`: one crew session tells
 * another a contract change or asks a contract question (D47).
 *
 * **Hub and spoke.** Status flows to the lead through `crew report`. Two crew sessions talk
 * directly only when one's contract touches the other's, and then only in the two kinds
 * (`tell-format.ts`). This command is the one way: it checks each receiver, records the note so
 * the lead's watch shows it as one line, and prints the `SendMessage` line to send to each. The
 * CLI cannot send the message itself — `SendMessage` is a tool only a session holds — so, as in
 * `crew answer`, it prints the line and the session sends it. The lines come after one line that
 * says to load the tool first (`sendMessageHint`): `SendMessage` is deferred, and a backend
 * model cannot call it before `ToolSearch` with `select:SendMessage`.
 *
 * **A receiver is a live crew session of the same lead**, found in the store. A name the store
 * does not know, the lead, a crew session of another lead, and one whose session is not running
 * are each refused with one line, and nothing is recorded or printed: all or none.
 *
 * The message guard (`src/hooks/message-guard.ts`) refuses a crew session's message to another
 * crew session that does not carry the tag this command writes.
 */
import { COMMAND } from "../build-info/names";
import { sendMessageHint, sendMessageLine } from "./answer";
import { findCrew } from "./board";
import { readCrewSelf, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { withoutListRef } from "./names";
import { RUNNING_STATES } from "./places";
import { appendCrewEvent, type CrewRecord, listCrew } from "./store";
import { firstLineOf, type TellKind, tellHeadline, tellMessage } from "./tell-format";

/** What `crew tell` was asked, already checked to be well formed. */
export interface TellArgs {
  kind: TellKind;
  /** The receivers, as named: a name, an id or a short id each. */
  to: string[];
  text: string;
}

/** Why `record` cannot be told now, or null when it can: its session must be running. */
function notLive(record: CrewRecord): null | string {
  if (!(RUNNING_STATES as readonly string[]).includes(record.state)) {
    return `${record.name} is ${record.state}, so a message to it goes nowhere`;
  }
  if (record.sessionId === null) return `${record.name} has no session yet`;
  return null;
}

/** `crew tell`; the exit code. */
export async function runCrewTell(args: TellArgs, ctx: CrewContext): Promise<number> {
  const read = readCrewSelf(ctx, "crew tell");
  if (!read.ok) {
    for (const line of read.lines) ctx.error(line);
    return 1;
  }
  const { record: self, repo } = read.self;
  if (firstLineOf(args.text) === "") {
    ctx.error('crew tell: say what you tell: crew tell <name…> --kind contract|question "<text>"');
    return 2;
  }
  let records: CrewRecord[];
  try {
    records = listCrew(ctx.paths.stateDir, repo).records;
  } catch (error) {
    ctx.error(`crew tell: the store could not be read: ${reasonOf(error)}`);
    return 1;
  }
  const receivers: CrewRecord[] = [];
  for (const ref of args.to) {
    if (withoutListRef(ref) === self.leadName) {
      ctx.error(
        `crew tell: ${self.leadName} is your lead, not a crew session: it hears you through crew report`,
      );
      ctx.error(
        `Fix: ${COMMAND} crew report --question "<the question>" --option "<choice>" --option "<choice>"`,
      );
      return 1;
    }
    const found = findCrew(records, ref, "tell");
    if ("refusal" in found) {
      for (const line of found.refusal.lines) ctx.error(line);
      return found.refusal.code;
    }
    const { record } = found;
    const why =
      record.id === self.id
        ? "you cannot tell yourself"
        : record.leadSessionId !== self.leadSessionId
          ? `${record.name} works for another lead (${record.leadName}), and a crew session tells only the crew of its own lead`
          : notLive(record);
    if (why !== null) {
      ctx.error(`crew tell: ${why}`);
      return 1;
    }
    if (!receivers.some((one) => one.id === record.id)) receivers.push(record);
  }
  try {
    await appendCrewEvent(
      ctx.paths.stateDir,
      repo,
      {
        crew: self.id,
        lead: self.leadSessionId,
        name: self.name,
        state: self.state,
        tell: { kind: args.kind, to: receivers.map((one) => one.name) },
        text: tellHeadline(self.phase, args.kind, args.text),
        type: "tell",
      },
      ctx.now(),
    );
  } catch (error) {
    ctx.error(`crew tell: the store could not record the note: ${reasonOf(error)}`);
    return 1;
  }
  const message = tellMessage(self.phase, args.kind, args.text);
  // Once, before the first line: the tool is deferred, and a backend model must load it.
  ctx.print(sendMessageHint());
  for (const one of receivers) ctx.print(sendMessageLine(one.name, message));
  return 0;
}
