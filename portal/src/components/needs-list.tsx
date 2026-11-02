"use client";

import {
  CircleCheckIcon,
  CircleHelpIcon,
  KeyRoundIcon,
  PackageIcon,
  ShieldAlertIcon,
  StethoscopeIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useId, useState } from "react";
import type { ActionResult } from "@/api/client";
import type { NeedsItem } from "@/api/types";
import { ActionButton, ActionResultLine } from "@/components/action-button";
import { CommandLine } from "@/components/copy-button";
import { HeldMajorActions } from "@/components/held-major";
import { AppLink } from "@/components/router";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ago, count, slotName, until } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND: Record<NeedsItem["kind"], { icon: typeof CircleHelpIcon; label: string }> = {
  question: { icon: CircleHelpIcon, label: "A question" },
  permission: { icon: KeyRoundIcon, label: "A permission prompt" },
  update: { icon: PackageIcon, label: "A held update" },
  doctor: { icon: StethoscopeIcon, label: "A doctor check fails" },
  breaker: { icon: ShieldAlertIcon, label: "A breaker is open" },
};

/** Called when an item's action ends: the list keeps its result after the item is gone. */
type OnSettled = (result: ActionResult) => void;

function CrewLink({ id, name }: { id: string; name: string }) {
  return (
    <AppLink
      href={`/work/crew?id=${encodeURIComponent(id)}`}
      className="font-medium underline-offset-4 hover:underline focus-visible:underline"
    >
      {name}
    </AppLink>
  );
}

/** What the page asks before an answer goes: the answer itself, and that the session goes on. */
function answerConfirm(item: Extract<NeedsItem, { kind: "question" }>, answer: string) {
  return {
    title: `Answer question ${item.ask.number} from ${item.crew.name}?`,
    body: (
      <>
        <span className="block font-medium text-foreground">“{answer}”</span>
        <span className="mt-2 block">
          It goes to the crew session as the lead's answer. Other open questions still wait for an
          answer.
        </span>
      </>
    ),
    yes: "Send the answer",
  };
}

