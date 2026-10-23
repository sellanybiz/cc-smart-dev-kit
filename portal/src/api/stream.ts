/**
 * The live stream, as the page holds it: one `EventSource('/events')` for every tab of the
 * portal, its events handed to whoever listens, and its state for the header.
 *
 * - **One stream for all tabs.** The server serves at most eight streams (`MAX_STREAMS`), so
 *   the tabs elect a leader with the Web Locks API: the tab that holds the lock opens the one
 *   `EventSource` and passes every event to the others over a `BroadcastChannel`. When the
 *   leader's tab closes, its lock is released and the next tab takes over. A browser without
 *   either API opens a stream per tab, which is what the cap is for.
 * - **`Last-Event-ID` resumes.** `EventSource` reconnects by itself and sends the id of the
 *   last event it got, so the server replays what was missed (or says `reset`). A stream that
 *   ends for good (the server answered with an error, such as 429) is opened again after a
 *   growing pause, 2 s up to 30 s; a new stream has no id to resume from, so the page is told
 *   to `reset` and fetches its facts again. A new leader does the same.
 * - **`closing`**: the portal is stopping for a new version. The page reloads once the new
 *   portal says `hello`: its files (and this script) are the new version's.
 *
 * Everything here is in the page's own memory. Nothing is stored, and nothing is sent: the
 * stream is read-only.
 */

import type { Connection } from "./types";
import type { LiveEventName, LiveEvents } from "./wire";

/** Every event the server sends, so each gets a listener (`EventSource` has none for "any"). */
export const LIVE_EVENTS: readonly LiveEventName[] = [
  "action",
  "closing",
  "crew",
  "doctor",
  "guard-ask",
  "hello",
  "jobs",
  "ping",
  "recent",
  "reset",
  "state",
  "update",
];

/** One event as a listener gets it. */
export type LiveMessage = {
  [K in LiveEventName]: { name: K; data: LiveEvents[K] };
}[LiveEventName];

/** The first and the longest pause before a stream that ended for good is opened again. */
export const RETRY_FIRST_MS = 2_000;
export const RETRY_MAX_MS = 30_000;

/** The lock and the channel the tabs share. */
const LOCK_NAME = "ccsdk-portal-events";
const CHANNEL_NAME = "ccsdk-portal-events";

/** What a tab says to the others over the channel. */
type ChannelMessage =
  | { kind: "event"; message: LiveMessage }
  | { kind: "state"; state: Connection }
  /** A new follower asks the leader for its state. */
  | { kind: "ask" };

/** The parts of the browser the stream uses, so a test can hand in fakes. */
export interface StreamWorld {
  EventSource: new (url: string) => EventSourceLike;
  BroadcastChannel?: (new (name: string) => ChannelLike) | undefined;
  locks?: LocksLike | undefined;
  reload: () => void;
  setTimeout: (run: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

export interface EventSourceLike {
  readyState: number;
  addEventListener(name: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
  onopen: ((event: Event) => void) | null;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

export interface LocksLike {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
}

/** `EventSource.CLOSED`: the stream ended for good, and will not reconnect by itself. */
const CLOSED = 2;

export interface LiveStream {
  /** Calls `listener` with every event; returns the unsubscribe. */
  on(listener: (message: LiveMessage) => void): () => void;
  /** Calls `listener` with the state now and on every change; returns the unsubscribe. */
  connection(listener: (state: Connection) => void): () => void;
  /** Ends the stream (a test; the page keeps it for its whole life). */
  stop(): void;
}

/**
 * Starts the stream for this tab: as the leader when it can take the lock, else as a follower
 * of the tab that holds it.
 */
export function startLiveStream(url: string, world: StreamWorld): LiveStream {
  const listeners = new Set<(message: LiveMessage) => void>();
  const watchers = new Set<(state: Connection) => void>();
  let state: Connection = "reconnecting";
  let stopped = false;
  let source: EventSourceLike | null = null;
  let retryTimer: null | number = null;
  let retryMs = RETRY_FIRST_MS;
  /** True once this tab has had a `hello`: a later new stream means the page may be stale. */
  let helloSeen = false;
  let reloadOnHello = false;
  let releaseLock: (() => void) | null = null;
  const channel =
    world.BroadcastChannel === undefined ? null : new world.BroadcastChannel(CHANNEL_NAME);

  function setState(next: Connection, share: boolean): void {
    if (next !== state) {
      state = next;
      for (const watcher of [...watchers]) watcher(next);
    }
    if (share) channel?.postMessage({ kind: "state", state: next } satisfies ChannelMessage);
  }

  function deliver(message: LiveMessage): void {
    if (message.name === "closing") reloadOnHello = true;
    if (message.name === "hello") {
      if (reloadOnHello) {
        world.reload();
        return;
      }
      helloSeen = true;
    }
    for (const listener of [...listeners]) listener(message);
  }

  /** The leader's side: one event from the server, to this tab and to the others. */
  function fromServer(message: LiveMessage): void {
    deliver(message);
    channel?.postMessage({ kind: "event", message } satisfies ChannelMessage);
  }

  function open(): void {
    if (stopped) return;
    const fresh = new world.EventSource(url);
    source = fresh;
    // A new stream has no id to resume from: when this tab already had a stream (its own, or
    // the old leader's), what the page holds may be older than what the server knows, so the
    // page is told to fetch again. The browser's own reconnects of this stream resume by id.
    let greeted = false;
    for (const name of LIVE_EVENTS) {
      fresh.addEventListener(name, (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          // A line this page cannot read is not an event: the next one is.
          return;
        }
        if (name === "hello") {
          setState("live", true);
          retryMs = RETRY_FIRST_MS;
          if (helloSeen && !greeted) fromServer({ data: { boot: "" }, name: "reset" });
          greeted = true;
        }
        fromServer({ data, name } as LiveMessage);
      });
    }
    fresh.onopen = () => setState("live", true);
    fresh.onerror = () => {
      setState("reconnecting", true);
      // Still CONNECTING: the browser retries by itself, with `Last-Event-ID`. CLOSED: it gave
      // up (an error status), so a new stream is opened after a pause that grows each time.
      if (fresh.readyState !== CLOSED || stopped) return;
      fresh.close();
      if (source === fresh) source = null;
      retryTimer = world.setTimeout(() => {
        retryTimer = null;
        open();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
  }

  function lead(): Promise<void> {
    // Held for as long as this tab lives: the lock goes with the tab, or with `stop`.
    return new Promise<void>((resolve) => {
      releaseLock = resolve;
      open();
    });
  }

  if (channel !== null) {
    channel.onmessage = (event) => {
      const message = event.data as ChannelMessage;
      if (message.kind === "ask") {
        // Only the leader has a stream, and only it answers.
        if (source !== null) channel.postMessage({ kind: "state", state } satisfies ChannelMessage);
        return;
      }
      if (source !== null) return;
      if (message.kind === "state") setState(message.state, false);
      else if (message.kind === "event") deliver(message.message);
    };
  }

  if (world.locks !== undefined && channel !== null) {
    void world.locks.request(LOCK_NAME, lead);
    // A follower learns the leader's state at once instead of showing "Reconnecting…".
    channel.postMessage({ kind: "ask" } satisfies ChannelMessage);
  } else {
    open();
  }

  return {
    connection(listener) {
      watchers.add(listener);
      listener(state);
      return () => watchers.delete(listener);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      if (retryTimer !== null) world.clearTimeout(retryTimer);
      source?.close();
      source = null;
      channel?.close();
      releaseLock?.();
    },
  };
}
