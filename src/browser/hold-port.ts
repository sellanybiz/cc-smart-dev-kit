/**
 * A port on this machine as a lock. Only one program can listen on a port, and the system
 * frees it the moment that program ends — also when it is killed or the machine loses
 * power — so a lock held this way can never go stale, and there is nothing to clean up.
 *
 * A lock can say who holds it: every connection gets the holder's answer as one line, and
 * the ASKER hangs up first. The side that hangs up first keeps the connection in TIME_WAIT
 * for a minute or more; Linux and macOS let the next holder listen on the port all the
 * same, Windows may not. So that side is never the lock's.
 */
import { connect, createServer, type Server } from "node:net";

/** How long an asker waits for the answer, and a holder for the asker to hang up. */
const ANSWER_TIMEOUT_MS = 1000;

export type PortHold =
  /** Any refusal but "in use" — a port the system keeps for itself, for example. */
  | { error: string }
  /** Keep it: the lock is held while it listens, and `close()` releases it. */
  | { held: Server }
  /** Another program listens there. */
  | { taken: true };

/**
 * What the holder of the lock on `port` answers: its line; `""` when it said nothing in
 * time (another kind of program listens there); `null` when nothing listens.
 *
 * Ask a port you know someone holds (`holdPort` said `taken`): on Windows, a connection to
 * a port nobody listens on is refused only after about two seconds (measured in the project
 * this was ported from, 2026 ms), so the asker would wait out its own limit.
 */
export function askHolder(port: number): Promise<null | string> {
  return new Promise((done) => {
    let connected = false;
    const chunks: Buffer[] = [];
    const socket = connect({ host: "127.0.0.1", port });
    const received = () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const end = text.indexOf("\n");
      return end === -1 ? text : text.slice(0, end);
    };
    const finish = (answer: null | string) => {
      socket.destroy();
      done(answer);
    };
    socket.setTimeout(ANSWER_TIMEOUT_MS, () => {
      finish(connected ? received() : null);
    });
    socket.once("connect", () => {
      connected = true;
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunk.includes(0x0a)) finish(received());
    });
    socket.once("end", () => {
      finish(received());
    });
    socket.once("error", () => {
      finish(connected ? received() : null);
    });
  });
}

function codeOf(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "unknown error";
}

/** Listens on 127.0.0.1:`port`, and answers every connection with `answer` as one line. */
export function holdPort(port: number, answer = ""): Promise<PortHold> {
  return new Promise((done) => {
    const server = createServer((socket) => {
      socket.on("error", () => {
        // The other side hung up first: nothing to tell it.
      });
      // The asker hangs up once it has the line; one that never does is cut off.
      socket.setTimeout(ANSWER_TIMEOUT_MS, () => {
        socket.destroy();
      });
      socket.write(`${answer}\n`);
    });
    server.once("error", (error) => {
      const code = codeOf(error);
      done(code === "EADDRINUSE" ? { taken: true } : { error: code });
    });
    // Keep `exclusive` on every lock. On Windows a second socket that asks to share the
    // port meets an exclusive holder with an access error, not "in use" — which would
    // read here as `error`, and a held lock would pass for a free one.
    server.listen({ exclusive: true, host: "127.0.0.1", port }, () => {
      done({ held: server });
    });
  });
}
