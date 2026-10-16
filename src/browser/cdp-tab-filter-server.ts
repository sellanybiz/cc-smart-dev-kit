/**
 * The tab filter's socket. One session's launcher listens on a free local port; its
 * Playwright MCP connects there (`PLAYWRIGHT_MCP_CDP_ENDPOINT=ws://127.0.0.1:<port>/<token>`).
 * For each connection it opens one connection to the shared Chrome and passes every message
 * both ways through a `CdpTabFilter` of its own (`cdp-tab-filter.ts`). When the connection
 * ends — `browser_close`, the MCP's idle timeout, the session's exit — the session's pages
 * close; the shared Chrome and its logins stay.
 *
 * WHY THE TOKEN, AND WHAT IT DOES NOT STOP
 *   The URL carries a random token, and every request to any other path is refused. That
 *   stops a web page (any page the shared browser — or any browser — has open, for any user)
 *   and a blind port scan from driving the shared browser through this port: without the
 *   token, `ws://127.0.0.1:<port>/` was a session-less way in, and the Origin check alone
 *   did not cover a non-browser client. It does NOT stop a local process that can read the
 *   session's environment (the same user's processes), and it cannot: the MCP has to learn
 *   the URL somehow. What it does stop is everything that does not know the token — so the
 *   token never reaches argv (the launcher passes it as an environment variable), where every
 *   user on the machine could read it from `/proc`.
 *
 * Bun's own WebSocket serves both ends: `Bun.serve` for Playwright, `new WebSocket` for
 * Chrome. A message limit can be set only on the server side, which is the side Playwright
 * sends screenshots and snapshots on; the client side carried a 30 MB message in a live
 * measurement (`docs/claude-code-contract.md` § Bun). So no WebSocket package is needed,
 * and the plugin keeps its one runtime dependency.
 *
 * 🔴 Never write to stdout here: the launcher's stdout IS the MCP protocol stream. The token
 * is part of the endpoint URL: never log it.
 */
import { randomBytes } from "node:crypto";
import type { ServerWebSocket } from "bun";

import { CdpTabFilter, type FilterOutput } from "./cdp-tab-filter";

/** A CDP screenshot of a long page runs to many megabytes; this is the ceiling. */
const MAX_MESSAGE_BYTES = 512 * 1024 * 1024;

/**
 * How long, in all, an ending session waits for Chrome to confirm its pages closed and to
 * answer the creates still in flight. An upper bound, not a race fix: Chrome answers in
 * milliseconds, and one that hangs must not keep a session's launcher from exiting.
 */
const CLOSE_WAIT_MS = 3000;

/** WebSocket close codes (RFC 6455 § 7.4.1). */
const POLICY_VIOLATION = 1008;
const SERVER_ERROR = 1011;

/** A close reason may be 123 bytes at most: a longer one makes `close` throw, in Bun as in `ws`. */
const MAX_CLOSE_REASON_BYTES = 123;

/** `reason` cut to what a WebSocket close frame can carry, on a whole letter. */
export function closeReason(reason: string): string {
  if (Buffer.byteLength(reason) <= MAX_CLOSE_REASON_BYTES) return reason;
  let cut = "";
  for (const letter of reason) {
    if (Buffer.byteLength(`${cut}${letter}…`) > MAX_CLOSE_REASON_BYTES) break;
    cut += letter;
  }
  return `${cut}…`;
}

export interface TabFilterServerOptions {
  /**
   * The shared Chrome's browser WebSocket URL. Called once per connection; it starts
   * Chrome when needed and may throw — the connection is then closed with the reason.
   */
  browserEndpoint: () => Promise<string>;
  /**
   * Where Chrome saves downloads: Playwright's downloads folder, which over CDP is its
   * `artifactsDir` — the MCP's `<output dir>/traces`. Sent to Chrome as each connection opens.
   */
  downloadsPath: string;
  /** One line for the launcher's log (its stderr). */
  log: (line: string) => void;
}

