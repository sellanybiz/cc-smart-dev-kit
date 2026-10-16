/**
 * How the router takes the listening socket systemd holds for it (socket activation).
 *
 * `cc-smart-dev-kit-router.socket` owns 127.0.0.1:<port>. systemd passes that socket to the router
 * as file descriptor 3, with `LISTEN_PID` and `LISTEN_FDS` set (sd_listen_fds(3)). While
 * the router restarts, the socket stays open, so a new connection waits in its queue for
 * the next router instead of being refused.
 *
 * Bun's own server cannot serve on a file descriptor it inherited (Bun 1.4: `Bun.serve`
 * has no such option, and `node:http`'s `listen({ fd })` binds a random port instead).
 * `node:net` can (`listen({ fd })`). So the router accepts on fd 3 with `node:net`, and
 * relays each connection, byte for byte, to its own `Bun.serve` on a unix socket in a
 * folder only this user can open. The router's code is the same either way.
 */

import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The first file descriptor systemd passes (SD_LISTEN_FDS_START). */
export const SD_LISTEN_FDS_START = 3;

/** The variables of socket activation; removed once read, so no child takes them as its own. */
export const LISTEN_VARS = ["LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"] as const;

/**
 * The listening socket systemd passed to this process, or null when it passed none.
 * `LISTEN_PID` must name this process: the variables may be inherited from a parent that
 * was activated itself. The router takes exactly one socket; more is an error.
 */
export function inheritedListenFd(
  env: Record<string, string | undefined>,
  pid: number,
): null | number {
  const listenPid = env.LISTEN_PID;
  const count = env.LISTEN_FDS;
  if (listenPid === undefined || count === undefined) return null;
  if (Number(listenPid) !== pid) return null;
  const fds = Number(count);
  if (!Number.isInteger(fds) || fds < 1) return null;
  if (fds !== 1) {
    throw new Error(
      `systemd passed ${fds} sockets (LISTEN_FDS); cc-smart-dev-kit-router takes one`,
    );
  }
  return SD_LISTEN_FDS_START;
}

/**
 * Where the router's own server listens behind the relay: a unix socket in
 * `RUNTIME_DIRECTORY` (systemd makes that folder for the unit, mode 0700, and removes it
 * when the unit stops), else in a new private temp folder. `cleanup` removes what this
 * process made.
 */
export function innerSocketPath(
  env: Record<string, string | undefined>,
  pid: number,
): { cleanup: () => void; path: string } {
  const runtime = env.RUNTIME_DIRECTORY?.split(":")[0];
  if (runtime) {
    const path = join(runtime, `router-${pid}.sock`);
    rmSync(path, { force: true });
    return { cleanup: () => rmSync(path, { force: true }), path };
  }
  // mkdtemp makes the folder with mode 0700.
  const dir = mkdtempSync(join(tmpdir(), "cc-smart-dev-kit-router-"));
  return {
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
    path: join(dir, "router.sock"),
  };
}

/**
 * How long a connection that has sent no byte yet may still send one after SIGTERM. A
 * client writes its request right after it connects, so its first bytes may still sit
 * unread when SIGTERM comes; they get this long. A connection that sends nothing (a
 * client's spare connection, an idle `nc`) is then closed, so it cannot hold the drain
 * until systemd's `TimeoutStopSec` (120 s).
 */
export const IDLE_GRACE_MS = 500;

/** One accepted connection, and how far it got. */
interface Tracked {
  client: net.Socket;
  /** `waiting`: no byte yet; `connecting`: its inner connection is opening; `relaying`. */
  state: "waiting" | "connecting" | "relaying";
}

/** The relay on the inherited socket: its port, its server, and its drain. */
export interface Relay {
  port: number;
  server: net.Server;
  /**
   * For SIGTERM. Stops accepting (systemd keeps the socket, so a new connection waits in
   * its queue for the next router), and closes each connection that sent no byte within
   * `IDLE_GRACE_MS`. `connected` resolves once no connection waits for its first byte or
   * for its inner connection: only then may the inner server stop, or a request that
   * already came would find it closed. `closed` resolves once every accepted connection
   * has closed.
   */
  drain(): { closed: Promise<void>; connected: Promise<void> };
}

/**
 * Relays one connection to the unix socket at `path`, both ways, byte for byte. The inner
 * connection opens only with the client's first byte, so a connection that never sends
 * one costs nothing, and the drain can close it.
 *
 * A client may end its sending side after its request (a half close) and still get the
 * whole answer: the client's side allows it (`allowHalfOpen` on the server), and that end
 * is not passed on, because Bun's server drops a connection the moment its client ends
 * (Bun 1.4.2, over TCP and a unix socket alike: tried). The inner side allows no half
 * close: when the router ends a connection, it is done with it.
 *
 * When either side closes, the other goes too. A client that goes away (or fails) drops
 * the inner connection at once, so the router sees the request aborted and stops its
 * upstream call. An inner connection that fails cuts the client; one that ends normally
 * ends the client after the answer's last byte and closes it once that byte is out, so a
 * client that keeps its own side open cannot hold the drain.
 */
