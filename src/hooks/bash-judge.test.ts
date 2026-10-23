/**
 * The Bash judge (`bash-judge.ts`), through the hook that answers it (`job-route`):
 * - a raw `claude --bg` asks in an attended session, showing the `crew start` line, and is
 *   denied in `claude -p`;
 * - `claude -p` is judged by the launch policy every Agent launch meets: no model denies, the
 *   `opus` tier at `max` asks, the `fable` tier with its reason line asks;
 * - a crew session's `crew start` is denied;
 * - a polling loop over `crew list|status` or `claude agents --json` is denied, a single read
 *   passes;
 * - the judge runs with `jobs.route` off, with no project file, with a broken one, and outside
 *   git;
 * - in a lead, a CI watch, a queued job and the full check move to the background, and a routed
 *   heavy job gets both in one rewrite.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { leadFile, writeStoreFile } from "../crew/store";
import { locateCheckout } from "../project/resolve";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import type { HookResult } from "./io";
import { jobRouteHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const CREW_ID = "W4-judge-1a2b3c";
const LAUNCHER = '"$HOME/.local/bin/cc-smart-dev-kit"';

/** The `hooks.json` input for one shell call in `cwd`, run by `tool`. */
function call(cwd: string, command: string, tool = "Bash"): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: tool,
    tool_input: { command },
  };
}

/** A repo with a project file, and the hook's environment for it. */
function project(config: unknown): { env: Record<string, string>; repo: string } {
  const repo = makeRepo();
  if (config !== undefined) writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
  return { env: hookEnv(), repo };
}

/** The answer's `hookSpecificOutput`. */
function output(result: HookResult): Record<string, unknown> {
  return JSON.parse(result.stdout ?? "{}").hookSpecificOutput ?? {};
}

/** Runs the hook on one command and returns its answer's decision and reason. */
async function judge(
  repo: string,
  command: string,
  env: Record<string, string>,
  tool = "Bash",
): Promise<{ decision: string | undefined; reason: string }> {
  const answer = output(await runHook(jobRouteHook, call(repo, command, tool), env));
  return {
    decision: answer.permissionDecision as string | undefined,
    reason: (answer.permissionDecisionReason as string | undefined) ?? "",
  };
}

/** A repo where the input's session is a recorded lead. */
function leadProject(config: unknown = { jobs: { route: true } }): {
  env: Record<string, string>;
  repo: string;
} {
  const made = project(config);
  // The store file goes where `crew lead` writes it: the repo as `locateCheckout` finds it
  // (the hooks' own key), never a temp folder's other spelling (Windows' 8.3 name, say).
  const repo = locateCheckout(made.repo, { env: made.env })?.mainCheckout ?? made.repo;
  const at = "2026-10-21T10:00:00.000Z";
  writeStoreFile(
    leadFile(cliPaths(made.env).stateDir, repo, SESSION),
    `${JSON.stringify({
      cwd: repo,
      createdAt: at,
      name: "LEAD app plan",
      plan: "plan",
      repo,
      sessionId: SESSION,
      tag: "app",
      updatedAt: at,
      version: 1,
    })}\n`,
  );
  return { ...made, repo };
}

describe("a raw background session (`claude --bg`)", () => {
  test("in an attended session it asks, showing the `crew start` line", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude --bg --name probe 'do the phase'", env);
    expect(answer.decision).toBe("ask");
    expect(answer.reason).toContain(
      "cc-smart-dev-kit crew start <phase> --slug <slug> --kind <kind> --brief <file|->",
    );
    expect(answer.reason).toContain("cc-smart-dev-kit crew lead --plan <slug>");
    expect(answer.reason).not.toContain("Nobody answers");
  });

  test("in `claude -p` it is denied: nobody answers there", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude --bg 'do the phase'", {
      ...env,
      CLAUDE_CODE_SESSION_ATTENDED: "0",
    });
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("Nobody answers a question in `claude -p`");
    expect(answer.reason).toContain("crew start <phase>");
  });

  test("from a crew session it is denied: a crew session never starts crew sessions", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude --bg 'do the phase'", {
      ...env,
      CC_SMART_DEV_KIT_CREW: CREW_ID,
    });
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain(`This session is the crew session \`${CREW_ID}\``);
    expect(answer.reason).toContain("a crew session never starts crew sessions");
    expect(answer.reason).toContain("cc-smart-dev-kit crew report --question");
  });

  test("`--background` is the same launch", async () => {
    const { env, repo } = project({});
    expect((await judge(repo, "claude --background 'x'", env)).decision).toBe("ask");
  });
});

