import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { COMMAND } from "../build-info/names";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { readAway, setUnavailable } from "../user-away/state";
import { judgeBash, judgedDomain, readBash } from "./bash-judge";
import { keepGoingReason } from "./keep-going";
import { hasNotPersonWrapper } from "./prompt-source";
import { jobRouteHook } from "./specs";

function world() {
  const env = hookEnv();
  const paths = cliPaths(env);
  const input = { permission_mode: "auto", tool_input: {} };
  return { env, paths, input };
}
const start = `${COMMAND} herdr start --model sonnet --effort high --mode manual -- work`;

test("raw hc reads pass and writes name the guarded replacement", () => {
  const ctx = world();
  for (const read of [
    "ls",
    "get t1",
    "read t1",
    "wait t1",
    "templates",
    "schema",
    "machine ls",
    "file read t1 x",
    "--help",
    "--version",
    "server status",
  ]) {
    expect(judgeBash(readBash(`hc ${read}`), ctx)).toBeNull();
  }
  for (const [verb, fix] of [
    ["run", "herdr start"],
    ["send", "herdr send"],
    ["keys", "herdr answer"],
    ["kill", "herdr stop"],
    ["rm", "herdr stop"],
    ["label", "herdr adopt"],
    ["exec", "job run"],
    ["put", "job run"],
    ["file write", "job run"],
    ["attach", "herdr"],
  ]) {
    const verdict = judgeBash(readBash(`hc ${verb} t1`), ctx);
    expect(verdict?.decision).toBe("deny");
    expect(verdict?.reason).toContain(fix ?? "");
  }
  for (const line of [
    "bash -c 'hc send t1 hi'",
    "env X=1 hc send t1 hi",
    "sudo hc send t1 hi",
    "xargs hc send t1",
    "herdr-app do x",
  ]) {
    expect(judgeBash(readBash(line), ctx)?.decision).toBe("deny");
  }
  expect(judgeBash(readBash("hc events"), ctx)?.reason).toContain("background");
  expect(
    judgeBash(readBash("hc events"), {
      ...ctx,
      input: { tool_input: { run_in_background: true } },
    }),
  ).toBeNull();
  expect(judgeBash(readBash("$(which hc) send t1 hi"), ctx)?.decision).toBe("ask");
  expect(judgeBash(readBash("H=hc; $H send t1 hi"), ctx)?.decision).toBe("ask");
  expect(judgeBash(readBash("echo hc send t1 hi"), ctx)).toBeNull();
  expect(judgedDomain(readBash("hc send t1 hi"))).toBe(true);
});

test("Herdr launch policy reads only explicit launch fields", () => {
  const ctx = world();
  expect(judgeBash(readBash(start), ctx)).toBeNull();
  for (const flag of ["--model sonnet ", "--effort high ", "--mode manual "]) {
    expect(judgeBash(readBash(start.replace(flag, "")), ctx)?.decision).toBe("deny");
  }
  for (const args of ["--model fable --effort high", "--model opus --effort max"]) {
    const line = start.replace("--model sonnet --effort high", args);
    expect(judgeBash(readBash(line), ctx)?.decision).toBe("ask");
    expect(judgeBash(readBash(line.replace(" -- work", " --asked -- work")), ctx)).toBeNull();
  }
  expect(
    judgeBash(readBash(start), {
      ...ctx,
      env: { ...ctx.env, CLAUDE_CODE_SUBAGENT_MODEL: "opus", CLAUDE_CODE_EFFORT_LEVEL: "max" },
    }),
  ).toBeNull();
});

test("Herdr caps each mode pair for linked and independent starts", () => {
  const ctx = world();
  const modes = ["plan", "default", "acceptEdits", "auto", "dontAsk"];
  const allowed = [
    [],
    ["plan", "default"],
    ["plan", "default", "acceptEdits"],
    ["plan", "default", "acceptEdits", "auto"],
    ["plan", "default", "acceptEdits", "auto", "dontAsk"],
  ];
  for (const [i, lead] of modes.entries())
    for (const child of modes)
      for (const independent of ["", " --independent"]) {
        const line = start.replace("--mode manual", `--mode ${child}${independent}`);
        expect({
          lead,
          child,
          independent,
          decision:
            judgeBash(readBash(line), { ...ctx, input: { permission_mode: lead } })?.decision ??
            "silent",
        }).toEqual({
          lead,
          child,
          independent,
          decision: allowed[i]?.includes(child) ? "silent" : "deny",
        });
      }
  expect(judgeBash(readBash(start.replace("manual", "bypassPermissions")), ctx)?.decision).toBe(
    "deny",
  );
  expect(judgeBash(readBash(start), { ...ctx, input: {} })?.decision).toBe("ask");
  expect(
    judgeBash(readBash(start), { ...ctx, input: { permission_mode: "new-mode" } })?.decision,
  ).toBe("ask");
});

