/**
 * The deploy guard (`deploy-guard.ts`). Each group has commands that MUST match a listed deploy
 * command and look-alikes that MUST NOT: a guard that asks about `echo vercel --prod` gets
 * switched off. Every expected answer is written by hand.
 *
 * The first groups read the matcher directly (`deploysOf`); the hook itself, with its silent
 * cases, its question, a project file that cannot be read, a crash and the log, runs through
 * the frame (`runHook`, `runEntry`). `matrix.test.ts` runs the `ownHooks` and `requires` rows.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDeployTask } from "../tasks/deploy/format";
import { hookEnv, makeClone, makeRepo, runEntry, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { type DeployLists, deployRulesOf, deploysOf } from "./deploy-guard";
import type { HookResult } from "./io";
import { HOOK_LOG_ENV, handleHook } from "./run";
import { deployGuardHook } from "./specs";

/** The listed deploys a command runs, as `env:index` (the place in the environment's list). */
function hits(
  command: string,
  lists: DeployLists,
  dialect: "bash" | "powershell" | undefined = "bash",
): string[] {
  return deploysOf(command, dialect, deployRulesOf(lists)).map((one) => `${one.env}:${one.index}`);
}

const PROD_VERCEL: DeployLists = { prod: ["vercel --prod"] };
const PROD_SCRIPT: DeployLists = { prod: ["npm run deploy:prod"] };
const PROD_FILE: DeployLists = { prod: ["./scripts/deploy.sh prod"] };

