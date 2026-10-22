"use client";

import type { ReactNode } from "react";
import type { ProjectListRow } from "@/api/types";
import { TonePill } from "@/components/status";

/**
 * Wrap a `PortalTable` in this class and, when the main column is narrower than `xl` (a
 * phone), each body row turns into a small card: the first cell takes the whole first line
 * and the other cells follow it, wrapping, instead of a table wider than the screen. The
 * header row stays for screen readers only. Classes only (no inline style), per the portal's
 * content security policy. `NarrowLabel` names a cell whose value needs its header there.
 */
export const STACK_ROWS_WHEN_NARROW = [
  "@max-xl/main:[&_[data-slot=table-header]]:sr-only",
  "@max-xl/main:[&_[data-slot=table]]:block",
  "@max-xl/main:[&_[data-slot=table-body]]:block",
  "@max-xl/main:[&_[data-slot=table-body]>tr]:flex",
  "@max-xl/main:[&_[data-slot=table-body]>tr]:flex-wrap",
  "@max-xl/main:[&_[data-slot=table-body]>tr]:items-center",
  "@max-xl/main:[&_[data-slot=table-body]>tr]:gap-x-4",
  "@max-xl/main:[&_[data-slot=table-body]>tr]:gap-y-2",
  "@max-xl/main:[&_[data-slot=table-body]>tr]:p-3",
  "@max-xl/main:[&_[data-slot=table-body]_td]:p-0",
  "@max-xl/main:[&_[data-slot=table-body]_td:first-child]:basis-full",
  "@max-xl/main:[&_[data-slot=table-body]_td:empty]:hidden",
].join(" ");

/** A cell's header, shown in front of its value only while the rows stack (see above). */
export function NarrowLabel({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="mr-1 hidden text-muted-foreground @max-xl/main:inline">
      {children}
    </span>
  );
}

/** A project's page; with `setup`, the page opens at its set-up card. */
export function projectHref(id: string, setup = false): string {
  return `/settings/project?id=${encodeURIComponent(id)}${setup ? "&setup=1" : ""}`;
}

/** A project's state, in words: set up or not, and project files not committed yet. */
export function ProjectStatePills({ project }: { project: ProjectListRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {project.setUp ? (
        <TonePill tone="ok">set up</TonePill>
      ) : (
        <TonePill tone="info">not set up</TonePill>
      )}
      {project.setUp && project.uncommitted === true && (
        <TonePill tone="warn">not committed yet</TonePill>
      )}
    </span>
  );
}
