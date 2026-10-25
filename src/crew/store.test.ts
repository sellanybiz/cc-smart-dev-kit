/**
 * The crew store (`store.ts`): the crew session and lead records, the events log and the hand-back
 * report — where each lives, what a write leaves on disk, and what a reader makes of a record a
 * newer kit wrote.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isOwnerOnly } from "../setup/file-mode";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import {
  addCrewQuestion,
  answerCrewQuestion,
  appendCrewEvent,
  CREW_STATES,
  CREW_STORE_VERSION,
  CrewStoreError,
  createCrew,
  crewBriefFile,
  crewEventsFile,
  crewFile,
  crewFilesDir,
  crewOfWorktree,
  crewReportFile,
  crewSettingsFile,
  crewStoreDir,
  type HandBackReport,
  isKnownState,
  isQuestionOpen,
  leadFile,
  listAllCrew,
  listAllLeads,
  listCrew,
  listLeads,
  markAnswerDelivered,
  type NewCrew,
  openQuestionIndex,
  questionClosed,
  readCrew,
  readCrewEvents,
  readLead,
  readReport,
  updateCrew,
  updateCrewIfState,
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

/** True on native Windows, where a file's mode says nothing: the profile's ACL protects it. */
const NO_POSIX_MODES = process.platform === "win32";

/** The repo key, worked out here the way the review record names it. */
function key(repo: string): string {
  return createHash("sha256").update(repo).digest("hex").slice(0, 16);
}

/** A queued crew session as the launcher would record it. */
function queued(id = "crew-K-contracts", repo = REPO): NewCrew {
  return {
    base: null,
    baseRef: "release-1.0.0",
    branch: "crew/K-contracts",
    effort: "xhigh",
    files: ["src/crew/store.ts"],
    id,
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: LEAD,
    memoryMb: null,
    model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
    name: "C my-app K contracts",
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
    worktree: `${repo}/.claude/worktrees/crew-K-contracts`,
  };
}

/** A whole hand-back report: a finished phase. */
function report(): HandBackReport {
  return {
    base: { ref: "release-1.0.0", sha: SHA },
    branch: { name: "crew/K-contracts", sha: "b".repeat(40) },
    changed: { deletions: 12, files: 9, insertions: 640 },
    checks: [
      { name: "typecheck", note: null, ok: true },
      { name: "lint", note: null, ok: true },
    ],
    docs: ["docs/design.md"],
    needsLead: ["the Layout row for src/crew/"],
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
      targeted: [{ command: "bun test src/crew", failed: 0, ok: true, passed: 40 }],
    },
    version: CREW_STORE_VERSION,
  };
}

