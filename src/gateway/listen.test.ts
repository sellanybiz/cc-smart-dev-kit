/**
 * Socket activation: the router serves on a listening socket it inherited as file
 * descriptor 3, the way systemd's `cc-smart-dev-kit-router.socket` hands it over.
 *
 * The end-to-end tests start the router's real entry under `systemd-socket-activate`
 * (systemd's own tool for this: it opens the socket, then runs the program with
 * `LISTEN_FDS=1` and the socket on fd 3), on a free port of the test's own, with a temp
 * HOME and a fake backend. Never the live router's port: the port guard runs in the
 * router too. Without that tool (not Linux, or no systemd), they are skipped.
 *
 * What they cannot show: a restart under a real socket unit, where the socket outlives
 * the router. That was proved live with a throwaway user unit (docs/gateway.md § The
 * service).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { IDLE_GRACE_MS, inheritedListenFd, SD_LISTEN_FDS_START } from "./listen";

const ROUTER_ENTRY = join(import.meta.dir, "..", "entries", "router.ts");
const ACTIVATE = Bun.which("systemd-socket-activate");

describe("which socket systemd passed", () => {
  test("LISTEN_PID names this process and LISTEN_FDS is 1: fd 3", () => {
    expect(inheritedListenFd({ LISTEN_FDS: "1", LISTEN_PID: "4242" }, 4242)).toBe(3);
    expect(SD_LISTEN_FDS_START).toBe(3);
  });

  test("no variables, or LISTEN_PID of another process (inherited from a parent): none", () => {
    expect(inheritedListenFd({}, 4242)).toBe(null);
    expect(inheritedListenFd({ LISTEN_FDS: "1" }, 4242)).toBe(null);
    expect(inheritedListenFd({ LISTEN_PID: "4242" }, 4242)).toBe(null);
    expect(inheritedListenFd({ LISTEN_FDS: "1", LISTEN_PID: "4241" }, 4242)).toBe(null);
    expect(inheritedListenFd({ LISTEN_FDS: "0", LISTEN_PID: "4242" }, 4242)).toBe(null);
    expect(inheritedListenFd({ LISTEN_FDS: "x", LISTEN_PID: "4242" }, 4242)).toBe(null);
  });

  test("more than one socket: an error, never a guess", () => {
    expect(() => inheritedListenFd({ LISTEN_FDS: "2", LISTEN_PID: "4242" }, 4242)).toThrow(
      "systemd passed 2 sockets (LISTEN_FDS); cc-smart-dev-kit-router takes one",
    );
  });
});

const servers: { stop(force?: boolean): void }[] = [];
const procs: Bun.Subprocess[] = [];
afterEach(async () => {
  for (const proc of procs.splice(0)) {
    proc.kill("SIGKILL");
    await proc.exited;
  }
  for (const server of servers.splice(0)) server.stop(true);
});

/** A free port of this test's own: bound, read, released. */
function freePort(): number {
  const probe = Bun.serve({ fetch: () => new Response(""), hostname: "127.0.0.1", port: 0 });
  const port = probe.port as number;
  probe.stop(true);
  return port;
}

/**
 * A fake affordable backend: `/v1/messages` answers a stream that sends its first event at
 * once, then nothing for `silentMs`, then the last event.
 */
function slowBackend(silentMs: number) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    idleTimeout: 0,
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname !== "/v1/messages") return new Response("", { status: 404 });
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            encoder.encode('event: message_start\ndata: {"type":"message_start"}\n\n'),
          );
          await Bun.sleep(silentMs);
          controller.enqueue(
            encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
          );
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  servers.push(server);
  return server.port as number;
}

/** Reads `stream` until `done(text)`, or to its end; the text read. */
async function readUntil(stream: ReadableStream<Uint8Array>, done: (text: string) => boolean) {
  const reader = stream.getReader();
  let text = "";
  while (!done(text)) {
    const step = await reader.read();
    if (step.done) break;
    text += new TextDecoder().decode(step.value);
  }
  reader.releaseLock();
  return text;
}

/**
 * The router's entry under systemd-socket-activate on `port`, with a temp HOME whose
 * gateway.json names `configPort` and a backend on `backendPort`. Resolves once the socket
 * is open. Like a socket unit, systemd-socket-activate starts the router only when the
 * first connection comes: that connection waits in the socket's queue meanwhile.
 * `firstLine()` reads what the router said first.
 */
