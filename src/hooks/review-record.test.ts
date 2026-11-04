/**
 * The review record hook: a review agent's own start (SubagentStart) notes the commit the
 * folder is on, and its own end (SubagentStop) records that commit — only when the folder is
 * still on it — and nothing else does.
 *
 * The record file is named here the way `reviews.ts` names it (a hand-built hash), never by
 * calling the code under test, and every case reads it back to prove what was written.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { reviewRecordHook } from "./specs";

const CONFIG = {
  requires: ">=0.4",
  worktrees: { base: "dev" },
  workflow: { reviewBeforePush: true },
};

const AGENT_ID = "0a1b2c3d4e5f60718";
const REVIEWER = "cc-smart-dev-kit:senior-engineer";

/** One file of the record folder of `repo` under `env`, named by hand. */
function recordFile(env: Record<string, string>, repo: string, suffix = ".json"): string {
  return join(
    cliPaths(env).stateDir,
    "reviews",
    `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}${suffix}`,
  );
}

/** What the record holds: each sha it names, with the writers that recorded it. */
function recorded(env: Record<string, string>, repo: string): Record<string, string[]> {
  const file = recordFile(env, repo);
  if (!existsSync(file)) return {};
  const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, { by: string[] }>;
  return Object.fromEntries(Object.entries(record).map(([sha, entry]) => [sha, entry.by]));
}

/** The branches the record names for each sha; null where it names none. */
function branchesOf(env: Record<string, string>, repo: string): Record<string, string[] | null> {
  const record = JSON.parse(readFileSync(recordFile(env, repo), "utf8")) as Record<
    string,
    { branches?: string[] }
  >;
  return Object.fromEntries(
    Object.entries(record).map(([sha, entry]) => [sha, entry.branches ?? null]),
  );
}

/** The input Claude Code sends when a subagent starts (`agent-` prefixed, as the docs show). */
function started(cwd: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    hook_event_name: "SubagentStart",
    session_id: "11111111-2222-3333-4444-555555555555",
    cwd,
    agent_id: `agent-${AGENT_ID}`,
    ...fields,
  };
}

/** The input Claude Code sends when a subagent stops (a bare hex id, as proved live). */
function stopped(cwd: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    hook_event_name: "SubagentStop",
    session_id: "11111111-2222-3333-4444-555555555555",
    cwd,
    agent_id: AGENT_ID,
    agent_transcript_path: reviewTranscript(),
    ...fields,
  };
}

function reviewTranscript(brief = "Mode: review"): string {
  const path = join(tempDir("review-brief"), "agent.jsonl");
  writeFileSync(path, `${JSON.stringify({ type: "user", message: { content: brief } })}\n`);
  return path;
}

describe("the review brief marker", () => {
  test("an exact marker in a multiline block brief records, including CRLF", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const path = reviewTranscript();
    writeFileSync(
      path,
      `${JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "Please review\r\nMode: review\r\nReport findings" }] } })}\n`,
    );
    await review(env, repo, { agent_type: REVIEWER, agent_transcript_path: path });
    expect(recorded(env, repo)).toEqual({ [git(repo, "rev-parse", "HEAD").trim()]: [REVIEWER] });
  });
  test("a later user message cannot turn a consult into a review", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const path = reviewTranscript("Consult");
    writeFileSync(
      path,
      readFileSync(path, "utf8") +
        `${JSON.stringify({ type: "user", message: { content: "Mode: review" } })}\n`,
    );
    await review(env, repo, { agent_type: REVIEWER, agent_transcript_path: path });
    expect(recorded(env, repo)).toEqual({});
  });
  test("an unreadable transcript records nothing and consumes its start", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    await review(env, repo, {
      agent_type: REVIEWER,
      agent_transcript_path: join(tempDir("gone"), "missing.jsonl"),
    });
    expect(recorded(env, repo)).toEqual({});
    expect(JSON.parse(readFileSync(recordFile(env, repo, ".starts.json"), "utf8"))).toEqual({});
  });
  for (const brief of [
    "Consult",
    "prefix Mode: review",
    "Mode: review suffix",
    " Mode: review",
    "Mode: review ",
  ]) {
    test(`does not record an inexact marker: ${brief}`, async () => {
      const env = hookEnv();
      const repo = makeRepo();
      writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
      await review(env, repo, {
        agent_type: REVIEWER,
        agent_transcript_path: reviewTranscript(brief),
      });
      expect(recorded(env, repo)).toEqual({});
    });
  }
  test("no transcript records nothing", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    await review(env, repo, { agent_type: REVIEWER, agent_transcript_path: undefined });
    expect(recorded(env, repo)).toEqual({});
  });
});

