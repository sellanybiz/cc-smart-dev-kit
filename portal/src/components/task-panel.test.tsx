/**
 * The side panel a task row opens (`GET /api/tasks/<id>`) and its "Move to session…", drawn
 * from data alone: the facts, the description, the notes, the history, and the move's
 * question with the sessions it names and whether the old claim still runs.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskDetailAnswer, TaskSession, WorkTaskNode } from "@/api/types";
import { MoveToSession, moveTargets } from "@/components/task-move";
import { closePanel, TaskDetailBody } from "@/components/task-panel";
import { TaskList } from "@/components/task-tree";
import { task, words } from "@/components/tasks-fixtures";
import { filterTasks, SHOW_ALL } from "@/lib/tasks";

const AT = Date.UTC(2026, 10, 3, 10, 0);

const SESSIONS: TaskSession[] = [
  { id: "s-old", live: true, name: "builder" },
  { id: "s-new", live: true, name: "fresh-start" },
  { id: "s-quiet", live: true, name: null },
  { id: "s-gone", live: false, name: "ended" },
];

const NODE: WorkTaskNode = task(6, "Write the docs page", "in_progress", [], {
  claim: "live",
  notes: 1,
  plan: "web",
  session: "s-old",
  blocked: true,
  blockedBy: [{ ref: "#3", status: "done", subject: "Write the schema" }],
});

const DETAIL: TaskDetailAnswer = {
  task: {
    agent: "builder-a1",
    base: null,
    branch: "plan/web",
    claim: { pid: 4242, procStart: "1", sessionId: "s-old" },
    closedAt: null,
    createdAt: AT,
    createdBy: "s-old",
    description: "## What\n\nThe **docs** page.",
    id: "w6",
    kind: "task",
    number: 6,
    parentId: "w2",
    phase: "K",
    plan: "web",
    project: "key",
    status: "in_progress",
    subject: "Write the docs page",
    type: "blocking",
    updatedAt: AT + 60_000,
    waitsFor: ["w3"],
    worktree: null,
  },
  notes: [
    { at: AT + 30_000, id: 1, sessionId: "s-old", taskId: "w6", text: "Report: half *done*." },
  ],
  events: [
    {
      action: "created",
      at: AT,
      changes: {
        subject: [null, "Write the docs page"],
        description: [null, "An earlier draft of the page"],
      },
      // The server's words for it (`historyChanges`): the panel shows these, never `changes`.
      lines: ['subject "Write the docs page"', "description 28 characters"],
      id: 1,
      number: 6,
      pid: 4242,
      reason: null,
      sessionId: "s-old",
      sessionName: "builder",
      taskId: "w6",
    },
    {
      action: "changed",
      at: AT + 60_000,
      changes: { status: ["pending", "in_progress"] },
      lines: ["status pending → in_progress"],
      id: 2,
      number: 6,
      pid: 4242,
      reason: null,
      sessionId: "s-old",
      sessionName: "builder",
      taskId: "w6",
    },
  ],
};

function body(node: null | WorkTaskNode = NODE, sessions = SESSIONS): string {
  return renderToStaticMarkup(
    <TaskDetailBody detail={DETAIL} node={node} sessions={sessions} onMoved={() => {}} />,
  );
}

describe("the side panel", () => {
  test("the facts, the description, the notes and the history, each in words", () => {
    const html = body();
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("Status in progress");
    expect(text).toContain("Type blocking: holds its parent");
    expect(text).toContain("Plan web");
    expect(text).toContain("Phase K");
    expect(text).toContain("Session builder · running now");
    expect(text).toContain("Claim ● running");
    expect(text).toContain("Waits for ! blocked by #3 ✓ (done: Write the schema)");
    expect(text).toContain("Agent builder-a1");
    expect(text).toContain("Branch plan/web");
    expect(text).not.toContain("Worktree");
    expect(text).not.toContain("Closed");
    // The description and the notes as Markdown: elements, never raw HTML.
    expect(html).toContain("<strong>docs</strong>");
    expect(text).toContain("Notes · 1");
    expect(html).toContain("<em>done</em>");
    expect(text).toContain("History · 2 changes");
    // Each entry in the server's own words, in its order; the stored values never shown raw.
    expect(text).toContain(
      'created · builder subject "Write the docs page" description 28 characters',
    );
    expect(text).toContain("changed · builder status pending → in_progress");
    expect(text).not.toContain("An earlier draft");
  });

  test("without the tree's row (closed and gone from it), the store's facts still show", () => {
    const text = words(body(null));
    expect(text).toContain("Claim process 4242");
    expect(text).not.toContain("Move to session");
    expect(text).not.toContain("Waits for");
  });
});

describe("closing the panel", () => {
  /** A recorder in place of the dialog and the elements: what was closed and focused, in order. */
  function world(open: boolean) {
    const log: string[] = [];
    const dialog = {
      open,
      close() {
        log.push("close");
        this.open = false;
      },
    };
    const target = (name: string) => ({ focus: () => log.push(`focus ${name}`) });
    return { dialog, log, target };
  }

  test("it closes the dialog first, then gives the focus to the task's row", () => {
    const { dialog, log, target } = world(true);
    closePanel(dialog, target("row"), target("opener"));
    expect(log).toEqual(["close", "focus row"]);
    expect(dialog.open).toBe(false);
  });

  test("with no row drawn (folded away, or a deep link), the focus goes to what had it before", () => {
    const { dialog, log, target } = world(true);
    closePanel(dialog, null, target("opener"));
    expect(log).toEqual(["close", "focus opener"]);
  });

  test("a dialog already closed is not closed again, and with nothing to focus nothing fails", () => {
    const { dialog, log } = world(false);
    closePanel(dialog, null, null);
    closePanel(null, null, null);
    expect(log).toEqual([]);
  });

  test("each row carries its task's id, so the panel can find it again", () => {
    const html = renderToStaticMarkup(
      <TaskList tasks={filterTasks([task(6, "Write the docs page", "pending")], SHOW_ALL)} />,
    );
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*data-task-row="w6"/);
  });
});