async function activatedRouter(port: number, configPort: number, backendPort: number) {
  const home = tempDir("listen");
  const config = join(home, ".config", "cc-smart-dev-kit", "gateway.json");
  mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      backends: { fake: { apiKey: "fake-key", baseUrl: `http://127.0.0.1:${backendPort}` } },
      port: configPort,
      slots: { "cc-smart-dev-kit-worker": ["fake:m"] },
      version: 1,
    }),
    { mode: 0o600 },
  );
  const guard = subprocessGuard();
  const proc = Bun.spawn(
    [
      ACTIVATE as string,
      "-l",
      `127.0.0.1:${port}`,
      process.execPath,
      ...guard.args,
      "--no-env-file",
      ROUTER_ENTRY,
    ],
    {
      env: { HOME: home, PATH: process.env.PATH ?? "", ...guard.env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  procs.push(proc);
  await readUntil(proc.stderr, (text) => text.includes(`Listening on 127.0.0.1:${port}`));
  const firstLine = () => readUntil(proc.stdout, (text) => text.includes("\n"));
  return { config, firstLine, proc };
}

const MESSAGE = {
  body: JSON.stringify({
    max_tokens: 10,
    messages: [{ content: "hi", role: "user" }],
    model: "cc-smart-dev-kit-worker",
    stream: true,
  }),
  headers: { "anthropic-version": "2023-06-01", "content-type": "application/json" },
  method: "POST",
};

describe.skipIf(ACTIVATE === null)("the router on a socket systemd passed (fd 3)", () => {
  test("serves its health page and a whole stream on the socket's port, through the relay", async () => {
    const port = freePort();
    const backend = slowBackend(50);
    const router = await activatedRouter(port, port, backend);
    // The first connection starts the router; it waited in the socket meanwhile.
    const health = await fetch(`http://127.0.0.1:${port}/__cc-smart-dev-kit/health`);
    expect(await health.json()).toMatchObject({ ok: true, port, requests: 0 });
    expect(await router.firstLine()).toBe(
      `cc-smart-dev-kit-router listening on http://127.0.0.1:${port} (the socket systemd holds; config ${router.config})\n`,
    );
    const answer = await fetch(`http://127.0.0.1:${port}/v1/messages`, MESSAGE);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe(
      'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
    // The local-only guard still holds behind the relay: a foreign Host is refused.
    const foreign = await fetch(`http://127.0.0.1:${port}/__cc-smart-dev-kit/health`, {
      headers: { host: `example.com:${port}` },
    });
    expect(foreign.status).toBe(403);
  }, 20_000);

  test("the Host check uses the socket's port when the config names another; it warns", async () => {
    const port = freePort();
    const backend = slowBackend(0);
    const router = await activatedRouter(port, port + 1, backend);
    const health = await fetch(`http://127.0.0.1:${port}/__cc-smart-dev-kit/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, port });
    // Its first line is the warning; the "listening" line may come in the same read.
    expect(await router.firstLine()).toStartWith(
      `WARN the socket listens on port ${port}, the config says ${port + 1}: serving on ${port}. Run: cc-smart-dev-kit gateway setup\n`,
    );
  }, 20_000);

  test("SIGTERM: the answer in flight finishes whole, then the router exits 0", async () => {
    const port = freePort();
    const backend = slowBackend(1_500);
    const router = await activatedRouter(port, port, backend);
    const answer = await fetch(`http://127.0.0.1:${port}/v1/messages`, MESSAGE);
    expect(answer.status).toBe(200);
    router.proc.kill("SIGTERM");
    expect(await answer.text()).toEndWith('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    expect(await router.proc.exited).toBe(0);
  }, 20_000);

  // Slow on purpose (12 s): Bun cuts a unix-socket connection after 10 s with nothing
  // sent unless `idleTimeout: 0` reaches the inner server (`serveUnix`). A model that
  // thinks for a while sends nothing for that long.
  test("a stream silent for 12 s is not cut behind the relay", async () => {
    const port = freePort();
    const backend = slowBackend(12_000);
    await activatedRouter(port, port, backend);
    const answer = await fetch(`http://127.0.0.1:${port}/v1/messages`, MESSAGE);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toEndWith('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  }, 30_000);
});

/** A raw TCP connection to 127.0.0.1:`port` (a half close allowed); resolves once connected. */
function rawConnect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ allowHalfOpen: true, host: "127.0.0.1", port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Everything `socket` receives until the other side closes it. */
function readAll(socket: net.Socket): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk.toString();
    });
    socket.on("error", () => resolve(text));
    socket.once("end", () => resolve(text));
    socket.once("close", () => resolve(text));
  });
}

/** Reads from `socket` until `done(text)`. */
function readUntilText(socket: net.Socket, done: (text: string) => boolean): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    const onData = (chunk: Buffer) => {
      text += chunk.toString();
      if (done(text)) {
        socket.off("data", onData);
        resolve(text);
      }
    };
    socket.on("data", onData);
  });
}

const healthRequest = (port: number, extra = "") =>
  `GET /__cc-smart-dev-kit/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${extra}\r\n`;

/**
 * Asks the health page on a new connection, closed after the answer. The router accepts
 * in order, so a connection made earlier was accepted by then: a SIGTERM afterwards finds
 * it in the relay, not still in the socket's queue (where it would wait for the next
 * router under a socket unit).
 */
async function acceptedBefore(port: number): Promise<void> {
  const health = await fetch(`http://127.0.0.1:${port}/__cc-smart-dev-kit/health`, {
    headers: { connection: "close" },
  });
  expect(health.status).toBe(200);
  await health.text();
}

