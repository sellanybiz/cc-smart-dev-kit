import { expect, test } from "bun:test";
import { type JobDeps, type JobRequest, runJob } from "./run";

const request: JobRequest = {
  checkout: "/repo",
  command: ["build"],
  kind: "build",
  pid: 1,
  slot: true,
};
function world(overrides: Partial<JobDeps> = {}) {
  const events: string[] = [];
  const deps: JobDeps = {
    isNested: async () => false,
    ancestorHoldsName: async () => false,
    acquire: async () => {
      events.push("acquire");
      return { waitedSince: null, release: () => events.push("release") };
    },
    now: () => 1000,
    run: async (argv) => {
      events.push(argv.join(" "));
      return { code: 7, signal: null, leftovers: false, sentOn: false };
    },
    say: (line) => events.push(line),
    ...overrides,
  };
  return { events, deps };
}
test("runs the exact command once and releases the slot on exit", async () => {
  const { events, deps } = world();
  expect(await runJob(request, deps)).toBe(7);
  expect(events).toEqual(["acquire", "build", "release"]);
});
test("releases the slot if the launcher throws", async () => {
  const { events, deps } = world({
    run: async () => {
      throw new Error("spawn failed");
    },
  });
  await expect(runJob(request, deps)).rejects.toThrow("spawn failed");
  expect(events).toEqual(["acquire", "release"]);
});
test("nested heavy jobs run directly instead of waiting for their parent", async () => {
  const { events, deps } = world({ isNested: async () => true });
  expect(await runJob(request, deps)).toBe(7);
  expect(events).toEqual(["build"]);
});
test("named-file jobs never consult nesting or acquire a slot", async () => {
  const { events, deps } = world({
    isNested: async () => {
      throw new Error("must not read store");
    },
  });
  expect(await runJob({ ...request, slot: false }, deps)).toBe(7);
  expect(events).toEqual(["build"]);
});
test("a stopped reservation never starts a child", async () => {
  let stopped = false;
  const { events, deps } = world({ stopped: () => stopped });
  deps.acquire = async () => {
    stopped = true;
    return { waitedSince: null, release: () => events.push("release") };
  };
  expect(await runJob(request, deps)).toBe(1);
  expect(events).toEqual(["release"]);
});
test("a job that waited reports its own exit status", async () => {
  const { events, deps } = world();
  deps.acquire = async () => ({ waitedSince: 0, release: () => {} });
  expect(await runJob(request, deps)).toBe(7);
  expect(events).toEqual([
    "Heavy job starts after 1 s: build",
    "build",
    "Heavy job ended: build, exit 7 after 0 s",
  ]);
});
