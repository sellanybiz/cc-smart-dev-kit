/**
 * The Bash judge (`bash-judge.ts`), through the hook that answers it (`job-route`):
 * - a raw `claude --bg` asks in an attended session, showing the `crew start` line, and is
 *   denied in `claude -p`;
 * - `claude -p` is judged by the launch policy every Agent launch meets: no model denies, the
 *   `opus` tier at `max` asks, the `fable` tier with its reason line asks;
 * - a crew session's `crew start` is denied;
 * - a crew session's `workflow propose` is denied, however the line is spelled, and the rest of
 *   the command passes;
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
import { GIT_BASH_VAR } from "../cli/git-bash";
import { cliPaths } from "../cli/paths";
import { CREW_ENV } from "../crew/session";
import { leadFile, writeStoreFile } from "../crew/store";
import { locateCheckout } from "../project/resolve";
import { shellQuote } from "../setup/launcher";
import {
  commitConfig,
  hookEnv,
  makeRepo,
  runHook,
  slowGitEnv,
  writeClaudeFile,
  writePersonalWorkflow,
} from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { judgeBash, readBash } from "./bash-judge";
import { GUARD_BUDGET_ENV } from "./budget";
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
    ["$(command -v cc-smart-dev-kit) crew answer C-x 'yes'", "answers its lead's questions"],
    // The kit's own spellings, through the one recogniser both guards read (`kit-invocation`).
    [
      "bun $HOME/.claude/plugins/cache/cc-smart-dev-kit/1.0.0/dist/cli.js crew answer C-x 'yes'",
      "answers its lead's questions",
    ],
    ["cc-smart-dev-kit crew watch", "watches its lead's crew sessions"],
    ["cc-smart-dev-kit crew stop C-x", "stops, removes or resumes crew sessions"],
    ["cc-smart-dev-kit crew rm C-x", "stops, removes or resumes crew sessions"],
    ["cc-smart-dev-kit crew resume C-x", "stops, removes or resumes crew sessions"],
    ["cc-smart-dev-kit crew model C-x --effort max", "changes a crew session's model or effort"],
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

describe("a crew session proposing a workflow change", () => {
  // `workflow propose` pushes a branch and opens a pull request in children no hook sees, so
  // the guards that deny the session's own `git push` and `gh pr create` (D24) never see them.
  // The hook's environment is the session's own, so a line that unsets the variable itself is
  // still this crew session's; the reader steps over the wrappers and the inner shells, so
  // every spelling of the line meets the same denial.
  const denied: [string, string][] = [
    ["cc-smart-dev-kit workflow propose autoCommit true", "the plain line"],
    [
      "env -u CC_SMART_DEV_KIT_CREW cc-smart-dev-kit workflow propose autoCommit true",
      "the variable unset on the line itself",
    ],
    ["timeout 60 cc-smart-dev-kit workflow propose autoCommit true", "`timeout`"],
    ["nohup setsid cc-smart-dev-kit workflow propose autoCommit true", "`nohup` and `setsid`"],
    ["sudo -u me cc-smart-dev-kit workflow propose autoCommit true", "`sudo`"],
    ["bash -c 'cc-smart-dev-kit workflow propose autoCommit true'", "an inner shell"],
    ["eval 'cc-smart-dev-kit workflow propose autoCommit true'", "`eval`"],
    ["$KIT workflow propose autoCommit true", "a computed program"],
    ["$(command -v cc-smart-dev-kit) workflow propose autoCommit true", "a computed program"],
    ["cc-smart-dev-kit workflow propose autoMerge --unset", "an `--unset`"],
    // The kit under every spelling its own guards recognise (`kit-invocation`): its bundle
    // behind a runner, the launcher behind `sh`, and a program that runs its arguments.
    [
      "bun $HOME/.claude/plugins/cache/cc-smart-dev-kit/1.0.0/dist/cli.js workflow propose autoCommit true",
      "the bundle behind `bun`",
    ],
    [
      "sh $HOME/.local/bin/cc-smart-dev-kit workflow propose autoCommit true",
      "the launcher behind `sh`",
    ],
    [
      "find . -maxdepth 0 -exec cc-smart-dev-kit workflow propose autoCommit true ;",
      "`find -exec`",
    ],
    [
      "watch -n 600 env -u CC_SMART_DEV_KIT_CREW cc-smart-dev-kit workflow propose autoCommit true",
      "`watch`",
    ],
    // The argv the command itself gets: a redirect before the subcommand is not an argument,
    // and a redirect's target is not a flag (`> -h` used to pass for a help read).
    ["cc-smart-dev-kit 2>/dev/null workflow propose autoCommit true", "a redirect before it"],
    ["cc-smart-dev-kit workflow propose autoCommit true > -h", "a redirect target"],
    ["cc-smart-dev-kit workflow propose autoCommit true 2> --help", "a redirect target"],
    // A subcommand the judge cannot read may be `propose`.
    [
      "P=propose; env -u CC_SMART_DEV_KIT_CREW cc-smart-dev-kit workflow $P autoCommit true",
      "a computed subcommand",
    ],
    // A `--help` after a `--` is the command's own word (`asksForHelp`'s rule): the line is no
    // help read, and the command refuses the `--` itself.
    ["cc-smart-dev-kit workflow propose -- -h", "a `--help` after a `--`"],
    ["echo propose autoCommit true | xargs cc-smart-dev-kit workflow", "no subcommand at all"],
  ];
  for (const [command, what] of denied) {
    test(`denied: ${what} — ${command}`, async () => {
      const { env, repo } = project({ workflow: { crew: { enabled: true } } });
      const answer = await judge(repo, command, { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID });
      expect(answer.decision).toBe("deny");
      expect(answer.reason).toContain("a crew session never proposes a workflow change");
      expect(answer.reason).toContain("cc-smart-dev-kit crew report --question");
    });
  }

  test("the deny is the hook's own: no file, a broken file and ownHooks cannot soften it", async () => {
    for (const config of [
      undefined,
      { ownHooks: ["job-route"] },
      { worktree: {} },
      { requires: ">=99" },
    ]) {
      const { env, repo } = project(config);
      const answer = await judge(repo, "cc-smart-dev-kit workflow propose autoCommit true", {
        ...env,
        CC_SMART_DEV_KIT_CREW: CREW_ID,
      });
      expect({ config, decision: answer.decision }).toEqual({ config, decision: "deny" });
    }
  });

  test("in PowerShell it is denied too", async () => {
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    const answer = await judge(
      repo,
      "cc-smart-dev-kit workflow propose autoCommit true",
      { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID },
      "PowerShell",
    );
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toContain("a crew session never proposes a workflow change");
  });

  test("the rest of the workflow command passes: reading it, and changing this checkout's policy", async () => {
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    for (const command of [
      "cc-smart-dev-kit workflow show",
      "cc-smart-dev-kit workflow set autoCommit true --project",
      "cc-smart-dev-kit workflow unset autoCommit --project",
      "cc-smart-dev-kit workflow merge-check 5",
      "cc-smart-dev-kit workflow review-done --sha abc1234",
      // Reading the usage proposes nothing, as for a lead command's help: both spellings, and
      // a `--help` after a `--` is the command's own word, not the dispatcher's.
      "cc-smart-dev-kit workflow propose --help",
      "cc-smart-dev-kit workflow propose -h",
      // A crew session's own command that merely names it: the words are read, and they are not
      // the words of a command the line runs.
      "cc-smart-dev-kit crew report --question 'workflow propose' --option a --option b",
      "$KIT crew report --question 'workflow propose' --option a --option b",
      // A path that only holds the kit's name in a test file's own name is no kit command, and
      // a program that runs no argument of its own (`git commit -m …`) never is.
      "bun test src/workflow/propose.test.ts",
      "git commit -m 'workflow propose: the deny'",
    ]) {
      const answer = await judge(repo, command, { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID });
      expect({ command, decision: answer.decision }).toEqual({ command, decision: undefined });
    }
  });

  test("RV4 finding 7: a computed program that merely ends in the word `workflow` is no proposal", async () => {
    // Nothing on these lines names the kit: the word is a test filter and `gh`'s own subcommand.
    // They were read as `workflow` with no subcommand, which `xargs cc-smart-dev-kit workflow`
    // needs to be a possible proposal, and a crew session's test run was denied.
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    for (const command of [
      '"$PY" -m pytest -k workflow',
      "$(which gh) workflow",
      // A word after `workflow` that the line works out is as likely another program's argument
      // (`$EXTRA` a flag, `$SUB` gh's workflow id) as the kit's subcommand (RV4 finding F4).
      '"$PY" -m pytest -k workflow $EXTRA',
      "$(which gh) workflow $SUB",
      '"$PY" -m pytest -k workflow "$(cat extra-args)"',
    ]) {
      expect({ command, propose: readBash(command).workflowPropose }).toEqual({
        command,
        propose: false,
      });
      const answer = await judge(repo, command, { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID });
      expect({ command, decision: answer.decision }).toEqual({ command, decision: undefined });
    }
  });

  test("RV4 finding 7: a computed program the line names as the kit, with no subcommand, is still a possible proposal", async () => {
    const { env, repo } = project({ workflow: { crew: { enabled: true } } });
    for (const command of [
      "K=cc-smart-dev-kit; $K workflow",
      "echo propose | $(command -v cc-smart-dev-kit) workflow",
      // The words `workflow propose` are the domain words: a computed program asks without them
      // naming the kit anywhere.
      "$KIT workflow propose autoCommit true",
      // A subcommand worked out at run time is as unreadable as a missing one, when the line
      // names the kit (RV4 finding F4: a line that does not name it proposes nothing there).
      "K=cc-smart-dev-kit; $K workflow $SUB autoCommit true",
      "$(command -v cc-smart-dev-kit) workflow $SUB autoCommit true",
    ]) {
      const answer = await judge(repo, command, { ...env, CC_SMART_DEV_KIT_CREW: CREW_ID });
      expect({ command, decision: answer.decision }).toEqual({ command, decision: "deny" });
    }
  });
});

describe("RF1-4: a session that is not a crew session proposing a workflow change", () => {
  // `workflow propose` pushes a branch and opens a pull request that is ready for review, in
  // children no hook sees: the git and merge guards never ask about them. So the judge asks first
  // whenever the gate those guards read says either is the person's to approve.
  const BASE = { requires: ">=0.4", worktrees: { base: "dev" } };
  const PROPOSE = "cc-smart-dev-kit workflow propose autoCommit true";
  const ACTS =
    "This runs `cc-smart-dev-kit workflow propose`: it pushes a new branch to origin and opens a pull request into `dev` that is ready for review, in child processes no hook sees, so the git and merge guards never ask about either.";

  /** A repo whose `origin/dev` holds the project's file with `workflow`, and the hook's env. */
  function gated(workflow: unknown = {}): { env: Record<string, string>; repo: string } {
    const repo = makeRepo();
    commitConfig(repo, { ...BASE, workflow }, ["dev"]);
    return { env: hookEnv(), repo };
  }

  test("the default gate (autoPush off, openPr off) asks, naming both switches, the push and the pull request", async () => {
    const { env, repo } = gated();
    expect(await judge(repo, PROPOSE, env)).toEqual({
      decision: "ask",
      reason: `${ACTS}\nautoPush is off (default), and openPr is off (default), so the push and the pull request are yours to approve. Approve it if you meant it.`,
    });
  });

  test("each gate value short of both: an ask that names the switch that says no", async () => {
    for (const [workflow, says] of [
      [{ autoPush: true }, "openPr is off (default)"],
      [{ autoPush: true, openPr: "off" }, "openPr is off (project, committed on origin/dev)"],
      [{ autoPush: true, openPr: "draft" }, "openPr is draft (project, committed on origin/dev)"],
      [{ openPr: "ready" }, "autoPush is off (default)"],
    ] as const) {
      const { env, repo } = gated(workflow);
      expect({ workflow, answer: await judge(repo, PROPOSE, env) }).toEqual({
        workflow,
        answer: {
          decision: "ask",
          reason: `${ACTS}\n${says}, so the push and the pull request are yours to approve. Approve it if you meant it.`,
        },
      });
    }
  });

  test("autoPush on and openPr ready, committed on the base: silent", async () => {
    const { env, repo } = gated({ autoPush: true, openPr: "ready" });
    expect((await judge(repo, PROPOSE, env)).decision).toBeUndefined();
  });

  test("the person's own workflow file counts as the guards read it; a worktree's own file never does", async () => {
    const own = gated();
    writePersonalWorkflow(own.env, { autoPush: true, openPr: "ready" });
    expect((await judge(own.repo, PROPOSE, own.env)).decision).toBeUndefined();
    const edited = gated();
    writeClaudeFile(edited.repo, "cc-smart-dev-kit.json", {
      ...BASE,
      workflow: { autoPush: true, openPr: "ready" },
    });
    expect((await judge(edited.repo, PROPOSE, edited.env)).decision).toBe("ask");
  });

  test("--folder names the project whose gate counts", async () => {
    const open = gated({ autoPush: true, openPr: "ready" });
    const closed = gated();
    // Quoted as a person would write it in Bash: unquoted, a Windows path's `\` are escapes.
    const into = (repo: string) => `${PROPOSE} --folder ${shellQuote(repo)}`;
    expect((await judge(open.repo, into(closed.repo), open.env)).decision).toBe("ask");
    expect((await judge(closed.repo, into(open.repo), closed.env)).decision).toBeUndefined();
  });

  // job-route has 10 s in hooks.json, and a hook Claude Code kills answers nothing: the git calls
  // the question makes (the project's folder, then the committed file) share one budget counted
  // from the hook's start, and a call with no time left is not made (`budget.ts`). A fake git
  // that waits stands in for a hung one; it is a POSIX script, so Windows skips these.
  const POSIX_ONLY = process.platform === "win32";
  const hangingGit = (env: Record<string, string>, on: string) =>
    slowGitEnv(env, on, "exec sleep 30");
  const TIMED_OUT = "git did not answer in time";

  // A test's budget is a few seconds so the proof does not wait: the variable can only shorten
  // the budget, as in the merge guard's test.
  test.skipIf(POSIX_ONLY)(
    "a git that hangs on every call: asks inside the budget, saying git did not answer in time",
    () => {
      // The judge alone: the frame's own project lookup (`run.ts`) comes before it.
      const { env, repo } = gated({ autoPush: true, openPr: "ready" });
      const started = Date.now();
      const verdict = judgeBash(readBash(PROPOSE), {
        env: { ...hangingGit(env, ""), [GUARD_BUDGET_ENV]: "3000" },
        input: call(repo, PROPOSE),
        paths: cliPaths(env),
      });
      expect(verdict).toEqual({
        decision: "ask",
        reason: `${ACTS.replace("into `dev`", "into the project's integration base (worktrees.base)")}\ncc-smart-dev-kit cannot tell which project's workflow this line proposes into (${TIMED_OUT}), so it cannot read the gate. Approve it if you meant it.`,
        why: "propose",
      });
      // One call may take the budget less the margin (1 s here), and none is made after it.
      expect(Date.now() - started).toBeLessThan(2_500);
    },
    20_000,
  );

  test.skipIf(POSIX_ONLY)(
    "a git that hangs on the committed file only, at the real budget: the gate read asks, saying git did not answer",
    async () => {
      // No budget variable: one call gets its own 5 s (8 s less the 2 s margin leaves 6), the hung
      // call is stopped there and says so, where the old reason was a ref that is not there.
      const { env, repo } = gated({ autoPush: true, openPr: "ready" });
      const started = Date.now();
      const answer = await judge(repo, PROPOSE, hangingGit(env, "rev-parse --verify"));
      expect(answer).toEqual({
        decision: "ask",
        reason: `${ACTS}\ncc-smart-dev-kit cannot tell whether the push and the pull request are allowed: the workflow committed on dev cannot be read (${TIMED_OUT}). Approve it if you meant it.`,
      });
      expect(Date.now() - started).toBeLessThan(8_000);
    },
    20_000,
  );

  test.skipIf(POSIX_ONLY)(
    "a git that hangs on the frame's own lookup: the budget counts from the hook's start, so the hook still answers in time",
    async () => {
      // The frame looks the project up first and spends its 5 s (`rev-parse --path-format`, which
      // only the lookups run). The judge's lookup then has what is left of 8 s less the margin
      // (about 1 s), not a fresh 5 s: the whole run stays well inside the hook's 10 s.
      const { env, repo } = gated({ autoPush: true, openPr: "ready" });
      const started = Date.now();
      const answer = await judge(repo, PROPOSE, hangingGit(env, "rev-parse --path-format"));
      expect(answer.decision).toBe("ask");
      expect(answer.reason).toContain(`(${TIMED_OUT})`);
      expect(Date.now() - started).toBeLessThan(8_000);
    },
    20_000,
  );

  test.skipIf(POSIX_ONLY)(
    "two proposals on one line share the budget: the second asks when the first spent it",
    async () => {
      // Each `rev-parse --verify` takes 0.7 s and answers, so the first proposal reads its gate in
      // 1.4 s and is allowed. With the budget's 4 s less its 2 s margin, the second finds under a
      // second left for its first call: the call is cut, and the line asks. Own budgets would
      // read both gates and stay silent.
      const { env, repo } = gated({ autoPush: true, openPr: "ready" });
      const started = Date.now();
      const answer = await judge(repo, `${PROPOSE} && ${PROPOSE}`, {
        ...slowGitEnv(env, "rev-parse --verify", "sleep 0.7"),
        [GUARD_BUDGET_ENV]: "4000",
      });
      expect(answer.decision).toBe("ask");
      expect(answer.reason).toContain(
        `the workflow committed on dev cannot be read (${TIMED_OUT})`,
      );
      expect(Date.now() - started).toBeLessThan(3_500);
    },
    20_000,
  );

  test.skipIf(POSIX_ONLY)(
    "a slow git inside the budget changes nothing: the gate is read and the proposal allowed",
    async () => {
      const { env, repo } = gated({ autoPush: true, openPr: "ready" });
      const answer = await judge(repo, PROPOSE, slowGitEnv(env, "rev-parse --verify", "sleep 0.2"));
      expect(answer.decision).toBeUndefined();
    },
    20_000,
  );

  test("a gate it cannot read, or a project it cannot name, asks with the reason", async () => {
    const lost = gated();
    git(lost.repo, "update-ref", "-d", "refs/remotes/origin/dev");
    expect((await judge(lost.repo, PROPOSE, lost.env)).reason).toStartWith(
      `${ACTS}\ncc-smart-dev-kit cannot tell whether the push and the pull request are allowed: the workflow committed on dev cannot be read`,
    );
    const { env, repo } = gated({ autoPush: true, openPr: "ready" });
    for (const command of [
      "$KIT workflow propose autoCommit true",
      "P=propose; cc-smart-dev-kit workflow $P autoCommit true",
      `${PROPOSE} --folder $HOME/app`,
      `cd ../other && ${PROPOSE}`,
    ]) {
      const answer = await judge(repo, command, env);
      expect({ command, decision: answer.decision }).toEqual({ command, decision: "ask" });
      expect(answer.reason).toContain(
        "cc-smart-dev-kit cannot tell which project's workflow this line proposes into",
      );
    }
  });

  test("nobody answers in `claude -p`: where it would ask, it is refused", async () => {
    const { env, repo } = gated();
    const answer = await judge(repo, PROPOSE, { ...env, CLAUDE_CODE_SESSION_ATTENDED: "0" });
    expect(answer.decision).toBe("deny");
    expect(answer.reason).toEndWith(
      "Nobody answers a question in `claude -p`, so the proposal is refused.",
    );
    const open = gated({ autoPush: true, openPr: "ready" });
    expect(
      (await judge(open.repo, PROPOSE, { ...open.env, CLAUDE_CODE_SESSION_ATTENDED: "0" }))
        .decision,
    ).toBeUndefined();
  });

  test("reading its help asks nothing", async () => {
    const { env, repo } = gated();
    expect((await judge(repo, "cc-smart-dev-kit workflow propose --help", env)).decision).toBe(
      undefined,
    );
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

  test("the queue's rewrite stays Bash-only: a PowerShell heavy line is refused, never rewritten", async () => {
    const { env, repo } = project({ jobs: { route: true } });
    const bash = join(tempDir("git-bash"), "bash.exe");
    writeFileSync(bash, "");
    env[GIT_BASH_VAR] = bash;
    // The rewritten line is a `sh` line (`routedShell`), which the PowerShell tool cannot run.
    const answer = output(
      await runHook(jobRouteHook, call(repo, "bunx tsc --noEmit", "PowerShell"), env),
    );
    expect(answer.updatedInput).toBeUndefined();
    expect(answer.permissionDecision).toBe("deny");
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

// The route is the `switches.jobRoute` switch: the project's `jobs.route` when it sets one, else
// the person's machine-wide default in their workflow file, else off. The hook asks the one
// resolver (`resolveJobRoute`), with or without a project file.
describe("the route switch: the person's default, and the project wins", () => {
  const TSC = "bunx tsc --noEmit";
  const ROUTED = { command: `${LAUNCHER} job run --kind tsc -- ${TSC}` };
  const on = { switches: { jobRoute: true } };
  const off = { switches: { jobRoute: false } };

  /** What the hook does with a type check in `repo`: the rewrite, or `null` when it stays raw. */
  async function routed(repo: string, env: Record<string, string>, tool = "Bash") {
    const answer = output(await runHook(jobRouteHook, call(repo, TSC, tool), env));
    return answer.updatedInput === undefined ? null : answer.updatedInput;
  }

  test("off for everyone until someone turns it on: a heavy command runs raw", async () => {
    const withFile = project({});
    expect(await routed(withFile.repo, withFile.env)).toBeNull();
    const noFile = project(undefined);
    expect(await routed(noFile.repo, noFile.env)).toBeNull();
  });

  test("the person's default routes a project that says nothing, even one with no file", async () => {
    const noFile = project(undefined);
    writePersonalWorkflow(noFile.env, on);
    expect(await routed(noFile.repo, noFile.env)).toEqual(ROUTED);
    const silent = project({});
    writePersonalWorkflow(silent.env, on);
    expect(await routed(silent.repo, silent.env)).toEqual(ROUTED);
    // Another job setting in the project's file is not its route.
    const kinds = project({ jobs: { kinds: { e2e: { match: [{ script: "e2e" }] } } } });
    writePersonalWorkflow(kinds.env, on);
    expect(await routed(kinds.repo, kinds.env)).toEqual(ROUTED);
  });

  test("the project's value wins over the person's, in both directions", async () => {
    const projectOff = project({ jobs: { route: false } });
    writePersonalWorkflow(projectOff.env, on);
    expect(await routed(projectOff.repo, projectOff.env)).toBeNull();
    const projectOn = project({ jobs: { route: true } });
    writePersonalWorkflow(projectOn.env, off);
    expect(await routed(projectOn.repo, projectOn.env)).toEqual(ROUTED);
  });

  test("a personal file that cannot be used leaves the project's value standing", async () => {
    const broken = (config: unknown) => {
      const made = project(config);
      const file = cliPaths(made.env).workflowConfigFile;
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "{not json");
      return made;
    };
    const projectOn = broken({ jobs: { route: true } });
    expect(await routed(projectOn.repo, projectOn.env)).toEqual(ROUTED);
    const silent = broken({});
    expect(await routed(silent.repo, silent.env)).toBeNull();
  });

  test("a heavy PowerShell line is refused where the route is on, naming the Bash tool", async () => {
    const made = project({});
    // A Git Bash the lookup finds on any machine (off Windows the Bash tool is always there).
    const bash = join(tempDir("git-bash"), "bash.exe");
    writeFileSync(bash, "");
    made.env[GIT_BASH_VAR] = bash;
    const answer = async () =>
      output(await runHook(jobRouteHook, call(made.repo, TSC, "PowerShell"), made.env));
    // Off: left exactly as written.
    expect(await answer()).toEqual({});
    writePersonalWorkflow(made.env, on);
    const refused = await answer();
    expect(refused.updatedInput).toBeUndefined();
    expect(refused.permissionDecision).toBe("deny");
    expect(refused.permissionDecisionReason).toEndWith(
      `Run it with the Bash tool instead, where it waits for a slot in the queue:\n${TSC}`,
    );
    // A crew session gets the same refusal; a light line and a print-only run are left alone.
    const crew = { ...made.env, [CREW_ENV]: "B2-api-aaaaaa" };
    expect(
      output(await runHook(jobRouteHook, call(made.repo, TSC, "PowerShell"), crew))
        .permissionDecision,
    ).toBe("deny");
    for (const command of ["git status", "bunx tsc --version"]) {
      expect(
        output(await runHook(jobRouteHook, call(made.repo, command, "PowerShell"), made.env)),
      ).toEqual({});
    }
  });

  // A folder outside git is no project: only the judge answers there, as before.
  test("outside git there is no route: a heavy command runs raw", async () => {
    const env = hookEnv();
    writePersonalWorkflow(env, on);
    const answer = output(await runHook(jobRouteHook, call(tempDir("outside-git"), TSC), env));
    expect(answer).toEqual({});
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
