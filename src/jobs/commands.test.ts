/**
 * `cc-smart-dev-kit job …` run as the real CLI, in a temp HOME. Each test writes a `jobs.json`
 * with `launch: plain`, so no test ever starts a systemd scope or touches a slice, and
 * with a fixed `budgetGb`, so no test depends on this machine's memory. The slots are the
 * default three unless a test says otherwise (`maxJobs`). The jobs are small `sh` scripts.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { processStartTime } from "../setup/lock";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { type JobContext, runJobCommand } from "./commands";
import { GIB, type MemoryFacts } from "./memory";
import { currentFileHolder } from "./store";

// This file starts the CLI as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

interface Machine {
  home: string;
  cwd: string;
  leases: string;
  tickets: string;
}

function machine(config: Record<string, unknown> = {}): Machine {
  const home = tempDir("jobs-home");
  const cwd = tempDir("jobs-work");
  mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
  writeFileSync(
    join(home, ".config", "cc-smart-dev-kit", "jobs.json"),
    JSON.stringify({ launch: "plain", budgetGb: 10, ...config }),
  );
  const state = join(home, ".local", "share", "cc-smart-dev-kit", "jobs");
  return { home, cwd, leases: join(state, "leases"), tickets: join(state, "tickets") };
}

function env(m: Machine): Record<string, string> {
  const guard = subprocessGuard();
  return {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: m.home,
    CLAUDE_CONFIG_DIR: join(m.home, ".claude"),
    // Times in waiting lines are local: one zone, so the expected text is fixed.
    TZ: "Etc/UTC",
  };
}

function argv(args: string[], envFile = false): string[] {
  return [
    process.execPath,
    ...subprocessGuard().args,
    ...(envFile ? [] : ["--no-env-file"]),
    CLI,
    "job",
    ...args,
  ];
}

function cli(m: Machine, args: string[], options: { stdin?: string; envFile?: boolean } = {}) {
  const result = Bun.spawnSync(argv(args, options.envFile), {
    cwd: m.cwd,
    env: env(m),
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function start(m: Machine, args: string[]) {
  return Bun.spawn(argv(args), { cwd: m.cwd, env: env(m), stdout: "pipe", stderr: "pipe" });
}

function jsonFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
}

/** Reads a stream until `text` shows up (or it ends); returns all it read. */
async function readUntil(stream: ReadableStream<Uint8Array>, text: string): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes(text)) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
  }
  reader.releaseLock();
  return seen;
}

/**
 * A live process that is no ancestor of the CLI under test: a lease of this test process
 * would make every `job run` it starts a job inside a job, which runs directly.
 */
function liveHolder(): { pid: number; stop: () => void } {
  const sleeper = Bun.spawn(["sleep", "60"]);
  return { pid: sleeper.pid, stop: () => sleeper.kill("SIGKILL") };
}

/**
 * A lease that live process holds, as its `job run` wrote it. `file` names it, so a test can
 * plant several. `gb` is the wire number: 1 for a slot, as this plugin writes it, or the GB an
 * older plugin reserved there (it counts as one slot all the same).
 */
function plantLease(
  leases: string,
  pid: number,
  gb: number,
  since: number,
  file = "planted.json",
): string {
  mkdirSync(leases, { recursive: true });
  const path = join(leases, file);
  const record = JSON.stringify({
    checkout: "/home/user/app",
    gb,
    kind: "build",
    person: hostname(),
    pid,
    since,
    v: 1,
    what: "next build",
  });
  const holder = { ...currentFileHolder(), pid, startTime: processStartTime(pid) };
  writeFileSync(path, JSON.stringify({ store: 1, gb, holder, record }));
  return path;
}

