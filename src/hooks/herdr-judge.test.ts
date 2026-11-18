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
    ["keys", "herdr send"],
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
    expect(judgeBash(readBash(line.replace(" -- work", " --asked -- work")), ctx)?.decision).toBe(
      "ask",
    );
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

test("remote machines fail closed even with asked", () => {
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
    expect(judgeBash(readBash(line.replace(" -- work", " --asked -- work")), ctx)?.decision).toBe(
      expected,
    );
  }
  writeFileSync(ctx.paths.machinesFile, "broken");
  expect(
    judgeBash(readBash(start.replace(" -- work", " --on worker --asked -- work")), ctx)?.decision,
  ).toBe("ask");
  expect(
    judgeBash(readBash(start.replace(" -- work", " --on worker -- work")), ctx)?.decision,
  ).toBe("ask");
});

test("machine changes always ask; identity assignments deny", () => {
  const ctx = world();
  for (const action of ["allow", "forget", "production"])
    expect(judgeBash(readBash(`${COMMAND} herdr machines ${action} worker`), ctx)?.decision).toBe(
      "ask",
    );
  // 4.10.1: no relay; a removed verb is the CLI's usage error, and the judge asks nothing.
  expect(
    judgeBash(readBash(`${COMMAND} herdr answer t1 --expect q --expect-turn 1 --option A`), ctx),
  ).toBeNull();
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

test("the frame denies and parks a Herdr machine change while the person is away", async () => {
  const env = hookEnv();
  const paths = cliPaths(env);
  await setUnavailable(paths.stateDir, Date.now(), null);
  const command = `${COMMAND} herdr machines allow worker`;
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
        command: `${COMMAND} herdr machines allow worker`,
      },
    },
    env,
  );
  expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
});

const identityRows: [string, string][] = [
  ["bash", "HC_TERMINAL_ID+=x; hc ls"],
  ["bash", "HC_TERMINAL_ID+=x hc ls"],
  ...["export", "declare", "typeset", "local", "readonly"].map((cmd): [string, string] => [
    "bash",
    `${cmd} HC_TERMINAL_ID=x; hc ls`,
  ]),
  ["bash", "printf -v HC_TERMINAL_ID x; hc ls"],
  ...["read", "mapfile", "readarray"].map((cmd): [string, string] => [
    "bash",
    `${cmd} HC_TERMINAL_ID; hc ls`,
  ]),
  ["powershell", "$env:hc_terminal_id = 'x'; hc ls"],
  ...["Set-Item", "si", "New-Item", "ni"].map((cmd): [string, string] => [
    "powershell",
    `${cmd} env:hc_terminal_id x; hc ls`,
  ]),
  ["powershell", "[Environment]::SetEnvironmentVariable('HC_TERMINAL_ID', 'x'); hc ls"],
];
test.each(identityRows)("identity assignment %s %s denies", (dialect, line) => {
  const verdict = judgeBash(
    readBash(line, dialect === "powershell" ? "powershell" : "bash"),
    world(),
  );
  expect(verdict?.decision).toBe("deny");
  expect(verdict?.reason).toContain("HC_TERMINAL_ID");
});
test.each(["machines -- allow worker", "machines typo", "machines allow"])("%s asks", (args) => {
  expect(judgeBash(readBash(`${COMMAND} herdr ${args}`), world())?.decision).toBe("ask");
});
test("computed export asks, unset passes, and unrelated computed programs pass", () => {
  expect(judgeBash(readBash("export $V=x; hc ls"), world())?.decision).toBe("ask");
  expect(judgeBash(readBash("env -u HC_TERMINAL_ID hc ls"), world())).toBeNull();
  expect(judgeBash(readBash("$PY -m pytest -k herdr"), world())).toBeNull();
});
test("help and raw read flags stay silent", () => {
  for (const args of ["start --help", "machines --help", "machines", "machines list"])
    expect(judgeBash(readBash(`${COMMAND} herdr ${args}`), world())).toBeNull();
  for (const args of ["--json ls", "-V", "--skill", "send --help", "kill -h"])
    expect(judgeBash(readBash(`hc ${args}`), world())).toBeNull();
  expect(judgeBash(readBash("hc attach t1"), world())?.reason).toContain("herdr send");
});
test("asked never widens a mode and bypass lead names the lead", () => {
  expect(
    judgeBash(
      readBash(start.replace("manual", "dontAsk").replace(" -- work", " --asked -- work")),
      world(),
    )?.decision,
  ).toBe("deny");
  const verdict = judgeBash(readBash(start), {
    ...world(),
    input: { permission_mode: "bypassPermissions" },
  });
  expect(verdict?.decision).toBe("deny");
  expect(verdict?.reason).toContain("lead's own mode");
});
test.each([
  start.replace("sonnet", "fable"),
  start.replace(" -- work", " --on unknown --asked -- work"),
  `${COMMAND} herdr machines allow worker`,
])("unattended ask denies %s", (line) => {
  const ctx = world();
  const verdict = judgeBash(readBash(line), {
    ...ctx,
    env: { ...ctx.env, CLAUDE_CODE_SESSION_ATTENDED: "0" },
  });
  expect(verdict?.decision).toBe("deny");
  expect(verdict?.reason).toContain("Nobody answers");
});

