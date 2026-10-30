import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardWorld, NOW } from "../testing/board-world";
import { LEAD_SESSION } from "../testing/crew-world";
import { git } from "../testing/temp";
import { runCrew } from "./command";
import {
  leadGone,
  mergeProof,
  observeLeadPresence,
  stoppedCrewNeed,
  validMergeProof,
} from "./lifecycle";
import { appendCrewEvent, readCrewEvents, readLead, updateCrew, writeLead } from "./store";

const DAY = 86_400_000;

describe("crew lifecycle", () => {
  test("a resumed then stopped session counts only its latest transition, with events in either order", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped", atMs: NOW - 5 * DAY });
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { state: "working" },
      NOW - 2 * DAY,
    );
    const stopped = await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { state: "stopped" },
      NOW - (3 * DAY) / 2,
    );
    // A step carrying the same state is not another stop.
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        type: "step",
        crew: record.id,
        lead: LEAD_SESSION,
        name: record.name,
        state: "stopped",
        text: "looked at the work",
      },
      NOW - DAY / 2,
    );
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        type: "report",
        crew: record.id,
        lead: LEAD_SESSION,
        name: record.name,
        state: "stopped",
        text: "same state again",
      },
      NOW - DAY / 4,
    );
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    expect(stoppedCrewNeed(stopped, events, world.ctx())?.since).toBe(
      new Date(NOW - (3 * DAY) / 2).toISOString(),
    );
    expect(stoppedCrewNeed(stopped, [...events].reverse(), world.ctx())?.since).toBe(
      new Date(NOW - (3 * DAY) / 2).toISOString(),
    );
  });
  test("RX1: the events log is read only for a record the need can apply to", async () => {
    const world = await boardWorld();
    const working = await world.addCrew({ atMs: NOW - 5 * DAY });
    const reads: string[] = [];
    const events = () => {
      reads.push("read");
      return [];
    };

    // A working record has no stopped-session need: the log (which only grows) is not read for it.
    expect(stoppedCrewNeed(working, events, world.ctx(), [])).toBeNull();
    expect(reads).toEqual([]);

    const stopped = await world.addCrew({
      atMs: NOW - 5 * DAY,
      phase: "B2",
      slug: "other",
      state: "stopped",
      suffix: "2b2b2b",
    });
    stoppedCrewNeed(stopped, events, world.ctx({ now: () => NOW }), []);
    expect(reads).toEqual(["read"]);
  });

  test("unknown lead must be continuously absent for more than a day, and a failed read proves nothing", async () => {
    const world = await boardWorld();
    const ctx = world.ctx();
    const lead = readLead(world.paths.stateDir, world.repo, LEAD_SESSION);
    if (lead === null) throw new Error("missing fixture lead");
    const [first] = await observeLeadPresence(ctx.paths.stateDir, [lead], [], NOW);
    if (first === undefined) throw new Error("missing observed lead");
    expect(leadGone(first, [], NOW)).toBe(false);
    expect(leadGone(first, [], NOW + DAY)).toBe(false);
    expect(leadGone(first, [], NOW + DAY + 1)).toBe(true);
    expect(leadGone(first, null, NOW + 2 * DAY)).toBe(false);
    const row = {
      cwd: world.repo,
      id: LEAD_SESSION.slice(0, 8),
      sessionId: LEAD_SESSION,
      pid: 42,
      state: "working",
      status: null,
      waitingFor: null,
    };
    const [returned] = await observeLeadPresence(ctx.paths.stateDir, [first], [row], NOW + 2 * DAY);
    expect(returned?.sessionUnknownSince).toBeNull();
    expect(leadGone(returned ?? null, [], NOW + 3 * DAY)).toBe(false);
    expect(readLead(ctx.paths.stateDir, world.repo, LEAD_SESSION)?.updatedAt).toBe(lead.updatedAt);
  });

  test("an explicitly ended lead is gone even when agent view is unreadable", async () => {
    const world = await boardWorld();
    const lead = readLead(world.paths.stateDir, world.repo, LEAD_SESSION);
    if (lead === null) throw new Error("missing fixture lead");
    const ended = await writeLead(
      world.paths.stateDir,
      { ...lead, endedAt: new Date(NOW).toISOString() },
      NOW,
    );
    expect(leadGone(ended, null, NOW)).toBe(true);
  });

  test("proof survives a rewritten lead but never another crew commit", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    const base = git(world.repo, "rev-parse", "HEAD").trim();
    writeFileSync(join(record.worktree, "README.md"), "crew work\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "crew work");
    const head = git(record.worktree, "rev-parse", "HEAD").trim();
    expect(mergeProof(record, world.ctx())).toBeUndefined();
    git(world.repo, "merge", "--no-ff", "-m", "merge crew", record.branch);
    const leadCommit = git(world.repo, "rev-parse", "HEAD").trim();
    const proof = mergeProof(record, world.ctx());
    expect(proof).toEqual({ head, leadRef: "main", leadCommit });
    const marked = await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { state: "merged", mergeProof: proof },
      NOW,
    );
    git(world.repo, "reset", "--hard", base);
    writeFileSync(join(world.repo, "README.md"), "rewritten lead work\n");
    git(world.repo, "add", ".");
    git(world.repo, "commit", "-m", "rewritten lead work");
    git(world.repo, "reflog", "expire", "--expire=now", "--all");
    git(world.repo, "gc", "--prune=now");
    expect(git(world.repo, "cat-file", "-t", leadCommit).trim()).toBe("commit");
    expect(validMergeProof(marked, world.ctx())).toBe(true);
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toContainEqual(["rm", "a1b2c3d4"]);
  });

  test("a legacy merged record without proof gets a specific refusal, never an unsafe override", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "merged" });
    writeFileSync(join(record.worktree, "README.md"), "crew change\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "crew work");
    writeFileSync(join(world.repo, "README.md"), "rewritten lead\n");
    git(world.repo, "add", ".");
    git(world.repo, "commit", "-m", "rewritten lead work");
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err.join("\n")).toContain("merged earlier, but no exact-head proof was recorded");
    expect(world.err.join("\n")).toContain("recoverable crew rm --discard");
    expect(world.claudeCalls()).not.toContainEqual(["rm", "a1b2c3d4"]);
  });

  test("a commit after the merge proof is kept by crew rm", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    const base = git(world.repo, "rev-parse", "HEAD").trim();
    writeFileSync(join(record.worktree, "README.md"), "crew work\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "crew work");
    git(world.repo, "merge", "--no-ff", "-m", "merge crew", record.branch);
    const proof = mergeProof(record, world.ctx());
    const marked = await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { state: "merged", mergeProof: proof },
      NOW,
    );
    git(world.repo, "reset", "--hard", base);
    writeFileSync(join(world.repo, "README.md"), "rewritten lead work\n");
    git(world.repo, "add", ".");
    git(world.repo, "commit", "-m", "rewritten lead work");
    writeFileSync(join(record.worktree, "new.txt"), "new crew work\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "more crew work");
    expect(validMergeProof(marked, world.ctx())).toBe(false);
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.claudeCalls()).not.toContainEqual(["rm", "a1b2c3d4"]);
  });
});
