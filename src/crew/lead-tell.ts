/**
 * `cc-smart-dev-kit crew lead tell <lead…> --kind contract|question "<text>"`: one lead tells
 * another lead of the same repository a contract change, or asks it a contract question (D55).
 *
 * **Leads of one repository reach each other.** Several plans often run in one repository at
 * once, each led by its own session, and a crew session tells only the crew of its own lead
 * (`tell.ts`). A lead tells another lead here with the same two kinds: a contract note says what
 * its plan changed that the other's work may use, a question asks what the other's contract
 * accepts. Status and "done" stay with `crew report`.
 *
 * **The store decides who may be told**: a lead recorded for this repository (`listLeads`), by
 * its name, its session id or the first 8 characters of it. A name no lead of this repository
 * has (a lead of another repository is no lead of this one), the sender itself, and a session
 * that never ran `crew lead` are each refused with one line, and **nothing is recorded or
 * printed: all or none**. A crew session never runs this at all: it talks to its own lead
 * through `crew report` (`readCaller`).
 *
 * The note is recorded as one `lead-tell` event per receiver, with that lead's session id in
 * `lead`, so its own watch prints one line and its `lead-notes` hook covers a missed one; the
 * event's text is the note's first line without the tag, and the line the watch prints names
 * the sending lead. Then the command prints one `SendMessage` line per receiver: only a session
 * holds that tool, so it sends them.
 */
import { COMMAND } from "../build-info/names";
import { sendMessageLine } from "./answer";
import { readCaller, reasonOf, requireSession } from "./caller";
import type { CrewContext } from "./context";
import { withoutListRef } from "./names";
import { appendCrewEvent, type LeadRecord, type Listed, listLeads, readLead } from "./store";
import type { TellArgs } from "./tell";
import { firstLineOf, leadTellMessage } from "./tell-format";

/** A lead `ref` names; or the refusal that names every candidate. */
function findLead(
  records: readonly LeadRecord[],
  ref: string,
): { record: LeadRecord } | { lines: string[] } {
  const plain = withoutListRef(ref);
  const matches = records
    .filter(
      (one) => one.name === plain || one.sessionId === plain || one.sessionId.slice(0, 8) === plain,
    )
    // Oldest first, so the candidates read as a history.
    .sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.sessionId.localeCompare(b.sessionId),
    );
  const [only] = matches;
  if (only !== undefined && matches.length === 1) return { record: only };
  if (only === undefined) {
    // The sender is a lead already, so the store names at least it: the fix is the receiver ref.
    return {
      lines: [
        `crew lead tell: no lead of this repository is "${ref}"`,
        `Fix: name one of the leads here: ${records.map((one) => one.name).join(", ")}`,
      ],
    };
  }
  return {
    lines: [
      `crew lead tell: "${ref}" is ${matches.length === 2 ? "two" : String(matches.length)} leads`,
      ...matches.map((one) => `  ${one.sessionId}  ${one.name}`),
      "Fix: name one by its session id",
    ],
  };
}

/** `crew lead tell`; the exit code. */
export async function runLeadTell(args: TellArgs, ctx: CrewContext): Promise<number> {
  const read = readCaller("lead tell", ctx);
  if (!read.ok) {
    for (const line of read.lines) ctx.error(line);
    return 1;
  }
  const found = requireSession(read.caller, "lead tell");
  if (!found.ok) {
    for (const line of found.lines) ctx.error(line);
    return 1;
  }
  const { repo } = read.caller;
  let sender: LeadRecord | null;
  try {
    sender = readLead(ctx.paths.stateDir, repo, found.session.sessionId);
  } catch (error) {
    ctx.error(`crew lead tell: the store could not be read: ${reasonOf(error)}`);
    return 1;
  }
  if (sender === null) {
    ctx.error("crew lead tell: this session is not a lead of this repository");
    ctx.error(`Fix: ${COMMAND} crew lead --plan <slug>`);
    return 1;
  }
  if (firstLineOf(args.text) === "") {
    ctx.error(
      'crew lead tell: say what you tell: crew lead tell <lead…> --kind contract|question "<text>"',
    );
    return 2;
  }
  let leads: Listed<LeadRecord>;
  try {
    leads = listLeads(ctx.paths.stateDir, repo);
  } catch (error) {
    ctx.error(`crew lead tell: the store could not be read: ${reasonOf(error)}`);
    return 1;
  }
  const receivers: LeadRecord[] = [];
  for (const ref of args.to) {
    const named = findLead(leads.records, ref);
    if ("lines" in named) {
      for (const line of named.lines) ctx.error(line);
      return 1;
    }
    if (named.record.sessionId === sender.sessionId) {
      ctx.error("crew lead tell: you cannot tell yourself");
      return 1;
    }
    if (!receivers.some((one) => one.sessionId === named.record.sessionId)) {
      receivers.push(named.record);
    }
  }
  const to = receivers.map((one) => one.name);
  for (const one of receivers) {
    try {
      await appendCrewEvent(
        ctx.paths.stateDir,
        repo,
        {
          crew: sender.sessionId,
          lead: one.sessionId,
          name: sender.name,
          state: "working",
          tell: { kind: args.kind, to },
          text: firstLineOf(args.text),
          type: "lead-tell",
        },
        ctx.now(),
      );
    } catch (error) {
      ctx.error(`crew lead tell: the store could not record the note: ${reasonOf(error)}`);
      return 1;
    }
  }
  const message = leadTellMessage(sender.name, args.kind, args.text);
  for (const one of receivers) ctx.print(sendMessageLine(one.name, message));
  return 0;
}