/** One review agent's whole run in `cwd`: its start, then its stop. Both answers. */
async function review(
  env: Record<string, string>,
  cwd: string,
  fields: Record<string, unknown>,
): Promise<[unknown, unknown]> {
  const start = await runHook(reviewRecordHook, started(cwd, fields), env);
  const stop = await runHook(reviewRecordHook, stopped(cwd, fields), env);
  return [start, stop];
}

/** A second commit in `repo`: HEAD moves. */
function commitAgain(repo: string): string {
  writeFileSync(join(repo, "second.txt"), "second\n");
  git(repo, "add", "second.txt");
  git(repo, "commit", "-q", "-m", "second");
  return git(repo, "rev-parse", "HEAD").trim();
}

describe("which agents record a review", () => {
  test("the plugin's reviewer records the commit the folder is on, and who it was, silently", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = git(repo, "rev-parse", "HEAD").trim();
    // Neither event carries context: the record is the whole answer.
    expect(await review(env, repo, { agent_type: REVIEWER })).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({ [head]: [REVIEWER] });
  });

  test("HK-6: another plugin's agent named reviewer records nothing", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await review(env, repo, { agent_type: "other-plugin:reviewer" })).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({});
  });

  test("HK-6: a project's own agent named reviewer records nothing for the plugin's list", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await review(env, repo, { agent_type: "reviewer" })).toEqual([{}, {}]);
    expect(await review(env, repo, { agent_type: "Reviewer" })).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({});
  });

  test("another agent type records nothing", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await review(env, repo, { agent_type: "general-purpose" })).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({});
  });

  test("a project's own reviewer, listed in reviewAgents by its name, records", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...CONFIG,
      workflow: { reviewBeforePush: true, reviewAgents: ["fresh-eyes"] },
    });
    const head = git(repo, "rev-parse", "HEAD").trim();
    expect(await review(env, repo, { agent_type: "fresh-eyes" })).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({ [head]: ["fresh-eyes"] });
  });

  test("a list of its own replaces the plugin's: only the listed one records", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...CONFIG,
      workflow: { reviewBeforePush: true, reviewAgents: ["fresh-eyes"] },
    });
    expect(await review(env, repo, { agent_type: REVIEWER })).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({});
  });
});

describe("the commit it records is the one the reviewer read (HK-6)", () => {
  test("D17: HEAD moved while the reviewer ran: the START commit is recorded, silently, on its branch", async () => {
    // A commit made while the reviewer read is a fix it never saw: it counts as change after
    // the review (review-cover.ts), so the record names the commit the reviewer began on.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const first = git(repo, "rev-parse", "HEAD").trim();
    expect(await runHook(reviewRecordHook, started(repo, { agent_type: REVIEWER }), env)).toEqual(
      {},
    );
    commitAgain(repo);
    expect(await runHook(reviewRecordHook, stopped(repo, { agent_type: REVIEWER }), env)).toEqual(
      {},
    );
    expect(recorded(env, repo)).toEqual({ [first]: [REVIEWER] });
    expect(branchesOf(env, repo)).toEqual({ [first]: ["main"] });
  });

  test("D17: the start notes the branch the folder is on", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    git(repo, "checkout", "-q", "-b", "feature/one");
    const head = git(repo, "rev-parse", "HEAD").trim();
    await runHook(reviewRecordHook, started(repo, { agent_type: REVIEWER }), env);
    const starts = JSON.parse(readFileSync(recordFile(env, repo, ".starts.json"), "utf8"));
    expect(starts[AGENT_ID]).toMatchObject({ head, branch: "feature/one" });
    await runHook(reviewRecordHook, stopped(repo, { agent_type: REVIEWER }), env);
    expect(branchesOf(env, repo)).toEqual({ [head]: ["feature/one"] });
  });

  test("D17: on a detached HEAD the start notes no branch, and the record counts exactly", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = git(repo, "rev-parse", "HEAD").trim();
    git(repo, "checkout", "-q", "--detach");
    await runHook(reviewRecordHook, started(repo, { agent_type: REVIEWER }), env);
    const starts = JSON.parse(readFileSync(recordFile(env, repo, ".starts.json"), "utf8"));
    expect(starts[AGENT_ID]).toEqual({ head, at: expect.any(Number) });
    await runHook(reviewRecordHook, stopped(repo, { agent_type: REVIEWER }), env);
    expect(recorded(env, repo)).toEqual({ [head]: [REVIEWER] });
    expect(branchesOf(env, repo)).toEqual({ [head]: null });
  });

  test("HK-6: a stop whose start was never seen: nothing recorded, and one line says why", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await runHook(reviewRecordHook, stopped(repo, { agent_type: REVIEWER }), env)).toEqual({
      stderr:
        "cc-smart-dev-kit review-record: no start was seen for this review agent, so no review is recorded: run the review again",
    });
    expect(recorded(env, repo)).toEqual({});
  });

  test("F2b-5: the stop a block caused is silent when its start is gone: the first stop recorded the review", async () => {
    // `subagent-background` blocks a hand-back that leaves background work running. The first
    // stop's review-record took the start and recorded the review; the second stop
    // (`stop_hook_active`) finds no start. Saying "no start was seen … run the review again"
    // there is false, and sends the agent to repeat a review that is already recorded.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = git(repo, "rev-parse", "HEAD").trim();
    await runHook(reviewRecordHook, started(repo, { agent_type: REVIEWER }), env);
    expect(await runHook(reviewRecordHook, stopped(repo, { agent_type: REVIEWER }), env)).toEqual(
      {},
    );
    expect(
      await runHook(
        reviewRecordHook,
        stopped(repo, { agent_type: REVIEWER, stop_hook_active: true }),
        env,
      ),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual({ [head]: [REVIEWER] });
  });

  test("a stop takes its start back: the same id stopping again records nothing new", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    await review(env, repo, { agent_type: REVIEWER });
    const starts = JSON.parse(readFileSync(recordFile(env, repo, ".starts.json"), "utf8"));
    expect(starts).toEqual({});
  });

  test("a start with no agent id notes nothing, and its stop records nothing", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const input = { agent_type: REVIEWER, agent_id: undefined };
    expect(await review(env, repo, input)).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({});
  });
});

