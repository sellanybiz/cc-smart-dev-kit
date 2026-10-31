/**
 * The heavy-job queue as data: the one reader `job status`, `/api/jobs` and the Machine page
 * all use (B6b). The status command's own lines are locked by `commands.test.ts`; this file
 * locks the shape and the lines built from it: slots in use, who holds them, who waits, the
 * memory ceiling, the line that changes `maxJobs`, and the resolved job route.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import { cliPaths } from "../cli/paths";
import { makeRepo, writeClaudeFile, writePersonalWorkflow } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { userManagerCgroup } from "./memory";
import { holderText } from "./queue";
import type { JobContext } from "./status";
import { jobsAnswer, jobsFingerprint, readJobs, routeLine, statusLines } from "./status";
import { currentFileHolder, leaseStore } from "./store";

/** The memory this machine reports: Linux's own fields, so the numbers are fixed. */
const MEMINFO = "MemTotal: 33554432 kB\nMemAvailable: 16777216 kB\n";

/** The user the fake systemd manager belongs to: a fixed one, on every platform. */
const UID = 1000;

/** The user manager's delegated controllers, as this machine's file lists them: no io. */
const CONTROLLERS = `/sys/fs/cgroup${userManagerCgroup(UID)}/cgroup.controllers`;

/** A job context on a temp home worth 32 GB, with `config` written to its jobs.json. */
function world(config: Record<string, unknown> = {}): {
  ctx: JobContext;
  dir: string;
  home: string;
} {
  const home = tempDir("jobs-status");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
  writeFileSync(
    join(home, ".config", "cc-smart-dev-kit", "jobs.json"),
    `${JSON.stringify({ budgetGb: 10, ...config })}\n`,
  );
  const dir = join(home, ".local", "share", "cc-smart-dev-kit", "jobs");
  mkdirSync(join(dir, "leases"), { recursive: true });
  mkdirSync(join(dir, "tickets"), { recursive: true });
  const ctx: JobContext = {
    cwd: home,
    execArgv: [],
    memory: {
      freemem: () => 16 * 1024 ** 3,
      platform: "linux",
      read: (path) => {
        if (path === "/proc/meminfo") return MEMINFO;
        if (path === CONTROLLERS) return "cpu memory pids\n";
        return null;
      },
      totalmem: () => 32 * 1024 ** 3,
    },
    paths,
    print: () => undefined,
    say: () => undefined,
    uid: UID,
  };
  return { ctx, dir, home };
}

/** A holder record, as the queue writes one. */
function record(
  what: string,
  slot = true,
  exclusive?: string,
  since = Date.UTC(2026, 9, 22, 10, 0, 0),
): string {
  return holderText({
    checkout: "/home/user/my-app",
    ...(exclusive !== undefined && { exclusive }),
    kind: "build",
    person: "my-host",
    pid: 4242,
    since,
    slot,
    v: 1,
    what,
  });
}

/** This machine's store, opened as the test's own `job run`. */
function machineStore(dir: string, slots = 3) {
  return leaseStore({ capacity: () => slots, dir, label: "this machine", shared: false });
}

const WEIGHT_DEFAULT = (name: "cpu" | "io") =>
  `a job runs at systemd's own weight (100). ${COMMAND} job set ${name}-weight <1-10000> asks for another.`;

