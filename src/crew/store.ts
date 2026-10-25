/**
 * The crew store: what the kit knows of each lead and crew session, per repository.
 *
 *   <stateDir>/crew/<repo key>/crew/<crew id>.json   one record per crew session
 *   <stateDir>/crew/<repo key>/leads/<session id>.json    one record per lead
 *   <stateDir>/crew/<repo key>/reports/<crew id>.json   a crew session's hand-back report
 *   <stateDir>/crew/<repo key>/files/<crew id>/         its brief and its settings file
 *   <stateDir>/crew/<repo key>/notes/<lead id>.json      where that lead's notes hook is in the log
 *   <stateDir>/crew/<repo key>/stop/<crew id>.json        where that crew session's Stop hook is in the log
 *   <stateDir>/crew/<repo key>/watch/<lead id>.json       what that lead's watch has read and said
 *   <stateDir>/crew/<repo key>/watch-lease/<lead id>.json which one watch acts for that lead (WF1)
 *   <stateDir>/crew/<repo key>/events.jsonl               every change, one line each, append-only
 *   <stateDir>/crew/<repo key>/lock                       held for a moment by each write
 *
 * The key is the review record's (`repoKey` in `src/workflow/reviews.ts`, a hash of the main
 * checkout's folder), so every worktree of a repository shares one store, as it shares one review
 * record. The store is the kit's own state, not a person's file: folders 0700, files 0600, every
 * record written whole through the kit's atomic write (`atomicWrite`), so a reader sees the old
 * record or the new one, never half of one.
 *
 * **The store is the truth about who is a crew session.** A name only shows a role (`names.ts`); a
 * session is ever stopped or removed by the kit only when this store records it (D35).
 *
 * **Every write holds the store's own lock** (`withLock` on the repository's folder, a short
 * wait): two leads, or a lead and a crew reporting at once, both land, and no
 * read-modify-write drops the other's change. A state change and its event are written under
 * the same hold, so the events log never misses a change and never runs ahead of a record.
 *
 * **Older and newer kits share it.** A daemon's spare process or a session started before an
 * update runs older code. Every record, event and report carries the schema `version` it was
 * written with (`CREW_STORE_VERSION`). A reader keeps every field it does not know, reads a
 * state, kind, event type or report status it does not know as itself, and an update by an older
 * kit keeps what a newer one wrote — and the newer version number. A record that lacks a field
 * this kit needs is broken: a single read throws (`CrewStoreError`, naming the file and the
 * field), and a list names it under `broken` and goes on.
 *
 * `crew lead` and `crew start` (`lead.ts`, `start.ts`) write it; `crew watch` and the crew session
 * hooks are later phases.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { CrewKind } from "../models/launch-policy";
import { samePath } from "../path-compare";
import { FALLBACK_STALE_MS, holderIsGone, type ProcessHolder, withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";
import { COMMIT_SHA, repoKey } from "../workflow/reviews";
import { describeIssues } from "../zod-issues";

/** The schema version this kit writes. A record may carry a higher one: read it all the same. */
export const CREW_STORE_VERSION = 1;

/** How long a write waits for the store's lock: a write takes milliseconds. */
export const STORE_LOCK_WAIT_MS = 3_000;

/**
 * The states a crew session is in, in the order a crew session usually goes through them:
 *
 * - `queued` — recorded, waiting for a free place (the cap, free memory) or for its phases;
 * - `starting` — its worktree and session are being made, until its own SessionStart hook says it
 *   is in its worktree (`src/hooks/crew-role.ts`); the launcher never judges the folder, because
 *   `claude agents --json` reports the launch folder until a `-w` session has entered it;
 * - `working` — its session is running a turn;
 * - `blocked` — it waits on the lead or the person (a question, a permission);
 * - `paused` — it waits for a usage limit to reset, or for its gateway slot to answer again
 *   (`waitingFor` says which);
 * - `quiet` — agent view says working, but its transcript has not moved for a while (an alert);
 * - `done` / `failed` — its turn ended with that report; **`done` stays `done`** when the
 *   watch stops its session afterwards (D62: `stopped` means something else);
 * - `stopped` — a crew session its phase was not over for was stopped (`claude stop`, by the
 *   lead, or by the watch's idle stop); the conversation stays on disk, and **its removal is
 *   the lead's call** — the watch marks it merged when the lead merged its branch, and never
 *   removes it (D62);
 * - `handoff` — it handed off to a next crew session, and ended;
 * - `merged` — the lead merged its branch; the watch then removes it, unless a refusal was said;
 * - `removed` — its session, worktree and branch are gone.
 */
export const CREW_STATES = [
  "queued",
  "starting",
  "working",
  "blocked",
  "paused",
  "quiet",
  "done",
  "failed",
  "stopped",
  "handoff",
  "merged",
  "removed",
  "discarded",
] as const;

export type CrewState = (typeof CREW_STATES)[number];

/** One of `T`, or a word a newer kit wrote, read as itself. */
export type KnownOr<T extends string> = T | (string & {});

/** True when this kit knows `state`; a newer kit's state is read as itself, and is not. */
export function isKnownState(state: string): state is CrewState {
  return (CREW_STATES as readonly string[]).includes(state);
}

/**
 * What one line of the events log says happened: `question` is a crew session asking its lead
 * (D36); `tell` is a crew session telling other crew sessions a contract change or a contract
 * question (D47), kept so the lead sees it; `person` is the person typing into a crew session
 * (D55) — their word wins over the brief, and the lead reads the next report against it;
 * `lead-tell` is one lead telling another lead of the same repository a note (D55); `clash` is a
 * new crew session whose `--files` another lead's crew session holds too (D55); `merge` is a pull
 * request merged into the base, for the other leads (D55).
 *
 * **`clash` and `person` name a real crew session** (the one whose files another phase wants,
 * the one the person typed into). A `lead-tell` and a `merge` happen outside any crew session:
 * their `crew` is the id of the session that wrote the line, and their `state` is `working`,
 * the state of a session running a command — a lead has no crew state, and nothing reads a
 * crew state from a `lead-tell`, a `clash` or a `merge`.
 */
export const CREW_EVENT_TYPES = [
  "created",
  "state",
  "step",
  "report",
  "question",
  "tell",
  "person",
  "lead-tell",
  "clash",
  "merge",
] as const;
export type CrewEventType = (typeof CREW_EVENT_TYPES)[number];