describe("what it never records", () => {
  test("an agent that stopped inside its own worktree: not the commit under review", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const folder = join(repo, ".claude", "worktrees", `agent-${AGENT_ID}`);
    git(repo, "worktree", "add", "-q", "-b", `worktree-agent-${AGENT_ID}`, folder);
    await runHook(reviewRecordHook, started(repo, { agent_type: REVIEWER }), env);
    expect(
      await runHook(reviewRecordHook, stopped(join(folder, "src"), { agent_type: REVIEWER }), env),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual({});
  });

  test("the same, with no agent id to match: the shape alone is enough", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const folder = join(repo, ".claude", "worktrees", "agent-0a1b2c3d4e5f60718");
    git(repo, "worktree", "add", "-q", "-b", "worktree-agent-other", folder);
    expect(
      await runHook(
        reviewRecordHook,
        stopped(join(folder, "src"), { agent_type: REVIEWER, agent_id: undefined }),
        env,
      ),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual({});
  });

  test("a project that never opted in: silent, and nothing written", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    expect(await review(env, repo, { agent_type: REVIEWER })).toEqual([{}, {}]);
    expect(recorded(env, repo)).toEqual({});
    expect(existsSync(recordFile(env, repo, ".starts.json"))).toBe(false);
  });

  test("a stop with no agent type: silent", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await runHook(reviewRecordHook, stopped(repo, {}), env)).toEqual({});
  });

  test("a folder with no commit yet: silent, not a failure", async () => {
    const env = hookEnv();
    const repo = tempDir("empty-repo");
    git(repo, "init", "-q", "-b", "main");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await review(env, repo, { agent_type: REVIEWER })).toEqual([{}, {}]);
  });

  test("a broken personal workflow file: nothing recorded, one stderr line", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    const result = await runHook(reviewRecordHook, stopped(repo, { agent_type: REVIEWER }), env);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit review-record: the workflow settings cannot be read (Invalid ",
    );
    expect(recorded(env, repo)).toEqual({});
  });
});

describe("the record it writes", () => {
  test("a commit already recorded is not recorded twice", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = git(repo, "rev-parse", "HEAD").trim();
    await review(env, repo, { agent_type: REVIEWER });
    const file = recordFile(env, repo);
    const before = readFileSync(file, "utf8");
    expect(await review(env, repo, { agent_type: REVIEWER })).toEqual([{}, {}]);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(recorded(env, repo)).toEqual({ [head]: [REVIEWER] });
  });

  test("a worktree writes into the repository's own record, keyed by the main checkout", async () => {
    // The merge guard reads one record per repository, wherever the session runs.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const worktree = join(repo, "..", "app-wt-review-record");
    git(repo, "worktree", "add", "-q", "-b", "review-record", worktree);
    const head = git(worktree, "rev-parse", "HEAD").trim();
    await review(env, worktree, { agent_type: REVIEWER });
    expect(recorded(env, repo)).toEqual({ [head]: [REVIEWER] });
    expect(existsSync(recordFile(env, worktree))).toBe(false);
  });

  test("the commit a reviewer stopped on is the commit the merge guard then trusts", async () => {
    // The two hooks agree on one file, one key and one sha — the property the merge relies on.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = commitAgain(repo);
    await review(env, repo, { agent_type: REVIEWER });
    const file = recordFile(env, repo);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object)).toEqual([head]);
  });
});
