"use client";

import { ArrowRightLeftIcon, LoaderCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import type { TaskSession, WorkTaskNode } from "@/api/types";
import { ActionResultLine, useAction } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { claimCount, sessionLabel } from "@/lib/task-groups";

/** The sessions work can move to: running in the project, named, and not its own. */
export function moveTargets(node: WorkTaskNode, sessions: readonly TaskSession[]): TaskSession[] {
  return sessions.filter((one) => one.live && one.name !== null && one.id !== node.session);
}

/** What a move takes, in words: "this task", or "this plan and the 70 under it". */
function whatMoves(node: WorkTaskNode): string {
  return node.total === 0
    ? `this ${node.kind}`
    : `this ${node.kind} and the ${node.total} under it`;
}

/** What the confirmation says of the claims: still held, ended, or none. */
function ClaimWords({ node }: { node: WorkTaskNode }) {
  const live = claimCount(node, "live");
  const dead = claimCount(node, "dead");
  if (live > 0) {
    return (
      <p className="text-warn">
        <span aria-hidden="true">! </span>A running process still holds{" "}
        {live === 1 ? "1 task" : `${live} tasks`} here. Taking it over moves the work while that
        session may still be on it.
      </p>
    );
  }
  if (dead > 0) {
    return (
      <p>
        The process that held {dead === 1 ? "1 task" : `${dead} tasks`} here has ended: nothing runs
        it now.
      </p>
    );
  }
  return <p>No process holds it now.</p>;
}

/**
 * "Move to session…" on a plan or a task: it asks first (`ConfirmDialog`), naming the session it
 * leaves, the one it goes to, and whether the old claim is still live, then runs `task.take`,
 * the command line's own take-over, and shows its result in place. A live claim is taken only
 * with the person's yes, and then with `force` and `confirm` (the action refuses force alone).
 */
export function MoveToSession({
  node,
  sessions,
  onDone,
}: {
  node: WorkTaskNode;
  sessions: readonly TaskSession[];
  onDone: () => void;
}) {
  const targets = moveTargets(node, sessions);
  const [asking, setAsking] = useState(false);
  const [target, setTarget] = useState<null | string>(null);
  const { run, state } = useAction("task.take", () => onDone());
  const selectId = useId();
  const helpId = useId();
  const chosen = targets.find((one) => one.id === target) ?? targets[0];
  const from = sessions.find((one) => one.id === node.session) ?? null;
  const fromName =
    node.session === null
      ? "no session recorded"
      : sessionLabel({
          id: node.session,
          session: from ?? { id: node.session, live: false, name: null },
        });
  const live = claimCount(node, "live") > 0;
  const sending = state.phase === "sending";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={targets.length === 0 || sending}
        aria-busy={sending}
        aria-describedby={targets.length === 0 ? helpId : undefined}
        onClick={() => setAsking(true)}
      >
        {sending ? (
          <LoaderCircleIcon
            data-icon="inline-start"
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <ArrowRightLeftIcon data-icon="inline-start" aria-hidden="true" />
        )}
        Move to session…
      </Button>
      {targets.length === 0 && (
        <p id={helpId} className="text-xs text-pretty text-muted-foreground">
          No other named session runs in this project now. A session can take it over once it runs
          here with a name.
        </p>
      )}
      <ActionResultLine state={state} />
      {chosen !== undefined && (
        <ConfirmDialog
          open={asking}
          title={`Move ${node.ref} to another session?`}
          yes={live ? "Take it over anyway" : "Move it"}
          tone={live ? "destructive" : "default"}
          onCancel={() => setAsking(false)}
          onYes={() => {
            setAsking(false);
            run({
              session: chosen.id,
              task: node.id,
              ...(live ? { confirm: true, force: true } : {}),
            });
          }}
        >
          <div className="flex flex-col gap-3">
            <p>
              It moves {whatMoves(node)} from{" "}
              <strong className="text-foreground">{fromName}</strong> to the session you pick. Its
              notes and history stay.
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor={selectId} className="text-xs font-medium text-foreground">
                To session
              </label>
              <NativeSelect
                id={selectId}
                size="sm"
                value={chosen.id}
                onChange={(event) => setTarget(event.target.value)}
              >
                {targets.map((one) => (
                  <NativeSelectOption key={one.id} value={one.id}>
                    {one.name ?? one.id}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <ClaimWords node={node} />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
