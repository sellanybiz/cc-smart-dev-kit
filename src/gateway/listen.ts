/**
 * How the router takes the listening socket systemd holds for it (socket activation).
 *
 * `anymodel-router.socket` owns 127.0.0.1:<port>. systemd passes that socket to the router
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
    throw new Error(`systemd passed ${fds} sockets (LISTEN_FDS); anymodel-router takes one`);
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
  const dir = mkdtempSync(join(tmpdir(), "anymodel-router-"));
  return {
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
    path: join(dir, "router.sock"),
  };
}

/**
 * Relays one accepted connection to the unix socket at `path`, both ways, until either
 * side ends. A side that ends is ended on the other side too, after its bytes are sent
 * (`pipe`). A client that goes away drops the inner connection at once, so the router
 * sees the request aborted and stops its upstream call. An error on either side ends both.
 */
export function relayConnection(client: net.Socket, path: string): void {
  const inner = net.connect(path);
  client.setNoDelay(true);
  client.on("error", () => inner.destroy());
  inner.on("error", () => client.destroy());
  client.on("close", () => inner.destroy());
  client.pipe(inner);
  inner.pipe(client);
}

/**
 * Accepts connections on the inherited listening socket `fd`, and relays each to the unix
 * socket that `inner` resolves to. Connections that arrive before `inner` resolves wait,
 * paused, so none is lost while the router starts. Resolves with the server and the port
 * the socket listens on.
 */
export function listenOnFd(
  fd: number,
  inner: Promise<string>,
): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer({ pauseOnConnect: true }, (client) => {
    inner.then(
      (path) => relayConnection(client, path),
      () => client.destroy(),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ fd }, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error(`file descriptor ${fd} is not a TCP listening socket`));
        return;
      }
      resolve({ port: address.port, server });
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