describe("spellings that run a listed command match", () => {
  test.each([
    // the command as typed, and the runners
    ["vercel --prod"],
    ["npx vercel --prod"],
    ["npx --yes vercel --prod"],
    ["bunx vercel --prod"],
    ["pnpm dlx vercel --prod"],
    ["pnpm exec vercel --prod"],
    ["yarn dlx vercel --prod"],
    ["npm exec vercel -- --prod"],
    ["bun x vercel --prod"],
    ["./node_modules/.bin/vercel --prod"],
    // assignments, wrappers, a folder change, a second command
    ["VERCEL_TOKEN=x vercel --prod"],
    ["VERCEL_TOKEN=x VERCEL_ORG=y npx vercel --prod"],
    ["cd app && vercel --prod"],
    ["cd app; vercel --prod"],
    ["bun test && vercel --prod"],
    ["sudo vercel --prod"],
    ["sudo -u deploy vercel --prod"],
    ["timeout 600 vercel --prod"],
    ["env CI=1 vercel --prod"],
    ["nice -n 5 vercel --prod"],
    ["time vercel --prod"],
    // another shell runs it
    ['bash -c "vercel --prod"'],
    ["sh -c 'cd app && vercel --prod'"],
    ["bash -lc 'vercel --prod'"],
    ["echo go | sh -s <<< 'vercel --prod'"],
    ["eval vercel --prod"],
    ["(cd app && vercel --prod)"],
    ["$(vercel --prod)"],
    // a run with a redirection or more words
    ["vercel --prod > deploy.log 2>&1"],
    ["vercel --prod --yes"],
    ["vercel deploy --prod"],
    // the over-match the plan accepts: the guard speaks only while a problem is open
    ["vercel --prod --help"],
    // the queue's own command, which runs it
    ["cc-smart-dev-kit job run --kind build -- vercel --prod"],
    ['"$HOME/.local/bin/cc-smart-dev-kit" job run -- vercel --prod'],
  ])("%s", (command) => {
    expect(hits(command, PROD_VERCEL)).toEqual(["prod:0"]);
  });

  test("PowerShell: vercel.cmd, an .exe, a call, a folder change", () => {
    for (const command of [
      "vercel.cmd --prod",
      "vercel.exe --prod",
      "& vercel --prod",
      "Set-Location app; vercel --prod",
      'powershell -Command "vercel --prod"',
      "pwsh -c 'npx vercel --prod'",
      "Start-Process vercel -ArgumentList '--prod'",
    ]) {
      expect({ command, hits: hits(command, PROD_VERCEL, "powershell") }).toEqual({
        command,
        hits: ["prod:0"],
      });
    }
  });

  test.each([
    ["npm run deploy:prod"],
    ["npm run-script deploy:prod"],
    ["npm --prefix app run deploy:prod"],
    ["pnpm deploy:prod"],
    ["pnpm run deploy:prod"],
    ["pnpm -C app deploy:prod"],
    ["yarn deploy:prod"],
    ["bun run deploy:prod"],
    ["bun --cwd app run deploy:prod"],
    ["cd app && npm run deploy:prod -- --yes"],
    ["bash -c 'bun run deploy:prod'"],
  ])("a script rule: %s", (command) => {
    expect(hits(command, PROD_SCRIPT)).toEqual(["prod:0"]);
  });

  test.each([
    ["./scripts/deploy.sh prod"],
    ["scripts/deploy.sh prod"],
    ["/work/app/scripts/deploy.sh prod"],
    ["bash scripts/deploy.sh prod"],
    ["bash ./scripts/deploy.sh prod --force"],
    ["bash -o pipefail scripts/deploy.sh prod"],
    ["bash -eo pipefail scripts/deploy.sh prod"],
    ["sh scripts/deploy.sh prod"],
    ["zsh scripts/deploy.sh prod"],
    ["source scripts/deploy.sh prod"],
    [". scripts/deploy.sh prod"],
    ["sudo bash scripts/deploy.sh prod"],
    ["CI=1 bash scripts/deploy.sh prod"],
    ["cd app && bash scripts/deploy.sh prod"],
    ["bash -c 'bash scripts/deploy.sh prod'"],
  ])("a script file rule: %s", (command) => {
    expect(hits(command, PROD_FILE)).toEqual(["prod:0"]);
  });

  test("a script file under PowerShell", () => {
    expect(hits(".\\scripts\\deploy.sh prod", PROD_FILE, "powershell")).toEqual(["prod:0"]);
    expect(hits("bash scripts/deploy.sh prod", PROD_FILE, "powershell")).toEqual(["prod:0"]);
  });

  test("a node or python script file", () => {
    const lists: DeployLists = { prod: ["node scripts/deploy.js prod", "python3 deploy.py"] };
    expect(hits("node scripts/deploy.js prod", lists)).toEqual(["prod:0"]);
    expect(hits("node scripts/deploy.js prod --yes", lists)).toEqual(["prod:0"]);
    expect(hits("python3 deploy.py", lists)).toEqual(["prod:1"]);
    expect(hits("python3 -u deploy.py now", lists)).toEqual(["prod:1"]);
  });

  test("a script file is the same tool by its own name and given to node: its extension stays", () => {
    const lists: DeployLists = { prod: ["./scripts/deploy.mjs prod"] };
    for (const command of [
      "./scripts/deploy.mjs prod",
      "node scripts/deploy.mjs prod",
      "node deploy.mjs prod",
      "node ./a/b/deploy.mjs prod --yes",
      "bash -c 'node scripts/deploy.mjs prod'",
    ]) {
      expect({ command, hits: hits(command, lists) }).toEqual({ command, hits: ["prod:0"] });
    }
    for (const command of ["node scripts/deploy.mjs staging", "node scripts/other.mjs prod"]) {
      expect({ command, hits: hits(command, lists) }).toEqual({ command, hits: [] });
    }
    // Not seen, and the docs say so: `npx` reads a path as the package runner's tool name, which
    // drops `.js`, `.mjs` and `.cjs`.
    expect(hits("npx ./scripts/deploy.mjs prod", lists)).toEqual([]);
    expect(hits("node deploy.js prod", { prod: ["node scripts/deploy.js prod"] })).toEqual([
      "prod:0",
    ]);
    expect(hits("node deploy.cjs prod", { prod: ["./deploy.cjs prod"] })).toEqual(["prod:0"]);
    expect(
      hits("node scripts/deploy.mjs prod", { prod: [{ tool: "deploy.mjs", sub: ["prod"] }] }),
    ).toEqual(["prod:0"]);
  });

  test("a package script and a script file of the same base name are different commands", () => {
    const lists: DeployLists = { prod: ["./deploy.js"], staging: ["pnpm deploy"] };
    expect(hits("pnpm deploy", lists)).toEqual(["staging:0"]);
    expect(hits("yarn deploy", lists)).toEqual(["staging:0"]);
    expect(hits("./deploy.js", lists)).toEqual(["prod:0"]);
    expect(hits("node deploy.js", lists)).toEqual(["prod:0"]);
    expect(hits("node scripts/deploy.js", lists)).toEqual(["prod:0"]);
    expect(hits("bash -c 'pnpm deploy'", lists)).toEqual(["staging:0"]);
  });

  test("PowerShell given a script file runs that file", () => {
    const lists: DeployLists = { prod: [".\\scripts\\deploy.ps1 prod"] };
    for (const command of [
      "pwsh ./scripts/deploy.ps1 prod",
      "pwsh .\\scripts\\deploy.ps1 prod",
      "pwsh -File .\\scripts\\deploy.ps1 prod",
      "pwsh -file .\\scripts\\deploy.ps1 prod",
      "pwsh -f .\\scripts\\deploy.ps1 prod",
      "pwsh -NoProfile -NonInteractive -File .\\scripts\\deploy.ps1 prod",
      "powershell -ExecutionPolicy Bypass -File .\\scripts\\deploy.ps1 prod",
      "powershell.exe -ex Bypass -NoLogo .\\scripts\\deploy.ps1 prod",
      "pwsh -WorkingDirectory app -ConfigurationName x -File .\\scripts\\deploy.ps1 prod -Yes",
    ]) {
      expect({ command, hits: hits(command, lists, "powershell") }).toEqual({
        command,
        hits: ["prod:0"],
      });
    }
    // -Command and -EncodedCommand run no file: the command string is `nestedCommand`'s, and the
    // line it holds is read as a line (it runs the file, by its own name).
    expect(hits("pwsh -Command .\\scripts\\deploy.ps1 prod", lists, "powershell")).toEqual([
      "prod:0",
    ]);
    expect(hits('pwsh -NoProfile -Command "vercel --prod"', PROD_VERCEL, "powershell")).toEqual([
      "prod:0",
    ]);
    expect(hits("pwsh -c 'npx vercel --prod'", PROD_VERCEL, "powershell")).toEqual(["prod:0"]);
    for (const command of [
      "pwsh -File .\\scripts\\deploy.ps1 staging",
      "pwsh -ExecutionPolicy .\\scripts\\deploy.ps1 prod",
      "pwsh -ec AAAA",
      "pwsh -EncodedCommand AAAA",
      "pwsh -File",
      "pwsh -",
      "pwsh",
    ]) {
      expect({ command, hits: hits(command, lists, "powershell") }).toEqual({ command, hits: [] });
    }
  });

  test("a listed Windows path matches under PowerShell", () => {
    const lists: DeployLists = {
      prod: [
        ".\\scripts\\deploy.ps1 prod",
        "scripts\\release.cmd prod",
        "C:\\tools\\ship.exe --prod",
      ],
    };
    for (const [command, expected] of [
      [".\\scripts\\deploy.ps1 prod", "prod:0"],
      ["& .\\scripts\\deploy.ps1 prod", "prod:0"],
      ["pwsh -File .\\scripts\\deploy.ps1 prod", "prod:0"],
      ["scripts\\release.cmd prod", "prod:1"],
      ["scripts\\release.cmd prod > out.txt", "prod:1"],
      ["C:\\tools\\ship.exe --prod", "prod:2"],
      ["& 'C:\\tools\\ship.exe' --prod", "prod:2"],
      ["ship.exe --prod", "prod:2"],
      [".\\scripts\\deploy.ps1 staging", undefined],
      ["scripts\\release.cmd staging", undefined],
      ["C:\\tools\\ship.exe --preview", undefined],
    ] as const) {
      expect({ command, hits: hits(command, lists, "powershell") }).toEqual({
        command,
        hits: expected === undefined ? [] : [expected],
      });
    }
  });

  test("the words after a script's name are part of its rule: staging is not prod", () => {
    const lists: DeployLists = {
      prod: ["npm run deploy -- prod"],
      staging: ["npm run deploy -- staging"],
    };
    for (const [command, expected] of [
      ["npm run deploy -- prod", ["prod:0"]],
      ["npm run deploy -- staging", ["staging:0"]],
      ["npm run-script deploy -- staging", ["staging:0"]],
      ["npm --prefix app run deploy -- prod --yes", ["prod:0"]],
      ["pnpm deploy prod", ["prod:0"]],
      ["pnpm run deploy staging", ["staging:0"]],
      ["yarn deploy staging", ["staging:0"]],
      ["bun run deploy prod", ["prod:0"]],
      ["cd app && npm run deploy -- staging", ["staging:0"]],
      ["npm run deploy", []],
      ["npm run deploy -- production", []],
      ["npm run deploy -- dev", []],
      ["npm run other -- prod", []],
    ] as const) {
      expect({ command, hits: hits(command, lists) }).toEqual({ command, hits: [...expected] });
    }
  });

  test("a script's option words are held too", () => {
    const lists: DeployLists = { prod: ["npm run deploy -- --target prod --yes"] };
    expect(hits("npm run deploy -- --target prod --yes", lists)).toEqual(["prod:0"]);
    expect(hits("npm run deploy -- --yes --target prod", lists)).toEqual(["prod:0"]);
    expect(hits("npm run deploy -- --target prod", lists)).toEqual([]);
    expect(hits("npm run deploy -- --target staging --yes", lists)).toEqual([]);
  });

  test("pnpm, yarn or bun with a bare word is a script or a tool: either spelling matches", () => {
    const lists: DeployLists = { prod: ["pnpm vercel --prod"] };
    for (const command of [
      "pnpm vercel --prod",
      "yarn vercel --prod",
      "bun vercel --prod",
      "pnpm run vercel --prod",
      "npx vercel --prod",
      "pnpm dlx vercel --prod",
      "vercel --prod",
      "vercel --prod --yes",
    ]) {
      expect({ command, hits: hits(command, lists) }).toEqual({ command, hits: ["prod:0"] });
    }
    for (const command of [
      "pnpm vercel dev",
      "pnpm vercel",
      "pnpm vercel --preview",
      "pnpm vercel --production",
      "npx vercel dev",
      "vercel",
    ]) {
      expect({ command, hits: hits(command, lists) }).toEqual({ command, hits: [] });
    }
    // The entry is one entry: a run both rules match is reported once.
    expect(deploysOf("pnpm vercel --prod", "bash", deployRulesOf(lists))).toHaveLength(1);
    expect(deployRulesOf(lists)).toHaveLength(2);
  });

  test("a match rule of the jobs grammar", () => {
    expect(hits("vercel deploy --prod", { prod: [{ tool: "vercel", sub: ["deploy"] }] })).toEqual([
      "prod:0",
    ]);
    expect(hits("make deploy", { prod: [{ tool: "make", sub: ["deploy"] }] })).toEqual(["prod:0"]);
    expect(hits("npm run ship", { prod: [{ script: "ship" }] })).toEqual(["prod:0"]);
    expect(hits("vercel --prod", { prod: [{ tool: "vercel", argIncludes: "PROD" }] })).toEqual([
      "prod:0",
    ]);
  });

  test("each environment and each place in the list is told apart", () => {
    const lists: DeployLists = {
      prod: ["vercel --prod", "fly deploy"],
      staging: ["vercel --target=staging"],
    };
    expect(hits("fly deploy --app web", lists)).toEqual(["prod:1"]);
    expect(hits("vercel --target=staging", lists)).toEqual(["staging:0"]);
    expect(hits("vercel --prod && fly deploy", lists)).toEqual(["prod:0", "prod:1"]);
  });
});

