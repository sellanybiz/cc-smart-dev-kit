/**
 * The worker store (`store.ts`): the worker and lead records, the events log and the hand-back
 * report — where each lives, what a write leaves on disk, and what a reader makes of a record a
 * newer kit wrote.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import {
  appendWorkerEvent,
  createWorker,
  type HandBackReport,
  isKnownState,
  leadFile,
  listAllWorkers,
  listLeads,
  listWorkers,
  type NewWorker,
  readLead,
  readReport,
  readWorker,
  readWorkerEvents,
  updateWorker,
  WORKER_STATES,
  WORKER_STORE_VERSION,
  WorkerStoreError,
  workerEventsFile,
  workerFile,
  workerReportFile,
  workerStoreDir,
  writeLead,
  writeReport,
} from "./store";

const REPO = "/home/user/my-app";
const OTHER = "/home/user/other-app";
const LEAD = "11111111-2222-3333-4444-555555555555";
const SESSION = "66666666-7777-8888-9999-000000000000";
const SHA = "a".repeat(40);
const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const T1 = Date.parse("2026-10-21T10:05:00.000Z");

/** The repo key, worked out here the way the review record names it. */
function key(repo: string): string {
  return createHash("sha256").update(repo).digest("hex").slice(0, 16);
}

/** A queued worker as the launcher would record it. */
function queued(id = "wk-K-contracts", repo = REPO): NewWorker {
  return {
    base: null,
    branch: "wk/K-contracts",
    effort: "xhigh",
    files: ["src/workers/store.ts"],
    id,
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: LEAD,
    memoryMb: null,
    model: { named: "opus", resolved: "claude-opus-5-5", slot: null },
    name: "W my-app K contracts",
    permissionMode: "auto",
    phase: "K",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    reportPath: null,
    repo,
    sessionId: null,
    shortId: null,
    slug: "contracts",
    state: "queued",
    worktree: `${repo}/.claude/worktrees/wk-K-contracts`,
  };
}

/** A whole hand-back report: a finished phase. */
function report(): HandBackReport {
  return {
    base: { ref: "release-1.0.0", sha: SHA },
    branch: { name: "wk/K-contracts", sha: "b".repeat(40) },
    changed: { deletions: 12, files: 9, insertions: 640 },
    checks: [
      { name: "typecheck", note: null, ok: true },
      { name: "lint", note: null, ok: true },
    ],
    docs: ["docs/design.md"],
    needsLead: ["the Layout row for src/workers/"],
    open: [],
    outsideBrief: [],
    phase: "K",
    pr: null,
    question: null,
    review: {
      agent: "cc-smart-dev-kit:reviewer",
      effort: "xhigh",
      findings: [{ finding: "a lock is missing", fix: "the write holds the store's lock" }],
      model: "opus",
      sha: "b".repeat(40),
    },
    status: "done",
    tests: {
      full: { command: "bun test", failed: 0, ok: true, passed: 3000 },
      targeted: [{ command: "bun test src/workers", failed: 0, ok: true, passed: 40 }],
    },
    version: WORKER_STORE_VERSION,
  };
}

describe("where the store lives", () => {
  test("one folder per repository, by the review record's repo key, under the state folder", () => {
    const state = tempDir("state");
    const dir = join(state, "workers", key(REPO));
    expect(workerStoreDir(state, REPO)).toBe(dir);
    expect(workerFile(state, REPO, "wk-K-contracts")).toBe(
      join(dir, "workers", "wk-K-contracts.json"),
    );
    expect(leadFile(state, REPO, LEAD)).toBe(join(dir, "leads", `${LEAD}.json`));
    expect(workerEventsFile(state, REPO)).toBe(join(dir, "events.jsonl"));
    expect(workerReportFile(state, REPO, "wk-K-contracts")).toBe(
      join(dir, "reports", "wk-K-contracts.json"),
    );
  });

  test("an id that is not a plain file name never becomes a path", () => {
    const state = tempDir("state");
    for (const bad of ["../x", "a/b", ".hidden", "", "a b"]) {
      expect(() => workerFile(state, REPO, bad)).toThrow(WorkerStoreError);
      expect(() => leadFile(state, REPO, bad)).toThrow(WorkerStoreError);
    }
  });
});

