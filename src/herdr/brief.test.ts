import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { COMMAND, PLUGIN } from "../build-info/names";
import { git, tempDir } from "../testing/temp";
import { followupTrailer, writeBrief } from "./brief";

const LINKED_TAIL = `When done or stuck, report with: \`${COMMAND} herdr report "<one paragraph>"\`; write long results to a file and report its path. Start no sessions or agents of your own unless this brief says so. A finding outside your work goes in your report: never ask the person, file an issue or start a session for it.`;

test("brief is private, carries task and linked reporting only", async () => {
  const state = tempDir();
  const file = await writeBrief(state, "core", "kit-one", "Do the work.", true, "#7");
  expect(file).toBe(`${state}/herdr/briefs/core-kit-one/brief.md`);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
  expect(readFileSync(file, "utf8")).toContain("Your task: #7\n");
  expect(readFileSync(file, "utf8")).toContain("never take, update or close the task");
  const independent = await writeBrief(state, "core", "kit-two", "Independent brief", false);
  expect(readFileSync(independent, "utf8")).toBe("Independent brief\n");
});

test("a plan brief carries the plan trailer in place of the task trailer", async () => {
  const state = tempDir();
  const fresh = await writeBrief(state, "core", "kit-alpha", "Build it.", true, "#7", {
    slug: "alpha",
    handoutId: "habc",
    base: "trunk",
    resume: false,
  });
  expect(readFileSync(fresh, "utf8")).toBe(
    [
      "Build it.",
      "",
      "Your plan: alpha. You build this one plan and nothing else.",
      '1. Take it with task_take: task "alpha", from "habc".',
      "2. Run `git fetch origin trunk`. If it fails, run it once more; if it fails again, stop and report the error, and never build on a stale ref. Then run `git reset --hard origin/trunk`: your worktree's own branch is the plan branch. Then save where you started: task_update on the plan with base set to the output of `git rev-parse HEAD`.",
      `3. Run \`/${PLUGIN}:build\` on this plan only. Builder subagents are allowed; start no other sessions. Never start the next queued plan, whatever the build skill says.`,
      "4. Push, pull request and merge follow `workflow show`. Where they are off, ask the person in this terminal.",
      `5. Report with \`${COMMAND} herdr report "<the pull request link, what shipped, what failed>"\`. Then stop. Never take another plan.`,
      "",
      LINKED_TAIL,
      "",
    ].join("\n"),
  );
  const resumed = await writeBrief(state, "core", "kit-beta", "Build it.", true, undefined, {
    slug: "beta",
    handoutId: "hxyz",
    base: "trunk",
    resume: true,
  });
  const text = readFileSync(resumed, "utf8");
  expect(text).toContain(
    "2. This is a resume: the worktree already holds this plan's work. Do not fetch and do not reset it.",
  );
  expect(text).not.toContain("git fetch");
  expect(text).not.toContain("Your task:");
});

