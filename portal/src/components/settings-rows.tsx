"use client";

import { LockIcon } from "lucide-react";
import { useId, useState } from "react";
import type { SettingsRow, WorkflowSource } from "@/api/types";
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

/** One setting's control, drawn from its kind; a change stays in the page (a draft). */
function Control({ row, labelId }: { row: SettingsRow; labelId: string }) {
  const [value, setValue] = useState<unknown>(row.value);
  const disabled = row.readOnly;
  switch (row.kind) {
    case "boolean":
      return (
        <Switch
          aria-labelledby={labelId}
          checked={value === true}
          onCheckedChange={setValue}
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
            if (next !== "") setValue(next);
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
                    setValue(
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
    case "number":
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
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </span>
      );
    default:
      return null;
  }
}

function Row({ row }: { row: SettingsRow }) {
  const labelId = useId();
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
      </div>
      <div className="flex items-start @3xl/main:justify-end">
        <Control row={row} labelId={labelId} />
      </div>
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
