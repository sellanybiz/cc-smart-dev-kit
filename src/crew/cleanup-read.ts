/** Read-only cleanup facts for the CLI's JSON child and the portal: no second lifecycle policy. */
import type { CrewContext } from "./context";
import { buildCrewDiscardFacts, type CrewDiscardFacts } from "./discard";
import { type StoppedCrewNeed, stoppedCrewNeed } from "./lifecycle";
import { listAllCrew, listAllLeads, readCrewEvents } from "./store";

export interface StoppedCrewItem extends StoppedCrewNeed {
  crew: { id: string; name: string; shortId: null | string; state: string };
  repo: string;
  /** Exact shared preview words and token, or why this work cannot safely be archived. */
  discard: { facts: CrewDiscardFacts | null; error: string | null };
}

export interface CrewCleanupAnswer {
  stopped: StoppedCrewItem[];
  error: string | null;
}

/** Synchronous git stays in the CLI child. An unreadable ownership store offers no removal. */
export function crewCleanupAnswer(ctx: CrewContext): CrewCleanupAnswer {
  try {
    const crew = listAllCrew(ctx.paths.stateDir);
    const leads = listAllLeads(ctx.paths.stateDir);
    if (crew.broken.length || leads.broken.length) {
      return {
        stopped: [],
        error:
          "Could not read every crew and lead record; repair the crew store before removing sessions.",
      };
    }
    const events = new Map<string, ReturnType<typeof readCrewEvents>["events"]>();
    const stopped: StoppedCrewItem[] = [];
    for (const record of crew.records) {
      if (!events.has(record.repo)) {
        const read = readCrewEvents(ctx.paths.stateDir, record.repo);
        if (read.skipped !== 0) throw new Error("the crew events include an unreadable record");
        events.set(record.repo, read.events);
      }
      const need = stoppedCrewNeed(record, events.get(record.repo) ?? [], ctx, crew.records);
      if (need !== null) {
        let discard: StoppedCrewItem["discard"];
        try {
          discard = { facts: buildCrewDiscardFacts(record, ctx), error: null };
        } catch (error) {
          discard = { facts: null, error: error instanceof Error ? error.message : String(error) };
        }
        stopped.push({
          ...need,
          crew: { id: record.id, name: record.name, shortId: record.shortId, state: record.state },
          repo: record.repo,
          discard,
        });
      }
    }
    return { stopped, error: null };
  } catch (error) {
    return {
      stopped: [],
      error: `Could not read cleanup facts: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
