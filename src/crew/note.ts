import { deliveryReport, markResumed, resumeSession, sessionLiveness } from "./answer";
import { findCrew } from "./board";
import { readCaller, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { readPart } from "./report";
import {
  addCrewNote,
  listCrew,
  markNoteDelivered,
  questionClosed,
  resumeWaitOf,
  updateCrew,
} from "./store";

export interface NoteArgs {
  crew: string;
  text: string;
  file?: string;
  asPerson?: boolean;
}

/** The lead's additional decision, without inventing a question to answer. */
export async function runCrewNote(args: NoteArgs, ctx: CrewContext): Promise<number> {
  const read = readCaller(
    "note",
    ctx,
    args.asPerson === true ? { asPerson: true, session: "optional" } : { session: "required" },
  );
  if (!read.ok) {
    for (const line of read.lines) ctx.error(line);
    return 1;
  }
  const { repo, session } = read.caller;
  try {
    const found = findCrew(listCrew(ctx.paths.stateDir, repo).records, args.crew, "note");
    if ("refusal" in found) {
      for (const line of found.refusal.lines) ctx.error(line);
      return 1;
    }
    const { record } = found;
    if (args.asPerson !== true && session?.sessionId !== record.leadSessionId) {
      ctx.error(`crew note: only ${record.leadName}, this crew session's lead, can send it a note`);
      return 1;
    }
    if (questionClosed(record.state)) {
      ctx.error(`crew note: ${record.name} is finished (${record.state})`);
      return 1;
    }
    const part =
      args.file === undefined ? { raw: args.text } : await readPart({ file: args.file }, ctx);
    if ("refused" in part) {
      ctx.error(`crew note: the file ${args.file} cannot be read`);
      return 1;
    }
    const updated = await addCrewNote(ctx.paths.stateDir, repo, record.id, part.raw, ctx.now());
    const index = (updated.notes?.length ?? 1) - 1;
    if (record.state === "queued") {
      ctx.print(`${record.name}: note recorded for its launch`);
      return 0;
    }
    const live = record.state === "stopped" ? sessionLiveness(ctx, record) : "live";
    if (live === "unknown") {
      ctx.error(
        "crew note: note recorded, not delivered: the session view cannot be read; try again when it can",
      );
      return 1;
    }
    if (record.state === "stopped" && live === "dead") {
      const resumed = await resumeSession(ctx, record, `Your lead's note:\n${part.raw}`);
      if (!resumed.ok) {
        if (resumed.waits !== undefined) {
          await updateCrew(
            ctx.paths.stateDir,
            repo,
            record.id,
            { resumeWaits: resumeWaitOf(record, ctx.now()) },
            ctx.now(),
          );
          ctx.print(`${record.name}: note recorded; it waits for room to resume`);
          return 0;
        }
        ctx.error(`crew note: note recorded, not delivered: ${resumed.why}`);
        return 1;
      }
      const stored = await markResumed(record, resumed.session, ctx);
      if (stored) await markNoteDelivered(ctx.paths.stateDir, repo, record.id, index, ctx.now());
      ctx.print(`${record.name}: resumed with your note`);
      return 0;
    }
    ctx.print(`${record.name}: note recorded`);
    for (const line of await deliveryReport(
      ctx,
      repo,
      record,
      index,
      { asPerson: args.asPerson === true, replaces: false },
      `Your lead's note:\n${part.raw}`,
      "note",
    ))
      ctx.print(line);
    return 0;
  } catch (error) {
    ctx.error(`crew note: ${reasonOf(error)}`);
    return 1;
  }
}