export interface TabFilterServer {
  /** Stops listening, closes every connection's own pages (waiting up to 3 s for Chrome) and the connections. */
  close: () => Promise<void>;
  /**
   * `ws://127.0.0.1:<port>/<token>` — what the MCP's `PLAYWRIGHT_MCP_CDP_ENDPOINT` takes. The
   * token is a secret: whoever knows it can drive this session's browser connection while the
   * session runs. Never log it, and never put it on a command line (`/proc`).
   */
  endpoint: string;
}

/** Listen on a free port on 127.0.0.1 and filter every connection made to it. */
export function serveTabFilter(options: TabFilterServerOptions): TabFilterServer {
  const connections = new Set<FilteredConnection>();
  const bySocket = new Map<ServerWebSocket<undefined>, FilteredConnection>();
  // The path every connection must carry. 128 random bits: nothing can guess it, and no
  // web page can read it (it is not in any page, cookie or file a browser can reach).
  const token = randomBytes(16).toString("hex");
  const path = `/${token}`;

  const server = Bun.serve({
    fetch(request, self) {
      // Every browser sends an Origin with a WebSocket; Playwright sends none. Without this
      // check any web page the person opens could drive the shared browser through this
      // port. Chrome refuses such connections on its own port; this port must not undo that.
      const origin = request.headers.get("origin");
      if (origin !== null) {
        options.log(`tab filter: refused a connection from a web page (${origin})`);
        return new Response("connections from web pages are refused", { status: 403 });
      }
      // Anything without this session's token is not its MCP: a scan, another local
      // program, or a page that got past the Origin check. The refused path is logged; the
      // token itself never is.
      const asked = new URL(request.url).pathname;
      if (asked !== path) {
        options.log(
          `tab filter: refused a connection to ${asked === "/" ? "the root path" : "another path"} (this port serves one session's own endpoint)`,
        );
        return new Response("this port serves one session's endpoint only", { status: 403 });
      }
      if (self.upgrade(request, { data: undefined })) return undefined;
      return new Response("this port speaks WebSocket only", { status: 426 });
    },
    hostname: "127.0.0.1",
    // Never cut a connection for being quiet: a session between two browser calls sends
    // nothing for minutes, and the MCP's own idle timeout (ten minutes) is the one that
    // lets a session's windows go.
    idleTimeout: 0,
    port: 0,
    websocket: {
      close(ws) {
        const connection = bySocket.get(ws);
        if (connection === undefined) return;
        bySocket.delete(ws);
        // The session let go (Playwright's `browser_close`, its idle timeout, or the session
        // ending): close the pages it opened, and stop taking its messages.
        void connection.end().finally(() => {
          connections.delete(connection);
        });
      },
      maxPayloadLength: MAX_MESSAGE_BYTES,
      message(ws, data) {
        const connection = bySocket.get(ws);
        // Ignored once the connection ends: its pages are closing.
        if (connection !== undefined && !connection.closing) {
          connection.apply(connection.filter.fromClient(toText(data)));
        }
      },
      open(ws) {
        const connection = new FilteredConnection(ws, options);
        bySocket.set(ws, connection);
        connections.add(connection);
      },
    },
  });

  if (server.port === undefined) throw new Error("tab filter: the server has no port");

  return {
    close: async () => {
      // Stop taking connections first, so none arrives while the others end.
      const stopped = server.stop(false);
      await Promise.all([...connections].map((connection) => connection.end()));
      // Refused ones too. The launcher is stopping: no need to wait for Playwright to agree.
      for (const connection of connections) connection.terminate();
      await stopped;
    },
    endpoint: `ws://127.0.0.1:${String(server.port)}${path}`,
  };
}

/** One client connection, its own connection to Chrome, and the filter between them. */
class FilteredConnection {
  /** Set the moment the connection starts to end, before anything closes. */
  closing = false;
  readonly filter: CdpTabFilter;
  private ending: Promise<void> | undefined;
  private upstream: undefined | WebSocket;
  /** For Chrome, until its socket opens. */
  private readonly waitingForBrowser: string[] = [];
  /** The page closes an ending connection waits for (and, through the filter, its creates). */
  private waitingForCloses: undefined | { done: () => void; ids: Set<number> };

