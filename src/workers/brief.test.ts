/** A worker's brief and its first line (`brief.ts`): D24's git rule, D36's questions. */
import { describe, expect, test } from "bun:test";
import { briefText, firstPrompt } from "./brief";

const FACTS = {
  baseRef: "release-1.0.0",
  branch: "wk/B6b-portal-live",
  files: ["src/portal/server.ts", "src/portal/views.ts"],
  leadName: "LEAD kit master-plan",
  worktree: "/home/user/kit/.claude/worktrees/wk-B6b-portal-live",
  workerName: "W kit B6b portal-live",
};

describe("the brief", () => {
  test("D24, D36: the lead's text, then the frame every worker gets", () => {
    expect(briefText("# B6b\n\nBuild the live stream.\n\n", FACTS)).toBe(
      [
        "# B6b",
        "",
        "Build the live stream.",
        "",
        "---",
        "",
        "## Your frame (written by `cc-smart-dev-kit worker start`)",
        "",
        "- You are the worker `W kit B6b portal-live`, for the lead `LEAD kit master-plan`. You run in the background: nobody watches this session.",
        "- Your worktree is `/home/user/kit/.claude/worktrees/wk-B6b-portal-live`, on the branch `wk/B6b-portal-live`, cut from `release-1.0.0`. Work only there. Anything slow it needs first (a dependency install) is your first step.",
        "- The files this phase owns: `src/portal/server.ts`, `src/portal/views.ts`. Say in your report why you changed any other file.",
        "- Work by `/cc-smart-dev-kit:worker`: it says how to build the phase, how to mark each step, and how to hand it back.",
        "- Git: commit on your branch at each green step. Never push, never open a pull request, never merge: the lead handles git.",
        "- When the phase is ready, hand it back with `cc-smart-dev-kit worker report --status done`; when it cannot be done, with `--status failed` and why.",
        '- Never wait on the lead. Never ask the person and never call AskUserQuestion. When you need a decision, run `cc-smart-dev-kit worker report --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>` (the lead answers, or asks the person), then go on with every part of your phase the question does not block. Report `--status blocked` only when nothing else is left; an answer arrives as your next message.',
        "",
      ].join("\n"),
    );
  });

  test("no files named: no files line", () => {
    expect(briefText("Do it.", { ...FACTS, files: [] })).not.toContain("The files this phase owns");
  });
});

describe("the first line", () => {
  test("who it is, and where its task is: one plain line, no quote and no %", () => {
    const line = firstPrompt(FACTS.workerName, FACTS.leadName, "/s/workers/k/files/x/brief.md");
    expect(line).toBe(
      "You are the worker W kit B6b portal-live for the lead LEAD kit master-plan. Work by /cc-smart-dev-kit:worker. Read /s/workers/k/files/x/brief.md first: it is your task, and it says how you report.",
    );
    expect(line).not.toMatch(/["%\r\n]/);
  });
});
