"use client";

import { ChevronRightIcon, MessageSquareTextIcon } from "lucide-react";
import { createContext, useContext, useId } from "react";
import type { WorkTaskNode } from "@/api/types";
import { TonePill } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { isClosed, ledgerOf, type ShownTask } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** Each status's glyph, its colour and its words: the glyph's shape carries it without colour. */
export const STATUS: Record<
  WorkTaskNode["status"],
  { glyph: string; tone: string; words: string }
> = {
  pending: { glyph: "○", tone: "text-muted-foreground", words: "pending" },
  in_progress: { glyph: "◐", tone: "text-primary", words: "in progress" },
  done: { glyph: "✓", tone: "text-ok", words: "done" },
  dropped: { glyph: "–", tone: "text-muted-foreground", words: "dropped" },
};

/** Each layer's word and the weight its subject is set in: the layers read before the words. */
export const LAYER: Record<WorkTaskNode["layer"], { words: string; text: string }> = {
  plan: { words: "Plan", text: "text-base font-semibold" },
  phase: { words: "Phase", text: "text-sm font-semibold" },
  task: { words: "Task", text: "text-sm" },
};

/** The session level's word and weight, above the layers: a group, not a task. */
export const SESSION_LEVEL = { words: "Session", text: "text-sm font-medium" } as const;

/**
 * What a tree's rows can do: whether a row's own rows show, fold or open them, open the task's
 * panel, and which task the panel shows. Without a provider every row is open and opens nothing
 * (a static drawing).
 */
export interface TreeActions {
  isOpen: (task: WorkTaskNode) => boolean;
  onFold: (task: WorkTaskNode, open: boolean) => void;
  onOpen: (task: WorkTaskNode) => void;
  selected: null | string;
}

const TreeContext = createContext<TreeActions>({
  isOpen: () => true,
  onFold: () => {},
  onOpen: () => {},
  selected: null,
});

export const TreeActionsProvider = TreeContext.Provider;

/**
 * How far a subtree is: a thin bar and `closed/total`. The native meter speaks; the SVG draws.
 * With `steps`, it counts a phase's steps done instead (G3), and says so.
 */
export function Progress({
  closed,
  total,
  steps = false,
}: {
  closed: number;
  total: number;
  steps?: boolean;
}) {
  const share = total === 0 ? 0 : Math.min(1, closed / total);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <meter className="sr-only" min={0} max={total} value={closed}>
        {closed} of {total} {steps ? "steps done" : "closed"}
      </meter>
      <svg className="h-1.5 w-12" aria-hidden="true" preserveAspectRatio="none">
        <rect width="100%" height="100%" rx="3" className="fill-muted" />
        <rect width={`${share * 100}%`} height="100%" rx="3" className="fill-ok" />
      </svg>
      <span aria-hidden="true">
        {closed}/{total}
      </span>
    </span>
  );
}