function relay(
  entry: Tracked,
  path: string,
  log: (line: string) => void,
  changed: () => void,
): void {
  const { client } = entry;
  // A client that ends before its first byte: nothing to relay.
  const endedFirst = () => {
    client.off("data", firstByte);
    client.destroy();
  };
  const firstByte = (first: Buffer) => {
    client.off("end", endedFirst);
    client.pause();
    entry.state = "connecting";
    const inner = net.connect({ path });
    inner.once("connect", () => {
      entry.state = "relaying";
      changed();
    });
    inner.on("error", (error) => {
      if (entry.state === "connecting") {
        log(`WARN relay: cannot reach the router's own server at ${path}: ${error.message}`);
      }
      client.destroy();
    });
    inner.once("close", (hadError) => {
      // `pipe` ended the client after the last byte (`end` again is a no-op then); close
      // it once that byte is out.
      if (hadError || client.writableFinished) {
        client.destroy();
        return;
      }
      client.once("finish", () => client.destroy());
      client.end();
    });
    client.once("close", () => inner.destroy());
    inner.write(first);
    // `end: false`: a client's half close stays here (above).
    client.pipe(inner, { end: false });
    inner.pipe(client);
  };
  client.once("data", firstByte);
  client.once("end", endedFirst);
  client.resume();
}

/**
 * Accepts connections on the inherited listening socket `fd`, and relays each to the unix
 * socket that `inner` resolves to. Connections that arrive before `inner` resolves wait,
 * paused, so none is lost while the router starts. Resolves with the relay.
 */
export function listenOnFd(
  fd: number,
  inner: Promise<string>,
  log: (line: string) => void,
): Promise<Relay> {
  const tracked = new Set<Tracked>();
  let draining = false;
  let graceOver = false;
  const connectedWaiters: (() => void)[] = [];
  const closedWaiters: (() => void)[] = [];
  const changed = () => {
    if (!draining) return;
    const pending = [...tracked].some((entry) => entry.state !== "relaying");
    if (graceOver && !pending) for (const done of connectedWaiters.splice(0)) done();
    if (tracked.size === 0) for (const done of closedWaiters.splice(0)) done();
  };
  const server = net.createServer({ allowHalfOpen: true, pauseOnConnect: true }, (client) => {
    const entry: Tracked = { client, state: "waiting" };
    tracked.add(entry);
    client.setNoDelay(true);
    // An error closes the connection (and with it the inner one); it never reaches the
    // process as an uncaught error.
    client.on("error", () => client.destroy());
    client.once("close", () => {
      tracked.delete(entry);
      changed();
    });
    inner.then(
      (path) => {
        if (!client.destroyed) relay(entry, path, log, changed);
      },
      () => client.destroy(),
    );
  });
  const drain = () => {
    if (!draining) {
      draining = true;
      server.close();
      // A timer on purpose: the grace a just-connected client gets to send its request.
      setTimeout(() => {
        graceOver = true;
        for (const entry of tracked) if (entry.state === "waiting") entry.client.destroy();
        changed();
      }, IDLE_GRACE_MS);
    }
    const connected = new Promise<void>((resolve) => connectedWaiters.push(resolve));
    const closed = new Promise<void>((resolve) => closedWaiters.push(resolve));
    changed();
    return { closed, connected };
  };
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ fd }, () => {
      server.off("error", reject);
      // For good: an error the server emits later must never crash the router. Node emits
      // one when an accept fails (too many open files, say); Bun 1.4.2 emits none there and
      // leaves the connection in the queue (tried, with a low open-file limit).
      server.on("error", (error) => log(`WARN relay: the socket's server: ${error.message}`));
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error(`file descriptor ${fd} is not a TCP listening socket`));
        return;
      }
      resolve({ drain, port: address.port, server });
    });
  });
}

/**
 * `Bun.serve` on the unix socket at `path`, with Bun's idle cut-off off. Bun 1.4's types
 * allow `idleTimeout` only beside a hostname and port, but the server reads it on a unix
 * socket too, and needs it there: without it, Bun closes a unix connection after 10 s
 * with nothing sent, which cuts the answer of a model that thinks for a while (proved in
 * `listen.test.ts`). So the option is added after the typed object is built.
 */
export function serveUnix(
  path: string,
  fetch: (req: Request) => Promise<Response>,
): Bun.Server<undefined> {
  const options: Bun.Serve.Options<undefined> = { fetch, unix: path };
  Object.assign(options, { idleTimeout: 0 });
  return Bun.serve(options);
}