describe("F2a-1: a launch behind a wrapper, a package runner or a computed program", () => {
  test("the wrapper and the package runner are read through", async () => {
    const { env, repo } = project({});
    for (const command of [
      "setsid claude --bg x",
      "flock /tmp/l claude --bg x",
      "unbuffer claude --bg x",
      "npx @anthropic-ai/claude-code --bg x",
      "bunx @anthropic-ai/claude-code --bg x",
      "pnpm dlx @anthropic-ai/claude-code --bg x",
    ]) {
      const answer = await judge(repo, command, env);
      expect({ command, decision: answer.decision }).toEqual({ command, decision: "ask" });
      expect(answer.reason).toContain("cc-smart-dev-kit crew start");
    }
  });

  test("a computed program whose words name `--bg` asks, and is refused where nobody answers", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "$(which claude) --bg x", env);
    expect(answer.decision).toBe("ask");
    expect(answer.reason).toContain("cc-smart-dev-kit crew start");
    const quiet = await judge(repo, "GIT=git; $(which claude) --bg x", {
      ...env,
      CLAUDE_CODE_SESSION_ATTENDED: "0",
    });
    expect(quiet.decision).toBe("deny");
    expect(quiet.reason).toContain("Nobody answers a question in `claude -p`");
  });

  test("a computed program whose words name a print run asks or denies by the model policy", async () => {
    const { env, repo } = project({});
    // No model or effort in the words: the policy refuses, exactly as `claude -p` does.
    expect((await judge(repo, "$(which claude) -p 'do it'", env)).decision).toBe("deny");
    expect(
      (await judge(repo, "$(which claude) -p --model opus --effort max 'go'", env)).decision,
    ).toBe("ask");
    // `-p` alone belongs to many programs (`cp -p`, `mkdir -p`): not a launch without claude.
    expect((await judge(repo, "$(which mkdir) -p out", env)).decision).toBeUndefined();
  });
});

describe("a print run (`claude -p`) is judged by the launch policy", () => {
  test("no model: denied, naming `--model` and `--effort`", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude -p 'do it'", env);
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("name them as `--model <model> --effort <effort>`");
    expect(answer.reason).toContain("names no `model`");
  });

  test("the opus tier at `max`: asks the person", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude -p --model opus --effort max 'do it'", env);
    expect(answer.decision).toBe("ask");
    expect(answer.reason).toContain("Claude Opus launch at effort `max`");
  });

  test("the fable tier with its reason line: asks the person", async () => {
    const { env, repo } = project({});
    const answer = await judge(
      repo,
      `claude -p --model fable --effort high "Fable reason: build - the person asked for it"`,
      env,
    );
    expect(answer.decision).toBe("ask");
    expect(answer.reason).toContain("Fable builds only when the person asks");
  });

  test("fable without the reason line: denied, as the guard denies a builder", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude -p --model fable --effort high 'do it'", env);
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("Fable reason: build");
  });

  test("`-p` in an outer `claude -p`: an ask is a refusal", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude -p --model opus --effort max 'do it'", {
      ...env,
      CLAUDE_CODE_SESSION_ATTENDED: "0",
    });
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("nobody to answer");
  });

  test("sonnet at high: nothing to say", async () => {
    const { env, repo } = project({});
    expect(await judge(repo, "claude -p --model sonnet --effort high 'do it'", env)).toEqual({
      decision: undefined,
      reason: "",
    });
  });

  test("a `claude` subcommand is not a launch", async () => {
    const { env, repo } = project({});
    expect((await judge(repo, "claude agents --json", env)).decision).toBeUndefined();
    expect((await judge(repo, "claude stop 1a2b3c4d", env)).decision).toBeUndefined();
  });
});

describe("a crew session starting crew sessions", () => {
  test("`crew start` is denied with the report step", async () => {
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    const answer = await judge(
      repo,
      "cc-smart-dev-kit crew start B4 --slug judge --kind build --brief -",
      { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID },
    );
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("a crew session never starts crew sessions");
    expect(answer.reason).toContain("cc-smart-dev-kit crew report --question");
  });

  test("the same line in a plain session is the launcher's to judge: silent", async () => {
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    expect(
      (await judge(repo, "cc-smart-dev-kit crew start B4 --slug judge --kind build --brief -", env))
        .decision,
    ).toBeUndefined();
  });
});

