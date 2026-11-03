import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { holderText } from "./queue";
import {
  type JobContext,
  jobsAnswer,
  jobsFingerprint,
  openStores,
  readJobs,
  statusLines,
} from "./status";

function world(): JobContext {
  const home = tempDir("jobs-status");
  return {
    paths: cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }),
    cwd: home,
    execArgv: [],
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
    stores: [{ where: "machine", slots: 1, used: 0, held: [], waiting: [] }],
  });
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
