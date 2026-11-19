import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { fakeLimitFacts } from "../testing/limit-facts";
import { tempDir } from "../testing/temp";
import { jobsPaths } from "./config";
import type { LimitFacts } from "./limits";
import { holderText } from "./queue";
import {
  type JobContext,
  jobsAnswer,
  jobsFingerprint,
  openStores,
  readJobs,
  statusLines,
} from "./status";

function world(limits: LimitFacts = fakeLimitFacts().facts): JobContext {
  const home = tempDir("jobs-status");
  return {
    paths: cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }),
    cwd: home,
    execArgv: [],
    limits,
    say: () => {},
    print: () => {},
  };
}
test("status ignores even a malformed old jobs.json", async () => {
  const ctx = world();
  const config = join(ctx.paths.home, ".config", "cc-smart-dev-kit");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "jobs.json"), "{");
  expect(jobsAnswer(await readJobs(ctx))).toEqual({
    route: { on: false, source: "default", project: null },
    stores: [
      {
        where: "machine",
        slots: 1,
        used: 0,
        held: [],
        waiting: [],
        note: "Heavy-job limit: 1 (default). Heavy-job caps: CPU 90%, memory 90% (default)",
      },
    ],
  });
});

// The CPU and memory caps are in the status note, which `job status`, `/api/jobs` and the
// Machine page all read: no new field.
test("the note carries the caps on Linux, and nothing about them elsewhere", async () => {
  const file = (ctx: JobContext) => jobsPaths(ctx.paths.home).configFile;
  const linux = world();
  mkdirSync(join(file(linux), ".."), { recursive: true });
  writeFileSync(file(linux), '{"cpuPercent":50}');
  expect(jobsAnswer(await readJobs(linux)).stores[0]?.note).toBe(
    `Heavy-job limit: 1 (default). Heavy-job caps: CPU 50%, memory 90% (${file(linux)})`,
  );
  const mac = world(fakeLimitFacts({ platform: "darwin" }).facts);
  expect(jobsAnswer(await readJobs(mac)).stores[0]?.note).toBe("Heavy-job limit: 1 (default)");
});

test("a bad cap shows as off, with its key, and never stops the status", async () => {
  const ctx = world();
  const file = jobsPaths(ctx.paths.home).configFile;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, '{"memoryPercent":7}');
  const [store] = jobsAnswer(await readJobs(ctx)).stores;
  expect(store?.slots).toBe(1);
  expect(store?.note).toBe(
    `Heavy-job limit: 1 (default). Heavy-job caps: off, ${file}: memoryPercent must be an integer from 10 to 100`,
  );
});

// The portal polls `readJobs`: it must never start a program or ask systemd.
test("reading the jobs never probes systemd", async () => {
  const { facts } = fakeLimitFacts();
  const refuse = (name: string) => () => {
    throw new Error(`${name} must not be called`);
  };
  const ctx = world({
    ...facts,
    cpuCount: refuse("cpuCount"),
    hasProgram: refuse("hasProgram"),
    oomdRunning: refuse("oomdRunning"),
    systemd: refuse("systemd"),
    systemdText: refuse("systemdText"),
  });
  await readJobs(ctx);
  expect(await readJobs(ctx)).toBeDefined();
});
/** A waiting job's record: `what` tells the jobs apart in the status lines. */
const waitingRecord = (what: string, since: number) =>
  holderText({
    checkout: "/repo",
    kind: "build",
    person: "host",
    pid: process.pid,
    since,
    slot: true,
    v: 1,
    what,
  });

/** The `what` of each waiting line `job status` prints, in order. */
async function waitingOrder(ctx: JobContext): Promise<string[]> {
  return statusLines(await readJobs(ctx), ctx.paths.home, 0)
    .filter((line) => line.startsWith("  waiting:"))
    .map((line) => (line.match(/, (\w+) in \/repo/) ?? [])[1] ?? line);
}

// The order the queue serves them in (`decide`): oldest first, an equal start by the ticket's
// token, a record nobody can read last. `job status` shows the same order, so the place a
// waiting line prints ("3rd in line") is the place `job status` lists.
test("status lists waiting jobs in the order the queue serves them", async () => {
  const ctx = world();
  const store = openStores(ctx).machine;
  const tickets = [
    await store.enqueue(waitingRecord("third", 3000)),
    await store.enqueue("not a record"),
    await store.enqueue(waitingRecord("first", 1000)),
    await store.enqueue(waitingRecord("second", 2000)),
  ];
  try {
    expect(await waitingOrder(ctx)).toEqual([
      "first",
      "second",
      "third",
      "  waiting: unknown holder",
    ]);
  } finally {
    for (const ticket of tickets) ticket?.release();
  }
});
test("status breaks a tie between equal start times by the ticket token, as the queue does", async () => {
  const ctx = world();
  const store = openStores(ctx).machine;
  const a = await store.enqueue(waitingRecord("a", 1000));
  const b = await store.enqueue(waitingRecord("b", 1000));
  try {
    const tokens = new Map(
      (await store.waiting()).map((unit) => [unit.tie, JSON.parse(unit.text).what as string]),
    );
    // Written by hand: the smaller token is served first.
    const expected = [...tokens.keys()].sort().map((tie) => tokens.get(tie));
    expect(await waitingOrder(ctx)).toEqual(expected as string[]);
  } finally {
    a?.release();
    b?.release();
  }
});
test("status and fingerprint show the holder and waiting job", async () => {
  const ctx = world();
  const store = openStores(ctx).machine;
  const record = holderText({
    checkout: "/repo",
    kind: "build",
    person: "host",
    pid: process.pid,
    since: 1000,
    slot: true,
    v: 1,
    what: "build",
  });
  const before = jobsFingerprint(ctx.paths.home);
  const lease = await store.tryTake(true, record);
  const ticket = await store.enqueue(record);
  try {
    const read = await readJobs(ctx);
    const answer = jobsAnswer(read);
    expect(answer.stores[0]?.used).toBe(1);
    expect(answer.stores[0]?.waiting[0]?.command).toBe("build");
    expect(answer.stores[0]?.held[0]?.since).toBe("1970-01-01T00:00:01.000Z");
    expect(statusLines(read, ctx.paths.home, 1000).join("\n")).toContain(
      "Heavy jobs: 1 of 1 slot in use",
    );
    expect(jobsFingerprint(ctx.paths.home)).not.toBe(before);
  } finally {
    lease?.release();
    ticket?.release();
  }
});
