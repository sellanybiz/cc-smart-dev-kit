"use client";

import { useId, useState } from "react";
import type { HeldMajor } from "@/api/types";
import { ActionButton } from "@/components/action-button";
import { Button } from "@/components/ui/button";

/** A held major version's What's new, and its Install (D33). One home: Needs you and Machine. */
export function HeldMajorActions({ held }: { held: HeldMajor }) {
  const [open, setOpen] = useState(false);
  const notesId = useId();
  return (
    <div className="flex flex-col gap-2">
      <ul id={notesId} hidden={!open} className="list-disc space-y-1 pl-5 text-sm">
        {held.notes.length === 0 ? (
          <li>The new version says nothing about the change.</li>
        ) : (
          held.notes.map((note) => <li key={note}>{note}</li>)
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          aria-controls={notesId}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide What's new" : "Read What's new"}
        </Button>
        <ActionButton
          action="update.install"
          body={{}}
          confirm={{
            title: `Install ${held.version}?`,
            body: "It is a major version: read What's new first. Running sessions keep their version until they start again.",
            yes: `Install ${held.version}`,
          }}
        >
          Install {held.version}
        </ActionButton>
      </div>
    </div>
  );
}