describe("where the store lives", () => {
  test("one folder per repository, by the review record's repo key, under the state folder", () => {
    const state = tempDir("state");
    const dir = join(state, "crew", key(REPO));
    expect(crewStoreDir(state, REPO)).toBe(dir);
    expect(crewFile(state, REPO, "crew-K-contracts")).toBe(
      join(dir, "crew", "crew-K-contracts.json"),
    );
    expect(leadFile(state, REPO, LEAD)).toBe(join(dir, "leads", `${LEAD}.json`));
    expect(crewEventsFile(state, REPO)).toBe(join(dir, "events.jsonl"));
    expect(crewReportFile(state, REPO, "crew-K-contracts")).toBe(
      join(dir, "reports", "crew-K-contracts.json"),
    );
    expect(crewFilesDir(state, REPO, "crew-K-contracts")).toBe(
      join(dir, "files", "crew-K-contracts"),
    );
    expect(crewBriefFile(state, REPO, "crew-K-contracts")).toBe(
      join(dir, "files", "crew-K-contracts", "brief.md"),
    );
    expect(crewSettingsFile(state, REPO, "crew-K-contracts")).toBe(
      join(dir, "files", "crew-K-contracts", "settings.json"),
    );
  });

  test("a crew session's own file is written whole", () => {
    const state = tempDir("state");
    const file = crewBriefFile(state, REPO, "crew-K-contracts");
    writeStoreFile(file, "the brief\n");
    writeStoreFile(file, "the brief, again\n");
    expect(readFileSync(file, "utf8")).toBe("the brief, again\n");
    expect(() => crewFilesDir(state, REPO, "../x")).toThrow(CrewStoreError);
  });

  test.skipIf(NO_POSIX_MODES)("a crew session's own file is 0600 in a 0700 folder", () => {
    // On Windows a mode is not protection: the profile's ACL is (docs/windows-setup.md). The
    // write itself is checked above, on every platform.
    const state = tempDir("state");
    const file = crewBriefFile(state, REPO, "crew-K-contracts");
    writeStoreFile(file, "the brief\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
  });

  test("an id that is not a plain file name never becomes a path", () => {
    const state = tempDir("state");
    for (const bad of ["../x", "a/b", ".hidden", "", "a b"]) {
      expect(() => crewFile(state, REPO, bad)).toThrow(CrewStoreError);
      expect(() => leadFile(state, REPO, bad)).toThrow(CrewStoreError);
    }
  });
});

describe("the crew record", () => {
  test("a new crew session: the record and a created event", async () => {
    const state = tempDir("state");
    const made = await createCrew(state, queued(), T0);
    const file = crewFile(state, REPO, "crew-K-contracts");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      ...queued(),
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T10:00:00.000Z",
      version: 1,
    });
    expect(made).toEqual(JSON.parse(readFileSync(file, "utf8")));
    expect(readCrewEvents(state, REPO).events).toEqual([
      {
        at: "2026-10-21T10:00:00.000Z",
        lead: LEAD,
        name: "C my-app K contracts",
        state: "queued",
        text: null,
        type: "created",
        version: 1,
        crew: "crew-K-contracts",
      },
    ]);
  });

  test.skipIf(NO_POSIX_MODES)("a new crew session's record is 0600 in a 0700 folder", async () => {
    // On Windows the profile's ACL protects the file, not its mode (docs/windows-setup.md).
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const file = crewFile(state, REPO, "crew-K-contracts");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    expect(statSync(crewStoreDir(state, REPO)).mode & 0o777).toBe(0o700);
  });

  test("an id already recorded is refused, and the first record stays", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    await expect(createCrew(state, { ...queued(), name: "C my-app K other" }, T1)).rejects.toThrow(
      'a crew session "crew-K-contracts" is already recorded for /home/user/my-app',
    );
    expect(readCrew(state, REPO, "crew-K-contracts")?.name).toBe("C my-app K contracts");
  });

  test("a record that breaks the schema is never written", async () => {
    const state = tempDir("state");
    await expect(createCrew(state, { ...queued(), branch: "" }, T0)).rejects.toThrow(
      "branch: Too small: expected string to have >=1 characters",
    );
    expect(listCrew(state, REPO)).toEqual({ broken: [], records: [] });
  });

  test("an update: the fields change, updatedAt moves, and a state change is one event", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const after = await updateCrew(
      state,
      REPO,
      "crew-K-contracts",
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
    expect(readCrew(state, REPO, "crew-K-contracts")).toEqual(after);
    // No state change: no event.
    await updateCrew(state, REPO, "crew-K-contracts", { lastLine: "tests green" }, T1);
    expect(
      readCrewEvents(state, REPO).events.map((one) => [one.type, one.state, one.text]),
    ).toEqual([
      ["created", "queued", null],
      ["state", "starting", "started"],
    ]);
  });

  test("an update never moves who the crew session is, even when an untyped caller names it", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const change = JSON.parse(
      '{"id":"crew-other","repo":"/home/user/other-app","createdAt":"2020-01-01T00:00:00.000Z","state":"working"}',
    );
    const after = await updateCrew(state, REPO, "crew-K-contracts", change, T1);
    expect(after).toMatchObject({
      createdAt: "2026-10-21T10:00:00.000Z",
      id: "crew-K-contracts",
      repo: REPO,
      state: "working",
    });
  });

  test("an update of a crew session nobody recorded throws", async () => {
    const state = tempDir("state");
    await expect(updateCrew(state, REPO, "crew-none", { state: "working" }, T0)).rejects.toThrow(
      'no crew session "crew-none" is recorded for /home/user/my-app',
    );
  });

  test("the phases a crew session waits for are part of its record", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), waitsFor: ["B6a", "B7"] }, T0);
    expect(readCrew(state, REPO, "crew-K-contracts")?.waitsFor).toEqual(["B6a", "B7"]);
  });

  test("RX1: a change of the session keeps the earlier ones, oldest first, once each", async () => {
    const state = tempDir("state");
    const first = "aaaaaaaa-0000-1111-2222-333333333333";
    const second = "bbbbbbbb-0000-1111-2222-333333333333";
    const third = "cccccccc-0000-1111-2222-333333333333";
    await createCrew(
      state,
      { ...queued(), sessionId: first, shortId: "aaaaaaaa", state: "working" },
      T0,
    );
    const id = "crew-K-contracts";
    expect(readCrew(state, REPO, id)?.earlierSessions).toBeUndefined();
    // A write that does not change the session adds nothing.
    await updateCrew(state, REPO, id, { lastLine: "hi" }, T1);
    expect(readCrew(state, REPO, id)?.earlierSessions).toBeUndefined();
    await updateCrew(state, REPO, id, { sessionId: second, shortId: "bbbbbbbb" }, T1);
    await updateCrew(state, REPO, id, { sessionId: second, shortId: "bbbbbbbb" }, T1);
    await updateCrew(state, REPO, id, { sessionId: third, shortId: "cccccccc" }, T1);
    const record = readCrew(state, REPO, id);
    expect(record?.sessionId).toBe(third);
    expect(record?.earlierSessions).toEqual([
      { sessionId: first, shortId: "aaaaaaaa" },
      { sessionId: second, shortId: "bbbbbbbb" },
    ]);
  });

  test("H101: a conditional change is written while the state is the one judged, with its event", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "starting" }, T0);
    const result = await updateCrewIfState(
      state,
      REPO,
      "crew-K-contracts",
      ["starting"],
      { state: "working" },
      T1,
      "started in its worktree",
    );
    expect(result.changed).toBe(true);
    expect(result.record.state).toBe("working");
    expect(readCrew(state, REPO, "crew-K-contracts")?.state).toBe("working");
    expect(
      readCrewEvents(state, REPO).events.map((one) => [one.type, one.state, one.text]),
    ).toEqual([
      ["created", "starting", null],
      ["state", "working", "started in its worktree"],
    ]);
  });

  test("H101: the launcher's failed is not overwritten by a working a hook judged earlier", async () => {
    // The hook read `starting`; the launcher recorded `failed` before the hook's write. The write
    // reads the state again under the lock and does nothing.
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "starting" }, T0);
    await updateCrew(state, REPO, "crew-K-contracts", { state: "failed" }, T1, "it failed");
    const before = readCrew(state, REPO, "crew-K-contracts");
    const result = await updateCrewIfState(
      state,
      REPO,
      "crew-K-contracts",
      ["starting"],
      { state: "working" },
      T1 + 1000,
      "started in its worktree",
    );
    expect(result.changed).toBe(false);
    expect(result.record).toEqual(before as NonNullable<typeof before>);
    expect(readCrew(state, REPO, "crew-K-contracts")?.state).toBe("failed");
    expect(
      readCrewEvents(state, REPO).events.filter((one) => one.state === "working"),
    ).toHaveLength(0);
  });

  test("H101: the watch's merged is not overwritten by a failed a hook judged earlier", async () => {
    // The hook read an open record; the watch recorded `merged` before the hook's write. A phase
    // that waits for this one reads `merged`, so the write must not land.
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "working" }, T0);
    await updateCrew(state, REPO, "crew-K-contracts", { state: "merged" }, T1, "merged");
    const result = await updateCrewIfState(
      state,
      REPO,
      "crew-K-contracts",
      ["starting", "working", "blocked", "paused", "quiet"],
      { state: "failed" },
      T1 + 1000,
      "its session is in /home/user/my-app, not in its worktree",
    );
    expect(result.changed).toBe(false);
    expect(readCrew(state, REPO, "crew-K-contracts")?.state).toBe("merged");
    expect(readCrewEvents(state, REPO).events.filter((one) => one.state === "failed")).toHaveLength(
      0,
    );
  });

  test("D62: the crew session a worktree belongs to: a removed record names nothing, the newest live one wins", async () => {
    const state = tempDir("state");
    const path = `${REPO}/.claude/worktrees/crew-K-contracts`;
    await createCrew(state, { ...queued("crew-K-1"), state: "removed", worktree: path }, T0);
    const list = () => listCrew(state, REPO).records;
    // Only a removed record is at that path: its worktree is gone, so a folder there is not its own.
    expect(crewOfWorktree(list(), path)).toBeNull();
    // The phase was started again in the same folder: the live one is the owner.
    await createCrew(state, { ...queued("crew-K-2"), state: "working", worktree: path }, T1);
    expect(crewOfWorktree(list(), path)?.id).toBe("crew-K-2");
    await createCrew(state, { ...queued("crew-K-3"), state: "done", worktree: path }, T1 + 1000);
    expect(crewOfWorktree(list(), path)?.id).toBe("crew-K-3");
    // Any other folder has none.
    expect(crewOfWorktree(list(), `${REPO}/.claude/worktrees/crew-other`)).toBeNull();
  });

  test("D62: a crew session the lead merged after it was stopped is the lead's to remove", async () => {
    // The store keeps the fact from the state the record was in, so no later pass can forget it.
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "stopped" }, T0);
    await updateCrew(state, REPO, "crew-K-contracts", { state: "merged" }, T1, "merged");
    expect(readCrew(state, REPO, "crew-K-contracts")).toMatchObject({
      mergedWhileStopped: true,
      state: "merged",
    });
    // Written again as merged, it stays marked.
    await updateCrew(state, REPO, "crew-K-contracts", { state: "merged" }, T1 + 1000);
    expect(readCrew(state, REPO, "crew-K-contracts")?.mergedWhileStopped).toBe(true);
    // Any other crew session that is merged carries no such mark.
    await createCrew(state, { ...queued("crew-L-other"), state: "done" }, T0);
    await updateCrew(state, REPO, "crew-L-other", { state: "merged" }, T1, "merged");
    expect(readCrew(state, REPO, "crew-L-other")?.mergedWhileStopped).toBeUndefined();
  });
});

