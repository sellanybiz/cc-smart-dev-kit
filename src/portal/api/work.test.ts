/**
 * The pure part of "Needs you": a flow wait, matched to the crew session that runs it.
 *
 * Every value is written by hand; the record comes from the store's own schema, so a field the
 * schema would refuse cannot slip in. No files are read and no portal is started.
 */
import { describe, expect, test } from "bun:test";
import { type CrewRecord, crewRecordSchema } from "../../crew/store";
import type { OpenWait } from "../../sessions/flow";
import { permissionWaitOf } from "./work";

/** One crew record, through the store's own schema. */
function crewRecord(id: string, sessionId: null | string, shortId: null | string): CrewRecord {
  return crewRecordSchema.parse({
    base: null,
    baseRef: "main",
    branch: "crew/F-guards",
    createdAt: "2026-10-23T10:00:00.000Z",
    effort: "high",
    files: [],
    id,
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: "11111111-1111-4111-8111-111111111111",
    memoryMb: null,
    model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
    name: `C my-app F guards`,
    permissionMode: "auto",
    phase: "F",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    questions: [],
    reportPath: null,
    repo: "/home/user/my-app",
    sessionId,
    shortId,
    slug: "guards",
    state: "working",
    updatedAt: "2026-10-23T10:00:00.000Z",
    version: 1,
    waitsFor: [],
    worktree: "/home/user/my-app/.claude/worktrees/crew-F-guards",
  });
}

/** One permission prompt the flow report found, in a session `session`. */
function waitIn(session: string): OpenWait {
  return {
    asker: "git-guard",
    at: Date.UTC(2026, 9, 23, 12, 0, 0),
    cwd: "/home/user/my-app",
    kind: "merge-guard",
    project: "my-app",
    session,
    tool: "Bash",
  };
}

describe("permissionWaitOf", () => {
  test("a wait in a crew session's own session names it, and the command that opens it", () => {
    const record = crewRecord("crew-F-guards", "abcd1234-0000-4000-8000-000000000000", "abcd1234");
    expect(permissionWaitOf(waitIn("abcd1234-0000-4000-8000-000000000000"), [record])).toEqual({
      asker: "git-guard",
      attach: "claude attach abcd1234",
      at: Date.UTC(2026, 9, 23, 12, 0, 0),
      crew: { id: "crew-F-guards", name: "C my-app F guards", shortId: "abcd1234" },
      kind: "merge-guard",
      project: "my-app",
      session: "abcd1234-0000-4000-8000-000000000000",
      tool: "Bash",
    });
  });

  test("any other session has no crew and no attach command", () => {
    const record = crewRecord("crew-F-guards", "abcd1234-0000-4000-8000-000000000000", "abcd1234");
    expect(permissionWaitOf(waitIn("eeee5555-0000-4000-8000-000000000000"), [record])).toEqual({
      asker: "git-guard",
      attach: null,
      at: Date.UTC(2026, 9, 23, 12, 0, 0),
      crew: null,
      kind: "merge-guard",
      project: "my-app",
      session: "eeee5555-0000-4000-8000-000000000000",
      tool: "Bash",
    });
  });

  test("a crew session with no short id is named, but has no command to offer", () => {
    const record = crewRecord("crew-F-guards", "abcd1234-0000-4000-8000-000000000000", null);
    const wait = permissionWaitOf(waitIn("abcd1234-0000-4000-8000-000000000000"), [record]);
    expect(wait.crew).toEqual({ id: "crew-F-guards", name: "C my-app F guards", shortId: null });
    expect(wait.attach).toBe(null);
  });
});
