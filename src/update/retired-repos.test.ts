/**
 * The repos Claude Code's saved sessions name that still carry a retired engine piece (D33):
 * what `setup` and `update` list. Real git on temp repos (`git()`, a clean environment), and a
 * temp config folder whose `projects/` holds the session files.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { reposWithRetiredParts, retiredRepoLines } from "./retired-repos";

const ENGINE_LINE = {
  hooks: {
    WorktreeCreate: [
      {
        hooks: [
          { command: '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create', type: "command" },
        ],
      },
    ],
  },
};

/** A temp home with a config folder, and a way to record a saved session that worked in a folder. */
function machine() {
  const home = tempDir("scan-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  let n = 0;
  const session = (folder: string) => {
    n += 1;
    const project = join(paths.projectsDir, `-project-${n}`);
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, `s${n}.jsonl`),
      `${JSON.stringify({ type: "user", cwd: "/elsewhere" })}\n${JSON.stringify({ type: "assistant", cwd: folder })}\n`,
    );
  };
  return { home, paths, session };
}

/** A git repo with one commit, and these files under `.claude/`. */
function repo(files: Record<string, string> = {}): string {
  const dir = tempDir("scan-repo");
  git(dir, "init", "-q");
  git(dir, "commit", "--allow-empty", "-q", "-m", "first");
  mkdirSync(join(dir, ".claude"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, ".claude", name), text);
  return dir;
}

describe("D33: the repos that still carry a retired piece", () => {
  test("D33: a session folder that is gone, or not in git, is skipped; a clean repo is not listed", () => {
    const m = machine();
    m.session(join(tempDir("gone"), "deleted-since"));
    m.session(tempDir("not-git"));
    m.session(repo({ "cc-smart-dev-kit.json": JSON.stringify({ worktrees: { base: "main" } }) }));
    expect(retiredRepoLines(m.paths, cleanGitEnv())).toEqual([]);
  });

  test("D33: no saved sessions at all: nothing", () => {
    expect(retiredRepoLines(machine().paths, cleanGitEnv())).toEqual([]);
  });

  test("D33: retired fields, a broken config, and an engine line only: one line each, by path, with the fix", () => {
    const m = machine();
    const fields = repo({
      "cc-smart-dev-kit.json": JSON.stringify({
        worktrees: { base: "main", engine: "cc-smart-dev-kit", prefix: "app-wt-", setup: "bun i" },
      }),
    });
    const broken = repo({ "cc-smart-dev-kit.json": "{ not json" });
    const engineOnly = repo({ "settings.local.json": JSON.stringify(ENGINE_LINE) });
    for (const dir of [fields, broken, engineOnly]) m.session(dir);
    const lines = retiredRepoLines(m.paths, cleanGitEnv());
    // The runtime's own words for the broken text, whatever Bun version runs the test.
    let parseError = "";
    try {
      JSON.parse("{ not json");
    } catch (error) {
      parseError = (error as Error).message;
    }
    const expected = [
      `! ${fields} still has worktrees.prefix, worktrees.setup, worktrees.engine in .claude/cc-smart-dev-kit.json, retired in 1.0.0: cd ${fields} && cc-smart-dev-kit project init`,
      `! ${broken}: .claude/cc-smart-dev-kit.json cannot be read (${parseError}), so whether it still sets a field retired in 1.0.0 is unknown. Fix it, then: cd ${broken} && cc-smart-dev-kit project init`,
      `! ${engineOnly} still has an engine hook line in .claude/settings.local.json, retired in 1.0.0: cd ${engineOnly} && cc-smart-dev-kit project init`,
    ];
    // By path: the temp folders sort the way they were made only by chance.
    expect(lines.sort()).toEqual(expected.sort());
  });

  test("D33: a field and engine lines in both settings files: one line for the repo", () => {
    const m = machine();
    const dir = repo({
      "cc-smart-dev-kit.json": JSON.stringify({ worktrees: { base: "main", prefix: "app-wt-" } }),
      "settings.json": JSON.stringify(ENGINE_LINE),
      "settings.local.json": JSON.stringify(ENGINE_LINE),
    });
    m.session(dir);
    expect(retiredRepoLines(m.paths, cleanGitEnv())).toEqual([
      `! ${dir} still has worktrees.prefix in .claude/cc-smart-dev-kit.json and an engine hook line in .claude/settings.json and an engine hook line in .claude/settings.local.json, retired in 1.0.0: cd ${dir} && cc-smart-dev-kit project init`,
    ]);
  });

  test("D33: sessions in the main checkout and in its worktree count as one repo, read from the main checkout", () => {
    const m = machine();
    const main = repo({
      "cc-smart-dev-kit.json": JSON.stringify({ worktrees: { base: "main", prefix: "app-wt-" } }),
    });
    const worktree = join(main, ".claude", "worktrees", "topic");
    git(main, "worktree", "add", "-q", "-b", "topic", worktree);
    m.session(main);
    m.session(worktree);
    expect(reposWithRetiredParts(m.paths, cleanGitEnv()).map((found) => found.repo)).toEqual([
      main,
    ]);
  });

  test("D33: under the home folder the repo shows as ~; a path with a space is quoted in the fix", () => {
    const m = machine();
    const dir = join(m.home, "my app");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    git(dir, "init", "-q");
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(ENGINE_LINE));
    m.session(dir);
    expect(retiredRepoLines(m.paths, cleanGitEnv())).toEqual([
      `! ~/my app still has an engine hook line in .claude/settings.json, retired in 1.0.0: cd '${dir}' && cc-smart-dev-kit project init`,
    ]);
  });

  test("D33: read-only: the repo's files are left exactly as they were", () => {
    const m = machine();
    const config = JSON.stringify({ worktrees: { base: "main", prefix: "app-wt-" } });
    const dir = repo({
      "cc-smart-dev-kit.json": config,
      "settings.json": JSON.stringify(ENGINE_LINE),
    });
    m.session(dir);
    expect(retiredRepoLines(m.paths, cleanGitEnv())).toHaveLength(1);
    expect(readFileSync(join(dir, ".claude", "cc-smart-dev-kit.json"), "utf8")).toBe(config);
    expect(readFileSync(join(dir, ".claude", "settings.json"), "utf8")).toBe(
      JSON.stringify(ENGINE_LINE),
    );
  });
});