describe("look-alikes that run no listed command do not match", () => {
  test.each([
    // an option is a whole word
    ["vercel --production"],
    ["vercel --prod-run"],
    ["vercel --pro"],
    // the words only named, not run
    ["echo vercel --prod"],
    ["echo 'vercel --prod'"],
    ["printf '%s' \"vercel --prod\""],
    ["git commit -m 'run vercel --prod'"],
    ["cat <<'EOF'\nvercel --prod\nEOF"],
    ["# vercel --prod"],
    ["grep vercel --prod notes.txt"],
    ["man vercel --prod"],
    // another program, or the program without its words
    ["vercel"],
    ["vercel deploy"],
    ["vercel --preview"],
    ["vercell --prod"],
    ["my-vercel --prod"],
    ["npx vercel-cli --prod"],
    ["ls"],
    ["git status"],
    [""],
  ])("%s", (command) => {
    expect(hits(command, PROD_VERCEL)).toEqual([]);
  });

  test.each([
    ["npm run deploy:staging"],
    ["npm run deploy"],
    ["npm run deploy:prod:dry"],
    ["npm test"],
    ["echo npm run deploy:prod"],
    ["npm install deploy:prod"],
  ])("a script rule: %s", (command) => {
    expect(hits(command, PROD_SCRIPT)).toEqual([]);
  });

  test.each([
    ["bash scripts/deploy.sh staging"],
    ["bash scripts/deploy.sh"],
    ["bash scripts/other.sh prod"],
    ["bash -c 'scripts/deploy.sh staging'"],
    ["cat scripts/deploy.sh prod"],
    ["echo scripts/deploy.sh prod"],
    ["bash -n scripts/deploy.sh"],
    ["shellcheck scripts/deploy.sh prod"],
  ])("a script file rule: %s", (command) => {
    expect(hits(command, PROD_FILE)).toEqual([]);
  });
});

