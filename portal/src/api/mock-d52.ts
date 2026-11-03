import { rangeOf } from "@/lib/history";
import { seeded } from "./mock-history";
import { mockSessionName } from "./mock-names";
import type {
  GuardAsk,
  GuardAsksPage,
  GuardQuery,
  HeldMajor,
  JobsData,
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
  if (empty) return { items: [], note: null };
  return {
    note: null,
    items: [
      {
        kind: "permission",
        id: "p-a1f04c2e",
        since: iso(now - 4 * MINUTE),
        asker: "git-guard",
        session: "a1f04c2e-session",
        project: "my-app",
        tool: "Bash",
        detail: "git push origin feature/b6b-live-stream: the git guard asks before a push",
      },
      {
        kind: "permission",
        id: "p-own-session",
        since: iso(now - 14 * MINUTE),
        asker: "claude",
        session: "5c0e7d21-90ab-4cde-8f12-3456789abcde",
        project: "docs-site",
        // One of the person's own sessions: it runs in a terminal, so there is nothing to attach.
        tool: "Write",
        detail: "a write outside the project",
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
            {
              kind: "breaker" as const,
              id: "b-scout",
              since: iso(now - 50 * MINUTE),
              slot: "cc-smart-dev-kit-scout",
              breaker: {
                held: 12,
                // The router did not answer: how many wait right now is not known.
                heldNow: null,
                since: now - 50 * MINUTE,
                targets: [
                  { status: 503, target: "omniroute:qwen-4-coder", until: now + 4 * MINUTE },
                ],
              },
              command: "cc-smart-dev-kit gateway slot scout claude",
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
        kind: "doctor",
        id: "d-browser-token",
        since: iso(now - 2 * HOUR),
        section: "browser",
        text: "The browser extension's token is not set",
        fix: null,
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
    kept: matching.length,
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
  if (empty) return { rows: [], autoClean: null };
  const wt = (name: string) => `/home/user/code/my-app/.claude/worktrees/${name}`;
  return {
    rows: [
      {
        project: "my-app",
        path: wt("b6b-live-stream"),
        branch: "feature/b6b-live-stream",
        idleMinutes: 3,
        verdict: {
          finished: false,
          held: true,
          why: `a Claude session works in it: ${mockSessionName("B6b", "live-stream")}`,
        },
      },
      {
        project: "my-app",
        path: wt("b6c-slots-page"),
        branch: "feature/b6c-slots-page",
        idleMinutes: 18,
        verdict: { finished: false, held: true, why: "touched 18 minutes ago (under 60)" },
      },
      {
        project: "my-app",
        path: wt("c2-skills-agents"),
        branch: "feature/c2-skills-agents",
        idleMinutes: 9,
        verdict: { finished: false, held: false, why: "3 commits are not on release-1.1.0" },
      },
      {
        project: "my-app",
        path: wt("a4b-hook-frame"),
        branch: "feature/a4b-hook-frame",
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
    autoClean: {
      lastRunAt: iso(now - 3 * HOUR),
      base: "release-1.1.0",
      removed: [
        {
          name: "wt-finished-cleanup",
          path: wt("wt-finished-cleanup"),
          branch: "feature/wt-finished-cleanup",
          why: "its pull request is merged (squash)",
        },
        {
          name: "br2-breaker-alert",
          path: wt("br2-breaker-alert"),
          branch: "feature/br2-breaker-alert",
          why: "its branch is merged into release-1.1.0",
        },
        {
          name: "detached-spike",
          path: wt("detached-spike"),
          branch: null,
          why: "its commit is on release-1.1.0",
        },
      ],
    },
  };
}

/** The heavy-job queue: the machine's one slot held by a type check, three jobs waiting; nothing at all when empty. */
export function jobsData(now: number, empty: boolean): JobsData {
  const folder = "/home/user/code/my-app/.claude/worktrees/b6b-live-stream";
  return {
    route: { on: !empty, project: null, source: empty ? "default" : "personal" },
    stores: [
      {
        where: "machine",
        slots: 1,
        used: empty ? 0 : 1,
        held: empty
          ? []
          : [
              {
                kind: "typecheck",
                command: "tsc --noEmit",
                folder,
                user: mockSessionName("B6b", "live-stream"),
                since: now - 2 * MINUTE - 10_000,
                pid: 48211,
                slot: true,
              },
            ],
        waiting: empty
          ? []
          : [
              {
                kind: "build",
                command: "next build",
                folder,
                user: mockSessionName("B6b", "live-stream"),
                since: now - MINUTE,
                pid: 48302,
                slot: true,
              },
              {
                kind: "test",
                command: "bun test src/jobs",
                folder: "/home/user/code/my-app/.claude/worktrees/d1-docs",
                user: mockSessionName("D1", "docs"),
                since: now - 30_000,
                pid: 48350,
                slot: true,
              },
              {
                kind: "test",
                command: "bun test",
                folder: "/home/user/code/my-app/.claude/worktrees/c2-skills-agents",
                user: mockSessionName("C2", "skills-agents"),
                since: now - 20_000,
                pid: 48390,
                slot: true,
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