describe("the worker record", () => {
  test("a new worker: the record, 0600 in a 0700 folder, and a created event", async () => {
    const state = tempDir("state");
    const made = await createWorker(state, queued(), T0);
    const file = workerFile(state, REPO, "wk-K-contracts");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      ...queued(),
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T10:00:00.000Z",
      version: 1,
    });
    expect(made).toEqual(JSON.parse(readFileSync(file, "utf8")));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    expect(statSync(workerStoreDir(state, REPO)).mode & 0o777).toBe(0o700);
    expect(readWorkerEvents(state, REPO).events).toEqual([
      {
        at: "2026-10-21T10:00:00.000Z",
        lead: LEAD,
        name: "W my-app K contracts",
        state: "queued",
        text: null,
        type: "created",
        version: 1,
        worker: "wk-K-contracts",
      },
    ]);
  });

  test("an id already recorded is refused, and the first record stays", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    await expect(
      createWorker(state, { ...queued(), name: "W my-app K other" }, T1),
    ).rejects.toThrow('a worker "wk-K-contracts" is already recorded for /home/user/my-app');
    expect(readWorker(state, REPO, "wk-K-contracts")?.name).toBe("W my-app K contracts");
  });

  test("a record that breaks the schema is never written", async () => {
    const state = tempDir("state");
    await expect(createWorker(state, { ...queued(), branch: "" }, T0)).rejects.toThrow(
      "branch: Too small: expected string to have >=1 characters",
    );
    expect(listWorkers(state, REPO)).toEqual({ broken: [], records: [] });
  });

  test("an update: the fields change, updatedAt moves, and a state change is one event", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    const after = await updateWorker(
      state,
      REPO,
      "wk-K-contracts",
      { sessionId: SESSION, shortId: "66666666", state: "starting" },
      T1,
      "started",
    );
    expect(after).toMatchObject({
      createdAt: "2026-10-21T10:00:00.000Z",
      sessionId: SESSION,
      shortId: "66666666",
      state: "starting",
      updatedAt: "2026-10-21T10:05:00.000Z",
    });
    expect(readWorker(state, REPO, "wk-K-contracts")).toEqual(after);
    // No state change: no event.
    await updateWorker(state, REPO, "wk-K-contracts", { lastLine: "tests green" }, T1);
    expect(
      readWorkerEvents(state, REPO).events.map((one) => [one.type, one.state, one.text]),
    ).toEqual([
      ["created", "queued", null],
      ["state", "starting", "started"],
    ]);
  });

  test("an update never moves who the worker is, even when an untyped caller names it", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    const change = JSON.parse(
      '{"id":"wk-other","repo":"/home/user/other-app","createdAt":"2020-01-01T00:00:00.000Z","state":"working"}',
    );
    const after = await updateWorker(state, REPO, "wk-K-contracts", change, T1);
    expect(after).toMatchObject({
      createdAt: "2026-10-21T10:00:00.000Z",
      id: "wk-K-contracts",
      repo: REPO,
      state: "working",
    });
  });

  test("an update of a worker nobody recorded throws", async () => {
    const state = tempDir("state");
    await expect(updateWorker(state, REPO, "wk-none", { state: "working" }, T0)).rejects.toThrow(
      'no worker "wk-none" is recorded for /home/user/my-app',
    );
  });

  test("a write waits for the store's lock and keeps what the holder wrote", async () => {
    // Two writers at once (a lead and a worker reporting): the second one's read-modify-write
    // must not drop the first one's change. The holder here is exactly what another writer —
    // another process — would be.
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    const file = workerFile(state, REPO, "wk-K-contracts");
    let pending: Promise<unknown> | null = null;
    await withLock(workerStoreDir(state, REPO), async () => {
      pending = updateWorker(state, REPO, "wk-K-contracts", { lastLine: "tests green" }, T1);
      // The other writer finishes its own change while it holds the lock.
      const held = { ...JSON.parse(readFileSync(file, "utf8")), memoryMb: 420 };
      writeFileSync(file, JSON.stringify(held));
      // Let the waiting write try at least once: it must still be waiting.
      await Bun.sleep(150);
      expect(readWorker(state, REPO, "wk-K-contracts")?.lastLine).toBeNull();
    });
    await pending;
    expect(readWorker(state, REPO, "wk-K-contracts")).toMatchObject({
      lastLine: "tests green",
      memoryMb: 420,
    });
  });

  test("the lock is the store's own, not the state folder's shared one", async () => {
    const state = tempDir("state");
    // Holding the shared state lock (setup, update, restore) must not hold up a worker's write.
    await withLock(state, async () => {
      await createWorker(state, queued(), T0);
    });
    expect(readWorker(state, REPO, "wk-K-contracts")?.state).toBe("queued");
  });
});

