import { expect, test } from "bun:test";
import type { LimitedStart, ScopeHandle } from "./limits";
import { type JobDeps, type JobRequest, runJob } from "./run";

const request: JobRequest = {
  checkout: "/repo",
  command: ["build"],
  kind: "build",
  pid: 1,
  slot: true,
};
const scope: ScopeHandle = { kill: () => "ok", isEmpty: () => true };
function world(overrides: Partial<JobDeps> = {}) {
  const events: string[] = [];
  const deps: JobDeps = {
    isNested: async () => false,
    ancestorHoldsName: async () => false,
    acquire: async () => {
      events.push("acquire");
      return { waitedSince: null, release: () => events.push("release") };
    },
    limits: () => {
      events.push("limits");
      return { on: false, line: null };
    },
    now: () => 1000,
    run: async (argv, runScope) => {
      events.push(`${argv.join(" ")}${runScope === null ? "" : " [scope]"}`);
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
  expect(events).toEqual(["acquire", "limits", "build", "release"]);
});
test("releases the slot if the launcher throws", async () => {
  const { events, deps } = world({
    run: async () => {
      throw new Error("spawn failed");
    },
  });
  await expect(runJob(request, deps)).rejects.toThrow("spawn failed");
  expect(events).toEqual(["acquire", "limits", "release"]);
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
    "limits",
    "Heavy job starts after 1 s: build",
    "build",
    "Heavy job ended: build, exit 7 after 0 s",
  ]);
});

// The limits (`limits.ts`): a queued job starts in its scope, when the limits can apply.
const limited = (
  memoryLine: Extract<LimitedStart, { on: true }>["memoryLine"],
  release: () => void = () => undefined,
): LimitedStart => ({
  on: true,
  argv: ["systemd-run", "--scope", "--", "build"],
  scope,
  memoryLine,
  release,
});

test("with the limits on, the job starts in its scope, and the scope is handed to the launcher", async () => {
  const { events, deps } = world({
    limits: (job) => {
      events.push(`limits ${job.kind} ${job.pid} ${job.command.join(" ")}`);
      return limited(() => null);
    },
  });
  expect(await runJob(request, deps)).toBe(7);
  expect(events).toEqual([
    "acquire",
    "limits build 1 build",
    "systemd-run --scope -- build [scope]",
    "release",
  ]);
});

test("the limits are got ready after the slot is held, never while the job waits", async () => {
  const { events, deps } = world();
  await runJob(request, deps);
  expect(events.indexOf("acquire")).toBeLessThan(events.indexOf("limits"));
});

test("with the limits off, the reason is said once and the job runs as it would have", async () => {
  const { events, deps } = world({
    limits: () => ({ on: false, line: "this job runs without CPU and memory limits: why" }),
  });
  expect(await runJob(request, deps)).toBe(7);
  expect(events).toEqual([
    "acquire",
    "this job runs without CPU and memory limits: why",
    "build",
    "release",
  ]);
});

test("a nested job, and a run with no slot, never get a second scope", async () => {
  let asked = 0;
  const limits = () => {
    asked += 1;
    return limited(() => null);
  };
  const nested = world({ isNested: async () => true, limits });
  await runJob(request, nested.deps);
  const named = world({ limits });
  await runJob({ ...request, slot: false, exclusive: "db" }, named.deps);
  expect(asked).toBe(0);
  expect(nested.events).toEqual(["build"]);
  expect(named.events).toEqual(["acquire", "build", "release"]);
});

test("a memory line comes after the run and before the ended line, and is handed the job's end", async () => {
  let seen: unknown = null;
  const { events, deps } = world({
    limits: () =>
      limited((end) => {
        seen = end;
        return "killed for memory: x";
      }),
  });
  deps.acquire = async () => ({ waitedSince: 0, release: () => {} });
  expect(await runJob(request, deps)).toBe(7);
  expect(seen).toEqual({ code: 7, signal: null, leftovers: false, sentOn: false });
  expect(events).toEqual([
    "Heavy job starts after 1 s: build",
    "systemd-run --scope -- build [scope]",
    "killed for memory: x",
    "Heavy job ended: build, exit 7 after 0 s",
  ]);
});

test("no memory line: nothing is said", async () => {
  const { events, deps } = world({ limits: () => limited(() => null) });
  await runJob(request, deps);
  expect(events).toEqual(["acquire", "systemd-run --scope -- build [scope]", "release"]);
});

// A scope that is not cleared is a unit left behind (a failed one until it is reset: proved live), so a started
// job clears its scope once, after the memory line has read it, however the job ended.
test("the scope is released once, after the memory line read it and before the slot is given back", async () => {
  const { events, deps } = world({
    limits: () =>
      limited(
        () => {
          events.push("memory line read");
          return null;
        },
        () => events.push("scope released"),
      ),
  });
  await runJob(request, deps);
  expect(events).toEqual([
    "acquire",
    "systemd-run --scope -- build [scope]",
    "memory line read",
    "scope released",
    "release",
  ]);
});

test("the scope is released when the launcher throws, and not when the limits are off", async () => {
  const { events, deps } = world({
    limits: () =>
      limited(
        () => null,
        () => events.push("scope released"),
      ),
    run: async () => {
      throw new Error("spawn failed");
    },
  });
  await expect(runJob(request, deps)).rejects.toThrow("spawn failed");
  expect(events).toEqual(["acquire", "scope released", "release"]);
  const off = world();
  await runJob(request, off.deps);
  expect(off.events).not.toContain("scope released");
});
