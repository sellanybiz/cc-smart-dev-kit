"use client";

import { PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { ActionButton } from "@/components/action-button";

/** The states a crew session is running in: Stop is offered there (the Work view's own list). */
export const RUNNING_STATES: readonly string[] = [
  "starting",
  "working",
  "blocked",
  "paused",
  "quiet",
];

/** The states `crew rm` may end: merged by the lead, waiting in the queue, or finished. */
const REMOVABLE_STATES: readonly string[] = [
  "done",
  "failed",
  "handoff",
  "merged",
  "queued",
  "stopped",
];

/**
 * Stop, Resume and Remove for one crew session: the person's own clicks (D52), each the same
 * command `crew stop|resume|rm` runs, each asked first in words that say what it does. The
 * command judges the state itself; a refusal is shown in its own words beside the button.
 */
export function CrewActions({
  crew,
}: {
  crew: { id: string; name: string; shortId: null | string; state: string };
}) {
  const running = RUNNING_STATES.includes(crew.state);
  const resumable =
    !running &&
    crew.shortId !== null &&
    crew.state !== "merged" &&
    crew.state !== "removed" &&
    crew.state !== "queued";
  const removable = REMOVABLE_STATES.includes(crew.state);
  const body = { crew: crew.id };
  return (
    <div className="flex flex-wrap items-start gap-2">
      {running && (
        <ActionButton
          action="crew.stop"
          body={body}
          variant="outline"
          icon={<SquareIcon data-icon="inline-start" aria-hidden="true" />}
          confirm={{
            title: `Stop ${crew.name}?`,
            body: "Its Claude session stops now. Its conversation is kept: Resume, or claude attach, brings it back.",
            yes: "Stop it",
            tone: "destructive",
          }}
        >
          Stop
        </ActionButton>
      )}
      {resumable && (
        <ActionButton
          action="crew.resume"
          body={body}
          variant="outline"
          icon={<PlayIcon data-icon="inline-start" aria-hidden="true" />}
          confirm={{
            title: `Resume ${crew.name}?`,
            body: "Its Claude session starts again with its conversation, on its own model, and spends that model's usage while it works.",
            yes: "Resume it",
          }}
        >
          Resume
        </ActionButton>
      )}
      {removable && (
        <ActionButton
          action="crew.rm"
          body={body}
          variant="outline"
          icon={<Trash2Icon data-icon="inline-start" aria-hidden="true" />}
          confirm={{
            title: `Remove ${crew.name}?`,
            body: "This ends it for good, stopping at the first refusal: its branch must be merged into the lead's branch and its worktree must hold nothing uncommitted; then its session, its worktree and its branch go. Nothing is forced.",
            yes: "Remove it",
            tone: "destructive",
          }}
        >
          {crew.state === "merged" ? "Remove after merge" : "Remove"}
        </ActionButton>
      )}
    </div>
  );
}
