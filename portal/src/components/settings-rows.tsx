"use client";

import { LockIcon } from "lucide-react";
import { useId, useState } from "react";
import type { SettingsRow, WorkflowSource } from "@/api/types";
import { ActionResultLine, useAction } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** The card headings, in the design's words and order (`SETTINGS_CARDS`, `src/portal/settings.ts`). */
const CARDS: readonly { card: SettingsRow["card"]; title: string; about: string }[] = [
  { card: "flow", title: "Work flow", about: "What happens by itself once a step is finished." },
  { card: "alerts", title: "Alerts", about: "When the kit tells you something, and how." },
  { card: "switches", title: "Switches", about: "Parts of the kit you can turn on or off." },
];

const SOURCE_WORDS: Record<WorkflowSource, string> = {
  personal: "yours",
  project: "this project",
  default: "default",
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** A value changed on the page, and the server's value it was changed from. */
type Draft = null | { base: unknown; value: unknown };

/** Two values the same, for a list too (`alerts.events`). */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * One setting's control, drawn from its kind. A change is saved at once through
 * `workflow.set`, the command line's own writer: a setting of the person's own straight away,
 * one the project owns after the page asks (it rewrites the project's committed file). A number
 * is saved when the field is left or Enter is pressed, not on every key.
 */
function Control({
  row,
  labelId,
  onSave,
  busy,
  draft,
  setDraft,
}: {
  row: SettingsRow;
  labelId: string;
  onSave: (value: unknown) => void;
  busy: boolean;
  draft: Draft;
  setDraft: (draft: Draft) => void;
}) {
  // A draft holds only while the server still holds the value it was made from: a new answer
  // (this save, another tab, the command line) shows what the server holds.
  const value = draft !== null && sameValue(draft.base, row.value) ? draft.value : row.value;
  const setValue = (next: unknown) => setDraft({ base: row.value, value: next });
  const disabled = row.readOnly || busy;
  const change = (next: unknown) => {
    setValue(next);
    if (!sameValue(next, row.value)) onSave(next);
  };
  switch (row.kind) {
    case "boolean":
      return (
        <Switch
          aria-labelledby={labelId}
          checked={value === true}
          onCheckedChange={change}
          disabled={disabled}
        />
      );
    case "segment":
      return (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-labelledby={labelId}
          value={typeof value === "string" ? value : ""}
          onValueChange={(next) => {
            if (next !== "") change(next);
          }}
          disabled={disabled}
        >
          {(row.choices ?? []).map((choice) => (
            <ToggleGroupItem key={choice.value} value={choice.value} className="px-3">
              {choice.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      );
    case "events": {
      const chosen = stringList(value);
      return (
        <fieldset
          aria-labelledby={labelId}
          className="flex flex-wrap gap-x-4 gap-y-2"
          disabled={disabled}
        >
          {(row.choices ?? []).map((choice) => {
            const id = `${row.id}-${choice.value}`;
            return (
              <span key={choice.value} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={chosen.includes(choice.value)}
                  onCheckedChange={(on) =>
                    change(
                      on === true
                        ? [...chosen, choice.value]
                        : chosen.filter((v) => v !== choice.value),
                    )
                  }
                  disabled={disabled}
                />
                <label htmlFor={id} className="text-sm">
                  {choice.label}
                </label>
              </span>
            );
          })}
        </fieldset>
      );
    }
    case "number": {
      const commit = () => {
        if (typeof value === "number" && Number.isFinite(value) && !sameValue(value, row.value)) {
          onSave(value);
        }
      };
      return (
        <span className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={100}
            aria-labelledby={labelId}
            className="h-8 w-20 text-right tabular-nums"
            value={typeof value === "number" ? value : ""}
            onChange={(event) => setValue(Number(event.target.value))}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </span>
      );
    }
    default:
      return null;
  }
}

function Row({ row }: { row: SettingsRow }) {
  const labelId = useId();
  const [draft, setDraft] = useState<Draft>(null);
  // A change that did not happen (a refusal) puts back what the server holds.
  const { run, state, clear } = useAction("workflow.set", (result) => {
    if (!result.ok) setDraft(null);
  });
  // A project-owned setting rewrites the project's committed file: the page asks first.
  const [asking, setAsking] = useState<null | { value: unknown }>(null);
  const save = (value: unknown) => {
    if (row.where === "project") setAsking({ value });
    else run({ key: row.key, value });
  };
  return (
    <li className="grid gap-x-6 gap-y-2 border-b py-4 last:border-b-0 @3xl/main:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span id={labelId} className="font-medium">
            {row.label}
          </span>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {SOURCE_WORDS[row.source]}
          </Badge>
        </span>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{row.help}</p>
        {row.readOnly && row.why !== null && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockIcon className="size-3" aria-hidden="true" />
            Read-only here: {row.why}.
          </p>
        )}
        <ActionResultLine state={state} />
      </div>
      <div className="flex items-start @3xl/main:justify-end">
        <Control
          row={row}
          labelId={labelId}
          onSave={save}
          busy={state.phase === "sending"}
          draft={draft}
          setDraft={setDraft}
        />
      </div>
      <ConfirmDialog
        open={asking !== null}
        title={`Change ${row.label} for this project?`}
        yes="Write it"
        onCancel={() => {
          setAsking(null);
          setDraft(null);
          clear();
        }}
        onYes={() => {
          const value = asking?.value;
          setAsking(null);
          run({ confirm: true, key: row.key, value });
        }}
      >
        It is the project's own setting: it is written into its .claude/cc-smart-dev-kit.json, for
        everyone who works in it. The review gate reads it once that file is committed and pushed.
      </ConfirmDialog>
    </li>
  );
}

/** The settings, one card per group, one row per setting: its value now and where it came from. */
export function SettingsCards({ rows }: { rows: SettingsRow[] }) {
  return (
    <>
      {CARDS.map((card) => {
        const inCard = rows.filter((row) => row.card === card.card);
        if (inCard.length === 0) return null;
        return (
          <Card key={card.card}>
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.about}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul>
                {inCard.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