describe("the jobs reader", () => {
  test("one held and one waiting, as the API's shape", async () => {
    const world1 = world();
    // The store's own writer makes the files, so the fixture is exactly what `job run` leaves.
    const store = machineStore(world1.dir);
    await store.tryTake("heavy", record("bunx tsc --noEmit"));
    await store.enqueue(record("next build"));
    const read = await readJobs(world1.ctx);
    expect(jobsAnswer(read)).toEqual({
      ceiling: { gb: 10, why: "set in jobs.json" },
      memoryGb: 32,
      lightJobs: { slots: 2, used: 0 },
      admission: { freeGb: 16, startFreeGb: 4 },
      route: { on: false, project: null, source: "default" },
      stores: [
        {
          held: [
            {
              command: "bunx tsc --noEmit",
              folder: "/home/user/my-app",
              kind: "build",
              pid: 4242,
              since: "2026-10-22T10:00:00.000Z",
              slot: true,
              user: "my-host",
            },
          ],
          slots: 3,
          used: 1,
          waiting: [
            {
              command: "next build",
              folder: "/home/user/my-app",
              kind: "build",
              pid: 4242,
              since: "2026-10-22T10:00:00.000Z",
              slot: true,
              user: "my-host",
            },
          ],
          where: "machine",
        },
      ],
      weights: {
        cpu: { value: null, why: WEIGHT_DEFAULT("cpu") },
        io: { value: null, why: WEIGHT_DEFAULT("io") },
      },
    });
  });

  test("the ceiling comes from the memory less the reserve, unless jobs.json names a budget", async () => {
    // 8 GB are kept by default.
    const reserve = await readJobs(world({ budgetGb: undefined }).ctx);
    expect(reserve.ceiling).toEqual({
      gb: 24,
      why: "32 GB of memory less 8 GB kept for everything else",
    });
    // A larger reserve, and the floor of 14 GB under it.
    const larger = await readJobs(world({ budgetGb: undefined, reserveGb: 22 }).ctx);
    expect(larger.ceiling).toEqual({
      gb: 14,
      why: "32 GB of memory less 22 GB kept for everything else",
    });
    const set = await readJobs(world({ budgetGb: 20 }).ctx);
    expect(set.ceiling).toEqual({ gb: 20, why: "set in jobs.json" });
  });

  test("an idle machine: three slots, none in use, nobody holds or waits", async () => {
    const world1 = world();
    const read = await readJobs(world1.ctx);
    const lines = statusLines(read, world1.home, Date.UTC(2026, 9, 22, 12, 0, 0));
    expect(lines[0]).toBe("Memory: 32 GB.");
    expect(lines.slice(4)).toEqual([
      expect.stringContaining(": 0 of 3 slots in use"),
      "  nothing held, nobody waits",
      `Heavy jobs at once on this machine: 3 (the default). Change it with: ${COMMAND} job set max-jobs <n>`,
      `Light jobs at once on this machine: 2, 0 in use. Change it with: ${COMMAND} job set light-jobs <n>`,
      `A job starts with 4 GB of memory free, or when no other job runs; 16 GB is free now. Change it with: ${COMMAND} job set start-free-gb <n>`,
      `Job route for a project that sets none: off: a heavy command runs raw, outside the queue (the default). Turn it on for every project with: ${COMMAND} workflow set switches.jobRoute true`,
    ]);
    expect(jobsAnswer(read).stores[0]).toEqual({
      held: [],
      slots: 3,
      used: 0,
      waiting: [],
      where: "machine",
    });
  });

  test("statusLines: the command's own words, from the same read", async () => {
    const world1 = world();
    const store = machineStore(world1.dir);
    await store.tryTake("heavy", record("bunx tsc --noEmit"));
    await store.enqueue(record("next build"));
    const read = await readJobs(world1.ctx);
    const lines = statusLines(read, world1.home, Date.UTC(2026, 9, 22, 12, 0, 0));
    expect(lines[0]).toBe("Memory: 32 GB.");
    expect(lines[1]).toBe(
      "Memory ceiling for all heavy jobs together: 10 GB (set in jobs.json), on cc-smart-dev-kit-heavy.slice. A job over it is stopped, and the memory kept for everything else stays free.",
    );
    expect(lines[2]).toBe(`CPU priority: not set: ${WEIGHT_DEFAULT("cpu")}`);
    expect(lines[3]).toBe(`Disk I/O priority: not set: ${WEIGHT_DEFAULT("io")}`);
    expect(lines[4]).toContain(": 1 of 3 slots in use");
    expect(lines[5]).toStartWith(
      "  this machine: a slot is held by my-host: build, bunx tsc --noEmit in /home/user/my-app, since ",
    );
    expect(lines[5]).toEndWith("(pid 4242)");
    expect(lines[6]).toStartWith(
      "  this machine: waits for a slot: my-host: build, next build in /home/user/my-app, since ",
    );
    expect(lines[6]).toEndWith("(pid 4242)");
    expect(lines[7]).toBe(
      `Heavy jobs at once on this machine: 3 (the default). Change it with: ${COMMAND} job set max-jobs <n>`,
    );
    expect(lines).toHaveLength(11);
  });

  test("a full machine: every slot in use, two jobs waiting in line order", async () => {
    const world1 = world();
    const store = machineStore(world1.dir);
    for (const what of ["tsc a", "tsc b", "tsc c"]) await store.tryTake("heavy", record(what));
    expect(await store.tryTake("heavy", record("tsc d"))).toBeNull();
    await store.enqueue(record("tsc d"));
    await store.enqueue(record("tsc e"));
    const read = await readJobs(world1.ctx);
    const lines = statusLines(read, world1.home, Date.UTC(2026, 9, 22, 12, 0, 0));
    expect(lines[4]).toContain(": 3 of 3 slots in use");
    expect(lines.filter((line) => line.includes("a slot is held by"))).toHaveLength(3);
    expect(lines.filter((line) => line.includes("waits for a slot"))).toHaveLength(2);
    const answer = jobsAnswer(read).stores[0];
    expect([answer?.slots, answer?.used, answer?.held.length, answer?.waiting.length]).toEqual([
      3, 3, 3, 2,
    ]);
  });

  test("who holds the slots and who waits are listed oldest first, whatever order the files are in", async () => {
    const world1 = world();
    const store = machineStore(world1.dir);
    const at = (hour: number) => Date.UTC(2026, 9, 22, hour, 0, 0);
    for (const [what, hour] of [
      ["c", 11],
      ["a", 9],
      ["b", 10],
    ] as const) {
      await store.tryTake("heavy", record(what, true, undefined, at(hour)));
    }
    for (const [what, hour] of [
      ["y", 13],
      ["x", 12],
    ] as const) {
      await store.enqueue(record(what, true, undefined, at(hour)));
    }
    const answer = jobsAnswer(await readJobs(world1.ctx)).stores[0];
    expect(answer?.held.map((job) => job.command)).toEqual(["a", "b", "c"]);
    expect(answer?.waiting.map((job) => job.command)).toEqual(["x", "y"]);
  });

  test("a name held alone is listed, and uses no slot", async () => {
    const world1 = world();
    const store = machineStore(world1.dir);
    await store.tryTake("none", record("docker build .", false, "image"), "image");
    const read = await readJobs(world1.ctx);
    const lines = statusLines(read, world1.home, Date.now());
    expect(lines[4]).toContain(": 0 of 3 slots in use");
    expect(lines[5]).toContain(
      "this machine: a name is held by my-host: build, exclusive image, docker build . in /home/user/my-app",
    );
    expect(jobsAnswer(read).stores[0]?.held[0]).toMatchObject({ exclusive: "image", slot: false });
    expect(jobsAnswer(read).stores[0]?.used).toBe(0);
  });

  test("maxJobs in jobs.json sets the slots, and the last line says where it comes from", async () => {
    const world1 = world({ maxJobs: 1 });
    const store = machineStore(world1.dir, 1);
    await store.tryTake("heavy", record("bunx tsc --noEmit"));
    const read = await readJobs(world1.ctx);
    const lines = statusLines(read, world1.home, Date.now());
    expect(lines[4]).toContain(": 1 of 1 slot in use");
    expect(lines.at(-4)).toBe(
      `Heavy jobs at once on this machine: 1 (set in jobs.json). Change it with: ${COMMAND} job set max-jobs <n>`,
    );
    expect(jobsAnswer(read).stores[0]?.slots).toBe(1);
  });

  // Mixed versions: an older `job run` left a lease that reserved 14 GB. It is one slot here.
  test("a lease an older plugin wrote counts as one slot", async () => {
    const world1 = world();
    writeFileSync(
      join(world1.dir, "leases", "older.json"),
      JSON.stringify({
        store: 1,
        gb: 14,
        holder: currentFileHolder(),
        record: record("bun run build"),
      }),
    );
    const read = await readJobs(world1.ctx);
    expect(jobsAnswer(read).stores[0]?.used).toBe(1);
    expect(statusLines(read, world1.home, Date.now())[4]).toContain(": 1 of 3 slots in use");
  });

  test("a shared folder shows its own count of slots from its max-jobs file", async () => {
    const world1 = world();
    const shared = join(world1.home, "shared");
    mkdirSync(join(shared, "leases"), { recursive: true });
    mkdirSync(join(shared, "tickets"), { recursive: true });
    writeFileSync(join(shared, "max-jobs"), "2\n");
    writeFileSync(
      join(world1.home, ".config", "cc-smart-dev-kit", "jobs.json"),
      `${JSON.stringify({ budgetGb: 10, sharedDirs: [shared] })}\n`,
    );
    const read = await readJobs(world1.ctx);
    const answer = jobsAnswer(read);
    expect(answer.stores.map((store) => [store.where, store.slots, store.used])).toEqual([
      ["machine", 3, 0],
      [shared, 2, 0],
    ]);
    const lines = statusLines(read, world1.home, Date.now());
    expect(lines).toContain(`Shared folder ${shared}: 0 of 2 slots in use`);
  });

  test("a jobs.json weight overrides the default, and 0 or off leaves systemd's own", async () => {
    const overridden = world({ cpuWeight: 50, ioWeight: 5 });
    const read = await readJobs(overridden.ctx);
    expect(read.weights.cpu).toEqual({ value: 50 });
    // io has no controller here, so its own value is not in force: the controller wins.
    expect(read.weights.io.value).toBeNull();
    expect(read.weights.io.why).toContain("was not given the io controller");
    const off = world({ cpuWeight: 0, ioWeight: "off" });
    const offRead = await readJobs(off.ctx);
    expect(offRead.weights.cpu).toEqual({ value: null, why: WEIGHT_DEFAULT("cpu") });
    expect(offRead.weights.io).toEqual({ value: null, why: WEIGHT_DEFAULT("io") });
    const plain = world({ cpuWeight: 50, launch: "plain" });
    const plainRead = await readJobs(plain.ctx);
    expect(plainRead.weights.cpu).toEqual({ value: null, why: "jobs.json sets launch: plain." });
    expect(plainRead.ceiling).toEqual({ gb: null, why: "jobs.json sets launch: plain." });
    expect(statusLines(plainRead, plain.home, Date.now())[1]).toBe(
      "Memory ceiling for heavy jobs: none: jobs.json sets launch: plain.",
    );
  });

  test("no user manager: the weights and the ceiling are not set, and the lines say so", async () => {
    const world1 = world({ cpuWeight: 50 });
    const noManager: JobContext = {
      ...world1.ctx,
      memory: {
        ...world1.ctx.memory,
        read: (path) => (path === "/proc/meminfo" ? MEMINFO : null),
      },
    };
    const read = await readJobs(noManager);
    expect(read.weights).toEqual({
      cpu: { value: null, why: "no systemd user manager answers here." },
      io: { value: null, why: WEIGHT_DEFAULT("io") },
    });
    expect(read.ceiling).toEqual({ gb: null, why: "no systemd user manager answers here." });
    expect(statusLines(read, world1.home, Date.now())).toContain(
      "CPU priority: not set: no systemd user manager answers here.",
    );
  });

  test("macOS and Windows: no slice, so no ceiling and no weight, said in their own words", async () => {
    const world1 = world({ cpuWeight: 50 });
    for (const [platform, ceiling] of [
      ["darwin", "only a Linux systemd user manager has a memory ceiling."],
      [
        "win32",
        "Windows has no memory group, so a heavy job runs as a plain child, and the queue is what keeps heavy jobs apart.",
      ],
    ] as const) {
      const read = await readJobs({
        ...world1.ctx,
        memory: { ...world1.ctx.memory, platform },
      });
      expect(read.ceiling).toEqual({ gb: null, why: ceiling });
      // A weight that is set cannot be carried here; one that is off says there is nothing to ask for.
      expect(read.weights.cpu).toEqual({ value: null, why: ceiling });
      expect(read.weights.io).toEqual({
        value: null,
        why: "only a Linux systemd user manager has weights.",
      });
    }
  });

  test("a store that cannot be read is one note, never a crash", async () => {
    const world1 = world();
    const missing = join(world1.home, "shared-not-there");
    writeFileSync(
      join(world1.home, ".config", "cc-smart-dev-kit", "jobs.json"),
      `${JSON.stringify({ budgetGb: 10, sharedDirs: [missing] })}\n`,
    );
    const read = await readJobs(world1.ctx);
    expect(read.notes.join("\n")).toContain(`The shared folder ${missing} is missing`);
    expect(statusLines(read, world1.home, Date.now())).toContain(
      `The shared folder ${missing} is missing: this job runs without its slots.`,
    );
  });

  test("a shared folder with only the old budget file is left out, with the fix named", async () => {
    const world1 = world();
    const shared = join(world1.home, "shared");
    mkdirSync(join(shared, "leases"), { recursive: true });
    mkdirSync(join(shared, "tickets"), { recursive: true });
    writeFileSync(join(shared, "budget"), "30\n");
    writeFileSync(
      join(world1.home, ".config", "cc-smart-dev-kit", "jobs.json"),
      `${JSON.stringify({ budgetGb: 10, sharedDirs: [shared] })}\n`,
    );
    const read = await readJobs(world1.ctx);
    expect(jobsAnswer(read).stores.map((store) => store.where)).toEqual(["machine"]);
    expect(read.notes).toEqual([
      `The shared folder ${shared} is left out: it has only the old budget file (GB), and the queue counts jobs now: write the number of heavy jobs at once, for every user of the folder, into ${join(shared, "max-jobs")} (a whole number, for example 3).`,
    ]);
  });

  test("a broken jobs.json is the reader's own refusal", async () => {
    const world1 = world();
    writeFileSync(join(world1.home, ".config", "cc-smart-dev-kit", "jobs.json"), "{not json");
    await expect(readJobs(world1.ctx)).rejects.toThrow("jobs.json");
  });

  test("the fingerprint changes when a file appears, changes or goes", () => {
    const world1 = world();
    const before = jobsFingerprint(world1.home);
    writeFileSync(join(world1.dir, "leases", "one.json"), record("a"));
    const appeared = jobsFingerprint(world1.home);
    expect(appeared).not.toBe(before);
    writeFileSync(join(world1.dir, "leases", "one.json"), record("bb"));
    expect(jobsFingerprint(world1.home)).not.toBe(appeared);
  });
});

