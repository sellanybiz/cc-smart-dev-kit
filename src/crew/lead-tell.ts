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
 *
 * **A store write that fails part-way is never hidden.** The receivers recorded before it keep
 * their note and get their lines printed; the one whose note is missing is named, and the exit
 * code is 1. A bad name is still refused before anything is written ("all or none").
 */
import { COMMAND } from "../build-info/names";
import { sendMessageLine } from "./answer";
import { findNamed, type NamedLook } from "./board";
import { readCaller, reasonOf, requireSession } from "./caller";
import type { CrewContext } from "./context";
import { appendCrewEvent, type LeadRecord, type Listed, listLeads, readLead } from "./store";
import type { TellArgs } from "./tell";
import { firstLineOf, leadTellMessage } from "./tell-format";

/** How a lead answers to a reference: its session id, whole or its first 8 characters. */
const LEAD_LOOK: NamedLook<LeadRecord> = {
  ids: (one) => [one.sessionId, one.sessionId.slice(0, 8)],
};

/** A lead `ref` names; or the refusal that names every candidate. */
function findLead(
  records: readonly LeadRecord[],
  ref: string,
): { record: LeadRecord } | { lines: string[] } {
  const found = findNamed(records, ref, LEAD_LOOK);
  switch (found.kind) {
    case "one":
      return { record: found.record };
    case "none":
      // The sender is a lead already, so the store names at least it: the fix is the receiver ref.
      return {
        lines: [
          `crew lead tell: no lead of this repository is "${ref}"`,
          `Fix: name one of the leads here: ${records.map((one) => one.name).join(", ")}`,
        ],
      };
    case "many":
      return {
        lines: [
          `crew lead tell: "${ref}" is ${found.records.length === 2 ? "two" : String(found.records.length)} leads`,
          ...found.records.map((one) => `  ${one.sessionId}  ${one.name}`),
          "Fix: name one by its session id",
        ],
      };
  }
}

/**
 * Records the note for each receiver, and prints each one's `SendMessage` line once every
 * receiver was tried. **A failure never hides what was recorded or what was not:** a write
 * that fails never stops the notes after it, every receiver whose note is missing is named
 * with its reason, one sentence names them all, and the exit code is 1.
 */
export async function recordLeadNotes(
  receivers: readonly LeadRecord[],
  record: (one: LeadRecord) => Promise<unknown>,
  message: string,
  sinks: { error: (line: string) => void; print: (line: string) => void },
): Promise<number> {
  const recorded: LeadRecord[] = [];
  const missed: { name: string; why: string }[] = [];
  for (const one of receivers) {
    try {
      await record(one);
      recorded.push(one);
    } catch (error) {
      missed.push({ name: one.name, why: reasonOf(error) });
    }
  }
  for (const one of missed) {
    sinks.error(`crew lead tell: the store could not record the note for ${one.name}: ${one.why}`);
  }
  const missing = missed.map((one) => one.name).join(", ");
  if (recorded.length > 0 && missed.length > 0) {
    const names = recorded.map((done) => done.name).join(", ");
    sinks.error(
      `The note is recorded for ${names}: send the ${recorded.length === 1 ? "line" : "lines"} below, and tell ${missing} again.`,
    );
  } else if (recorded.length === 0 && missed.length > 1) {
    sinks.error(`No note was recorded: tell ${missing} again.`);
  }
  for (const one of recorded) sinks.print(sendMessageLine(one.name, message));
  return missed.length === 0 ? 0 : 1;
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
  const message = leadTellMessage(sender.name, args.kind, args.text);
  return await recordLeadNotes(
    receivers,
    async (one) => {
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
    },
    message,
    { error: ctx.error, print: ctx.print },
  );
}