/** While a task is blocked: each task it waits for, its number and its state, closed ones too. */
export function BlockedBy({ blockers }: { blockers: WorkTaskNode["blockedBy"] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
      <span className="inline-flex items-center gap-1 font-medium text-warn">
        <span aria-hidden="true">!</span>
        blocked by
      </span>
      {blockers.map((one) => {
        const status = STATUS[one.status];
        return (
          <span
            key={one.ref}
            title={`${one.ref} ${one.subject}: ${status.words}`}
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 font-mono tabular-nums",
              isClosed(one.status) ? "text-muted-foreground" : "border-warn/40 text-foreground",
            )}
          >
            {one.ref}
            <span className={cn("font-sans font-semibold", status.tone)} aria-hidden="true">
              {status.glyph}
            </span>
            <span className="sr-only">
              ({status.words}: {one.subject})
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * A phase's ledger (G3), its own line under the subject: the steps first, then the agent, branch,
 * worktree and base the main session set, each only when set. The steps are always there on a
 * counted phase, so a field that arrives joins a line already drawn: nothing below it moves.
 * A long value is cut to one line; its title, and for the worktree a screen reader, hold all of it.
 */
function PhaseLedger({ task }: { task: WorkTaskNode }) {
  const fields = ledgerOf(task);
  if (task.steps === null && fields.length === 0) return null;
  return (
    <dl
      aria-label={`Ledger of phase ${task.phase ?? task.ref}`}
      className="flex min-w-0 basis-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 pl-14 text-xs text-muted-foreground"
    >
      {task.steps !== null && (
        <div className="inline-flex items-center gap-1.5">
          <dt>steps</dt>
          <dd className="leading-5">
            {task.steps.total === 0 ? (
              "no steps yet"
            ) : (
              <Progress closed={task.steps.done} total={task.steps.total} steps />
            )}
          </dd>
        </div>
      )}
      {fields.map((field) => (
        <div key={field.key} className="inline-flex min-w-0 max-w-full items-baseline gap-1">
          <dt>{field.label}</dt>
          {/* `relative` holds the worktree's screen-reader text (an absolute span) inside the cut
              cell; without it that span sits past the cut and widens a narrow page. */}
          <dd
            className="relative min-w-0 max-w-64 truncate font-mono text-foreground"
            title={field.full}
          >
            {field.shown}
            {field.key === "worktree" && <span className="sr-only">, at {field.full}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Whose claim a task carries: a running process ("running"), or one that ended ("claim ended"). */
export function ClaimMark({ claim }: { claim: WorkTaskNode["claim"] }) {
  if (claim === "live") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-ok"
        title="A running session's process holds it"
      >
        <span aria-hidden="true">●</span>
        running
      </span>
    );
  }
  if (claim === "dead") {
    return (
      <span title="The process that claimed it has ended: another session can take it over">
        <TonePill tone="warn">claim ended</TonePill>
      </span>
    );
  }
  return null;
}

/**
 * The progress a row shows: a plan's or a phase's tasks as the server counts them from the whole
 * list (closed long ago too), a task's own subtree; none when empty. A counted phase shows its
 * steps instead.
 */
function progressOf(task: WorkTaskNode): null | { closed: number; total: number } {
  if (task.steps !== null) return null;
  const count = task.kind === "task" ? { closed: task.closed, total: task.total } : task.progress;
  return count !== null && count.total > 0 ? count : null;
}

/**
 * What a row says beside its subject: its plan or phase, non-blocking, left open under a closed
 * parent, what blocks it, its claim, its notes and how far its subtree is. Blocking is the default
 * and says nothing. A counted phase says how far it is in its ledger's steps instead.
 */
export function TaskMarks({ task, leftOpen }: { task: WorkTaskNode; leftOpen: boolean }) {
  const progress = progressOf(task);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {task.kind === "plan" && <Badge variant="outline">plan</Badge>}
      {task.kind === "phase" && <Badge variant="outline">phase {task.phase ?? ""}</Badge>}
      {task.type === "non-blocking" && (
        <Badge
          variant="outline"
          className="border-dashed text-muted-foreground"
          title="Non-blocking: noted work that holds nothing. Its parent can be done while it is open."
        >
          non-blocking
        </Badge>
      )}
      {leftOpen && <TonePill tone="info">left open</TonePill>}
      {task.blocked && <BlockedBy blockers={task.blockedBy} />}
      <ClaimMark claim={task.claim} />
      {task.notes > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MessageSquareTextIcon className="size-3.5" aria-hidden="true" />
          {task.notes === 1 ? "1 note" : `${task.notes} notes`}
        </span>
      )}
      {progress !== null && <Progress closed={progress.closed} total={progress.total} />}
    </span>
  );
}

/** The fold button of a row with rows under it; a row without keeps the same space. */
function FoldButton({
  task,
  open,
  controls,
}: {
  task: WorkTaskNode;
  open: boolean;
  controls: string;
}) {
  const { onFold } = useContext(TreeContext);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? "Fold" : "Unfold"} ${task.ref} ${task.subject}`}
      onClick={() => onFold(task, !open)}
      className="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ChevronRightIcon
        data-open={open}
        className="size-4 transition-transform data-[open=true]:rotate-90 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </button>
  );
}

function TaskRow({ shown, parentClosed }: { shown: ShownTask; parentClosed: boolean }) {
  const { isOpen, onOpen, selected } = useContext(TreeContext);
  const listId = useId();
  const { task, match } = shown;
  const status = STATUS[task.status];
  const layer = LAYER[task.layer];
  const closed = isClosed(task.status);
  const hasRows = shown.children.length > 0;
  const open = hasRows && isOpen(task);
  return (
    <li data-layer={task.layer}>
      <div
        data-selected={selected === task.id}
        className="flex flex-wrap items-start gap-x-1 rounded-md hover:bg-muted/40 data-[selected=true]:bg-muted"
      >
        {hasRows ? (
          <FoldButton task={task} open={open} controls={listId} />
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          aria-haspopup="dialog"
          // The panel gives the focus back to this button when it closes (`closePanel`).
          data-task-row={task.id}
          onClick={() => onOpen(task)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-1.5 pr-2 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span
            className={cn("w-3.5 shrink-0 text-center leading-5 font-semibold", status.tone)}
            aria-hidden="true"
            title={status.words}
          >
            {status.glyph}
          </span>
          <span className="w-9 shrink-0 font-mono text-xs leading-5 text-muted-foreground tabular-nums">
            {task.ref}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={cn(
                "min-w-0 leading-5 wrap-any",
                layer.text,
                (closed || !match) && "text-muted-foreground",
                task.status === "dropped" && "line-through decoration-muted-foreground/60",
              )}
            >
              {/* A plan's or a phase's badge names its layer; a task's says it here. */}
              <span className="sr-only">{`${task.kind === "task" ? `${layer.words}, ` : ""}${status.words}: `}</span>
              {task.subject}
            </span>
            <TaskMarks task={task} leftOpen={parentClosed && !closed} />
          </span>
        </button>
        {task.layer === "phase" && <PhaseLedger task={task} />}
      </div>
      {hasRows && (
        <TaskList
          id={listId}
          hidden={!open}
          tasks={open ? shown.children : []}
          nested
          parentClosed={closed}
        />
      )}
    </li>
  );
}

/** A level of the tree; a nested one hangs from a guide line under its parent. */
export function TaskList({
  tasks,
  nested = false,
  label,
  parentClosed = false,
  id,
  hidden = false,
}: {
  tasks: readonly ShownTask[];
  nested?: boolean;
  label?: string;
  /** The parent is done or dropped: an open task under it was left open. */
  parentClosed?: boolean;
  /** The id its parent's fold button names. */
  id?: string;
  /** Folded: the list stays in the page (the fold button names it) with nothing drawn. */
  hidden?: boolean;
}) {
  return (
    <ul
      id={id}
      hidden={hidden}
      aria-label={label}
      className={cn("flex flex-col", nested && "ml-3 border-l border-border pl-2")}
    >
      {tasks.map((shown) => (
        <TaskRow key={shown.task.id} shown={shown} parentClosed={parentClosed} />
      ))}
    </ul>
  );
}

/** The key to the tree: the session, then the three layers in their own weights, and the glyphs. */
export function TaskLegend() {
  const levels = [SESSION_LEVEL, ...Object.values(LAYER)];
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex flex-wrap items-baseline gap-1" data-legend="levels">
        {levels.map((level, index) => (
          <span key={level.words} className="inline-flex items-baseline gap-1">
            {index > 0 && <span aria-hidden="true">›</span>}
            <span className={cn("text-foreground", level.text)}>{level.words}</span>
          </span>
        ))}
      </span>
      <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {Object.values(STATUS).map((status) => (
          <span key={status.words} className="inline-flex items-baseline gap-1">
            <span className={cn("font-semibold", status.tone)} aria-hidden="true">
              {status.glyph}
            </span>
            {status.words}
          </span>
        ))}
      </span>
    </p>
  );
}
