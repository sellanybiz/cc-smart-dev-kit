"use client";

import { useCallback, useMemo } from "react";
import { useResource } from "@/api/hooks";
import type { HistoryBy, HistoryFilter, HistoryRange } from "@/api/types";
import { useAppQuery, useSetAppQuery } from "@/components/router";
import {
  DEFAULT_RANGE,
  filterFromQuery,
  filterKey,
  isBy,
  isRange,
  queryWithFilter,
} from "@/lib/history";

/** Session id → the name a person reads (its session name, else its project and short id). */
export function useSessionNames(): Map<string, string> {
  const keys = useResource((client) => client.historyKeys());
  const sessions = keys.status === "ready" ? keys.data.sessions : null;
  return useMemo(
    () =>
      new Map(
        (sessions ?? []).map((session) => [
          session.id,
          session.name ?? `${session.project} ${session.id.slice(0, 8)}`,
        ]),
      ),
    [sessions],
  );
}

export interface HistoryState {
  range: HistoryRange;
  by: HistoryBy;
  filter: HistoryFilter;
  /** A stable text of the range and the filter (not `by`), for a read's key. */
  key: string;
  setRange: (range: HistoryRange) => void;
  setBy: (by: HistoryBy) => void;
  setFilter: (filter: HistoryFilter) => void;
}

/**
 * A page's range, breakdown and filters, kept in its address (`?range=7d&by=slot&slot=…`), so a
 * view can be shared and reloaded. Every chart and table on the page reads the same state.
 */
export function useHistoryState(defaultBy: HistoryBy = "target"): HistoryState {
  const query = useAppQuery();
  const setQuery = useSetAppQuery();
  const rangeText = query.get("range");
  const byText = query.get("by");
  const range: HistoryRange = isRange(rangeText) ? rangeText : DEFAULT_RANGE;
  const by: HistoryBy = isBy(byText) ? byText : defaultBy;
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const write = useCallback(
    (change: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(query);
      change(next);
      setQuery(next);
    },
    [query, setQuery],
  );
  return {
    range,
    by,
    filter,
    key: `${range}|${filterKey(filter)}`,
    setRange: (value) =>
      write((next) => (value === DEFAULT_RANGE ? next.delete("range") : next.set("range", value))),
    setBy: (value) =>
      write((next) => (value === defaultBy ? next.delete("by") : next.set("by", value))),
    setFilter: (value) => setQuery(queryWithFilter(query, value)),
  };
}