describe("D36: a crew session's questions", () => {
  test("D36: a question goes at the end of its list, with no answer, and is one question event", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "working" }, T0);
    const after = await addCrewQuestion(
      state,
      REPO,
      "crew-K-contracts",
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
    expect(readCrewEvents(state, REPO).events.at(-1)).toEqual({
      at: "2026-10-21T10:05:00.000Z",
      lead: LEAD,
      name: "C my-app K contracts",
      state: "working",
      text: "Keep the old field?",
      type: "question",
      version: 1,
      crew: "crew-K-contracts",
    });
  });

  test("D36: the lead's answer is recorded once, with its time, and is no event", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const asked = { options: ["a", "b"], question: "Which one?", recommended: null };
    await addCrewQuestion(state, REPO, "crew-K-contracts", asked, T0);
    const answered = await answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "b", T1);
    expect(answered.questions[0]).toMatchObject({
      answer: "b",
      answeredAt: "2026-10-21T10:05:00.000Z",
    });
    expect(readCrewEvents(state, REPO).events.map((one) => one.type)).toEqual([
      "created",
      "question",
    ]);
    await expect(answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "a", T1)).rejects.toThrow(
      'question 0 of crew session "crew-K-contracts" has its answer already',
    );
    await expect(answerCrewQuestion(state, REPO, "crew-K-contracts", 1, "a", T1)).rejects.toThrow(
      'crew "crew-K-contracts" has no question 1',
    );
  });

  test("AN1: an answer is recorded, not delivered, until a delivery marks it — once", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const asked = { options: ["a", "b"], question: "Which one?", recommended: null };
    await addCrewQuestion(state, REPO, "crew-K-contracts", asked, T0);
    const answered = await answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "b", T1);
    expect(answered.questions[0]?.deliveredAt ?? null).toBeNull();
    // The first delivery claims it; a second finds it taken.
    const claimed = await markAnswerDelivered(state, REPO, "crew-K-contracts", 0, T1 + 1000);
    expect(claimed).toMatchObject({ answer: "b", deliveredAt: "2026-10-21T10:05:01.000Z" });
    expect(await markAnswerDelivered(state, REPO, "crew-K-contracts", 0, T1 + 2000)).toBeNull();
    const [record] = listCrew(state, REPO).records;
    expect(record?.questions[0]?.deliveredAt).toBe("2026-10-21T10:05:01.000Z");
  });

  test("AN1: an answer given as a resume's prompt is delivered in the same write", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const asked = { options: ["a", "b"], question: "Which one?", recommended: null };
    await addCrewQuestion(state, REPO, "crew-K-contracts", asked, T0);
    const answered = await answerCrewQuestion(
      state,
      REPO,
      "crew-K-contracts",
      0,
      "b",
      T1,
      null,
      null,
      {
        delivered: true,
      },
    );
    expect(answered.questions[0]).toMatchObject({
      answer: "b",
      deliveredAt: "2026-10-21T10:05:00.000Z",
    });
  });

  test("AN1: a correction keeps the first answer as superseded and needs a delivery of its own", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const asked = { options: ["a", "b"], question: "Which one?", recommended: null };
    await addCrewQuestion(state, REPO, "crew-K-contracts", asked, T0);
    await answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "a", T1);
    await markAnswerDelivered(state, REPO, "crew-K-contracts", 0, T1 + 1000);
    const corrected = await answerCrewQuestion(
      state,
      REPO,
      "crew-K-contracts",
      0,
      "b",
      T1 + 5000,
      null,
      null,
      { correction: true },
    );
    expect(corrected.questions[0]).toMatchObject({
      answer: "b",
      answeredAt: "2026-10-21T10:05:05.000Z",
      superseded: [
        {
          answer: "a",
          answeredAt: "2026-10-21T10:05:00.000Z",
          deliveredAt: "2026-10-21T10:05:01.000Z",
        },
      ],
    });
    expect(corrected.questions[0]?.deliveredAt ?? null).toBeNull();
    // A second correction stacks: nothing is ever dropped.
    const again = await answerCrewQuestion(
      state,
      REPO,
      "crew-K-contracts",
      0,
      "c",
      T1 + 9000,
      null,
      null,
      {
        correction: true,
      },
    );
    expect(again.questions[0]?.superseded?.map((one) => one.answer)).toEqual(["a", "b"]);
    // A correction of a question that has no answer yet is no correction.
    await addCrewQuestion(state, REPO, "crew-K-contracts", asked, T1 + 10_000);
    await expect(
      answerCrewQuestion(state, REPO, "crew-K-contracts", 1, "x", T1 + 11_000, null, null, {
        correction: true,
      }),
    ).rejects.toThrow('question 1 of crew session "crew-K-contracts" has no answer to correct');
  });

  test("D62: a question is open while its phase is, and closed when the phase is over", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "working" }, T0);
    await addCrewQuestion(
      state,
      REPO,
      "crew-K-contracts",
      { options: ["a", "b"], question: "which?", recommended: 1 },
      T1,
    );
    const indexIn = async (next: string): Promise<null | number> => {
      await updateCrew(state, REPO, "crew-K-contracts", { state: next }, T1 + 1000);
      const record = readCrew(state, REPO, "crew-K-contracts");
      return record === null ? null : openQuestionIndex(record);
    };
    // The states a crew session's phase runs in, and `stopped`, which an answer resumes.
    for (const open of ["working", "blocked", "paused", "quiet", "starting", "stopped"]) {
      expect([open, await indexIn(open)]).toEqual([open, 0]);
    }
    // The states it is over in: nothing reads the question any more.
    for (const closed of ["done", "failed", "handoff", "merged", "removed"]) {
      expect([closed, await indexIn(closed)]).toEqual([closed, null]);
      expect(questionClosed(closed)).toBe(true);
    }
    expect(questionClosed("working")).toBe(false);
    expect(questionClosed("stopped")).toBe(false);
    // An answered question was never open.
    await updateCrew(state, REPO, "crew-K-contracts", { state: "working" }, T1 + 2000);
    await answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "a", T1 + 3000);
    const answered = readCrew(state, REPO, "crew-K-contracts");
    expect(answered === null ? "missing" : openQuestionIndex(answered)).toBeNull();
  });

  test("D36: a question with one option, or a recommendation it does not hold, is never written", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    await expect(
      addCrewQuestion(
        state,
        REPO,
        "crew-K-contracts",
        { options: ["only"], question: "Go?", recommended: null },
        T1,
      ),
    ).rejects.toThrow("questions.0.options: Too small: expected array to have >=2 items");
    await expect(
      addCrewQuestion(
        state,
        REPO,
        "crew-K-contracts",
        { options: ["a", "b"], question: "Go?", recommended: 3 },
        T1,
      ),
    ).rejects.toThrow("questions.0.recommended: recommends option 3 of 2");
    expect(readCrew(state, REPO, "crew-K-contracts")?.questions).toEqual([]);
    expect(readCrewEvents(state, REPO).events.map((one) => one.type)).toEqual(["created"]);
  });

  test("D36: an answer without its time is a broken record", () => {
    const state = tempDir("state");
    const file = crewFile(state, REPO, "crew-K-contracts");
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
    expect(() => readCrew(state, REPO, "crew-K-contracts")).toThrow(
      "questions.0.answeredAt: an answer and its time are given together",
    );
  });

  test("a write waits for the store's lock and keeps what the holder wrote", async () => {
    // Two writers at once (a lead and a crew reporting): the second one's read-modify-write
    // must not drop the first one's change. The holder here is exactly what another writer —
    // another process — would be.
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const file = crewFile(state, REPO, "crew-K-contracts");
    let pending: Promise<unknown> | null = null;
    await withLock(crewStoreDir(state, REPO), async () => {
      pending = updateCrew(state, REPO, "crew-K-contracts", { lastLine: "tests green" }, T1);
      // The other writer finishes its own change while it holds the lock.
      const held = { ...JSON.parse(readFileSync(file, "utf8")), memoryMb: 420 };
      writeFileSync(file, JSON.stringify(held));
      // Let the waiting write try at least once: it must still be waiting.
      await Bun.sleep(150);
      expect(readCrew(state, REPO, "crew-K-contracts")?.lastLine).toBeNull();
    });
    await pending;
    expect(readCrew(state, REPO, "crew-K-contracts")).toMatchObject({
      lastLine: "tests green",
      memoryMb: 420,
    });
  });

  test("the lock is the store's own, not the state folder's shared one", async () => {
    const state = tempDir("state");
    // Holding the shared state lock (setup, update, restore) must not hold up a crew session's write.
    await withLock(state, async () => {
      await createCrew(state, queued(), T0);
    });
    expect(readCrew(state, REPO, "crew-K-contracts")?.state).toBe("queued");
  });
});

