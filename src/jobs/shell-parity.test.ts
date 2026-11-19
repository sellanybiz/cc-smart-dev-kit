/**
 * What the job queue decides from a shell line, pinned case by case: the kind the classifier
 * finds (`classifyHeavyCommand`), the command job-route turns the line into, whether the line
 * already runs `job run`, and, for `job run`'s own argv, the run it reads and the argv it
 * starts (`runJob` starts the command as it was given: the queue adds no option to it).
 *
 * These cases are where the job code's reading of a line and the guards' reading differed
 * before the two lexers became one (`src/shell/command.ts`, 0.6.0). Every value is written
 * by hand. A row whose value the merge changed says what it was before (`was:`), so each
 * change stays visible.
 */
import { describe, expect, test } from "bun:test";
import { routeHeavyCommand } from "../hooks/job-route";
import { shellWord } from "../shell/quote";
import { classifyHeavyCommand, runWeight, type WeightSource } from "./classify";
import { DEFAULT_KINDS } from "./kinds";
import { type JobDeps, runJob } from "./run";

const LAUNCHER = '"$HOME/.local/bin/cc-smart-dev-kit"';
const SHELL = "/bin/bash";

/** A folder with no file and no `package.json`: every run on a named file is a full run. */
const EMPTY_FOLDER: WeightSource = {
  folder: "/repo",
  isFile: () => false,
  scriptsIn: () => null,
};

/**
 * True when the classifier finds a heavy kind in the line and the judge still says `none`: the
 * line runs `job run` already (no row here is a watch run), so it is queued once and never again.
 */
const runsJobRun = (line: string) =>
  classifyHeavyCommand(line, DEFAULT_KINDS) !== null &&
  runWeight(line, DEFAULT_KINDS, EMPTY_FOLDER).weight === "none";

/** One line: its kind, the routed command (null: not routed), and whether it runs `job run`. */
type Row = [line: string, kind: string | null, routed: string | null, jobRun?: boolean];

const queued = (kind: string, rest: string) => `${LAUNCHER} job run --kind ${kind} -- ${rest}`;
/** Through the person's shell; `line` holds no single quote. */
const viaShell = (kind: string, line: string) => queued(kind, `${SHELL} -c '${line}'`);