describe("a record a newer kit wrote", () => {
  test("is read without error: unknown fields kept, an unknown state read as itself", async () => {
    const state = tempDir("state");
    const file = workerFile(state, REPO, "wk-K-contracts");
    mkdirSync(dirname(file), { recursive: true });
    const newer = {
      ...queued(),
      createdAt: "2026-10-21T10:00:00.000Z",
      kind: "research",
      model: { named: "opus", profile: "fast", resolved: "claude-opus-5-5", slot: null },
      queueTicket: 7,
      state: "parked",
      updatedAt: "2026-10-21T10:00:00.000Z",
      version: 2,
    };
    writeFileSync(file, `${JSON.stringify(newer, null, 2)}\n`);
    const read = readWorker(state, REPO, "wk-K-contracts");
    expect(read).toEqual(newer);
    expect(read?.state).toBe("parked");
    expect(isKnownState("parked")).toBe(false);

    // An update by this kit keeps what it does not know, and the newer version number.
    const after = await updateWorker(state, REPO, "wk-K-contracts", { lastLine: "x" }, T1);
    expect(after).toEqual({ ...newer, lastLine: "x", updatedAt: "2026-10-21T10:05:00.000Z" });
  });

  test("the twelve states this kit knows", () => {
    expect(WORKER_STATES).toEqual([
      "queued",
      "starting",
      "working",
      "blocked",
      "paused",
      "quiet",
      "done",
      "failed",
      "stopped",
      "handoff",
      "merged",
      "removed",
    ]);
    for (const state of WORKER_STATES) expect(isKnownState(state)).toBe(true);
  });
});

describe("reading the store", () => {
  test("a missing record is null; a broken one throws, naming the file and the field", () => {
    const state = tempDir("state");
    expect(readWorker(state, REPO, "wk-none")).toBeNull();
    const file = workerFile(state, REPO, "wk-bad");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    expect(() => readWorker(state, REPO, "wk-bad")).toThrow(`Invalid ${file}: not valid JSON`);
    writeFileSync(file, JSON.stringify({ ...queued("wk-bad"), version: 1 }));
    expect(() => readWorker(state, REPO, "wk-bad")).toThrow(
      `Invalid ${file}: createdAt: Invalid input: expected string, received undefined`,
    );
  });

  test("a list holds every record it can read, oldest first, and names each broken one", async () => {
    const state = tempDir("state");
    await createWorker(state, queued("wk-b"), T1);
    await createWorker(state, queued("wk-a"), T0);
    const broken = workerFile(state, REPO, "wk-broken");
    writeFileSync(broken, "[]");
    // A temp file of an atomic write in flight, and a stray file: neither is a record.
    writeFileSync(join(dirname(broken), ".wk-c.json.cc-smart-dev-kit-tmp-1-x"), "{");
    writeFileSync(join(dirname(broken), "notes.txt"), "x");
    const listed = listWorkers(state, REPO);
    expect(listed.records.map((one) => one.id)).toEqual(["wk-a", "wk-b"]);
    expect(listed.broken).toEqual([
      {
        file: broken,
        why: `Invalid ${broken}: (top level): Invalid input: expected object, received array`,
      },
    ]);
  });

  test("an empty store lists nothing; every repository's workers are listed together", async () => {
    const state = tempDir("state");
    expect(listWorkers(state, REPO)).toEqual({ broken: [], records: [] });
    expect(listAllWorkers(state)).toEqual({ broken: [], records: [] });
    await createWorker(state, queued("wk-a", REPO), T1);
    await createWorker(state, queued("wk-b", OTHER), T0);
    expect(listAllWorkers(state).records.map((one) => [one.id, one.repo])).toEqual([
      ["wk-b", OTHER],
      ["wk-a", REPO],
    ]);
  });
});

