/**
 * The review record hook: a review agent's own end (SubagentStop) records the commit the
 * session's working folder is on, and nothing else does.
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
import { recordsReview } from "./review-record";
import { reviewRecordHook } from "./specs";

const CONFIG = {
  requires: ">=0.4",
  worktrees: { base: "dev", prefix: "app-wt-" },
  workflow: { reviewBeforePush: true },
};

/** The record file of `repo` under `env`, named by hand. */
function recordFile(env: Record<string, string>, repo: string): string {
  return join(
    cliPaths(env).stateDir,
    "reviews",
    `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
  );
}

/** What the record holds: the shas it names, sorted. */
function recorded(env: Record<string, string>, repo: string): string[] {
  const file = recordFile(env, repo);
  if (!existsSync(file)) return [];
  return Object.keys(JSON.parse(readFileSync(file, "utf8")) as Record<string, string>).sort();
}

/** The input Claude Code sends when a subagent stops. */
function stopped(cwd: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    hook_event_name: "SubagentStop",
    session_id: "11111111-2222-3333-4444-555555555555",
    cwd,
    ...fields,
  };
}

describe("which agents record a review", () => {
  test("the plugin's reviewer records the commit the folder is on, silently", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = git(repo, "rev-parse", "HEAD").trim();
    const result = await runHook(
      reviewRecordHook,
      stopped(repo, { agent_id: "0a1b2c3d4e5f60718", agent_type: "cc-smart-dev-kit:reviewer" }),
      env,
    );
    // SubagentStop carries no context: the record is the whole answer.
    expect(result).toEqual({});
    expect(recorded(env, repo)).toEqual([head]);
  });

  test("the same agent reported by its bare name: the same list matches it", async () => {
    // Names are compared the repo's own way for a subagent type (`agentKey`, `agent-guard.ts`):
    // any `plugin:` prefix, case, `-`/`_`/space do not matter. What `agent_type` holds for a
    // plugin agent is not proved (contract § Relied on, not proved yet), so either form works.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = git(repo, "rev-parse", "HEAD").trim();
    expect(await runHook(reviewRecordHook, stopped(repo, { agent_type: "Reviewer" }), env)).toEqual(
      {},
    );
    expect(recorded(env, repo)).toEqual([head]);
  });

  test("another agent type records nothing", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(
      await runHook(reviewRecordHook, stopped(repo, { agent_type: "general-purpose" }), env),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual([]);
  });

  test("a project's own reviewer, listed in reviewAgents, records", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...CONFIG,
      workflow: { reviewBeforePush: true, reviewAgents: ["fresh-eyes"] },
    });
    const head = git(repo, "rev-parse", "HEAD").trim();
    expect(
      await runHook(reviewRecordHook, stopped(repo, { agent_type: "Fresh Eyes" }), env),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual([head]);
  });

  test("a list of its own replaces the plugin's: only the listed one records", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...CONFIG,
      workflow: { reviewBeforePush: true, reviewAgents: ["fresh-eyes"] },
    });
    expect(
      await runHook(
        reviewRecordHook,
        stopped(repo, { agent_type: "cc-smart-dev-kit:reviewer" }),
        env,
      ),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual([]);
  });

  test("recordsReview reads the list as agent names, the Agent guard's own way", () => {
    expect(recordsReview("cc-smart-dev-kit:reviewer", ["cc-smart-dev-kit:reviewer"])).toBe(true);
    expect(recordsReview("reviewer", ["cc-smart-dev-kit:reviewer"])).toBe(true);
    expect(recordsReview("Reviewer", ["reviewer"])).toBe(true);
    expect(recordsReview("fresh eyes", ["Fresh-Eyes"])).toBe(true);
    expect(recordsReview("general-purpose", ["cc-smart-dev-kit:reviewer"])).toBe(false);
  });
});

describe("what it never records", () => {
  test("an agent that stopped inside its own worktree: not the commit under review", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const agent = "0a1b2c3d4e5f60718";
    const folder = join(repo, ".claude", "worktrees", `agent-${agent}`);
    git(repo, "worktree", "add", "-q", "-b", `worktree-agent-${agent}`, folder);
    expect(
      await runHook(
        reviewRecordHook,
        stopped(join(folder, "src"), { agent_id: agent, agent_type: "cc-smart-dev-kit:reviewer" }),
        env,
      ),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual([]);
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
        stopped(join(folder, "src"), { agent_type: "cc-smart-dev-kit:reviewer" }),
        env,
      ),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual([]);
  });

  test("a project that never opted in: silent, and nothing written", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    expect(
      await runHook(
        reviewRecordHook,
        stopped(repo, { agent_type: "cc-smart-dev-kit:reviewer" }),
        env,
      ),
    ).toEqual({});
    expect(recorded(env, repo)).toEqual([]);
  });

  test("a stop with no agent type: silent", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await runHook(reviewRecordHook, stopped(repo, { agent_id: "abc" }), env)).toEqual({});
  });

  test("a folder with no commit yet: silent, not a failure", async () => {
    const env = hookEnv();
    const repo = tempDir("empty-repo");
    git(repo, "init", "-q", "-b", "main");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(
      await runHook(
        reviewRecordHook,
        stopped(repo, { agent_type: "cc-smart-dev-kit:reviewer" }),
        env,
      ),
    ).toEqual({});
  });

  test("a broken personal workflow file: nothing recorded, one stderr line", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    const result = await runHook(
      reviewRecordHook,
      stopped(repo, { agent_type: "cc-smart-dev-kit:reviewer" }),
      env,
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit review-record: the workflow settings cannot be read (Invalid ",
    );
    expect(recorded(env, repo)).toEqual([]);
  });
});

describe("the record it writes", () => {
  test("a commit already recorded is not recorded twice", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const head = git(repo, "rev-parse", "HEAD").trim();
    const input = stopped(repo, { agent_type: "cc-smart-dev-kit:reviewer" });
    await runHook(reviewRecordHook, input, env);
    const file = recordFile(env, repo);
    const before = readFileSync(file, "utf8");
    expect(await runHook(reviewRecordHook, input, env)).toEqual({});
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(recorded(env, repo)).toEqual([head]);
  });

  test("a worktree writes into the repository's own record, keyed by the main checkout", async () => {
    // The merge guard reads one record per repository, wherever the session runs.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const worktree = join(repo, "..", "app-wt-review-record");
    git(repo, "worktree", "add", "-q", "-b", "review-record", worktree);
    const head = git(worktree, "rev-parse", "HEAD").trim();
    await runHook(
      reviewRecordHook,
      stopped(worktree, { agent_type: "cc-smart-dev-kit:reviewer" }),
      env,
    );
    expect(recorded(env, repo)).toEqual([head]);
    expect(existsSync(recordFile(env, worktree))).toBe(false);
  });

  test("the commit a reviewer stopped on is the commit the merge guard then trusts", async () => {
    // The two hooks agree on one file, one key and one sha — the property the merge relies on.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    writeFileSync(join(repo, "second.txt"), "second\n");
    git(repo, "add", "second.txt");
    git(repo, "commit", "-q", "-m", "second");
    const head = git(repo, "rev-parse", "HEAD").trim();
    await runHook(
      reviewRecordHook,
      stopped(repo, { agent_type: "cc-smart-dev-kit:reviewer" }),
      env,
    );
    const file = recordFile(env, repo);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object)).toEqual([head]);
  });
});
