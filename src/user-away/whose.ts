/**
 * Whose a parked item is. The list is the machine's, but the person brings each session back on
 * its own (`/cc-smart-dev-kit:user-available`), and two sessions that both went through every
 * item asked the person each other's questions. So each session goes through its own items
 * only, and names the others. Judged for the session that asks:
 *
 * - `this session`: it parked the item; or the session that owns it
 *   no longer runs and it was parked in this session's project (a session that ended, or this
 *   one before a `/clear`), so nobody else would answer it.
 * - `another session`: another running session owns it, and answers it there (`waitsIn`).
 * - `no session`: the session that owns it ended, in another project. Nobody answers it unless
 *   the person says to.
 *
 * A fact it cannot read never makes an item this session's: an owner it cannot see might be
 * running, and would ask the person the same thing.
 */
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { plainText } from "../gateway/plain-text";
import type { Env } from "../hooks/run";
import { liveSessions, type SessionRecord } from "../hooks/sessions";
import type { TimeFor } from "../project/resolve";
import { folderProject } from "../tasks/context";
import type { ParkedItem } from "./state";
import { AVAILABLE_SKILL, plural } from "./words";

export const WHOSE = ["this session", "another session", "no session"] as const;
export type Whose = (typeof WHOSE)[number];

/** The running session that answers an item, and the folder it works in. */
export interface WaitsIn {
  name: string;
  cwd: string;
}

export interface Owned {
  whose: Whose;
  /** For `another session`: the session, when its record could be read; else null. */
  waitsIn: WaitsIn | null;
}

/** What the judgement reads. `ownerFacts` gathers it; the tests hand in their own. */
export interface OwnerFacts {
  /** The asking session's id; null outside Claude Code (the person's own terminal). */
  session: string | null;
  /** The asking session's project key; null when it cannot be told. */
  project: string | null;
  /** The running sessions; null when their records cannot be read. */
  live: readonly SessionRecord[] | null;
  /** A folder's project key; null when it cannot be told. */
  projectOf: (cwd: string) => string | null;
}

const THIS: Owned = { whose: "this session", waitsIn: null };
const NOBODY: Owned = { whose: "no session", waitsIn: null };
const UNSEEN: Owned = { whose: "another session", waitsIn: null };

export function ownerOf(item: ParkedItem, facts: OwnerFacts): Owned {
  const asker = facts.session;
  const isAsker = (id: string) => asker !== null && id === asker;
  if (isAsker(item.session)) return THIS;
  if (item.session !== "") {
    if (facts.live === null) return UNSEEN;
    const running = facts.live.find((one) => one.sessionId === item.session);
    if (running !== undefined) {
      return { whose: "another session", waitsIn: { name: running.name, cwd: running.cwd } };
    }
  }
  const project = item.cwd === "" ? null : facts.projectOf(item.cwd);
  return project !== null && project === facts.project ? THIS : NOBODY;
}

/** Where the facts come from; the tests replace the two that read the machine. */
export interface OwnerSources {
  /** The running sessions: Claude Code's own records (`liveSessions`). */
  sessions?: () => readonly SessionRecord[];
  /** A folder's project key: `folderProject`. */
  projectOf?: (cwd: string) => string;
}

export interface Asker {
  /** The asking session's id, or null. */
  session: string | null;
  cwd: string;
  env: Env;
  paths: { claudeConfigDir: string; stateDir: string };
  /** A hook's shared budget for the git calls (`src/hooks/budget.ts`); none: each call's own limit. */
  timeFor?: TimeFor;
}

/** `fn`'s answer, or null when it throws: a fact that cannot be read is unknown. */
function orNull<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * A folder's project key on this machine. A folder that is gone (a removed worktree) belongs
 * where its nearest parent that is there does.
 */
function projectOnDisk(cwd: string, asker: Asker): string {
  let folder = cwd;
  while (!existsSync(folder) && dirname(folder) !== folder) folder = dirname(folder);
  return folderProject(folder, {
    env: asker.env,
    ...(asker.timeFor === undefined ? {} : { timeFor: asker.timeFor }),
  });
}

/** The facts for `asker`, read once for this list. */
export function ownerFacts(asker: Asker, sources: OwnerSources = {}): OwnerFacts {
  const projects = new Map<string, string | null>();
  const projectOf = (cwd: string): string | null => {
    if (projects.has(cwd)) return projects.get(cwd) ?? null;
    const key = orNull(() =>
      sources.projectOf ? sources.projectOf(cwd) : projectOnDisk(cwd, asker),
    );
    projects.set(cwd, key);
    return key;
  };
  return {
    session: asker.session,
    project: asker.cwd === "" ? null : projectOf(asker.cwd),
    live: orNull(() => (sources.sessions ?? (() => liveSessions(asker.paths.claudeConfigDir)))()),
    projectOf,
  };
}

/** Each item with whose it is, for `asker`. */
export function ownedItems(
  items: readonly ParkedItem[],
  asker: Asker,
  sources: OwnerSources = {},
): Array<ParkedItem & Owned> {
  if (items.length === 0) return [];
  const facts = ownerFacts(asker, sources);
  return items.map((item) => ({ ...item, ...ownerOf(item, facts) }));
}

/**
 * What waits, by whose it is: the lines `user available` and the hook's note say, so a session
 * goes through its own items and leaves the others to theirs.
 */
export function waitingLines(owned: readonly Owned[]): string[] {
  const mine = owned.filter((one) => one.whose === "this session").length;
  const ended = owned.filter((one) => one.whose === "no session").length;
  const elsewhere = new Map<string, number>();
  for (const one of owned) {
    if (one.whose !== "another session") continue;
    const name = one.waitsIn === null ? "a session it cannot name" : plainText(one.waitsIn.name);
    elsewhere.set(name, (elsewhere.get(name) ?? 0) + 1);
  }
  const others = owned.length - mine - ended;
  const lines: string[] = [];
  if (mine > 0) {
    lines.push(
      `${plural(mine, "item waits", "items wait")} for this session: go through ${mine === 1 ? "it" : "them"} with ${AVAILABLE_SKILL}.`,
    );
  }
  if (others > 0) {
    const where = [...elsewhere].map(([name, count]) => `${name} (${String(count)})`).join(", ");
    lines.push(
      `${plural(others, "item waits", "items wait")} in other sessions, which go through their own: ${where}.`,
    );
  }
  if (ended > 0) {
    lines.push(
      `${plural(ended, "item was", "items were")} parked in another project by a session that ended: ${AVAILABLE_SKILL} asks whether to take ${ended === 1 ? "it" : "them"} here.`,
    );
  }
  return lines;
}