/** How a crew session's hand-back ends. */
export const REPORT_STATUSES = ["done", "blocked", "failed", "handoff"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** A store file or record that cannot be used: the message names the file, or what is wrong. */
export class CrewStoreError extends Error {
  override name = "CrewStoreError";
}

/**
 * An id that is a plain file name: a crew session's id or a lead's session id. A letter or a digit
 * first, so never `.` or `..`, and never a temp file of an atomic write (which starts with `.`).
 */
const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A record's file name, from its id. */
const RECORD_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

/** The id, checked to be a plain file name before it is ever part of a path. */
function fileId(id: string, what: string): string {
  if (!FILE_ID.test(id)) {
    throw new CrewStoreError(`"${id}" is not a ${what} the store can name a file after`);
  }
  return id;
}

/**
 * Every repository's store, side by side: `<stateDir>/crew`. The machine-wide lock a start
 * decision holds lives here too (`withPlacesLock`, `places.ts`).
 */
export function crewRootDir(stateDir: string): string {
  return join(stateDir, "crew");
}

/** One repository's store: `<stateDir>/crew/<repo key>`. */
export function crewStoreDir(stateDir: string, repo: string): string {
  return join(crewRootDir(stateDir), repoKey(repo));
}

/** One crew session's record. */
export function crewFile(stateDir: string, repo: string, id: string): string {
  return join(crewStoreDir(stateDir, repo), "crew", `${fileId(id, "crew id")}.json`);
}

/** One lead's record, by its session id. */
export function leadFile(stateDir: string, repo: string, sessionId: string): string {
  return join(crewStoreDir(stateDir, repo), "leads", `${fileId(sessionId, "session id")}.json`);
}

/** One crew session's hand-back report. */
export function crewReportFile(stateDir: string, repo: string, id: string): string {
  return join(crewStoreDir(stateDir, repo), "reports", `${fileId(id, "crew id")}.json`);
}

/**
 * One crew session's own files: the brief its session reads, and the settings file its launch passes
 * (`--settings`). Beside the records, never in the worktree: the crew session cannot commit them.
 */
export function crewFilesDir(stateDir: string, repo: string, id: string): string {
  return join(crewStoreDir(stateDir, repo), "files", fileId(id, "crew id"));
}

/** The brief a crew session's Claude session reads first: what `crew start --brief` gave, and its frame. */
export function crewBriefFile(stateDir: string, repo: string, id: string): string {
  return join(crewFilesDir(stateDir, repo, id), "brief.md");
}

/** The settings file a crew session's launch passes: it names the crew session to its own session. */
export function crewSettingsFile(stateDir: string, repo: string, id: string): string {
  return join(crewFilesDir(stateDir, repo, id), "settings.json");
}

/**
 * The MCP servers a crew session's launch loads (`--strict-mcp-config --mcp-config`): the lean
 * start's own file, written beside its settings (`crew start`). A record started before the lean
 * start has none, and its launch loaded every server.
 */
export function crewMcpFile(stateDir: string, repo: string, id: string): string {
  return join(crewFilesDir(stateDir, repo, id), "mcp.json");
}

/** The repository's events log. */
export function crewEventsFile(stateDir: string, repo: string): string {
  return join(crewStoreDir(stateDir, repo), "events.jsonl");
}

const text = z.string().min(1);
const version = z.number().int().min(1);
const sha = z.string().regex(COMMIT_SHA, "a full commit sha");
const count = z.number().int().min(0);
/** A word of a known list, or a newer kit's word, read as itself. */
const word = <T extends string>() => text.transform((value): KnownOr<T> => value);

/**
 * One question a crew session asked its lead (D36): a crew session never asks the person itself. The lead
 * answers it, or asks the person; the crew session goes on with whatever the question does not block.
 * `recommended` is the option the crew session recommends, counted from 1; `answer` and `answeredAt`
 * stay null until the lead answers.
 */
const crewQuestionFields = z.looseObject({
  question: text,
  options: z.array(text).min(2),
  recommended: z.number().int().min(1).nullable(),
  askedAt: text,
  answeredAt: text.nullable(),
  answer: text.nullable(),
});

/** A question as recorded: its recommendation is one of its options, its answer has its time. */
const crewQuestion = crewQuestionFields.superRefine((asked, context) => {
  if (asked.recommended !== null && asked.recommended > asked.options.length) {
    context.addIssue({
      code: "custom",
      message: `recommends option ${asked.recommended} of ${asked.options.length}`,
      path: ["recommended"],
    });
  }
  if ((asked.answer === null) !== (asked.answeredAt === null)) {
    context.addIssue({
      code: "custom",
      message: "an answer and its time are given together",
      path: ["answeredAt"],
    });
  }
});

/** One question a crew session asked (`crewQuestion`). */
export type CrewQuestion = z.infer<typeof crewQuestionFields>;

/** What a crew session gives when it asks: the store adds when, and the answer comes later. */
export type NewCrewQuestion = Pick<CrewQuestion, "options" | "question" | "recommended">;

/**
 * The crew session a worktree belongs to: the record whose `worktree` is `path`, of any lead of
 * the repository and in any state but `removed`, the newest when a phase was started again in the
 * same folder. A `removed` record names nothing: its worktree, branch and session are gone, so a
 * folder at its path is not its own, and `crew rm` refuses it. One home for the Worktrees list,
 * the clean and the SessionStart note, so none of them names a crew session another does not.
 */
export function crewOfWorktree(records: readonly CrewRecord[], path: string): CrewRecord | null {
  let found: CrewRecord | null = null;
  for (const one of records) {
    if (["removed", "discarded"].includes(one.state) || !samePath(one.worktree, path)) continue;
    // `records` are oldest first: the last match is the newest.
    found = one;
  }
  return found;
}

/**
 * The states a crew session's phase is over in, so a question it left needs no answer: it handed
 * back, the lead merged its work, it failed, or it was removed. **A `stopped` crew session is not
 * one**: D35 stops a crew session that waits, and `crew answer` resumes it with the answer as its
 * next prompt — its question still waits (`answer.ts`).
 */
export const QUESTION_CLOSED_STATES = [
  "done",
  "failed",
  "handoff",
  "merged",
  "removed",
  "discarded",
] as const;

/** True when `state` ends the crew session's phase, closing every question it left open. */
export function questionClosed(state: string): boolean {
  return (QUESTION_CLOSED_STATES as readonly string[]).includes(state);
}

/**
 * The index of the question the lead may still answer: the newest with no answer, while the crew
 * session's phase is not over. Null when every question has its answer, or the phase is over: a
 * question the crew session left behind at its end needs no answer, and every reader agrees
 * (`crew answer`, `crew list`, `crew status`, the portal's Needs page and crew page).
 */
export function openQuestionIndex(record: CrewRecord): null | number {
  if (questionClosed(record.state)) return null;
  for (let index = record.questions.length - 1; index >= 0; index -= 1) {
    if (record.questions[index]?.answer === null) return index;
  }
  return null;
}

/**
 * What a crew session waits for while it is `paused` (D42): the slot whose every target is
 * limited or down (the router holds its requests), Claude's own plan limit (no target can
 * answer), or nothing the router's state explains (a server error, an overloaded backend the
 * router does not hold). The times are ISO 8601, like every other time in a record. Loose, like
 * every nested object here: a field a newer kit adds is kept when this kit writes the record again.
 */
const waitingForSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("slot"),
    /** When the wait began (ISO 8601). */
    since: text,
    /** The slot's key (`cc-smart-dev-kit-worker`). */
    slot: text,
  }),
  z.looseObject({
    kind: z.literal("claude-limit"),
    /** The Claude model at its limit (`claude-opus-5-5`). */
    model: text,
    /** When the limit resets (ISO 8601); null when Anthropic named no reset. */
    resetsAt: text.nullable(),
  }),
  z.looseObject({
    kind: z.literal("unknown"),
    /** When the wait began (ISO 8601). */
    since: text,
  }),
]);

/** What a paused crew session waits for (`waitingFor` on its record). */
export type WaitingFor = z.output<typeof waitingForSchema>;

/** A retained discard attempt, including its expiry marker. */
const discardArchiveSchema = z.looseObject({
  ref: text,
  head: sha,
  at: text,
  prunedAt: text.optional(),
});