describe("a record a newer kit wrote", () => {
  test("is read without error: unknown fields kept, an unknown state read as itself", async () => {
    const state = tempDir("state");
    const file = crewFile(state, REPO, "crew-K-contracts");
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
    const read = readCrew(state, REPO, "crew-K-contracts");
    expect(read).toEqual(newer);
    expect(read?.state).toBe("parked");
    expect(isKnownState("parked")).toBe(false);

    // An update by this kit keeps what it does not know, and the newer version number.
    const after = await updateCrew(state, REPO, "crew-K-contracts", { lastLine: "x" }, T1);
    expect(after).toEqual({ ...newer, lastLine: "x", updatedAt: "2026-10-21T10:05:00.000Z" });
  });

  test("the thirteen states this kit knows", () => {
    expect(CREW_STATES).toEqual([
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
      "discarded",
    ]);
    for (const state of CREW_STATES) expect(isKnownState(state)).toBe(true);
  });
});

describe("reading the store", () => {
  test("a missing record is null; a broken one throws, naming the file and the field", () => {
    const state = tempDir("state");
    expect(readCrew(state, REPO, "crew-none")).toBeNull();
    const file = crewFile(state, REPO, "crew-bad");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    expect(() => readCrew(state, REPO, "crew-bad")).toThrow(`Invalid ${file}: not valid JSON`);
    writeFileSync(file, JSON.stringify({ ...queued("crew-bad"), version: 1 }));
    expect(() => readCrew(state, REPO, "crew-bad")).toThrow(
      `Invalid ${file}: createdAt: Invalid input: expected string, received undefined`,
    );
  });

  test("a list holds every record it can read, oldest first, and names each broken one", async () => {
    const state = tempDir("state");
    await createCrew(state, queued("crew-b"), T1);
    await createCrew(state, queued("crew-a"), T0);
    const broken = crewFile(state, REPO, "crew-broken");
    writeFileSync(broken, "[]");
    // A temp file of an atomic write in flight, and a stray file: neither is a record.
    writeFileSync(join(dirname(broken), ".crew-c.json.cc-smart-dev-kit-tmp-1-x"), "{");
    writeFileSync(join(dirname(broken), "notes.txt"), "x");
    const listed = listCrew(state, REPO);
    expect(listed.records.map((one) => one.id)).toEqual(["crew-a", "crew-b"]);
    expect(listed.broken).toEqual([
      {
        file: broken,
        why: `Invalid ${broken}: (top level): Invalid input: expected object, received array`,
      },
    ]);
  });

  test("an empty store lists nothing; every repository's crew sessions are listed together", async () => {
    const state = tempDir("state");
    expect(listCrew(state, REPO)).toEqual({ broken: [], records: [] });
    expect(listAllCrew(state)).toEqual({ broken: [], records: [] });
    await createCrew(state, queued("crew-a", REPO), T1);
    await createCrew(state, queued("crew-b", OTHER), T0);
    expect(listAllCrew(state).records.map((one) => [one.id, one.repo])).toEqual([
      ["crew-b", OTHER],
      ["crew-a", REPO],
    ]);
  });

  test("every repository's leads are listed together, oldest first, then by session id", async () => {
    const state = tempDir("state");
    expect(listAllLeads(state)).toEqual({ broken: [], records: [] });
    // Two leads recorded in the same millisecond: the session id is the tiebreak the walk keeps.
    await writeLead(
      state,
      {
        cwd: REPO,
        name: "LEAD b plan",
        plan: "p",
        repo: REPO,
        sessionId: "22222222-aaaa",
        tag: "b",
      },
      T1,
    );
    await writeLead(
      state,
      {
        cwd: OTHER,
        name: "LEAD a plan",
        plan: "p",
        repo: OTHER,
        sessionId: "11111111-aaaa",
        tag: "a",
      },
      T1,
    );
    await writeLead(
      state,
      {
        cwd: OTHER,
        name: "LEAD old plan",
        plan: "p",
        repo: OTHER,
        sessionId: "33333333-aaaa",
        tag: "o",
      },
      T0,
    );
    expect(listAllLeads(state).records.map((one) => [one.sessionId, one.repo])).toEqual([
      ["33333333-aaaa", OTHER],
      ["11111111-aaaa", OTHER],
      ["22222222-aaaa", REPO],
    ]);
  });
});

