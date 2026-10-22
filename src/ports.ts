/**
 * The local ports cc-smart-dev-kit holds as locks: only one program can listen on a port,
 * and the system frees it however that program ends — killed, or the machine losing power —
 * so a lock held this way can never go stale and needs no cleanup (`src/machine/hold-port.ts`).
 *
 * It sits below 32768: above it lies Linux's range for outgoing connections
 * (32768–60999; Windows and macOS start at 49152), where a port an outgoing connection used
 * in the last minute cannot be listened on, so a free lock would read as taken with nobody
 * holding it (measured 2026-10-09 in the project this was ported from).
 *
 * It is cc-smart-dev-kit's own. It sits away from the ports other programs on a machine use,
 * and away from the project that had its own copies (27605–27639), so both can run there
 * while the project moves.
 */
export const LOCK_PORTS = {
  /** One `worktrees --clean` (or `--remove`) at a time. */
  worktreesClean: 27_641,
} as const;

/**
 * The port the portal binds when nothing else is asked: 20150, the design's own number. It is
 * not a lock (the portal is a server), but it lives here with the other ports: the session-escape
 * guard (`src/hooks/session-escape-guard.ts`) reads the same number to ask before a Bash command
 * reaches the portal, and the portal command (`src/portal/command.ts`) binds it.
 */
export const DEFAULT_PORTAL_PORT = 20_150;