describe("the lead record", () => {
  test("a lead is recorded by its session id; recording it again keeps its start", async () => {
    const state = tempDir("state");
    const lead = {
      cwd: REPO,
      name: "LEAD my-app master-plan",
      plan: ".claude/plans/master-plan.md",
      repo: REPO,
      sessionId: LEAD,
    };
    await writeLead(state, lead, T0);
    const again = await writeLead(state, { ...lead, plan: ".claude/plans/next.md" }, T1);
    expect(again).toEqual({
      ...lead,
      createdAt: "2026-10-21T10:00:00.000Z",
      plan: ".claude/plans/next.md",
      updatedAt: "2026-10-21T10:05:00.000Z",
      version: 1,
    });
    expect(readLead(state, REPO, LEAD)).toEqual(again);
    expect(statSync(leadFile(state, REPO, LEAD)).mode & 0o777).toBe(0o600);
    expect(listLeads(state, REPO)).toEqual({ broken: [], records: [again] });
    expect(readLead(state, REPO, SESSION)).toBeNull();
  });

  test("a lead whose session id is not a plain file name is refused", async () => {
    const state = tempDir("state");
    await expect(
      writeLead(
        state,
        { cwd: REPO, name: "LEAD x y", plan: "p", repo: REPO, sessionId: "../x" },
        T0,
      ),
    ).rejects.toThrow(WorkerStoreError);
  });
});

describe("the events log", () => {
  test("a reader goes on from its offset, and never takes half a line", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    const first = readWorkerEvents(state, REPO);
    expect(first.events.map((one) => one.type)).toEqual(["created"]);
    await appendWorkerEvent(
      state,
      REPO,
      {
        lead: LEAD,
        name: "W my-app K contracts",
        state: "working",
        text: "tests-green",
        type: "step",
        worker: "wk-K-contracts",
      },
      T1,
    );
    const file = workerEventsFile(state, REPO);
    // A writer that stopped half way: the reader leaves that line for later.
    const torn = '{"version":1,"at":"2026-10-21T10:06:00.000Z"';
    appendFileSync(file, torn);
    const next = readWorkerEvents(state, REPO, first.offset);
    expect(next.events).toEqual([
      {
        at: "2026-10-21T10:05:00.000Z",
        lead: LEAD,
        name: "W my-app K contracts",
        state: "working",
        text: "tests-green",
        type: "step",
        version: 1,
        worker: "wk-K-contracts",
      },
    ]);
    expect(next.offset).toBe(readFileSync(file).length - torn.length);
    expect(readWorkerEvents(state, REPO, next.offset)).toEqual({
      events: [],
      offset: next.offset,
      skipped: 0,
    });
  });

  test("a line it cannot read is skipped and counted; a newer event is read as itself", async () => {
    const state = tempDir("state");
    const file = workerEventsFile(state, REPO);
    mkdirSync(dirname(file), { recursive: true });
    const newer = {
      at: "2026-10-21T10:00:00.000Z",
      lead: null,
      name: "W my-app K contracts",
      queue: 3,
      state: "parked",
      text: null,
      type: "requeued",
      version: 2,
      worker: "wk-K-contracts",
    };
    writeFileSync(file, `not json\n${JSON.stringify(newer)}\n{"version":1}\n`);
    const read = readWorkerEvents(state, REPO);
    expect(read.events).toEqual([newer]);
    expect(read.skipped).toBe(2);
    expect(read.offset).toBe(readFileSync(file).length);
  });

  test("a file shorter than the offset was replaced: it is read from the start", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    expect(readWorkerEvents(state, REPO, 1_000_000).events.map((one) => one.type)).toEqual([
      "created",
    ]);
  });

  test("no log yet: nothing, at offset 0", () => {
    expect(readWorkerEvents(tempDir("state"), REPO)).toEqual({ events: [], offset: 0, skipped: 0 });
  });
});

describe("the hand-back report", () => {
  test("written whole, 0600, and read back as written", async () => {
    const state = tempDir("state");
    const file = await writeReport(state, REPO, "wk-K-contracts", report());
    expect(file).toBe(workerReportFile(state, REPO, "wk-K-contracts"));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(report());
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readReport(file)).toEqual(report());
    expect(readReport(join(dirname(file), "none.json"))).toBeNull();
  });

  test("a blocked report carries the question it is blocked on", async () => {
    const state = tempDir("state");
    await expect(
      writeReport(state, REPO, "wk-K-contracts", { ...report(), status: "blocked" }),
    ).rejects.toThrow("question: a blocked report names the question it waits on");
    const file = await writeReport(state, REPO, "wk-K-contracts", {
      ...report(),
      question: "Which branch does the lead merge first?",
      status: "blocked",
    });
    expect(readReport(file)?.question).toBe("Which branch does the lead merge first?");
  });

  test("a newer kit's report is read with what it adds", () => {
    const file = join(tempDir("state"), "report.json");
    const newer = { ...report(), cost: { tokens: 1 }, status: "split", version: 2 };
    writeFileSync(file, JSON.stringify(newer));
    expect(readReport(file)).toEqual(newer);
  });
});
