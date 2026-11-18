import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND, PLUGIN } from "../build-info/names";
import { atomicWrite } from "../setup/write";
/** Encode core ids too: neither an address nor a name may escape the private folder. */
export function briefPath(stateDir: string, core: string, name: string): string {
  return join(
    stateDir,
    "herdr",
    "briefs",
    `${encodeURIComponent(core)}-${encodeURIComponent(name)}`,
    "brief.md",
  );
}
/** What a plan child's brief says about its plan (D6). */
export interface PlanTrailer {
  /** The plan's slug, as `task_take` names it. */
  slug: string;
  /** The hand-out id the store wrote at the reservation: the take's `from`. */
  handoutId: string;
  /** The project's default branch, looked up by the lead, never assumed. */
  base: string;
  /** The child continues a worktree that already holds work: no fetch and no reset. */
  resume: boolean;
}

/**
 * The plan trailer (D6, steps 1 to 5). It replaces the task trailer for a plan child and
 * overrides the build skill's "start the next queued plan": a plan child never takes another.
 */
export function planTrailer(plan: PlanTrailer): string {
  const sync = plan.resume
    ? "2. This is a resume: the worktree already holds this plan's work. Do not fetch and do not reset it."
    : `2. Run \`git fetch origin ${plan.base}\`. If it fails, run it once more; if it fails again, stop and report the error, and never build on a stale ref. Then run \`git reset --hard origin/${plan.base}\`: your worktree's own branch is the plan branch. Then save where you started: task_update on the plan with base set to the output of \`git rev-parse HEAD\`.`;
  return `\nYour plan: ${plan.slug}. You build this one plan and nothing else.\n1. Take it with task_take: task "${plan.slug}", from "${plan.handoutId}".\n${sync}\n3. Run \`/${PLUGIN}:build\` on this plan only. Builder subagents are allowed; start no other sessions. Never start the next queued plan, whatever the build skill says.\n4. Push, pull request and merge follow \`workflow show\`. Where they are off, ask the person in this terminal.\n5. Report with \`${COMMAND} herdr report "<the pull request link, what shipped, what failed>"\`. Then stop. Never take another plan.\n`;
}
export async function writeBrief(
  stateDir: string,
  core: string,
  name: string,
  text: string,
  linked: boolean,
  task?: string,
  plan?: PlanTrailer,
): Promise<string> {
  const file = briefPath(stateDir, core, name);
  const trailer = plan
    ? planTrailer(plan)
    : task
      ? `\nYour task: ${task}\nsave a \`Report:\` note with task_note; never take, update or close the task.\n`
      : "";
  await writePrivate(
    file,
    `${text}\n${trailer}${linked ? `\nWhen done or stuck, report with: \`${COMMAND} herdr report "<one paragraph>"\`; write long results to a file and report its path. Start no sessions or agents of your own unless this brief says so.\n` : ""}`,
  );
  return file;
}
export async function writePrivate(file: string, text: string): Promise<void> {
  const folder = dirname(file);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  atomicWrite(file, text, 0o600);
}

export function reportPath(stateDir: string, core: string, name: string): string {
  return join(
    dirname(briefPath(stateDir, core, name)),
    `report-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.md`,
  );
}