describe("a program named at run time", () => {
  const lists: DeployLists = {
    prod: ["vercel --prod", "fly deploy", "vercel", "npm run deploy:prod", "make"],
  };

  test("matches only a rule that requires a word the arguments hold", () => {
    // `--prod` and `deploy` are in the arguments; a rule of a tool alone, or of a script, cannot
    // be told from any other `$X`.
    expect(hits("$DEPLOY --prod", lists)).toEqual(["prod:0"]);
    expect(hits("$DEPLOY deploy", lists)).toEqual(["prod:1"]);
    expect(hits("$(which vercel) --prod", lists)).toEqual(["prod:0"]);
    expect(hits("$(which fly) deploy --app web", lists)).toEqual(["prod:1"]);
    expect(hits("sudo $DEPLOY --prod", lists)).toEqual(["prod:0"]);
    expect(hits("$DEPLOY --prod --yes", lists)).toEqual(["prod:0"]);
  });

  test("a one-word rule never matches a computed run", () => {
    expect(hits("$X foo", { prod: ["vercel"] })).toEqual([]);
    expect(hits("$X", { prod: ["vercel"] })).toEqual([]);
    expect(hits("$X --prod", { prod: [{ tool: "vercel" }] })).toEqual([]);
    expect(hits("$X deploy:prod", { prod: ["npm run deploy:prod"] })).toEqual([]);
    expect(hits("$X ship", { prod: [{ script: "ship" }] })).toEqual([]);
  });

  test("a computed run whose arguments miss the required words does not match", () => {
    expect(hits("$DEPLOY --preview", lists)).toEqual([]);
    expect(hits("$DEPLOY --production", lists)).toEqual([]);
    expect(hits("$DEPLOY", lists)).toEqual([]);
    expect(hits("$DEPLOY status", lists)).toEqual([]);
  });
});

