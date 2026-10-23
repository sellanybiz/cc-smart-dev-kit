/**
 * What the job queue decides from a shell line, pinned case by case: the kind the classifier
 * finds (`classifyHeavyCommand`), the command job-route turns the line into, whether the line
 * already runs `job run`, and, for `job run`'s own argv, the tool it reads and the argv it
 * starts (`runJob` adds the workers flag only where the command takes options).
 *
 * These cases are where the job code's reading of a line and the guards' reading differed
 * before the two lexers became one (`src/shell/command.ts`, 0.6.0). Every value is written
 * by hand. A row whose value the merge changed says what it was before (`was:`), so each
 * change stays visible.
 */
import { describe, expect, test } from "bun:test";
import { routeHeavyCommand, runsJobRun } from "../hooks/job-route";
import { classifyHeavyCommand, toolCallOfArgv } from "./classify";
import { DEFAULT_KINDS } from "./kinds";
import { type JobDeps, runJob } from "./run";

const LAUNCHER = '"$HOME/.local/bin/cc-smart-dev-kit"';
const SHELL = "/bin/bash";

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
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["cat <<EOF\n$(bunx tsc --noEmit)\nEOF", "tsc", null],
  ["cat <<'EOF'\nbunx tsc --noEmit\nEOF", null, null],
  // was: through the person's shell; now raw (HK hunch 1): a shell that reads a here-doc is no
  // heavy command (the classifier still finds the kind for `job run`'s reservation).
  ["sh <<'EOF'\nbunx tsc --noEmit\nEOF", "tsc", null],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["echo 'bunx tsc --noEmit' | sh", "tsc", null],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["echo `bunx tsc --noEmit`", "tsc", null],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["echo $(( $(bunx tsc --noEmit) ))", "tsc", null],
  // was: through the person's shell; now raw (HK hunch 1): the line runs a command that is not heavy, a `cd` or an assignment.
  ["echo \\ #; bunx tsc --noEmit", "tsc", null],
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
        routed: routeHeavyCommand(line, DEFAULT_KINDS, SHELL)?.command ?? null,
        jobRun: runsJobRun(line),
      }).toEqual({ kind, routed, jobRun });
    });
  }
});

/** The argv `runJob` starts for a `test:run` job of 4 GB (3 workers), with nothing in the way. */
async function startedArgv(command: [string, ...string[]]): Promise<readonly string[]> {
  let started: readonly string[] = [];
  const deps: JobDeps = {
    isNested: async () => false,
    ancestorHoldsName: async () => false,
    acquire: async () => ({ gb: 4, release: () => {}, waitedSince: null }),
    workersFor: () => 3,
    memoryMaxFor: () => "1G",
    launchFacts: () => null,
    now: Date.now,
    slice: {
      controllers: () => ["cpu", "memory", "pids"],
      controlGroup: () => null,
      readFile: () => null,
      setMemoryMax: () => true,
      setWeights: () => true,
    },
    run: async (argv) => {
      started = argv;
      return { code: 0, signal: null, stoppedBy: null };
    },
    say: () => {},
  };
  await runJob(
    {
      kind: "test:run",
      spec: DEFAULT_KINDS["test:run"] ?? null,
      command,
      cpuWeight: 20,
      gb: 4,
      ioWeight: 20,
      pid: 1,
      checkout: "/repo",
      slice: "jobs.slice",
      startedAt: 0,
    },
    deps,
  );
  return started;
}

describe("job run's own argv: the tool it reads, and where the workers flag goes", () => {
  const ARGV_ROWS: [
    argv: [string, ...string[]],
    tool: { name: string; args: string[] },
    started: string[],
  ][] = [
    [
      ["bunx", "vitest", "run"],
      { name: "vitest", args: ["run"] },
      ["bunx", "vitest", "run", "--maxWorkers=3"],
    ],
    [
      ["timeout", "600", "bunx", "vitest", "run"],
      { name: "vitest", args: ["run"] },
      ["timeout", "600", "bunx", "vitest", "run", "--maxWorkers=3"],
    ],
    [
      ["sh", "-c", "bunx vitest run"],
      { name: "sh", args: ["-c", "bunx vitest run"] },
      ["sh", "-c", "bunx vitest run"],
    ],
    [
      ["timeout", "600", "sh", "-c", "bunx vitest run"],
      { name: "sh", args: ["-c", "bunx vitest run"] },
      // was: `--maxWorkers=3` added at the end, where the shell takes it as its `$0`.
      ["timeout", "600", "sh", "-c", "bunx vitest run"],
    ],
    [
      ["env", "-i", "bunx", "vitest", "run"],
      // was: { name: "-i", … } (CM-9).
      { name: "vitest", args: ["run"] },
      ["env", "-i", "bunx", "vitest", "run", "--maxWorkers=3"],
    ],
    [
      ["time", "-p", "bunx", "vitest", "run"],
      // was: { name: "-p", … } (CM-9).
      { name: "vitest", args: ["run"] },
      ["time", "-p", "bunx", "vitest", "run", "--maxWorkers=3"],
    ],
    [
      ["sudo", "-u", "x", "bunx", "vitest", "run"],
      // was: { name: "-u", … } (CM-9).
      { name: "vitest", args: ["run"] },
      ["sudo", "-u", "x", "bunx", "vitest", "run", "--maxWorkers=3"],
    ],
  ];
  for (const [argv, tool, started] of ARGV_ROWS) {
    test(argv.join(" "), async () => {
      expect(toolCallOfArgv(argv)).toEqual(tool);
      expect(await startedArgv(argv)).toEqual(started);
    });
  }
});