describe("job run: the job's output, input and exit code pass through", () => {
  test("stdout, stderr and the exit code", () => {
    const m = machine();
    const result = cli(m, [
      "run",
      "--kind",
      "tsc",
      "--",
      "sh",
      "-c",
      "echo out; echo err >&2; exit 7",
    ]);
    expect(result).toEqual({ code: 7, stdout: "out\n", stderr: "err\n" });
  });

  test("stdin", () => {
    const m = machine();
    expect(cli(m, ["run", "--kind=tsc", "--", "cat"], { stdin: "hello\n" })).toEqual({
      code: 0,
      stdout: "hello\n",
      stderr: "",
    });
  });

  test("127 and one line for a command that does not exist", () => {
    const m = machine();
    expect(cli(m, ["run", "--kind", "tsc", "--", "cc-smart-dev-kit-no-such-command-xyz"])).toEqual({
      code: 127,
      stdout: "",
      stderr:
        "[cc-smart-dev-kit job] could not start cc-smart-dev-kit-no-such-command-xyz: ENOENT\n",
    });
  });

  // The queue adds no worker count: the runner's own default applies.
  test("a test run is started with the command as given: no --maxWorkers is added", () => {
    const m = machine();
    const result = cli(m, ["run", "--kind", "test:run", "--", "echo", "vitest", "run", "src/a.ts"]);
    expect(result).toEqual({ code: 0, stdout: "vitest run src/a.ts\n", stderr: "" });
  });
});

