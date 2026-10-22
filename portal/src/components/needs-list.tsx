"use client";

import {
  CircleHelpIcon,
  KeyRoundIcon,
  PackageIcon,
  ShieldAlertIcon,
  StethoscopeIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { NeedsItem } from "@/api/types";
import { ActionButton } from "@/components/action-button";
import { CopyButton } from "@/components/copy-button";
import { HeldMajorActions } from "@/components/held-major";
import { AppLink } from "@/components/router";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ago, slotName } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND: Record<NeedsItem["kind"], { icon: typeof CircleHelpIcon; label: string }> = {
  question: { icon: CircleHelpIcon, label: "A question" },
  permission: { icon: KeyRoundIcon, label: "A permission prompt" },
  update: { icon: PackageIcon, label: "A held update" },
  doctor: { icon: StethoscopeIcon, label: "A doctor check fails" },
  breaker: { icon: ShieldAlertIcon, label: "A breaker is open" },
};

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

/** A crew session's question: each option sends it as the answer; a free answer can be typed. */
function QuestionActions({ item }: { item: Extract<NeedsItem, { kind: "question" }> }) {
  const [text, setText] = useState("");
  const inputId = useId();
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Options" className="flex flex-col gap-2">
        {item.ask.options.map((option, index) => {
          const recommended = item.ask.recommended === index + 1;
          return (
            <li key={option} className="flex flex-wrap items-center gap-2">
              <ActionButton
                action="crew.answer"
                body={{ name: item.crew.name, text: option }}
                variant={recommended ? "default" : "outline"}
              >
                {option}
              </ActionButton>
              {recommended && (
                <Badge variant="outline" className="text-muted-foreground">
                  recommended
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex max-w-xl items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Your own answer to {item.crew.name}
        </label>
        <Input
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Or write your own answer"
          className="h-8"
        />
        <ActionButton
          action="crew.answer"
          body={{ name: item.crew.name, text: text.trim() }}
          variant="outline"
          disabled={text.trim() === ""}
        >
          Send
        </ActionButton>
      </div>
    </div>
  );
}

function Body({ item }: { item: NeedsItem }): {
  who: ReactNode;
  what: ReactNode;
  action: ReactNode;
} {
  switch (item.kind) {
    case "question":
      return {
        who: <CrewLink id={item.crew.id} name={item.crew.name} />,
        what: item.ask.question,
        action: <QuestionActions item={item} />,
      };
    case "permission":
      return {
        who: <CrewLink id={item.crew.id} name={item.crew.name} />,
        what: (
          <>
            It waits on a <span className="font-medium">{item.tool}</span> prompt: {item.detail}.
            Open it in a terminal to answer.
          </>
        ),
        action:
          item.crew.shortId === null ? null : (
            <CopyButton
              text={`claude attach ${item.crew.shortId}`}
              label="Copy the attach command"
            />
          ),
      };
    case "update":
      return {
        who: <span className="font-medium">cc-smart-dev-kit {item.held.version}</span>,
        what: `A major version waits for your yes. You run ${item.installed}.`,
        action: <HeldMajorActions held={item.held} />,
      };
    case "doctor":
      return {
        who: <span className="font-medium">doctor, {item.section}</span>,
        what: item.text,
        action:
          item.fix === null ? null : (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Fix:</span>
              <code className="font-mono text-xs">{item.fix}</code>
              <CopyButton text={item.fix} label="Copy" />
            </span>
          ),
      };
    case "breaker":
      return {
        who: <span className="font-medium">The {slotName(item.slot)} slot</span>,
        what: `Every target is limited or down: ${item.breaker.heldNow} request${item.breaker.heldNow === 1 ? "" : "s"} wait${item.breaker.heldNow === 1 ? "s" : ""}, ${item.breaker.held} held so far. Give it another target, or let Claude answer it:`,
        action: (
          <span className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs">{item.command}</code>
            <CopyButton text={item.command} label="Copy" />
          </span>
        ),
      };
  }
}

/** One thing that waits for you: what it is, who it is about, since when, and the action. */
export function NeedsItemView({ item, compact = false }: { item: NeedsItem; compact?: boolean }) {
  const { icon: Icon, label } = KIND[item.kind];
  const { who, what, action } = Body({ item });
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

export function NeedsList({ items, compact = false }: { items: NeedsItem[]; compact?: boolean }) {
  return (
    <ul className="flex flex-col divide-y">
      {items.map((item) => (
        <NeedsItemView key={item.id} item={item} compact={compact} />
      ))}
    </ul>
  );
}
