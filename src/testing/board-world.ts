/**
 * A world for the board and the end of a crew session (`crew list`, `status`, `stop`, `rm`,
 * `resume`): `crewWorld` (a real git repo, a temp state folder, a process tree) with a fake
 * `claude` that answers the commands those use, and a way to make a crew session — its record, and
 * a real branch and worktree. No test starts a real Claude session.
 *
 * The fake's answers are chosen per test through its environment (`world.ctx({}, { … })`):
 *   FAKE_AGENTS_JSON  what `claude agents --json --all` prints; unset: `[]`.
 *   FAKE_STOP         `fail` (exit 1, "could not stop"), `gone` (exit 1, "no such session").
 *   FAKE_RM           `fail` (exit 1, "could not delete").
 *   FAKE_WORKTREE     a folder: `claude rm` refuses while it exists, in Claude Code's own words
 *                     (proved live, L1a.1: it refuses a worktree that is still there).
 *   FAKE_BG           `fail` (exit 4, "something broke"): a resume claude refuses; `noline`: one
 *                     that prints no `backgrounded` line.
 *   FAKE_RESUME, FAKE_COPY_AS  how `--bg --resume` answers (`FAKE_RESUME_SH`, `crew-world.ts`).
 */
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crewBranch, worktreeName } from "../crew/start";
import {
  type CrewRecord,
  createCrew,
  crewMcpFile,
  crewSettingsFile,
  writeLead,
  writeStoreFile,
} from "../crew/store";
import type { CrewKind } from "../models/launch-policy";
import { type CrewWorld, crewWorld, FAKE_RESUME_SH, LEAD_SESSION, SHORT_ID } from "./crew-world";
import { git } from "./temp";

/** The moment every command of the world sees as now. */
export const NOW = Date.parse("2026-10-21T10:00:00.000Z");

/** The name of the lead every crew session of the world has. */
export const LEAD_NAME = "LEAD my-app master-plan";

/** No Docker container, no program and no session: the machine a worktree is judged on. */
export const QUIET_MACHINE = { containers: [], programs: [], sessions: [] };

/** One minute, in milliseconds. */
export const MINUTE = 60_000;

const FAKE_CLAUDE = `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a" >> "$FAKE_CLAUDE_LOG"; done
printf -- '----\\n' >> "$FAKE_CLAUDE_LOG"
printf '%s\\n' "$(pwd -P)" >> "$FAKE_CLAUDE_CWD_LOG"
case "$1" in
  --bg)
    if [ "$FAKE_BG" = fail ]; then echo "something broke" >&2; exit 4; fi
    if [ "$FAKE_BG" = noline ]; then echo "started something"; exit 0; fi
${FAKE_RESUME_SH}    ;;
  agents)
    if [ -z "$FAKE_AGENTS_JSON" ]; then echo "[]"; else printf '%s\\n' "$FAKE_AGENTS_JSON"; fi ;;
  stop)
    case "$FAKE_STOP" in
      fail) echo "could not stop" >&2; exit 1 ;;
      gone) echo "no such session" >&2; exit 1 ;;
    esac ;;
  rm)
    if [ "$FAKE_RM" = fail ]; then echo "could not delete" >&2; exit 1; fi
    if [ -n "$FAKE_WORKTREE" ] && [ -e "$FAKE_WORKTREE" ]; then
      echo "exit that session, or run 'git worktree unlock' on the worktree, then run 'claude rm' again" >&2
      exit 1
    fi ;;
esac
exit 0
`;