const ROWS: Row[] = [
  ["bunx vitest run", "test:run", queued("test:run", "bunx vitest run")],
  // was: argv words (`-- timeout 600 bunx vitest run`): a wrapper now goes through the shell.
  ["timeout 600 bunx vitest run", "test:run", viaShell("test:run", "timeout 600 bunx vitest run")],
  [
    "timeout -s KILL 60 bunx tsc --noEmit",
    "tsc",
    // was: argv words.
    viaShell("tsc", "timeout -s KILL 60 bunx tsc --noEmit"),
  ],
  ["time bunx tsc --noEmit", "tsc", viaShell("tsc", "time bunx tsc --noEmit")],
  // was: not routed (CM-9: `-p` was read as the program).
  ["time -p bunx tsc --noEmit", "tsc", viaShell("tsc", "time -p bunx tsc --noEmit")],
  // was: not routed (CM-9).
  ["env -i bunx tsc --noEmit", "tsc", viaShell("tsc", "env -i bunx tsc --noEmit")],
  ["env CI=1 bunx tsc --noEmit", "tsc", viaShell("tsc", "env CI=1 bunx tsc --noEmit")],
  // was: not routed.
  ["/usr/bin/env bunx tsc --noEmit", "tsc", viaShell("tsc", "/usr/bin/env bunx tsc --noEmit")],
  // was: not routed.
  ["env -u HOME bunx tsc --noEmit", "tsc", viaShell("tsc", "env -u HOME bunx tsc --noEmit")],
  ["sudo bunx tsc --noEmit", "tsc", viaShell("tsc", "sudo bunx tsc --noEmit")],
  // was: not routed (CM-9).
  ["sudo -u x bunx tsc --noEmit", "tsc", viaShell("tsc", "sudo -u x bunx tsc --noEmit")],
  ["nohup bunx tsc --noEmit", "tsc", viaShell("tsc", "nohup bunx tsc --noEmit")],
  ["exec bunx tsc --noEmit", "tsc", viaShell("tsc", "exec bunx tsc --noEmit")],
  ["command bunx tsc --noEmit", "tsc", viaShell("tsc", "command bunx tsc --noEmit")],
  ["command -v tsc", null, null],
  ["builtin bunx tsc --noEmit", "tsc", viaShell("tsc", "builtin bunx tsc --noEmit")],
  // was: argv words.
  ["nice -n 10 bunx tsc --noEmit", "tsc", viaShell("tsc", "nice -n 10 bunx tsc --noEmit")],
  // was: argv words.
  ["nice -5 bunx tsc --noEmit", "tsc", viaShell("tsc", "nice -5 bunx tsc --noEmit")],
  // was: not routed.
  ["ionice -c 3 bunx tsc --noEmit", "tsc", viaShell("tsc", "ionice -c 3 bunx tsc --noEmit")],
  // was: not routed.
  ["stdbuf -oL bunx vitest run", "test:run", viaShell("test:run", "stdbuf -oL bunx vitest run")],
  // was: not routed.
  ["xargs bunx tsc --noEmit", "tsc", viaShell("tsc", "xargs bunx tsc --noEmit")],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["ls | xargs -n 1 bunx vitest run", "test:run", null],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["if bunx tsc --noEmit; then echo ok; fi", "tsc", null],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["while true; do bunx vitest run; done", "test:run", null],
  // was: not routed.
  ["! bunx tsc --noEmit", "tsc", viaShell("tsc", "! bunx tsc --noEmit")],
  ["{ bunx tsc --noEmit; }", "tsc", viaShell("tsc", "{ bunx tsc --noEmit; }")],
  // was: not routed (HK-9).
  ["bash -c -- 'bunx tsc --noEmit'", "tsc", queued("tsc", "bash -c -- 'bunx tsc --noEmit'")],
  ["bash -ec 'bunx tsc --noEmit'", "tsc", queued("tsc", "bash -ec 'bunx tsc --noEmit'")],
  [
    "env -S 'bunx tsc --noEmit'",
    "tsc",
    // was: not routed (HK-9).
    queued("tsc", `${SHELL} -c 'env -S '\\''bunx tsc --noEmit'\\'''`),
  ],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not
  // heavy, a `cd`, an assignment or glue. `cat` is glue only as a reader fed by a pipe.
  ["cat <<EOF\n$(bunx tsc --noEmit)\nEOF", "tsc", null],
  ["cat <<'EOF'\nbunx tsc --noEmit\nEOF", null, null],
  // was: through the person's shell; now raw (HK hunch 1): a shell that reads a here-doc is no
  // heavy command (the classifier still finds the kind for `job run`'s reservation).
  ["sh <<'EOF'\nbunx tsc --noEmit\nEOF", "tsc", null],
  // was: through the person's shell; now raw (HK hunch 1): a shell whose script comes only from
  // the pipe is never pure. The text the reader gives for what `echo` writes is no promise
  // (`printf 'tsc\nrm x' | sh` runs two commands), so the line is not queued.
  ["echo 'bunx tsc --noEmit' | sh", "tsc", null],
  // was: raw (HK hunch 1). Now queued whole: its only commands are `echo` (glue) and the heavy
  // run in the backticks.
  ["echo `bunx tsc --noEmit`", "tsc", viaShell("tsc", "echo `bunx tsc --noEmit`")],
  // was: through the person's shell; now raw (HK hunch 1): an arithmetic expansion is no glue,
  // because bash reads a variable's value there as an expression, and that can run a command.
  ["echo $(( $(bunx tsc --noEmit) ))", "tsc", null],
  // was: raw (HK hunch 1). Now queued whole: `echo` (glue), then the heavy run.
  ["echo \\ #; bunx tsc --noEmit", "tsc", viaShell("tsc", "echo \\ #; bunx tsc --noEmit")],
  // was: routed: bash reads `\;` as a `;` character, so the line is one `cd` and runs no tsc.
  ["cd D:\\; bunx tsc --noEmit", null, null],
  [
    "bunx vitest run src/{a,b}.test.ts",
    "test:run",
    viaShell("test:run", "bunx vitest run src/{a,b}.test.ts"),
  ],
  ["bunx tsc --noEmit # check", "tsc", queued("tsc", "bunx tsc --noEmit")],
  ['git commit -m "bunx tsc --noEmit"', null, null],
  ['x @"\nbunx tsc --noEmit\n"@', null, null],
  ["CI=1 timeout 60 npx tsc", "tsc", viaShell("tsc", "CI=1 timeout 60 npx tsc")],
  // Bun's own test runner is a heavy test run (it was raw: `test` is one of Bun's own commands).
  ["bun test", "test:run", queued("test:run", "bun test")],
  ["bun --bun test", "test:run", queued("test:run", "bun --bun test")],
  ["bun test src/a.test.ts", "test:run", queued("test:run", "bun test src/a.test.ts")],
  ["bun test --coverage", "test:coverage", queued("test:coverage", "bun test --coverage")],
  ["bun add zod", null, null],
  // A light run is the route's own decision (`runWeight`, with the folder's files): the line
  // is routable here, as the kind says.
  ["bun test ./src/a.test.ts", "test:run", queued("test:run", "bun test ./src/a.test.ts")],
  // A cross-env word is a wrapper: the program after its VAR=x words is what runs.
  [
    "cross-env NODE_ENV=test jest",
    "test:run",
    viaShell("test:run", "cross-env NODE_ENV=test jest"),
  ],
  [
    "cross-env NODE_ENV=test CI=1 bunx tsc --noEmit",
    "tsc",
    viaShell("tsc", "cross-env NODE_ENV=test CI=1 bunx tsc --noEmit"),
  ],
  // was: heavy. Any one print-only option prints and stops (`isPrintOnly`).
  ["bunx tsc --noEmit --version", null, null],
  ["bunx tsc --version --noEmit", null, null],
  // was: kind null, not `job run`: the queue is read through `timeout`, and its command too.
  [`timeout 60 ${LAUNCHER} job run --kind tsc -- bunx tsc`, "tsc", null, true],
  // was: kind null: the command `job run` queues is read (HK hunch 6). Never routed again.
  [`${LAUNCHER} job run --kind tsc -- bunx tsc`, "tsc", null, true],
  ["bunx tsc --noEmit \\\n  --pretty", "tsc", viaShell("tsc", "bunx tsc --noEmit \\\n  --pretty")],
  // was: through the person's shell; now raw (HK hunch 1): the open backtick runs a command
  // the reader cannot name.
  ["bunx tsc --noEmit `\n  --pretty", "tsc", null],
  // was: not routed (HK-8). The argv words are the ones bash runs.
  ["b\\unx tsc --noEmit", "tsc", queued("tsc", "bunx tsc --noEmit")],
  // was: not routed (HK-8).
  ["$'bunx' tsc --noEmit", "tsc", queued("tsc", "bunx tsc --noEmit")],
];

