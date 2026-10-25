/**
 * A port on this machine as a lock. Only one program can listen on a port, and the system
 * frees it the moment that program ends — also when it is killed or the machine loses
 * power — so a lock held this way can never go stale, and there is nothing to clean up.
 *
 * Its one caller is `holdCleanLock` (`src/worktrees/clean.ts`, `LOCK_PORTS.worktreesClean`), the
 * lock of every worktree clean: `worktrees --clean` / `--remove`, the automatic clean, and
 * `finishParkedWorktrees` (`src/crew/remove.ts`: `crew rm` and the lead's watch).
 */
import { createServer, type Server } from "node:net";

export type PortHold =
  /** Any refusal but "in use" — a port the system keeps for itself, for example. */
  | { error: string }
  /** Keep it: the lock is held while it listens, and `close()` releases it. */
  | { held: Server }
  /** Another program listens there. */
  | { taken: true };

function codeOf(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "unknown error";
}

/** Listens on 127.0.0.1:`port`, which is what takes the lock. */
export function holdPort(port: number): Promise<PortHold> {
  return new Promise((done) => {
    const server = createServer((socket) => {
      // Nobody has anything to say over this port; it is only a lock.
      socket.destroy();
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
