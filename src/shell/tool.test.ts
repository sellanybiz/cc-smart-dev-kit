/**
 * The tool reader (`tool.ts`): what a command really runs, and a command typed as text turned
 * into a rule. Every expected value is written by hand. The reader's older cases (`npx`,
 * `bun x`, the package managers) are pinned in `src/jobs/classify.test.ts`, which uses it too.
 */
import { describe, expect, test } from "bun:test";
import { invocationOf, invocationsOf, wordsOf } from "./command";
import { argsHold, callOf, ruleMatches, rulesOfCommand, type ToolCall, toolOf } from "./tool";

/** The tool a typed command comes to, as a guard finds it in a run. */
function toolOfLine(line: string): ToolCall | undefined {
  const invocation = invocationOf(wordsOf(line));
  return invocation === undefined ? undefined : callOf(invocation.program, invocation.args);
}

describe("a shell or an interpreter given a script file runs that file", () => {
  test.each([
    ["bash scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    ["sh deploy.sh", { name: "deploy.sh", args: [] }],
    ["dash deploy.sh a b", { name: "deploy.sh", args: ["a", "b"] }],
    ["ksh ./ci/Deploy.SH", { name: "deploy.sh", args: [] }],
    ["zsh deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    // the shells' options are stepped over, with the value of the ones that take one
    ["bash -o pipefail scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    ["bash +o history scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    ["bash -eo pipefail scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    ["bash -O extglob scripts/deploy.sh", { name: "deploy.sh", args: [] }],
    ["bash -x -e scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    ["bash --norc --noprofile scripts/deploy.sh", { name: "deploy.sh", args: [] }],
    ["bash --rcfile rc.sh scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    ["bash -- scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    // the file is run in this shell
    ["source scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    [". scripts/deploy.sh prod", { name: "deploy.sh", args: ["prod"] }],
    // interpreters
    ["node scripts/deploy.js prod", { name: "deploy", args: ["prod"] }],
    ["node deploy.js prod", { name: "deploy", args: ["prod"] }],
    ["./scripts/deploy.mjs prod", { name: "deploy", args: ["prod"] }],
    ["node deploy.mjs prod", { name: "deploy", args: ["prod"] }],
    ["node --require ./x.js scripts/deploy.mjs", { name: "deploy", args: [] }],
    ["python deploy.py prod", { name: "deploy.py", args: ["prod"] }],
    ["python3 scripts/deploy.py", { name: "deploy.py", args: [] }],
    ["python3.12 -u -W ignore deploy.py prod", { name: "deploy.py", args: ["prod"] }],
    ["python -- deploy.py", { name: "deploy.py", args: [] }],
    // bun: a file is the tool; a script name is also a script; its own commands are not files
    ["bun scripts/deploy.ts prod", { name: "deploy.ts", args: ["prod"] }],
    ["bun deploy.ts prod", { name: "deploy.ts", args: ["prod"], script: "deploy.ts" }],
    ["bun run scripts/deploy.ts", { name: "deploy.ts", args: [] }],
  ])("%s", (line, expected) => {
    expect(toolOfLine(line)).toEqual(expected);
  });

  test.each([
    // no file: a command string, standard input, a module, a code string, nothing at all
    ["bash -c 'vercel --prod'", { name: "bash", args: ["-c", "vercel --prod"] }],
    ["bash -ec 'vercel --prod'", { name: "bash", args: ["-ec", "vercel --prod"] }],
    ["bash -s", { name: "bash", args: ["-s"] }],
    ["bash", { name: "bash", args: [] }],
    ["bash -o pipefail", { name: "bash", args: ["-o", "pipefail"] }],
    ["python -m pytest", { name: "python", args: ["-m", "pytest"] }],
    ["python3 -c 'print(1)'", { name: "python3", args: ["-c", "print(1)"] }],
    ["python -", { name: "python", args: ["-"] }],
    ["python", { name: "python", args: [] }],
    ["source", { name: "source", args: [] }],
    [".", { name: ".", args: [] }],
    // a word that only looks like a shell or an interpreter
    ["bashful deploy.sh", { name: "bashful", args: ["deploy.sh"] }],
    ["pythonista deploy.py", { name: "pythonista", args: ["deploy.py"] }],
  ])("%s runs no file", (line, expected) => {
    expect(toolOfLine(line)).toEqual(expected);
  });

  test("PowerShell dot-sources a script file with a Windows path", () => {
    const invocation = invocationOf(wordsOf(". .\\scripts\\deploy.ps1 prod", "powershell"));
    expect(callOf(invocation?.program ?? "", invocation?.args ?? [])).toEqual({
      name: "deploy",
      args: ["prod"],
    });
  });

  test("toolOf, the job classifier's reader, does not follow a shell or an interpreter to a file", () => {
    // The classifier's project kinds name `bash`, `python`, `source` as tools
    // (`{ tool: "bash", sub: ["scripts/e2e.sh"] }`): only `callOf`, the deploy guard's reading,
    // reads the file. `classify.test.ts` pins the kinds each of these gives.
    expect(toolOf("bash", ["scripts/e2e.sh"])).toEqual({ name: "bash", args: ["scripts/e2e.sh"] });
    expect(toolOf("bash", ["-o", "pipefail", "x.sh"])).toEqual({
      name: "bash",
      args: ["-o", "pipefail", "x.sh"],
    });
    expect(toolOf("python", ["manage.py", "test"])).toEqual({
      name: "python",
      args: ["manage.py", "test"],
    });
    expect(toolOf("source", ["env.sh"])).toEqual({ name: "source", args: ["env.sh"] });
    expect(toolOf(".", ["env.sh"])).toEqual({ name: ".", args: ["env.sh"] });
    expect(toolOf("node", ["deploy.js"])).toBeUndefined();
    expect(toolOf("node", ["tsc", "--noEmit"])).toBeUndefined();
    expect(toolOf("node", ["scripts/deploy.mjs"])).toEqual({ name: "deploy", args: [] });
  });

  test("node with no script is no tool, as before", () => {
    expect(toolOf("node", ["--version"])).toBeUndefined();
    expect(toolOf("node", ["-e", "console.log(1)"])).toBeUndefined();
    expect(toolOf("node", [])).toBeUndefined();
  });

  test("bun's own commands are no file", () => {
    expect(toolOf("bun", ["install"])).toEqual({ name: "bun", args: ["install"] });
    expect(toolOf("bun", ["build", "x.ts"])).toBeUndefined();
  });
});

/** The rules of a typed command, without their words (the table tests of the grammar's part). */
const ruleOf = (text: string, dialect?: "bash" | "powershell") =>
  rulesOfCommand(text, dialect).map((one) => one.rule);

describe("a command typed as text becomes rules", () => {
  test.each([
    ["vercel --prod", { tool: "vercel", flags: ["--prod"] }],
    ["npx vercel --prod", { tool: "vercel", flags: ["--prod"] }],
    ["VERCEL_ENV=production vercel deploy", { tool: "vercel", sub: ["deploy"] }],
    ["fly deploy", { tool: "fly", sub: ["deploy"] }],
    ["./scripts/deploy.sh prod", { tool: "deploy.sh", sub: ["prod"] }],
    ["npm run deploy:prod", { script: "deploy:prod" }],
    ["bun run deploy:prod", { script: "deploy:prod" }],
    ["pnpm run deploy:prod", { script: "deploy:prod" }],
    // runners, wrappers and assignments are stepped over
    ["bunx vercel --prod", { tool: "vercel", flags: ["--prod"] }],
    ["pnpm dlx vercel --prod", { tool: "vercel", flags: ["--prod"] }],
    ["sudo -u deploy vercel --prod", { tool: "vercel", flags: ["--prod"] }],
    ["timeout 600 vercel --prod", { tool: "vercel", flags: ["--prod"] }],
    ["A=1 B=2 fly deploy --app web", { tool: "fly", sub: ["deploy", "web"], flags: ["--app"] }],
    ["npm --prefix app run deploy:prod", { script: "deploy:prod" }],
    ["npm run-script deploy:prod", { script: "deploy:prod" }],
    // a script file is the tool; the shell that runs it does not matter
    ["bash -o pipefail scripts/deploy.sh prod", { tool: "deploy.sh", sub: ["prod"] }],
    [". scripts/deploy.sh prod", { tool: "deploy.sh", sub: ["prod"] }],
    // a script file loses its JavaScript extension, as a run's tool does
    ["./scripts/deploy.mjs prod", { tool: "deploy", sub: ["prod"] }],
    ["node scripts/deploy.cjs prod", { tool: "deploy", sub: ["prod"] }],
    // words that are no option are the subcommands, in order; options are the flags
    ["vercel deploy --prod --yes", { tool: "vercel", sub: ["deploy"], flags: ["--prod", "--yes"] }],
    ["vercel", { tool: "vercel" }],
    ["vercel --target=production", { tool: "vercel", flags: ["--target=production"] }],
    // the program a name stands for, when the reader cannot see behind it
    ["npm publish", { tool: "npm", sub: ["publish"] }],
  ])("%s", (text, rule) => {
    expect(ruleOf(text)).toEqual([rule]);
  });

  test("a command that runs nothing gives no rule", () => {
    expect(rulesOfCommand("")).toEqual([]);
    expect(rulesOfCommand("FOO=1")).toEqual([]);
    expect(rulesOfCommand("command -v vercel")).toEqual([]);
  });

  test("the words after a script's name stay with its rule: a `--` is dropped", () => {
    expect(rulesOfCommand("npm run deploy -- prod")).toEqual([
      { rule: { script: "deploy" }, words: { sub: ["prod"] } },
    ]);
    expect(rulesOfCommand("npm run deploy -- staging")).toEqual([
      { rule: { script: "deploy" }, words: { sub: ["staging"] } },
    ]);
    expect(rulesOfCommand("npm run deploy -- --target prod --yes")).toEqual([
      { rule: { script: "deploy" }, words: { sub: ["prod"], flags: ["--target", "--yes"] } },
    ]);
    expect(rulesOfCommand("bun run deploy prod")).toEqual([
      { rule: { script: "deploy" }, words: { sub: ["prod"] } },
    ]);
    expect(rulesOfCommand("npm run deploy:prod")).toEqual([{ rule: { script: "deploy:prod" } }]);
  });

  test("pnpm, yarn and bun with a bare word give a script rule and a tool rule", () => {
    expect(rulesOfCommand("pnpm vercel --prod")).toEqual([
      { rule: { script: "vercel" }, words: { flags: ["--prod"] } },
      { rule: { tool: "vercel", flags: ["--prod"] } },
    ]);
    expect(ruleOf("yarn deploy:prod")).toEqual([
      { script: "deploy:prod" },
      { tool: "deploy:prod" },
    ]);
    expect(ruleOf("bun deploy.ts prod")).toEqual([
      { script: "deploy.ts" },
      { tool: "deploy.ts", sub: ["prod"] },
    ]);
    // `run` says it is a script, never a tool
    expect(ruleOf("pnpm run vercel --prod")).toEqual([{ script: "vercel" }]);
  });

  test("a Windows path is read in the PowerShell reading", () => {
    expect(ruleOf(".\\scripts\\deploy.ps1 prod", "powershell")).toEqual([
      { tool: "deploy", sub: ["prod"] },
    ]);
    expect(ruleOf("scripts\\deploy.cmd prod", "powershell")).toEqual([
      { tool: "deploy", sub: ["prod"] },
    ]);
    expect(ruleOf("C:\\tools\\deploy.exe --prod", "powershell")).toEqual([
      { tool: "deploy", flags: ["--prod"] },
    ]);
    expect(ruleOf("& .\\scripts\\deploy.ps1 prod", "powershell")).toEqual([
      { tool: "deploy", sub: ["prod"] },
    ]);
    // Bash reads a backslash as an escape: the same text is another word there.
    expect(ruleOf(".\\scripts\\deploy.ps1 prod", "bash")).toEqual([
      { tool: ".scriptsdeploy", sub: ["prod"] },
    ]);
  });

  test("a redirection is the shell's: the rule never asks for its words", () => {
    // Ruling: the same reading as a run's (`callOf` drops redirections), so a rule made from
    // `vercel --prod > log.txt` is the rule of `vercel --prod`, and matches both runs.
    const plain = { tool: "vercel", flags: ["--prod"] };
    for (const text of [
      "vercel --prod > log.txt",
      "vercel --prod >log.txt 2>&1",
      "vercel --prod 2>/dev/null",
      "vercel --prod <<< x",
      "vercel --prod >> out",
    ]) {
      expect(ruleOf(text)).toEqual([plain]);
    }
    expect(ruleOf("vercel <<EOF")).toEqual([{ tool: "vercel" }]);
    for (const run of ["vercel --prod", "vercel --prod > other.txt", "vercel --prod 2>&1"]) {
      expect(ruleMatches(plain, toolOfLine(run) as ToolCall)).toBe(true);
    }
  });

  test("a quote that never closes is read the way a run of the same text reads it", () => {
    // Ruling: `blindWhenOpen`, as the guard reads a line at run time. The rest of the line is
    // text, so its word is one the rule asks for: the rule matches what the same text runs.
    const text = "vercel --prod 'unterminated";
    const [rule] = ruleOf(text);
    expect(rule).toEqual({ tool: "vercel", sub: ["unterminated"], flags: ["--prod"] });
    const run = invocationsOf(text, "bash")[0];
    expect(run).toBeDefined();
    expect(ruleMatches(rule as never, callOf(run?.program ?? "", run?.args ?? []))).toBe(true);
    // A run that does not hold the open word is another command.
    expect(ruleMatches(rule as never, toolOfLine("vercel --prod") as ToolCall)).toBe(false);
  });

  test("an option is a whole word: --prod is not --production", () => {
    const [rule] = ruleOf("vercel --prod");
    expect(ruleMatches(rule as never, toolOfLine("vercel --prod") as ToolCall)).toBe(true);
    expect(ruleMatches(rule as never, toolOfLine("vercel --prod=1") as ToolCall)).toBe(true);
    expect(ruleMatches(rule as never, toolOfLine("vercel --production") as ToolCall)).toBe(false);
    expect(ruleMatches(rule as never, toolOfLine("vercel --prod-x") as ToolCall)).toBe(false);
  });

  test("a script rule matches every spelling of the script", () => {
    const [rule] = ruleOf("npm run deploy:prod");
    for (const run of [
      "npm run deploy:prod",
      "npm run-script deploy:prod",
      "npm --prefix app run deploy:prod",
      "pnpm deploy:prod",
      "pnpm run deploy:prod",
      "yarn deploy:prod",
      "bun run deploy:prod",
    ]) {
      expect({ run, hit: ruleMatches(rule as never, toolOfLine(run) as ToolCall) }).toEqual({
        run,
        hit: true,
      });
    }
    expect(ruleMatches(rule as never, toolOfLine("npm run deploy:staging") as ToolCall)).toBe(
      false,
    );
  });
});

describe("argsHold: the one whole-word test of a rule's sub and flags", () => {
  test("flags are whole words, a flag may carry =value", () => {
    expect(argsHold(["--prod"], { flags: ["--prod"] })).toBe(true);
    expect(argsHold(["--prod=1"], { flags: ["--prod"] })).toBe(true);
    expect(argsHold(["--production"], { flags: ["--prod"] })).toBe(false);
    expect(argsHold(["--prod"], { flags: ["--prod", "--yes"] })).toBe(false);
  });

  test("sub words are the first words that are no option, in order", () => {
    expect(argsHold(["--quiet", "deploy", "--x", "web"], { sub: ["deploy", "web"] })).toBe(true);
    expect(argsHold(["web", "deploy"], { sub: ["deploy", "web"] })).toBe(false);
    expect(argsHold(["status", "deploy"], { sub: ["deploy"] })).toBe(false);
    expect(argsHold(["--", "prod"], { sub: ["prod"] })).toBe(true);
  });

  test("a valued option's value is no sub word", () => {
    expect(argsHold(["--app", "web", "deploy"], { sub: ["deploy"] })).toBe(false);
    expect(argsHold(["--app", "web", "deploy"], { sub: ["deploy"], valued: ["--app"] })).toBe(true);
  });

  test("nothing required holds for any arguments", () => {
    expect(argsHold([], {})).toBe(true);
    expect(argsHold(["x"], {})).toBe(true);
  });
});

describe("the readers other guards use are unchanged by the tool reader", () => {
  // The answers of `invocationOf` and `invocationsOf` before the tool reader learned to read a
  // script file: `bash x.sh` is still the program `bash`, with its words.
  test.each([
    [
      "npx tsc --noEmit",
      { args: ["tsc", "--noEmit"], computed: false, prefix: [], program: "npx" },
    ],
    [
      'bash x.sh "a; git push -f"',
      { args: ["x.sh", "a; git push -f"], computed: false, prefix: [], program: "bash" },
    ],
    [
      "bash -o pipefail x.sh prod",
      { args: ["-o", "pipefail", "x.sh", "prod"], computed: false, prefix: [], program: "bash" },
    ],
    [". x.sh prod", { args: ["x.sh", "prod"], computed: false, prefix: [], program: "." }],
  ])("invocationOf %s", (line, expected) => {
    expect(invocationOf(wordsOf(line))).toEqual(expected);
  });

  test("invocationsOf keeps the shell as the program and its words whole", () => {
    expect(invocationsOf('bash x.sh "a; git push -f"', "bash")).toEqual([
      {
        args: ["x.sh", "a; git push -f"],
        computed: false,
        filled: [],
        program: "bash",
        words: ["bash", "x.sh", "a; git push -f"],
      },
    ]);
    expect(invocationsOf("npx tsc", "powershell")).toEqual([
      {
        args: ["tsc"],
        computed: false,
        filled: [],
        program: "npx",
        words: ["npx", "tsc"],
      },
    ]);
  });
});
