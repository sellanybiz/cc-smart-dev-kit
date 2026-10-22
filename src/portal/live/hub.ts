/**
 * The portal's live stream: `GET /events`, Server-Sent Events (D51).
 *
 * One-way is enough: the pages fetch their data over `/api/…` and change things with a POST,
 * so the stream only carries what changed since. `EventSource` cannot set a header, so the
 * route is a GET and goes through the door's network rules alone (Host, Origin,
 * `Sec-Fetch-Site`); the token is not needed to read (D9), and nothing here changes anything.
 *
 * The rules the stream keeps:
 *
 *   - **At most `MAX_STREAMS` at once.** Every open stream is a socket and a timer held for as
 *     long as the person leaves the tab open; a page with many tabs (or a script) must not be
 *     able to hold the portal's memory without end. The next connection is refused with 429.
 *   - **A ping on every stream** every `PING_MS`, so a proxy, a laptop's sleep or a closed
 *     window is noticed, and the page can show "reconnecting" instead of old values.
 *   - **`Last-Event-ID` resumes.** Every event carries `<boot>:<sequence>`, and the last
 *     `BUFFER_MAX` events are kept: a reconnect replays what it missed. A page whose id is from
 *     another run of the portal (a restart, a new version) is sent one `reset`, and fetches its
 *     pages again — ids from a stopped process mean nothing to this one.
 *   - **`closing` when the server stops** (a new version taking over): every stream is told,
 *     then closed, and the page reloads onto the new portal. It is written before the close, so
 *     a client that reads to the end still sees it.
 *
 * Nothing secret is ever published here: the pages' own facts, request metadata, states and
 * short lines — never a key, an address with a credential, or a prompt (`.claude/rules/portal.md`).
 */

import { securityHeaders } from "../guard";

/** How many streams one portal serves at once. */
export const MAX_STREAMS = 8;

/** How often a stream says it is still there: milliseconds. */
export const PING_MS = 15_000;

/** How many events a reconnect may replay. */
export const BUFFER_MAX = 512;

/** One event as the buffer keeps it. */
interface BufferedEvent {
  data: unknown;
  event: string;
  seq: number;
}

/** What a stream is, inside the hub: where its bytes go, and how it ends. */
interface Stream {
  close: () => void;
  write: (text: string) => boolean;
}

/** Why a stream could not open: the hub's only refusal. */
export type OpenResult = { kind: "refused" } | { kind: "opened"; response: Response };

/** The SSE format of one event: one `id:`, one `event:`, one `data:` line, then a blank line. */
function frame(boot: string, entry: BufferedEvent): string {
  // `JSON.stringify` never writes a raw line break, which is what a `data:` line needs.
  return `id: ${boot}:${entry.seq}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`;
}

/** Random bytes as hex: a run of the portal a `Last-Event-ID` can be told apart by. */
function newBootId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The hub of one portal process: its open streams, its recent events, and the ids a
 * reconnecting page resumes from. Every method is safe to call when nothing is open.
 */
export class LiveHub {
  private readonly boot = newBootId();
  private readonly buffer: BufferedEvent[] = [];
  private readonly streams = new Set<Stream>();
  private nextSeq = 1;
  private closed = false;

  constructor(
    private readonly options: {
      maxStreams?: number;
      now?: () => number;
      pingMs?: number;
    } = {},
  ) {}

  /** How many streams are open now (for the cap, and for a test). */
  get streamsOpen(): number {
    return this.streams.size;
  }

  /** The id this run's events carry (`<boot>:<seq>`): for a test's `Last-Event-ID`. */
  get runId(): string {
    return this.boot;
  }

  /**
   * Opens one stream. The caller has already passed the door. A refusal is "too many": the
   * server answers it with one word, and the page shows that its other tabs hold the stream.
   */
  open(request: Request): OpenResult {
    if (this.closed || this.streams.size >= (this.options.maxStreams ?? MAX_STREAMS)) {
      return { kind: "refused" };
    }
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let timer: null | ReturnType<typeof setInterval> = null;
    let ended = false;
    const stream: Stream = {
      close: () => {
        if (ended) return;
        ended = true;
        if (timer !== null) clearInterval(timer);
        this.streams.delete(stream);
        try {
          controller?.close();
        } catch {
          // Already closed: a cancel and a close can race, and both are done.
        }
      },
      write: (text: string): boolean => {
        if (ended) return false;
        try {
          controller?.enqueue(encoder.encode(text));
          return true;
        } catch {
          // The client went away between a ping and this write: drop the stream.
          stream.close();
          return false;
        }
      },
    };
    const body = new ReadableStream<Uint8Array>({
      start: (started) => {
        controller = started;
        this.streams.add(stream);
        timer = setInterval(() => {
          stream.write(frame(this.boot, this.event("ping", { at: this.now() })));
        }, this.options.pingMs ?? PING_MS);
        // The replay, then a hello: a page that reconnects learns what it missed and which
        // run of the portal it is talking to. A page from another run is told to reset.
        const last = request.headers.get("last-event-id");
        if (last !== null) {
          const resumed = this.resume(last);
          if (resumed === null) {
            if (!stream.write(frame(this.boot, this.event("reset", { boot: this.boot })))) return;
          } else {
            for (const entry of resumed) {
              if (!stream.write(frame(this.boot, entry))) return;
            }
          }
        }
        stream.write(frame(this.boot, this.event("hello", { at: this.now(), boot: this.boot })));
        request.signal.addEventListener("abort", () => stream.close());
      },
      cancel: () => stream.close(),
    });
    return {
      kind: "opened",
      response: new Response(body, {
        headers: {
          ...securityHeaders(),
          "cache-control": "no-cache, no-store",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
        },
      }),
    };
  }

  /**
   * Publishes one event to every open stream and keeps it for a reconnect. A portal with no
   * streams keeps the last `BUFFER_MAX` all the same: a page that opens a moment later
   * resumes from its own last id, not from a gap.
   */
  publish(event: string, data: unknown): void {
    if (this.closed) return;
    const entry = this.event(event, data);
    const text = frame(this.boot, entry);
    for (const stream of [...this.streams]) stream.write(text);
  }

  /**
   * Ends every stream, telling it the portal is going (a new version is taking over) before
   * it closes. The page reloads itself onto the new one; the id it holds means nothing there.
   */
  closing(): void {
    if (this.closed) return;
    const text = frame(this.boot, this.event("closing", { at: this.now() }));
    for (const stream of [...this.streams]) {
      stream.write(text);
      stream.close();
    }
    this.stop();
  }

  /** Stops the timers and closes every stream. The server is stopping. */
  stop(): void {
    this.closed = true;
    for (const stream of [...this.streams]) stream.close();
    this.streams.clear();
  }

  /** One buffered event, in order. */
  private event(event: string, data: unknown): BufferedEvent {
    const entry: BufferedEvent = { data, event, seq: this.nextSeq };
    this.nextSeq += 1;
    this.buffer.push(entry);
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
    return entry;
  }

  /**
   * The events after `last`, when it names this run and its place is still in the buffer; null
   * when the page must reset (another run, or a gap older than the buffer keeps).
   */
  private resume(last: string): BufferedEvent[] | null {
    const at = last.lastIndexOf(":");
    if (at < 0) return null;
    if (last.slice(0, at) !== this.boot) return null;
    const seq = Number(last.slice(at + 1));
    if (!Number.isInteger(seq) || seq < 0) return null;
    const first = this.buffer[0];
    // A gap: the oldest event kept is already newer than the page's place.
    if (first !== undefined && seq < first.seq - 1) return null;
    return this.buffer.filter((entry) => entry.seq > seq);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
