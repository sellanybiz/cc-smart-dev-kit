import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import {
  awayStateFile,
  clearItems,
  type ParkDraft,
  parkItem,
  readAway,
  setAvailable,
  setUnavailable,
} from "../user-away/state";
import { toolDecision } from "./io";
import { gitGuardHook, userAwayHook } from "./specs";
import { askedWhileAway, userAwayAnswer } from "./user-away";

const SESSION = "11111111-2222-3333-4444-555555555555";
const T0 = Date.parse("2026-10-25T01:00:00.000Z");
const UNTIL = "2026-10-25T07:00:00.000Z";
const OPTIONS = { timeZone: "UTC" };
const SKILL = "/cc-smart-dev-kit:user-unavailable";

/** A machine with the person away since `T0` (back about 07:00), and the paths a hook reads. */
async function away(until: null | string = UNTIL) {
  const env = hookEnv();
  const paths = cliPaths(env);
  await setUnavailable(paths.stateDir, T0, until);
  return { env, paths };
}

function draft(over: Partial<ParkDraft> = {}): ParkDraft {
  return {
    kind: "question",
    text: "Which name?",
    command: null,
    tool: null,
    options: [],
    recommend: null,
    session: SESSION,
    crew: "",
    cwd: "/work/app",
    ...over,
  };
}

function preToolUse(tool: string, toolInput: Record<string, unknown> = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd: "/work/app",
    tool_name: tool,
    tool_input: toolInput,
  };
}

function decisionOf(stdout: string | undefined) {
  return JSON.parse(stdout ?? "{}").hookSpecificOutput;
}

