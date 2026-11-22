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
/**
 * Where the lead wants a child's worktree to start (`herdr start --base`): the ref it gave, and
 * the commit that ref named at the start, so a branch that moves later changes nothing.
 */
export interface StartBase {
  ref: string;
  commit: string;
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
export function planTrailer(plan: PlanTrailer, base?: StartBase): string {
  const sync = plan.resume
    ? "2. This is a resume: the worktree already holds this plan's work. Do not fetch and do not reset it."
    : base
      ? `2. Run \`git reset --hard ${base.commit}\`: it is the commit of ${base.ref} when your lead started you, and your worktree's own branch is the plan branch. Never reset to the default branch. Then save where you started: task_update on the plan with base set to the output of \`git rev-parse HEAD\`.`
      : `2. Run \`git fetch origin ${plan.base}\`. If it fails, run it once more; if it fails again, stop and report the error, and never build on a stale ref. Then run \`git reset --hard origin/${plan.base}\`: your worktree's own branch is the plan branch. Then save where you started: task_update on the plan with base set to the output of \`git rev-parse HEAD\`.`;
  return `\nYour plan: ${plan.slug}. You build this one plan and nothing else.\n1. Take it with task_take: task "${plan.slug}", from "${plan.handoutId}".\n${sync}\n3. Run \`/${PLUGIN}:build\` on this plan only. Builder subagents are allowed; start no other sessions. Never start the next queued plan, whatever the build skill says.\n4. Push, pull request and merge follow \`workflow show\`. Where they are off, ask the person in this terminal.\n5. Report with \`${COMMAND} herdr report "<the pull request link, what shipped, what failed>"\`. Then stop. Never take another plan.\n`;
}
/** The step a task or plain child gets when its lead gave a base: its worktree starts on the default branch. */
function startPointTrailer(base: StartBase): string {
  return `\nYour start point: ${base.ref}, commit ${base.commit}. Your worktree starts from the default branch, not from this commit. Before anything else, run \`git status --porcelain\`: if it prints anything, stop and report. Otherwise run \`git reset --hard ${base.commit}\`.\n`;
}
/** What a follow-up child's brief says about its work (`herdr start --followup`). */
export interface FollowupTrailer {
  /** The project's default branch, looked up by the lead, never assumed. */
  base: string;
  /** The child's terminal name: a new branch of its worktree is named after it. */
  name: string;
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
  return `\nYou are your lead's follow-up child for this repository. The brief above is the first finding. Later findings arrive as messages that start with "Follow-up". You never stop on your own: after each report, wait for the next message. You end only when the lead runs \`${COMMAND} herdr stop\`.\n${issues}${held}\nOnce, before the first finding:\n1. Run \`git fetch origin ${base}\`. If it fails, run it once more; if it fails again, report the error and take no finding until step 1 has run. Then run \`git branch --show-current\` for your branch name, \`git rev-list --count HEAD --not --exclude=<your branch> --branches --exclude=origin/<your branch> --remotes\` (your own commits: those on no other branch) and \`git status --porcelain\`. Only when the count is 0 and the status is empty, run \`git reset --hard origin/${base}\`. Otherwise never reset: this worktree may hold work. (Your worktree may start from the lead's branch or an old default branch.)\nFor each finding:\n2. Run \`gh pr list --head <your branch> --state all --json state,headRefOid,createdAt\`. If it fails (not logged in, no network), report the error and wait: never read a failure as "no pull request". An empty list means none: go on. If several are listed, an OPEN one wins; otherwise read the newest (\`createdAt\`). OPEN: add your commit to this branch; it joins that pull request when you ship (step 6). CLOSED without a merge: never reset. Keep the branch; the next ship opens a new pull request from it; say so in your report. MERGED, and \`git rev-parse HEAD\` equals the headRefOid: the branch is fully merged. Run \`git fetch origin ${base}\`, then \`git switch -c <new branch> origin/${base}\`. The switch carries uncommitted changes, or refuses: then report and wait. MERGED, and \`git merge-base --is-ancestor <headRefOid> HEAD\` succeeds with HEAD not equal to the headRefOid: you hold commits that were not merged. Run \`git fetch origin ${base}\`, \`git switch -c <new branch> origin/${base}\`, then \`git cherry-pick <headRefOid>..<old branch>\`. Never drop those commits. If the cherry-pick stops on a conflict, run \`git cherry-pick --abort\`, \`git switch <old branch>\` and \`git branch -D <new branch>\`, then report and wait. MERGED, and HEAD is neither the headRefOid nor past it: report and wait. After a switch the check reads the new branch, which has no pull request. Name a new branch \`followup-${followup.name}-<n>\`, with <n> the first number from 2 up that \`git branch --list\` does not show.\n3. Fix it, run the checks that cover it, and review your diff. Work that needs a kit plan: report it to your lead instead; never run plan-task or build. Other bigger work: use plan mode; the person approves the plan in this terminal.\n4. Make one commit for the finding. When it has an issue, name it in the commit subject as \`(#n)\`, with no closing keyword such as Fixes or Closes: step 6 reads it back from \`git log\`. Beyond a small fix (\`/${PLUGIN}:review\` defines it), then start one second opinion on that commit from \`${PLUGIN}:senior-engineer\`, and the \`${PLUGIN}:edge-case-hunter\` on a risky change as \`/${PLUGIN}:review\` says; this brief allows no other agent. Commit nothing while it runs; its confirmed fixes go in one more commit.\n5. Never push before \`ship\`: your commits stay in this worktree.\n6. Ship only when a message from the lead says \`ship\`. Then run the project's full check locally. Before the push, mark each fixed issue: for every commit of yours that is not yet on \`origin/${base}\` and whose subject names an issue as \`(#n)\`, run \`${COMMAND} issue mark-fixed --issue <n> --base ${base} --branch <your branch> --tip <the full id the commit has on your branch now>\`. Use \`${base}\` as the base: it is the branch your pull request targets, not your own branch. If it says issues are off, skip it. Then push once, and open your pull request (or push to your open one) as \`workflow show\` says. Where that is off, ask the person in this terminal. The pull request body's Fixes lines come from \`${COMMAND} issue fixed --base origin/${base} --head <your branch>\`: never write one by hand. When you push to an open pull request, replace the Fixes lines of its body with what that command prints now: read the body with \`gh pr view <your branch> --json body --jq .body\`, change only those lines, and write it back with \`gh pr edit <your branch> --body-file -\`. If that read fails, report and do not edit. A \`ship\` that arrives while you work on a finding waits until that finding is done. A \`ship\` with nothing to ship: say "nothing to ship" in your report.\n7. Report with \`${COMMAND} herdr report "<the finding, its commit, the pull request link, what failed>"\` after each finding and after each ship.\n`;
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
  base?: StartBase,
): Promise<string> {
  const file = briefPath(stateDir, core, name);
  const taskTrailer = task
    ? `\nYour task: ${task}\nsave a \`Report:\` note with task_note; never take, update or close the task.\n`
    : "";
  const trailer = plan
    ? planTrailer(plan, base)
    : followup
      ? followupTrailer(followup)
      : `${taskTrailer}${base ? startPointTrailer(base) : ""}`;
  await writePrivate(
    file,
    `${text}\n${trailer}${linked ? `\nWhen done or stuck, report with: \`${COMMAND} herdr report "<one paragraph>"\`; write long results to a file and report its path. Start no sessions or agents of your own unless this brief says so. A finding outside your work goes in your report: never ask the person, file an issue or start a session for it.\n` : ""}`,
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