// The route the Machine page and `job status` show is the one the `job-route` hook uses: the
// project's `jobs.route` when it sets one, else the person's `switches.jobRoute`, else off.
describe("the resolved job route", () => {
  const env = (home: string) => ({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });

  test("outside a project: the person's default, or off", async () => {
    const world1 = world();
    expect((await readJobs(world1.ctx)).route).toEqual({
      on: false,
      project: null,
      source: "default",
    });
    writePersonalWorkflow(env(world1.home), { switches: { jobRoute: true } });
    const read = await readJobs(world1.ctx);
    expect(read.route).toEqual({ on: true, project: null, source: "personal" });
    expect(statusLines(read, world1.home, Date.now()).at(-1)).toBe(
      "Job route for a project that sets none: on: a heavy Bash command waits for a slot in this queue (your own switches.jobRoute).",
    );
  });

  test("in a project: its jobs.route wins over the person's, in both directions", async () => {
    const world1 = world();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { jobs: { route: false } });
    writePersonalWorkflow(env(world1.home), { switches: { jobRoute: true } });
    const read = await readJobs({ ...world1.ctx, cwd: repo });
    expect(read.route).toEqual({ on: false, project: repo, source: "project" });
    expect(jobsAnswer(read).route).toEqual({ on: false, project: repo, source: "project" });
    expect(routeLine(read.route, world1.home)).toBe(
      `Job route in ${repo}: off: a heavy command runs raw, outside the queue (the project's jobs.route).`,
    );
    // A project that sets none takes the person's value.
    const silent = makeRepo();
    writeClaudeFile(silent, "cc-smart-dev-kit.json", {});
    expect((await readJobs({ ...world1.ctx, cwd: silent })).route).toEqual({
      on: true,
      project: silent,
      source: "personal",
    });
  });

  test("a project file that cannot be used is a note, and the person's default stands", async () => {
    const world1 = world();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { jobs: { route: "yes" } });
    const read = await readJobs({ ...world1.ctx, cwd: repo });
    expect(read.route).toEqual({ on: false, project: null, source: "default" });
    const note = read.notes.find((line) => line.startsWith("The job route here"));
    expect(note?.split(" Invalid ")[0]).toBe(
      "The job route here is not known: the project's file does not load, so the job-route hook asks before a heavy command there.",
    );
    // The parser's own reason follows, naming the file.
    expect(note).toContain(join(repo, ".claude", "cc-smart-dev-kit.json"));
  });
});
