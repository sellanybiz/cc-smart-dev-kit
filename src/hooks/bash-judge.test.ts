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
import { cliPaths } from "../cli/paths";
import { leadFile, writeStoreFile } from "../crew/store";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import type { HookResult } from "./io";
import { jobRouteHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const CREW_ID = "W4-judge-1a2b3c";
const LAUNCHER = '"$HOME/.local/bin/cc-smart-dev-kit"';

/** The `hooks.json` input for one Bash call in `cwd`. */
function call(cwd: string, command: string): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: "Bash",
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
): Promise<{ decision: string | undefined; reason: string }> {
  const answer = output(await runHook(jobRouteHook, call(repo, command), env));
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
  const at = "2026-10-21T10:00:00.000Z";
  writeStoreFile(
    leadFile(cliPaths(made.env).stateDir, made.repo, SESSION),
    `${JSON.stringify({
      cwd: made.repo,
      createdAt: at,
      name: "LEAD app plan",
      plan: "plan",
      repo: made.repo,
      sessionId: SESSION,
      tag: "app",
      updatedAt: at,
      version: 1,
    })}\n`,
  );
  return made;
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

describe("polling for crew news", () => {
  const denied = [
    "while true; do cc-smart-dev-kit crew list; sleep 10; done",
    "until cc-smart-dev-kit crew status app; do sleep 5; done",
    "for i in 1 2 3; do cc-smart-dev-kit crew list; done",
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
