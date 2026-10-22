/**
 * Mock data for the D52 pages: Needs you, a crew session's page, the guard log, worktrees and
 * updates. Real shapes (`./types.ts`), placeholder names, seeded numbers.
 */

import { rangeOf } from "@/lib/history";
import { seeded } from "./mock-history";
import type {
  CrewDetail,
  CrewEvent,
  CrewRecord,
  GuardAsk,
  GuardAsksPage,
  GuardQuery,
  HeldMajor,
  JobsData,
  LeadRecord,
  NeedsData,
  OpenBreaker,
  UpdateData,
  WorktreesData,
} from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const iso = (ms: number) => new Date(ms).toISOString();

export function heldMajor(now: number): HeldMajor {
  return {
    version: "2.0.0",
    from: "1.1.0",
    at: iso(now - 26 * HOUR),
    notes: [
      "The gateway reads one config per project: a project without one keeps the machine's.",
      "`workflow.json` moves into the project's own file; `migrate` moves it for you.",
    ],
  };
}

export function needsData(
  now: number,
  empty: boolean,
  breaker: OpenBreaker | undefined,
): NeedsData {
  if (empty) return { items: [] };
  return {
    items: [
      {
        kind: "question",
        id: "q-d9e2f7a4-1",
        since: iso(now - 9 * MINUTE),
        crew: { id: "d9e2f7a4", name: "C my-app C2 skills-agents", shortId: "d9e2f7a4" },
        ask: {
          question:
            "The reviewer agent lists Bash, so Claude Code drops Grep and Glob from it. Keep Grep, or Bash only?",
          options: [
            "Keep Grep and Glob; drop Bash",
            "Bash only; search through rg",
            "Both: a second agent for searching",
          ],
          recommended: 1,
          askedAt: iso(now - 9 * MINUTE),
          answeredAt: null,
          answer: null,
        },
      },
      {
        kind: "permission",
        id: "p-a1f04c2e",
        since: iso(now - 4 * MINUTE),
        crew: { id: "a1f04c2e", name: "C my-app B6b live-stream", shortId: "a1f04c2e" },
        asker: "git-guard",
        session: "a1f04c2e-session",
        project: "my-app",
        tool: "Bash",
        detail: "git push origin crew/b6b-live-stream: the git guard asks before a push",
      },
      ...(breaker === undefined
        ? []
        : [
            {
              kind: "breaker" as const,
              id: "b-fable",
              since: iso(breaker.since),
              slot: "cc-smart-dev-kit-fable",
              breaker,
              command: "cc-smart-dev-kit gateway slot fable claude",
            },
          ]),
      {
        kind: "doctor",
        id: "d-mcp-tavily",
        since: iso(now - 2 * HOUR),
        section: "mcp",
        text: "tavily-websearch is not registered",
        fix: "cc-smart-dev-kit setup",
      },
      {
        kind: "update",
        id: "u-2.0.0",
        since: iso(now - 26 * HOUR),
        held: heldMajor(now),
        installed: "1.1.0",
      },
    ],
  };
}

const BRIEF = `# B6b: the live stream

**Kind:** security. **Waits for:** B6a, B7. **Owns:** \`src/portal/live/\`, \`src/portal/server.ts\`.

## What to build

1. \`GET /events\` (Server-Sent Events) through the same door as every route: \`Host\`,
   \`Origin\`, \`Sec-Fetch-Site\`.
2. A hub that sends each region's new value once, with pings and \`Last-Event-ID\`.
3. At most **8** streams; the leader tab shares one with the others.

## Done when

- [x] The door's tests pass on \`/events\`
- [ ] The idle clock is not touched by the stream
- [ ] Keys are never in the first snapshot

> Never put a backend key on the stream: every value goes through \`maskKey\`.

See [the design](https://example.com/design) for the region list.
`;