describe("what a paused crew session waits for", () => {
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
  function onDisk(state: string, extra: Record<string, unknown>, id = "crew-K-contracts") {
    const file = crewFile(state, REPO, id);
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
    const read = readCrew(state, REPO, "crew-K-contracts");
    expect(read?.state).toBe("paused");
    expect(read).not.toHaveProperty("waitingFor");
  });

  test("a crew session pauses on its slot: the state, the wait, and one state event", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    await updateCrew(
      state,
      REPO,
      "crew-K-contracts",
      { state: "paused", waitingFor: SLOT_WAIT },
      T1,
      "worker slot limited since 21:05",
    );
    const saved = JSON.parse(readFileSync(crewFile(state, REPO, "crew-K-contracts"), "utf8"));
    expect(saved.state).toBe("paused");
    expect(saved.waitingFor).toEqual({
      kind: "slot",
      since: "2026-10-21T21:05:00.000Z",
      slot: "cc-smart-dev-kit-worker",
    });
    expect(readCrew(state, REPO, "crew-K-contracts")?.waitingFor).toEqual(SLOT_WAIT);
    expect(
      readCrewEvents(state, REPO).events.map((one) => [one.type, one.state, one.text]),
    ).toEqual([
      ["created", "queued", null],
      ["state", "paused", "worker slot limited since 21:05"],
    ]);
  });

  test("or on Claude's own limit, with the reset time or with none", async () => {
    const state = tempDir("state");
    await createCrew(state, queued("crew-a"), T0);
    await createCrew(state, queued("crew-b"), T0);
    await updateCrew(state, REPO, "crew-a", { state: "paused", waitingFor: LIMIT_WAIT }, T1);
    await updateCrew(
      state,
      REPO,
      "crew-b",
      {
        state: "paused",
        waitingFor: { kind: "claude-limit", model: "claude-fable-5-1", resetsAt: null },
      },
      T1,
    );
    expect(readCrew(state, REPO, "crew-a")?.waitingFor).toEqual({
      kind: "claude-limit",
      model: "claude-opus-5-5",
      resetsAt: "2026-10-21T19:40:00.000Z",
    });
    expect(readCrew(state, REPO, "crew-b")?.waitingFor).toEqual({
      kind: "claude-limit",
      model: "claude-fable-5-1",
      resetsAt: null,
    });
  });

  test("or on nothing the router explains, with the pause before it kept", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const unknown = { kind: "unknown", since: "2026-10-21T21:05:00.000Z" } as const;
    await updateCrew(
      state,
      REPO,
      "crew-K-contracts",
      {
        lastPause: { backoffMs: 300_000, since: "2026-10-21T21:05:00.000Z" },
        state: "paused",
        waitingFor: unknown,
      },
      T1,
    );
    const saved = JSON.parse(readFileSync(crewFile(state, REPO, "crew-K-contracts"), "utf8"));
    expect(saved.waitingFor).toEqual(unknown);
    expect(saved.lastPause).toEqual({
      backoffMs: 300_000,
      since: "2026-10-21T21:05:00.000Z",
    });
    // The pause before it stays when the crew session goes on; only the wait is cleared.
    await updateCrew(
      state,
      REPO,
      "crew-K-contracts",
      { state: "working", waitingFor: undefined },
      T1 + 60_000,
    );
    const after = readCrew(state, REPO, "crew-K-contracts");
    expect(after).not.toHaveProperty("waitingFor");
    expect(after?.lastPause?.backoffMs).toBe(300_000);
  });

  test("an unknown wait keeps the state key of the session's own slot, in a profile too (RV3)", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const unknown = {
      kind: "unknown",
      since: "2026-10-21T21:05:00.000Z",
      slot: "my-project/cc-smart-dev-kit-worker",
    } as const;
    await updateCrew(state, REPO, "crew-K-contracts", { state: "paused", waitingFor: unknown }, T1);
    const saved = JSON.parse(readFileSync(crewFile(state, REPO, "crew-K-contracts"), "utf8"));
    expect(saved.waitingFor).toEqual(unknown);
    expect(readCrew(state, REPO, "crew-K-contracts")?.waitingFor).toEqual(unknown);
    // The field is declared, not just kept as an extra of a loose object: a key that is empty or
    // not a text is a broken record, named, as for the `slot` wait's own key.
    const fail = (slot: unknown, id: string) => {
      const file = onDisk(state, { waitingFor: { kind: "unknown", since: "t", slot } }, id);
      return { file, read: () => readCrew(state, REPO, id) };
    };
    const empty = fail("", "crew-empty");
    expect(empty.read).toThrow(
      `Invalid ${empty.file}: waitingFor.slot: Too small: expected string to have >=1 characters`,
    );
    const number = fail(42, "crew-number");
    expect(number.read).toThrow(
      `Invalid ${number.file}: waitingFor.slot: Invalid input: expected string, received number`,
    );
  });

  test("when the crew session goes on, the wait is cleared and leaves nothing in the file", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    await updateCrew(
      state,
      REPO,
      "crew-K-contracts",
      { state: "paused", waitingFor: SLOT_WAIT },
      T0,
    );
    await updateCrew(
      state,
      REPO,
      "crew-K-contracts",
      { state: "working", waitingFor: undefined },
      T1,
      "slot answers again",
    );
    const saved = JSON.parse(readFileSync(crewFile(state, REPO, "crew-K-contracts"), "utf8"));
    expect(saved.state).toBe("working");
    expect(Object.keys(saved)).not.toContain("waitingFor");
    expect(readCrew(state, REPO, "crew-K-contracts")).not.toHaveProperty("waitingFor");
  });

  test("a change that does not touch it leaves it as it was", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    await updateCrew(
      state,
      REPO,
      "crew-K-contracts",
      { state: "paused", waitingFor: SLOT_WAIT },
      T0,
    );
    await updateCrew(state, REPO, "crew-K-contracts", { lastLine: "still waiting" }, T1);
    expect(readCrew(state, REPO, "crew-K-contracts")?.waitingFor).toEqual(SLOT_WAIT);
  });

  test("a field a newer kit added inside the wait is kept when this kit writes the record", async () => {
    const state = tempDir("state");
    const newer = { ...SLOT_WAIT, targets: ["omniroute:glm-5.3-flash"] };
    onDisk(state, { state: "paused", version: 2, waitingFor: newer });
    await updateCrew(state, REPO, "crew-K-contracts", { lastLine: "x" }, T1);
    const saved = JSON.parse(readFileSync(crewFile(state, REPO, "crew-K-contracts"), "utf8"));
    expect(saved.waitingFor).toEqual(newer);
    expect(saved.version).toBe(2);
  });

  test("a wait with a field missing, an empty text or a kind this kit does not know is a broken record, named", async () => {
    const state = tempDir("state");
    const fail = (extra: Record<string, unknown>, id: string) => {
      const file = onDisk(state, extra, id);
      return { file, read: () => readCrew(state, REPO, id) };
    };
    const noSlot = fail(
      { waitingFor: { kind: "slot", since: "2026-10-21T21:05:00.000Z" } },
      "crew-a",
    );
    expect(noSlot.read).toThrow(
      `Invalid ${noSlot.file}: waitingFor.slot: Invalid input: expected string, received undefined`,
    );
    const noReset = fail(
      { waitingFor: { kind: "claude-limit", model: "claude-opus-5-5" } },
      "crew-b",
    );
    expect(noReset.read).toThrow(
      `Invalid ${noReset.file}: waitingFor.resetsAt: Invalid input: expected string, received undefined`,
    );
    const empty = fail({ waitingFor: { kind: "slot", since: "t", slot: "" } }, "crew-c");
    expect(empty.read).toThrow(
      `Invalid ${empty.file}: waitingFor.slot: Too small: expected string to have >=1 characters`,
    );
    const unknown = fail({ waitingFor: { kind: "account-switch" } }, "crew-d");
    expect(unknown.read).toThrow(
      `Invalid ${unknown.file}: waitingFor.kind: Invalid discriminator value. Expected 'slot' | 'claude-limit' | 'unknown'`,
    );
    const noSince = fail({ waitingFor: { kind: "unknown" } }, "crew-e");
    expect(noSince.read).toThrow(
      `Invalid ${noSince.file}: waitingFor.since: Invalid input: expected string, received undefined`,
    );
    // A list names each broken one and goes on with the good ones.
    onDisk(state, { waitingFor: SLOT_WAIT, state: "paused" }, "crew-good");
    const listed = listCrew(state, REPO);
    expect(listed.records.map((one) => one.id)).toEqual(["crew-good"]);
    expect(listed.broken.map((one) => one.file).sort()).toEqual(
      [noSlot.file, noReset.file, empty.file, unknown.file, noSince.file].sort(),
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
    // On Windows a file's mode says nothing (a writable file reports 0666): the profile's ACL
    // protects it, and `isOwnerOnly` is the check the rest of the kit reads (`file-mode.ts`).
    expect(isOwnerOnly(statSync(leadFile(state, REPO, LEAD)).mode)).toBe(true);
    if (!NO_POSIX_MODES) {
      expect(statSync(leadFile(state, REPO, LEAD)).mode & 0o777).toBe(0o600);
    }
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
    // `crew lead` run again records the lead with no list of its own: the ids stay.
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
    ).rejects.toThrow(CrewStoreError);
  });
});

