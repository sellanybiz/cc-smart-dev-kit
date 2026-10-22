/**
 * The one seam between the portal and the workflow module: every value the Settings page
 * shows, every personal setting it changes, the auto-merge rule, and the Project card's plan.
 *
 * **The page and the command line can never disagree about one machine**
 * (`.claude/rules/portal.md`): the values are the module's own `resolveWorkflow`, the writes
 * are its `writePersonalSetting` / `writeProjectSetting`, the card's preview is its pure
 * `planProjectInit`, and the write is its `applyProjectInit` (a backup first, then an atomic
 * write — never a commit). The two composed members are the CLI's own `detectFacts` +
 * `defaultAnswers` (the form's defaults are exactly what `cc-smart-dev-kit project init`
 * offers) and its `defaultBranchOf`, read through the CLI's own `realRunner`: the portal
 * detects nothing itself.
 *
 * **Nothing here forwards by hand.** A member that is one module function *is* that function
 * (`applyProjectInit,` rather than `(plan, options) => applyProjectInit(plan, options)`), and
 * the interface is written as `typeof` the real ones, so the adapter cannot drift from the
 * module's signatures: a change in `src/workflow/` or `src/project/init.ts` is a type error
 * here. The module's own types are re-exported below, so the pages, the actions and the tests
 * import them from one place.
 *
 * **The seam stays because the tests need it.** Every value is injected
 * (`PortalOptions.workflow`), so a test drives the whole portal with a fake
 * (`src/testing/fake-workflow.ts`) and reads no real workflow file, runs no git, and writes
 * no project's file. One test runs the real adapter end to end (`server.test.ts` › "a project
 * file with a workflow policy, bases and an engine").
 */

import { join } from "node:path";
import {
  defaultAnswers,
  defaultBranchOf,
  detectFacts,
  readExisting,
  realRunner,
} from "../cli/project-init";
import type { CcSmartDevKitConfig } from "../project/config";
import {
  applyProjectInit,
  type ProjectInitAnswers,
  type ProjectInitInput,
  type ProjectInitPlan,
  type ProjectInitWrite,
  planProjectInit,
  type SettingsFilePlan,
} from "../project/init";
import { autoMergeAllowed } from "../workflow/auto-merge";
import {
  personalWorkflowOrDefault,
  type ResolvedValue,
  type ResolvedWorkflow,
  resolvedValueOf,
  resolveWorkflow,
  type WorkflowSource,
} from "../workflow/resolve";
import type { AlertEvent, SwitchName, WorkflowKey } from "../workflow/schema";
import { writePersonalSetting, writeProjectSetting } from "../workflow/write";

/** The environment git and the command line run with. */
export type Env = Record<string, string | undefined>;

export type {
  AlertEvent,
  CcSmartDevKitConfig,
  ProjectInitAnswers,
  ProjectInitInput,
  ProjectInitPlan,
  ProjectInitWrite,
  ResolvedValue,
  ResolvedWorkflow,
  SettingsFilePlan,
  SwitchName,
  WorkflowKey,
  WorkflowSource,
};

/**
 * The module's one map from a key to its resolved value: pure, so it needs no seam of its own,
 * and the page reads a value exactly where `workflow show` reads it.
 */
export { resolvedValueOf };

/** The defaults the Project card's form starts with: the CLI's answers, and the repo's branch. */
export interface ProjectInitDefaults {
  answers: ProjectInitAnswers;
  /** The repository's default branch (`origin/HEAD`), as the auto-merge rule reads it. */
  defaultBranch: string;
}

/**
 * Everything the portal calls in the workflow module, in one place. Each member is the
 * module's own signature (`typeof`), so a drift between the two is a type error here.
 */
export interface WorkflowAdapter {
  applyProjectInit: typeof applyProjectInit;
  autoMergeAllowed: typeof autoMergeAllowed;
  planProjectInit: typeof planProjectInit;
  /**
   * The person's own workflow values, for the plan's D16 clash warning: `{}` when the file is
   * not there or cannot be read (`personalWorkflowOrDefault`).
   */
  personalWorkflowOrDefault: typeof personalWorkflowOrDefault;
  /** What the form starts with: the CLI's `detectFacts` and `defaultAnswers`, from the repo. */
  projectInitDefaults: (input: { env: Env; root: string }) => ProjectInitDefaults;
  /** The repository's default branch: `origin/HEAD`, else `main` (`defaultBranchOf`). */
  repositoryDefaultBranch: (root: string, env: Env) => string;
  resolveWorkflow: typeof resolveWorkflow;
  writePersonalSetting: typeof writePersonalSetting;
  writeProjectSetting: typeof writeProjectSetting;
}

/** One runner, one detection: the CLI's own, so the portal reads this machine the way it does. */
function projectInitDefaults(input: { env: Env; root: string }): ProjectInitDefaults {
  const facts = detectFacts(realRunner(input.env), input.root);
  return {
    // `readExisting` is the CLI's own read of the project's file: a file that is there but
    // broken is no file, exactly as `project init` treats it — and a file that is broken in a
    // way the plan refuses (`planProjectInit`) is refused in words when the plan is made.
    answers: defaultAnswers(
      readExisting(join(input.root, ".claude", "cc-smart-dev-kit.json")),
      facts,
      { dryRun: false, yes: false },
    ),
    defaultBranch: facts.defaultBranch,
  };
}

/** The real adapter: the module's own functions, and the CLI's own detection. */
export const workflowAdapter: WorkflowAdapter = {
  applyProjectInit,
  autoMergeAllowed,
  personalWorkflowOrDefault,
  planProjectInit,
  projectInitDefaults,
  repositoryDefaultBranch: (root, env) => defaultBranchOf(realRunner(env), root),
  resolveWorkflow,
  writePersonalSetting,
  writeProjectSetting,
};