describe("a crew session running a lead's command", () => {
  // The hook's environment is the session's own, so a command line that unsets the variable
  // (`env -u CC_SMART_DEV_KIT_CREW …`) is still read as the crew session's, and the launcher's
  // own refusal (`readCaller`) is what the judge says here first.
  const denied: [string, string][] = [
    ["cc-smart-dev-kit crew answer C-x 'yes'", "answers its lead's questions"],
    [
      "env -u CC_SMART_DEV_KIT_CREW cc-smart-dev-kit crew answer C-x 'yes'",
      "answers its lead's questions",
    ],
    // A program the line works out when it runs is read from its own words, as a launch is.
    ["$BIN crew answer C-x 'yes'", "answers its lead's questions"],
    ["cc-smart-dev-kit crew watch", "watches its lead's crew sessions"],
    ["cc-smart-dev-kit crew stop C-x", "stops, removes or resumes crew sessions"],
    ["cc-smart-dev-kit crew rm C-x", "stops, removes or resumes crew sessions"],
    ["cc-smart-dev-kit crew resume C-x", "stops, removes or resumes crew sessions"],
    ["cc-smart-dev-kit crew lead --plan plan", "leads"],
    ["cc-smart-dev-kit crew lead tell LEAD-y --kind contract 'a note'", "tells another lead"],
  ];
  for (const [command, phrase] of denied) {
    test(`denied: ${command}`, async () => {
      const { env, repo } = project({ workflow: { crew: { enabled: true } } });
      const answer = await judge(repo, command, { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID });
      expect(answer.decision).toBe("deny");
      expect(answer.reason).toContain(`a crew session never ${phrase}`);
      expect(answer.reason).toContain("cc-smart-dev-kit crew report --question");
    });
  }

  test("a crew session's own commands pass: its steps, reports, notes and the board", async () => {
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    for (const command of [
      "cc-smart-dev-kit crew step tests-green",
      "cc-smart-dev-kit crew report --status done",
      "cc-smart-dev-kit crew tell C-y --kind contract 'a note'",
      "cc-smart-dev-kit crew list",
      "cc-smart-dev-kit crew status C-x",
      // A lead command's help only prints help: reading it is no act of leading.
      "cc-smart-dev-kit crew answer --help",
      "cc-smart-dev-kit crew lead --help",
    ]) {
      const answer = await judge(repo, command, { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID });
      expect({ command, decision: answer.decision }).toEqual({ command, decision: undefined });
    }
  });

  test("the same commands in a plain session are the launcher's to judge: silent", async () => {
    const { env, repo } = project({});
    expect(
      (await judge(repo, "cc-smart-dev-kit crew answer C-x 'yes'", env)).decision,
    ).toBeUndefined();
    expect((await judge(repo, "cc-smart-dev-kit crew watch", env)).decision).toBeUndefined();
  });

  test("a crew session's lead command in PowerShell is denied too", async () => {
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    const answer = await judge(
      repo,
      "cc-smart-dev-kit crew answer C-x 'yes'",
      { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID },
      "PowerShell",
    );
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("answers its lead's questions");
  });
});

describe("polling for crew news", () => {
  const denied = [
    "while true; do cc-smart-dev-kit crew list; sleep 10; done",
    "until cc-smart-dev-kit crew status app; do sleep 5; done",
    "watch -n 5 cc-smart-dev-kit crew status app",
    "sleep 30 && cc-smart-dev-kit crew list",
    "cc-smart-dev-kit crew list; sleep 60; cc-smart-dev-kit crew list",
    "sleep 30 && claude agents --json",
    "bash -c 'while true; do cc-smart-dev-kit crew status app; sleep 5; done'",
  ];
  for (const command of denied) {
    test(`denied: ${command}`, async () => {
      const { env, repo } = project({});
      const answer = await judge(repo, command, env);
      expect(answer.decision).toBe("deny");
      expect(answer.reason).toContain("a crew session's news arrives by itself");
      expect(answer.reason).toContain("cc-smart-dev-kit crew watch");
    });
  }

  test("one `crew list` passes: the lead reads the board when it means to", async () => {
    const { env, repo } = project({});
    expect((await judge(repo, "cc-smart-dev-kit crew list", env)).decision).toBeUndefined();
    expect((await judge(repo, "claude agents --json", env)).decision).toBeUndefined();
    expect((await judge(repo, "sleep 2", env)).decision).toBeUndefined();
  });

  test("F2a-6: a `for`/`foreach` over a fixed list with no wait is not a poll", async () => {
    const { env, repo } = project({});
    for (const command of [
      "for id in a b; do cc-smart-dev-kit crew status $id; done",
      "for i in 1 2 3; do cc-smart-dev-kit crew list; done",
      // The read feeds the loop, it is not repeated by it.
      "claude agents --json | jq -r '.[]' | while read id; do echo $id; done",
    ]) {
      expect({ command, decision: (await judge(repo, command, env)).decision }).toEqual({
        command,
        decision: undefined,
      });
    }
    // A wait in the same fixed loop still makes it a poll.
    expect(
      (await judge(repo, "for i in 1 2 3; do cc-smart-dev-kit crew list; sleep 5; done", env))
        .decision,
    ).toBe("deny");
  });

  test("`crew watch` is the way to wait, not a poll", async () => {
    const { env, repo } = project({});
    expect((await judge(repo, "cc-smart-dev-kit crew watch --once", env)).decision).toBeUndefined();
  });
});

