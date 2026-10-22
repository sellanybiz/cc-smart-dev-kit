/**
 * `src/sessions/flow.ts`: hand-written fixture transcripts in a temp folder, shaped like the
 * records Claude Code 2.1.30x writes (the fields are undocumented; the contract rows are marked
 * "seen"). Every expected value is written by hand. The fixtures carry message text the report
 * must never show.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import type { FlowPaths } from "./flow";
import {
  CACHE_KEEP_DAYS,
  FLOW_DAYS_KEPT,
  flowCacheFolder,
  hookNameFromCommand,
  maxOverlap,
  OPEN_WAIT_MAX_AGE_MS,
  openWaits,
  readAskLog,
  readFlow,
} from "./flow";

const NOW = Date.UTC(2026, 9, 21, 18, 0, 0);
const PROJECT = "-home-user-my-app";
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const CWD = "/home/user/my-app";
const SECRET = "the private launch plan";
const SINCE = NOW - 7 * 24 * 3_600_000;

/** A moment on the fixture day (UTC), in ms. */
function at(hour: number, minute = 0, second = 0): number {
  return Date.UTC(2026, 9, 21, hour, minute, second);
}

function stamp(ms: number): string {
  return new Date(ms).toISOString();
}

/** One assistant content-block line; `message.id` groups the lines of one reply. */
function assistant(
  id: string,
  ts: number,
  content: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    cwd: CWD,
    message: { content, id, role: "assistant" },
    timestamp: stamp(ts),
    type: "assistant",
    ...extra,
  });
}

function text(): Record<string, unknown> {
  return { text: SECRET, type: "text" };
}

function toolUse(
  toolId: string,
  name: string,
  input: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: toolId, input, name, type: "tool_use" };
}

/** A line launching agents: `count` `Agent` calls in one reply. */
function launches(id: string, ts: number, count: number): string {
  return assistant(
    id,
    ts,
    Array.from({ length: count }, (_, index) => toolUse(`${id}-t${index}`, "Agent", {})),
  );
}

/** A user line holding one tool result, with the person's decision (or none). */
function result(
  toolId: string,
  ts: number,
  decision: null | { decision: string; reasonType?: string; source: string },
  content: Record<string, unknown>[] | string = "tool output",
): string {
  return JSON.stringify({
    message: {
      content: [
        {
          content,
          tool_use_id: toolId,
          type: "tool_result",
        },
      ],
      role: "user",
    },
    permissionDecision: decision ?? undefined,
    timestamp: stamp(ts),
    type: "user",
  });
}

/** A prompt: the person wrote (or a notification woke the session). */
function prompt(ts: number, origin: string): string {
  return JSON.stringify({
    message: { content: [{ text: SECRET, type: "text" }], role: "user" },
    timestamp: stamp(ts),
    turnOrigin: origin,
    type: "user",
  });
}

function turnDuration(ts: number, durationMs: number, pending: null | number): string {
  return JSON.stringify({
    durationMs,
    pendingBackgroundAgentCount: pending ?? undefined,
    subtype: "turn_duration",
    timestamp: stamp(ts),
    type: "system",
  });
}

function compact(ts: number, trigger: string, preTokens: number, postTokens: number): string {
  return JSON.stringify({
    compactMetadata: { postTokens, preTokens, trigger },
    subtype: "compact_boundary",
    timestamp: stamp(ts),
    type: "system",
  });
}

/** A hook's ask: the PreToolUse answer with `ask`, as Claude Code records it beside the call. */
function ask(toolId: string, ts: number, command: string): string {
  return JSON.stringify({
    attachment: {
      command,
      hookEvent: "PreToolUse",
      hookName: "PreToolUse:Bash",
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" },
      }),
      toolUseID: toolId,
      type: "hook_success",
    },
    timestamp: stamp(ts),
    type: "attachment",
  });
}

