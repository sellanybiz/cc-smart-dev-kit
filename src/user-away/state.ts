/**
 * Whether the person can answer, and what waits for them: one file per kit state folder,
 * `<stateDir>/user-away/state.json` (`$CLAUDE_CONFIG_DIR/cc-smart-dev-kit/`, the machine's
 * `~/.claude/cc-smart-dev-kit/` unless the person runs Claude Code on another config folder).
 *
 * WHY ONE FILE, AND WHY HERE
 *   The person may be asleep, in a meeting or on a phone. While they cannot answer, a question
 *   or a permission prompt only stops the work. So a session reads this file to know the person is
 *   away, and **parks** what needs them — a question, an action a guard would not let through, a
 *   decision it took itself — in the list this file holds. The person goes through the list when
 *   they are back. The state is the person's, not a project's: the person is one, so every
 *   project and every session that shares the state folder sees the same answer.
 *
 * WHAT IT HOLDS
 *   `unavailable`/`since`/`until` (the expected return, for the note only: it never switches the
 *   state back, because the person may be late or not gone at all), the parked `items`, the next
 *   item id (it never goes back, so a cleared id is never reused), and `said`: the note each
 *   session heard last, so the note is said once per change (`src/hooks/user-away.ts`), and
 *   `stopSaid`: the note a session heard by the Stop block (`src/hooks/user-away-stop.ts`).
 *
 * HOW IT IS WRITTEN
 *   Every change reads, changes and writes whole under the folder's own lock (`withLock`, so two
 *   sessions that park at once both keep their item) through the kit's atomic write (a reader
 *   sees the old file or the new one, never half of one), mode 0600. A reader takes no lock.
 *   The lock is this folder's own, not setup's: a hook that parks must never wait for a setup run.
 *
 * A file that cannot be read is an `AwayStateError`, never "the person is available": a reader
 * that cannot tell must not guess in the loose direction.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";

/** The three things a session parks. */
export const PARK_KINDS = ["question", "action", "decision"] as const;
export type ParkKind = (typeof PARK_KINDS)[number];

/**
 * How long a park waits for the folder's lock by default: a write takes milliseconds. The
 * commands wait this long; a hook passes a shorter wait to `parkItem` (`PARK_WAIT_MS`,
 * `src/hooks/user-away.ts`), to stay inside its own time.
 */
export const AWAY_LOCK_WAIT_MS = 5_000;

/** The most items the list holds: a loop that parks without end must not grow the file for good. */
export const MAX_ITEMS = 500;

/** The most sessions whose last-heard note the file remembers. */
export const MAX_SAID = 100;

const itemSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(PARK_KINDS),
  /** What is parked: the question, why an action waits, or what was chosen and how to undo it. */
  text: z.string(),
  /** An action's exact command; null for a question, a decision, or a call that is no command. */
  command: z.string().nullable(),
  /** The tool an action was for (`Bash`); null when the session parked it by hand. */
  tool: z.string().nullable(),
  /** A question's options, and the one recommended (1-based); empty and null for the others. */
  options: z.array(z.string()),
  recommend: z.number().int().positive().nullable(),
  /** The Claude Code session that parked it; empty when it could not be told. */
  session: z.string(),
  cwd: z.string(),
  at: z.string(),
});

const stateSchema = z.object({
  unavailable: z.boolean(),
  since: z.string().nullable(),
  until: z.string().nullable(),
  items: z.array(itemSchema),
  nextId: z.number().int().positive(),
  said: z.record(z.string(), z.string()),
  /**
   * The note each session heard last at its turn end (the `user-away` Stop block, 2.2.0): kept
   * apart from `said`, which the Stop decision reads, because this one is written during a Stop.
   * Only the prompt note reads it. A file written before 2.2.0 has none.
   */
  stopSaid: z.record(z.string(), z.string()).default({}),
});

export type ParkedItem = z.infer<typeof itemSchema>;
export type AwayState = z.infer<typeof stateSchema>;

/** What a session gives to park: the item before it has an id and a time. */
export type ParkDraft = Omit<ParkedItem, "at" | "id">;

/** The state file cannot be read, or the list is full. */
export class AwayStateError extends Error {
  override name = "AwayStateError";
}

function freshState(): AwayState {
  return {
    unavailable: false,
    since: null,
    until: null,
    items: [],
    nextId: 1,
    said: {},
    stopSaid: {},
  };
}

/** The folder of the state and its lock. */
export function awayDir(stateDir: string): string {
  return join(stateDir, "user-away");
}

export function awayStateFile(stateDir: string): string {
  return join(awayDir(stateDir), "state.json");
}

/**
 * The state: available, with an empty list, when no file is there. Throws `AwayStateError` when
 * the file is there and cannot be read — and never says "available" for it.
 */
export function readAway(stateDir: string): AwayState {
  const file = awayStateFile(stateDir);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return freshState();
    throw new AwayStateError(`${file} cannot be read: ${(error as Error).message}`);
  }
  try {
    return stateSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new AwayStateError(
      `${file} is not a state file (${(error as Error).message.split("\n")[0]}). Fix it or remove it.`,
    );
  }
}

/** Reads, changes and writes the state whole, under the folder's lock. */
async function change<T>(
  stateDir: string,
  apply: (state: AwayState) => T,
  waitMs: number = AWAY_LOCK_WAIT_MS,
): Promise<{ result: T; state: AwayState }> {
  const folder = awayDir(stateDir);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  return await withLock(
    folder,
    () => {
      const state = readAway(stateDir);
      const result = apply(state);
      atomicWrite(awayStateFile(stateDir), `${JSON.stringify(state, null, 2)}\n`, 0o600);
      return { result, state };
    },
    { waitMs },
  );
}