/** The fields of a crew record. */
const crewFields = z.object({
  /** The schema version it was written with. */
  version,
  /** The kit's own id for the crew session: a plain file name, known before any session exists. */
  id: z.string().regex(FILE_ID, "a plain file name"),
  /** Its session's name (`crewName`). */
  name: text,
  /** Its session's id; null until the session exists. */
  sessionId: text.nullable(),
  /** The first 8 characters of the session id, as `claude agents` shows it; null until then. */
  shortId: text.nullable(),
  /** The lead that started it: its session id and its name. */
  leadSessionId: text,
  leadName: text,
  /** The repository: its main checkout's folder (the store's key). */
  repo: text,
  /** The plan the phase belongs to: the lead's plan's word (`lead.plan`), the one the name carries too. */
  plan: text,
  /** The phase and the slug its name and branch carry. */
  phase: text,
  slug: text,
  /** Its kind (`CREW_KINDS`): the model and effort it runs on. */
  kind: word<CrewKind>(),
  /**
   * The model as the launch named it, the gateway slot that answers it (null: Claude), the model
   * that does, and the premium tier the name stands for (`opus`, `fable`; null for none) — the
   * per-lead and machine opus caps count it (D54).
   */
  model: z.looseObject({
    named: text,
    slot: text.nullable(),
    resolved: text,
    tier: text.nullable(),
  }),
  /** The effort it runs at. */
  effort: text,
  /** Its permission mode (`auto` by default). */
  permissionMode: text,
  /** Its worktree's folder and branch. */
  worktree: text,
  branch: text,
  /** The ref it starts from: `--base`, or the branch the lead was on (its commit, when detached). */
  baseRef: text,
  /** The branch it started from and that branch's commit then; null until it starts. */
  base: z.looseObject({ ref: text, sha }).nullable(),
  /** The phases it waits for (`--waits-for`): it stays queued until each is merged (or removed). */
  waitsFor: z.array(text),
  /** The files its brief names. */
  files: z.array(text),
  /** The questions it asked its lead, oldest first (D36). */
  questions: z.array(crewQuestion),
  /** Where it is now (`CREW_STATES`). */
  state: word<CrewState>(),
  /** The last line its session wrote at the end of a turn; null before the first. */
  lastLine: z.string().nullable(),
  /** Its hand-back report's file; null before it reports. */
  reportPath: text.nullable(),
  /** Its pull request's number; null while it has none. */
  pr: z.number().int().positive().nullable(),
  /** The memory its session's process holds, in MB, when last read; null before that. */
  memoryMb: z.number().min(0).nullable(),
  /**
   * What it waits for while `paused`, taken from the router's state file (`limit-state.ts`)
   * when it pauses. **Only a `paused` record carries it**: any change of state away from
   * `paused` drops it (`changeCrew`), so a crew session that runs again never looks paused.
   * Absent on a record an older kit wrote.
   */
  waitingFor: waitingForSchema.optional(),
  /**
   * The resume running now (WF1, `claimResume`): its token and when it began. A resume launches a
   * Claude session, and two resumes of one record — the watch and the person's `crew resume
   * --paused`, or a watch and the newer one that took its lease — would start two copies. The
   * write that changes the record's state drops it; one older than `RESUME_CLAIM_MS` is over.
   * Absent on a record an older kit wrote.
   */
  resumeClaim: z.looseObject({ at: text, token: text }).optional(),
  /**
   * The last pause of the crew session (D42), kept when it goes on: when the wait began, and
   * how long the watch had to hold off before resuming it (`backoffMs`, 0 on a first pause).
   * A pause within 15 minutes of this one doubles that hold-off (`src/crew/wait.ts`).
   * Absent on a record a kit wrote before the field.
   */
  lastPause: z.looseObject({ backoffMs: count, since: text }).optional(),
  /**
   * When its session started (ISO 8601), not when it was recorded: a crew session that waited in the
   * queue for hours has not run for hours (the crew session's own time caps count from here). Absent on
   * a record an older kit wrote, and null before the session starts.
   */
  startedAt: text.nullable().optional(),
  /**
   * The id of the crew session whose hand-off this one carries on (`crew start --continue`); null or
   * absent for a first crew session. The chain is recorded, never worked out from names and branches:
   * a slug that ends in `-2` looks like a second crew session.
   */
  continues: text.nullable().optional(),
  /**
   * Set when the crew session is `removed`: true when the lead had merged its work first (the
   * record was `merged`), false when it was removed before that. A phase that waits for a
   * `removed` crew session starts only on true — `crew rm` also removes a phase whose work was
   * never merged, and that removal releases nothing (`finishesWait`, `places.ts`). Kept by the
   * store (`changeCrew`), so no command can set a state that disagrees with it.
   */
  mergedBeforeRemoval: z.boolean().optional(),
  /**
   * Set when the crew session became `merged` while it was `stopped` (D62): stopping a crew
   * session was the lead's call, and so is removing it, so the watch marks it merged — what
   * waits for its phase starts on the merge — and never removes it by itself. Kept by the store
   * (`changeCrew`), from the state the record was in; absent on any other record.
   */
  mergedWhileStopped: z.boolean().optional(),
  /** The watch proved this exact branch head was on this lead commit, before any rewrite. */
  mergeProof: z.looseObject({ head: sha, leadRef: text, leadCommit: sha }).optional(),
  /** Recovery is persisted before any removal; an unfinished active archive never expires. */
  archive: discardArchiveSchema.optional(),
  /** Failed attempts stay recoverable and expire independently after the normal retention. */
  archiveHistory: z.array(discardArchiveSchema).optional(),
  /** Durable rollback bytes stay until removal succeeds or the exact branch/index are restored. */
  discardPending: z
    .looseObject({
      head: sha,
      archivedHead: sha,
      indexPath: text,
      indexBackup: text,
      indexArchived: text,
    })
    .optional(),
  /** When it was recorded, and last changed (ISO 8601). */
  createdAt: text,
  updatedAt: text,
});

/** A crew record, as written and read (a newer kit's fields kept). */
export const crewRecordSchema = crewFields.loose();
export type CrewRecord = z.infer<typeof crewFields>;

/** What a caller gives for a new crew session: the store adds the version and the times. */
export type NewCrew = Omit<CrewRecord, "createdAt" | "updatedAt" | "version">;

/** What an update may change: everything but who the crew session is and when it was recorded. */
export type CrewChange = Partial<Omit<CrewRecord, "createdAt" | "id" | "repo" | "version">>;

/** The fields of a lead record. */
const leadFields = z.object({
  version,
  /** The lead's session id: the record's key. */
  sessionId: z.string().regex(FILE_ID, "a plain file name"),
  /** Its name (`leadName`). */
  name: text,
  /** The repository, by its main checkout's folder. */
  repo: text,
  /** The plan it leads. */
  plan: text,
  /** The tag of its name, which its crew sessions' names carry too (`crewTag`, or `crew lead --tag`). */
  tag: text,
  /** The folder the lead works in. */
  cwd: text,
  /** The plan ended; absent on leads recorded before this field existed. */
  endedAt: text.nullable().optional(),
  /** First successful agent-view read that did not know this lead; cleared when it returns. */
  sessionUnknownSince: text.nullable().optional(),
  /**
   * The lead's own subagents that stopped on an API error and wait to be woken again
   * (session ids, oldest first); absent on a record an older kit wrote. The lead's notes
   * hook records them, and the lead resumes each with a message (never a new session).
   */
  pausedAgents: z.array(text).optional(),
  createdAt: text,
  updatedAt: text,
});

export const leadRecordSchema = leadFields.loose();
export type LeadRecord = z.infer<typeof leadFields>;
export type NewLead = Omit<LeadRecord, "createdAt" | "updatedAt" | "version">;

/** The fields of one line of the events log. */
const eventFields = z.object({
  version,
  /** When it happened (ISO 8601). */
  at: text,
  /** What happened (`CREW_EVENT_TYPES`). */
  type: word<CrewEventType>(),
  /**
   * The session the event is about, or that wrote it: a crew session's id — for a `lead-tell`
   * or a `merge`, the session that wrote the line (`CREW_EVENT_TYPES` says which).
   */
  crew: z.string().regex(FILE_ID, "a plain file name"),
  /** The name its line prints: a crew session's, a sending lead's, or the merging session's. */
  name: text,
  /** The lead's session id, so a lead reads only its own crew sessions' lines; null when none. */
  lead: text.nullable(),
  /** The crew session's state after it. */
  state: word<CrewState>(),
  /**
   * One short line: the step, the report's status, why it failed. A `clash` or `merge` carries
   * its whole line, and a `lead-tell` the note's first line without the tag; null when none.
   */
  text: z.string().nullable(),
  /** The commit the step or the report happened at, when the crew session named one. */
  sha: sha.nullable().optional(),
  /** What the crew session did at its step, in its own words; null when it said nothing. */
  note: z.string().nullable().optional(),
  /** The memory the crew session's process held, in MB, when the event happened. */
  memoryMb: z.number().min(0).nullable().optional(),
  /** A `tell` or `lead-tell` event: the kind of the note and the names told (crew sessions, or leads). */
  tell: z
    .looseObject({ kind: text, to: z.array(text) })
    .nullable()
    .optional(),
});

