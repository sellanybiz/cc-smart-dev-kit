/**
 * The heavy-job queue as data: the one reader `job status`, `/api/jobs` and the Machine page
 * all use (B6b). The status command's own lines are locked by `commands.test.ts`; this file
 * locks the shape and the lines built from it.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { userManagerCgroup } from "./memory";
import { holderText } from "./queue";
import type { JobContext } from "./status";
import { jobsAnswer, jobsFingerprint, readJobs, statusLines } from "./status";
import { leaseStore } from "./store";

/** The memory this machine reports: Linux's own fields, so the numbers are fixed. */
const MEMINFO = "MemTotal: 33554432 kB\nMemAvailable: 16777216 kB\n";

/** The user manager's delegated controllers, as this machine's file lists them: no io. */
const CONTROLLERS = `/sys/fs/cgroup${userManagerCgroup(process.getuid?.() ?? 0)}/cgroup.controllers`;

/** A job context on a temp home worth 32 GB, with 16 GB free. */
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
  };
  return { ctx, dir, home };
}

/** A holder record, as the queue writes one. */
function record(gb: number, what: string): string {
  return holderText({
    checkout: "/home/user/my-app",
    gb,
    kind: "build",
    person: "my-host",
    pid: 4242,
    since: Date.UTC(2026, 9, 22, 10, 0, 0),
    v: 1,
    what,
  });
}

describe("the jobs reader", () => {
  test("one held and one waiting, as the API's shape", async () => {
    const world1 = world();
    // The store's own writer makes the files, so the fixture is exactly what `job run` leaves.
    const store = leaseStore({
      capacityGb: () => 10,
      dir: world1.dir,
      label: "this machine",
      shared: false,
    });
    await store.tryTake(4, record(4, "bunx tsc --noEmit"));
    await store.enqueue(record(3, "next build"));
    const read = await readJobs(world1.ctx);
    expect(jobsAnswer(read)).toEqual({
      budgetGb: 10,
      freeGb: 16,
      keptGb: 22,
      memoryGb: 32,
      stores: [
        {
          budgetGb: 10,
          freeGb: 6,
          held: [
            {
              command: "bunx tsc --noEmit",
              folder: "/home/user/my-app",
              gb: 4,
              kind: "build",
              pid: 4242,
              since: "2026-10-22T10:00:00.000Z",
              user: "my-host",
            },
          ],
          waiting: [
            {
              command: "next build",
              folder: "/home/user/my-app",
              gb: 3,
              kind: "build",
              pid: 4242,
              since: "2026-10-22T10:00:00.000Z",
              user: "my-host",
            },
          ],
          where: "machine",
        },
      ],
      weights: {
        cpu: { value: 20 },
        io: {
          value: null,
          why: "the user manager was not given the io controller. An administrator adds io to Delegate= for user@.service, then restarts the user manager.",
        },
      },
    });
  });

  test("statusLines: the command's own words, from the same read", async () => {
    const world1 = world();
    const store = leaseStore({
      capacityGb: () => 10,
      dir: world1.dir,
      label: "this machine",
      shared: false,
    });
    await store.tryTake(4, record(4, "bunx tsc --noEmit"));
    const read = await readJobs(world1.ctx);
    const lines = statusLines(read, world1.home, Date.UTC(2026, 9, 22, 12, 0, 0));
    expect(lines[0]).toBe("Memory: 32 GB, 16 GB free now.");
    expect(lines[1]).toBe("Budget for heavy jobs here: 10 GB (set in jobs.json).");
    expect(lines[2]).toBe(
      "CPU priority: weight 20 on cc-smart-dev-kit-heavy.slice and the slices above it (systemd's default is 100; the desktop and the sessions go first under load).",
    );
    expect(lines[3]).toBe(
      "Disk I/O priority: not set: the user manager was not given the io controller. An administrator adds io to Delegate= for user@.service, then restarts the user manager.",
    );
    expect(lines[4]).toContain(": 6 of 10 GB free");
    expect(lines[5]).toContain(
      "4 GB held by my-host: build, bunx tsc --noEmit in /home/user/my-app",
    );
    expect(lines[5]).toContain("(pid 4242)");
    expect(lines).toHaveLength(6);
  });

  test("a jobs.json weight overrides the default, and 0 or off leaves systemd's own", async () => {
    const overridden = world({ cpuWeight: 50, ioWeight: 5 });
    const read = await readJobs(overridden.ctx);
    expect(read.weights.cpu).toEqual({ value: 50 });
    // io has no controller here, so its own value is not in force: the controller wins.
    expect(read.weights.io.value).toBeNull();
    const off = world({ cpuWeight: 0, ioWeight: "off" });
    const offRead = await readJobs(off.ctx);
    expect(offRead.weights.cpu).toEqual({ value: null, why: "jobs.json turns it off." });
    expect(offRead.weights.io).toEqual({ value: null, why: "jobs.json turns it off." });
    const plain = world({ launch: "plain" });
    expect((await readJobs(plain.ctx)).weights.cpu).toEqual({
      value: null,
      why: "jobs.json sets launch: plain.",
    });
  });

  test("no user manager: the weights are not set, and the line says so", async () => {
    const world1 = world();
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
      io: { value: null, why: "no systemd user manager answers here." },
    });
    expect(statusLines(read, world1.home, Date.now())).toContain(
      "CPU priority: not set: no systemd user manager answers here.",
    );
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
      `The shared folder ${missing} is missing: this job runs without its budget.`,
    );
  });

  test("a broken jobs.json is the reader's own refusal", async () => {
    const world1 = world();
    writeFileSync(join(world1.home, ".config", "cc-smart-dev-kit", "jobs.json"), "{not json");
    await expect(readJobs(world1.ctx)).rejects.toThrow("jobs.json");
  });

  test("the fingerprint changes when a file appears, changes or goes", () => {
    const world1 = world();
    const before = jobsFingerprint(world1.home);
    writeFileSync(join(world1.dir, "leases", "one.json"), record(1, "a"));
    const appeared = jobsFingerprint(world1.home);
    expect(appeared).not.toBe(before);
    writeFileSync(join(world1.dir, "leases", "one.json"), record(2, "b"));
    expect(jobsFingerprint(world1.home)).not.toBe(appeared);
  });
});
