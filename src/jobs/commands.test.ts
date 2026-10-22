/**
 * `cc-smart-dev-kit job …` run as the real CLI, in a temp HOME. Each test writes a `jobs.json`
 * with `launch: plain`, so no test ever starts a systemd scope or touches a slice, and
 * with a fixed `budgetGb`, so no test depends on this machine's memory. The jobs are small
 * `sh` scripts.
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

/** A lease that live process holds, as its `job run` wrote it. */
function plantLease(leases: string, pid: number, gb: number, since: number): string {
  mkdirSync(leases, { recursive: true });
  const file = join(leases, "planted.json");
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
  writeFileSync(file, JSON.stringify({ store: 1, gb, holder, record }));
  return file;
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
});

describe("job run: the lease", () => {
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
      expect(lease.gb).toBe(8);
      expect(JSON.parse(lease.record)).toMatchObject({
        kind: "tsc",
        gb: 8,
        checkout: m.cwd,
        person: hostname(),
      });
      expect(jsonFiles(m.leases)).toEqual([]);
      expect(jsonFiles(m.tickets)).toEqual([]);
    }
  });

  test("reserves --gb when given", () => {
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
    expect(JSON.parse(result.stdout).gb).toBe(3);
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

  test("a SIGINT while it waits gives its place back and ends with 130", async () => {
    const m = machine();
    const holder = liveHolder();
    const planted = plantLease(m.leases, holder.pid, 10, Date.now());
    const child = start(m, ["run", "--kind", "tsc", "--", "echo", "never"]);
    const err = await readUntil(child.stderr, "Why:");
    expect(err).toContain(
      "[cc-smart-dev-kit job] Heavy job waits for memory: echo never needs 8 GB.",
    );
    expect(jsonFiles(m.tickets)).toHaveLength(1);
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    expect(await new Response(child.stdout).text()).toBe("");
    expect(jsonFiles(m.tickets)).toEqual([]);
    expect(existsSync(planted)).toBe(true);
    holder.stop();
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
    expect(status.stdout).toContain(
      "This machine (~/.local/share/cc-smart-dev-kit/jobs): 10 of 10 GB free\n",
    );
    expect(jsonFiles(m.leases)).toEqual([]);
    // And the memory is free for the next job at once.
    expect(cli(m, ["run", "--kind", "tsc", "--gb", "10", "--", "true"]).code).toBe(0);
  });

  test.if(process.platform === "linux")(
    "a job inside a job runs directly: it never waits for its parent's memory",
    () => {
      const m = machine();
      // The inner build needs 14 GB of a 10 GB budget while the outer job holds 8: queued,
      // it would wait for ever.
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
        '[cc-smart-dev-kit job] unknown kind "lint": one of tsc, lint:typed, test:coverage, test:run, build, image:build\n',
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
    expect(lease).toMatchObject({ gb: 0, exclusive: "image" });
    expect(JSON.parse(lease.record)).toMatchObject({ exclusive: "image", kind: "", gb: 0 });

    const second = start(m, ["run", "--exclusive", "image", "--", "echo", "second"]);
    const err = await readUntil(second.stderr, "Why:");
    expect(err).toContain(
      "[cc-smart-dev-kit job] Heavy job waits for memory: echo second needs 0 GB and the turn for --exclusive image.",
    );
    expect(err).toContain(
      "Why: another job with --exclusive image holds this machine's turn for that name.",
    );
    // A job with another name, or memory only, does not wait for it.
    expect(cli(m, ["run", "--exclusive", "deploy", "--", "true"]).code).toBe(0);
    expect(cli(m, ["run", "--kind", "tsc", "--", "true"]).code).toBe(0);

    first.kill("SIGTERM");
    expect(await first.exited).toBe(143);
    expect(await second.exited).toBe(0);
    expect(await new Response(second.stdout).text()).toBe("second\n");
    expect(jsonFiles(m.leases)).toEqual([]);
  });

  test("with a kind: the kind's memory and the name together", () => {
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
    expect(JSON.parse(result.stdout)).toMatchObject({ gb: 8, exclusive: "image" });
  });
});

/** A shared folder as a machine's own setup prepares it. */
function sharedFolder(budget: number): string {
  const dir = tempDir("jobs-shared");
  writeFileSync(join(dir, "budget"), `${budget}\n`);
  mkdirSync(join(dir, "leases"));
  mkdirSync(join(dir, "tickets"));
  return dir;
}

