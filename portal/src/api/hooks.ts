"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayNotSetUpError, type PortalClient, portalClient } from "./client";
import type { Connection } from "./types";

/** What a page has of one resource: still loading, failed (and why), or the data. */
export type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string; gateway: boolean }
  | { status: "ready"; data: T };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads one resource through the portal's client. `key` names what the read depends on (a
 * window, a project id): a new key reads again. `reload` asks again, for the error state.
 */
export function useResource<T>(
  read: (client: PortalClient) => Promise<T>,
  key = "",
): Resource<T> & { reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  // Which read an answer belongs to: an answer for an older key or attempt is never shown.
  const ticket = `${key}#${attempt}`;
  const [answer, setAnswer] = useState<{ ticket: string; resource: Resource<T> } | null>(null);
  // The latest `read`, without making a new function a reason to read again.
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    let live = true;
    readRef.current(portalClient()).then(
      (data) => {
        if (live) setAnswer({ ticket, resource: { status: "ready", data } });
      },
      (error: unknown) => {
        if (live) {
          setAnswer({
            ticket,
            resource: {
              status: "error",
              message: messageOf(error),
              gateway: error instanceof GatewayNotSetUpError,
            },
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [ticket]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const resource: Resource<T> =
    answer !== null && answer.ticket === ticket ? answer.resource : { status: "loading" };
  return { ...resource, reload };
}

/** The live stream's state, for the header. */
export function useConnection(): Connection {
  const [state, setState] = useState<Connection>("live");
  useEffect(() => portalClient().connection(setState), []);
  return state;
}
