/**
 * A world for the tests of GitHub Issues (`src/issues/`): a temp checkout whose `origin` is a
 * GitHub address, the project's file committed on `origin/main`, the person's own workflow
 * file, and a fake `gh` (`fake-gh.ts`). Nothing here reaches GitHub.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { type FakeGh, type FakeGhOptions, fakeGh } from "./fake-gh";
import { commitConfig, makeRepo, writePersonalWorkflow } from "./hooks";
import { cleanGitEnv, git, tempDir } from "./temp";

/** The home folder the screen is told to refuse. */
export const TEST_HOME = "/home/tester";

/** The address `origin` has unless a test sets another. */
export const OWN_ORIGIN = "git@github.com:example-org/my-app.git";

/** The repository that address names, as `gh --repo` takes it. */
export const OWN_REPO = "github.com/example-org/my-app";

export interface IssuesSetup {
  /** The project's file as committed on origin/main; null: no committed file. */
  committed?: null | Record<string, unknown>;
  gh?: FakeGhOptions;
  /** Origin's URL; null: no `origin` remote. */
  origin?: null | string;
  /** The person's own workflow.json. */
  personal?: Record<string, unknown>;
  /** The project's file in the working copy only (never committed). */
  workingCopy?: Record<string, unknown>;
}

/** The project's file with the switch on, as committed on the base. */
export const ISSUES_ON = { worktrees: { base: "main" }, workflow: { issues: { enabled: true } } };

export function issuesWorld(setup: IssuesSetup = {}) {
  const repo = makeRepo("my-app");
  const origin = setup.origin === undefined ? OWN_ORIGIN : setup.origin;
  if (origin !== null) git(repo, "remote", "add", "origin", origin);
  const home = tempDir("issues-home");
  const env = { ...cleanGitEnv(), CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home };
  if (setup.committed !== null) commitConfig(repo, setup.committed ?? ISSUES_ON, ["main"]);
  if (setup.workingCopy !== undefined) {
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(setup.workingCopy));
  }
  if (setup.personal !== undefined) writePersonalWorkflow(env, setup.personal);
  const gh: FakeGh = fakeGh(setup.gh);
  return {
    env,
    gh,
    paths: cliPaths(env),
    repo,
    world: { cwd: repo, env, gh: gh.exec, home: TEST_HOME, paths: cliPaths(env) },
  };
}