test("remote machines fail closed and asked only skips premium and remote asks", () => {
  const ctx = world();
  mkdirSync(dirname(ctx.paths.machinesFile), { recursive: true });
  writeFileSync(
    ctx.paths.machinesFile,
    JSON.stringify({
      version: 1,
      machines: { worker: { allow: true }, live: { allow: true, production: true } },
    }),
  );
  for (const [name, expected] of [
    ["worker", undefined],
    ["unknown", "ask"],
    ["live", "ask"],
  ] as const) {
    const line = start.replace(" -- work", ` --on ${name} -- work`);
    expect(judgeBash(readBash(line), ctx)?.decision).toBe(expected);
    expect(judgeBash(readBash(line.replace(" -- work", " --asked -- work")), ctx)).toBeNull();
  }
  writeFileSync(ctx.paths.machinesFile, "broken");
  expect(
    judgeBash(readBash(start.replace(" -- work", " --on worker -- work")), ctx)?.decision,
  ).toBe("ask");
});

test("answers and machine changes always ask; identity assignments deny", () => {
  const ctx = world();
  for (const action of ["allow", "forget", "production"])
    expect(judgeBash(readBash(`${COMMAND} herdr machines ${action} worker`), ctx)?.decision).toBe(
      "ask",
    );
  for (const answer of ["--option A", "--text yes"]) {
    const verdict = judgeBash(
      readBash(`${COMMAND} herdr answer t1 --expect question --expect-turn 1 ${answer}`),
      ctx,
    );
    expect(verdict?.decision).toBe("ask");
    expect(verdict?.reason).toContain("t1");
    expect(verdict?.reason).toContain(answer.endsWith("A") ? "A" : "yes");
  }
  for (const line of [
    `HC_TERMINAL_ID=x ${COMMAND} herdr send t1 hi`,
    `export HC_TERMINAL_ID; hc ls`,
    `HC_TERMINAL_ID=x; hc ls`,
    `env HC_TERMINAL_ID=x hc ls`,
    `bash -c 'HC_TERMINAL_ID=x hc ls'`,
  ])
    expect(judgeBash(readBash(line), ctx)?.decision).toBe("deny");
  expect(judgeBash(readBash("echo HC_TERMINAL_ID=x; hc ls"), ctx)).toBeNull();
  expect(judgeBash(readBash("echo safe"), ctx)).toBeNull();
});

test("Herdr reports are not the person; children get Herdr recovery words", () => {
  expect(hasNotPersonWrapper('<hc from="t1">report')).toBe(true);
  expect(hasNotPersonWrapper('<kit-report from="t1">report')).toBe(true);
  const reason = keepGoingReason(
    [{ number: 1, subject: "Build", plan: "plan", agent: "herdr:core/t1" }],
    [],
  );
  expect(reason).toContain(`${COMMAND} herdr wait`);
  expect(reason).toContain("background");
  expect(reason).toContain("herdr send");
  expect(reason).not.toContain("SendMessage");
});

test("the frame denies and parks Herdr answers while the person is away", async () => {
  const env = hookEnv();
  const paths = cliPaths(env);
  await setUnavailable(paths.stateDir, Date.now(), null);
  const command = `${COMMAND} herdr answer t1 --expect question --expect-turn 1 --option A`;
  const result = await runHook(
    jobRouteHook,
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      session_id: "test-session",
      cwd: makeRepo(),
      tool_input: { command },
    },
    env,
  );
  expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
  expect(readAway(paths.stateDir).items[0]?.command).toBe(command);
});

test("the hook asks outside git too", async () => {
  const env = hookEnv();
  const result = await runHook(
    jobRouteHook,
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: tempDir("outside-git"),
      tool_input: {
        command: `${COMMAND} herdr answer t1 --expect question --expect-turn 1 --option A`,
      },
    },
    env,
  );
  expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
});