/**
 * The person cannot answer from now on. Already unavailable: the first `since` stays, and `until`
 * is the one given (null: none). The list is never touched.
 */
export async function setUnavailable(
  stateDir: string,
  nowMs: number,
  until: null | string,
): Promise<AwayState> {
  const { state } = await change(stateDir, (current) => {
    if (!current.unavailable) current.since = new Date(nowMs).toISOString();
    current.unavailable = true;
    current.until = until;
  });
  return state;
}

/**
 * The person can answer again. The list stays: they go through it after the state is back, so
 * a question can be asked of them at all. What sessions last heard stays too: each session that
 * heard "unavailable" is told once that it is over (`forgetSaid`).
 */
export async function setAvailable(stateDir: string): Promise<AwayState> {
  const { state } = await change(stateDir, (current) => {
    current.unavailable = false;
    current.since = null;
    current.until = null;
  });
  return state;
}

/**
 * The item with the same kind, the same command (or, with none, the same words), the same folder
 * too. The session is not part of the key: a retry from the same
 * folder is the same thing. The folder is: a yes runs an action in its `cwd` only, so the same
 * command from two worktrees is two actions.
 */
function sameItem(items: readonly ParkedItem[], draft: ParkDraft): ParkedItem | undefined {
  const what = (item: { command: null | string; text: string }) => item.command ?? item.text;
  return items.find(
    (item) => item.kind === draft.kind && what(item) === what(draft) && item.cwd === draft.cwd,
  );
}

/**
 * Adds one item to the list. A kind, a command (or words), and a folder that already wait
 * stay one item: a session denied the same command again is not a second thing for the person
 * to answer. Throws `AwayStateError` when the list is full, and `LockBusyError` when the lock
 * stays held for `waitMs`.
 */
export async function parkItem(
  stateDir: string,
  draft: ParkDraft,
  nowMs: number,
  waitMs: number = AWAY_LOCK_WAIT_MS,
): Promise<{ added: boolean; item: ParkedItem }> {
  const { result } = await change(
    stateDir,
    (state) => {
      const same = sameItem(state.items, draft);
      if (same !== undefined) return { added: false, item: same };
      if (state.items.length >= MAX_ITEMS) {
        throw new AwayStateError(
          `the list already holds ${String(MAX_ITEMS)} items: go through it with the user-available skill first`,
        );
      }
      const item: ParkedItem = { ...draft, id: state.nextId, at: new Date(nowMs).toISOString() };
      state.nextId += 1;
      state.items.push(item);
      return { added: true, item };
    },
    waitMs,
  );
  return result;
}

/** Removes the named items, or every one: what the person answered. */
export async function clearItems(
  stateDir: string,
  ids: "all" | readonly number[],
): Promise<{ missing: number[]; removed: number[] }> {
  const { result } = await change(stateDir, (state) => {
    const have = new Set(state.items.map((item) => item.id));
    const wanted = ids === "all" ? [...have] : [...ids];
    const removed = wanted.filter((id) => have.has(id));
    const missing = wanted.filter((id) => !have.has(id));
    state.items = state.items.filter((item) => !removed.includes(item.id));
    return { missing, removed };
  });
  return result;
}

/**
 * True when `session` has not heard `key` as its last note, and records it; false when it has.
 * The cheap path takes no lock: a session that heard it already costs one read.
 */
export async function sayOnce(stateDir: string, session: string, key: string): Promise<boolean> {
  return await recordOnce(stateDir, "said", session, key);
}

/**
 * Records that `session` heard `key` at its turn end (`stopSaid`); true when it was not recorded
 * yet. The same rules as `sayOnce`, in the mark the Stop decision never reads.
 */
export async function stopSayOnce(
  stateDir: string,
  session: string,
  key: string,
): Promise<boolean> {
  return await recordOnce(stateDir, "stopSaid", session, key);
}

/** `sayOnce` and `stopSayOnce`: one mark, each holding at most `MAX_SAID` sessions. */
async function recordOnce(
  stateDir: string,
  mark: "said" | "stopSaid",
  session: string,
  key: string,
): Promise<boolean> {
  if (readAway(stateDir)[mark][session] === key) return false;
  const { result } = await change(stateDir, (state) => {
    const heard = state[mark];
    if (heard[session] === key) return false;
    // Delete first, so the session moves to the end: the oldest ones are the ones that go.
    delete heard[session];
    heard[session] = key;
    for (const old of Object.keys(heard).slice(0, -MAX_SAID)) delete heard[old];
    return true;
  });
  return result;
}

/**
 * True when `session` had a recorded note, at a prompt or at its turn end, and forgets both: the
 * session is told once that the person is available again, and never again until the next time.
 * The cheap path takes no lock.
 */
export async function forgetSaid(stateDir: string, session: string): Promise<boolean> {
  const heard = (state: AwayState) =>
    state.said[session] !== undefined || state.stopSaid[session] !== undefined;
  if (!heard(readAway(stateDir))) return false;
  const { result } = await change(stateDir, (state) => {
    if (!heard(state)) return false;
    delete state.said[session];
    delete state.stopSaid[session];
    return true;
  });
  return result;
}
