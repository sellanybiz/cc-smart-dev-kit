"use client";

import type { ProjectListRow } from "@/api/types";
import { TonePill } from "@/components/status";

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
