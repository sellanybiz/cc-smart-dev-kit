/**
 * The live stream as a page holds it, with a fake `EventSource`, a fake lock and a fake
 * channel: one stream for every tab, the state for the header, a new stream after one that
 * ended for good, and the reload when the portal says it is going for a new version.
 */
import { describe, expect, test } from "bun:test";
import {
  type ChannelLike,
  type EventSourceLike,
  type LiveMessage,
  RETRY_FIRST_MS,
  type StreamWorld,
  startLiveStream,
} from "./stream";
import type { Connection } from "./types";

class FakeSource implements EventSourceLike {
  static made: FakeSource[] = [];
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {
    FakeSource.made.push(this);
  }
  addEventListener(name: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  /** The server sends one event. */
  send(name: string, data: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new MessageEvent(name, { data: JSON.stringify(data) }));
    }
  }
  /** The connection drops: CONNECTING (the browser retries) or CLOSED (it gave up). */
  fail(readyState: 0 | 2): void {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }
}

/** Every channel of one browser: a message one posts reaches the others, never itself. */
function channels(): new (name: string) => ChannelLike {
  const all: FakeChannel[] = [];
  class FakeChannel implements ChannelLike {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    constructor(readonly name: string) {
      all.push(this);
    }
    postMessage(message: unknown): void {
      for (const other of all) {
        if (other !== this) other.onmessage?.(new MessageEvent("message", { data: message }));
      }
    }
    close(): void {
      all.splice(all.indexOf(this), 1);
    }
  }
  return FakeChannel;
}

/** One lock for every tab: the first asks gets it, the next waits until it is released. */
function locks() {
  let held = false;
  const queue: (() => Promise<void>)[] = [];
  const next = () => {
    const callback = queue.shift();
    if (callback === undefined) return;
    held = true;
    void callback().then(() => {
      held = false;
      next();
    });
  };
  return {
    request(_name: string, callback: () => Promise<void>): Promise<unknown> {
      queue.push(callback);
      if (!held) next();
      return Promise.resolve();
    },
  };
}

function world(overrides: Partial<StreamWorld> = {}): StreamWorld & {
  reloads: number;
  timers: { ms: number; run: () => void }[];
} {
  const timers: { ms: number; run: () => void }[] = [];
  const self = {
    EventSource: FakeSource,
    clearTimeout: () => undefined,
    reload: () => {
      self.reloads += 1;
    },
    reloads: 0,
    setTimeout: (run: () => void, ms: number) => {
      timers.push({ ms, run });
      return timers.length;
    },
    timers,
    ...overrides,
  };
  return self;
}

describe("the live stream", () => {
  test("one stream, its state for the header, and each event in order", () => {
    FakeSource.made = [];
    const fake = world();
    const stream = startLiveStream("/events", fake);
    const states: Connection[] = [];
    const seen: LiveMessage[] = [];
    stream.connection((state) => states.push(state));
    stream.on((message) => seen.push(message));
    expect(FakeSource.made.map((source) => source.url)).toEqual(["/events"]);
    const source = FakeSource.made[0];
    source?.send("hello", { at: 1, boot: "b1" });
    source?.send("recent", {
      at: 2,
      ms: 5,
      nextTarget: false,
      slot: null,
      status: 200,
      target: "x",
    });
    source?.fail(0);
    expect(states).toEqual(["reconnecting", "live", "reconnecting"]);
    expect(seen.map((message) => message.name)).toEqual(["hello", "recent"]);
    // The browser's own reconnect resumes by id: no new stream, and no reset of the page.
    source?.send("hello", { at: 3, boot: "b1" });
    expect(FakeSource.made).toHaveLength(1);
    expect(seen.map((message) => message.name)).toEqual(["hello", "recent", "hello"]);
    stream.stop();
  });

  test("a stream that ended for good is opened again after a pause, and the page is told to reset", () => {
    FakeSource.made = [];
    const fake = world();
    const stream = startLiveStream("/events", fake);
    const seen: string[] = [];
    stream.on((message) => seen.push(message.name));
    FakeSource.made[0]?.send("hello", { at: 1, boot: "b1" });
    FakeSource.made[0]?.fail(2);
    expect(fake.timers.map((timer) => timer.ms)).toEqual([RETRY_FIRST_MS]);
    fake.timers[0]?.run();
    expect(FakeSource.made).toHaveLength(2);
    // The new stream fails too, before any hello: the next pause is longer.
    FakeSource.made[1]?.fail(2);
    expect(fake.timers.map((timer) => timer.ms)).toEqual([RETRY_FIRST_MS, RETRY_FIRST_MS * 2]);
    fake.timers[1]?.run();
    FakeSource.made[2]?.send("hello", { at: 2, boot: "b1" });
    // The new stream had no id to resume from: the page reads its facts again.
    expect(seen).toEqual(["hello", "reset", "hello"]);
    // A stream that said hello starts the pauses over.
    FakeSource.made[2]?.fail(2);
    expect(fake.timers.at(-1)?.ms).toBe(RETRY_FIRST_MS);
    stream.stop();
  });

  test("closing: the page reloads once the new portal says hello", () => {
    FakeSource.made = [];
    const fake = world();
    const stream = startLiveStream("/events", fake);
    FakeSource.made[0]?.send("hello", { at: 1, boot: "old" });
    FakeSource.made[0]?.send("closing", { at: 2 });
    expect(fake.reloads).toBe(0);
    FakeSource.made[0]?.fail(0);
    FakeSource.made[0]?.send("hello", { at: 3, boot: "new" });
    expect(fake.reloads).toBe(1);
    stream.stop();
  });
});

test("two tabs share one stream: the leader's events and state reach the follower", async () => {
  FakeSource.made = [];
  const Channel = channels();
  const lock = locks();
  const leader = startLiveStream("/events", world({ BroadcastChannel: Channel, locks: lock }));
  const follower = startLiveStream("/events", world({ BroadcastChannel: Channel, locks: lock }));
  await Promise.resolve();
  expect(FakeSource.made).toHaveLength(1);
  const states: Connection[] = [];
  const seen: string[] = [];
  follower.connection((state) => states.push(state));
  follower.on((message) => seen.push(message.name));
  FakeSource.made[0]?.send("hello", { at: 1, boot: "b1" });
  FakeSource.made[0]?.send("tasks", { at: 1 });
  expect(states).toEqual(["reconnecting", "live"]);
  expect(seen).toEqual(["hello", "tasks"]);
  // The leader's tab closes: the follower takes the lock and opens its own stream, and,
  // having had a stream before, tells its page to read again.
  leader.stop();
  await Promise.resolve();
  await Promise.resolve();
  expect(FakeSource.made).toHaveLength(2);
  FakeSource.made[1]?.send("hello", { at: 2, boot: "b1" });
  expect(seen).toEqual(["hello", "tasks", "reset", "hello"]);
  follower.stop();
});