describe("job-route and the classifier read a line the same way, case by case", () => {
  for (const [line, kind, routed, jobRun = false] of ROWS) {
    test(JSON.stringify(line), () => {
      expect({
        kind: classifyHeavyCommand(line, DEFAULT_KINDS),
        routed: routeHeavyCommand(line, DEFAULT_KINDS, SHELL, EMPTY_FOLDER)?.command ?? null,
        jobRun: runsJobRun(line),
      }).toEqual({ kind, routed, jobRun });
    });
  }
});

/** The argv `runJob` starts for a `test:run` job, with nothing in the way. */
async function startedArgv(command: [string, ...string[]]): Promise<readonly string[]> {
  let started: readonly string[] = [];
  const deps: JobDeps = {
    isNested: async () => false,
    ancestorHoldsName: async () => false,
    acquire: async () => ({ release: () => {}, waitedSince: null }),
    now: Date.now,
    run: async (argv) => {
      started = argv;
      return { code: 0, leftovers: false, sentOn: false, signal: null };
    },
    say: () => {},
  };
  await runJob(
    {
      kind: "test:run",
      command,
      pid: 1,
      checkout: "/repo",
      slot: true,
    },
    deps,
  );
  return started;
}

describe("job run's own argv: the run it reads, and the argv it starts as given", () => {
  // Each argv runs a full vitest run, read the way `job run` reads it (`runWeight` over the argv
  // as a shell line): the wrapper, the option of the wrapper and the shell string are stepped over.
  const ARGV_ROWS: [string, ...string[]][] = [
    ["bunx", "vitest", "run"],
    ["timeout", "600", "bunx", "vitest", "run"],
    ["sh", "-c", "bunx vitest run"],
    ["timeout", "600", "sh", "-c", "bunx vitest run"],
    // was: read as the tool `-i` (CM-9).
    ["env", "-i", "bunx", "vitest", "run"],
    // was: read as the tool `-p` (CM-9).
    ["time", "-p", "bunx", "vitest", "run"],
    // was: read as the tool `-u` (CM-9).
    ["sudo", "-u", "x", "bunx", "vitest", "run"],
  ];
  for (const argv of ARGV_ROWS) {
    test(argv.join(" "), async () => {
      expect(runWeight(argv.map(shellWord).join(" "), DEFAULT_KINDS, EMPTY_FOLDER)).toEqual({
        kind: "test:run",
        weight: "heavy",
      });
      // No worker count and no other option is added, whatever the command is.
      expect(await startedArgv(argv)).toEqual(argv);
    });
  }
});
