"use client";

import type { WorkTaskNode } from "@/api/types";
import { TonePill } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { isClosed, type ShownTask } from "@/lib/tasks";
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
  subtask: { words: "Subtask", text: "text-[0.8125rem]" },
};

/** How far a subtree is: a thin bar and `closed/total`. The native meter speaks; the SVG draws. */
export function Progress({ closed, total }: { closed: number; total: number }) {
  const share = total === 0 ? 0 : Math.min(1, closed / total);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <meter className="sr-only" min={0} max={total} value={closed}>
        {closed} of {total} closed
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
function BlockedBy({ blockers }: { blockers: WorkTaskNode["blockedBy"] }) {
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
 * What a row says beside its subject: its plan or phase, non-blocking, left open under a closed
 * parent, what blocks it, and how far its subtree is. Blocking is the default and says nothing.
 */
export function TaskMarks({ task, leftOpen }: { task: WorkTaskNode; leftOpen: boolean }) {
  const marks =
    task.kind !== "task" ||
    task.type === "non-blocking" ||
    leftOpen ||
    task.blocked ||
    task.total > 0;
  if (!marks) return null;
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
      {task.total > 0 && <Progress closed={task.closed} total={task.total} />}
    </span>
  );
}

function TaskRow({ shown, parentClosed }: { shown: ShownTask; parentClosed: boolean }) {
  const { task, match } = shown;
  const status = STATUS[task.status];
  const layer = LAYER[task.layer];
  const closed = isClosed(task.status);
  return (
    <li data-layer={task.layer}>
      <div className="flex items-start gap-2 py-1">
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
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
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
        </div>
      </div>
      {shown.children.length > 0 && (
        <TaskList tasks={shown.children} nested parentClosed={closed} />
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
}: {
  tasks: readonly ShownTask[];
  nested?: boolean;
  label?: string;
  /** The parent is done or dropped: an open task under it was left open. */
  parentClosed?: boolean;
}) {
  return (
    <ul
      aria-label={label}
      className={cn("flex flex-col", nested && "ml-1.5 border-l border-border pl-4")}
    >
      {tasks.map((shown) => (
        <TaskRow key={shown.task.id} shown={shown} parentClosed={parentClosed} />
      ))}
    </ul>
  );
}

/** The key to the tree: the four layers in their own weights, and the status glyphs. */
export function TaskLegend() {
  const layers = Object.values(LAYER);
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex flex-wrap items-baseline gap-1">
        {layers.map((layer, index) => (
          <span key={layer.words} className="inline-flex items-baseline gap-1">
            {index > 0 && <span aria-hidden="true">›</span>}
            <span className={cn("text-foreground", layer.text)}>{layer.words}</span>
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
