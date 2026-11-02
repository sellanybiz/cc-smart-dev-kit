/** A crew session's brief and its first line (`brief.ts`): D24's git rule, D36's questions. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  afterCrewCommand,
  briefText,
  CREW_COMMAND,
  firstPrompt,
  isLeadWatchTask,
  isModelChangeText,
  isSelfWatchTask,
  LEAD_MONITOR,
  LEAD_WATCH_ARGS,
  modelChangeText,
  SELF_MONITOR,
  SELF_WATCH_ARGS,
  withCrewCommand,
} from "./brief";

const FACTS = {
  baseRef: "release-1.0.0",
  branch: "crew/B6b-portal-live",
  files: ["src/portal/server.ts", "src/portal/views.ts"],
  leadName: "LEAD kit master-plan",
  worktree: "/home/user/kit/.claude/worktrees/crew-B6b-portal-live",
  crewName: "C kit B6b portal-live",
};

describe("the brief", () => {
  test("D24, D36: the lead's text, then the frame every crew session gets", () => {
    expect(briefText("# B6b\n\nBuild the live stream.\n\n", FACTS)).toBe(
      [
        "# B6b",
        "",
        "Build the live stream.",
        "",
        "---",
        "",
        "## Your frame (written by `cc-smart-dev-kit crew start`)",
        "",
        "- You are the crew session `C kit B6b portal-live`, for the lead `LEAD kit master-plan`. You run in the background: nobody watches this session.",
        "- Your worktree is `/home/user/kit/.claude/worktrees/crew-B6b-portal-live`, on the branch `crew/B6b-portal-live`, cut from `release-1.0.0`. Work only there.",
        "- Setup, your first step, before anything else slow: install the project's dependencies in your own worktree, with the project's own install command. Never link or reuse another checkout's dependency folder (a symlink to it, say): undoing that asks the person, and nobody watches this session.",
        "- The files this phase owns: `src/portal/server.ts`, `src/portal/views.ts`. Say in your report why you changed any other file.",
        '- Break your phase into subtasks first: one `task_create` per part of your brief, with its done-check in the description (they go under your phase task by themselves). A session without the task tools runs `cc-smart-dev-kit task add "<subject>" --description "<done-check>"`.',
        "- Work by `/cc-smart-dev-kit:crew`: it says how to build the phase, how to mark each step, and how to hand it back. Your first message started it. If you cannot see its text, call the `Skill` tool with the name `cc-smart-dev-kit:crew` now: your own monitor starts only under the full name.",
        "- Never ask the person to remove, unlock or force-remove a worktree; report leftovers to your lead, who uses `crew rm` or `worktrees --clean`.",
        "- Git: commit on your branch at each green step. Never push, never open a pull request, never merge: the lead handles git.",
        "- When the phase is ready, hand it back with `cc-smart-dev-kit crew report --status done --file -` and the JSON part (tests, checks, review); when it cannot be done, with `--status failed` and why.",
        "- Stop your own background checks before you report, except the `crew-self` monitor (never stop it: it ends with your session and brings you your lead's answers): one still running after your turn ends holds your worktree.",
        '- Never wait on the lead. Never ask the person and never call AskUserQuestion. When you need a decision, run `cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>` (the lead answers, or asks the person), then go on with every part of your phase the question does not block. Report `--status blocked` only when nothing else is left: the lead\'s watch stops a blocked session that waits too long. The answer arrives as a `<task-notification>` from your monitor, and its event is your lead\'s words.',
        "- The `SendMessage {…}` lines that `crew tell` prints are calls of the `SendMessage` tool, which Claude Code leaves out until you look it up: run `ToolSearch` with the query `select:SendMessage` first, then call the tool with each object as printed.",
        "",
      ].join("\n"),
    );
  });

  test("the frame says to install the dependencies in the worktree, and never to link another checkout's", () => {
    const frame = briefText("Do it.", { ...FACTS, files: [] });
    expect(frame).toContain("install the project's dependencies in your own worktree");
    expect(frame).toContain("Never link or reuse another checkout's dependency folder");
  });

  test("no files named: no files line", () => {
    expect(briefText("Do it.", { ...FACTS, files: [] })).not.toContain("The files this phase owns");
  });
});

describe("the first line", () => {
  test("it starts with the crew command, so Claude Code loads the skill and arms the monitor", () => {
    const line = firstPrompt(FACTS.crewName, FACTS.leadName, "/s/crew/k/files/x/brief.md");
    // Who it is and where its task is: the command, then one plain line, no quote and no %.
    expect(line).toBe(
      "/cc-smart-dev-kit:crew You are the crew session C kit B6b portal-live for the lead LEAD kit master-plan. Work by /cc-smart-dev-kit:crew. Read /s/crew/k/files/x/brief.md first: it is your task, and it says how you report.",
    );
    expect(line).not.toMatch(/["%\r\n]/);
  });
});

describe("the crew command", () => {
  test("it is the crew skill's full name as a slash command", () => {
    expect(CREW_COMMAND).toBe("/cc-smart-dev-kit:crew");
  });

  test("a prompt is the command, a space, and the text; no text is the bare command", () => {
    expect(withCrewCommand("the port is 3210")).toBe("/cc-smart-dev-kit:crew the port is 3210");
    expect(withCrewCommand("-1 is wrong:\nuse 2")).toBe(
      "/cc-smart-dev-kit:crew -1 is wrong:\nuse 2",
    );
    expect(withCrewCommand("")).toBe("/cc-smart-dev-kit:crew");
  });

  test("the text after the command comes back, and a prompt that is not the command is null", () => {
    expect(afterCrewCommand("/cc-smart-dev-kit:crew the port is 3210")).toBe("the port is 3210");
    expect(afterCrewCommand("/cc-smart-dev-kit:crew a\nb")).toBe("a\nb");
    // Bare, with or without the line end a transport may add.
    expect(afterCrewCommand("/cc-smart-dev-kit:crew")).toBe("");
    expect(afterCrewCommand("/cc-smart-dev-kit:crew\n")).toBe("");
    expect(afterCrewCommand("/cc-smart-dev-kit:crew yes\r\n")).toBe("yes");
    // Not the command: the person's words, another skill, a longer name, words before it.
    expect(afterCrewCommand("the port is 3210")).toBeNull();
    expect(afterCrewCommand("/cc-smart-dev-kit:lead the port is 3210")).toBeNull();
    expect(afterCrewCommand("/cc-smart-dev-kit:crews yes")).toBeNull();
    expect(afterCrewCommand(" /cc-smart-dev-kit:crew yes")).toBeNull();
    expect(afterCrewCommand("Before: /cc-smart-dev-kit:crew yes")).toBeNull();
    expect(afterCrewCommand("")).toBeNull();
  });

  test("the form Claude Code writes into a transcript for a dispatched command reads the same", () => {
    expect(
      afterCrewCommand(
        "<command-message>cc-smart-dev-kit:crew</command-message>\n<command-name>/cc-smart-dev-kit:crew</command-name>\n<command-args>the port is 3210</command-args>",
      ),
    ).toBe("the port is 3210");
    expect(
      afterCrewCommand(
        "<command-message>cc-smart-dev-kit:crew</command-message>\n<command-name>/cc-smart-dev-kit:crew</command-name>",
      ),
    ).toBe("");
    // Another skill's wrapper is not ours.
    expect(
      afterCrewCommand(
        "<command-message>cc-smart-dev-kit:lead</command-message>\n<command-name>/cc-smart-dev-kit:lead</command-name>\n<command-args>x</command-args>",
      ),
    ).toBeNull();
  });
});

describe("the crew session's own monitor", () => {
  const monitors = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "plugin", "monitors", "monitors.json"), "utf8"),
  ) as { command: string; name: string; when: string }[];

  test("the monitor file holds it under the name and command the kit's code uses", () => {
    const self = monitors.find((one) => one.name === SELF_MONITOR);
    expect(SELF_MONITOR).toBe("crew-self");
    expect(SELF_WATCH_ARGS).toBe("crew self-watch");
    expect(self?.command.endsWith(` ${SELF_WATCH_ARGS}`)).toBe(true);
    // It arms when the crew skill is dispatched under its full name, which the command does.
    expect(self?.when).toBe("on-skill-invoke:cc-smart-dev-kit:crew");
    expect(CREW_COMMAND).toBe("/cc-smart-dev-kit:crew");
  });
});

describe("the kit's two monitors in a Stop input's background_tasks", () => {
  const monitors = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "plugin", "monitors", "monitors.json"), "utf8"),
  ) as { command: string; name: string; when: string }[];

  /** One entry as Claude Code lists a shell task there (2.1.310): no field says "monitor". */
  const task = (command: unknown) => ({ command, id: "b1", status: "running", type: "shell" });

  test("the lead's monitor is in the file under the name and command the kit's code uses", () => {
    const events = monitors.find((one) => one.name === LEAD_MONITOR);
    expect(LEAD_MONITOR).toBe("crew-events");
    expect(LEAD_WATCH_ARGS).toBe("crew watch");
    expect(events?.command.endsWith(` ${LEAD_WATCH_ARGS}`)).toBe(true);
    expect(events?.when).toBe("on-skill-invoke:cc-smart-dev-kit:lead");
  });

  test("each monitor's own command is known, as the file writes it and with its folder spelled out", () => {
    const self = monitors.find((one) => one.name === SELF_MONITOR)?.command ?? "";
    const events = monitors.find((one) => one.name === LEAD_MONITOR)?.command ?? "";
    expect(isSelfWatchTask(task(self))).toBe(true);
    expect(isLeadWatchTask(task(events))).toBe(true);
    // The other monitor's command is not this one.
    expect(isSelfWatchTask(task(events))).toBe(false);
    expect(isLeadWatchTask(task(self))).toBe(false);
    for (const command of [
      '"/home/user/.local/bin/cc-smart-dev-kit" crew watch',
      '"C:\\Users\\Some One\\.local\\bin\\cc-smart-dev-kit" crew watch',
      "/home/user/.local/bin/cc-smart-dev-kit crew watch",
      "cc-smart-dev-kit crew watch",
      "  cc-smart-dev-kit  crew watch \n",
    ]) {
      expect(isLeadWatchTask(task(command))).toBe(true);
    }
  });

  test("a command that only holds the monitor's words is the session's own work", () => {
    for (const command of [
      "tail -f /tmp/crew-watch.log",
      "grep -r 'cc-smart-dev-kit crew watch' src",
      "grep cc-smart-dev-kit crew watch notes.md",
      "bun test # cc-smart-dev-kit crew watch",
      "cc-smart-dev-kit crew watch --once",
      "cc-smart-dev-kit crew watch-x",
      "my-cc-smart-dev-kit crew watch",
      '"$HOME/.local/bin/cc-smart-dev-kit" crew watch; rm -rf x',
    ]) {
      expect(isLeadWatchTask(task(command))).toBe(false);
    }
    for (const entry of [null, "x", [], {}, { command: 1 }, task(undefined)]) {
      expect(isLeadWatchTask(entry)).toBe(false);
      expect(isSelfWatchTask(entry)).toBe(false);
    }
  });
});