describe("the events log", () => {
  test("a reader goes on from its offset, and never takes half a line", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    const first = readCrewEvents(state, REPO);
    expect(first.events.map((one) => one.type)).toEqual(["created"]);
    await appendCrewEvent(
      state,
      REPO,
      {
        lead: LEAD,
        name: "C my-app K contracts",
        state: "working",
        text: "tests-green",
        type: "step",
        crew: "crew-K-contracts",
      },
      T1,
    );
    const file = crewEventsFile(state, REPO);
    // A writer that stopped half way: the reader leaves that line for later.
    const torn = '{"version":1,"at":"2026-10-21T10:05:01.000Z"';
    appendFileSync(file, torn);
    const next = readCrewEvents(state, REPO, first.offset);
    expect(next.events).toEqual([
      {
        at: "2026-10-21T10:05:00.000Z",
        lead: LEAD,
        name: "C my-app K contracts",
        state: "working",
        text: "tests-green",
        type: "step",
        version: 1,
        crew: "crew-K-contracts",
      },
    ]);
    expect(next.offset).toBe(readFileSync(file).length - torn.length);
    expect(readCrewEvents(state, REPO, next.offset)).toEqual({
      events: [],
      offset: next.offset,
      skipped: 0,
    });
  });

  test("a line it cannot read is skipped and counted; a newer event is read as itself", async () => {
    const state = tempDir("state");
    const file = crewEventsFile(state, REPO);
    mkdirSync(dirname(file), { recursive: true });
    const newer = {
      at: "2026-10-21T10:00:00.000Z",
      lead: null,
      name: "C my-app K contracts",
      queue: 3,
      state: "parked",
      text: null,
      type: "requeued",
      version: 2,
      crew: "crew-K-contracts",
    };
    writeFileSync(file, `not json\n${JSON.stringify(newer)}\n{"version":1}\n`);
    const read = readCrewEvents(state, REPO);
    expect(read.events).toEqual([newer]);
    expect(read.skipped).toBe(2);
    expect(read.offset).toBe(readFileSync(file).length);
  });

  test("a file shorter than the offset was replaced: it is read from the start", async () => {
    const state = tempDir("state");
    await createCrew(state, queued(), T0);
    expect(readCrewEvents(state, REPO, 1_000_000).events.map((one) => one.type)).toEqual([
      "created",
    ]);
  });

  test("no log yet: nothing, at offset 0", () => {
    expect(readCrewEvents(tempDir("state"), REPO)).toEqual({ events: [], offset: 0, skipped: 0 });
  });
});