export function crewDetail(
  now: number,
  record: CrewRecord,
  lead: LeadRecord,
  memory: { at: number; mb: number }[],
): CrewDetail {
  const step = (
    minutes: number,
    type: CrewEvent["type"],
    text: string,
    state: CrewEvent["state"],
    note?: string,
  ): CrewEvent => ({
    at: iso(now - minutes * MINUTE),
    type,
    crew: record.id,
    name: record.name,
    lead: lead.sessionId,
    state,
    text,
    ...(note === undefined ? {} : { note }),
  });
  const merged = record.state === "merged";
  return {
    record,
    lead,
    brief: BRIEF,
    events: [
      step(45, "created", "Recorded by the lead", "queued"),
      step(40, "state", "Started on deepseek-v4.1-flash", "starting"),
      step(
        36,
        "step",
        "Read the door and the server",
        "working",
        "guard.ts and server.ts read; the route list is in one table.",
      ),
      step(
        24,
        "step",
        "The hub and its regions",
        "working",
        "src/portal/live/hub.ts: one value per region, sent once.",
      ),
      step(
        11,
        "step",
        "GET /events behind the door",
        "working",
        "The door's own checks run first; tests for a foreign Origin and a missing Sec-Fetch-Site.",
      ),
      step(3, "step", "Leader tab: Web Locks and BroadcastChannel", "working"),
    ],
    questions: [],
    report: merged
      ? null
      : {
          status: "done",
          phase: record.phase,
          branch: { name: record.branch, sha: "4f2a9c1" },
          base: { ref: record.baseRef, sha: "a729513" },
          pr: 44,
          changed: { files: 9, insertions: 612, deletions: 88 },
          outsideBrief: ["docs/design.md"],
          tests: {
            targeted: [{ command: "bun test src/portal/live", passed: 31, failed: 0, ok: true }],
            full: { command: "bun test", passed: 2140, failed: 0, ok: true },
          },
          checks: [
            { name: "typecheck", ok: true, note: null },
            { name: "lint", ok: true, note: null },
            { name: "check:neutral", ok: true, note: null },
          ],
          review: {
            agent: "reviewer",
            model: "claude-opus-5-5",
            effort: "xhigh",
            sha: "4f2a9c1",
            findings: [
              {
                finding: "A stream left open past the cap is not closed",
                fix: "The ninth stream gets 503 and closes",
              },
              {
                finding: "Last-Event-ID is trusted as a number",
                fix: "Parsed and range-checked; anything else starts over",
              },
            ],
          },
          docs: ["docs/design.md"],
          needsLead: [],
          open: ["The idle clock test is still to write"],
          question: null,
        },
    diffTotals: { deletions: 38, error: null, files: 6, insertions: 412 },
    diff: [
      { path: "src/portal/live/hub.ts", added: 214, removed: 0 },
      { path: "src/portal/live/hub.test.ts", added: 188, removed: 0 },
      { path: "src/portal/live/sources.ts", added: 96, removed: 0 },
      { path: "src/portal/server.ts", added: 61, removed: 44 },
      { path: "src/portal/guard.ts", added: 12, removed: 9 },
      { path: "docs/design.md", added: 41, removed: 35 },
    ],
    mergeCheck: {
      allowed: false,
      reason:
        "The change after the review is 74 lines in 2 files: more than the limit of 50 lines or 10 % of the reviewed change (612 lines). Review it again.",
      review: "4f2a9c1",
      delta: { lines: 74, files: 2, generated: [], binary: [] },
      reviewed: { lines: 612, files: 9, generated: [], binary: [] },
      limits: { lines: 50, files: 5, percent: 10 },
    },
    memory,
  };
}

const GUARDS = ["git-guard", "agent-guard", "merge-guard", "escape-guard", "auto-mode"];
const REASONS: Record<string, string[]> = {
  "git-guard": [
    "Push to a protected branch: release-1.1.0",
    "git push --force asked",
    "git reset --hard in the main checkout",
  ],
  "agent-guard": [
    "An opus agent at max effort: the person's yes",
    "A fable agent with no reason word",
  ],
  "merge-guard": ["The change after the review is over the limit", "No review covers the head"],
  "escape-guard": [
    "A write outside the worktree: ../my-app/.env",
    "A settings file of Claude Code's own",
  ],
  "auto-mode": ["Refused: curl … | sh", "Refused: rm -rf on a folder outside the project"],
};

export function guardAsks(
  now: number,
  query: GuardQuery,
  empty: boolean,
  sessions: string[],
): GuardAsksPage {
  const { spanMs, bucketMs } = rangeOf(query.range);
  const random = seeded(77);
  const all: GuardAsk[] = [];
  if (!empty) {
    let at = now - 90_000;
    while (at > now - spanMs) {
      at -= Math.round(40 * MINUTE * (0.1 + random() * 1.8));
      const hook = GUARDS[Math.floor(random() * random() * GUARDS.length)] ?? "git-guard";
      const reasons = REASONS[hook] ?? [""];
      all.push({
        at,
        hook,
        session: sessions[Math.floor(random() * sessions.length)] ?? "",
        tool: hook === "agent-guard" ? "Agent" : hook === "escape-guard" ? "Write" : "Bash",
        reason: reasons[Math.floor(random() * reasons.length)] ?? "",
      });
    }
  }
  const matching = all.filter(
    (ask) =>
      (query.guard === undefined || ask.hook === query.guard) &&
      (query.session === undefined || ask.session === query.session),
  );
  const start = query.cursor === null ? 0 : Number(query.cursor);
  const PAGE = 12;
  const first = Math.floor((now - spanMs) / bucketMs) * bucketMs;
  const series = new Map<string, Map<number, number>>();
  for (const ask of matching) {
    const t = first + Math.floor((ask.at - first) / bucketMs) * bucketMs;
    const points = series.get(ask.hook) ?? new Map<number, number>();
    points.set(t, (points.get(t) ?? 0) + 1);
    series.set(ask.hook, points);
  }
  const buckets: number[] = [];
  for (let t = first; t <= now; t += bucketMs) buckets.push(t);
  return {
    rows: matching.slice(start, start + PAGE),
    next: start + PAGE < matching.length ? String(start + PAGE) : null,
    guards: [...new Set(all.map((ask) => ask.hook))].sort(),
    sessions: [...new Set(all.map((ask) => ask.session))].sort(),
    buckets: {
      bucketMs,
      series: [...series.entries()].map(([key, points]) => ({
        key,
        points: buckets.map((t) => ({ t, count: points.get(t) ?? 0 })),
      })),
    },
  };
}