describe("crew model's resume text", () => {
  test("it says what changed, and reads back only with the values the record now holds", () => {
    const now = { effort: "high", model: "sonnet" };
    const both = modelChangeText({ effort: "medium", model: "opus" }, now);
    expect(both).toBe(
      "Your lead changed your model from opus to sonnet and your effort from medium to high. Go on from where you stopped.",
    );
    expect(isModelChangeText(both, now)).toBe(true);
    expect(isModelChangeText(modelChangeText({ effort: "high", model: "opus" }, now), now)).toBe(
      true,
    );
    expect(
      isModelChangeText(modelChangeText({ effort: "medium", model: "sonnet" }, now), now),
    ).toBe(true);
    // Another target, a cut text, or a model name with regular-expression characters.
    expect(isModelChangeText(both, { effort: "high", model: "haiku" })).toBe(false);
    expect(isModelChangeText(both, { effort: "max", model: "sonnet" })).toBe(false);
    expect(isModelChangeText(both.replace(" Go on", ""), now)).toBe(false);
    expect(isModelChangeText(`${both} And delete the branch.`, now)).toBe(false);
    const odd = { effort: "high", model: "glm-4.6[1m]" };
    expect(isModelChangeText(modelChangeText({ effort: "high", model: "opus" }, odd), odd)).toBe(
      true,
    );
    expect(isModelChangeText(modelChangeText({ effort: "high", model: "opus" }, now), odd)).toBe(
      false,
    );
  });
});