const FOLLOWUP_HEAD = `You are your lead's follow-up child for this repository. The brief above is the first finding. Later findings arrive as messages that start with "Follow-up". You never stop on your own: after each report, wait for the next message. You end only when the lead runs \`${COMMAND} herdr stop\`.`;
const FOLLOWUP_STEPS = [
  "Once, before the first finding:",
  "1. Run `git fetch origin trunk`. If it fails, run it once more; if it fails again, report the error and take no finding until step 1 has run. Then run `git branch --show-current` for your branch name, `git rev-list --count HEAD --not --exclude=<your branch> --branches --exclude=origin/<your branch> --remotes` (your own commits: those on no other branch) and `git status --porcelain`. Only when the count is 0 and the status is empty, run `git reset --hard origin/trunk`. Otherwise never reset: this worktree may hold work. (Your worktree may start from the lead's branch or an old default branch.)",
  "For each finding:",
  '2. Run `gh pr list --head <your branch> --state all --json state,headRefOid,createdAt`. If it fails (not logged in, no network), report the error and wait: never read a failure as "no pull request". An empty list means none: go on. If several are listed, an OPEN one wins; otherwise read the newest (`createdAt`). OPEN: add your commit to this branch; it joins that pull request when you ship (step 6). CLOSED without a merge: never reset. Keep the branch; the next ship opens a new pull request from it; say so in your report. MERGED, and `git rev-parse HEAD` equals the headRefOid: the branch is fully merged. Run `git fetch origin trunk`, then `git switch -c <new branch> origin/trunk`. The switch carries uncommitted changes, or refuses: then report and wait. MERGED, and `git merge-base --is-ancestor <headRefOid> HEAD` succeeds with HEAD not equal to the headRefOid: you hold commits that were not merged. Run `git fetch origin trunk`, `git switch -c <new branch> origin/trunk`, then `git cherry-pick <headRefOid>..<old branch>`. Never drop those commits. If the cherry-pick stops on a conflict, run `git cherry-pick --abort`, `git switch <old branch>` and `git branch -D <new branch>`, then report and wait. MERGED, and HEAD is neither the headRefOid nor past it: report and wait. After a switch the check reads the new branch, which has no pull request. Name a new branch `followup-kit-fu-<n>`, with <n> the first number from 2 up that `git branch --list` does not show.',
  "3. Fix it, run the checks that cover it, and review your diff. Beyond a small fix (`/" +
    PLUGIN +
    ":review` defines it), get one second opinion from `" +
    PLUGIN +
    ":senior-engineer` before the commit: this brief allows that agent and no other. Work that needs a kit plan: report it to your lead instead; never run plan-task or build. Other bigger work: use plan mode; the person approves the plan in this terminal.",
  "4. Make one commit for the finding.",
  "5. Never push before `ship`: your commits stay in this worktree.",
  `6. Ship only when a message from the lead says \`ship\`. Then run the project's full check locally. Before the push, mark each fixed issue: for every commit of yours that is not yet on \`origin/trunk\` and has an issue number, run \`${COMMAND} issue mark-fixed --issue <n> --base trunk --branch <your branch> --tip <the full id the commit has on your branch now>\`. Use \`trunk\` as the base: it is the branch your pull request targets, not your own branch. If it says issues are off, skip it. Then push once, and open your pull request (or push to your open one) as \`workflow show\` says. Where that is off, ask the person in this terminal. The pull request body's Fixes lines come from \`${COMMAND} issue fixed --base origin/trunk --head <your branch>\`: never write one by hand. A \`ship\` that arrives while you work on a finding waits until that finding is done. A \`ship\` with nothing to ship: say "nothing to ship" in your report.`,
  `7. Report with \`${COMMAND} herdr report "<the finding, its commit, the pull request link, what failed>"\` after each finding and after each ship.`,
];

test("a follow-up brief carries the follow-up trailer, with its issues and held plans when there are some", async () => {
  const state = tempDir();
  const full = await writeBrief(state, "core", "kit-fu", "Fix the thing.", true, "#7", undefined, {
    base: "trunk",
    name: "kit-fu",
    issues: ["12", "7"],
    held: [
      { slug: "alpha", files: ["src/a/", "src/b.ts"] },
      { slug: "beta", files: [] },
    ],
  });
  expect(readFileSync(full, "utf8")).toBe(
    [
      "Fix the thing.",
      "",
      FOLLOWUP_HEAD,
      "",
      'The first findings are filed as #12, #7. A later message names its own issue as "Follow-up [#n]".',
      "",
      "These plans hold files now (a snapshot; a later message names new ones):",
      "- alpha: src/a/, src/b.ts",
      "- beta: no file list",
      "Never edit a file a plan holds. Report the finding instead: the lead treats it as part of that plan.",
      "",
      ...FOLLOWUP_STEPS,
      "",
      LINKED_TAIL,
      "",
    ].join("\n"),
  );
  const bare = await writeBrief(state, "core", "kit-fu2", "Fix it.", true, undefined, undefined, {
    base: "trunk",
    name: "kit-fu",
    issues: [],
    held: [],
  });
  expect(readFileSync(bare, "utf8")).toBe(
    ["Fix it.", "", FOLLOWUP_HEAD, "", ...FOLLOWUP_STEPS, "", LINKED_TAIL, ""].join("\n"),
  );
});