describe("job run: the slot", () => {
  test("is held while the job runs, and freed when it ends well or fails", () => {
    const m = machine();
    for (const exit of [0, 3]) {
      const result = cli(m, [
        "run",
        "--kind",
        "tsc",
        "--",
        "sh",
        "-c",
        `cat "${m.leases}"/*.json; exit ${exit}`,
      ]);
      expect(result.code).toBe(exit);
      const lease = JSON.parse(result.stdout);
      // 1 in the old gb field: a slot. An older `job run` reads it as a 1 GB holder.
      expect(lease.gb).toBe(1);
      expect(JSON.parse(lease.record)).toMatchObject({
        kind: "tsc",
        gb: 1,
        checkout: m.cwd,
        person: hostname(),
      });
      expect(jsonFiles(m.leases)).toEqual([]);
      expect(jsonFiles(m.tickets)).toEqual([]);
    }
  });

  // The queue counts jobs now: --gb parses, changes nothing, and says so on stderr once.
  test("--gb is accepted and ignored, with one line saying the queue counts jobs now", () => {
    const m = machine();
    const result = cli(m, [
      "run",
      "--kind",
      "tsc",
      "--gb",
      "3",
      "--",
      "sh",
      "-c",
      `cat "${m.leases}"/*.json`,
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).gb).toBe(1);
    expect(result.stderr).toBe(
      '[cc-smart-dev-kit job] --gb is ignored: the queue counts jobs now, not gigabytes (see "cc-smart-dev-kit job status")\n',
    );
  });

  test("a print-only run takes no slot and writes no lease, even when every slot is taken", () => {
    const m = machine({ maxJobs: 1 });
    const holder = liveHolder();
    plantLease(m.leases, holder.pid, 1, Date.now());
    // `-v` is a print-only option of the type-check kind: such a run never waits.
    const result = cli(m, ["run", "--kind", "tsc", "--", "echo", "-v"]);
    holder.stop();
    expect(result).toEqual({ code: 0, stdout: "-v\n", stderr: "" });
    expect(jsonFiles(m.tickets)).toEqual([]);
  });

  test("a test run on named files takes no slot and writes no lease, even when every slot is taken", () => {
    const m = machine({ maxJobs: 1 });
    mkdirSync(join(m.cwd, "src"));
    writeFileSync(join(m.cwd, "src", "a.test.ts"), "");
    const holder = liveHolder();
    plantLease(m.leases, holder.pid, 1, Date.now());
    // `test:run` has `noSlotForFiles`: `run` is its skip word, and the one operand is a file.
    const result = cli(m, ["run", "--kind", "test:run", "--", "echo", "run", "src/a.test.ts"]);
    holder.stop();
    expect(result).toEqual({ code: 0, stdout: "run src/a.test.ts\n", stderr: "" });
    expect(jsonFiles(m.tickets)).toEqual([]);
  });

  test("a test run on a folder is a full run: it waits for a slot", async () => {
    const m = machine({ maxJobs: 1 });
    mkdirSync(join(m.cwd, "src"));
    const holder = liveHolder();
    plantLease(m.leases, holder.pid, 1, Date.now());
    const child = start(m, ["run", "--kind", "test:run", "--", "echo", "run", "src"]);
    const err = await readUntil(child.stderr, "Why:");
    expect(err).toContain("[cc-smart-dev-kit job] Heavy job waits for a free slot: echo run src.");
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    holder.stop();
  });

  test("a test run whose unknown option's value is an existing file is a full run: it waits for a slot (review #2)", async () => {
    const m = machine({ maxJobs: 1 });
    writeFileSync(join(m.cwd, "results.xml"), "");
    const holder = liveHolder();
    plantLease(m.leases, holder.pid, 1, Date.now());
    const child = start(m, [
      "run",
      "--kind",
      "test:run",
      "--",
      "echo",
      "run",
      "--outputFile.junit",
      "results.xml",
    ]);
    const err = await readUntil(child.stderr, "Why:");
    expect(err).toContain(
      "[cc-smart-dev-kit job] Heavy job waits for a free slot: echo run --outputFile.junit results.xml.",
    );
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    holder.stop();
  });

  test("is freed when the job run gets SIGTERM: sent on to the job, which ends with 143", async () => {
    const m = machine();
    const child = start(m, ["run", "--kind", "tsc", "--", "sh", "-c", "echo started; sleep 30"]);
    expect(await readUntil(child.stdout, "started")).toBe("started\n");
    expect(jsonFiles(m.leases)).toHaveLength(1);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(143);
    expect(jsonFiles(m.leases)).toEqual([]);
  });

  test("a full machine makes the next job wait, and a SIGINT while it waits gives its place back and ends with 130", async () => {
    const m = machine({ maxJobs: 1 });
    const holder = liveHolder();
    const planted = plantLease(m.leases, holder.pid, 1, Date.now());
    const child = start(m, ["run", "--kind", "tsc", "--", "echo", "never"]);
    const err = await readUntil(child.stderr, "Why:");
    expect(err).toContain("[cc-smart-dev-kit job] Heavy job waits for a free slot: echo never.");
    expect(err).toContain("this machine: 0 of 1 slot free.");
    expect(jsonFiles(m.tickets)).toHaveLength(1);
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    expect(await new Response(child.stdout).text()).toBe("");
    expect(jsonFiles(m.tickets)).toEqual([]);
    expect(existsSync(planted)).toBe(true);
    holder.stop();
  });

  // An older `job run` is still holding a GB-sized lease: it is one slot, whatever it reserved.
  test("a lease an older plugin wrote (14 GB) holds one slot of the three, not the machine", () => {
    const m = machine();
    const holder = liveHolder();
    plantLease(m.leases, holder.pid, 14, Date.now());
    const result = cli(m, ["run", "--kind", "tsc", "--", "echo", "ran"]);
    holder.stop();
    expect(result).toEqual({ code: 0, stdout: "ran\n", stderr: "" });
  });

  test("the default is three at once: with three held, the fourth waits", async () => {
    const m = machine();
    const holders = [1, 2, 3].map(() => liveHolder());
    holders.forEach((one, index) => {
      plantLease(m.leases, one.pid, 1, Date.now(), `planted-${index}.json`);
    });
    const child = start(m, ["run", "--kind", "tsc", "--", "echo", "fourth"]);
    const err = await readUntil(child.stderr, "Why:");
    expect(err).toContain("this machine: 0 of 3 slots free.");
    expect(err).toContain("Why: all 3 of this machine's slots are taken.");
    child.kill("SIGINT");
    await child.exited;
    for (const one of holders) one.stop();
  });

  test("a job run killed with SIGKILL leaves a stale lease, which the next look removes", async () => {
    const m = machine();
    const child = start(m, ["run", "--kind", "tsc", "--", "sh", "-c", "echo $$; sleep 30"]);
    const jobPid = Number((await readUntil(child.stdout, "\n")).trim());
    child.kill("SIGKILL");
    await child.exited;
    // The job itself lives on, unaccounted (docs/jobs.md § Limits): its own group.
    process.kill(-jobPid, "SIGKILL");
    expect(jsonFiles(m.leases)).toHaveLength(1);
    const status = cli(m, ["status"]);
    expect(status.stdout).toContain(`This machine (${STATE_SHOWN}): 0 of 3 slots in use\n`);
    expect(jsonFiles(m.leases)).toEqual([]);
    // And the slot is free for the next job at once.
    expect(cli(m, ["run", "--kind", "tsc", "--", "true"]).code).toBe(0);
  });

  test.if(process.platform === "linux")(
    "a job inside a job runs directly: it never waits for its parent's slot",
    () => {
      const m = machine({ maxJobs: 1 });
      // The outer job holds the only slot: a queued inner job would wait for ever.
      const inner = [
        ...argv(["run", "--kind", "build", "--", "sh", "-c", `ls "${m.leases}" | wc -l`]),
      ];
      const result = Bun.spawnSync(argv(["run", "--kind", "tsc", "--", ...inner]), {
        cwd: m.cwd,
        env: env(m),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe("1");
    },
  );
});

describe("job run: what it refuses", () => {
  test("a wrong command line: exit 2 and the usage", () => {
    const m = machine();
    for (const [args, line] of [
      [
        ["run", "--", "true"],
        "[cc-smart-dev-kit job] --kind <kind> or --exclusive <name> is required",
      ],
      [
        ["run", "--exclusive", "my image", "--", "true"],
        "[cc-smart-dev-kit job] --exclusive takes a name: letters, digits, . _ : -, at most 64 characters",
      ],
      [["run", "--kind", "tsc", "true"], "[cc-smart-dev-kit job] put -- before the command"],
      [["run", "--kind", "tsc", "--"], "[cc-smart-dev-kit job] no command after --"],
      [
        ["run", "--kind", "tsc", "--gb", "two", "--", "true"],
        "[cc-smart-dev-kit job] --gb takes a whole number of GB",
      ],
      [["run", "--size", "2", "--", "true"], "[cc-smart-dev-kit job] unknown option: --size"],
    ] as const) {
      const result = cli(m, [...args]);
      expect(result.code).toBe(2);
      expect(result.stderr.split("\n")[0]).toBe(line);
      expect(result.stderr).toContain("Usage: cc-smart-dev-kit job <command>");
    }
  });

  test("an unknown kind: exit 2, naming the kinds there are", () => {
    const m = machine();
    expect(cli(m, ["run", "--kind", "lint", "--", "true"])).toEqual({
      code: 2,
      stdout: "",
      stderr:
        '[cc-smart-dev-kit job] unknown kind "lint": one of tsc, lint:typed, test:coverage, test:run, build, install, image:build\n',
    });
  });

  test("a folder with .env files when bun would load them: exit 2; with --no-env-file the job never sees them", () => {
    const m = machine();
    writeFileSync(join(m.cwd, ".env"), "CC_SMART_DEV_KIT_ENV_PROBE=from-dotenv\n");
    const refused = cli(m, ["run", "--kind", "tsc", "--", "true"], { envFile: true });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toBe(
      '[cc-smart-dev-kit job] this folder has .env, and bun was started without --no-env-file: the job would get their values. Run "cc-smart-dev-kit setup" to update the launcher, then try again.\n',
    );
    const clean = cli(m, [
      "run",
      "--kind",
      "tsc",
      "--",
      "sh",
      "-c",
      "printenv CC_SMART_DEV_KIT_ENV_PROBE || echo unset",
    ]);
    expect(clean).toEqual({ code: 0, stdout: "unset\n", stderr: "" });
  });

  // Exit 1 would read as the job's own failure (a type check that found an error).
  test("a broken jobs.json: exit 2, naming the file and the field; the job never starts", () => {
    const m = machine({ launch: "sometimes" });
    const result = cli(m, ["run", "--kind", "tsc", "--", "sh", "-c", "echo ran"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toStartWith(
      `[cc-smart-dev-kit job] Invalid ${join(m.home, ".config", "cc-smart-dev-kit", "jobs.json")}: launch: `,
    );
  });

  test("a maxJobs of 0: exit 2, naming the file and the field; the job never starts", () => {
    const m = machine({ maxJobs: 0 });
    const result = cli(m, ["run", "--kind", "tsc", "--", "sh", "-c", "echo ran"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toStartWith(
      `[cc-smart-dev-kit job] Invalid ${join(m.home, ".config", "cc-smart-dev-kit", "jobs.json")}: maxJobs: `,
    );
  });

  test("a broken cc-smart-dev-kit.json, or a state folder that cannot be made: exit 2", () => {
    const m = machine();
    git(m.cwd, "init", "-q");
    mkdirSync(join(m.cwd, ".claude"));
    writeFileSync(join(m.cwd, ".claude", "cc-smart-dev-kit.json"), "{ not json");
    const broken = cli(m, ["run", "--kind", "tsc", "--", "sh", "-c", "echo ran"]);
    expect(broken.code).toBe(2);
    expect(broken.stdout).toBe("");
    expect(broken.stderr).toStartWith("[cc-smart-dev-kit job] ");

    const blocked = machine({ stateDir: "/proc/cc-smart-dev-kit-no-such-folder" });
    const result = cli(blocked, ["run", "--kind", "tsc", "--", "sh", "-c", "echo ran"]);
    expect(result).toEqual({
      code: 2,
      stdout: "",
      stderr:
        "[cc-smart-dev-kit job] The state folder /proc/cc-smart-dev-kit-no-such-folder cannot be made (ENOENT).\n",
    });
  });
});

describe("job run --exclusive", () => {
  test("one job with the name at a time: the second waits, then runs", async () => {
    const m = machine();
    const first = start(m, [
      "run",
      "--exclusive",
      "image",
      "--",
      "sh",
      "-c",
      "echo started; sleep 30",
    ]);
    expect(await readUntil(first.stdout, "started")).toBe("started\n");
    const lease = JSON.parse(readFileSync(join(m.leases, jsonFiles(m.leases)[0] ?? ""), "utf8"));
    // A name alone: gb 0, no slot.
    expect(lease).toMatchObject({ gb: 0, exclusive: "image" });
    expect(JSON.parse(lease.record)).toMatchObject({ exclusive: "image", kind: "", gb: 0 });

    const second = start(m, ["run", "--exclusive", "image", "--", "echo", "second"]);
    const err = await readUntil(second.stderr, "Why:");
    expect(err).toContain(
      "[cc-smart-dev-kit job] Heavy job waits for its turn for --exclusive image: echo second.",
    );
    expect(err).toContain(
      "Why: another job with --exclusive image holds this machine's turn for that name.",
    );
    // A job with another name, or a slot only, does not wait for it.
    expect(cli(m, ["run", "--exclusive", "deploy", "--", "true"]).code).toBe(0);
    expect(cli(m, ["run", "--kind", "tsc", "--", "true"]).code).toBe(0);

    first.kill("SIGTERM");
    expect(await first.exited).toBe(143);
    expect(await second.exited).toBe(0);
    expect(await new Response(second.stdout).text()).toBe("second\n");
    // It waited, so it says when it started and how it ended: the lines a pipe hides. The
    // hint came with the first waiting line, once, and never again.
    const all = err + (await readUntil(second.stderr, "Heavy job ended: "));
    expect(all).toMatch(/Heavy job starts after .+: echo second\n/);
    expect(all).toMatch(/Heavy job ended: echo second, exit 0 after .+\n/);
    expect(all.match(/A pipe \(\| tail\) hides this job's exit status/g)).toHaveLength(1);
    expect(jsonFiles(m.leases)).toEqual([]);
  });

  test("with a kind: a slot and the name together", () => {
    const m = machine();
    const result = cli(m, [
      "run",
      "--kind",
      "tsc",
      "--exclusive",
      "image",
      "--",
      "sh",
      "-c",
      `cat "${m.leases}"/*.json`,
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ gb: 1, exclusive: "image" });
  });
});

/** A shared folder as a machine's own setup prepares it: `jobs` heavy jobs at once. */
function sharedFolder(jobs: number): string {
  const dir = tempDir("jobs-shared");
  writeFileSync(join(dir, "max-jobs"), `${jobs}\n`);
  mkdirSync(join(dir, "leases"));
  mkdirSync(join(dir, "tickets"));
  return dir;
}

/** The state folder as `job status` shows it: under the home folder, written with `~`. */
const STATE_SHOWN = join("~", ".local", "share", "cc-smart-dev-kit", "jobs");

/** What `job status` says about a weight `jobs.json` does not set, on a Linux machine. */
const WEIGHT_DEFAULT = (name: "cpu" | "io") =>
  `a job runs at systemd's own weight (100). cc-smart-dev-kit job set ${name}-weight <1-10000> asks for another.`;

/** The same, on the machine these tests run on: only Linux has a slice that could carry one. */
const WEIGHT_OFF = (name: "cpu" | "io") =>
  process.platform === "linux"
    ? WEIGHT_DEFAULT(name)
    : "only a Linux systemd user manager has weights.";

/** Why this machine makes no memory group for a job, whatever `jobs.json` says. */
const NO_GROUP_WHY =
  process.platform === "win32"
    ? "Windows has no memory group, so a heavy job runs as a plain child, and the queue is what keeps heavy jobs apart."
    : process.platform === "linux"
      ? "jobs.json sets launch: plain."
      : "only a Linux systemd user manager has a memory ceiling.";

const MAX_JOBS_LINE = (slots: number, set: boolean) =>
  `Heavy jobs at once on this machine: ${slots} (${set ? "set in jobs.json" : "the default"}). Change it with: cc-smart-dev-kit job set max-jobs <n>`;

/** The job route outside any project, with no switch of the person's: off, by default. */
const ROUTE_OFF_LINE =
  "Job route for a project that sets none: off: a heavy command runs raw, outside the queue (the default). Turn it on for every project with: cc-smart-dev-kit workflow set switches.jobRoute true";

describe("job status", () => {
  test("names the slots in use, the holders, the ceiling, and the line that changes it, here and on a shared folder", () => {
    const shared = sharedFolder(4);
    const missing = join(shared, "missing");
    const m = machine({ sharedDirs: [shared, missing] });
    const holder = liveHolder();
    plantLease(m.leases, holder.pid, 8, Date.UTC(2026, 9, 11, 9, 5));
    const result = cli(m, ["status"]);
    holder.stop();
    expect(result.code).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toStartWith("Memory: ");
    // No memory group is made here, and the ceiling line says why: launch: plain on Linux, the
    // platform itself elsewhere.
    expect(lines[1]).toBe(`Memory ceiling for heavy jobs: none: ${NO_GROUP_WHY}`);
    expect(lines[2]).toBe(`CPU priority: not set: ${WEIGHT_OFF("cpu")}`);
    expect(lines[3]).toBe(`Disk I/O priority: not set: ${WEIGHT_OFF("io")}`);
    // The free memory is the machine's real reading, so its number is matched, not fixed.
    expect(lines[10]).toMatch(
      /^A job starts with 4 GB of memory free, or when no other job runs; \d+(\.\d)? GB is free now\. Change it with: cc-smart-dev-kit job set start-free-gb <n>$/,
    );
    expect(lines.slice(4).filter((_, index) => index !== 6)).toEqual([
      `This machine (${STATE_SHOWN}): 1 of 3 slots in use`,
      `  this machine: a slot is held by ${hostname()}: build, next build in /home/user/app, since 2026-10-11 09:05 (pid ${holder.pid})`,
      `Shared folder ${shared}: 0 of 4 slots in use`,
      "  nothing held, nobody waits",
      MAX_JOBS_LINE(3, false),
      "Light jobs at once on this machine: 2, 0 in use. Change it with: cc-smart-dev-kit job set light-jobs <n>",
      ROUTE_OFF_LINE,
      `The shared folder ${missing} is missing: this job runs without its slots.`,
      "",
    ]);
  });

  test("a full machine, with maxJobs set: every slot in use, who waits, and where the number comes from", async () => {
    const m = machine({ maxJobs: 2 });
    const holders = [liveHolder(), liveHolder()];
    holders.forEach((one, index) => {
      plantLease(m.leases, one.pid, 1, Date.UTC(2026, 9, 11, 9, 5 + index), `held-${index}.json`);
    });
    const waiting = start(m, ["run", "--kind", "tsc", "--", "echo", "never"]);
    await readUntil(waiting.stderr, "Why:");
    const result = cli(m, ["status"]);
    waiting.kill("SIGINT");
    await waiting.exited;
    for (const one of holders) one.stop();
    const lines = result.stdout.split("\n");
    expect(lines[4]).toBe(`This machine (${STATE_SHOWN}): 2 of 2 slots in use`);
    expect(lines.filter((line) => line.includes("a slot is held by"))).toHaveLength(2);
    expect(lines.filter((line) => line.includes("waits for a slot: "))).toHaveLength(1);
    expect(lines.at(-5)).toBe(MAX_JOBS_LINE(2, true));
    expect(lines.at(-2)).toBe(ROUTE_OFF_LINE);
  });

  // Two users who list the same folders in another order would each take one first, and
  // could each wait for the other's.
  test("uses the shared folders in one order, whatever order jobs.json lists them in", () => {
    const [first = "", second = ""] = [sharedFolder(3), sharedFolder(3)].sort();
    writeFileSync(join(second, "max-jobs"), "2\n");
    const m = machine({ sharedDirs: [second, first, second] });
    const result = cli(m, ["status"]);
    expect(result.stdout.split("\n").filter((line) => line.startsWith("Shared folder"))).toEqual([
      `Shared folder ${first}: 0 of 3 slots in use`,
      `Shared folder ${second}: 0 of 2 slots in use`,
    ]);
  });

  test("a shared folder with only the old budget file is left out, once, naming the fix", () => {
    const shared = tempDir("jobs-shared");
    writeFileSync(join(shared, "budget"), "30\n");
    mkdirSync(join(shared, "leases"));
    mkdirSync(join(shared, "tickets"));
    const m = machine({ sharedDirs: [shared] });
    const result = cli(m, ["status"]);
    expect(result.code).toBe(0);
    const left = result.stdout.split("\n").filter((line) => line.includes("is left out"));
    expect(left).toEqual([
      `The shared folder ${shared} is left out: it has only the old budget file (GB), and the queue counts jobs now: write the number of heavy jobs at once, for every user of the folder, into ${join(shared, "max-jobs")} (a whole number, for example 3).`,
    ]);
    expect(result.stdout).not.toContain(`Shared folder ${shared}:`);
  });

  test.skipIf(process.getuid?.() === 0)(
    "a store it cannot read is one line saying so, and the rest still prints",
    () => {
      const shared = sharedFolder(4);
      const m = machine({ sharedDirs: [shared] });
      mkdirSync(m.leases, { recursive: true });
      chmodSync(m.leases, 0o300); // it may write there, not list it
      try {
        const result = cli(m, ["status"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain(
          `This machine (${STATE_SHOWN}): cannot be read (EACCES: permission denied, scandir '${m.leases}')\n`,
        );
        expect(result.stdout).toContain(`Shared folder ${shared}: 0 of 4 slots in use\n`);
      } finally {
        chmodSync(m.leases, 0o700);
      }
    },
  );
});

describe("job kinds", () => {
  test("lists the defaults, and a project's own kinds over them", () => {
    const m = machine();
    git(m.cwd, "init", "-q");
    mkdirSync(join(m.cwd, ".claude"));
    writeFileSync(
      join(m.cwd, ".claude", "cc-smart-dev-kit.json"),
      // `gb` is an old size field: it parses, and the queue ignores it.
      JSON.stringify({ jobs: { kinds: { e2e: { gb: 3, about: "End-to-end tests." } } } }),
    );
    const result = cli(m, ["kinds"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "tsc            (default)",
        "               A TypeScript type check (tsc, tsgo, vue-tsc).",
        "lint:typed     (default)",
        "               A type-aware lint: ESLint with a typed config, or oxlint --type-aware.",
        "test:coverage  (default)",
        "               A test run with coverage (vitest or jest with --coverage).",
        "test:run       (default)",
        "               A test run (vitest, jest). A run on named test files runs at once, with no slot.",
        "build          (default)",
        "               A framework production build (next build).",
        "install        (default)",
        "               Install dependencies in the light lane.",
        "image:build    (default)",
        "               A container image build (docker, podman, compose).",
        "e2e            (project)",
        "               End-to-end tests.",
        "",
      ].join("\n"),
    );
    // And `job run` uses the project's kind: one slot, whatever `gb` it still says.
    const run = cli(m, ["run", "--kind", "e2e", "--", "sh", "-c", `cat "${m.leases}"/*.json`]);
    expect(JSON.parse(run.stdout).gb).toBe(1);
  });

  test("an unknown job command: exit 2", () => {
    const m = machine();
    const result = cli(m, ["queue"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toStartWith("Unknown job command: queue\n");
  });
});

describe("job set", () => {
  test("writes max-jobs into jobs.json, and the next status and run read it", () => {
    const m = machine();
    const shown = join("~", ".config", "cc-smart-dev-kit", "jobs.json");
    const result = cli(m, ["set", "max-jobs", "1"]);
    expect(result).toEqual({
      code: 0,
      stdout: `~ ${shown}: max-jobs = 1\nA job that already runs or waits keeps what it started with; the next one uses this.\n`,
      stderr: "",
    });
    const file = JSON.parse(
      readFileSync(join(m.home, ".config", "cc-smart-dev-kit", "jobs.json"), "utf8"),
    );
    expect(file).toEqual({ launch: "plain", budgetGb: 10, maxJobs: 1 });
    expect(cli(m, ["status"]).stdout).toContain(MAX_JOBS_LINE(1, true));
  });

  test("a wrong setting or value: exit 2, one line, and the file is untouched", () => {
    const m = machine();
    const file = join(m.home, ".config", "cc-smart-dev-kit", "jobs.json");
    const before = readFileSync(file, "utf8");
    const value = cli(m, ["set", "max-jobs", "0"]);
    expect(value.code).toBe(2);
    expect(value.stderr).toBe("[cc-smart-dev-kit job] max-jobs is a whole number, 1 or more\n");
    const name = cli(m, ["set", "parallel", "2"]);
    expect(name.code).toBe(2);
    expect(name.stderr).toBe(
      "[cc-smart-dev-kit job] Unknown setting: parallel. The settings are: cpu-weight, io-weight, max-jobs, light-jobs, start-free-gb\n",
    );
    const missing = cli(m, ["set", "max-jobs"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toStartWith(
      "[cc-smart-dev-kit job] set needs a setting and one value\n",
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

/**
 * `job status` on Windows, run in this process: the machine's platform is one of its facts
 * (`MemoryFacts`), and this machine may not be Windows. A CLI subprocess could only ever report
 * this machine's platform.
 */
describe("job status on Windows", () => {
  /** A `job status` context over a temp home, with the memory facts of a Windows machine. */
  function context() {
    const home = tempDir("jobs-home");
    const printed: string[] = [];
    const said: string[] = [];
    const memory: MemoryFacts = {
      platform: "win32",
      read: () => null, // no /proc/meminfo and no cgroup there: both are Linux files
      totalmem: () => 32 * GIB,
      freemem: () => 11 * GIB,
    };
    const ctx: JobContext = {
      paths: cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }),
      cwd: tempDir("jobs-work"),
      execArgv: ["--no-env-file"],
      memory,
      say: (line) => said.push(line),
      print: (line) => printed.push(line),
      now: () => Date.UTC(2026, 9, 11, 9, 5),
    };
    return { ctx, printed, said };
  }

  test("says plainly that no memory ceiling can be made, and that the slots are what keeps jobs apart", async () => {
    const { ctx, printed, said } = context();
    expect(await runJobCommand(["status"], ctx)).toBe(0);
    expect(said).toEqual([]);
    // The ceiling line, written here by hand: it is what a person on Windows reads.
    expect(printed).toEqual([
      "Memory: 32 GB.",
      "Memory ceiling for heavy jobs: none: Windows has no memory group, so a heavy job runs as a plain child, and the queue is what keeps heavy jobs apart.",
      "CPU priority: not set: only a Linux systemd user manager has weights.",
      "Disk I/O priority: not set: only a Linux systemd user manager has weights.",
      `This machine (${STATE_SHOWN}): 0 of 3 slots in use`,
      "  nothing held, nobody waits",
      MAX_JOBS_LINE(3, false),
      "Light jobs at once on this machine: 2, 0 in use. Change it with: cc-smart-dev-kit job set light-jobs <n>",
      "A job starts with 4 GB of memory free, or when no other job runs; 11 GB is free now. Change it with: cc-smart-dev-kit job set start-free-gb <n>",
      ROUTE_OFF_LINE,
    ]);
  });

  test("Linux without a systemd user manager says there is none, and keeps its ceiling reason", async () => {
    const { ctx, printed } = context();
    // The Linux branch reads /proc/meminfo and the user manager's cgroup, and this fake has neither.
    const linux: JobContext = { ...ctx, memory: { ...ctx.memory, platform: "linux" } };
    expect(await runJobCommand(["status"], linux)).toBe(0);
    expect(printed.slice(0, 4)).toEqual([
      "Memory: 32 GB.",
      "Memory ceiling for heavy jobs: none: no systemd user manager answers here.",
      `CPU priority: not set: ${WEIGHT_DEFAULT("cpu")}`,
      `Disk I/O priority: not set: ${WEIGHT_DEFAULT("io")}`,
    ]);
  });
});
