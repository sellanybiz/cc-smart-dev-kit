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
