import { expect, test } from "bun:test";
import { tempDir } from "../testing/temp";
import {
  acquireFrom,
  decide,
  holderText,
  type ParsedEntry,
  parseHolder,
  type QueuedJob,
  WaitStoppedError,
} from "./queue";
import { leaseStore } from "./store";

const entry = (mine: boolean, since: number): ParsedEntry => ({
  mine,
  since,
  tie: String(since),
  exclusive: null,
  slot: true,
  person: "host",
});
const job: QueuedJob = {
  checkout: "/repo",
  kind: "build",
  pid: process.pid,
  slot: true,
  what: "build",
};

test("the machine has exactly one heavy slot", () => {
  expect(
    decide({
      exclusive: null,
      slot: true,
      held: [{ holder: null, slot: true }],
      line: [entry(true, 0)],
    }),
  ).toEqual({ wait: { kind: "no-room", capacity: 1 } });
});
test("oldest ticket wins, with stable tie breaking", () => {
  expect(
    decide({ exclusive: null, slot: true, held: [], line: [entry(false, 1), entry(true, 2)] }),
  ).toEqual({ wait: { kind: "behind" } });
  expect(
    decide({ exclusive: null, slot: true, held: [], line: [entry(true, 1), entry(false, 2)] }),
  ).toEqual({ take: true });
});
test("holder records round trip and invalid input is unknown", () => {
  const holder = {
    checkout: "/repo",
    kind: "build",
    person: "host",
    pid: 1,
    since: 1,
    slot: true,
    v: 1 as const,
    what: "build",
  };
  expect(parseHolder(holderText(holder))).toEqual(holder);
  expect(parseHolder("{")).toBeNull();
});
test("takes one lease, waits, then releases idempotently", async () => {
  const store = leaseStore({ dir: tempDir("jobs-queue"), label: "machine" });
  const first = await acquireFrom([store], job, { person: "host", onWaiting: () => {} });
  let slept = false;
  const lines: string[] = [];
  const second = await acquireFrom([store], job, {
    person: "host",
    onWaiting: (line) => lines.push(line),
    sleep: async () => {
      slept = true;
      first.release();
    },
  });
  expect(slept).toBe(true);
  expect(lines[0]).toContain("only slot is taken");
  expect(await store.held()).toHaveLength(1);
  second.release();
  second.release();
  expect(await store.held()).toEqual([]);
  expect(await store.waiting()).toEqual([]);
});
test("a stopped wait releases its ticket, not another job's slot", async () => {
  const store = leaseStore({ dir: tempDir("jobs-stop"), label: "machine" });
  const first = await acquireFrom([store], job, { person: "host", onWaiting: () => {} });
  const stop = new AbortController();
  try {
    await expect(
      acquireFrom([store], job, {
        person: "host",
        signal: stop.signal,
        onWaiting: () => {},
        sleep: async () => stop.abort(),
      }),
    ).rejects.toBeInstanceOf(WaitStoppedError);
    expect(await store.waiting()).toEqual([]);
    expect(await store.held()).toHaveLength(1);
  } finally {
    first.release();
  }
});
test("store errors fail closed", async () => {
  const store = leaseStore({ dir: tempDir("jobs-error"), label: "machine" });
  store.held = async () => {
    throw new Error("unreadable");
  };
  await expect(acquireFrom([store], job, { person: "host", onWaiting: () => {} })).rejects.toThrow(
    "unreadable",
  );
  expect(await store.waiting()).toEqual([]);
});
