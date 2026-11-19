import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { COMMAND, PLUGIN } from "../build-info/names";
import { tempDir } from "../testing/temp";
import { writeBrief } from "./brief";

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
      `A finding outside your plan goes in \`${COMMAND} herdr report\`. Never ask the person, file an issue or start a session for it.`,
      "",
      `When done or stuck, report with: \`${COMMAND} herdr report "<one paragraph>"\`; write long results to a file and report its path. Start no sessions or agents of your own unless this brief says so.`,
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
  "1. Run `git fetch origin trunk`. If it fails, run it once more; if it fails again, report the error and stop. Then run `git rev-list --count origin/trunk..HEAD` and `git status --porcelain`. Only when the count is 0 and the status is empty, run `git reset --hard origin/trunk`. Otherwise never reset: this worktree may hold work. (Your worktree may start from the lead's branch or an old default branch.)",
  "For each finding:",
  "2. Run `gh pr view --json state` on your branch. OPEN: add your commit to that pull request. MERGED or CLOSED: run `git fetch origin trunk` and `git reset --hard origin/trunk` (that work is in the merged pull request), then open a new one. No pull request: go on.",
  "3. A small fix: fix it, run the checks that cover it, and review your diff. Bigger work: use plan mode; the person approves the plan in this terminal.",
  "4. Make one commit for the finding.",
  `5. When the finding has an issue number, run \`${COMMAND} issue mark-fixed --issue <n> --base trunk --branch <your branch> --tip <the full id of that commit>\`. If it says issues are off, skip it.`,
  `6. Push and pull request follow \`workflow show\`. Where they are off, ask the person in this terminal. The pull request body's Fixes lines come from \`${COMMAND} issue fixed --base origin/trunk --head <your branch>\`: never write one by hand. Before the pull request opens, a push is a free backup. After it opens, collect the fixes of a round, run the full check locally, then push once; never push one fix at a time.`,
  `7. Report with \`${COMMAND} herdr report "<the finding, its commit, the pull request link, what failed>"\`.`,
  "A finding of your own goes in your report. Never ask the person, file an issue or start a session for it.",
];
const LINKED_TAIL = `When done or stuck, report with: \`${COMMAND} herdr report "<one paragraph>"\`; write long results to a file and report its path. Start no sessions or agents of your own unless this brief says so.`;

test("a follow-up brief carries the follow-up trailer, with its issues and held plans when there are some", async () => {
  const state = tempDir();
  const full = await writeBrief(state, "core", "kit-fu", "Fix the thing.", true, "#7", undefined, {
    base: "trunk",
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
    issues: [],
    held: [],
  });
  expect(readFileSync(bare, "utf8")).toBe(
    ["Fix it.", "", FOLLOWUP_HEAD, "", ...FOLLOWUP_STEPS, "", LINKED_TAIL, ""].join("\n"),
  );
});