describe("AskUserQuestion and ExitPlanMode", () => {
  test("denied while the person is away, with the step that parks the question", async () => {
    const { env, paths } = await away();
    const result = await userAwayAnswer(
      preToolUse("AskUserQuestion", { questions: [{ question: "Which name?" }] }),
      "PreToolUse",
      env,
      paths,
      T0 + 60_000,
      OPTIONS,
    );
    expect(result).toEqual(
      toolDecision(
        "deny",
        `The person is unavailable since 01:00, back about 07:00: do not wait for an answer. Park the question with \`cc-smart-dev-kit user park --kind question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>\` and go on with whatever it does not block. A choice that is easy to undo, with a recommended option in the plan, you take yourself and park as \`--kind decision\`. The rules: ${SKILL}.`,
      ),
    );
  });

  test("a plan waiting for approval is parked the same way", async () => {
    const { env, paths } = await away(null);
    const result = await userAwayAnswer(
      preToolUse("ExitPlanMode", { plan: "..." }),
      "PreToolUse",
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(result).toEqual(
      toolDecision(
        "deny",
        `The person is unavailable since 01:00: the plan cannot be approved now. Park it with \`cc-smart-dev-kit user park --kind question "Approve the plan: <where it is, in one line>" --option "approve" --option "change it" --recommend 1\`, and go on with what needs no approval: reading, research, notes. The rules: ${SKILL}.`,
      ),
    );
  });

  test("allowed (silent) once the person is available again, and when nothing was ever said", async () => {
    const { env, paths } = await away();
    await setAvailable(paths.stateDir);
    expect(
      await userAwayAnswer(preToolUse("AskUserQuestion"), "PreToolUse", env, paths, T0, OPTIONS),
    ).toEqual({});
    const fresh = hookEnv();
    expect(
      await userAwayAnswer(
        preToolUse("AskUserQuestion"),
        "PreToolUse",
        fresh,
        cliPaths(fresh),
        T0,
        OPTIONS,
      ),
    ).toEqual({});
  });

  test("every other tool is none of its business, away or not", async () => {
    const { env, paths } = await away();
    for (const tool of ["Bash", "Edit", "Agent", "SendMessage"]) {
      expect(await userAwayAnswer(preToolUse(tool), "PreToolUse", env, paths, T0, OPTIONS)).toEqual(
        {},
      );
    }
  });

  test("a state file it cannot read lets the question through, with one line why", async () => {
    const { env, paths } = await away();
    writeFileSync(awayStateFile(paths.stateDir), "{ nope");
    const result = await userAwayAnswer(
      preToolUse("AskUserQuestion"),
      "PreToolUse",
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
    expect(result.stderr).toContain("is not a state file");
  });
});

describe("Claude Code's own permission prompt (PermissionRequest)", () => {
  function permissionRequest(tool: string, toolInput: Record<string, unknown>) {
    return {
      hook_event_name: "PermissionRequest",
      session_id: SESSION,
      cwd: "/work/app",
      tool_name: tool,
      tool_input: toolInput,
    };
  }

  test("while away: denied with a message, and the command parked as an action", async () => {
    const { env, paths } = await away();
    const result = await userAwayAnswer(
      permissionRequest("Bash", { command: "rm -rf build" }),
      "PermissionRequest",
      env,
      paths,
      T0 + 5_000,
      OPTIONS,
    );
    expect(JSON.parse(result.stdout ?? "{}")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: `The person is unavailable since 01:00, back about 07:00, so this was not asked: it is parked as #1, an action that waits for their yes. Do not run it another way; go on with work that does not need it. The rules: ${SKILL}.`,
        },
      },
    });
    expect(readAway(paths.stateDir).items).toEqual([
      {
        id: 1,
        kind: "action",
        text: "Claude Code's own permission prompt: Bash",
        command: "rm -rf build",
        tool: "Bash",
        options: [],
        recommend: null,
        session: SESSION,
        crew: "",
        cwd: "/work/app",
        at: "2026-10-25T01:00:05.000Z",
      },
    ]);
  });

  test("a call that is no shell command is parked by its tool and file", async () => {
    const { env, paths } = await away();
    await userAwayAnswer(
      permissionRequest("Write", { file_path: "/etc/hosts", content: "x" }),
      "PermissionRequest",
      env,
      paths,
      T0,
      OPTIONS,
    );
    const item = readAway(paths.stateDir).items[0];
    expect(item?.command).toBeNull();
    expect(item?.text).toBe("Claude Code's own permission prompt: Write /etc/hosts");
  });

  test("the same prompt asked again is the same parked item", async () => {
    const { env, paths } = await away();
    const input = permissionRequest("Bash", { command: "make deploy" });
    await userAwayAnswer(input, "PermissionRequest", env, paths, T0, OPTIONS);
    const again = await userAwayAnswer(input, "PermissionRequest", env, paths, T0 + 9, OPTIONS);
    expect(readAway(paths.stateDir).items).toHaveLength(1);
    expect(JSON.parse(again.stdout ?? "{}").hookSpecificOutput.decision.message).toContain(
      "parked as #1",
    );
  });

  test("a question tool is denied with the same step as before, parking nothing", async () => {
    const { env, paths } = await away();
    const result = await userAwayAnswer(
      permissionRequest("AskUserQuestion", {}),
      "PermissionRequest",
      env,
      paths,
      T0,
      OPTIONS,
    );
    const decision = decisionOf(result.stdout).decision;
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("Park the question with");
    expect(readAway(paths.stateDir).items).toEqual([]);
  });

  test("available: silent, so Claude Code asks the person as it always did", async () => {
    const { env, paths } = await away();
    await setAvailable(paths.stateDir);
    expect(
      await userAwayAnswer(
        permissionRequest("Bash", { command: "ls" }),
        "PermissionRequest",
        env,
        paths,
        T0,
        OPTIONS,
      ),
    ).toEqual({});
  });

  test("a list that is full still denies, and says to park it by hand", async () => {
    const { env, paths } = await away();
    for (let index = 0; index < 500; index += 1) {
      await parkItem(paths.stateDir, draft({ text: `q${index}` }), T0);
    }
    const result = await userAwayAnswer(
      permissionRequest("Bash", { command: "ls -la" }),
      "PermissionRequest",
      env,
      paths,
      T0,
      OPTIONS,
    );
    const decision = decisionOf(result.stdout).decision;
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("could not be parked");
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
  });
});