describe("a rule never asks for a redirection's words", () => {
  test("a listed command typed with a redirection matches the plain run and the redirected one", () => {
    // `vercel --prod > log.txt` is the rule `vercel --prod`: the reader drops the redirection
    // on both sides, so the rule never needs `log.txt` or `<<EOF` in the run.
    for (const listed of ["vercel --prod > log.txt", "vercel --prod <<< x", "vercel --prod 2>&1"]) {
      for (const run of [
        "vercel --prod",
        "vercel --prod > other.txt",
        "vercel --prod >>out 2>&1",
      ]) {
        expect({ listed, run, hits: hits(run, { prod: [listed] }) }).toEqual({
          listed,
          run,
          hits: ["prod:0"],
        });
      }
      expect(hits("vercel --preview", { prod: [listed] })).toEqual([]);
    }
    expect(hits("vercel", { prod: ["vercel <<EOF"] })).toEqual(["prod:0"]);
  });
});

describe("a string with a quote that never closes", () => {
  test("is read as a run of the same text reads it; the rule matches that text", () => {
    // Ruling: the rule asks for the word the open quote holds, as the reader reads it at run
    // time (`blindWhenOpen`); a run without it is another command.
    const lists: DeployLists = { prod: ["vercel --prod 'unterminated"] };
    expect(hits("vercel --prod 'unterminated", lists)).toEqual(["prod:0"]);
    expect(hits("vercel --prod unterminated", lists)).toEqual(["prod:0"]);
    expect(hits("vercel --prod", lists)).toEqual([]);
  });
});

describe("a line that holds a quote that never closes is read blind", () => {
  test("a listed command after the open quote is still found", () => {
    expect(hits("echo 'a; vercel --prod", PROD_VERCEL)).toEqual(["prod:0"]);
    expect(hits('echo "a && vercel --prod', PROD_VERCEL)).toEqual(["prod:0"]);
  });
});

// ---------------------------------------------------------------------------------------
// The hook, through the frame.
// ---------------------------------------------------------------------------------------

const SESSION = "11111111-2222-3333-4444-555555555555";

/** The files of one deploy task, as the task commands write them. */
function writeTask(
  repo: string,
  fields: {
    id: string;
    env?: "prod" | "staging";
    status?: "open" | "done" | "dropped";
    deploy?: "before" | "after";
    type?: "blocking" | "non-blocking";
    twin?: string;
    title?: string;
    dir?: string;
    archived?: boolean;
  },
): void {
  const env = fields.env ?? (fields.id.startsWith("staging") ? "staging" : "prod");
  const folder = join(
    repo,
    fields.dir ?? ".claude/tasks",
    env,
    ...(fields.archived ? ["archive"] : []),
  );
  mkdirSync(folder, { recursive: true });
  const file = `${fields.id}-task.md`;
  writeFileSync(
    join(folder, file),
    renderDeployTask({
      id: fields.id,
      title: fields.title ?? "Seed the data",
      env,
      status: fields.status ?? "open",
      deploy: fields.deploy ?? "before",
      type: fields.type ?? "blocking",
      ...(fields.twin === undefined ? {} : { twin: fields.twin }),
      created: "2026-01-01T00:00:00Z",
      ...(fields.status === "done" || fields.status === "dropped"
        ? { closed: "2026-01-02T00:00:00Z", evidence: "done by hand" }
        : {}),
      body: "Do it.\n",
      file,
    }),
  );
}

const BLOCKING = { id: "prod-20260101-000000" };
const LISTED = { tasks: { deployCommands: { prod: ["vercel --prod", "fly deploy"] } } };

/** A repo whose project file is `config` (none for null); the hook's environment. */
function world(config: unknown = LISTED): { repo: string; env: Record<string, string> } {
  const repo = makeRepo();
  if (config !== null) writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
  return { repo, env: hookEnv() };
}

function callOf(repo: string, command: string, tool = "Bash"): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd: repo,
    tool_name: tool,
    tool_input: { command },
  };
}

/** The question a result asks, or null for silence (and then nothing else is said). */
function askOf(result: HookResult): string | null {
  if (result.stdout === undefined) return null;
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  expect(output.hookEventName).toBe("PreToolUse");
  expect(output.permissionDecision).toBe("ask");
  return output.permissionDecisionReason;
}

const ask = async (
  repo: string,
  env: Record<string, string>,
  command: string,
  tool = "Bash",
): Promise<string | null> =>
  askOf(await runHook(deployGuardHook, callOf(repo, command, tool), env));

const WAY_OUT =
  "Do the task and close it with evidence (/cc-smart-dev-kit:tasks), or drop it yourself in your own terminal.";

