/**
 * Which lead session runs a command (PL1): the actor a run record names on the events it makes
 * (who answered, who stopped, who removed). A plan has more than one lead over its life, and a
 * crew record keeps only the lead that started it, so the lead that acts now is read from the
 * session above the command, the way `crew lead` finds it.
 */
import type { CrewContext } from "./context";
import type { RunActor } from "./runs";
import { callingSession } from "./session";
import { readLead } from "./store";

/**
 * The lead session that runs this command in `repo`: null when no session above it is a recorded
 * lead (the watch, the portal's click, a script) — the run record then names the lead the crew
 * session belongs to. A session record that cannot be read leaves the actor unknown, never
 * fails the command that asked.
 */
export function actorOfCaller(ctx: CrewContext, repo: string): RunActor | null {
  try {
    const session = callingSession(
      ctx.paths.claudeConfigDir,
      ctx.pid,
      ctx.processes.parentOf,
      ctx.env,
    );
    if (session === null) return null;
    const lead = readLead(ctx.paths.stateDir, repo, session.sessionId);
    return lead === null ? null : { name: lead.name, sessionId: lead.sessionId };
  } catch {
    // An unreadable session or lead record: the actor is unknown, and the run record says the
    // crew session's own lead.
    return null;
  }
}