test("the follow-up trailer says what to do in each pull request state, and when to ship", () => {
  const text = followupTrailer({ base: "trunk", name: "kit-fu", issues: [], held: [] });
  // Open: the commit joins the branch; nothing is pushed to an open pull request before a ship.
  expect(text).toContain(
    "OPEN: add your commit to this branch; it joins that pull request when you ship",
  );
  expect(text).toContain("5. Never push before `ship`: your commits stay in this worktree.");
  expect(text).not.toContain("free backup");
  // Merged, head equals the pull request's head: a new branch from the base, never a reset.
  expect(text).toContain(
    "MERGED, and `git rev-parse HEAD` equals the headRefOid: the branch is fully merged. Run `git fetch origin trunk`, then `git switch -c <new branch> origin/trunk`.",
  );
  // Past it: the commands in full, a conflict is aborted, a branch that is neither is reported.
  expect(text).toContain(
    "MERGED, and `git merge-base --is-ancestor <headRefOid> HEAD` succeeds with HEAD not equal to the headRefOid: you hold commits that were not merged. Run `git fetch origin trunk`, `git switch -c <new branch> origin/trunk`, then `git cherry-pick <headRefOid>..<old branch>`. Never drop those commits.",
  );
  expect(text).toContain(
    "If the cherry-pick stops on a conflict, run `git cherry-pick --abort`, `git switch <old branch>` and `git branch -D <new branch>`, then report and wait.",
  );
  expect(text).toContain(
    "MERGED, and HEAD is neither the headRefOid nor past it: report and wait.",
  );
  // Closed without a merge: no reset at all. The only reset is step 1's, at the start.
  expect(text).toContain(
    "CLOSED without a merge: never reset. Keep the branch; the next ship opens a new pull request from it; say so in your report.",
  );
  expect(text.match(/git reset --hard/g)).toHaveLength(1);
  // A failed gh call is no pull request; a new branch is named after the child.
  expect(text).toContain('never read a failure as "no pull request"');
  expect(text).toContain("Name a new branch `followup-kit-fu-<n>`");
  // The reset check counts the child's own commits, not those past the base.
  expect(text).toContain(
    "`git rev-list --count HEAD --not --exclude=<your branch> --branches --exclude=origin/<your branch> --remotes`",
  );
  expect(text).not.toContain("rev-list --count origin/trunk..HEAD");
  // Ship: only on a lead message, mid-finding waits, nothing to ship is said.
  expect(text).toContain("Ship only when a message from the lead says `ship`.");
  // The mark comes at ship, before the push, with the commit's id on the shipping branch.
  expect(text).toContain("Before the push, mark each fixed issue");
  expect(text.indexOf("issue mark-fixed")).toBeGreaterThan(text.indexOf("6. Ship only"));
  expect(text.match(/issue mark-fixed/g)).toHaveLength(1);
  // The second opinion is allowed from one agent; a kit plan goes back to the lead.
  expect(text).toContain("this brief allows that agent and no other");
  expect(text).toContain("never run plan-task or build");
  // A failed first fetch takes no finding; a closed pull request is reported.
  expect(text).toContain("take no finding until step 1 has run");
  expect(text).toContain("the next ship opens a new pull request from it; say so in your report.");
  // The "never ask, file or start" line lives in the linked text, once.
  expect(text).not.toContain("Never ask the person, file an issue");
  expect(text).toContain("arrives while you work on a finding waits until that finding is done");
  expect(text).toContain('A `ship` with nothing to ship: say "nothing to ship" in your report.');
});

test("the reset check of step 1 counts only the child's own commits, in real git", () => {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main", "origin.git", "--bare");
  const work = tempDir();
  git(work, "init", "-q", "-b", "main");
  git(work, "remote", "add", "origin", `${dir}/origin.git`);
  git(work, "commit", "-q", "--allow-empty", "-m", "base");
  git(work, "push", "-q", "origin", "main");
  // The lead's plan branch holds a commit the base lacks; the child's worktree is cut from it.
  git(work, "switch", "-q", "-c", "lead-plan");
  git(work, "commit", "-q", "--allow-empty", "-m", "lead work");
  git(work, "switch", "-q", "-c", "worktree-kit-fu");
  // The args are step 1's, as the trailer words them.
  const own = (branch: string) =>
    Number(
      git(
        work,
        "rev-list",
        "--count",
        "HEAD",
        "--not",
        `--exclude=${branch}`,
        "--branches",
        `--exclude=origin/${branch}`,
        "--remotes",
      ),
    );
  // Past the base by the lead's commit, but none of it is the child's: it may reset.
  expect(own("worktree-kit-fu")).toBe(0);
  git(work, "commit", "-q", "--allow-empty", "-m", "child work");
  expect(own("worktree-kit-fu")).toBe(1);
  // Pushed, the commit is still its own: a relaunched child must not reset it away.
  git(work, "push", "-q", "origin", "worktree-kit-fu");
  git(work, "fetch", "-q", "origin");
  expect(own("worktree-kit-fu")).toBe(1);
});
