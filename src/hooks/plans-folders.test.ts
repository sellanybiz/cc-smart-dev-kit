/** Where a session's plans live: the folders `verify-gate` and the main-folder guard share. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { realPath } from "./git";
import { plansFolders } from "./plans-folders";

describe("plansFolders", () => {
  test("no setting: the Claude config folder's plans, and the project's own .claude/plans", () => {
    const repo = makeRepo();
    const env = hookEnv();
    expect(plansFolders(repo, env)).toEqual([
      realPath(join(cliPaths(env).claudeConfigDir, "plans")),
      realPath(join(repo, ".claude/plans")),
    ]);
  });

  test("the person's setting: `~/` is their home, any other path is read from the project root", () => {
    const repo = makeRepo();
    const env = hookEnv();
    const paths = cliPaths(env);
    writeFileSync(paths.settingsFile, JSON.stringify({ plansDirectory: "~/my-plans" }));
    expect(plansFolders(repo, env)[0]).toBe(realPath(join(paths.home, "my-plans")));
    writeFileSync(paths.settingsFile, JSON.stringify({ plansDirectory: "rel-plans" }));
    expect(plansFolders(repo, env)[0]).toBe(realPath(join(repo, "rel-plans")));
    const absolute = tempDir("abs-plans");
    writeFileSync(paths.settingsFile, JSON.stringify({ plansDirectory: absolute }));
    expect(plansFolders(repo, env)[0]).toBe(realPath(absolute));
  });

  test("the project's setting beats the person's, its local setting beats both", () => {
    const repo = makeRepo();
    const env = hookEnv();
    writeFileSync(cliPaths(env).settingsFile, JSON.stringify({ plansDirectory: "person" }));
    writeClaudeFile(repo, "settings.json", { plansDirectory: "project" });
    expect(plansFolders(repo, env)[0]).toBe(realPath(join(repo, "project")));
    writeClaudeFile(repo, "settings.local.json", { plansDirectory: "local" });
    expect(plansFolders(repo, env)[0]).toBe(realPath(join(repo, "local")));
  });

  test("a link on the way is followed, so the folder is compared by where it really is", () => {
    const repo = makeRepo();
    const env = hookEnv();
    mkdirSync(join(repo, "real-plans"));
    symlinkSync(join(repo, "real-plans"), join(repo, "linked-plans"), "dir");
    writeClaudeFile(repo, "settings.json", { plansDirectory: "linked-plans" });
    expect(plansFolders(repo, env)[0]).toBe(realPath(join(repo, "real-plans")));
  });

  test("a setting that is not text is no setting", () => {
    const repo = makeRepo();
    const env = hookEnv();
    writeClaudeFile(repo, "settings.json", { plansDirectory: 7 });
    expect(plansFolders(repo, env)[0]).toBe(realPath(join(cliPaths(env).claudeConfigDir, "plans")));
  });
});
