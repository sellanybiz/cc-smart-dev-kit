import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { withLock } from "../setup/lock";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import {
  awayDir,
  awayStateFile,
  clearItems,
  type ParkDraft,
  parkItem,
  readAway,
  setAvailable,
  setUnavailable,
} from "../user-away/state";
import type { OwnerSources } from "../user-away/whose";
import { askLogFile } from "./ask-log";
import { BUDGET_MARGIN_MS } from "./budget";
import { toolDecision } from "./io";
import { gitGuardHook, userAwayHook } from "./specs";
import { askedWhileAway, userAwayAnswer } from "./user-away";

const SESSION = "11111111-2222-3333-4444-555555555555";
const T0 = Date.parse("2026-10-25T01:00:00.000Z");
const UNTIL = "2026-10-25T07:00:00.000Z";
/** No session runs, and a folder under /work/<name> is project <name>: nothing reads this machine. */
const NO_OWNERS: OwnerSources = {
  sessions: () => [],
  projectOf: (cwd) => /^\/work\/([^/]+)/.exec(cwd)?.[1] ?? cwd,
};
const OPTIONS = { timeZone: "UTC", owners: NO_OWNERS };
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
    expect(item?.text).toBe(
      `Claude Code's own permission prompt: Write /etc/hosts {"content":"x"}`,
    );
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

  test("the kit's own `user available`, `user status` and `user list` are silent: the person who is back answers Claude Code's prompt", async () => {
    const { env, paths } = await away();
    for (const command of [
      "cc-smart-dev-kit user available",
      "cc-smart-dev-kit user status --json",
      "cc-smart-dev-kit user list --json",
      "cc-smart-dev-kit user list",
      "/home/user/.local/bin/cc-smart-dev-kit user status",
    ]) {
      const result = await userAwayAnswer(
        permissionRequest("Bash", { command }),
        "PermissionRequest",
        env,
        paths,
        T0,
        OPTIONS,
      );
      expect({ command, result }).toEqual({ command, result: {} });
    }
    expect(readAway(paths.stateDir).items).toEqual([]);
  });

  test("nothing gets looser: a line that holds more than the three reads is still parked", async () => {
    const { env, paths } = await away();
    for (const command of [
      "cc-smart-dev-kit user available; rm -rf build",
      "cc-smart-dev-kit user available && make deploy",
      "cc-smart-dev-kit user list --json > /etc/hosts",
      "cc-smart-dev-kit user list $(rm -rf build)",
      "cc-smart-dev-kit user clear --all",
      "cc-smart-dev-kit user park --kind action x --command y",
      "cc-smart-dev-kit user unavailable",
      "cc-smart-dev-kit doctor",
      "echo cc-smart-dev-kit user available",
      "FOO=1 cc-smart-dev-kit user available",
      // Another program that holds the kit's name among its arguments runs that program, not the kit.
      "bash -c 'rm -rf build' cc-smart-dev-kit user available",
      "sh ./deploy.sh cc-smart-dev-kit user status",
      "make deploy cc-smart-dev-kit user list --json",
      "ssh prod.example.com cc-smart-dev-kit user available",
      "node evil.js /opt/x/dist/cli.js user available",
      "bun x.ts /opt/x/dist/cli.js user available",
      "docker run --rm -v /:/h alpine cc-smart-dev-kit user status",
    ]) {
      const result = await userAwayAnswer(
        permissionRequest("Bash", { command }),
        "PermissionRequest",
        env,
        paths,
        T0,
        OPTIONS,
      );
      expect({ command, behavior: decisionOf(result.stdout)?.decision?.behavior }).toEqual({
        command,
        behavior: "deny",
      });
    }
  });

  test("a lock held too long still denies, inside the margin a guard keeps for its answer", async () => {
    const { env, paths } = await away();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = withLock(awayDir(paths.stateDir), () => held);
    await Bun.sleep(50);
    const started = Date.now();
    const result = await userAwayAnswer(
      permissionRequest("Bash", { command: "make deploy" }),
      "PermissionRequest",
      env,
      paths,
      T0,
      OPTIONS,
    );
    const waitedMs = Date.now() - started;
    release();
    await holding;
    expect(decisionOf(result.stdout).decision.message).toContain("could not be parked");
    // A guard that kept its own budget (8 s of 10, 25 of 30) has BUDGET_MARGIN_MS left, and the
    // park must fit in it: a hook the host kills answers nothing, and `onFailure: block` then
    // blocks the call with no word to the session.
    expect(waitedMs).toBeLessThan(BUDGET_MARGIN_MS);
  });

  test("a list that is full still denies, and says to park it by hand", async () => {
    const { env, paths } = await away();
    // The list at its cap, written once: 500 locked, fsynced parks one after the other would
    // test how fast the disk is (they ran past the test timeout on a busy machine), not the cap.
    const full = readAway(paths.stateDir);
    full.items = Array.from({ length: 500 }, (_, index) => ({
      ...draft({ text: `q${index}` }),
      id: index + 1,
      at: "2026-10-25T01:00:00.000Z",
    }));
    full.nextId = 501;
    writeFileSync(awayStateFile(paths.stateDir), JSON.stringify(full));
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

  test("back: a session that heard 'unavailable' is told once that the person is available again", async () => {
    const state = await away();
    await parkItem(state.paths.stateDir, draft(), T0);
    await note("go", state);
    await setAvailable(state.paths.stateDir);
    expect(await note("next", state)).toBe(
      "The person is available again: ask your questions as usual. 1 item waits for this session: go through it with /cc-smart-dev-kit:user-available.",
    );
    expect(await note("next", state)).toBeNull();
  });

  test("back: the note counts this session's items, and names the sessions the others wait in", async () => {
    const state = await away();
    await parkItem(state.paths.stateDir, draft(), T0);
    await parkItem(
      state.paths.stateDir,
      draft({ session: "sess-peer", cwd: "/work/shop", text: "Ship the build?" }),
      T0,
    );
    await note("go", state);
    await setAvailable(state.paths.stateDir);
    const result = await userAwayAnswer(
      prompt("next"),
      "UserPromptSubmit",
      state.env,
      state.paths,
      T0,
      {
        ...OPTIONS,
        owners: {
          ...NO_OWNERS,
          sessions: () => [{ pid: 7, sessionId: "sess-peer", cwd: "/work/shop", name: "shop fix" }],
        },
      },
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toBe(
      "The person is available again: ask your questions as usual. 1 item waits for this session: go through it with /cc-smart-dev-kit:user-available. 1 item waits in other sessions, which go through their own: shop fix (1).",
    );
  });

  test("back: the note's git calls stay inside the hook's budget, and a project it had no time for is never this session's", async () => {
    const repo = join(tempDir("away-repo"), "app");
    mkdirSync(repo);
    git(repo, "init", "-q");
    // `startedAt` is the frame's clock at the hook's start, which the budget counts from.
    const backWith = async (budget: Record<string, string>, startedAt: number) => {
      const state = await away();
      // A session that ended parked it in this repo: this session's, when the repo can be read.
      await parkItem(state.paths.stateDir, draft({ session: "sess-ended", cwd: repo }), T0);
      await note("go", state);
      await setAvailable(state.paths.stateDir);
      const result = await userAwayAnswer(
        { ...prompt("next"), cwd: repo },
        "UserPromptSubmit",
        { ...state.env, ...budget },
        state.paths,
        startedAt,
        { timeZone: "UTC", owners: { sessions: () => [] } },
      );
      return JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
    };
    const mine =
      "The person is available again: ask your questions as usual. 1 item waits for this session: go through it with /cc-smart-dev-kit:user-available.";
    const noTime =
      "The person is available again: ask your questions as usual. 1 item was parked in another project by a session that ended: /cc-smart-dev-kit:user-available asks whether to take it here.";
    expect(await backWith({}, Date.now())).toBe(mine);
    expect(await backWith({ CC_SMART_DEV_KIT_GUARD_BUDGET_MS: "1" }, Date.now())).toBe(noTime);
    // A hook that already spent its time (a long wait for the state's lock) makes no git call.
    expect(await backWith({}, Date.now() - 20_000)).toBe(noTime);
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

describe("what the review found", () => {
  const permissionRequest = (tool: string, toolInput: Record<string, unknown>) => ({
    hook_event_name: "PermissionRequest",
    session_id: SESSION,
    cwd: "/work/app",
    tool_name: tool,
    tool_input: toolInput,
  });

  test("two prompts of one tool for different targets are two items, each naming its target", async () => {
    const { env, paths } = await away();
    const ask = (tool: string, toolInput: Record<string, unknown>) =>
      userAwayAnswer(
        permissionRequest(tool, toolInput),
        "PermissionRequest",
        env,
        paths,
        T0,
        OPTIONS,
      );
    await ask("WebFetch", { url: "https://example.com/a", prompt: "x" });
    await ask("WebFetch", { url: "https://example.com/b", prompt: "x" });
    await ask("Edit", { file_path: "/work/app/f.ts", old_string: "one", new_string: "two" });
    await ask("Edit", { file_path: "/work/app/f.ts", old_string: "three", new_string: "four" });
    const items = readAway(paths.stateDir).items;
    expect(items).toHaveLength(4);
    expect(items[0]?.text).toContain("https://example.com/a");
    expect(items[1]?.text).toContain("https://example.com/b");
    expect(items[2]?.text).toContain("/work/app/f.ts");
    expect(items[2]?.text).toContain("two");
    expect(items[3]?.text).toContain("four");
    // The same call twice is still one item.
    await ask("WebFetch", { url: "https://example.com/a", prompt: "x" });
    expect(readAway(paths.stateDir).items).toHaveLength(4);
  });

  test("a crash on the events that ask nobody is one line on stderr, and on the question tools an ask", async () => {
    const { env, paths } = await away();
    const context = { env, paths, nowMs: T0 };
    for (const event of ["PermissionRequest", "UserPromptSubmit"]) {
      const result = userAwayHook.onCrash?.("boom", permissionRequest("Bash", {}), event, context);
      expect(result?.stderr).toBe("cc-smart-dev-kit user-away: boom");
      expect(result?.stdout).toBeUndefined();
    }
    const asked = userAwayHook.onCrash?.(
      "boom",
      preToolUse("AskUserQuestion"),
      "PreToolUse",
      context,
    );
    expect(decisionOf(asked?.stdout).permissionDecision).toBe("ask");
  });

  test("a permission prompt with a state file it cannot read: no answer, one line why", async () => {
    const { env, paths } = await away();
    writeFileSync(awayStateFile(paths.stateDir), "{ nope");
    const result = await userAwayAnswer(
      permissionRequest("Bash", { command: "make deploy" }),
      "PermissionRequest",
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
  });

  test("an ask that became a deny is on the person's list and not in the record of asks", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { protectedBranches: ["main"] });
    const env = hookEnv();
    const input = preToolUse("Bash", { command: "git push --force origin main" });
    input.cwd = repo;
    const log = askLogFile(cliPaths(env).stateDir);
    const lines = () =>
      existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

    await runHook(gitGuardHook, input, env);
    expect(lines()).toHaveLength(1);

    await setUnavailable(cliPaths(env).stateDir, Date.now(), null);
    const denied = await runHook(gitGuardHook, input, env);
    expect(decisionOf(denied.stdout).permissionDecision).toBe("deny");
    expect(lines()).toHaveLength(1);
  });
});
