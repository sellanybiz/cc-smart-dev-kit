"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayNotSetUpError, type PortalClient, portalClient } from "./client";
import { PortalRequestError } from "./http";
import type { LiveMessage } from "./stream";
import type { Connection } from "./types";
import type { LiveEventName } from "./wire";

/** What a page has of one resource: still loading, failed (and why), or the data. */
export type Resource<T> =
  | { status: "loading" }
  | {
      status: "error";
      message: string;
      gateway: boolean;
      /** The server has nothing by that name (404): a link back helps, asking again does not. */
      missing: boolean;
    }
  | { status: "ready"; data: T };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Which events make a resource read again: their names, or a test of the event itself (an
 * action of a given name). `reset` always does: the stream could not say what changed.
 */
export type RefreshOn = readonly LiveEventName[] | ((message: LiveMessage) => boolean);

/** How long a burst of events is gathered before one read: a crew step, an action's lines. */
export const REFRESH_DEBOUNCE_MS = 300;

function wants(refreshOn: RefreshOn | undefined, message: LiveMessage): boolean {
  if (message.name === "reset") return true;
  if (refreshOn === undefined) return false;
  return typeof refreshOn === "function" ? refreshOn(message) : refreshOn.includes(message.name);
}

/**
 * Reads one resource through the portal's client. `key` names what the read depends on (a
 * window, a project id): a new key reads again and shows the loading state. `refreshOn` names
 * the live events that change it: the resource is read again in the background, and the page
 * keeps what it shows until the new answer is there (no flash, no full reload). `reload` asks
 * again, for the error state.
 */
export function useResource<T>(
  read: (client: PortalClient) => Promise<T>,
  key = "",
  refreshOn?: RefreshOn,
): Resource<T> & { reload: () => void; refresh: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [fresh, setFresh] = useState(0);
  // Which read an answer belongs to: an answer for an older key or attempt is never shown.
  const ticket = `${key}#${attempt}`;
  const [answer, setAnswer] = useState<{ ticket: string; resource: Resource<T> } | null>(null);
  // The latest `read` and `refreshOn`, without making a new function a reason to read again.
  const readRef = useRef(read);
  readRef.current = read;
  const refreshRef = useRef(refreshOn);
  refreshRef.current = refreshOn;

  useEffect(() => {
    let live = true;
    // `fresh` counts the background reads: the first read (0) shows its error, a later one not.
    const background = fresh > 0;
    readRef.current(portalClient()).then(
      (data) => {
        if (live) setAnswer({ ticket, resource: { status: "ready", data } });
      },
      (error: unknown) => {
        if (!live) return;
        setAnswer((before) =>
          // A background read that fails keeps what the page shows: the stream's own state
          // ("Reconnecting…") says the facts may be old. Only a first read shows the error.
          background && before?.ticket === ticket && before.resource.status === "ready"
            ? before
            : {
                ticket,
                resource: {
                  status: "error",
                  message: messageOf(error),
                  gateway: error instanceof GatewayNotSetUpError,
                  missing: error instanceof PortalRequestError && error.status === 404,
                },
              },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [ticket, fresh]);

  const refresh = useCallback(() => setFresh((n) => n + 1), []);
  useEffect(() => {
    let timer: null | number = null;
    const stop = portalClient().onEvent((message) => {
      if (!wants(refreshRef.current, message)) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        refresh();
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      stop();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const resource: Resource<T> =
    answer !== null && answer.ticket === ticket ? answer.resource : { status: "loading" };
  return { ...resource, refresh, reload };
}

/** Calls `listener` with each live event while the component is mounted. */
export function useLiveEvent(listener: (message: LiveMessage) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => portalClient().onEvent((message) => ref.current(message)), []);
}

/** The live stream's state, for the header. */
export function useConnection(): Connection {
  const [state, setState] = useState<Connection>("live");
  useEffect(() => portalClient().connection(setState), []);
  return state;
}