/** What `addCrew` may change from the plain crew session B1 "help", working, in its own worktree. */
export interface AddCrew {
  /** When it was recorded, in milliseconds. Default: 12 minutes before `NOW`. */
  atMs?: number;
  /** The branch it was cut from; default "main". */
  baseRef?: string;
  /** The base commit; default the branch's HEAD when a worktree is made. */
  base?: null | { ref: string; sha: string };
  effort?: string;
  files?: string[];
  kind?: CrewKind;
  lastLine?: null | string;
  /** The pause the record carries (D42), and its last pause before it. */
  lastPause?: CrewRecord["lastPause"];
  leadSessionId?: string;
  memoryMb?: null | number;
  model?: CrewRecord["model"];
  name?: string;
  phase?: string;
  /** The repository the record is for, with no branch or worktree on disk. Default: the world's. */
  repo?: string;
  /** Its session's short id; null: it has no session. Default: the fake `claude`'s. */
  shortId?: null | string;
  slug?: string;
  state?: string;
  /** The end of its id (`<phase>-<slug>-<suffix>`). Default `1a2b3c`. */
  suffix?: string;
  waitingFor?: CrewRecord["waitingFor"];
  waitsFor?: string[];
  /** False: no branch and no worktree on disk (a queued crew session has none). Default true. */
  worktree?: boolean;
}

export interface BoardWorld extends CrewWorld {
  /** Records a crew session of the world's repository, with a real branch and worktree unless told not. */
  addCrew: (change?: AddCrew) => Promise<CrewRecord>;
  /** The first word of each `claude` call so far, in order: `["stop", "rm"]`. */
  claudeVerbs: () => string[];
}

/** The world: the repo on `main`, crew sessions on, a lead recorded, and the fake `claude`. */
export async function boardWorld(): Promise<BoardWorld> {
  const world = crewWorld();
  writeFileSync(join(world.bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(world.bin, "claude"), 0o755);
  await writeLead(
    world.paths.stateDir,
    {
      cwd: world.repo,
      name: LEAD_NAME,
      plan: "master-plan",
      repo: world.repo,
      sessionId: LEAD_SESSION,
      tag: "my-app",
    },
    NOW,
  );
  const addCrew = async (change: AddCrew = {}): Promise<CrewRecord> => {
    const phase = change.phase ?? "B1";
    const slug = change.slug ?? "help";
    const repo = change.repo ?? world.repo;
    const branch = crewBranch(phase, slug);
    const worktree = join(repo, ".claude", "worktrees", worktreeName(phase, slug));
    const made = change.worktree !== false && change.repo === undefined;
    if (made) git(world.repo, "worktree", "add", "-b", branch, worktree, "HEAD");
    const sha = git(world.repo, "rev-parse", "HEAD").trim();
    const shortId = change.shortId === undefined ? SHORT_ID : change.shortId;
    const id = `${phase}-${slug}-${change.suffix ?? "1a2b3c"}`;
    // A started crew session has its own settings and MCP files (`crew start` writes them), and a
    // resume reads them: without a session there are none.
    if (shortId !== null) {
      writeStoreFile(crewSettingsFile(world.paths.stateDir, repo, id), "{}\n");
      writeStoreFile(crewMcpFile(world.paths.stateDir, repo, id), '{"mcpServers":{}}\n');
    }
    return await createCrew(
      world.paths.stateDir,
      {
        base: change.base ?? (made ? { ref: "main", sha } : null),
        baseRef: change.baseRef ?? "main",
        branch,
        effort: change.effort ?? "high",
        files: change.files ?? [],
        id,
        kind: change.kind ?? "build",
        lastLine: change.lastLine ?? null,
        leadName: LEAD_NAME,
        leadSessionId: change.leadSessionId ?? LEAD_SESSION,
        memoryMb: change.memoryMb ?? null,
        model: change.model ?? { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
        name: change.name ?? `C my-app ${phase} ${slug}`,
        permissionMode: "auto",
        phase,
        plan: "master-plan",
        pr: null,
        questions: [],
        repo,
        reportPath: null,
        sessionId: shortId === null ? null : `${shortId}-0000-1111-2222-333333333333`,
        shortId,
        slug,
        state: change.state ?? "working",
        waitsFor: change.waitsFor ?? [],
        worktree,
        ...(change.waitingFor === undefined ? {} : { waitingFor: change.waitingFor }),
        ...(change.lastPause === undefined ? {} : { lastPause: change.lastPause }),
      },
      change.atMs ?? NOW - 12 * MINUTE,
    );
  };
  return {
    ...world,
    addCrew,
    claudeVerbs: () => world.claudeCalls().map((call) => call[0] ?? ""),
    ctx: (change, env) => world.ctx({ scanFacts: QUIET_MACHINE, ...change }, env),
  };
}
