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
  addWorkerQuestion,
  answerWorkerQuestion,
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
  workerBriefFile,
  workerEventsFile,
  workerFile,
  workerFilesDir,
  workerReportFile,
  workerSettingsFile,
  workerStoreDir,
  writeLead,
  writeReport,
  writeStoreFile,
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
    baseRef: "release-1.0.0",
    branch: "wk/K-contracts",
    effort: "xhigh",
    files: ["src/workers/store.ts"],
    id,
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: LEAD,
    memoryMb: null,
    model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
    name: "W my-app K contracts",
    permissionMode: "auto",
    phase: "K",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    questions: [],
    reportPath: null,
    repo,
    sessionId: null,
    shortId: null,
    slug: "contracts",
    state: "queued",
    waitsFor: [],
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
    expect(workerFilesDir(state, REPO, "wk-K-contracts")).toBe(
      join(dir, "files", "wk-K-contracts"),
    );
    expect(workerBriefFile(state, REPO, "wk-K-contracts")).toBe(
      join(dir, "files", "wk-K-contracts", "brief.md"),
    );
    expect(workerSettingsFile(state, REPO, "wk-K-contracts")).toBe(
      join(dir, "files", "wk-K-contracts", "settings.json"),
    );
  });

  test("a worker's own file: 0600 in a 0700 folder, written whole", () => {
    const state = tempDir("state");
    const file = workerBriefFile(state, REPO, "wk-K-contracts");
    writeStoreFile(file, "the brief\n");
    writeStoreFile(file, "the brief, again\n");
    expect(readFileSync(file, "utf8")).toBe("the brief, again\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    expect(() => workerFilesDir(state, REPO, "../x")).toThrow(WorkerStoreError);
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

  test("the phases a worker waits for are part of its record", async () => {
    const state = tempDir("state");
    await createWorker(state, { ...queued(), waitsFor: ["B6a", "B7"] }, T0);
    expect(readWorker(state, REPO, "wk-K-contracts")?.waitsFor).toEqual(["B6a", "B7"]);
  });
});

describe("D36: a worker's questions", () => {
  test("D36: a question goes at the end of its list, with no answer, and is one question event", async () => {
    const state = tempDir("state");
    await createWorker(state, { ...queued(), state: "working" }, T0);
    const after = await addWorkerQuestion(
      state,
      REPO,
      "wk-K-contracts",
      { options: ["Keep the field", "Drop it"], question: "Keep the old field?", recommended: 1 },
      T1,
    );
    expect(after.questions).toEqual([
      {
        answer: null,
        answeredAt: null,
        askedAt: "2026-10-21T10:05:00.000Z",
        options: ["Keep the field", "Drop it"],
        question: "Keep the old field?",
        recommended: 1,
      },
    ]);
    expect(after.state).toBe("working");
    expect(readWorkerEvents(state, REPO).events.at(-1)).toEqual({
      at: "2026-10-21T10:05:00.000Z",
      lead: LEAD,
      name: "W my-app K contracts",
      state: "working",
      text: "Keep the old field?",
      type: "question",
      version: 1,
      worker: "wk-K-contracts",
    });
  });

  test("D36: the lead's answer is recorded once, with its time, and is no event", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    const asked = { options: ["a", "b"], question: "Which one?", recommended: null };
    await addWorkerQuestion(state, REPO, "wk-K-contracts", asked, T0);
    const answered = await answerWorkerQuestion(state, REPO, "wk-K-contracts", 0, "b", T1);
    expect(answered.questions[0]).toMatchObject({
      answer: "b",
      answeredAt: "2026-10-21T10:05:00.000Z",
    });
    expect(readWorkerEvents(state, REPO).events.map((one) => one.type)).toEqual([
      "created",
      "question",
    ]);
    await expect(answerWorkerQuestion(state, REPO, "wk-K-contracts", 0, "a", T1)).rejects.toThrow(
      'question 0 of worker "wk-K-contracts" has its answer already',
    );
    await expect(answerWorkerQuestion(state, REPO, "wk-K-contracts", 1, "a", T1)).rejects.toThrow(
      'worker "wk-K-contracts" has no question 1',
    );
  });

  test("D36: a question with one option, or a recommendation it does not hold, is never written", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    await expect(
      addWorkerQuestion(
        state,
        REPO,
        "wk-K-contracts",
        { options: ["only"], question: "Go?", recommended: null },
        T1,
      ),
    ).rejects.toThrow("questions.0.options: Too small: expected array to have >=2 items");
    await expect(
      addWorkerQuestion(
        state,
        REPO,
        "wk-K-contracts",
        { options: ["a", "b"], question: "Go?", recommended: 3 },
        T1,
      ),
    ).rejects.toThrow("questions.0.recommended: recommends option 3 of 2");
    expect(readWorker(state, REPO, "wk-K-contracts")?.questions).toEqual([]);
    expect(readWorkerEvents(state, REPO).events.map((one) => one.type)).toEqual(["created"]);
  });

  test("D36: an answer without its time is a broken record", () => {
    const state = tempDir("state");
    const file = workerFile(state, REPO, "wk-K-contracts");
    mkdirSync(dirname(file), { recursive: true });
    const question = {
      answer: "b",
      answeredAt: null,
      askedAt: "2026-10-21T10:00:00.000Z",
      options: ["a", "b"],
      question: "Which one?",
      recommended: null,
    };
    writeFileSync(
      file,
      JSON.stringify({
        ...queued(),
        createdAt: "x",
        questions: [question],
        updatedAt: "x",
        version: 1,
      }),
    );
    expect(() => readWorker(state, REPO, "wk-K-contracts")).toThrow(
      "questions.0.answeredAt: an answer and its time are given together",
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
      model: {
        named: "opus",
        profile: "fast",
        resolved: "claude-opus-5-5",
        slot: null,
        tier: "opus",
      },
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

describe("what a paused worker waits for", () => {
  const SLOT_WAIT = {
    kind: "slot",
    since: "2026-10-21T21:05:00.000Z",
    slot: "cc-smart-dev-kit-worker",
  } as const;
  const LIMIT_WAIT = {
    kind: "claude-limit",
    model: "claude-opus-5-5",
    resetsAt: "2026-10-21T19:40:00.000Z",
  } as const;

  /** A record on disk as a kit wrote it, written by hand: `extra` is merged into it. */
  function onDisk(state: string, extra: Record<string, unknown>, id = "wk-K-contracts") {
    const file = workerFile(state, REPO, id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        ...queued(id),
        createdAt: "2026-10-21T10:00:00.000Z",
        updatedAt: "2026-10-21T10:00:00.000Z",
        version: 1,
        ...extra,
      }),
    );
    return file;
  }

  test("a record from before the field reads as it was: no waitingFor appears", () => {
    const state = tempDir("state");
    onDisk(state, { state: "paused" });
    const read = readWorker(state, REPO, "wk-K-contracts");
    expect(read?.state).toBe("paused");
    expect(read).not.toHaveProperty("waitingFor");
  });

  test("a worker pauses on its slot: the state, the wait, and one state event", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    await updateWorker(
      state,
      REPO,
      "wk-K-contracts",
      { state: "paused", waitingFor: SLOT_WAIT },
      T1,
      "worker slot limited since 21:05",
    );
    const saved = JSON.parse(readFileSync(workerFile(state, REPO, "wk-K-contracts"), "utf8"));
    expect(saved.state).toBe("paused");
    expect(saved.waitingFor).toEqual({
      kind: "slot",
      since: "2026-10-21T21:05:00.000Z",
      slot: "cc-smart-dev-kit-worker",
    });
    expect(readWorker(state, REPO, "wk-K-contracts")?.waitingFor).toEqual(SLOT_WAIT);
    expect(
      readWorkerEvents(state, REPO).events.map((one) => [one.type, one.state, one.text]),
    ).toEqual([
      ["created", "queued", null],
      ["state", "paused", "worker slot limited since 21:05"],
    ]);
  });

  test("or on Claude's own limit, with the reset time or with none", async () => {
    const state = tempDir("state");
    await createWorker(state, queued("wk-a"), T0);
    await createWorker(state, queued("wk-b"), T0);
    await updateWorker(state, REPO, "wk-a", { state: "paused", waitingFor: LIMIT_WAIT }, T1);
    await updateWorker(
      state,
      REPO,
      "wk-b",
      {
        state: "paused",
        waitingFor: { kind: "claude-limit", model: "claude-fable-5-1", resetsAt: null },
      },
      T1,
    );
    expect(readWorker(state, REPO, "wk-a")?.waitingFor).toEqual({
      kind: "claude-limit",
      model: "claude-opus-5-5",
      resetsAt: "2026-10-21T19:40:00.000Z",
    });
    expect(readWorker(state, REPO, "wk-b")?.waitingFor).toEqual({
      kind: "claude-limit",
      model: "claude-fable-5-1",
      resetsAt: null,
    });
  });

  test("when the worker goes on, the wait is cleared and leaves nothing in the file", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    await updateWorker(
      state,
      REPO,
      "wk-K-contracts",
      { state: "paused", waitingFor: SLOT_WAIT },
      T0,
    );
    await updateWorker(
      state,
      REPO,
      "wk-K-contracts",
      { state: "working", waitingFor: undefined },
      T1,
      "slot answers again",
    );
    const saved = JSON.parse(readFileSync(workerFile(state, REPO, "wk-K-contracts"), "utf8"));
    expect(saved.state).toBe("working");
    expect(Object.keys(saved)).not.toContain("waitingFor");
    expect(readWorker(state, REPO, "wk-K-contracts")).not.toHaveProperty("waitingFor");
  });

  test("a change that does not touch it leaves it as it was", async () => {
    const state = tempDir("state");
    await createWorker(state, queued(), T0);
    await updateWorker(
      state,
      REPO,
      "wk-K-contracts",
      { state: "paused", waitingFor: SLOT_WAIT },
      T0,
    );
    await updateWorker(state, REPO, "wk-K-contracts", { lastLine: "still waiting" }, T1);
    expect(readWorker(state, REPO, "wk-K-contracts")?.waitingFor).toEqual(SLOT_WAIT);
  });

  test("a field a newer kit added inside the wait is kept when this kit writes the record", async () => {
    const state = tempDir("state");
    const newer = { ...SLOT_WAIT, targets: ["omniroute:glm-5.3-flash"] };
    onDisk(state, { state: "paused", version: 2, waitingFor: newer });
    await updateWorker(state, REPO, "wk-K-contracts", { lastLine: "x" }, T1);
    const saved = JSON.parse(readFileSync(workerFile(state, REPO, "wk-K-contracts"), "utf8"));
    expect(saved.waitingFor).toEqual(newer);
    expect(saved.version).toBe(2);
  });

  test("a wait with a field missing, an empty text or a kind this kit does not know is a broken record, named", async () => {
    const state = tempDir("state");
    const fail = (extra: Record<string, unknown>, id: string) => {
      const file = onDisk(state, extra, id);
      return { file, read: () => readWorker(state, REPO, id) };
    };
    const noSlot = fail(
      { waitingFor: { kind: "slot", since: "2026-10-21T21:05:00.000Z" } },
      "wk-a",
    );
    expect(noSlot.read).toThrow(
      `Invalid ${noSlot.file}: waitingFor.slot: Invalid input: expected string, received undefined`,
    );
    const noReset = fail(
      { waitingFor: { kind: "claude-limit", model: "claude-opus-5-5" } },
      "wk-b",
    );
    expect(noReset.read).toThrow(
      `Invalid ${noReset.file}: waitingFor.resetsAt: Invalid input: expected string, received undefined`,
    );
    const empty = fail({ waitingFor: { kind: "slot", since: "t", slot: "" } }, "wk-c");
    expect(empty.read).toThrow(
      `Invalid ${empty.file}: waitingFor.slot: Too small: expected string to have >=1 characters`,
    );
    const unknown = fail({ waitingFor: { kind: "account-switch" } }, "wk-d");
    expect(unknown.read).toThrow(
      `Invalid ${unknown.file}: waitingFor.kind: Invalid discriminator value. Expected 'slot' | 'claude-limit'`,
    );
    // A list names each broken one and goes on with the good ones.
    onDisk(state, { waitingFor: SLOT_WAIT, state: "paused" }, "wk-good");
    const listed = listWorkers(state, REPO);
    expect(listed.records.map((one) => one.id)).toEqual(["wk-good"]);
    expect(listed.broken.map((one) => one.file).sort()).toEqual(
      [noSlot.file, noReset.file, empty.file, unknown.file].sort(),
    );
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
      tag: "my-app",
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

  test("the subagents it waits to wake are recorded, and recording the lead again keeps them", async () => {
    const state = tempDir("state");
    const lead = {
      cwd: REPO,
      name: "LEAD my-app master-plan",
      plan: ".claude/plans/master-plan.md",
      repo: REPO,
      sessionId: LEAD,
      tag: "my-app",
    };
    // A lead from before the field has no list.
    const plain = await writeLead(state, lead, T0);
    expect(plain).not.toHaveProperty("pausedAgents");
    expect(JSON.parse(readFileSync(leadFile(state, REPO, LEAD), "utf8"))).not.toHaveProperty(
      "pausedAgents",
    );
    // The lead's notes record the ids of the subagents that stopped on an API error.
    const paused = await writeLead(state, { ...lead, pausedAgents: ["a1b2c3d4", "e5f6a7b8"] }, T1);
    expect(paused.pausedAgents).toEqual(["a1b2c3d4", "e5f6a7b8"]);
    expect(JSON.parse(readFileSync(leadFile(state, REPO, LEAD), "utf8")).pausedAgents).toEqual([
      "a1b2c3d4",
      "e5f6a7b8",
    ]);
    // `worker lead` run again records the lead with no list of its own: the ids stay.
    const again = await writeLead(state, { ...lead, plan: ".claude/plans/next.md" }, T1);
    expect(again.pausedAgents).toEqual(["a1b2c3d4", "e5f6a7b8"]);
    // An empty list is a list: the lead resumed every one.
    const done = await writeLead(state, { ...lead, pausedAgents: [] }, T1);
    expect(readLead(state, REPO, LEAD)?.pausedAgents).toEqual([]);
    expect(done.createdAt).toBe("2026-10-21T10:00:00.000Z");
  });

  test("an id that is empty, or a list that is not a list, is refused and nothing is written", async () => {
    const state = tempDir("state");
    const lead = {
      cwd: REPO,
      name: "LEAD my-app master-plan",
      plan: ".claude/plans/master-plan.md",
      repo: REPO,
      sessionId: LEAD,
      tag: "my-app",
    };
    await writeLead(state, lead, T0);
    const file = leadFile(state, REPO, LEAD);
    const before = readFileSync(file, "utf8");
    await expect(writeLead(state, { ...lead, pausedAgents: [""] }, T1)).rejects.toThrow(
      `Invalid ${file}: pausedAgents.0: Too small: expected string to have >=1 characters`,
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    // Written by hand as something else, a read throws and names the field.
    writeFileSync(file, JSON.stringify({ ...JSON.parse(before), pausedAgents: "a1b2c3d4" }));
    expect(() => readLead(state, REPO, LEAD)).toThrow(
      `Invalid ${file}: pausedAgents: Invalid input: expected array, received string`,
    );
  });

  test("a lead whose session id is not a plain file name is refused", async () => {
    const state = tempDir("state");
    await expect(
      writeLead(
        state,
        { cwd: REPO, name: "LEAD x y", plan: "p", repo: REPO, sessionId: "../x", tag: "x" },
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