describe.skipIf(ACTIVATE === null)("the relay alone (no router behind it)", () => {
  /**
   * A script that runs `listenOnFd` on fd 3 towards an inner socket that does not exist,
   * prints each log line, and, on "boom" from stdin, makes the relay's server emit an
   * error, as Node does when an accept fails.
   */
  async function bareRelay(port: number) {
    const dir = tempDir("relay");
    const script = join(dir, "relay.ts");
    writeFileSync(
      script,
      [
        `import { listenOnFd } from ${JSON.stringify(join(import.meta.dir, "listen.ts"))};`,
        `const relay = await listenOnFd(3, Promise.resolve(${JSON.stringify(join(dir, "none.sock"))}), (line) => console.log(line));`,
        'console.log("ready");',
        'for await (const chunk of Bun.stdin.stream()) if (new TextDecoder().decode(chunk).includes("boom")) { relay.server.emit("error", new Error("accept failed: EMFILE")); console.log("still running"); }',
        "",
      ].join("\n"),
    );
    const guard = subprocessGuard();
    const proc = Bun.spawn(
      [ACTIVATE as string, "-l", `127.0.0.1:${port}`, process.execPath, ...guard.args, script],
      {
        env: { PATH: process.env.PATH ?? "", ...guard.env },
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      },
    );
    procs.push(proc);
    await readUntil(proc.stderr, (text) => text.includes(`Listening on 127.0.0.1:${port}`));
    return proc;
  }

  test("an inner connection that cannot open is logged, and its client closed", async () => {
    const port = freePort();
    const proc = await bareRelay(port);
    const socket = await rawConnect(port);
    const closed = readAll(socket);
    socket.write(healthRequest(port));
    expect(await closed).toBe("");
    const out = await readUntil(proc.stdout, (text) => text.includes("WARN"));
    expect(out).toContain(
      "WARN relay: cannot reach the router's own server at /", // the temp folder's path
    );
    expect(out).toContain("none.sock: ");
  }, 20_000);

  test("an error the relay's server emits later is logged; the process runs on", async () => {
    const port = freePort();
    const proc = await bareRelay(port);
    // A connection starts the script (systemd-socket-activate runs it on the first one).
    const socket = await rawConnect(port);
    await readUntil(proc.stdout, (text) => text.includes("ready"));
    proc.stdin.write("boom\n");
    await proc.stdin.flush();
    const out = await readUntil(proc.stdout, (text) => text.includes("still running"));
    expect(out).toContain("WARN relay: the socket's server: accept failed: EMFILE\n");
    expect(proc.exitCode).toBe(null);
    socket.destroy();
  }, 20_000);
});

describe.skipIf(ACTIVATE === null)("the relay's drain at SIGTERM", () => {
  test("a connection that never sends a byte does not hold the drain: the router exits within 2 s", async () => {
    const port = freePort();
    const router = await activatedRouter(port, port, slowBackend(0));
    // The first connection starts the router; it sends nothing, ever (an idle `nc`).
    const idle = await rawConnect(port);
    const closed = readAll(idle);
    await acceptedBefore(port);
    const started = performance.now();
    router.proc.kill("SIGTERM");
    expect(await router.proc.exited).toBe(0);
    expect(performance.now() - started).toBeLessThan(2_000);
    // The router closed it: nothing was sent either way.
    expect(await closed).toBe("");
  }, 20_000);

  test("a keep-alive connection idle after its answer does not hold the drain either", async () => {
    const port = freePort();
    const router = await activatedRouter(port, port, slowBackend(0));
    const socket = await rawConnect(port);
    socket.write(healthRequest(port));
    const first = await readUntilText(socket, (text) => text.includes('"ok":true'));
    expect(first).toStartWith("HTTP/1.1 200 OK\r\n");
    const closed = readAll(socket);
    const started = performance.now();
    router.proc.kill("SIGTERM");
    expect(await router.proc.exited).toBe(0);
    expect(performance.now() - started).toBeLessThan(2_000);
    await closed;
  }, 20_000);

  test("a request sent just after SIGTERM, on a connection made before it, is still answered", async () => {
    const port = freePort();
    const router = await activatedRouter(port, port, slowBackend(0));
    const socket = await rawConnect(port);
    await acceptedBefore(port);
    router.proc.kill("SIGTERM");
    // Well inside the grace a connection gets for its first byte.
    await Bun.sleep(IDLE_GRACE_MS / 5);
    socket.write(healthRequest(port, "Connection: close\r\n"));
    const answer = await readAll(socket);
    expect(answer).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(answer).toContain('"ok":true');
    expect(await router.proc.exited).toBe(0);
  }, 20_000);

  test("a client that half-closes after its request still gets the whole answer", async () => {
    const port = freePort();
    const router = await activatedRouter(port, port, slowBackend(300));
    const socket = await rawConnect(port);
    const body = MESSAGE.body;
    socket.write(
      `POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nanthropic-version: 2023-06-01\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
    // Its sending side ends (FIN); its receiving side stays open for the answer.
    socket.end();
    const closed = readAll(socket);
    // The chunked answer's last chunk.
    const answer = await readUntilText(socket, (text) => text.endsWith("\r\n0\r\n\r\n"));
    expect(answer).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(answer).toContain('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    router.proc.kill("SIGTERM");
    expect(await router.proc.exited).toBe(0);
    await closed;
  }, 20_000);
});