describe("the question", () => {
  test("a blocking task holds the deploy: the question names the environment, the task and the way out", async () => {
    const { repo, env } = world();
    writeTask(repo, BLOCKING);
    expect(await ask(repo, env, "vercel --prod")).toBe(
      [
        "cc-smart-dev-kit deploy guard: this command deploys to prod, and prod has open work that holds a deploy:",
        '- Blocking task is open: prod-20260101-000000 "Seed the data": do it, then close it with evidence',
        WAY_OUT,
      ].join("\n"),
    );
  });

  test("it asks, never denies or allows, and for each way the command is spelled", async () => {
    const { repo, env } = world();
    writeTask(repo, BLOCKING);
    for (const command of [
      "npx vercel --prod",
      "cd app && fly deploy",
      'bash -c "vercel --prod"',
      "VERCEL_TOKEN=x vercel --prod > log.txt",
    ]) {
      const reason = await ask(repo, env, command);
      expect({ command, asked: reason?.includes("prod-20260101-000000") }).toEqual({
        command,
        asked: true,
      });
    }
    expect(await ask(repo, env, "vercel.cmd --prod", "PowerShell")).toContain(
      "this command deploys to prod",
    );
  });

  test("every problem is named: two blocking tasks and a broken file", async () => {
    const { repo, env } = world();
    writeTask(repo, BLOCKING);
    writeTask(repo, { id: "prod-20260101-000001", title: "Warm the cache" });
    writeFileSync(join(repo, ".claude/tasks/prod/prod-20260101-000009-bad.md"), "not a task");
    const reason = (await ask(repo, env, "vercel --prod")) ?? "";
    expect(reason).toContain('prod-20260101-000000 "Seed the data"');
    expect(reason).toContain('prod-20260101-000001 "Warm the cache"');
    expect(reason).toContain("prod-20260101-000009-bad.md");
    expect(reason.endsWith(WAY_OUT)).toBe(true);
  });

  test("a prod task whose staging twin is still open holds a prod deploy", async () => {
    const { repo, env } = world();
    writeTask(repo, {
      id: "prod-20260101-000000",
      deploy: "after",
      type: "non-blocking",
      twin: "staging-20260101-000000",
    });
    writeTask(repo, { id: "staging-20260101-000000", deploy: "after", type: "non-blocking" });
    expect(await ask(repo, env, "vercel --prod")).toContain(
      "waits for its staging twin staging-20260101-000000, which is still open",
    );
  });

  test("a task folder the project moved (tasks.dir) is the one read", async () => {
    const { repo, env } = world({
      tasks: { dir: "ops/tasks", deployCommands: { prod: ["vercel --prod"] } },
    });
    writeTask(repo, { ...BLOCKING, dir: "ops/tasks" });
    expect(await ask(repo, env, "vercel --prod")).toContain("prod-20260101-000000");
  });

  test("each matched environment is judged by its own tasks", async () => {
    const { repo, env } = world({
      tasks: { deployCommands: { prod: ["fly deploy"], staging: ["fly deploy --app stg"] } },
    });
    writeTask(repo, { id: "staging-20260101-000000", title: "Stage the data" });
    expect(await ask(repo, env, "fly deploy --app stg")).toContain(
      "this command deploys to staging, and staging has open work",
    );
    // The same command is a prod deploy too, and prod has nothing open: only staging speaks.
    expect(await ask(repo, env, "fly deploy --app stg")).not.toContain("deploys to prod");
    expect(await ask(repo, env, "fly deploy --app web")).toBeNull();
  });
});

describe("the guard is silent", () => {
  test("with no project file", async () => {
    const { repo, env } = world(null);
    writeTask(repo, BLOCKING);
    expect(await runHook(deployGuardHook, callOf(repo, "vercel --prod"), env)).toEqual({});
  });

  test("with a project file that lists no deploy commands", async () => {
    for (const config of [{}, { tasks: {} }, { tasks: { envs: ["prod"] } }, { jobs: {} }]) {
      const { repo, env } = world(config);
      writeTask(repo, BLOCKING);
      expect(await runHook(deployGuardHook, callOf(repo, "vercel --prod"), env)).toEqual({});
    }
  });

  test("when ownHooks names it", async () => {
    const { repo, env } = world({ ...LISTED, ownHooks: ["deploy-guard"] });
    writeTask(repo, BLOCKING);
    expect(await runHook(deployGuardHook, callOf(repo, "vercel --prod"), env)).toEqual({});
  });

  test("when nothing is open: no task folder, an empty one, closed tasks, an archive", async () => {
    const { repo, env } = world();
    expect(await ask(repo, env, "vercel --prod")).toBeNull();
    mkdirSync(join(repo, ".claude/tasks/prod"), { recursive: true });
    expect(await ask(repo, env, "vercel --prod")).toBeNull();
    writeTask(repo, { ...BLOCKING, status: "done", archived: true });
    writeTask(repo, { id: "prod-20260101-000005", status: "dropped", archived: true });
    expect(await ask(repo, env, "vercel --prod")).toBeNull();
  });

  test("when only a note is open: a non-blocking task, a task for after the deploy", async () => {
    const { repo, env } = world();
    writeTask(repo, { id: "prod-20260101-000000", type: "non-blocking" });
    writeTask(repo, { id: "prod-20260101-000001", deploy: "after" });
    expect(await runHook(deployGuardHook, callOf(repo, "vercel --prod"), env)).toEqual({});
  });

  test("when the open problem is another environment's", async () => {
    const { repo, env } = world();
    writeTask(repo, { id: "staging-20260101-000000" });
    expect(await ask(repo, env, "vercel --prod")).toBeNull();
  });

  test("for a command that runs no listed command", async () => {
    const { repo, env } = world();
    writeTask(repo, BLOCKING);
    for (const command of ["ls", "echo vercel --prod", "vercel --production", "git status", ""]) {
      expect({
        command,
        result: await runHook(deployGuardHook, callOf(repo, command), env),
      }).toEqual({
        command,
        result: {},
      });
    }
  });

  test("for a call that is no shell line, and for another event", async () => {
    const { repo, env } = world();
    writeTask(repo, BLOCKING);
    expect(
      await runHook(
        deployGuardHook,
        { ...callOf(repo, "vercel --prod"), tool_name: "Edit", tool_input: { file_path: "x" } },
        env,
      ),
    ).toEqual({});
    expect(
      await runHook(
        deployGuardHook,
        { ...callOf(repo, "vercel --prod"), hook_event_name: "PostToolUse" },
        env,
      ),
    ).toEqual({});
  });
});

