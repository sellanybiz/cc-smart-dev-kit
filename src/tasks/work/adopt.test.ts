/**
 * Adopting a dead lead's plans (`herdr adopt`): only the lead identity moves, only when the lead
 * is proved dead, and the hand-out a child holds keeps working.
 */
import { expect, test } from "bun:test";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import { eventsOf, taskById } from "./queries";
import { adoptLeadPlans, createTask, reservePlan, takeTasks, updateTask } from "./store";
import type { Result, Who, WorkClaim, WorkTask } from "./types";

const DEAD: Who = { sessionId: "dead", pid: 4101, procStart: "41010" };
const LIVE: Who = { sessionId: "live", pid: 4202, procStart: "42020" };
const ME: Who = { sessionId: "me", pid: 4303, procStart: "43030" };
const CHILD: Who = { sessionId: "child", pid: 5202, procStart: "52020" };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function setup() {
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  const plan = (slug: string, files: string[], who: Who): WorkTask =>
    ok(createTask(db, { project: "p", subject: slug, kind: "plan", plan: slug, files }, who, 1));
  const reserve = (slug: string, who: Who, holder: "self" | "child" = "child") =>
    ok(
      reservePlan(db, {
        project: "p",
        plan: slug,
        who,
        holder,
        ignore: [],
        caseFold: false,
        now: 10,
      }),
    );
  /** The leads `isDead` is asked about, and which of them it calls dead. */
  const asked: WorkClaim[] = [];
  const deadBy =
    (...sessions: string[]) =>
    (claim: WorkClaim) => {
      asked.push(claim);
      return sessions.includes(claim.sessionId ?? "");
    };
  return { db, plan, reserve, asked, deadBy };
}

test("a dead lead's open and closed plans move to the adopter, and nothing else of the reservation does", () => {
  const s = setup();
  const open = s.plan("open", ["src/a/"], DEAD);
  const closing = s.plan("closing", ["src/b/"], DEAD);
  const handOut = s.reserve("open", DEAD, "child").lead;
  const own = s.reserve("closing", DEAD, "self").lead;
  ok(updateTask(s.db, closing.id, { status: "done" }, DEAD, 20));
  const moved = ok(
    adoptLeadPlans(s.db, { project: "p", who: ME, isDead: s.deadBy("dead"), now: 30 }),
  );
  expect(moved.map((t) => t.plan)).toEqual(["open", "closing"]);
  for (const [id, before] of [
    [open.id, handOut],
    [closing.id, own],
  ] as const) {
    const lead = taskById(s.db, id).lead;
    expect(lead).toMatchObject({ sessionId: "me", pid: 4303, procStart: "43030" });
    // The holder kind and the hand-out id are the reservation's, not the lead's.
    expect(lead?.holder).toBe(before?.holder);
    expect(lead?.handoutId).toBe(before?.handoutId ?? "x");
  }
  expect(taskById(s.db, closing.id).status).toBe("done");
});

test("every move is one history entry that says who the lead was and is", () => {
  const s = setup();
  const open = s.plan("open", ["src/a/"], DEAD);
  s.reserve("open", DEAD);
  ok(adoptLeadPlans(s.db, { project: "p", who: ME, isDead: s.deadBy("dead"), now: 30 }));
  const last = eventsOf(s.db, open).at(-1);
  expect(last).toMatchObject({
    action: "changed",
    reason: "lead adopted",
    sessionId: "me",
    at: 30,
    changes: { lead: ["dead (child)", "me (child)"] },
  });
  expect(eventsOf(s.db, open).filter((e) => e.reason === "lead adopted")).toHaveLength(1);
});

test("a lead that runs, or cannot be proved dead, is never moved", () => {
  const s = setup();
  const live = s.plan("live", ["src/a/"], LIVE);
  const dead = s.plan("dead", ["src/b/"], DEAD);
  s.reserve("live", LIVE);
  s.reserve("dead", DEAD);
  // Nobody is proved dead: nothing moves.
  expect(ok(adoptLeadPlans(s.db, { project: "p", who: ME, isDead: s.deadBy(), now: 30 }))).toEqual(
    [],
  );
  expect(taskById(s.db, live.id).lead?.sessionId).toBe("live");
  expect(taskById(s.db, dead.id).lead?.sessionId).toBe("dead");
  // Only the proved one moves.
  const moved = ok(
    adoptLeadPlans(s.db, { project: "p", who: ME, isDead: s.deadBy("dead"), now: 31 }),
  );
  expect(moved.map((t) => t.plan)).toEqual(["dead"]);
  expect(taskById(s.db, live.id).lead?.sessionId).toBe("live");
  // isDead is asked about the lead's own process, in the shape of a claim.
  expect(s.asked.find((claim) => claim.sessionId === "live")).toEqual({
    pid: 4202,
    procStart: "42020",
    sessionId: "live",
  });
});

test("the adopter's own plans, a plan with no reservation, and a lead with no process stay", () => {
  const s = setup();
  const mine = s.plan("mine", ["src/a/"], ME);
  const free = s.plan("free", ["src/b/"], DEAD);
  s.reserve("mine", ME);
  const nobody = s.plan("nobody", ["src/c/"], { sessionId: "ghost", pid: null, procStart: null });
  s.reserve("nobody", { sessionId: "ghost", pid: null, procStart: null });
  const moved = ok(adoptLeadPlans(s.db, { project: "p", who: ME, isDead: () => true, now: 30 }));
  expect(moved).toEqual([]);
  expect(taskById(s.db, mine.id).lead?.sessionId).toBe("me");
  expect(taskById(s.db, free.id).lead).toBeNull();
  expect(taskById(s.db, nobody.id).lead?.sessionId).toBe("ghost");
});

test("another project's plans are left alone, and an adopter without a session is refused", () => {
  const s = setup();
  ok(
    createTask(
      s.db,
      { project: "q", subject: "x", kind: "plan", plan: "x", files: ["a"] },
      DEAD,
      1,
    ),
  );
  ok(
    reservePlan(s.db, {
      project: "q",
      plan: "x",
      who: DEAD,
      holder: "child",
      ignore: [],
      caseFold: false,
      now: 2,
    }),
  );
  expect(ok(adoptLeadPlans(s.db, { project: "p", who: ME, isDead: () => true, now: 3 }))).toEqual(
    [],
  );
  const refused = adoptLeadPlans(s.db, {
    project: "p",
    who: { sessionId: null, pid: null, procStart: null },
    isDead: () => true,
    now: 3,
  });
  expect(refused).toEqual({ ok: false, why: "adopt needs a resolvable calling session" });
});

test("after an adopt, the child's take with the old hand-out id passes, ", () => {
  const s = setup();
  const alpha = s.plan("alpha", ["src/a/"], DEAD);
  const handout = s.reserve("alpha", DEAD).lead?.handoutId ?? "";
  ok(adoptLeadPlans(s.db, { project: "p", who: ME, isDead: s.deadBy("dead"), now: 30 }));
  expect(taskById(s.db, alpha.id).lead?.handoutId).toBe(handout);
  // The plan's maker is the dead lead's session: the take sees it ended (`sessionEnded` in ops).
  const taken = takeTasks(s.db, "p", alpha.id, CHILD, 40, {
    from: handout,
    isLive: () => false,
    isEnded: (claim) => claim.sessionId === "dead",
  });
  expect(taken.ok).toBe(true);
  expect(taskById(s.db, alpha.id).createdBy).toBe("child");
});
