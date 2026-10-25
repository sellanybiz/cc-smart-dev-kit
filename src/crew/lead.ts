/**
 * `cc-smart-dev-kit crew lead [--plan <slug>] [--tag <tag>]`: records the Claude Code session
 * that runs it as a lead in this repository — the nearest ancestor process with a session record
 * (`callingSession`, proved live, L1a.1 P13). Its crew name it as their lead, and `crew
 * start` refuses a session that never ran it.
 *
 * The lead's name, `LEAD <tag> <plan>` (D26), is written as data, in the lead record: the
 * lead-notes hook sets it at the lead's next prompt, with no setting and never over a name the
 * person gave (LD1). This command never renames the session itself; only a session id no naming
 * record can be made for gets the `/rename` line to type.
 *
 * - `--tag` names the repository in every name this lead and its crew carry; without it,
 *   `workflow.crew.tag`, else the main checkout's folder name (`crewTag`).
 * - `--plan` names the plan; without it, the plan this session already leads here, else the
 *   branch the checkout is on.
 * - `--plan-file` names the plan's file (PL1): the folder beside it holds the plan's briefs and
 *   the record of each crew run. Without it: the file this session recorded before, the one an
 *   earlier lead of the same plan recorded (a hand-over), or the one file
 *   `<plans dir>/*-<plan>.md` (`findPlanFile`); none or several leave it off, and a line says so.
 *
 * Running it again records the lead again: the time it was first recorded stays. Two leads in
 * one repository are two records, each by its own session id.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tildify } from "../cli/paths";
import { runGit } from "../hooks/git";
import { isSessionId, readAppliedName } from "../hooks/session-name";
import { ownHooksOf } from "../project/resolve";
import { readCaller, reasonOf, requireSession } from "./caller";
import type { CrewContext } from "./context";
import { crewTag, leadName } from "./names";
import { findPlanFile, planFileOfLead, plansDirs } from "./runs";
import {
  eventsEndOffset,
  listLeads,
  readLead,
  readWatchState,
  writeLead,
  writeWatchState,
} from "./store";

/** What `crew lead` was asked, already checked to be well formed (`command.ts`). */
export interface LeadArgs {
  plan: null | string;
  /** The plan's file (`--plan-file`): its folder holds the briefs and the run records (PL1). */
  planFile?: null | string;
  tag: null | string;
  end?: boolean;
}

/** How long reading the branch may take. */
const GIT_TIMEOUT_MS = 15_000;

/** `crew lead`; the exit code. */
export async function runCrewLead(args: LeadArgs, ctx: CrewContext): Promise<number> {
  const read = readCaller("lead", ctx);
  if (!read.ok) {
    for (const line of read.lines) ctx.error(line);
    return 1;
  }
  const { checkout, repo, resolved } = read.caller;
  const found = requireSession(read.caller, "lead");
  if (!found.ok) {
    for (const line of found.lines) ctx.error(line);
    return 1;
  }
  const session = found.session;
  const refuse = (line: string, fix: string, code: 1 | 2): number => {
    ctx.error(`crew lead: ${line}`);
    ctx.error(`Fix: ${fix}`);
    return code;
  };
  let before: ReturnType<typeof readLead>;
  try {
    before = readLead(ctx.paths.stateDir, repo, session.sessionId);
  } catch (error) {
    return refuse(reasonOf(error), "remove that record, then run this again", 1);
  }
  if (args.end) {
    if (before === null)
      return refuse("this session is not a recorded lead", "run crew lead first", 1);
    try {
      await writeLead(
        ctx.paths.stateDir,
        { ...before, endedAt: new Date(ctx.now()).toISOString() },
        ctx.now(),
      );
      ctx.print(
        `ended lead ${before.name}; its crew work is kept unless the project base holds it`,
      );
      return 0;
    } catch (error) {
      ctx.error(`crew lead: ${reasonOf(error)}`);
      return 1;
    }
  }
  const branch = runGit(
    checkout.root,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  const plan = args.plan ?? before?.plan ?? (branch.ok ? branch.out : null);
  if (plan === null) {
    return refuse(
      "this checkout is on no branch, so the plan has no name",
      "pass --plan <slug>",
      2,
    );
  }
  let planFile: null | string = null;
  if (args.planFile != null) {
    planFile = resolve(ctx.cwd, args.planFile);
    if (!planFile.endsWith(".md") || !existsSync(planFile)) {
      return refuse(
        `the plan file ${args.planFile} is no existing .md file`,
        "pass the plan's file: --plan-file <path>",
        2,
      );
    }
  }
  let tag: string;
  let name: string;
  try {
    tag = args.tag ?? crewTag(repo, resolved.crew.tag.value);
    name = leadName(tag, plan);
  } catch (error) {
    return refuse(reasonOf(error), "pass --plan <slug> and --tag <tag>", 2);
  }
  let planNote: string;
  if (planFile === null) {
    const found = planFileOfLead(
      { plan, planFile: before?.plan === plan ? before.planFile : undefined },
      listLeads(ctx.paths.stateDir, repo).records.filter(
        (one) => one.sessionId !== session.sessionId,
      ),
      () => findPlanFile(plan, plansDirs(repo, ctx.paths), { archived: false }),
    );
    planFile = found.ok ? found.file : null;
    planNote = found.ok
      ? `plan file ${tildify(found.file, ctx.paths.home)}`
      : `no plan file for ${plan}${found.reason === "several" ? ` (${found.matches.length} files match)` : ""}: its briefs and run records are off; pass --plan-file <path>`;
  } else {
    planNote = `plan file ${tildify(planFile, ctx.paths.home)}`;
  }
  try {
    await writeLead(
      ctx.paths.stateDir,
      {
        cwd: checkout.root,
        name,
        plan,
        planFile,
        repo,
        sessionId: session.sessionId,
        tag,
        ...(before?.endedAt == null ? {} : { endedAt: null }),
      },
      ctx.now(),
    );
  } catch (error) {
    ctx.error(`crew lead: ${reasonOf(error)}`);
    return 1;
  }
  // Where this lead's watch starts reading: the log's end as it is now. The lines before it are
  // history the lead already saw (it started those crew sessions itself); the ones after it are what
  // the watch says.
  if (readWatchState(ctx.paths.stateDir, repo, session.sessionId) === null) {
    try {
      writeWatchState(ctx.paths.stateDir, repo, session.sessionId, {
        noted: false,
        offset: eventsEndOffset(ctx.paths.stateDir, repo),
        said: {},
      });
    } catch {
      // The watch reads the log from its start then: the same lines, one more time.
    }
  }
  ctx.print(planNote);
  const head = `lead ${name} (${session.sessionId.slice(0, 8)}): the crew this session starts in ${tildify(repo, ctx.paths.home)} report to it; `;
  // What the next prompt will really do, so the line never promises a name it cannot set: a
  // session id the naming record cannot hold, and a project running its own `lead-notes` copy
  // (which silences the plugin's), each need the person's `/rename`.
  const nameable = isSessionId(session.sessionId);
  const ownNotes = ownHooksOf(checkout).includes("lead-notes");
  if (!nameable || ownNotes) {
    ctx.print(
      `${head}${
        ownNotes
          ? "this project runs its own lead-notes hook, so type the next line if the name does not appear"
          : "this session's id cannot carry a session name, so type the next line in this session"
      }`,
    );
    ctx.print(`/rename ${name}`);
  } else if (readAppliedName(ctx.env, session.sessionId) === name) {
    ctx.print(`${head}this session already took that name, and a name given with /rename stays`);
  } else {
    ctx.print(`${head}this session takes that name at its next prompt`);
  }
  return 0;
}