export function worktreesData(now: number, empty: boolean): WorktreesData {
  if (empty) return { rows: [], cleaned: [] };
  const wt = (name: string) => `/home/user/code/my-app/.claude/worktrees/${name}`;
  return {
    rows: [
      {
        project: "my-app",
        path: wt("b6b-live-stream"),
        branch: "crew/b6b-live-stream",
        idleMinutes: 3,
        verdict: {
          finished: false,
          held: true,
          why: "a Claude session works in it: C my-app B6b live-stream",
        },
      },
      {
        project: "my-app",
        path: wt("b6c-slots-page"),
        branch: "crew/b6c-slots-page",
        idleMinutes: 18,
        verdict: { finished: false, held: true, why: "touched 18 minutes ago (under 60)" },
      },
      {
        project: "my-app",
        path: wt("c2-skills-agents"),
        branch: "crew/c2-skills-agents",
        idleMinutes: 9,
        verdict: { finished: false, held: false, why: "3 commits are not on release-1.1.0" },
      },
      {
        project: "my-app",
        path: wt("a4b-hook-frame"),
        branch: "crew/a4b-hook-frame",
        idleMinutes: 340,
        verdict: { finished: true, note: "its pull request is merged (squash)" },
      },
      {
        project: "my-app",
        path: wt("old-spike"),
        branch: null,
        idleMinutes: 9_000,
        verdict: {
          finished: false,
          held: false,
          why: "it holds files git ignores that cannot be rebuilt: .env.local",
        },
      },
      {
        project: "docs-site",
        path: "/home/user/code/docs-site/.claude/worktrees/fix-nav",
        branch: "fix/nav-links",
        idleMinutes: 6,
        verdict: { finished: false, held: true, why: "uncommitted changes" },
      },
    ],
    cleaned: [
      {
        project: "my-app",
        path: wt("wt-finished-cleanup"),
        branch: "crew/wt-finished-cleanup",
        at: iso(now - 3 * HOUR),
      },
      {
        project: "my-app",
        path: wt("br2-breaker-alert"),
        branch: "crew/br2-breaker-alert",
        at: iso(now - 7 * HOUR),
      },
      {
        project: "docs-site",
        path: "/home/user/code/docs-site/.claude/worktrees/typo",
        branch: "fix/typo",
        at: iso(now - 30 * HOUR),
      },
    ],
  };
}

/** The heavy-job queue: one held type check, one waiting test run; nothing at all when empty. */
export function jobsData(now: number, empty: boolean): JobsData {
  const folder = "/home/user/code/my-app/.claude/worktrees/b6b-live-stream";
  return {
    memoryGb: 32,
    freeGb: empty ? 21.4 : 13.1,
    budgetGb: 24,
    keptGb: 8,
    stores: [
      {
        where: "machine",
        freeGb: empty ? 21.4 : 13.1,
        budgetGb: 24,
        held: empty
          ? []
          : [
              {
                gb: 8,
                kind: "typecheck",
                command: "tsc --noEmit",
                folder,
                user: "C my-app B6b live-stream",
                since: now - 2 * MINUTE - 10_000,
                pid: 48211,
              },
            ],
        waiting: empty
          ? []
          : [
              {
                gb: 18,
                kind: "test",
                command: "bun test",
                folder: "/home/user/code/my-app/.claude/worktrees/c2-skills-agents",
                user: "C my-app C2 skills-agents",
                since: now - 40_000,
                pid: 48390,
              },
            ],
      },
    ],
  };
}

export function updateData(now: number): UpdateData {
  return {
    installed: "1.1.0",
    newest: "2.0.0",
    held: heldMajor(now),
    hold: false,
    lastCheck: {
      at: iso(now - 40 * MINUTE),
      result: "held",
      detail: "2.0.0 is a major version: it waits for your yes",
    },
  };
}