describe("a project file that cannot be used", () => {
  const TOO_NEW = { requires: ">=99", ...LISTED };

  test("a listed command that runs asks, naming the problem and the environment", async () => {
    const { repo, env } = world(TOO_NEW);
    const reason = await ask(repo, env, "npx vercel --prod");
    expect(reason).toStartWith(
      "cc-smart-dev-kit cannot check whether this deploy to prod is held by open tasks: ",
    );
    expect(reason).toContain("cc-smart-dev-kit.json");
  });

  test("a line that runs no listed command is not asked about", async () => {
    const { repo, env } = world(TOO_NEW);
    for (const command of ["ls", "git status", "echo vercel --prod", "vercel --production"]) {
      expect({
        command,
        result: await runHook(deployGuardHook, callOf(repo, command), env),
      }).toEqual({
        command,
        result: {},
      });
    }
  });

  test("a file broken in another field still names the listed command it holds", async () => {
    const { repo, env } = world({ worktree: {}, ...LISTED });
    const reason = await ask(repo, env, "fly deploy");
    expect(reason).toContain("this deploy to prod");
    expect(reason).toContain("worktree: unknown field");
  });

  test("the list is read leniently: bad entries are left out, good ones count", async () => {
    const { repo, env } = world({
      requires: ">=99",
      tasks: {
        deployCommands: {
          prod: [7, { tool: "" }, { script: "ship", extra: 1 }, { script: "ship" }, "fly deploy"],
          staging: "not a list",
          nowhere: ["vercel --prod"],
        },
      },
    });
    expect(await ask(repo, env, "npm run ship")).toContain("this deploy to prod");
    expect(await ask(repo, env, "fly deploy")).toContain("this deploy to prod");
    expect(await ask(repo, env, "vercel --prod")).toBeNull();
  });

  test("an environment outside tasks.envs is still named when its command runs", async () => {
    const { repo, env } = world({
      requires: ">=99",
      tasks: { envs: ["prod"], deployCommands: { staging: ["vercel --target=staging"] } },
    });
    expect(await ask(repo, env, "vercel --target=staging")).toContain("this deploy to staging");
  });

  test("with no list to read: silent on stdout, one line on stderr", async () => {
    for (const config of [
      { requires: ">=99" },
      { worktree: {} },
      { requires: ">=99", tasks: { deployCommands: {} } },
      { requires: ">=99", tasks: { deployCommands: { prod: [] } } },
      { requires: ">=99", tasks: { deployCommands: { prod: [5] } } },
      { requires: ">=99", tasks: { deployCommands: [] } },
    ]) {
      const { repo, env } = world(config);
      const result = await runHook(deployGuardHook, callOf(repo, "vercel --prod"), env);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toStartWith("cc-smart-dev-kit deploy-guard: ");
      expect(result.stderr).toEndWith(
        "(no deploy commands could be read from it, so no call was judged)",
      );
      expect(result.stderr).not.toContain("\n");
      expect(result.exitCode ?? 0).toBe(0);
    }
  });

  test("a file that is not JSON: silent on stdout, one line on stderr", async () => {
    const { repo, env } = world(null);
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "{ not json");
    const result = await runHook(deployGuardHook, callOf(repo, "vercel --prod"), env);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit deploy-guard: ");
  });
});