  constructor(
    private readonly client: ServerWebSocket<undefined>,
    private readonly options: TabFilterServerOptions,
  ) {
    this.filter = new CdpTabFilter({ downloadsPath: options.downloadsPath });
    // First in the queue, so Chrome gets them before anything the client sends.
    this.waitingForBrowser.push(...this.filter.openingCommands());
    void this.connect();
  }

  /**
   * End the connection: close the session's pages, wait for Chrome to confirm them and to
   * answer the creates still in flight (3 s at most in all), then close the connection to
   * Chrome. Runs once, however often it is called.
   */
  end(): Promise<void> {
    if (this.ending === undefined) {
      this.closing = true;
      this.ending = this.closeUpstream();
    }
    return this.ending;
  }

  apply(output: FilterOutput): void {
    for (const line of output.log) this.options.log(`tab filter: ${line}`);
    for (const message of output.toClient) {
      if (this.client.readyState === WebSocket.OPEN) this.client.send(message);
    }
    for (const message of output.toBrowser) {
      if (this.upstream?.readyState === WebSocket.OPEN) this.upstream.send(message);
      else this.waitingForBrowser.push(message);
    }
    const waiting = this.waitingForCloses;
    if (waiting === undefined) return;
    // A page that landed after the client left: the filter closed it, so wait for that too.
    for (const id of output.closing) waiting.ids.add(id);
    for (const id of output.answered) waiting.ids.delete(id);
    if (waiting.ids.size === 0 && this.filter.createsInFlight === 0) waiting.done();
  }

  private async closeUpstream(): Promise<void> {
    const upstream = this.upstream;
    if (upstream === undefined) return; // Chrome is still starting, and `connect` sees `closing`
    if (upstream.readyState === WebSocket.OPEN) {
      const { awaitIds, toBrowser } = this.filter.closeOwnPages();
      for (const message of toBrowser) upstream.send(message);
      // A create still in flight lands a page no one would close: the filter closes it
      // when Chrome answers, so the connection stays open for that answer.
      const opening = this.filter.createsInFlight;
      if (awaitIds.length > 0 || opening > 0) {
        this.options.log(
          `tab filter: closing this session's ${String(awaitIds.length)} page(s)${opening > 0 ? ` and ${String(opening)} still opening` : ""}`,
        );
        await this.settled(awaitIds);
      }
    }
    upstream.close();
  }

  /**
   * Resolves once Chrome answered every close (`ids`, and those `apply` adds) and no create
   * is in flight — or after `CLOSE_WAIT_MS` in all.
   */
  private settled(ids: number[]): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.waitingForCloses = undefined;
        resolve();
      };
      const timer = setTimeout(finish, CLOSE_WAIT_MS);
      this.waitingForCloses = { done: finish, ids: new Set(ids) };
    });
  }

  private async connect(): Promise<void> {
    let url: string;
    try {
      url = await this.options.browserEndpoint();
    } catch (error) {
      this.refuse(`cannot start the shared Chrome: ${describe(error)}`);
      return;
    }
    if (this.closing) return; // the client left while Chrome started

    const upstream = new WebSocket(url, { perMessageDeflate: false });
    this.upstream = upstream;
    upstream.onopen = () => {
      for (const message of this.waitingForBrowser.splice(0)) upstream.send(message);
    };
    upstream.onmessage = (event) => {
      this.apply(this.filter.fromBrowser(toText(event.data)));
    };
    upstream.onclose = (event) => {
      this.waitingForCloses?.done(); // no more answers can come
      if (this.closing) return;
      const details = `code ${String(event.code)}${event.reason === "" ? "" : `: ${event.reason}`}`;
      this.refuse(`the shared Chrome closed the connection (${details})`);
    };
  }

  /** Close the client with the reason, which Playwright shows as its error. */
  private refuse(reason: string): void {
    this.options.log(`tab filter: ${reason}`);
    this.client.close(SERVER_ERROR, closeReason(reason));
  }

  /** Cut the connection off at once, for a launcher that is stopping and cannot wait. */
  terminate(): void {
    this.client.terminate();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toText(data: string | Buffer | ArrayBuffer | Uint8Array): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

export { POLICY_VIOLATION };