test("PowerShell raw writes deny and premium starts ask even with asked", () => {
  const ctx = world();
  expect(judgeBash(readBash("hc send t1 hi", "powershell"), ctx)?.decision).toBe("deny");
  expect(
    judgeBash(
      readBash(
        start.replace("sonnet", "fable").replace(" -- work", " --asked -- work"),
        "powershell",
      ),
      ctx,
    )?.decision,
  ).toBe("ask");
});

test.each([
  ["fable", "high"],
  ["opus", "max"],
])("asked still asks for %s %s", (model, effort) => {
  const line = `${COMMAND} herdr start --model ${model} --effort ${effort} --mode manual --asked -- work`;
  expect(judgeBash(readBash(line), world())?.decision).toBe("ask");
});
test.each([
  "hc run --bg -- bash -c 'x' -V",
  "hc exec -- sh -c 'x' --version",
  "hc run --bg bash -c 'x' -h",
  "hc file write /tmp/x --version",
  "hc send t1 -- --version",
])("read flag is data: %s", (line) => {
  expect(judgeBash(readBash(line), world())?.decision).toBe("deny");
});
test.each(["--version", "--json -V", "--skill", "--help", "-h", "send --help", "--json kill -h"])(
  "positional hc read: %s",
  (args) => {
    expect(judgeBash(readBash(`hc ${args}`), world())).toBeNull();
  },
);
test.each([
  ["$K herdr start --model sonnet --effort high --mode dontAsk -- w", "deny"],
  ["$K herdr machines allow live", "ask"],
  ["HC_TERMINAL_ID=x $K herdr send t1 hi", "deny"],
] as const)("computed kit verb %s", (line, expected) => {
  expect(judgeBash(readBash(line), world())?.decision).toBe(expected);
});
test.each([
  "for HC_TERMINAL_ID in x; do hc ls; done",
  "select HC_TERMINAL_ID in x; do hc ls; done",
  "printf -vHC_TERMINAL_ID x; hc ls",
  "let HC_TERMINAL_ID=1; hc ls",
  "getopts x HC_TERMINAL_ID; hc ls",
  "declare -n ref=HC_TERMINAL_ID; hc ls",
  "typeset -n ref=HC_TERMINAL_ID; hc ls",
  "(( HC_TERMINAL_ID = 5 )); hc ls",
  'let "HC_TERMINAL_ID = 1"; hc ls',
  "declare -gn ref=HC_TERMINAL_ID; hc ls",
  "typeset -gn ref=HC_TERMINAL_ID; hc ls",
  "local -n R=HC_TERMINAL_ID; hc ls",
])("more Bash identity: %s", (line) => {
  const v = judgeBash(readBash(line), world());
  expect(v?.decision).toBe("deny");
  expect(v?.reason).toContain("HC_TERMINAL_ID");
});
test.each([
  "Set-Item env:/HC_TERMINAL_ID x; hc ls",
  "Set-Item env:\\HC_TERMINAL_ID x; hc ls",
  "Rename-Item Env:OTHER HC_TERMINAL_ID; hc ls",
  ...["Set-Content", "Add-Content", "Copy-Item", "Move-Item"].map(
    (cmd) => `${cmd} x env:/hc_terminal_id; hc ls`,
  ),
])("more PowerShell identity: %s", (line) => {
  const v = judgeBash(readBash(line, "powershell"), world());
  expect(v?.decision).toBe("deny");
  expect(v?.reason).toContain("HC_TERMINAL_ID");
});

