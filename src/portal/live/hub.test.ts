/**
 * The live stream's hub, on its own: the format, the ping, `Last-Event-ID`, the cap, and
 * `closing` when the portal stops for a new version (D51, B6b).
 *
 * Each security-relevant rule is one test, and each was watched failing with the rule broken.
 */
import { describe, expect, test } from "bun:test";
import { BUFFER_MAX, LiveHub, MAX_STREAMS } from "./hub";

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
});