describe("job status", () => {
  test("names the holders and the free GB, here and on a shared folder", () => {
    const shared = sharedFolder(30);
    const m = machine({ sharedDirs: [shared, join(shared, "missing")] });
    const holder = liveHolder();
    plantLease(m.leases, holder.pid, 8, Date.UTC(2026, 9, 11, 9, 5));
    const result = cli(m, ["status"]);
    holder.stop();
    expect(result.code).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toStartWith("Memory: ");
    expect(lines.slice(1)).toEqual([
      "Budget for heavy jobs here: 10 GB (set in jobs.json).",
      "This machine (~/.local/share/cc-smart-dev-kit/jobs): 2 of 10 GB free",
      `  this machine: 8 GB held by ${hostname()}: build, next build in /home/user/app, since 2026-10-11 09:05 (pid ${holder.pid})`,
      `Shared folder ${shared}: 30 of 30 GB free`,
      "  nothing held, nobody waits",
      `The shared folder ${join(shared, "missing")} is missing: this job runs without its budget.`,
      "",
    ]);
  });

  // Two users who list the same folders in another order would each take one first, and
  // could each wait for the other's.
  test("uses the shared folders in one order, whatever order jobs.json lists them in", () => {
    const [first = "", second = ""] = [sharedFolder(30), sharedFolder(30)].sort();
    writeFileSync(join(second, "budget"), "20\n");
    const m = machine({ sharedDirs: [second, first, second] });
    const result = cli(m, ["status"]);
    expect(result.stdout.split("\n").filter((line) => line.startsWith("Shared folder"))).toEqual([
      `Shared folder ${first}: 30 of 30 GB free`,
      `Shared folder ${second}: 20 of 20 GB free`,
    ]);
  });

  test.skipIf(process.getuid?.() === 0)(
    "a store it cannot read is one line saying so, and the rest still prints",
    () => {
      const shared = sharedFolder(30);
      const m = machine({ sharedDirs: [shared] });
      mkdirSync(m.leases, { recursive: true });
      chmodSync(m.leases, 0o300); // it may write there, not list it
      try {
        const result = cli(m, ["status"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain(
          `This machine (~/.local/share/cc-smart-dev-kit/jobs): cannot be read (EACCES: permission denied, scandir '${m.leases}')\n`,
        );
        expect(result.stdout).toContain(`Shared folder ${shared}: 30 of 30 GB free\n`);
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
      JSON.stringify({ jobs: { kinds: { e2e: { gb: 3, about: "End-to-end tests." } } } }),
    );
    const result = cli(m, ["kinds"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "tsc            8 GB (default)",
        "               A TypeScript type check (tsc, tsgo, vue-tsc).",
        "lint:typed     12 GB, 6 GB for files (default)",
        "               A type-aware lint: ESLint with a typed config, or oxlint --type-aware.",
        "test:coverage  12 GB, --maxWorkers at 0.5 GB a worker (default)",
        "               A test run with coverage (vitest or jest with --coverage).",
        "test:run       8 GB, 2 GB for up to 3 files, --maxWorkers at 0.5 GB a worker (default)",
        "               A test run (vitest, jest). Up to 3 existing files: the small size.",
        "build          14 GB (default)",
        "               A framework production build (next build).",
        "image:build    14 GB (default)",
        "               A container image build (docker, podman, compose).",
        "e2e            3 GB (project)",
        "               End-to-end tests.",
        "",
      ].join("\n"),
    );
    // And `job run` uses the project's kind.
    const run = cli(m, ["run", "--kind", "e2e", "--", "sh", "-c", `cat "${m.leases}"/*.json`]);
    expect(JSON.parse(run.stdout).gb).toBe(3);
  });

  test("an unknown job command: exit 2", () => {
    const m = machine();
    const result = cli(m, ["queue"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toStartWith("Unknown job command: queue\n");
  });
});

/**
 * `job status` on Windows, run in this process: the machine's platform is one of its facts
 * (`MemoryFacts`), and this machine is not Windows. A CLI subprocess could only ever report
 * this machine's platform.
 */
describe("job status on Windows", () => {
  /** A `job status` context over a temp home, with the memory facts of a Windows machine. */
  function context(availableGb: number | null) {
    const home = tempDir("jobs-home");
    const printed: string[] = [];
    const said: string[] = [];
    const memory: MemoryFacts = {
      platform: "win32",
      read: () => null, // no /proc/meminfo and no cgroup there: both are Linux files
      totalmem: () => 32 * GIB,
      freemem: () => (availableGb ?? 0) * GIB,
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

  test("reads os.freemem(), and says plainly that no memory ceiling can be made", async () => {
    const { ctx, printed, said } = context(11);
    expect(await runJobCommand(["status"], ctx)).toBe(0);
    expect(said).toEqual([]);
    // The ceiling line, written here by hand: it is what a person on Windows reads.
    expect(printed).toEqual([
      "Memory: 32 GB, 11 GB free now.",
      "Budget for heavy jobs here: 14 GB (32 GB of memory less 22 GB kept for everything else).",
      "No memory ceiling on this system: Windows has no memory group, so a heavy job runs as a plain child, and the queue is what keeps heavy jobs apart.",
      "This machine (~/.local/share/cc-smart-dev-kit/jobs): 14 of 14 GB free",
      "  nothing held, nobody waits",
    ]);
  });

  test("Linux never says it: the same facts there have no free reading", async () => {
    const { ctx, printed } = context(null);
    // The Linux branch reads /proc/meminfo and the cgroup, and this fake has neither.
    const linux: JobContext = { ...ctx, memory: { ...ctx.memory, platform: "linux" } };
    expect(await runJobCommand(["status"], linux)).toBe(0);
    expect(printed).toEqual([
      "Memory: 32 GB, free memory cannot be read on this system (no live check).",
      "Budget for heavy jobs here: 14 GB (32 GB of memory less 22 GB kept for everything else).",
      "This machine (~/.local/share/cc-smart-dev-kit/jobs): 14 of 14 GB free",
      "  nothing held, nobody waits",
    ]);
  });
});