describe("the judge ignores the project's switches", () => {
  test("`jobs.route` off still judges a raw background session", async () => {
    const { env, repo } = project({ jobs: { route: false } });
    expect((await judge(repo, "claude --bg 'x'", env)).decision).toBe("ask");
  });

  test("with no cc-smart-dev-kit.json at all, a launch is judged the same", async () => {
    const { env, repo } = project(undefined);
    expect((await judge(repo, "claude --bg 'x'", env)).decision).toBe("ask");
    expect((await judge(repo, "claude -p 'x'", env)).decision).toBe("deny");
  });

  test("a broken cc-smart-dev-kit.json: the launch is judged, not asked about the file", async () => {
    const { env, repo } = project({ worktree: {} });
    const answer = await judge(repo, "claude --bg 'x'", env);
    expect(answer.decision).toBe("ask");
    expect(answer.reason).toContain("crew start <phase>");
    expect(answer.reason).not.toContain("cannot check");
  });

  test("outside git, a launch is judged the same", async () => {
    const env = hookEnv();
    // A plain folder, no .git: the frame's outsideGit step.
    const folder = tempDir("outside-git");
    expect((await judge(folder, "claude --bg 'x'", env)).decision).toBe("ask");
  });
});

describe("the judge reads the PowerShell tool too (native Windows)", () => {
  test("a raw `claude --bg` in PowerShell asks, as it does in Bash", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude --bg --name probe 'do the phase'", env, "PowerShell");
    expect(answer.decision).toBe("ask");
    expect(answer.reason).toContain("cc-smart-dev-kit crew start <phase>");
  });

  test("claude as Windows names it: claude.cmd, and a full path invoked with `&`", async () => {
    const { env, repo } = project({});
    for (const command of [
      "claude.cmd --bg --name probe 'do the phase'",
      String.raw`& "C:\Users\me\.local\bin\claude.exe" --bg --name probe 'do the phase'`,
    ]) {
      expect((await judge(repo, command, env, "PowerShell")).decision).toBe("ask");
    }
  });

  test("a `claude -p` run is judged by the launch policy in PowerShell too", async () => {
    const { env, repo } = project({});
    const answer = await judge(repo, "claude -p 'do it'", env, "PowerShell");
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("name them as `--model <model> --effort <effort>`");
  });

  test("a crew session's `crew start` in PowerShell is denied", async () => {
    const { env, repo } = project({});
    const answer = await judge(
      repo,
      "cc-smart-dev-kit crew start K --slug x",
      {
        ...env,
        CC_SMART_DEV_KIT_CREW: CREW_ID,
      },
      "PowerShell",
    );
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("a crew session never starts crew sessions");
  });

  test("a PowerShell polling loop is denied; a single read passes", async () => {
    const { env, repo } = project({});
    for (const command of [
      "while ($true) { cc-smart-dev-kit crew list }",
      "while ($true) { cc-smart-dev-kit crew list; Start-Sleep 5 }",
    ]) {
      const answer = await judge(repo, command, env, "PowerShell");
      expect(answer.decision).toBe("deny");
      expect(answer.reason).toContain("polls for crew news");
    }
    // F2a-6: a `foreach` over a fixed list, with no wait, is not a poll.
    expect(
      (
        await judge(
          repo,
          "foreach ($i in 1..3) { cc-smart-dev-kit crew status app }",
          env,
          "PowerShell",
        )
      ).decision,
    ).toBeUndefined();
    expect(await judge(repo, "cc-smart-dev-kit crew list", env, "PowerShell")).toEqual({
      decision: undefined,
      reason: "",
    });
  });

  test("the queue route stays Bash-only: a PowerShell heavy line is left as it is", async () => {
    const { env, repo } = project({ jobs: { route: true } });
    // The rewritten line is a `sh` line (`routedShell`), which the PowerShell tool cannot run.
    expect(
      output(await runHook(jobRouteHook, call(repo, "bunx tsc --noEmit", "PowerShell"), env)),
    ).toEqual({});
  });
});