/** A crew session's question: each option sends it as the answer; a free answer can be typed. */
function QuestionActions({
  item,
  onSettled,
}: {
  item: Extract<NeedsItem, { kind: "question" }>;
  onSettled: OnSettled;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  const own = text.trim();
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={`Answers to ${item.crew.name}`} className="flex flex-col gap-2">
        {item.ask.options.map((option, index) => {
          const recommended = item.ask.recommended === index + 1;
          return (
            <li key={option} className="flex flex-wrap items-start gap-2">
              <ActionButton
                action="crew.answer"
                body={{ answer: option, crew: item.crew.id, question: item.ask.number }}
                variant={recommended ? "default" : "outline"}
                className="h-auto min-h-8 max-w-full justify-start py-1.5 text-left whitespace-normal"
                confirm={answerConfirm(item, option)}
                onDone={onSettled}
              >
                <span className="mr-1 tabular-nums opacity-70" aria-hidden="true">
                  {index + 1}.
                </span>
                {option}
              </ActionButton>
              {recommended && (
                <Badge variant="outline" className="mt-1.5 text-muted-foreground">
                  recommended
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex max-w-xl flex-wrap items-start gap-2">
        <label htmlFor={inputId} className="sr-only">
          Your own answer to {item.crew.name}
        </label>
        <Input
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Or write your own answer"
          className="h-8 min-w-0 flex-1 basis-56"
        />
        <ActionButton
          action="crew.answer"
          body={{ answer: own, crew: item.crew.id, question: item.ask.number }}
          variant="outline"
          disabled={own === ""}
          confirm={answerConfirm(item, own)}
          onDone={onSettled}
        >
          Send
        </ActionButton>
      </div>
    </div>
  );
}

/** The targets of an open breaker, each with its status and how long it still rests. */
function BreakerTargets({ item }: { item: Extract<NeedsItem, { kind: "breaker" }> }) {
  if (item.breaker.targets.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {item.breaker.targets.map((target) => (
        <li key={target.target}>
          <span className="font-mono">{target.target}</span>:{" "}
          {target.status === null ? "down" : `answered ${target.status}`}, free again{" "}
          {until(target.until)}
        </li>
      ))}
    </ul>
  );
}

function Body({ item, onSettled }: { item: NeedsItem; onSettled: OnSettled }): {
  who: ReactNode;
  what: ReactNode;
  action: ReactNode;
} {
  switch (item.kind) {
    case "question":
      return {
        who: <CrewLink id={item.crew.id} name={item.crew.name} />,
        what: (
          <>
            Question {item.ask.number}: {item.ask.question}
          </>
        ),
        action: <QuestionActions item={item} onSettled={onSettled} />,
      };
    case "permission": {
      const crew = item.crew;
      return {
        who:
          crew === null ? (
            <span className="font-medium">{item.project === "" ? "A session" : item.project}</span>
          ) : (
            <CrewLink id={crew.id} name={crew.name} />
          ),
        what: (
          <>
            It waits on a <span className="font-medium">{item.tool}</span> prompt ({item.detail}).
            {item.attach === null
              ? " Answer it in the terminal it runs in."
              : " Open it in a terminal to answer it:"}
          </>
        ),
        action: item.attach === null ? null : <CommandLine command={item.attach} label="Copy" />,
      };
    }
    case "update":
      return {
        who: <span className="font-medium">cc-smart-dev-kit {item.held.version}</span>,
        what: `A major version waits for your yes. You run ${item.installed}.`,
        action: <HeldMajorActions held={item.held} onDone={onSettled} />,
      };
    case "doctor":
      return {
        who: <span className="font-medium">{item.section === "" ? "doctor" : item.section}</span>,
        what: item.text,
        action:
          item.fix === null ? (
            <p className="text-sm text-muted-foreground">
              doctor names no fix for it: run doctor in a terminal for the details.
            </p>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Fix:</span>
              <CommandLine command={item.fix} label="Copy" />
            </span>
          ),
      };
    case "breaker": {
      const { held, heldNow } = item.breaker;
      const waiting =
        heldNow === null
          ? "How many wait right now is not known (the router did not answer)"
          : `${count(heldNow)} request${heldNow === 1 ? "" : "s"} wait${heldNow === 1 ? "s" : ""} right now`;
      return {
        who: <span className="font-medium">The {slotName(item.slot)} slot</span>,
        what: `Every target is limited or down. ${waiting}; ${count(held)} held since it opened. Give it another target on Slots, or let Claude answer it:`,
        action: (
          <div className="flex flex-col gap-2">
            <BreakerTargets item={item} />
            <CommandLine command={item.command} label="Copy" />
          </div>
        ),
      };
    }
  }
}

/** One thing that waits for you: what it is, who it is about, since when, and the action. */
export function NeedsItemView({
  item,
  compact = false,
  onSettled,
}: {
  item: NeedsItem;
  compact?: boolean;
  onSettled?: OnSettled;
}) {
  const { icon: Icon, label } = KIND[item.kind];
  const { who, what, action } = Body({ item, onSettled: onSettled ?? (() => {}) });
  return (
    <li className={cn("flex gap-3", compact ? "py-3" : "py-4")}>
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
          item.kind === "breaker" || item.kind === "doctor"
            ? "border-bad/30 text-bad"
            : "border-warn/30 text-warn",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-muted-foreground">{label}:</span>
          {who}
          <span className="text-xs text-muted-foreground">{ago(item.since)}</span>
        </p>
        <p className={cn("text-sm text-pretty", compact && "line-clamp-2")}>{what}</p>
        {!compact && action !== null && <div className="mt-1">{action}</div>}
      </div>
    </li>
  );
}

/** An item the person acted on and the list no longer holds: what it was, and the result. */
function SettledItemView({ item, result }: { item: NeedsItem; result: ActionResult }) {
  const { label } = KIND[item.kind];
  const who =
    item.kind === "question" ? item.crew.name : item.kind === "update" ? item.held.version : "";
  return (
    <li className="flex gap-3 py-4">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-ok/30 text-ok">
        <CircleCheckIcon className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
          <span>{label}:</span>
          <span className="font-medium text-foreground">{who}</span>
          <span className="text-xs">no longer waits</span>
        </p>
        <ActionResultLine state={{ phase: "done", result }} />
      </div>
    </li>
  );
}

/**
 * Every item, newest first. An item whose action succeeded leaves the server's list on the next
 * read; the list keeps it, settled, with its result, so the answer stays in place (no reload).
 */
export function NeedsList({
  items,
  compact = false,
  empty = null,
}: {
  items: NeedsItem[];
  compact?: boolean;
  /** What shows when nothing waits and nothing was just settled. */
  empty?: ReactNode;
}) {
  const [settled, setSettled] = useState<Record<string, { item: NeedsItem; result: ActionResult }>>(
    {},
  );
  const settle = useCallback((item: NeedsItem, result: ActionResult) => {
    if (!result.ok) return;
    setSettled((before) => ({ ...before, [item.id]: { item, result } }));
  }, []);
  const live = new Set(items.map((item) => item.id));
  const rows = [
    ...items.map((item) => ({ item, result: null })),
    ...Object.values(settled).filter((entry) => !live.has(entry.item.id)),
  ].sort((a, b) => Date.parse(b.item.since) - Date.parse(a.item.since));
  if (rows.length === 0) return empty;
  return (
    <ul className="flex flex-col divide-y">
      {rows.map(({ item, result }) =>
        result === null ? (
          <NeedsItemView
            key={item.id}
            item={item}
            compact={compact}
            onSettled={(done) => settle(item, done)}
          />
        ) : (
          <SettledItemView key={item.id} item={item} result={result} />
        ),
      )}
    </ul>
  );
}