describe("the hand-back report", () => {
  test("written whole, 0600, and read back as written", async () => {
    const state = tempDir("state");
    const file = await writeReport(state, REPO, "crew-K-contracts", report());
    expect(file).toBe(crewReportFile(state, REPO, "crew-K-contracts"));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(report());
    // As above: a Windows mode is made up, so the profile's ACL is what protects the file.
    expect(isOwnerOnly(statSync(file).mode)).toBe(true);
    if (!NO_POSIX_MODES) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readReport(file)).toEqual(report());
    expect(readReport(join(dirname(file), "none.json"))).toBeNull();
  });

  test("a blocked report carries the question it is blocked on", async () => {
    const state = tempDir("state");
    await expect(
      writeReport(state, REPO, "crew-K-contracts", { ...report(), status: "blocked" }),
    ).rejects.toThrow("question: a blocked report names the question it waits on");
    const file = await writeReport(state, REPO, "crew-K-contracts", {
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

describe("RG1: a new question supersedes the crew session's older open one", () => {
  const first = { options: ["a", "b"], question: "Which port?", recommended: null };
  const second = { options: ["c", "d"], question: "Which port, 3210 or 3211?", recommended: 1 };

  test("two questions in a row: the first is closed as superseded, with a pointer, and one is open", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "working" }, T0);
    await addCrewQuestion(state, REPO, "crew-K-contracts", first, T0);
    const after = await addCrewQuestion(state, REPO, "crew-K-contracts", second, T1);
    // Never deleted: both are on the record, the older one points at the newer.
    expect(after.questions.map((one) => one.question)).toEqual([
      "Which port?",
      "Which port, 3210 or 3211?",
    ]);
    expect(after.questions[0]).toMatchObject({ answer: null, supersededBy: 1 });
    expect(after.questions[1]?.supersededBy ?? null).toBeNull();
    expect(openQuestionIndex(after)).toBe(1);
    expect(after.questions.map(isQuestionOpen)).toEqual([false, true]);
  });

  test("three in a row: only the newest is open, and each older one points at the one that replaced it", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "working" }, T0);
    await addCrewQuestion(state, REPO, "crew-K-contracts", first, T0);
    await addCrewQuestion(state, REPO, "crew-K-contracts", second, T0 + 1000);
    const after = await addCrewQuestion(
      state,
      REPO,
      "crew-K-contracts",
      { ...second, question: "Third?" },
      T0 + 2000,
    );
    expect(after.questions.map((one) => one.supersededBy ?? null)).toEqual([1, 2, null]);
    expect(openQuestionIndex(after)).toBe(2);
    // An answer to the oldest is refused with the line that names the newest, not the middle one.
    await expect(answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "a", T1)).rejects.toThrow(
      'was superseded by question 2 ("Third?"): answer that one',
    );
  });

  test("an answer to a superseded question is refused with the line that names the newest", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "working" }, T0);
    await addCrewQuestion(state, REPO, "crew-K-contracts", first, T0);
    await addCrewQuestion(state, REPO, "crew-K-contracts", second, T1);
    await expect(
      answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "3210", T1),
    ).rejects.toThrow(
      'question 0 of crew session "crew-K-contracts" was superseded by question 1 ("Which port, 3210 or 3211?"): answer that one',
    );
    expect(readCrew(state, REPO, "crew-K-contracts")?.questions[0]?.answer).toBeNull();
    // The newest takes the answer.
    const answered = await answerCrewQuestion(state, REPO, "crew-K-contracts", 1, "3210", T1);
    expect(answered.questions[1]).toMatchObject({ answer: "3210" });
    expect(openQuestionIndex(answered)).toBeNull();
  });

  test("a question after an answered one is a new question: the answered one is not superseded", async () => {
    const state = tempDir("state");
    await createCrew(state, { ...queued(), state: "working" }, T0);
    await addCrewQuestion(state, REPO, "crew-K-contracts", first, T0);
    await answerCrewQuestion(state, REPO, "crew-K-contracts", 0, "a", T0 + 1000);
    const after = await addCrewQuestion(state, REPO, "crew-K-contracts", second, T1);
    expect(after.questions[0]?.supersededBy ?? null).toBeNull();
    expect(after.questions[0]?.answer).toBe("a");
    expect(openQuestionIndex(after)).toBe(1);
  });
});
