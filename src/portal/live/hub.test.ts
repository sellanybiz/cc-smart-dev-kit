/**
 * The live stream's hub, on its own: the format, the ping, `Last-Event-ID`, the cap, and
 * `closing` when the portal stops for a new version (D51, B6b).
 *
 * Each security-relevant rule is one test, and each was watched failing with the rule broken.
 */
import { describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { BUFFER_MAX, LiveHub, MAX_STREAMS, STREAM_QUEUE_MAX_BYTES } from "./hub";

/** One event as a test reads it back from the stream. */
interface ReadEvent {
  data: unknown;
  event: string;
  id: string;
}

/** A stream reader as these tests use it: `read` and `cancel` (Bun's own reader has more). */
interface StreamReader {
  cancel: () => Promise<void>;
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}

/** The events in a chunk of SSE text. */
function eventsOf(text: string): ReadEvent[] {
  const events: ReadEvent[] = [];
  for (const block of text.split("\n\n")) {
    const lines = block.split("\n");
    const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
    if (id === undefined || event === undefined || data === undefined) continue;
    events.push({ data: JSON.parse(data), event, id });
  }
  return events;
}

/** Reads until `needle` is in the text (or the time runs out), and returns what was read. */
async function readUntil(reader: StreamReader, needle: string, timeoutMs = 1_000): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const until = Date.now() + timeoutMs;
  while (!text.includes(needle) && Date.now() < until) {
    const read = await Promise.race([
      reader.read(),
      Bun.sleep(Math.max(1, until - Date.now())).then(() => ({ done: true, value: undefined })),
    ]);
    if (read.done) break;
    if (read.value !== undefined) text += decoder.decode(read.value, { stream: true });
  }
  return text;
}

/** Reads until `count` events are in the text (a whole replay), and returns what was read. */
async function readFrames(reader: StreamReader, count: number, timeoutMs = 5_000): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const until = Date.now() + timeoutMs;
  while ((text.match(/^event: /gm)?.length ?? 0) < count && Date.now() < until) {
    const read = await Promise.race([
      reader.read(),
      Bun.sleep(Math.max(1, until - Date.now())).then(() => ({ done: true, value: undefined })),
    ]);
    if (read.done) break;
    if (read.value !== undefined) text += decoder.decode(read.value, { stream: true });
  }
  return text;
}

/** Reads to the end of the stream (a closed one), and returns its text. */
async function readToEnd(reader: StreamReader, timeoutMs = 1_000): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const read = await Promise.race([
      reader.read(),
      Bun.sleep(Math.max(1, until - Date.now())).then(() => ({ done: true, value: undefined })),
    ]);
    if (read.done) break;
    if (read.value !== undefined) text += decoder.decode(read.value, { stream: true });
  }
  return text;
}

/** One open stream and its reader. */
function open(hub: LiveHub, lastEventId?: string): StreamReader {
  const headers: Record<string, string> = {};
  if (lastEventId !== undefined) headers["last-event-id"] = lastEventId;
  const opened = hub.open(new Request("http://127.0.0.1:1/events", { headers }));
  if (opened.kind !== "opened") throw new Error("the hub refused the stream");
  const body = opened.response.body;
  if (body === null) throw new Error("no body");
  return body.getReader();
}