test.each(["unknown", "production", "broken"])("asked still asks for remote %s", (kind) => {
  const ctx = world();
  mkdirSync(dirname(ctx.paths.machinesFile), { recursive: true });
  writeFileSync(
    ctx.paths.machinesFile,
    kind === "broken"
      ? "broken"
      : JSON.stringify({
          version: 1,
          machines: { worker: kind === "production" ? { allow: true, production: true } : {} },
        }),
  );
  expect(
    judgeBash(readBash(start.replace(" -- work", " --on worker --asked -- work")), ctx)?.decision,
  ).toBe("ask");
});

test.each(['\n<hc from="t1">report', '  <kit-report from="t1">report'])(
  "leading whitespace report %s",
  (prompt) => {
    expect(hasNotPersonWrapper(prompt)).toBe(true);
  },
);
test.each([start, start.replace(" -- work", " --independent -- work")])(
  "unattended ordinary start denies %s",
  (line) => {
    const ctx = world();
    expect(
      judgeBash(readBash(line), { ...ctx, env: { ...ctx.env, CLAUDE_CODE_SESSION_ATTENDED: "0" } })
        ?.decision,
    ).toBe("deny");
  },
);
test("raw remote reads obey machine rules and fail closed", () => {
  const ctx = world();
  mkdirSync(dirname(ctx.paths.machinesFile), { recursive: true });
  writeFileSync(
    ctx.paths.machinesFile,
    JSON.stringify({
      version: 1,
      machines: { free: { allow: true }, prod: { allow: true, production: true } },
    }),
  );
  for (const command of [
    "hc file read --on prod /brief",
    "hc file read --on=prod /brief",
    "hc read prod/t1",
    "hc read --lines 50 prod/t1",
    "hc get prod/t1",
    "hc wait prod/t1",
    "hc wait --children prod/t1",
    "hc wait --children=prod/t1 --timeout 30",
    "hc read unknown/t1",
  ])
    expect(judgeBash(readBash(command), ctx)?.decision).toBe("ask");
  expect(judgeBash(readBash("hc read free/t1"), ctx)).toBeNull();
  expect(judgeBash(readBash("hc read t1"), ctx)).toBeNull();
  for (const flag of [
    "--terminal prod/t1",
    "--terminal=prod/t1",
    "--children-of prod/t1",
    "--children-of=prod/t1",
  ]) {
    expect(
      judgeBash(readBash(`hc events ${flag}`), {
        ...ctx,
        input: { tool_input: { run_in_background: true } },
      })?.decision,
    ).toBe("ask");
  }
  writeFileSync(ctx.paths.machinesFile, "broken");
  expect(judgeBash(readBash("hc read free/t1"), ctx)?.decision).toBe("ask");
});

test("herdr plans --release asks, and every other plans form stays silent", () => {
  for (const line of [
    `${COMMAND} herdr plans --release alpha`,
    `${COMMAND} herdr plans --json --release alpha`,
    `${COMMAND} herdr plans --release=alpha`,
    `${COMMAND} herdr plans --release`,
  ]) {
    const verdict = judgeBash(readBash(line), world());
    expect(verdict?.decision).toBe("ask");
    expect(verdict?.reason).toContain("Approve releasing a finished plan's files");
  }
  for (const args of [
    "plans",
    "plans --json",
    "plans --wait",
    "plans --wait --timeout 30",
    // It reserves the caller's own plan: a bookkeeping write, not a release of anything.
    "plans --reserve alpha",
    "plans --reserve=alpha",
    "plans --help",
  ])
    expect(judgeBash(readBash(`${COMMAND} herdr ${args}`), world())).toBeNull();
});

test("the frame denies and parks herdr plans --release while the person is away", async () => {
  const env = hookEnv();
  const paths = cliPaths(env);
  await setUnavailable(paths.stateDir, Date.now(), null);
  const command = `${COMMAND} herdr plans --release alpha`;
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