export const crewEventSchema = eventFields.loose();
export type CrewEvent = z.infer<typeof eventFields>;
export type NewCrewEvent = Omit<CrewEvent, "at" | "version">;

/** One test command a crew session ran, and its counts. */
const testRun = z.looseObject({ command: text, passed: count, failed: count, ok: z.boolean() });

/** The fields of a hand-back report: what a crew session hands the lead when its phase ends. */
const reportFields = z.object({
  version,
  /** How the phase ended (`REPORT_STATUSES`). */
  status: word<ReportStatus>(),
  phase: text,
  /** The crew session's branch and its head, and the base it started from. */
  branch: z.looseObject({ name: text, sha }),
  base: z.looseObject({ ref: text, sha }),
  /** Its pull request's number; null when there is none. */
  pr: z.number().int().positive().nullable(),
  /** The diff against the base, counted. */
  changed: z.looseObject({ files: count, insertions: count, deletions: count }),
  /** Files it changed that its brief did not name. */
  outsideBrief: z.array(text),
  /** The done-check commands, and the whole suite once (null when it never ran). */
  tests: z.looseObject({ targeted: z.array(testRun), full: testRun.nullable() }),
  /** The other checks (type check, lint, the neutrality and duplicate checks). */
  checks: z.array(z.looseObject({ name: text, ok: z.boolean(), note: z.string().nullable() })),
  /** The one review: who ran it, on which model and effort, the commit it read, each finding and its fix. */
  review: z
    .looseObject({
      agent: text,
      model: text,
      effort: text,
      sha,
      findings: z.array(z.looseObject({ finding: text, fix: text })),
    })
    .nullable(),
  /**
   * The crew session's own review, where its brief asked for no second opinion: why none was
   * needed, and each finding with its fix. Null when there is none (older reports have no field).
   */
  ownReview: z
    .looseObject({
      reason: text,
      findings: z.array(z.looseObject({ finding: text, fix: text })),
    })
    .nullable()
    .optional(),
  /** The docs it changed. */
  docs: z.array(text),
  /** What only the lead may do: text for the lead's own files, a decision. */
  needsLead: z.array(text),
  /** What is still open. */
  open: z.array(text),
  /** The question it is blocked on; null unless it is blocked. */
  question: text.nullable(),
  /** The crew session's own words about the phase, when it wrote prose instead of the fields. */
  summary: text.nullable().optional(),
});

/** A blocked report must say what it waits on: the lead cannot answer a question it never saw. */
export const handBackReportSchema = reportFields.loose().superRefine((report, context) => {
  if (report.status === "blocked" && report.question === null) {
    context.addIssue({
      code: "custom",
      message: "a blocked report names the question it waits on",
      path: ["question"],
    });
  }
});
export type HandBackReport = z.infer<typeof reportFields>;

/** What a list could read, and every file it could not, with why. */
export interface Listed<T> {
  broken: Array<{ file: string; why: string }>;
  records: T[];
}