describe("the live stream's hub", () => {
  test("a stream is an event stream, sends a hello, then each published event", async () => {
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    const opened = hub.open(new Request("http://127.0.0.1:1/events"));
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened") return;
    expect(opened.response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    // Every answer carries the door's headers, the stream included.
    expect(opened.response.headers.get("cache-control")).toBe("no-cache, no-store");
    expect(opened.response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const reader = opened.response.body?.getReader();
    if (reader === undefined) throw new Error("no body");
    try {
      const hello = eventsOf(await readUntil(reader, "event: hello"));
      expect(hello[0]?.event).toBe("hello");
      expect(hello[0]?.data).toEqual({ at: 42, boot: hub.runId });
      hub.publish("recent", { at: 7, status: 200 });
      const events = eventsOf(await readUntil(reader, "event: recent"));
      expect(events.find((one) => one.event === "recent")?.data).toEqual({ at: 7, status: 200 });
    } finally {
      await reader.cancel();
      hub.stop();
    }
  });

  test("a ping arrives on a stream that has nothing to say", async () => {
    const hub = new LiveHub({ now: () => 42, pingMs: 10 });
    const reader = open(hub);
    try {
      const text = await readUntil(reader, "event: ping", 1_000);
      expect(eventsOf(text).some((one) => one.event === "ping")).toBe(true);
    } finally {
      await reader.cancel();
      hub.stop();
    }
  });

  test("Last-Event-ID replays what the page missed, and then says hello again", async () => {
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    const first = open(hub);
    const helloText = await readUntil(first, "event: hello");
    const hello = eventsOf(helloText)[0];
    if (hello === undefined) throw new Error("no hello");
    await first.cancel();
    hub.publish("recent", { at: 1 });
    hub.publish("crew", { id: "c1" });
    const again = open(hub, hello.id);
    try {
      const text = await readUntil(again, "event: hello");
      const events = eventsOf(text);
      expect(events.map((one) => one.event)).toEqual(["recent", "crew", "hello"]);
      expect(events[0]?.data).toEqual({ at: 1 });
      expect(events[1]?.data).toEqual({ id: "c1" });
    } finally {
      await again.cancel();
      hub.stop();
    }
  });

  test("an id from another run resets the page instead of replaying", async () => {
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    const reader = open(hub, "another-run:4");
    try {
      const text = await readUntil(reader, "event: hello");
      expect(eventsOf(text).map((one) => one.event)).toEqual(["reset", "hello"]);
    } finally {
      await reader.cancel();
      hub.stop();
    }
  });

  test("a gap older than the buffer resets", async () => {
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    for (let index = 0; index < BUFFER_MAX + 2; index += 1) hub.publish("recent", { index });
    const reader = open(hub, `${hub.runId}:1`);
    try {
      const text = await readUntil(reader, "event: hello");
      expect(eventsOf(text)[0]?.event).toBe("reset");
    } finally {
      await reader.cancel();
      hub.stop();
    }
  });

  test("at most eight streams, and a closed one gives its place back", async () => {
    // The owner's rule is eight, not "whatever the constant says": the number is the promise.
    expect(MAX_STREAMS).toBe(8);
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    const readers = [];
    for (let index = 0; index < MAX_STREAMS; index += 1) readers.push(open(hub));
    expect(hub.streamsOpen).toBe(MAX_STREAMS);
    const refused = hub.open(new Request("http://127.0.0.1:1/events"));
    expect(refused.kind).toBe("refused");
    const first = readers[0];
    if (first === undefined) throw new Error("no stream");
    await first.cancel();
    expect(hub.streamsOpen).toBe(MAX_STREAMS - 1);
    const opened = hub.open(new Request("http://127.0.0.1:1/events"));
    expect(opened.kind).toBe("opened");
    for (const reader of readers.slice(1)) await reader.cancel();
    if (opened.kind === "opened") await opened.response.body?.cancel();
    hub.stop();
  });

  test("closing tells every stream the portal is going, then ends it", async () => {
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    const reader = open(hub);
    await readUntil(reader, "event: hello");
    hub.closing();
    const text = await readToEnd(reader);
    expect(text).toContain("event: closing");
    expect(eventsOf(text).at(-1)?.event).toBe("closing");
    expect(hub.streamsOpen).toBe(0);
  });

  test("a published event is kept for a page that connects after it", async () => {
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    hub.publish("jobs", { heldGb: 2 });
    const reader = open(hub, `${hub.runId}:0`);
    try {
      const text = await readUntil(reader, "event: hello");
      expect(eventsOf(text).map((one) => one.event)).toEqual(["jobs", "hello"]);
    } finally {
      await reader.cancel();
      hub.stop();
    }
  });

  test("a ping is never kept for a reconnect: only real events are", async () => {
    // Pings every 5 ms, and enough of them that they alone would fill a small buffer.
    const hub = new LiveHub({ now: () => 42, pingMs: 5 });
    const first = open(hub);
    const helloText = await readUntil(first, "event: hello");
    const hello = eventsOf(helloText)[0];
    if (hello === undefined) throw new Error("no hello");
    // The stream stays open, so its timer really pings, and the pings would be kept if they
    // were events.
    await Bun.sleep(40);
    hub.publish("recent", { at: 7 });
    const again = open(hub, hello.id);
    try {
      const text = await readUntil(again, "event: hello");
      // What it missed: the real event, never the pings that came with it.
      expect(eventsOf(text).map((one) => one.event)).toEqual(["recent", "hello"]);
      expect(text).not.toContain("event: ping");
    } finally {
      await again.cancel();
      await first.cancel();
      hub.stop();
    }
  });

  test("a stream that stops reading is closed once its queue passes the bound", async () => {
    // A bound small enough for a test: the queue is bytes, so the events pass it.
    const hub = new LiveHub({ maxQueueBytes: 128, now: () => 42, pingMs: 60_000 });
    const reader = open(hub);
    expect(hub.streamsOpen).toBe(1);
    // Nobody reads this stream: its chunks pile up until the queue is past the bound.
    for (let index = 0; index < 6; index += 1) hub.publish("recent", { pad: "x".repeat(80) });
    expect(hub.streamsOpen).toBe(0);
    await reader.cancel();
    hub.stop();
  });

  test("a full replay of realistic size fits under the byte bound", async () => {
    // The stream's most frequent event is a crew event: one per step or state change, with a
    // line, the sha it happened at and the memory reading. A page that reconnects may replay
    // the whole buffer, so the bound must leave room for `BUFFER_MAX` of them with their
    // framing — and this is that replay, measured on the stream itself.
    expect(STREAM_QUEUE_MAX_BYTES).toBe(1_048_576);
    const hub = new LiveHub({ now: () => 42, pingMs: 60_000 });
    const event = {
      at: "2026-10-23T08:00:00.000Z",
      crew: "PF2-pf1-findings-1a2b3c",
      lead: "c00f9bb5-1111-2222-3333-444444444444",
      memoryMb: 1234,
      name: "C cc-smart-dev PF2 pf1-findings",
      note: null,
      sha: "7f441b2f0e0d9c8b7a6f5e4d3c2b1a09f8e7d6c5",
      state: "working",
      text: "tests-green: 2678 pass, 0 fail across 64 files; two steps left in the phase",
      type: "state",
      version: 1,
    };
    for (let index = 0; index < BUFFER_MAX; index += 1) hub.publish("crew", event);
    const reader = open(hub, `${hub.runId}:0`);
    try {
      const text = await readFrames(reader, BUFFER_MAX + 1);
      // The whole replay, then the hello: nothing was closed part-way, and every event is there.
      expect(
        eventsOf(text)
          .map((one) => one.event)
          .filter((one) => one === "crew").length,
      ).toBe(BUFFER_MAX);
      const bytes = new TextEncoder().encode(text).byteLength;
      // A real replay, not a handful of tiny events: this one is about 200 KB, five times
      // under the bound.
      expect(bytes).toBeGreaterThan(150_000);
      expect(bytes).toBeLessThan(STREAM_QUEUE_MAX_BYTES);
    } finally {
      await reader.cancel();
      hub.stop();
    }
  });

  /** One served stream and the tools a test publishes and ends it with. */
  interface ServedStream {
    hub: LiveHub;
    /** Publishes `n` events of about 1 KB each; answers how many were published in all. */
    publish: (n: number) => number;
    socket: ReturnType<typeof connect>;
    stop: () => void;
  }

  /**
   * A real server with the hub on `/events`, and a raw `net` socket that opens the stream. The
   * publisher sends at most 10 events a tick: a bigger burst fills the stream's own queue by
   * itself, and would close a reader that reads as well as one that stopped, proving nothing
   * about a stall.
   */
  async function serveAndConnect(read: boolean): Promise<ServedStream> {
    const hub = new LiveHub({ maxQueueBytes: 64 * 1_024, now: () => 42, pingMs: 60_000 });
    const server = Bun.serve({
      fetch(request) {
        if (new URL(request.url).pathname !== "/events") return new Response("no");
        // A quiet stream is not an idle connection, exactly as the portal serves it (`server.ts`).
        server.timeout(request, 0);
        const opened = hub.open(request);
        return opened.kind === "opened" ? opened.response : new Response("busy", { status: 429 });
      },
      port: 0,
    });
    const port = server.port ?? 0;
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET /events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAccept: text/event-stream\r\n\r\n`,
      );
    });
    socket.on("error", () => undefined);
    // No `data` listener: the kernel stops taking bytes once the receive buffer fills, and
    // Bun's writes back up — the stall a sleeping laptop or a broken tab makes. With one, the
    // socket drains and the stream never queues anything.
    if (read) socket.on("data", () => undefined);
    const openedBy = Date.now() + 2_000;
    while (hub.streamsOpen === 0 && Date.now() < openedBy) await Bun.sleep(5);
    expect(hub.streamsOpen).toBe(1);
    let published = 0;
    return {
      hub,
      publish: (n: number) => {
        for (let index = 0; index < n; index += 1) {
          hub.publish("recent", { pad: "x".repeat(1_000), n: published + index });
        }
        published += n;
        return published;
      },
      socket,
      stop: () => server.stop(true),
    };
  }

  test("a reader that stops reading is closed at the server, not only in the hub", async () => {
    // Bun's own `fetch` reads a response body into memory by itself, so only a raw socket that
    // stops shows the stall. The bound closes the stream once the kernel's buffers are full and
    // the queue passes it; the cap keeps a buggy bound from hanging the test.
    const world = await serveAndConnect(false);
    try {
      let published = 0;
      while (world.hub.streamsOpen > 0 && published < 8_192) {
        published = world.publish(10);
        await Bun.sleep(1);
      }
      // The stalled stream gave its place back; a page reconnects and resumes by its last id.
      expect(world.hub.streamsOpen).toBe(0);
    } finally {
      world.socket.destroy();
      world.stop();
    }
  });

  test("a reader that reads is never closed by the bound", async () => {
    // The control: the same server, the same events, a socket that reads. If the bound fired
    // on volume rather than on a stall, this stream would close too.
    const world = await serveAndConnect(true);
    try {
      for (let tick = 0; tick < 100; tick += 1) {
        world.publish(10);
        await Bun.sleep(1);
      }
      expect(world.hub.streamsOpen).toBe(1);
    } finally {
      world.socket.destroy();
      world.stop();
    }
  });
});