describe("moving a task to another session", () => {
  test("only running, named sessions other than its own can take it", () => {
    expect(moveTargets(NODE, SESSIONS).map((one) => one.id)).toEqual(["s-new"]);
    expect(moveTargets({ ...NODE, session: null }, SESSIONS).map((one) => one.id)).toEqual([
      "s-old",
      "s-new",
    ]);
  });

  test("the question names both sessions and says the old claim still runs", () => {
    const html = renderToStaticMarkup(
      <MoveToSession node={NODE} sessions={SESSIONS} onDone={() => {}} />,
    );
    const text = words(html);
    expect(text).toContain("Move #6 to another session?");
    expect(text).toContain(
      "It moves this task from builder to the session you pick. Its notes and history stay.",
    );
    expect(text).toContain("To session fresh-start");
    expect(text).toContain("! A running process still holds 1 task here.");
    expect(text).toContain("Take it over anyway");
  });

  test("an ended claim needs no force, and says nothing runs it", () => {
    const text = words(
      renderToStaticMarkup(
        <MoveToSession node={{ ...NODE, claim: "dead" }} sessions={SESSIONS} onDone={() => {}} />,
      ),
    );
    expect(text).toContain("The process that held 1 task here has ended: nothing runs it now.");
    expect(text).toContain("Move it");
    expect(text).not.toContain("Take it over anyway");
  });

  test("no session to move to: the button is off, and says why", () => {
    const html = renderToStaticMarkup(
      <MoveToSession node={NODE} sessions={[SESSIONS[0] as TaskSession]} onDone={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Move to session…/);
    expect(words(html)).toContain("No other named session runs in this project now.");
    expect(html).not.toContain("<dialog");
  });
});
