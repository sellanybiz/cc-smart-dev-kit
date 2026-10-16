/**
 * The tab filter's socket layer (`cdp-tab-filter-server.ts`), over real WebSockets: a fake
 * Chrome with two clients on it, each playing one Claude session's Playwright.
 *
 * This is the test that proves the promise the shared browser makes: two sessions on ONE
 * Chrome, each seeing only its own windows, and a session that lets go closing only its own.
 * The real Playwright and the real Chrome are driven by `cc-smart-dev-kit browser check`.
 */
import { describe, expect, test } from "bun:test";
import { serveTabFilter, type TabFilterServer } from "./cdp-tab-filter-server";

/** A WebSocket client that plays Playwright: id-matched answers, and the events it heard. */
class Client {
  private readonly answers = new Map<number, (message: Record<string, unknown>) => void>();
  readonly events: Record<string, unknown>[] = [];
  nextId = 1;

  constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (typeof message.id === "number") {
        const waiting = this.answers.get(message.id);
        this.answers.delete(message.id);
        waiting?.(message);
        return;
      }
      this.events.push(message);
    };
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((done) => this.answers.set(id, done));
  }

  close(): void {
    this.socket.close();
  }

  /** The pages Chrome told this client about (`Target.attachedToTarget`). */
  attachedPages(): string[] {
    return this.events
      .filter((event) => event.method === "Target.attachedToTarget")
      .map(
        (event) =>
          ((event.params as { targetInfo: { targetId: string } }).targetInfo.targetId ??
            "") as string,
      );
  }
}

/** A fake Chrome over CDP: it makes pages, tells every client about each, and closes them. */
function fakeChrome(): {
  closed: string[];
  pages: () => string[];
  url: string;
  stop: () => void;
} {
  const closed: string[] = [];
  const pages: string[] = [];
  let nextPage = 1;
  let nextSession = 1;
  const server = Bun.serve({
    fetch(request, self) {
      if (self.upgrade(request, { data: undefined })) return undefined;
      return new Response("no");
    },
    hostname: "127.0.0.1",
    port: 0,
    websocket: {
      message(ws, data) {
        const message = JSON.parse(String(data)) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          sessionId?: string;
        };
        if (typeof message.id !== "number") return;
        const answer = (result: Record<string, unknown>) =>
          ws.send(JSON.stringify({ id: message.id, result }));
        switch (message.method) {
          case "Target.createTarget": {
            const targetId = `P${String(nextPage++)}`;
            pages.push(targetId);
            answer({ targetId });
            // Chrome tells EVERY client that auto-attached about the new page — the reason
            // the filter exists. Each connection gets its own session id for it.
            for (const client of server.subscribers ?? []) {
              client.send(
                JSON.stringify({
                  method: "Target.attachedToTarget",
                  params: {
                    sessionId: `S${String(nextSession++)}`,
                    targetInfo: { targetId, type: "page" },
                    waitingForDebugger: false,
                  },
                }),
              );
            }
            return;
          }
          case "Target.closeTarget": {
            closed.push(String(message.params?.targetId ?? ""));
            answer({ success: true });
            return;
          }
          case "Target.getTargets":
            answer({ targetInfos: pages.map((targetId) => ({ targetId, type: "page" })) });
            return;
          default:
            answer({});
        }
      },
      open(ws) {
        server.subscribers.push(ws);
      },
      close(ws) {
        const at = server.subscribers.indexOf(ws);
        if (at >= 0) server.subscribers.splice(at, 1);
      },
    },
  }) as Bun.Server<undefined> & { subscribers: Bun.ServerWebSocket<undefined>[] };
  server.subscribers = [];
  if (server.port === undefined) throw new Error("the fake Chrome has no port");
  return {
    closed,
    pages: () => pages,
    stop: () => {
      void server.stop(true);
    },
    url: `ws://127.0.0.1:${String(server.port)}/`,
  };
}

async function client(endpoint: string): Promise<Client> {
  const socket = new WebSocket(endpoint);
  await new Promise<void>((done, fail) => {
    socket.onopen = () => {
      done();
    };
    socket.onerror = () => {
      fail(new Error("could not connect to the tab filter"));
    };
  });
  return new Client(socket);
}

/** A filter in front of a fake Chrome, with its own log kept. */
function filterOn(chrome: { url: string }, log: string[] = []): TabFilterServer {
  return serveTabFilter({
    browserEndpoint: () => Promise.resolve(chrome.url),
    downloadsPath: "/tmp/cc-smart-dev-kit-test-downloads",
    log: (line) => log.push(line),
  });
}