describe("a guard that would ask: the frame turns it into a deny and parks the command", () => {
  const ASK = toolDecision("ask", "`git push --force` rewrites the remote's history.");

  test("away: a deny with the guard's own words and the parked item's number", async () => {
    const { env, paths } = await away();
    const result = await askedWhileAway(
      preToolUse("Bash", { command: "git push --force" }),
      ASK,
      env,
      paths,
      T0 + 1_000,
      OPTIONS,
    );
    expect(result).toEqual(
      toolDecision(
        "deny",
        `\`git push --force\` rewrites the remote's history.\n\nThe person is unavailable since 01:00, back about 07:00, so this was not asked: it is parked as #1, an action that waits for their yes. Do not run it another way; go on with work that does not need it. The rules: ${SKILL}.`,
      ),
    );
    expect(readAway(paths.stateDir).items).toEqual([
      {
        id: 1,
        kind: "action",
        text: "Bash: `git push --force` rewrites the remote's history.",
        command: "git push --force",
        tool: "Bash",
        options: [],
        recommend: null,
        session: SESSION,
        crew: "",
        cwd: "/work/app",
        at: "2026-10-25T01:00:01.000Z",
      },
    ]);
  });

  test("a crew session's park names its crew session", async () => {
    const { env, paths } = await away();
    await askedWhileAway(
      preToolUse("Bash", { command: "git push" }),
      ASK,
      { ...env, CC_SMART_DEV_KIT_CREW: "UA1-x-1" },
      paths,
      T0,
      OPTIONS,
    );
    expect(readAway(paths.stateDir).items[0]?.crew).toBe("UA1-x-1");
  });

  test("never looser: a deny stays a deny, an allow stays an allow, silence stays silence", async () => {
    const { env, paths } = await away();
    const input = preToolUse("Bash", { command: "git push" });
    for (const result of [
      toolDecision("deny", "no"),
      toolDecision("allow", "fine"),
      {},
      { stdout: "not json" },
    ]) {
      expect(await askedWhileAway(input, result, env, paths, T0, OPTIONS)).toEqual(result);
    }
    expect(readAway(paths.stateDir).items).toEqual([]);
  });

  test("available: the ask stays an ask", async () => {
    const { env, paths } = await away();
    await setAvailable(paths.stateDir);
    expect(
      await askedWhileAway(
        preToolUse("Bash", { command: "git push" }),
        ASK,
        env,
        paths,
        T0,
        OPTIONS,
      ),
    ).toEqual(ASK);
    expect(readAway(paths.stateDir).items).toEqual([]);
  });

  test("a state file it cannot read keeps the ask, with one line why", async () => {
    const { env, paths } = await away();
    writeFileSync(awayStateFile(paths.stateDir), "{ nope");
    const result = await askedWhileAway(
      preToolUse("Bash", { command: "git push" }),
      ASK,
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(result.stdout).toBe(ASK.stdout);
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
  });

  test("a call that is no shell command (an edit) is parked by its tool and file", async () => {
    const { env, paths } = await away();
    const result = await askedWhileAway(
      preToolUse("Edit", { file_path: "/repo/main/src/a.ts" }),
      toolDecision("ask", "This edit is in the main checkout."),
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(decisionOf(result.stdout).permissionDecision).toBe("deny");
    const item = readAway(paths.stateDir).items[0];
    expect(item?.command).toBeNull();
    expect(item?.tool).toBe("Edit");
    expect(item?.text).toBe("Edit /repo/main/src/a.ts: This edit is in the main checkout.");
  });

  test("a command too long to keep whole is cut, and the item says so", async () => {
    const { env, paths } = await away();
    const long = `echo ${"x".repeat(20_000)}`;
    await askedWhileAway(preToolUse("Bash", { command: long }), ASK, env, paths, T0, OPTIONS);
    const item = readAway(paths.stateDir).items[0];
    expect(item?.command?.length).toBe(16_000);
    expect(item?.text).toContain("The command was cut at 16000 characters.");
  });

  test("through the real git guard: the same push asks when available, denies and parks while away", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { protectedBranches: ["main"] });
    const env = hookEnv();
    const input = preToolUse("Bash", { command: "git push --force origin main" });
    input.cwd = repo;

    const asked = await runHook(gitGuardHook, input, env);
    expect(decisionOf(asked.stdout).permissionDecision).toBe("ask");

    await setUnavailable(cliPaths(env).stateDir, Date.now(), null);
    const denied = await runHook(gitGuardHook, input, env);
    const output = decisionOf(denied.stdout);
    expect(output.permissionDecision).toBe("deny");
    expect(output.permissionDecisionReason).toContain("parked as #1");
    expect(readAway(cliPaths(env).stateDir).items[0]?.command).toBe("git push --force origin main");
  });
});