/** An ISO 8601 time from milliseconds. */
function iso(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** True when `error` says the file is not there. */
function notThere(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** What went wrong, in words. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `value` checked against `schema`, or the error that names `file` and each field. */
function checked<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CrewStoreError(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}

/** The record in `file`: null when there is none; throws `CrewStoreError` when it is broken. */
function readRecord<T>(schema: z.ZodType<T>, file: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (notThere(error)) return null;
    throw new CrewStoreError(`Cannot read ${file}: ${reasonOf(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new CrewStoreError(`Invalid ${file}: not valid JSON (${reasonOf(error)})`);
  }
  return checked(schema, value, file);
}

/** Every record in `folder`, oldest first (`createdAt`, then the file name); the broken ones named. */
function listRecords<T extends { createdAt: string }>(
  schema: z.ZodType<T>,
  folder: string,
): Listed<T> {
  const listed: Listed<T> = { broken: [], records: [] };
  if (!existsSync(folder)) return listed;
  const found: Array<{ file: string; record: T }> = [];
  for (const name of readdirSync(folder).sort()) {
    if (!RECORD_FILE.test(name)) continue;
    const file = join(folder, name);
    try {
      const record = readRecord(schema, file);
      if (record !== null) found.push({ file, record });
    } catch (error) {
      listed.broken.push({ file, why: reasonOf(error) });
    }
  }
  found.sort(
    (a, b) => a.record.createdAt.localeCompare(b.record.createdAt) || a.file.localeCompare(b.file),
  );
  listed.records = found.map((one) => one.record);
  return listed;
}

/** Writes `text` whole: its folder 0700, the file 0600, through the kit's atomic write. */
export function writeStoreFile(file: string, text: string): void {
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  atomicWrite(file, text, 0o600);
}

/**
 * Writes `value` whole, as JSON (`writeStoreFile`). One home for the kit's JSON state: a
 * record, and a session's `--settings` file, which `crew start` and `cc-smart-dev-kit launch`
 * both pass to `claude --settings` (mode 0600, so a file a session reads is never another
 * user's to read).
 */
export function writeJsonFile(file: string, value: unknown): void {
  writeStoreFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Appends one event line (0600 when it makes the file). Call it under the store's lock. */
function appendEvent(stateDir: string, repo: string, event: CrewEvent): void {
  const file = crewEventsFile(stateDir, repo);
  const line = checked(crewEventSchema, event, file);
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

/** Runs `write` holding the repository's store lock (its folder made 0700 first). */
async function underStoreLock<T>(stateDir: string, repo: string, write: () => T): Promise<T> {
  const folder = crewStoreDir(stateDir, repo);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  return await withLock(folder, write, { waitMs: STORE_LOCK_WAIT_MS });
}

/** The crew session `id` of `repo`: null when none is recorded; throws when its record is broken. */
export function readCrew(stateDir: string, repo: string, id: string): CrewRecord | null {
  return readRecord(crewRecordSchema, crewFile(stateDir, repo, id));
}

/** Every crew session of `repo`, oldest first. Never throws for a broken record: it is named. */
export function listCrew(stateDir: string, repo: string): Listed<CrewRecord> {
  return listRecords(crewRecordSchema, join(crewStoreDir(stateDir, repo), "crew"));
}

/**
 * Every record of one store folder (`crew`, `leads`) in every repository of this machine,
 * oldest first, two records of one time ordered by `tie`: the one walk both machine-wide
 * readers use, so they can never list a machine's store differently.
 */
function listAllRecords<T extends { createdAt: string }>(
  schema: z.ZodType<T>,
  stateDir: string,
  folder: string,
  tie: (one: T) => string,
): Listed<T> {
  const root = crewRootDir(stateDir);
  const all: Listed<T> = { broken: [], records: [] };
  if (!existsSync(root)) return all;
  for (const key of readdirSync(root).sort()) {
    const one = listRecords(schema, join(root, key, folder));
    all.broken.push(...one.broken);
    all.records.push(...one.records);
  }
  all.records.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || tie(a).localeCompare(tie(b)),
  );
  return all;
}

/** Every crew session on this machine, of every repository, oldest first: what a machine-wide cap counts. */
export function listAllCrew(stateDir: string): Listed<CrewRecord> {
  return listAllRecords(crewRecordSchema, stateDir, "crew", (one) => one.id);
}

/**
 * Every lead on this machine, of every repository, oldest first: the Work page reads this, so
 * it shows every lead whose crew the machine's store holds, whatever folder the portal runs in.
 */
export function listAllLeads(stateDir: string): Listed<LeadRecord> {
  return listAllRecords(leadRecordSchema, stateDir, "leads", (one) => one.sessionId);
}

/**
 * Records a new crew session, and its `created` event. Refuses an id already recorded for the
 * repository (the first record stays), and a record the schema refuses (nothing is written).
 */
export async function createCrew(
  stateDir: string,
  crew: NewCrew,
  atMs: number,
): Promise<CrewRecord> {
  const file = crewFile(stateDir, crew.repo, crew.id);
  const at = iso(atMs);
  const record = checked(
    crewRecordSchema,
    { version: CREW_STORE_VERSION, ...crew, createdAt: at, updatedAt: at },
    file,
  );
  return await underStoreLock(stateDir, crew.repo, () => {
    if (existsSync(file)) {
      throw new CrewStoreError(
        `a crew session "${crew.id}" is already recorded for ${crew.repo} (${file})`,
      );
    }
    writeJsonFile(file, record);
    appendEvent(stateDir, crew.repo, eventOf(record, at, "created", null));
    return record;
  });
}

/**
 * Changes crew session `id` of `repo`: `change` over its record, `updatedAt` now. Every field this kit
 * does not know is kept, and so is a higher schema version. A changed state is one `state` event,
 * with `text` as its line; any other change is no event. Throws when the crew session is not recorded,
 * its record is broken, or the result breaks the schema (then nothing is written).
 *
 * `memoryMb` is what the event carries about the crew session's process (the watch reads it from
 * `/proc`); it is null when nothing is known.
 */
export async function updateCrew(
  stateDir: string,
  repo: string,
  id: string,
  change: CrewChange,
  atMs: number,
  text: null | string = null,
  memoryMb: null | number = null,
): Promise<CrewRecord> {
  const { record } = await changeCrew(stateDir, repo, id, atMs, (before, at) => ({
    change,
    event: (after) =>
      after.state === before.state ? null : eventOf(after, at, "state", text, memoryMb),
  }));
  return record;
}

/**
 * Changes crew session `id` **only while it is still in one of `states`**, read under the store's
 * own lock in the same hold as the write. A writer that judged a record from an earlier read (the
 * crew session's own hook, judging its folder) never overwrites what another writer set in
 * between: `working` over a launcher's `failed`, or `failed` over a `merged` the watch recorded.
 * Returns the record as it is now — changed or not. `text` is the state event's line, as
 * `updateCrew`'s.
 */
export async function updateCrewIfState(
  stateDir: string,
  repo: string,
  id: string,
  states: readonly string[],
  change: CrewChange,
  atMs: number,
  text: null | string = null,
): Promise<{ changed: boolean; record: CrewRecord }> {
  return await changeCrew(stateDir, repo, id, atMs, (before, at) => {
    if (!(states as readonly string[]).includes(before.state)) return null;
    return {
      change,
      event: (after) => (after.state === before.state ? null : eventOf(after, at, "state", text)),
    };
  });
}

/**
 * Records a question crew session `id` asks its lead (D36), and its `question` event, under one hold:
 * the question goes at the end of its `questions`, with no answer yet, and the event's line is
 * the question. Throws when the crew session is not recorded, or the question breaks the schema (fewer
 * than two options, a recommendation that is not one of them): then nothing is written.
 */
export async function addCrewQuestion(
  stateDir: string,
  repo: string,
  id: string,
  asked: NewCrewQuestion,
  atMs: number,
): Promise<CrewRecord> {
  const { record } = await changeCrew(stateDir, repo, id, atMs, (before, at) => ({
    change: {
      questions: [...before.questions, { ...asked, answer: null, answeredAt: null, askedAt: at }],
    },
    event: (after) => eventOf(after, at, "question", asked.question),
  }));
  return record;
}

/**
 * Records the lead's answer to question `index` (counted from 0, in `questions`) of crew session `id`.
 * Throws when there is no such question, or it has its answer already: an answer is given once.
 *
 * `resumes` is the state the answer brings the crew session back to, when it was waiting for it — a
 * `blocked` crew session the answer reaches, or a `stopped` one resumed with it, is `working` again —
 * written in the same hold, so the record never says `blocked` for a crew session that has its answer
 * (the watch stops a blocked crew session that idles). A crew session in any other state keeps its own. The
 * state change is one `state` event; the answer alone is none.
 *
 * `session` is the session a resume with the answer brought back (WF1: a resume can start a copy
 * with a new id): the record takes it in the same write, so it never names a session that is gone.
 */
export async function answerCrewQuestion(
  stateDir: string,
  repo: string,
  id: string,
  index: number,
  answer: string,
  atMs: number,
  resumes: null | CrewState = null,
  session: null | { sessionId: string; shortId: string } = null,
): Promise<CrewRecord> {
  const { record } = await changeCrew(stateDir, repo, id, atMs, (before, at) => {
    const asked = before.questions[index];
    if (asked === undefined) throw new CrewStoreError(`crew "${id}" has no question ${index}`);
    if (asked.answer !== null) {
      throw new CrewStoreError(`question ${index} of crew session "${id}" has its answer already`);
    }
    const questions = before.questions.map((one, which) =>
      which === index ? { ...one, answer, answeredAt: at } : one,
    );
    const waiting = before.state === "blocked" || before.state === "stopped";
    const state = resumes !== null && waiting ? resumes : null;
    return {
      change: {
        questions,
        ...(state === null ? {} : { state }),
        ...(session === null ? {} : { sessionId: session.sessionId, shortId: session.shortId }),
      },
      event: (after) =>
        state === null ? null : eventOf(after, at, "state", "an answer brought it back"),
    };
  });
  return record;
}

/** One line of the events log about `crew`, of `type`, with `text` as its line. */
function eventOf(
  crew: CrewRecord,
  at: string,
  type: CrewEventType,
  text: null | string,
  memoryMb: null | number = null,
): CrewEvent {
  return {
    at,
    lead: crew.leadSessionId,
    // The memory is in the line only when it is known: a line with nothing in it stays as it was.
    ...(memoryMb === null ? {} : { memoryMb }),
    name: crew.name,
    state: crew.state,
    text,
    type,
    version: CREW_STORE_VERSION,
    crew: crew.id,
  };
}

/** What one change of a crew record is: the fields, and the event (if any) that goes with it. */
interface PlannedChange {
  change: CrewChange;
  event: (after: CrewRecord) => CrewEvent | null;
}

/**
 * The one read-modify-write of a crew record, under the store's lock: `plan` reads the record
 * as it is now and says what changes, or null to write nothing (the record moved since the
 * caller read it). Every field this kit does not know is kept, and so is a
 * higher schema version; who the crew session never moves. Nothing is written when the result breaks
 * the schema, or `plan` throws.
 */
async function changeCrew(
  stateDir: string,
  repo: string,
  id: string,
  atMs: number,
  plan: (before: CrewRecord, at: string) => null | PlannedChange,
): Promise<{ changed: boolean; record: CrewRecord }> {
  const file = crewFile(stateDir, repo, id);
  return await underStoreLock(stateDir, repo, () => {
    const before = readRecord(crewRecordSchema, file);
    if (before === null) {
      throw new CrewStoreError(`no crew session "${id}" is recorded for ${repo} (${file})`);
    }
    const at = iso(atMs);
    const planned = plan(before, at);
    if (planned === null) return { changed: false, record: before };
    const { change, event } = planned;
    const merged = {
      ...before,
      ...change,
      // Who the crew session is never moves: its file is named after its id, its folder after its repo.
      createdAt: before.createdAt,
      id: before.id,
      repo: before.repo,
      updatedAt: at,
      version: Math.max(before.version, CREW_STORE_VERSION),
    };
    // `waitingFor` says what a `paused` crew session waits for, and nothing else: any state it
    // goes on in clears it here, so no path — an answer, a resume, a report — can leave a wait
    // behind on a crew session that is running again (D42). `lastPause` stays: a re-pause reads it.
    if (merged.state !== "paused") delete merged.waitingFor;
    // A resume's claim (`claimResume`) lasts while the record stays in the state it was claimed
    // in: the write that makes the resumed session `working` ends it.
    if (merged.state !== before.state) delete merged.resumeClaim;
    // A crew session removed after the lead merged its work keeps that fact here, and one removed
    // before the merge keeps the false: a phase that waits for it starts on the merge alone
    // (`finishesWait`, `places.ts`), never on the removal. Set from the record as it is now, under
    // this hold, so no caller can record a removal that disagrees with the state before it.
    if (merged.state === "removed") {
      merged.mergedBeforeRemoval = before.state === "merged" || before.mergedBeforeRemoval === true;
    }
    // A stopped crew session the lead merged stays the lead's to remove (D62): the fact is kept
    // here, from the state the record was in, so the watch cannot forget it on a later pass.
    if (merged.state === "merged" && before.state === "stopped") merged.mergedWhileStopped = true;
    const after = checked(crewRecordSchema, merged, file);
    writeJsonFile(file, after);
    const line = event(after);
    if (line !== null) appendEvent(stateDir, repo, line);
    return { changed: true, record: after };
  });
}

/** The lead with session id `sessionId` of `repo`: null when none is recorded. */
export function readLead(stateDir: string, repo: string, sessionId: string): LeadRecord | null {
  return readRecord(leadRecordSchema, leadFile(stateDir, repo, sessionId));
}

/** Every lead of `repo`, oldest first. Never throws for a broken record: it is named. */
export function listLeads(stateDir: string, repo: string): Listed<LeadRecord> {
  return listRecords(leadRecordSchema, join(crewStoreDir(stateDir, repo), "leads"));
}

/**
 * Records a lead, or records it again: a lead already there keeps when it was first recorded and
 * every field this kit does not know; the rest is `lead`.
 */
export async function writeLead(
  stateDir: string,
  lead: NewLead,
  atMs: number,
): Promise<LeadRecord> {
  const file = leadFile(stateDir, lead.repo, lead.sessionId);
  return await underStoreLock(stateDir, lead.repo, () => {
    const before = readRecord(leadRecordSchema, file);
    const at = iso(atMs);
    const record = checked(
      leadRecordSchema,
      {
        ...before,
        ...lead,
        createdAt: before?.createdAt ?? at,
        updatedAt: at,
        version: Math.max(before?.version ?? 0, CREW_STORE_VERSION),
      },
      file,
    );
    writeJsonFile(file, record);
    return record;
  });
}

/**
 * Records one successful agent-view observation without changing the lead's activity time.
 * The lock keeps an ended plan or a concurrently refreshed lead intact.
 */
export async function setLeadPresence(
  stateDir: string,
  repo: string,
  sessionId: string,
  known: boolean,
  atMs: number,
): Promise<LeadRecord | null> {
  const file = leadFile(stateDir, repo, sessionId);
  return await underStoreLock(stateDir, repo, () => {
    const before = readRecord(leadRecordSchema, file);
    if (before === null) return null;
    const since = known ? null : (before.sessionUnknownSince ?? iso(atMs));
    if (before.sessionUnknownSince === since) return before;
    const after = checked(leadRecordSchema, { ...before, sessionUnknownSince: since }, file);
    writeJsonFile(file, after);
    return after;
  });
}

/** Appends one line to the events log of `repo` (a step, a report), under the store's lock. */
export async function appendCrewEvent(
  stateDir: string,
  repo: string,
  event: NewCrewEvent,
  atMs: number,
): Promise<CrewEvent> {
  const line: CrewEvent = { version: CREW_STORE_VERSION, at: iso(atMs), ...event };
  await underStoreLock(stateDir, repo, () => appendEvent(stateDir, repo, line));
  return line;
}

/** What one read of the events log found, and where the next read goes on from. */
export interface EventsRead {
  events: CrewEvent[];
  /** The byte after the last whole line read: pass it to the next read. */
  offset: number;
  /** Whole lines that could not be read (not JSON, or missing a field this kit needs). */
  skipped: number;
}

/**
 * The events of `repo` from byte `offset` on, whole lines only: a line a writer has not finished
 * is left for the next read. A file shorter than `offset` was replaced, so it is read from its
 * start. No log yet: nothing, at offset 0.
 */
export function readCrewEvents(stateDir: string, repo: string, offset = 0): EventsRead {
  const file = crewEventsFile(stateDir, repo);
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (error) {
    if (notThere(error)) return { events: [], offset: 0, skipped: 0 };
    throw new CrewStoreError(`Cannot read ${file}: ${reasonOf(error)}`);
  }
  try {
    const size = fstatSync(fd).size;
    const from = offset >= 0 && offset <= size ? offset : 0;
    const bytes = Buffer.alloc(size - from);
    let filled = 0;
    while (filled < bytes.length) {
      const read = readSync(fd, bytes, filled, bytes.length - filled, from + filled);
      if (read === 0) break;
      filled += read;
    }
    const whole = bytes.subarray(0, filled).lastIndexOf(0x0a) + 1;
    const read: EventsRead = { events: [], offset: from + whole, skipped: 0 };
    for (const line of bytes.subarray(0, whole).toString("utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed = crewEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) read.events.push(parsed.data);
        else read.skipped += 1;
      } catch {
        // Not JSON: a line the log cannot use is counted, and the reader goes on.
        read.skipped += 1;
      }
    }
    return read;
  } finally {
    closeSync(fd);
  }
}

/** Writes crew session `id`'s hand-back report whole; returns its file. Refuses one the schema refuses. */
export async function writeReport(
  stateDir: string,
  repo: string,
  id: string,
  report: HandBackReport,
): Promise<string> {
  const file = crewReportFile(stateDir, repo, id);
  const value = checked(handBackReportSchema, report, file);
  await underStoreLock(stateDir, repo, () => writeJsonFile(file, value));
  return file;
}

/**
 * How long a resume's claim on a crew record holds (WF1): a resume runs `claude --bg --resume`
 * and one read of agent view, each bounded by 30 seconds (`CLAUDE_TIMEOUT_MS`), so a claim older
 * than this belongs to a resume that is over, whatever happened to it.
 */
export const RESUME_CLAIM_MS = 2 * 60_000;

/**
 * Claims the resume of crew session `id` for the resume `token` (WF1): true when the record is
 * still in one of `states` — the state its caller judged it in — and no other resume holds an
 * unexpired claim. Under the store's lock, so of two resumes of one record only one launches
 * Claude. The claim lasts until the record's state changes (`changeCrew`), `releaseResume`, or
 * `RESUME_CLAIM_MS`. Like `setCrewMemory`, it moves no `updatedAt` and writes no event.
 */
export async function claimResume(
  stateDir: string,
  repo: string,
  id: string,
  states: readonly string[],
  token: string,
  atMs: number,
): Promise<boolean> {
  const file = crewFile(stateDir, repo, id);
  return await underStoreLock(stateDir, repo, () => {
    const before = readRecord(crewRecordSchema, file);
    if (before === null) {
      throw new CrewStoreError(`no crew session "${id}" is recorded for ${repo} (${file})`);
    }
    if (!states.includes(before.state)) return false;
    const held = before.resumeClaim;
    if (held !== undefined && held.token !== token) {
      const since = Date.parse(held.at);
      if (Number.isFinite(since) && atMs - since < RESUME_CLAIM_MS) return false;
    }
    writeJsonFile(
      file,
      checked(crewRecordSchema, { ...before, resumeClaim: { at: iso(atMs), token } }, file),
    );
    return true;
  });
}

/** Ends the claim of the resume `token` on crew session `id`: a resume that started nothing. */
export async function releaseResume(
  stateDir: string,
  repo: string,
  id: string,
  token: string,
): Promise<void> {
  const file = crewFile(stateDir, repo, id);
  await underStoreLock(stateDir, repo, () => {
    const before = readRecord(crewRecordSchema, file);
    if (before?.resumeClaim?.token !== token) return;
    const { resumeClaim: _ended, ...after } = before;
    writeJsonFile(file, checked(crewRecordSchema, after, file));
  });
}

/**
 * Records the memory the crew session's process holds, and nothing else: the record's `updatedAt`
 * does not move (the watch reads it to know how long a blocked crew session has waited), and no
 * event is written (the memory is in the event the watch writes when the crew session ends).
 */
export async function setCrewMemory(
  stateDir: string,
  repo: string,
  id: string,
  memoryMb: number,
): Promise<CrewRecord> {
  const file = crewFile(stateDir, repo, id);
  return await underStoreLock(stateDir, repo, () => {
    const before = readRecord(crewRecordSchema, file);
    if (before === null) {
      throw new CrewStoreError(`no crew session "${id}" is recorded for ${repo} (${file})`);
    }
    const after = checked(crewRecordSchema, { ...before, memoryMb }, file);
    writeJsonFile(file, after);
    return after;
  });
}

/**
 * The state a report's status puts the crew session in: the status names the same state, except
 * `handoff`, which is its own. A status a newer kit wrote (the store reads one as itself) leaves
 * the state as it is: the kit does not guess what a word it does not know means.
 */
export function stateForReport(status: string): null | CrewState {
  switch (status) {
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "handoff":
      return "handoff";
    default:
      return null;
  }
}

/**
 * Records a crew session's hand-back report and the state it ends in, under one hold: the report
 * file, the record (`reportPath` and the state), and one `report` event whose line is the
 * status. Nothing is written when the report breaks the schema (then the crew session keeps its
 * state and the lead sees no event).
 */
export async function recordCrewReport(
  stateDir: string,
  repo: string,
  id: string,
  report: HandBackReport,
  atMs: number,
): Promise<{ file: string; record: CrewRecord }> {
  const file = crewReportFile(stateDir, repo, id);
  const value = checked(handBackReportSchema, report, file);
  const state = stateForReport(report.status);
  const recordFile = crewFile(stateDir, repo, id);
  const record = await underStoreLock(stateDir, repo, () => {
    const before = readRecord(crewRecordSchema, recordFile);
    if (before === null) {
      throw new CrewStoreError(`no crew session "${id}" is recorded for ${repo} (${recordFile})`);
    }
    const at = iso(atMs);
    const after = checked(
      crewRecordSchema,
      {
        ...before,
        ...(state === null ? {} : { state }),
        reportPath: file,
        createdAt: before.createdAt,
        id: before.id,
        repo: before.repo,
        updatedAt: at,
        version: Math.max(before.version, CREW_STORE_VERSION),
      },
      recordFile,
    );
    // The report file first: a record that names a report the file lacks is the worse half-write.
    writeJsonFile(file, value);
    writeJsonFile(recordFile, after);
    appendEvent(stateDir, repo, eventOf(after, at, "report", report.status));
    return after;
  });
  return { file, record };
}

/** The report in `file`: null when there is none; throws `CrewStoreError` when it is broken. */
export function readReport(file: string): HandBackReport | null {
  return readRecord(handBackReportSchema, file);
}

/**
 * Where a lead's watch keeps what it has already said: `<store>/watch/<lead session id>.json`.
 * One file per lead, so two leads watch their own crew sessions and neither loses the other's lines.
 */
export function watchStateFile(stateDir: string, repo: string, leadSessionId: string): string {
  return join(crewStoreDir(stateDir, repo), "watch", `${fileId(leadSessionId, "session id")}.json`);
}

/**
 * What a lead's watch has already read and already said: the byte in the events log it goes on
 * from, and the last thing it said about each crew session (so a line is said once, not every cycle).
 */
export interface WatchState {
  /** The byte after the last whole line the watch read. */
  offset: number;
  /** What the watch last said about each crew session, by its id. */
  said: Record<string, string>;
  /** True when the watch already told the lead that the monitors do not run here. */
  noted: boolean;
  /**
   * When the watch last resumed a paused crew session (ms), and the router's request count
   * then: the next one waits 30 s and for the router to answer since (D42,
   * `src/crew/wait.ts`). Absent on a state a kit wrote before the fields.
   */
  resumedAt?: number | undefined;
  routerRequests?: null | number | undefined;
  /**
   * When the watch last looked for folders a removal moved aside and could not remove (ms): a
   * folder that stays costs a scan of the whole repository, so it is looked at every few
   * minutes, not on every pass (D62). Absent on a state a kit wrote before the field.
   */
  parkedAt?: number | undefined;
  removals?: Record<string, { at: number; signature: string }> | undefined;
  /** The last daily stopped-session reminder per crew id. */
  stoppedRemindedAt?: Record<string, number> | undefined;
}

const watchStateFields = z.object({
  removals: z.record(z.string(), z.object({ at: z.number(), signature: z.string() })).optional(),
  parkedAt: z.number().int().min(0).optional(),
  noted: z.boolean().default(false),
  offset: count,
  said: z.record(z.string(), z.string()),
  resumedAt: z.number().int().min(0).optional(),
  routerRequests: z.number().int().min(0).nullable().optional(),
  stoppedRemindedAt: z.record(z.string(), z.number().int().min(0)).optional(),
});

/**
 * The lead's watch state: where it goes on in the events log, and what it last said about each
 * crew session. Null when there is no state yet — the watch then starts at the log's end, because the
 * lines before it are history the lead already saw (it started those crew sessions itself).
 */
export function readWatchState(
  stateDir: string,
  repo: string,
  leadSessionId: string,
): WatchState | null {
  try {
    const raw = readFileSync(watchStateFile(stateDir, repo, leadSessionId), "utf8");
    const parsed = watchStateFields.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // No state yet, or one that cannot be read: the watch starts fresh.
  }
  return null;
}

/**
 * The byte the events log ends at, so a watch that starts now reads only what happens from
 * here on. The log's size, read as it is: a line a writer has not finished is counted in, and
 * the watch reads whole lines only, so it reads that line again.
 */
export function eventsEndOffset(stateDir: string, repo: string): number {
  try {
    return statSync(crewEventsFile(stateDir, repo)).size;
  } catch {
    // No log yet: the watch starts at the beginning, which is the same as the end.
    return 0;
  }
}

/** Writes the lead's watch state. */
export function writeWatchState(
  stateDir: string,
  repo: string,
  leadSessionId: string,
  state: WatchState,
): void {
  writeStoreFile(
    watchStateFile(stateDir, repo, leadSessionId),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/**
 * Where a lead's acting watch is named: `<store>/watch-lease/<lead session id>.json` (WF1). One
 * file per lead, so two leads of one repository never share a lease.
 */
export function watchLeaseFile(stateDir: string, repo: string, leadSessionId: string): string {
  // A folder of its own: a lead id may hold a dot, so `watch/<id>.lease.json` could be another
  // lead's state file (`watch/<id>.json`).
  return join(
    crewStoreDir(stateDir, repo),
    "watch-lease",
    `${fileId(leadSessionId, "session id")}.json`,
  );
}

/**
 * The lease that names the one watch of a lead that acts (WF1): the process that holds it — its
 * pid, start time, host and pid namespace, as the store's lock records a holder
 * (`currentHolder`, `src/setup/lock.ts`) — its own token, so two watches in one process stay
 * apart, and when it took the lease (ms).
 */
export interface WatchLease extends ProcessHolder {
  at: number;
  token: string;
}

const watchLeaseFields = z.object({
  at: z.number().int().min(0),
  host: z.string(),
  pid: z.number().int().positive(),
  pidns: z.string().nullable().default(null),
  startTime: z.string().nullable(),
  token: text,
});

/** The lead's watch lease; null when there is none, or it cannot be read (then it is free). */
export function readWatchLease(
  stateDir: string,
  repo: string,
  leadSessionId: string,
): null | WatchLease {
  let raw: string;
  try {
    raw = readFileSync(watchLeaseFile(stateDir, repo, leadSessionId), "utf8");
  } catch (error) {
    if (notThere(error)) return null;
    throw error;
  }
  try {
    const parsed = watchLeaseFields.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Half a file a crash left, or not JSON: no holder can be read from it, so the lease is free.
    return null;
  }
}

/**
 * Takes the lead's watch lease for `lease`, whoever holds it: **the newest watch wins** — a
 * monitor the lead restarts is its intent, and the watch it replaces ends at its next pass
 * (`keepWatchLease`). Under the store's lock, so it never lands between another watch's look
 * and its take.
 */
export async function takeWatchLease(
  stateDir: string,
  repo: string,
  leadSessionId: string,
  lease: WatchLease,
): Promise<void> {
  await underStoreLock(stateDir, repo, () => {
    writeStoreFile(
      watchLeaseFile(stateDir, repo, leadSessionId),
      `${JSON.stringify(lease, null, 2)}\n`,
    );
  });
}

/**
 * Whether the watch `lease` may still act for its lead, judged under the store's lock: it holds
 * the lease, or the lease is free — none, unreadable, or its holder is gone (`holderIsGone`: the
 * pid is dead or was reused) — and it takes it back. Else `holder` is the live watch that took it.
 */
export async function keepWatchLease(
  stateDir: string,
  repo: string,
  leadSessionId: string,
  lease: WatchLease,
): Promise<{ held: true } | { held: false; holder: WatchLease }> {
  return await underStoreLock(stateDir, repo, () => {
    const now = readWatchLease(stateDir, repo, leadSessionId);
    if (now !== null && now.token === lease.token) return { held: true };
    if (now !== null && !holderIsGone(now, now.at, FALLBACK_STALE_MS)) {
      return { held: false, holder: now };
    }
    writeStoreFile(
      watchLeaseFile(stateDir, repo, leadSessionId),
      `${JSON.stringify(lease, null, 2)}\n`,
    );
    return { held: true };
  });
}

/**
 * Where a lead's notes hook keeps how far it has read: `<store>/notes/<lead session id>.json`.
 * One file per lead, so two leads of one repository never move each other's cursor.
 */
export function notesStateFile(stateDir: string, repo: string, leadSessionId: string): string {
  return join(crewStoreDir(stateDir, repo), "notes", `${fileId(leadSessionId, "session id")}.json`);
}

/**
 * What the lead's notes hook last read: the byte in the events log it goes on from. One write per
 * turn, so a line the person already saw is never said twice (`src/hooks/lead-notes.ts`).
 */
export interface NotesState {
  /** The byte after the last whole line the notes hook read. */
  offset: number;
}

const notesStateFields = z.object({ offset: count });

/**
 * The lead's notes cursor: null when there is none yet (the hook then seeds it at the log's end,
 * because the lines before it are history the lead already saw), or when the file cannot be
 * read. Never throws: a cursor that cannot be read starts fresh, never stops a turn.
 */
export function readNotesState(
  stateDir: string,
  repo: string,
  leadSessionId: string,
): NotesState | null {
  try {
    const raw = readFileSync(notesStateFile(stateDir, repo, leadSessionId), "utf8");
    const parsed = notesStateFields.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // No cursor yet, or one that cannot be read: the notes hook starts fresh.
  }
  return null;
}

/** Writes the lead's notes cursor. */
export function writeNotesState(
  stateDir: string,
  repo: string,
  leadSessionId: string,
  state: NotesState,
): void {
  writeStoreFile(
    notesStateFile(stateDir, repo, leadSessionId),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/**
 * Where a crew session's Stop hook keeps how far it has read: `<store>/stop/<crew id>.json`.
 * One file per crew session, so two crew sessions never move each other's cursor, and a Stop
 * costs the same on day 30 as on day 1 — the log only grows.
 */
export function stopStateFile(stateDir: string, repo: string, id: string): string {
  return join(crewStoreDir(stateDir, repo), "stop", `${fileId(id, "crew id")}.json`);
}

/**
 * What a crew session's Stop hook last read of the events log (`src/hooks/crew-role.ts`): the
 * byte it goes on from, and whether the newest `step` or `report` event of the crew session it
 * has seen is a `step` (the turn ended mid-phase with no report) or a `report`. The two facts
 * together answer the same question a read from the log's start answered, without reading the
 * history the hook already read (`readCrewEvents`).
 */
export interface StopState {
  /** The byte after the last whole line the Stop read. */
  offset: number;
  /** The newest `step` or `report` event the Stop has seen: its type, or null before either. */
  last: "report" | "step" | null;
}

const stopStateFields = z.object({
  last: z.enum(["report", "step"]).nullable(),
  offset: count,
});

/**
 * The crew session's Stop cursor: null when there is none yet (the Stop then reads from the log's
 * start once, and remembers), or when the file cannot be read. Never throws: a cursor that
 * cannot be read starts fresh, and never stops a turn.
 */
export function readStopState(stateDir: string, repo: string, id: string): StopState | null {
  try {
    const raw = readFileSync(stopStateFile(stateDir, repo, id), "utf8");
    const parsed = stopStateFields.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // No cursor yet, or one that cannot be read: the Stop reads the log from its start once.
  }
  return null;
}

/** Writes the crew session's Stop cursor. */
export function writeStopState(stateDir: string, repo: string, id: string, state: StopState): void {
  writeStoreFile(stopStateFile(stateDir, repo, id), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Where a crew session's own watch keeps what it last said: `<store>/self/<crew id>.json`. One file
 * per crew session, so two crew sessions never speak for each other.
 */
export function selfWatchStateFile(stateDir: string, repo: string, id: string): string {
  return join(crewStoreDir(stateDir, repo), "self", `${fileId(id, "crew id")}.json`);
}

/**
 * What a crew session's own watch last said to it, and when: the advice's kind and the time it was
 * given, so the same advice is not repeated before its time is up.
 */
export interface SelfWatchState {
  /** The advice's kind (`context`, `long`, `time`). */
  kind: string;
  /** When it was said, in ms. */
  at: number;
}

const selfWatchStateFields = z.object({ at: z.number().int().min(0), kind: text });

/** What the crew session's own watch last said; null when it never said anything. */
export function readSelfWatchState(
  stateDir: string,
  repo: string,
  id: string,
): SelfWatchState | null {
  try {
    const raw = readFileSync(selfWatchStateFile(stateDir, repo, id), "utf8");
    const parsed = selfWatchStateFields.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Never said anything, or the file cannot be read: the crew session says it now.
    return null;
  }
}

/** Writes what the crew session's own watch said. */
export function writeSelfWatchState(
  stateDir: string,
  repo: string,
  id: string,
  state: SelfWatchState,
): void {
  writeStoreFile(selfWatchStateFile(stateDir, repo, id), `${JSON.stringify(state, null, 2)}\n`);
}