describe("a worktree with no project file of its own", () => {
  // The project's file is not committed here, so a linked worktree has none: the frame (and the
  // lenient read) use the main checkout's. The tasks judged are the worktree's own, the
  // checkout the call runs in.
  function worktreeOf(config: unknown): {
    main: string;
    worktree: string;
    env: Record<string, string>;
  } {
    const { repo: main } = makeClone();
    writeClaudeFile(main, "cc-smart-dev-kit.json", config);
    const worktree = join(main, ".claude", "worktrees", "wt");
    git(main, "worktree", "add", "-q", "-b", "worktree-wt", worktree);
    expect(existsSync(join(worktree, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
    return { main, worktree, env: hookEnv() };
  }

  test("the main checkout's list is used, and the worktree's tasks are judged", async () => {
    const { main, worktree, env } = worktreeOf(LISTED);
    expect(await ask(worktree, env, "vercel --prod")).toBeNull();
    writeTask(worktree, BLOCKING);
    expect(await ask(worktree, env, "vercel --prod")).toContain("prod-20260101-000000");
    // The main checkout's own folder holds no task: the guard judges the checkout it runs in.
    expect(await ask(main, env, "vercel --prod")).toBeNull();
  });

  test("a file that cannot be used is read leniently from the main checkout's", async () => {
    const { worktree, env } = worktreeOf({ requires: ">=99", ...LISTED });
    const reason = await ask(worktree, env, "npx vercel --prod");
    expect(reason).toStartWith(
      "cc-smart-dev-kit cannot check whether this deploy to prod is held by open tasks: ",
    );
    expect(await ask(worktree, env, "ls")).toBeNull();
  });
});

describe("a crash", () => {
  const crashing = {
    ...deployGuardHook,
    run: () => {
      throw new Error("boom");
    },
  };

  test("asks about a call that runs a listed command", async () => {
    const { repo, env } = world();
    const result = await runHook(crashing, callOf(repo, "npx vercel --prod"), env);
    expect(askOf(result)).toBe(
      "cc-smart-dev-kit cannot check whether this deploy may run while a task is open: boom",
    );
  });

  test("says nothing about a call that runs none, or in a project that lists none", async () => {
    const { repo, env } = world();
    const quiet = await runHook(crashing, callOf(repo, "ls"), env);
    expect(quiet.stdout).toBeUndefined();
    expect(quiet.stderr).toBeUndefined();
    const none = world({});
    const result = await runHook(crashing, callOf(none.repo, "vercel --prod"), none.env);
    expect(result.stdout).toBeUndefined();
  });

  test("input that is not JSON is an ask, never a pass", async () => {
    const result = await handleHook(deployGuardHook, "not json", hookEnv());
    expect(askOf(result)).toBe(
      "cc-smart-dev-kit cannot check whether this deploy may run while a task is open: the hook input is not JSON",
    );
  });
});

describe("the entry, run as Claude Code runs it", () => {
  test("a PreToolUse ask, exactly; the log says the environment and the place in the list only", () => {
    const { repo, env } = world({
      tasks: { deployCommands: { prod: ["fly deploy", "vercel --prod --token SECRET-TOKEN"] } },
    });
    writeTask(repo, BLOCKING);
    const log = join(tempDir("log"), "hooks.log");
    const run = runEntry(
      "deploy-guard",
      JSON.stringify(callOf(repo, "vercel --prod --token SECRET-TOKEN")),
      { ...env, [HOOK_LOG_ENV]: log },
    );
    const reason = [
      "cc-smart-dev-kit deploy guard: this command deploys to prod, and prod has open work that holds a deploy:",
      '- Blocking task is open: prod-20260101-000000 "Seed the data": do it, then close it with evidence',
      WAY_OUT,
    ].join("\n");
    const answer = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    });
    expect(run).toEqual({ exitCode: 0, stdout: answer, stderr: "" });
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, "utf8")).toBe(
      `${JSON.stringify({
        hook: "deploy-guard",
        event: "PreToolUse",
        cwd: repo,
        exitCode: 0,
        stdout: answer,
        facts: { env: "prod", rule: 1 },
      })}\n`,
    );
  });

  test("silent: nothing on stdout, nothing on stderr, exit 0", () => {
    const { repo, env } = world();
    const run = runEntry("deploy-guard", JSON.stringify(callOf(repo, "vercel --prod")), env);
    expect(run).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });
});

describe("a 64 KB command line is read within the guard's time", () => {
  const SIZE = 64 * 1024;
  const LIMIT_MS = 3_000;
  const fill = (piece: string) => piece.repeat(Math.ceil(SIZE / piece.length)).slice(0, SIZE);
  const lists: DeployLists = {
    prod: ["vercel --prod", "npm run deploy:prod", "./scripts/deploy.sh prod", { tool: "fly" }],
  };
  test.each([
    ["many commands", fill("git status; ")],
    ["many runs of a runner", fill("npx vercel --preview; ")],
    ["a long argument", `vercel --preview ${"x".repeat(SIZE)}`],
    ["a long commit message", `git commit -m "${fill("word; vercel --prod ")}"`],
    ["many nested shells", fill("bash -c 'bash -c ls'; ")],
    ["many here-docs", fill("cat <<A ")],
    ["unclosed substitutions", `echo ${fill("$(a ")}`],
    ["an unclosed quote", `echo "${fill("a; b ")}`],
    ["a match at the end", `${fill("ls; ")}vercel --prod`],
  ])("%s", (_name, command) => {
    const started = Date.now();
    deploysOf(command, "bash", deployRulesOf(lists));
    deploysOf(command, undefined, deployRulesOf(lists));
    expect(Date.now() - started).toBeLessThan(LIMIT_MS);
  });
});