describe("the note at each prompt", () => {
  const prompt = (text: string, session = SESSION) => ({
    hook_event_name: "UserPromptSubmit",
    session_id: session,
    cwd: "/work/app",
    prompt: text,
  });

  async function note(
    text: string,
    state: { env: Record<string, string>; paths: ReturnType<typeof cliPaths> },
    at = T0,
    session = SESSION,
  ): Promise<string | null> {
    const result = await userAwayAnswer(
      prompt(text, session),
      "UserPromptSubmit",
      state.env,
      state.paths,
      at,
      OPTIONS,
    );
    if (result.stdout === undefined) return null;
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  }

  test("said once, and again only when the state or the count changes", async () => {
    const state = await away();
    // A turn that is not the person's (a monitor's line): the standing note, once.
    const turn = "<task-notification><task-id>x</task-id></task-notification>";
    expect(await note(turn, state)).toBe(
      `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: park what needs them, go on with the rest. Nothing is parked yet.`,
    );
    expect(await note(turn, state)).toBeNull();
    expect(await note(turn, state)).toBeNull();

    await parkItem(state.paths.stateDir, draft(), T0);
    expect(await note(turn, state)).toBe(
      `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: park what needs them, go on with the rest. 1 item is parked.`,
    );
    expect(await note(turn, state)).toBeNull();

    await parkItem(state.paths.stateDir, draft({ text: "another" }), T0);
    expect(await note(turn, state)).toContain("2 items are parked.");
    await clearItems(state.paths.stateDir, [1]);
    expect(await note(turn, state)).toContain("1 item is parked.");
  });

  test("every session hears it once, in its own context", async () => {
    const state = await away();
    const turn = "<task-notification><task-id>x</task-id></task-notification>";
    expect(await note(turn, state, T0, "session-a")).not.toBeNull();
    expect(await note(turn, state, T0, "session-b")).not.toBeNull();
    expect(await note(turn, state, T0, "session-a")).toBeNull();
  });

  test("the person's own prompt: still unavailable, said at every one, and never switching it back", async () => {
    const state = await away();
    await parkItem(state.paths.stateDir, draft(), T0);
    const first = await note("looks good, carry on", state);
    expect(first).toBe(
      "The person wrote, and is still marked unavailable since 01:00, back about 07:00: a message does not switch it back (it may come from a phone). Do what it asks, and keep following /cc-smart-dev-kit:user-unavailable. 1 item waits for /cc-smart-dev-kit:user-available.",
    );
    // Said again at the next one: the person typed, and nothing else changed.
    expect(await note("and one more thing", state)).toBe(first);
    expect(readAway(state.paths.stateDir).unavailable).toBe(true);
    // What they heard counts: the standing note stays quiet after it.
    expect(await note("<task-notification>x</task-notification>", state)).toBeNull();
  });

  test("a message from another session, a hand-back and a Stop hook's block are not the person", async () => {
    const state = await away();
    for (const text of [
      '<cross-session-message from="uds:1" from-name="lead">go</cross-session-message>',
      '<agent-message from="a1">done</agent-message>',
      "Stop hook feedback: report first",
    ]) {
      const said = await note(text, state, T0, `s-${text.length}`);
      expect(said).toStartWith("The person is unavailable since");
    }
  });

  test("a crew session's bare prompt is its lead's, never the person's", async () => {
    const state = await away();
    const env = { ...state.env, CC_SMART_DEV_KIT_CREW: "UA1-x-1" };
    const result = await userAwayAnswer(
      prompt("You are the crew session UA1"),
      "UserPromptSubmit",
      env,
      state.paths,
      T0,
      OPTIONS,
    );
    const text = JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
    expect(text).toStartWith("The person is unavailable since");
  });

  test("back: a session that heard 'unavailable' is told once that the person is available again", async () => {
    const state = await away();
    await parkItem(state.paths.stateDir, draft(), T0);
    await note("go", state);
    await setAvailable(state.paths.stateDir);
    expect(await note("next", state)).toBe(
      "The person is available again: ask your questions as usual. 1 item still waits for them (/cc-smart-dev-kit:user-available).",
    );
    expect(await note("next", state)).toBeNull();
  });

  test("back, with nothing left on the list", async () => {
    const state = await away();
    await note("go", state);
    await setAvailable(state.paths.stateDir);
    expect(await note("next", state)).toBe(
      "The person is available again: ask your questions as usual. Nothing is left parked.",
    );
  });

  test("a session that never heard it is told nothing when the person is available", async () => {
    const state = await away();
    await setAvailable(state.paths.stateDir);
    expect(await note("go", state)).toBeNull();
  });

  test("a prompt with no text is not the person's; a state it cannot read is one line on stderr", async () => {
    const state = await away();
    expect(
      await userAwayAnswer(
        { hook_event_name: "UserPromptSubmit", session_id: SESSION, cwd: "/work/app" },
        "UserPromptSubmit",
        state.env,
        state.paths,
        T0,
        OPTIONS,
      ),
    ).toEqual({
      stdout: expect.stringContaining("The person is unavailable since"),
    });
    writeFileSync(awayStateFile(state.paths.stateDir), "{ nope");
    const result = await userAwayAnswer(
      prompt("hello"),
      "UserPromptSubmit",
      state.env,
      state.paths,
      T0,
      OPTIONS,
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
  });
});

describe("the hook as the frame runs it", () => {
  test("a hook run from the spec: AskUserQuestion denied with no project file, and silent after available", async () => {
    const { repo } = makeClone();
    const env = hookEnv();
    const paths = cliPaths(env);
    await setUnavailable(paths.stateDir, Date.now(), null);
    const input = { ...preToolUse("AskUserQuestion"), cwd: repo };
    const denied = await runHook(userAwayHook, input, env);
    expect(decisionOf(denied.stdout).permissionDecision).toBe("deny");
    await setAvailable(paths.stateDir);
    expect(await runHook(userAwayHook, input, env)).toEqual({});
  });

  test("the file the park wrote is plain JSON", async () => {
    const { env, paths } = await away();
    await userAwayAnswer(
      { ...preToolUse("Bash", { command: "x" }), hook_event_name: "PermissionRequest" },
      "PermissionRequest",
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(JSON.parse(readFileSync(awayStateFile(paths.stateDir), "utf8")).items).toHaveLength(1);
  });
});
