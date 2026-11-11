"use client";

import { useCallback, useEffect, useState } from "react";
import { KIT_NAME } from "@/lib/format";
import type { Folds } from "@/lib/task-groups";

/** Where the Tasks tab keeps which levels a person folded or opened, in this browser only. */
export const FOLDS_KEY = `${KIT_NAME}-portal-task-folds`;

/** At most this many choices are kept: the oldest go first, so the entry never grows without end. */
export const FOLDS_KEPT = 500;

/** The stored folds, or none when the entry is missing, unreadable or not ours. */
export function parseFolds(text: null | string): Record<string, boolean> {
  if (text === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const folds: Record<string, boolean> = {};
  for (const [key, folded] of Object.entries(value)) {
    if (typeof folded === "boolean") folds[key] = folded;
  }
  return folds;
}

/** The folds with these choices made, the newest last, cut to `FOLDS_KEPT`. */
export function withFolds(
  folds: Folds,
  keys: readonly string[],
  folded: boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> = { ...folds };
  for (const key of keys) {
    delete next[key];
    next[key] = folded;
  }
  const entries = Object.entries(next);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - FOLDS_KEPT)));
}

/**
 * The Tasks tab's remembered folds. They are read after the first draw (a static page has no
 * storage on the server) and written on each change; a browser that blocks storage keeps them
 * for the page's life only.
 */
export function useFolds(): {
  folds: Folds;
  setFolds: (keys: readonly string[], folded: boolean) => void;
} {
  const [folds, setState] = useState<Folds>({});
  useEffect(() => {
    try {
      setState(parseFolds(window.localStorage.getItem(FOLDS_KEY)));
    } catch {
      // Private mode or blocked site data: every level starts at its default.
    }
  }, []);
  const setFolds = useCallback((keys: readonly string[], folded: boolean) => {
    setState((before) => {
      const next = withFolds(before, keys, folded);
      try {
        window.localStorage.setItem(FOLDS_KEY, JSON.stringify(next));
      } catch {
        // A choice that cannot be stored still applies for this page.
      }
      return next;
    });
  }, []);
  return { folds, setFolds };
}