describe("the tab filter's socket", () => {
  test("two sessions on one Chrome: each sees only its own page", async () => {
    const chrome = fakeChrome();
    const filter = filterOn(chrome);
    try {
      const a = await client(filter.endpoint);
      const b = await client(filter.endpoint);
      const forA = await a.call("Target.createTarget", { url: "about:blank" });
      const forB = await b.call("Target.createTarget", { url: "about:blank" });
      expect(forA.result).toEqual({ targetId: "P1" });
      expect(forB.result).toEqual({ targetId: "P2" });

      const listA = await a.call("Target.getTargets");
      const listB = await b.call("Target.getTargets");
      expect(
        ((listA.result as { targetInfos: { targetId: string }[] }).targetInfos ?? []).map(
          (info) => info.targetId,
        ),
      ).toEqual(["P1"]);
      expect(
        ((listB.result as { targetInfos: { targetId: string }[] }).targetInfos ?? []).map(
          (info) => info.targetId,
        ),
      ).toEqual(["P2"]);

      // Chrome told both clients about every page; each client heard about its own only.
      expect(a.attachedPages()).toEqual(["P1"]);
      expect(b.attachedPages()).toEqual(["P2"]);
      expect(chrome.pages()).toEqual(["P1", "P2"]);
    } finally {
      await filter.close();
      chrome.stop();
    }
  });

  test("a session that lets go closes its own pages, and the Chrome stays", async () => {
    const chrome = fakeChrome();
    const filter = filterOn(chrome);
    try {
      const a = await client(filter.endpoint);
      const b = await client(filter.endpoint);
      await a.call("Target.createTarget", { url: "about:blank" });
      await b.call("Target.createTarget", { url: "about:blank" });
      const closing = await a.call("Browser.close");
      expect(closing).toEqual({ id: expect.any(Number), result: {} });
      // The close is sent to Chrome for the session's own page, and for no other.
      expect(chrome.closed).toEqual(["P1"]);
      // The other session carries on.
      const listB = await b.call("Target.getTargets");
      expect(((listB.result as { targetInfos: unknown[] }).targetInfos ?? []).length).toBe(1);
    } finally {
      await filter.close();
      chrome.stop();
    }
  });

  test("a connection that ends closes its pages (Chrome confirms), and one window from a web page is refused", async () => {
    const chrome = fakeChrome();
    const log: string[] = [];
    const filter = filterOn(chrome, log);
    try {
      const a = await client(filter.endpoint);
      await a.call("Target.createTarget", { url: "about:blank" });
      a.close();
      await Bun.sleep(200);
      // The connection's own page was closed as it ended.
      expect(chrome.closed).toEqual(["P1"]);

      // A web page's connection (it sends an Origin) is refused: it could drive the shared
      // browser otherwise.
      const refused = new WebSocket(filter.endpoint, {
        headers: { origin: "https://example.com" },
      });
      const outcome = await new Promise<string>((done) => {
        refused.onopen = () => done("opened");
        refused.onclose = () => done("refused");
        refused.onerror = () => done("refused");
        setTimeout(() => done("timeout"), 3000);
      });
      expect(outcome).toBe("refused");
    } finally {
      await filter.close();
      chrome.stop();
    }
  });

  test("a Chrome that cannot be reached closes the client with the reason", async () => {
    const filter = serveTabFilter({
      browserEndpoint: () => Promise.reject(new Error("Chrome is not installed")),
      downloadsPath: "/tmp/cc-smart-dev-kit-test-downloads",
      log: () => undefined,
    });
    try {
      const socket = new WebSocket(filter.endpoint);
      const reason = await new Promise<string>((done) => {
        socket.onclose = (event) => done(event.reason);
        socket.onerror = () => done("error");
        setTimeout(() => done("timeout"), 3000);
      });
      expect(reason).toContain("cannot start the shared Chrome: Chrome is not installed");
    } finally {
      await filter.close();
    }
  });

  test("the endpoint carries a random token; every other path is refused, and the token stays out of the log", async () => {
    const chrome = fakeChrome();
    const log: string[] = [];
    const filter = filterOn(chrome, log);
    const endpoint = new URL(filter.endpoint);
    const token = endpoint.pathname;
    // 128 random bits: a scan cannot find the endpoint, and a web page cannot read it.
    expect(token).toMatch(/^\/[0-9a-f]{32}$/);
    try {
      // Every filter mints its own token: nothing can be guessed or reused.
      const other = filterOn(chrome);
      expect(new URL(other.endpoint).pathname).not.toBe(token);
      await other.close();

      for (const path of ["/", "/abc", `${token}x`]) {
        const refused = new WebSocket(`ws://127.0.0.1:${endpoint.port}${path}`);
        const outcome = await new Promise<string>((done) => {
          refused.onopen = () => done("opened");
          refused.onclose = () => done("refused");
          refused.onerror = () => done("refused");
          setTimeout(() => done("timeout"), 3000);
        });
        expect(outcome).toBe("refused");
      }
      expect(log.join("\n")).toContain("this port serves one session's own endpoint");
      // The refused path is named; the token — the secret — never is.
      expect(log.join("\n")).not.toContain(token.slice(1));

      // The session's own endpoint still works.
      const a = await client(filter.endpoint);
      expect((await a.call("Target.getTargets")).result).toEqual({ targetInfos: [] });
    } finally {
      await filter.close();
      chrome.stop();
    }
  });
});
