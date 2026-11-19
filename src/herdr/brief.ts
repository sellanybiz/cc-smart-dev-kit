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
  return `\nYour plan: ${plan.slug}. You build this one plan and nothing else.\n1. Take it with task_take: task "${plan.slug}", from "${plan.handoutId}".\n${sync}\n3. Run \`/${PLUGIN}:build\` on this plan only. Builder subagents are allowed; start no other sessions. Never start the next queued plan, whatever the build skill says.\n4. Push, pull request and merge follow \`workflow show\`. Where they are off, ask the person in this terminal.\n5. Report with \`${COMMAND} herdr report "<the pull request link, what shipped, what failed>"\`. Then stop. Never take another plan.\nA finding outside your plan goes in \`${COMMAND} herdr report\`. Never ask the person, file an issue or start a session for it.\n`;
}
/** What a follow-up child's brief says about its work (`herdr start --followup`). */
export interface FollowupTrailer {
  /** The project's default branch, looked up by the lead, never assumed. */
  base: string;
  /** The issues the first findings were filed as, in the order given. */
  issues: readonly string[];
  /** The plans held when the child started (a snapshot): their slugs and files. */
  held: readonly { slug: string; files: readonly string[] }[];
}

/**
 * The follow-up trailer: how the lead's one follow-up child works. It never stops on its own:
 * the lead sends it each finding and ends it with `herdr stop`.
 */
export function followupTrailer(followup: FollowupTrailer): string {
  const { base } = followup;
  const issues = followup.issues.length
    ? `\nThe first findings are filed as ${followup.issues.map((n) => `#${n}`).join(", ")}. A later message names its own issue as "Follow-up [#n]".\n`
    : "";
  const held = followup.held.length
    ? `\nThese plans hold files now (a snapshot; a later message names new ones):\n${followup.held.map((plan) => `- ${plan.slug}: ${plan.files.length ? plan.files.join(", ") : "no file list"}`).join("\n")}\nNever edit a file a plan holds. Report the finding instead: the lead treats it as part of that plan.\n`
    : "";
  return `\nYou are your lead's follow-up child for this repository. The brief above is the first finding. Later findings arrive as messages that start with "Follow-up". You never stop on your own: after each report, wait for the next message. You end only when the lead runs \`${COMMAND} herdr stop\`.\n${issues}${held}\nOnce, before the first finding:\n1. Run \`git fetch origin ${base}\`. If it fails, run it once more; if it fails again, report the error and stop. Then run \`git rev-list --count origin/${base}..HEAD\` and \`git status --porcelain\`. Only when the count is 0 and the status is empty, run \`git reset --hard origin/${base}\`. Otherwise never reset: this worktree may hold work. (Your worktree may start from the lead's branch or an old default branch.)\nFor each finding:\n2. Run \`gh pr view --json state\` on your branch. OPEN: add your commit to that pull request. MERGED or CLOSED: run \`git fetch origin ${base}\` and \`git reset --hard origin/${base}\` (that work is in the merged pull request), then open a new one. No pull request: go on.\n3. A small fix: fix it, run the checks that cover it, and review your diff. Bigger work: use plan mode; the person approves the plan in this terminal.\n4. Make one commit for the finding.\n5. When the finding has an issue number, run \`${COMMAND} issue mark-fixed --issue <n> --base ${base} --branch <your branch> --tip <the full id of that commit>\`. If it says issues are off, skip it.\n6. Push and pull request follow \`workflow show\`. Where they are off, ask the person in this terminal. The pull request body's Fixes lines come from \`${COMMAND} issue fixed --base origin/${base} --head <your branch>\`: never write one by hand. Before the pull request opens, a push is a free backup. After it opens, collect the fixes of a round, run the full check locally, then push once; never push one fix at a time.\n7. Report with \`${COMMAND} herdr report "<the finding, its commit, the pull request link, what failed>"\`.\nA finding of your own goes in your report. Never ask the person, file an issue or start a session for it.\n`;
}
export async function writeBrief(
  stateDir: string,
  core: string,
  name: string,
  text: string,
  linked: boolean,
  task?: string,
  plan?: PlanTrailer,
  followup?: FollowupTrailer,
): Promise<string> {
  const file = briefPath(stateDir, core, name);
  const trailer = plan
    ? planTrailer(plan)
    : followup
      ? followupTrailer(followup)
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
