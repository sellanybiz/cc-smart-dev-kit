"use client";

import { RotateCwIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { useResource } from "@/api/hooks";
import { TASKS_REFRESH } from "@/api/refresh";
import type { TaskDetailAnswer, TaskSession, TasksProjectData, WorkTaskNode } from "@/api/types";
import { Markdown } from "@/components/markdown";
import { MoveToSession } from "@/components/task-move";
import { BlockedBy, ClaimMark, LAYER, STATUS } from "@/components/task-tree";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago } from "@/lib/format";
import { sessionLabel } from "@/lib/task-groups";
import { cn } from "@/lib/utils";

/** A session id as a person reads it: its name, else its short id, else "no session". */
function sessionWords(id: null | string, sessions: readonly TaskSession[]): string {
  if (id === null) return "no session recorded";
  const known = sessions.find((one) => one.id === id) ?? { id, live: false, name: null };
  return sessionLabel({ id, session: known });
}

/** A time as a date and clock, with how long ago in words. */
function When({ at }: { at: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString("en-GB")}>
      {new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
      {ago(at)}
    </time>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 py-1">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 wrap-any">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The facts of a task: the store's own, with the tree's claim and blockers when it has the row. */
function Facts({
  detail,
  node,
  sessions,
}: {
  detail: TaskDetailAnswer;
  node: null | WorkTaskNode;
  sessions: readonly TaskSession[];
}) {
  const { task } = detail;
  const session = sessions.find((one) => one.id === task.createdBy);
  return (
    <dl className="text-sm">
      <Fact term="Status">{STATUS[task.status].words}</Fact>
      <Fact term="Type">
        {task.type === "non-blocking"
          ? "non-blocking: holds nothing"
          : "blocking: holds its parent"}
      </Fact>
      {task.plan !== null && <Fact term="Plan">{task.plan}</Fact>}
      {task.phase !== null && <Fact term="Phase">{task.phase}</Fact>}
      <Fact term="Session">
        {sessionWords(task.createdBy, sessions)}
        {session !== undefined && (
          <span className="text-muted-foreground">
            {session.live ? " · running now" : " · not running"}
          </span>
        )}
      </Fact>
      <Fact term="Claim">
        {node !== null && node.claim !== "none" ? (
          <ClaimMark claim={node.claim} />
        ) : task.claim === null ? (
          "nobody holds it"
        ) : (
          `process ${task.claim.pid}`
        )}
      </Fact>
      {node !== null && node.blockedBy.length > 0 && (
        <Fact term="Waits for">
          <BlockedBy blockers={node.blockedBy} />
        </Fact>
      )}
      {(["agent", "branch", "worktree", "base"] as const).map((key) =>
        task[key] === null || task[key] === "" ? null : (
          <Fact key={key} term={key[0]?.toUpperCase() + key.slice(1)}>
            <span className="font-mono text-xs">{task[key]}</span>
          </Fact>
        ),
      )}
      <Fact term="Made">
        <When at={task.createdAt} />
      </Fact>
      <Fact term="Changed">
        <When at={task.updatedAt} />
      </Fact>
      {task.closedAt !== null && (
        <Fact term="Closed">
          <When at={task.closedAt} />
        </Fact>
      )}
    </dl>
  );
}

function Notes({
  detail,
  sessions,
}: {
  detail: TaskDetailAnswer;
  sessions: readonly TaskSession[];
}) {
  if (detail.notes.length === 0) {
    return <p className="text-sm text-muted-foreground">No notes yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-3">
      {detail.notes.map((note) => (
        <li key={note.id} className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">
            <When at={note.at} /> · {sessionWords(note.sessionId, sessions)}
          </p>
          <Markdown>{note.text}</Markdown>
        </li>
      ))}
    </ol>
  );
}

function History({ detail }: { detail: TaskDetailAnswer }) {
  return (
    <details className="group rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
        History · {detail.events.length === 1 ? "1 change" : `${detail.events.length} changes`}
      </summary>
      <ol className="flex flex-col divide-y border-t">
        {detail.events.map((event) => (
          <li key={event.id} className="flex flex-col gap-0.5 px-3 py-2 text-xs">
            <p className="text-muted-foreground">
              <When at={event.at} /> ·{" "}
              <span className="font-medium text-foreground">{event.action}</span>
              {event.sessionName !== null && ` · ${event.sessionName}`}
              {event.reason !== null && ` · ${event.reason}`}
            </p>
            {/* The server's words for each change (`historyChanges`), as `task_get` prints them. */}
            <ul className="flex flex-col gap-0.5">
              {event.lines.map((line) => (
                // Each line starts with its own field's label, so no two lines of one entry match.
                <li key={line} className="wrap-any">
                  {line}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">Reading the task…</span>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** The panel's body once the task is read: the move, the facts, the description, notes, history. */
export function TaskDetailBody({
  detail,
  node,
  sessions,
  onMoved,
}: {
  detail: TaskDetailAnswer;
  node: null | WorkTaskNode;
  sessions: readonly TaskSession[];
  onMoved: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {node !== null && node.kind !== "phase" && (
        <MoveToSession node={node} sessions={sessions} onDone={onMoved} />
      )}
      <Facts detail={detail} node={node} sessions={sessions} />
      <Section title="Description">
        {detail.task.description.trim() === "" ? (
          <p className="text-sm text-muted-foreground">No description.</p>
        ) : (
          <Markdown>{detail.task.description}</Markdown>
        )}
      </Section>
      <Section title={detail.notes.length === 0 ? "Notes" : `Notes · ${detail.notes.length}`}>
        <Notes detail={detail} sessions={sessions} />
      </Section>
      <History detail={detail} />
    </div>
  );
}

/** Something the focus can go back to. */
export interface FocusTarget {
  focus(): void;
}

/**
 * Closes the panel and gives the focus back, before the page drops the panel: to the row of the
 * task it showed, else (a row folded away, or a deep link with no row) to what had the focus
 * before the panel opened. A dialog removed while still open would leave the focus nowhere.
 */
export function closePanel(
  dialog: null | { open: boolean; close(): void },
  row: FocusTarget | null,
  opener: FocusTarget | null,
): void {
  if (dialog?.open === true) dialog.close();
  (row ?? opener)?.focus();
}

/** The row button of a task in the tree (`TaskRow` marks it), or null when it is not drawn. */
function rowOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(id)}"]`);
}

/**
 * The side panel a row opens: one task from `GET /api/tasks/<id>`. A native `<dialog>` opened
 * with `showModal()` (the browser traps the focus and closes it on Escape), drawn as a drawer on
 * the right, the whole width on a phone. Closing gives the focus back to the task's row
 * (`closePanel`). It writes no `style` attribute and injects no `<style>`, so the strict content
 * policy holds.
 */
export function TaskPanel({
  id,
  found,
  onClose,
  onChanged,
}: {
  id: string;
  found: null | { node: WorkTaskNode; project: TasksProjectData };
  onClose: () => void;
  /** The tree may have changed (a move): read it again. */
  onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const detail = useResource((client) => client.taskDetail(id), id, TASKS_REFRESH);
  useEffect(() => {
    const dialog = ref.current;
    // What had the focus before `showModal` moves it: where it goes back if the row is gone.
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog !== null && !dialog.open) dialog.showModal();
    // Leaving the page another way (a link, the browser's back) still closes it.
    return () => dialog?.close();
  }, []);
  const close = () => {
    closePanel(ref.current, rowOf(id), opener.current);
    onClose();
  };
  const node = found?.node ?? null;
  const work = found?.project.tasks.work;
  const sessions = work?.state === "ready" ? work.sessions : [];
  const known = detail.status === "ready" ? detail.data.task : null;
  const subject = known?.subject ?? node?.subject ?? "Task";
  const status = known?.status ?? node?.status ?? null;
  const kind = known?.kind ?? node?.kind ?? "task";
  const number = known === null ? (node?.ref ?? "") : `#${known.number}`;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: the page closes it, so the focus goes back the same way as the Close button's.
        event.preventDefault();
        close();
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-full border-l bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 sm:w-[min(36rem,100vw)]"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {status !== null && (
                <span className={cn("font-semibold", STATUS[status].tone)} aria-hidden="true">
                  {STATUS[status].glyph}
                </span>
              )}
              <span>{LAYER[kind].words}</span>
              <span className="font-mono">{number}</span>
              {status !== null && <span>· {STATUS[status].words}</span>}
              {found !== null && <span>· {found.project.project.name}</span>}
            </p>
            <h2 id={titleId} className="text-base font-semibold text-pretty wrap-any">
              {subject}
            </h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close the task">
            <XIcon aria-hidden="true" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {detail.status === "loading" ? (
            <Loading />
          ) : detail.status === "error" ? (
            <div role="alert" className="flex flex-col items-start gap-3 text-sm">
              <p>
                {detail.missing
                  ? "This task is not in the store any more: it may have been deleted."
                  : `The task could not be read: ${detail.message}`}
              </p>
              {!detail.missing && (
                <Button variant="outline" size="sm" onClick={detail.reload}>
                  <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
                  Try again
                </Button>
              )}
            </div>
          ) : (
            <TaskDetailBody
              detail={detail.data}
              node={node}
              sessions={sessions}
              onMoved={() => {
                detail.refresh();
                onChanged();
              }}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