/** A temp world: `<dir>/projects/<project>/<session>.jsonl` and an empty state folder. */
function world(lines: string[] = []): { folder: string; paths: FlowPaths; sessionFile: string } {
  const root = tempDir("flow");
  const paths: FlowPaths = {
    claudeConfigDir: join(root, "claude"),
    home: "/home/user",
    stateDir: join(root, "claude", "cc-smart-dev-kit"),
  };
  const folder = join(paths.claudeConfigDir, "projects", PROJECT);
  mkdirSync(folder, { recursive: true });
  const sessionFile = join(folder, `${SESSION}.jsonl`);
  writeFileSync(sessionFile, lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  return { folder, paths, sessionFile };
}

/** Writes a subagent transcript (and its folder) with the records given. */
function subagent(folder: string, name: string, lines: string[], session = SESSION): string {
  const dir = join(folder, session, "subagents");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

describe("agents and the parallel ratio", () => {
  it("counts launches per reply, the replies with two or more, and the share", () => {
    const { paths } = world([
      assistant("r1", at(9), [text()]),
      assistant("r1", at(9), [toolUse("a1", "Agent")]),
      // Two launches in one reply: parallel.
      launches("r2", at(10), 2),
      // A `Task` launch is a launch too, in a reply with one.
      assistant("r3", at(11), [toolUse("c1", "Task")]),
      assistant("r4", at(12), [text()]),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0]?.agents).toEqual({
      launches: 4,
      launchesParallel: 2,
      mostAtOnce: 0,
      parallelRatio: 0.5,
      replies: 4,
      repliesParallel: 1,
    });
  });

  it("a subagent transcript never wipes what the session's own transcript counted", () => {
    const { folder, paths } = world([
      launches("r1", at(10), 2),
      turnDuration(at(10, 5), 60_000, null),
      prompt(at(10, 10), "human"),
    ]);
    subagent(folder, "agent-a.jsonl", [prompt(at(10, 1), "human"), launches("s1", at(10, 2), 1)]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    // Both transcripts count: two launches in the session's own reply, one in the subagent's.
    expect(report.sessions[0]?.agents.launches).toBe(3);
    expect(report.sessions[0]?.activeMs).toBe(60_000);
  });

  it("most at once is the overlap of the subagent transcripts' first and last timestamps", () => {
    const { folder, paths } = world([assistant("r1", at(9), [text()])]);
    // Three overlap at 10:20; the fourth only touches the first at 10:30.
    subagent(folder, "agent-a.jsonl", [
      prompt(at(10, 0), "human"),
      assistant("s1", at(10, 30), [text()]),
    ]);
    subagent(folder, "agent-b.jsonl", [
      prompt(at(10, 10), "human"),
      assistant("s2", at(10, 20), [text()]),
    ]);
    subagent(folder, "agent-c.jsonl", [
      prompt(at(10, 15), "human"),
      assistant("s3", at(10, 40), [text()]),
    ]);
    subagent(folder, "agent-d.jsonl", [
      prompt(at(10, 30), "human"),
      assistant("s4", at(10, 45), [text()]),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions[0]?.agents.mostAtOnce).toBe(3);
    // The same rule, on its own: touching spans do not overlap.
    expect(
      maxOverlap([
        { end: 10, start: 0 },
        { end: 20, start: 10 },
      ]),
    ).toBe(1);
    expect(maxOverlap([])).toBe(0);
  });
});

describe("blocked on permission prompts", () => {
  it("times the wait from the tool's line to the person's answer, and names the asker", () => {
    const { paths } = world([
      assistant("r1", at(10, 0), [toolUse("t1", "Bash", { command: "bun test" })]),
      ask("t1", at(10, 0, 1), '"/home/user/.claude/plugins/x/dist/merge-guard.js"'),
      result("t1", at(10, 5), { decision: "accept", source: "user_temporary" }),
      assistant("r2", at(11, 0), [toolUse("t2", "Read", {})]),
      result("t2", at(11, 2), { decision: "accept", source: "user_permanent" }),
      // The person refused: still a prompt, still a wait.
      assistant("r3", at(11, 59), [toolUse("t3", "Bash", { command: "git push" })]),
      ask("t3", at(11, 59, 1), '"/home/user/.claude/plugins/x/dist/git-guard.js"'),
      result("t3", at(12, 0), { decision: "reject", source: "user_reject" }),
      // A call the session allowed by itself: no prompt.
      assistant("r4", at(13, 0), [toolUse("t4", "Read", {})]),
      result("t4", at(13, 0, 1), { decision: "accept", reasonType: "rule", source: "config" }),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions[0]?.prompts).toEqual({
      byAsker: {
        "Claude Code": { count: 1, ms: 120_000 },
        "git-guard": { count: 1, ms: 60_000 },
        "merge-guard": { count: 1, ms: 300_000 },
      },
      count: 3,
      longestMs: 300_000,
      totalMs: 480_000,
    });
  });

  it("counts AskUserQuestion and ExitPlanMode apart as questions", () => {
    const { paths } = world([
      assistant("r1", at(10), [toolUse("q1", "AskUserQuestion")]),
      assistant("r2", at(11), [toolUse("q2", "ExitPlanMode")]),
      assistant("r3", at(12), [toolUse("q3", "AskUserQuestion")]),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions[0]?.questions).toEqual({ askUserQuestion: 2, exitPlanMode: 1 });
  });

  it("the guards' ask log is preferred to the attachment: the asker and the reason kind", () => {
    const { paths } = world([
      assistant("r1", at(10, 0), [toolUse("t1", "Bash", { command: "gh pr merge 12 --squash" })]),
      ask("t1", at(10, 0, 1), '"/home/user/.claude/plugins/x/dist/git-guard.js"'),
      result("t1", at(10, 30), { decision: "accept", source: "user_temporary" }),
    ]);
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(
      join(paths.stateDir, "guard-asks.jsonl"),
      `${JSON.stringify({
        at: at(10, 0, 1),
        hook: "merge-guard",
        kind: "review-missing",
        session_id: SESSION,
        tool_use_id: "t1",
      })}\n`,
    );
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions[0]?.prompts?.byAsker).toEqual({
      "merge-guard": { count: 1, ms: 1_800_000 },
    });
    expect(report.sessions[0]?.merges).toEqual({
      byAsker: { "merge-guard": 1 },
      byReason: { "review-missing": 1 },
      count: 1,
    });
  });
});

describe("auto mode's blocks", () => {
  it("counts a refusal by its bracketed rule label, else its reason: the label only", () => {
    const denied = (label: string, reasonType?: string): string =>
      result(
        "t",
        at(10),
        {
          decision: "reject",
          ...(reasonType === undefined ? {} : { reasonType }),
          source: "config",
        },
        [{ text: `Permission to use Bash has been denied. ${label}`, type: "text" }],
      );
    const { paths } = world([
      assistant("r1", at(10), [toolUse("t1", "Bash", { command: "gh pr merge 5" })]),
      denied("[Merge Without Review]"),
      assistant("r2", at(11), [toolUse("t2", "Bash", { command: "rm -rf x" })]),
      denied("", "classifier"),
      // A person's own no, and a hook's ask that was refused: not auto mode's blocks.
      assistant("r3", at(12), [toolUse("t3", "Bash", { command: "ls" })]),
      result("t3", at(12, 1), { decision: "reject", source: "user_reject" }),
      assistant("r4", at(13), [toolUse("t4", "Bash", { command: "ls" })]),
      result("t4", at(13, 1), { decision: "reject", reasonType: "hook", source: "hook" }),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions[0]?.autoModeBlocks).toEqual({
      classifier: 1,
      "Merge Without Review": 1,
    });
  });
});

describe("waiting on background work and idle time", () => {
  it("uses the turn's pending agents and what the next user line says woke it", () => {
    const { paths } = world([
      // A turn ends with two background agents; a task notification wakes it: a background wait.
      turnDuration(at(13, 0), 60_000, 2),
      prompt(at(13, 20), "task_notification"),
      // A turn ends with nothing pending; the person writes 45 minutes later: idle time.
      turnDuration(at(14, 0), 60_000, null),
      prompt(at(14, 45), "human"),
      // With background work pending, a person's write is still a background wait.
      turnDuration(at(15, 0), 60_000, 1),
      prompt(at(15, 5), "human"),
      // Nothing pending, and a peer wrote: neither wait.
      turnDuration(at(16, 0), 60_000, null),
      prompt(at(16, 10), "peer"),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions[0]?.background).toEqual({
      byOrigin: { human: 1, task_notification: 1 },
      count: 2,
      totalMs: 1_500_000,
    });
    expect(report.sessions[0]?.idle).toEqual({ count: 1, totalMs: 2_700_000 });
    // The turns' own recorded time: four turns of one minute.
    expect(report.sessions[0]?.activeMs).toBe(240_000);
  });
});

describe("compactions and merges", () => {
  it("counts compactions by trigger with their tokens, and merges that asked by asker", () => {
    const { paths } = world([
      compact(at(9), "auto", 180_000, 24_000),
      compact(at(10), "manual", 1_000, 2_000),
      // A merge a person approved after the guard asked.
      assistant("r1", at(11), [
        toolUse("m1", "Bash", { command: "cd /home/user/my-app && gh pr merge 12 --squash" }),
      ]),
      ask("m1", at(11, 0, 1), '"/home/user/.claude/plugins/x/dist/merge-guard.js"'),
      result("m1", at(11, 30), { decision: "accept", source: "user_temporary" }),
      // A merge auto mode allowed: no ask.
      assistant("r2", at(12), [toolUse("m2", "Bash", { command: "gh pr merge 13 --merge" })]),
      result("m2", at(12, 0, 1), { decision: "accept", reasonType: "rule", source: "config" }),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions[0]?.compactions).toEqual({
      byTrigger: { auto: 1, manual: 1 },
      count: 2,
      tokens: { post: 26_000, pre: 181_000 },
    });
    expect(report.sessions[0]?.merges).toEqual({
      byAsker: { "merge-guard": 1 },
      byReason: { "not recorded": 1 },
      count: 1,
    });
  });
});

describe("waiting on you now", () => {
  it("lists a call asked and still unanswered, from the attachment or the ask log", () => {
    const { paths } = world([
      assistant("r1", at(17, 50), [toolUse("open1", "AskUserQuestion")]),
      assistant("r2", at(17, 55), [toolUse("open2", "Bash", { command: "git push" })]),
      ask("open2", at(17, 55, 1), '"/home/user/.claude/plugins/x/dist/git-guard.js"'),
      // Asked and answered: not waiting.
      assistant("r3", at(17, 56), [toolUse("done", "Bash", { command: "ls" })]),
      result("done", at(17, 56, 30), { decision: "accept", source: "user_temporary" }),
      // Asked 25 hours ago, never answered: its session is gone, not waiting on you.
      assistant("r0", Date.UTC(2026, 9, 20, 16), [toolUse("old", "AskUserQuestion")]),
    ]);
    const waits = openWaits(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(waits.map((wait) => [wait.tool, wait.asker, wait.kind, wait.at])).toEqual([
      ["Bash", "git-guard", null, at(17, 55)],
      ["AskUserQuestion", "Claude Code", "question", at(17, 50)],
    ]);
    expect(OPEN_WAIT_MAX_AGE_MS).toBe(24 * 3_600_000);
  });
});

describe("the cache", () => {
  it("is written atomically, mode 0600, under the state folder", () => {
    const { paths } = world([launches("r1", at(10), 2)]);
    readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    const file = join(flowCacheFolder(paths), `${PROJECT}.json`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(2);
  });

  it("reads a grown file from its offset only, and a shrunk one from the start", () => {
    const { paths, sessionFile } = world([launches("r1", at(10), 2)]);
    const first = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(first.sessions[0]?.agents.launches).toBe(2);
    // Grow the file by one reply with one launch: the report adds exactly one launch.
    writeFileSync(sessionFile, `${launches("r2", at(11), 1)}\n`, { flag: "a" });
    const grown = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(grown.sessions[0]?.agents.launches).toBe(3);
    expect(grown.sessions[0]?.agents.replies).toBe(2);
    // Shrink it to one reply: the session's counts start again from the new content.
    writeFileSync(sessionFile, `${launches("r3", at(12), 1)}\n`);
    const shrunk = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(shrunk.sessions[0]?.agents.launches).toBe(1);
    expect(shrunk.sessions[0]?.agents.replies).toBe(1);
  });

  it("starts again when the file is replaced (a new inode), and when the cache is broken", () => {
    const { paths, sessionFile } = world([launches("r1", at(10), 2)]);
    readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    // Replace the file: a new inode, the same path.
    const other = `${sessionFile}.new`;
    writeFileSync(other, `${launches("r2", at(11), 3).split("\n").join("\n")}\n`);
    renameSync(other, sessionFile);
    const replaced = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(replaced.sessions[0]?.agents.launches).toBe(3);
    // A cache file that is not ours: the transcripts are read again.
    const cacheFile = join(flowCacheFolder(paths), `${PROJECT}.json`);
    writeFileSync(cacheFile, "{not json");
    const broken = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(broken.sessions[0]?.agents.launches).toBe(3);
  });

  it("keeps eight days of hourly buckets, and the window cannot ask for more", () => {
    expect(FLOW_DAYS_KEPT).toBe(8);
    const { paths } = world([launches("r1", at(10), 1)]);
    // An event nine days back is outside the kept range: not counted, even in a wide window.
    const old = assistant("r0", Date.UTC(2026, 9, 12, 10), [toolUse("x", "Agent")]);
    writeFileSync(
      join(paths.claudeConfigDir, "projects", PROJECT, `${SESSION}.jsonl`),
      `${old}\n${launches("r1", at(10), 1)}\n`,
    );
    const report = readFlow(paths, {
      nowMs: NOW,
      project: null,
      session: null,
      sinceMs: NOW - 8 * 24 * 3_600_000,
    });
    expect(report.sessions[0]?.agents.launches).toBe(1);
  });

  it("drops a session from the cache after 30 quiet days", () => {
    const { paths } = world([launches("r1", at(10), 1)]);
    readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    const file = join(flowCacheFolder(paths), `${PROJECT}.json`);
    // Run again a month later: the session's last line is far behind, so its entry goes.
    readFlow(paths, {
      nowMs: NOW + 31 * 24 * 3_600_000,
      project: null,
      session: null,
      sinceMs: NOW + 30 * 24 * 3_600_000,
    });
    expect(JSON.parse(readFileSync(file, "utf8")).sessions).toEqual({});
    expect(CACHE_KEEP_DAYS).toBe(30);
  });
});

describe("what the version did not record", () => {
  it("says so instead of counting zero", () => {
    const { paths } = world([
      assistant("r1", at(10), [toolUse("x", "Read", {})]),
      // No permissionDecision, no turn_duration, no hook ask anywhere.
      result("x", at(10, 1), null),
    ]);
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    const session = report.sessions[0];
    expect(session?.activeMs).toBeNull();
    expect(session?.prompts).toBeNull();
    expect(session?.background).toBeNull();
    expect(session?.idle).toBeNull();
    expect(report.missing).toEqual([
      "active time: no turn durations were recorded by this version",
      "background waits and idle time: no turn durations were recorded",
      "prompts: no permission decisions were recorded by this version",
      "which hook asked: no hook asks were recorded; every prompt is attributed to Claude Code",
    ]);
    // A session that did record them says nothing is missing.
    const answered = world([
      assistant("r1", at(10), [toolUse("x", "Read", {})]),
      result("x", at(10, 1), { decision: "accept", source: "user_temporary" }),
      turnDuration(at(10, 2), 5_000, null),
    ]);
    expect(
      readFlow(answered.paths, {
        nowMs: NOW,
        project: null,
        session: null,
        sinceMs: SINCE,
      }).missing,
    ).toEqual([
      "which hook asked: no hook asks were recorded; every prompt is attributed to Claude Code",
    ]);
  });
});

describe("filters, skipped records and the reader's helpers", () => {
  it("filters by project and by session prefix, and lists the newest session first", () => {
    const { paths, folder } = world([launches("r1", at(10), 1)]);
    const second = "bbbbbbbb-1111-2222-3333-444444444444";
    writeFileSync(join(folder, `${second}.jsonl`), `${launches("r2", at(17), 1)}\n`);
    const all = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(all.sessions.map((session) => session.session)).toEqual([second, SESSION]);
    expect(
      readFlow(paths, { nowMs: NOW, project: null, session: "aaaa", sinceMs: SINCE }).sessions,
    ).toHaveLength(1);
    expect(
      readFlow(paths, { nowMs: NOW, project: "my-app", session: null, sinceMs: SINCE }).sessions,
    ).toHaveLength(2);
    expect(
      readFlow(paths, { nowMs: NOW, project: "other", session: null, sinceMs: SINCE }).sessions,
    ).toEqual([]);
    // A session whose last line is outside the window is not listed.
    expect(
      readFlow(paths, {
        nowMs: NOW,
        project: null,
        session: null,
        sinceMs: NOW - 2 * 3_600_000,
      }).sessions.map((session) => session.session),
    ).toEqual([second]);
  });

  it("counts the records it cannot read, and skips a half-written last line", () => {
    const { paths, sessionFile } = world([
      launches("r1", at(10), 1),
      // A whole line whose JSON ended early, of a kind the reader reads.
      '{"type":"user","message":{"content":[]},"timestamp":',
      JSON.stringify({ type: "assistant" }),
    ]);
    // A partial last line (no newline) is not a record yet: not read, not skipped.
    writeFileSync(sessionFile, '{"type":"assistant","message":{"content":[]},"timest', {
      flag: "a",
    });
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    // The broken line is not JSON; the assistant line carries no timestamp.
    expect(report.skipped.records).toBe(2);
  });

  it("reads the ask log defensively, and names a hook from its command", () => {
    const root = tempDir("flow-log");
    const file = join(root, "guard-asks.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({
          at: 1,
          hook: "merge-guard",
          kind: "review",
          session_id: "s",
          tool_use_id: "a",
        }),
        JSON.stringify({ at: "2026-10-21T10:00:00Z", hook: "git-guard", tool_use_id: "b" }),
        JSON.stringify({ hook: "no id" }),
        "{broken",
      ].join("\n"),
    );
    const log = readAskLog(file);
    expect(log.skipped).toBe(2);
    expect(log.asks.get("a")).toEqual({ at: 1, hook: "merge-guard", kind: "review" });
    expect(log.asks.get("b")).toEqual({
      at: Date.UTC(2026, 9, 21, 10),
      hook: "git-guard",
      kind: null,
    });
    expect(readAskLog(join(root, "none")).asks.size).toBe(0);
    expect(hookNameFromCommand('bun "/x/dist/merge-guard.js" --missing=ask')).toBe("merge-guard");
    expect(hookNameFromCommand(`bun "\${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-bash.ts"`)).toBe(
      "guard-bash",
    );
    expect(hookNameFromCommand(null)).toBeNull();
  });

  it("a missing projects folder is an empty report, and an old session's cache is pruned", () => {
    const root = tempDir("flow-empty");
    const paths: FlowPaths = {
      claudeConfigDir: join(root, "claude"),
      home: "/home/user",
      stateDir: join(root, "state"),
    };
    const report = readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    expect(report.sessions).toEqual([]);
    expect(report.totals.sessions).toBe(0);
    expect(report.open).toEqual([]);
    // No session ran, so nothing about a version's fields is missing.
    expect(report.missing).toEqual([]);
  });

  it("never stores a word of a message in the cache", () => {
    const { paths } = world([
      assistant("r1", at(10), [toolUse("t1", "Bash", { command: "bun test" })]),
      result("t1", at(10, 5), { decision: "accept", source: "user_temporary" }, [
        { text: SECRET, type: "text" },
      ]),
    ]);
    readFlow(paths, { nowMs: NOW, project: null, session: null, sinceMs: SINCE });
    const cache = readFileSync(join(flowCacheFolder(paths), `${PROJECT}.json`), "utf8");
    expect(cache).not.toContain(SECRET);
    expect(cache).not.toContain("bun test");
  });
});
