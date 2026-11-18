/**
 * Two small store guards a start leans on: the compare-and-set that claims a resume, and the
 * release that only gives back the reservation it saw.
 */
import { expect, test } from "bun:test";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import { eventsOf, planByRef, taskById } from "./queries";
import { createTask, releasePlan, reservePlan, swapPlanAgent, updateTask } from "./store";
import type { Result, Who, WorkTask } from "./types";

const LEAD: Who = { sessionId: "lead", pid: 4101, procStart: "41010" };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function why<T>(result: Result<T>): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.why;
}
function setup() {
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  const plan = (slug: string): WorkTask =>
    ok(
      createTask(
        db,
        { project: "p", subject: slug, kind: "plan", plan: slug, files: [`src/${slug}/`] },
        LEAD,
        1,
      ),
    );
  const reserve = (slug: string, now = 10) =>
    ok(
      reservePlan(db, {
        project: "p",
        plan: slug,
        who: LEAD,
        holder: "child",
        ignore: [],
        caseFold: false,
        now,
      }),
    );
  return { db, plan, reserve };
}

test("only one of two claims on the same reading wins", () => {
  const s = setup();
  const alpha = s.plan("alpha");
  s.reserve("alpha");
  ok(updateTask(s.db, alpha.id, { agent: "herdr:core/t2" }, LEAD, 20));
  const read = taskById(s.db, alpha.id);
  const claim = (to: string) =>
    swapPlanAgent(s.db, {
      project: "p",
      plan: "alpha",
      who: LEAD,
      from: read.agent,
      fromUpdatedAt: read.updatedAt,
      to,
      now: 30,
      reason: "child launching",
    });
  expect(ok(claim("pending:30")).agent).toBe("pending:30");
  expect(why(claim("pending:31"))).toContain("another start got there first");
  expect(taskById(s.db, alpha.id).agent).toBe("pending:30");
  expect(eventsOf(s.db, alpha).filter((e) => e.reason === "child launching")).toHaveLength(1);
});

test("a claim is refused when the plan moved even though its agent did not", () => {
  const s = setup();
  const alpha = s.plan("alpha");
  s.reserve("alpha");
  const read = taskById(s.db, alpha.id);
  // Something else touched the plan after the reading: its updated_at moved.
  ok(updateTask(s.db, alpha.id, { subject: "alpha again" }, LEAD, 40));
  const answer = swapPlanAgent(s.db, {
    project: "p",
    plan: "alpha",
    who: LEAD,
    from: read.agent,
    fromUpdatedAt: read.updatedAt,
    to: "pending:50",
    now: 50,
    reason: "child launching",
  });
  expect(why(answer)).toContain("changed since it was read");
  // Giving a claim back compares the agent alone, and can set no agent.
  ok(updateTask(s.db, alpha.id, { agent: "pending:60" }, LEAD, 60));
  const back = swapPlanAgent(s.db, {
    project: "p",
    plan: "alpha",
    who: LEAD,
    from: "pending:60",
    to: null,
    now: 70,
    reason: "launch failed",
  });
  expect(ok(back).agent).toBeNull();
  // Giving a claim back never takes another start's: the agent must be the marker that was written.
  ok(updateTask(s.db, alpha.id, { agent: "herdr:core/t9" }, LEAD, 80));
  const wrong = swapPlanAgent(s.db, {
    project: "p",
    plan: "alpha",
    who: LEAD,
    from: "pending:60",
    to: null,
    now: 90,
    reason: "launch failed",
  });
  expect(why(wrong)).toContain("another start got there first");
  expect(taskById(s.db, alpha.id).agent).toBe("herdr:core/t9");
});

test("a release that names the hand-out it saw leaves a newer reservation alone", () => {
  const s = setup();
  const alpha = s.plan("alpha");
  const first = s.reserve("alpha").lead?.handoutId ?? "";
  ok(releasePlan(s.db, { project: "p", plan: "alpha", who: LEAD, now: 20 }));
  const second = s.reserve("alpha", 30).lead?.handoutId ?? "";
  expect(second).not.toBe(first);
  const stale = releasePlan(s.db, {
    project: "p",
    plan: "alpha",
    who: LEAD,
    now: 40,
    handoutId: first,
  });
  expect(why(stale)).toContain("was handed out again since it was read");
  expect(taskById(s.db, alpha.id).lead?.handoutId).toBe(second);
  // The same call with the current hand-out id releases; none given releases whatever is there.
  ok(releasePlan(s.db, { project: "p", plan: "alpha", who: LEAD, now: 50, handoutId: second }));
  expect(taskById(s.db, alpha.id).lead).toBeNull();
  // Released already: idempotent, with or without the guard.
  ok(releasePlan(s.db, { project: "p", plan: "alpha", who: LEAD, now: 60, handoutId: second }));
});

test("planByRef finds a plan by its slug first, then by #n or id", () => {
  const s = setup();
  const alpha = s.plan("alpha");
  expect(planByRef(s.db, "p", "alpha")?.id).toBe(alpha.id);
  expect(planByRef(s.db, "p", `#${alpha.number}`)?.id).toBe(alpha.id);
  expect(planByRef(s.db, "p", alpha.id)?.id).toBe(alpha.id);
  expect(planByRef(s.db, "p", "nothing")).toBeNull();
  expect(planByRef(s.db, "other", "alpha")).toBeNull();
});