describe("J1: a package script is a script, not the tool of the same name", () => {
  test("`bun run tsc` in a project whose tsc script wraps the job is left as it is", async () => {
    const { env, repo } = project({ jobs: { route: true } });
    // The project's tsc script already goes through the queue: wrapping it again would nest
    // two queues, and take them in the opposite order from a plain run.
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ scripts: { tsc: "bun scripts/heavy-job.ts --kind=tsc -- tsgo" } })}\n`,
    );
    for (const command of ["bun run tsc --noEmit", "bun tsc", "bun tsc --noEmit"]) {
      expect([command, output(await runHook(jobRouteHook, call(repo, command), env))]).toEqual([
        command,
        {},
      ]);
    }
    // A real tool behind a package runner is no script, and is still routed.
    expect(
      output(await runHook(jobRouteHook, call(repo, "bunx tsc --noEmit"), env)).updatedInput,
    ).toEqual({ command: `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit` });
  });

  test("the folder after a cd decides: a script there is no tool, a tool there still is", async () => {
    const { env, repo } = project({ jobs: { route: true } });
    writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { tsc: "tsgo" } })}\n`);
    mkdirSync(join(repo, "sub"));
    writeFileSync(join(repo, "sub", "package.json"), `${JSON.stringify({ scripts: {} })}\n`);
    // The root defines tsc as a script: no rewrite there.
    expect(output(await runHook(jobRouteHook, call(repo, "bun run tsc --noEmit"), env))).toEqual(
      {},
    );
    // `sub` defines no tsc, so there it is the package's tool, and the line is routed as before.
    const routed = output(
      await runHook(jobRouteHook, call(repo, "cd sub && bun run tsc --noEmit"), env),
    ).updatedInput as { command: string };
    expect(routed.command).toContain("job run --kind tsc");
    expect(routed.command).toContain("cd sub && bun run tsc --noEmit");
  });
});

describe("a lead never waits on what it started", () => {
  test("a CI watch moves to the background", async () => {
    const { env, repo } = leadProject();
    for (const command of ["gh pr checks 7 --watch", "gh run watch 123"]) {
      const answer = output(await runHook(jobRouteHook, call(repo, command), env));
      expect(answer.updatedInput).toEqual({ command, run_in_background: true });
      expect(answer.permissionDecision).toBeUndefined();
    }
  });

  test("the full check moves to the background", async () => {
    const { env, repo } = leadProject();
    for (const command of ["bun run check", "npm run check", "pnpm run check"]) {
      expect(output(await runHook(jobRouteHook, call(repo, command), env)).updatedInput).toEqual({
        command,
        run_in_background: true,
      });
    }
  });

  test("a routed heavy job gets the queue and the background in one rewrite", async () => {
    const { env, repo } = leadProject();
    const answer = output(await runHook(jobRouteHook, call(repo, "bunx tsc --noEmit"), env));
    expect(answer.updatedInput).toEqual({
      command: `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`,
      run_in_background: true,
    });
  });

  test("a queued job the lead wrote itself moves to the background", async () => {
    const { env, repo } = leadProject();
    const command = `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`;
    expect(output(await runHook(jobRouteHook, call(repo, command), env)).updatedInput).toEqual({
      command,
      run_in_background: true,
    });
  });

  test("a plain session keeps its waits: no rewrite, and a plain heavy command is routed", async () => {
    const { env, repo } = project({ jobs: { route: true } });
    expect(output(await runHook(jobRouteHook, call(repo, "gh pr checks 7 --watch"), env))).toEqual(
      {},
    );
    expect(output(await runHook(jobRouteHook, call(repo, "bun run check"), env))).toEqual({});
    expect(
      output(await runHook(jobRouteHook, call(repo, "bunx tsc --noEmit"), env)).updatedInput,
    ).toEqual({ command: `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit` });
  });

  test("a line that does more than the check is left as the model wrote it", async () => {
    const { env, repo } = leadProject();
    expect(
      output(await runHook(jobRouteHook, call(repo, "bun run check && git push"), env)),
    ).toEqual({});
  });

  test("a call the model already put in the background is left as it is", async () => {
    const { env, repo } = leadProject();
    const input = call(repo, "gh pr checks 7 --watch");
    input.tool_input = { command: "gh pr checks 7 --watch", run_in_background: true };
    expect(output(await runHook(jobRouteHook, input, env))).toEqual({});
  });
});
