/**
 * The one seam between the portal and the workflow module: every value the Settings page
 * shows, every personal setting it changes, the auto-merge rule, and the Project card's plan.
 *
 * The workflow module is `src/workflow/` (`resolve.ts`, `write.ts`, `auto-merge.ts`,
 * `schema.ts`) and `src/project/init.ts`. The portal never re-implements any of it: the
 * types below are that module's own shapes, and the default adapter calls its functions.
 *
 * **The page and the command line can never disagree about one machine** (`.claude/rules/
 * portal.md`): the values are the same `resolveWorkflow` the CLI's `workflow show` reads, the
 * writes are the same `writePersonalSetting` / `writeProjectSetting`, the card's preview is
 * the same pure `planProjectInit`, and the write is the same `applyProjectInit` (a backup
 * first, then an atomic write — never a commit). The two extra members (`projectInitDefaults`,
 * `repositoryDefaultBranch`) are the CLI's own `detectFacts` + `defaultAnswers` and
 * `defaultBranchOf`, for the form's defaults and the auto-merge rule: the portal detects
 * nothing itself, so its form offers exactly what `cc-smart-dev-kit project init` offers.
 *
 * Every value here is injected (`PortalOptions.workflow`), so a test drives the whole portal
 * with a fake (`src/testing/fake-workflow.ts`) and never reads a real workflow file, runs
 * git, or writes anything.
 *
 * **Integrator:** when the workflow module lands on this branch, replace the bodies of
 * `workflowAdapter` with the real imports — `resolveWorkflow` from `../workflow/resolve`,
 * `writePersonalSetting` / `writeProjectSetting` from `../workflow/write`, `autoMergeAllowed`
 * from `../workflow/auto-merge`, `planProjectInit` / `applyProjectInit` from
 * `../project/init`, and `projectInitDefaults` / `repositoryDefaultBranch` from
 * `../cli/project-init` (`detectFacts` + `defaultAnswers`, `defaultBranchOf`). Nothing else
 * in `src/portal/` changes: the pages, the actions and the tests use only this interface.
 */

import type { CliPaths } from "../cli/paths";
import type { CcSmartDevKitConfig } from "../project/config";

/** The environment git and the command line run with. */
export type Env = Record<string, string | undefined>;

// ── The settings, as `src/workflow/schema.ts` defines them ──────────────────────

/** Where a resolved value came from. */
export type WorkflowSource = "project" | "personal" | "default";

/** One value, and where it came from. */
export interface ResolvedValue<T> {
  source: WorkflowSource;
  value: T;
}

/** The four moments an alert is worth having. */
export type AlertEvent = "needs-you" | "question" | "finished" | "failed";

/** The switches, and each one's real home (`src/workflow/schema.ts`). */
export type SwitchName = "statusLine" | "sessionNames" | "jobRoute" | "updateHold";

/** A setting a person may set, the same keys the command line takes. */
export type WorkflowKey =
  | "autoCommit"
  | "autoPush"
  | "openPr"
  | "autoMerge"
  | "mergeMethod"
  | "deleteBranch"
  | "reviewBeforePush"
  | "clearWorktreeAfterMerge"
  | "alerts.events"
  | "alerts.sound"
  | "alerts.usagePercent"
  | `switches.${SwitchName}`;

/** Every value the workflow holds, with where each came from (`resolveWorkflow`). */
export interface ResolvedWorkflow {
  alerts: {
    events: ResolvedValue<AlertEvent[]>;
    sound: ResolvedValue<boolean>;
    usagePercent: ResolvedValue<number>;
  };
  autoCommit: ResolvedValue<boolean>;
  autoMerge: ResolvedValue<boolean>;
  autoPush: ResolvedValue<boolean>;
  clearWorktreeAfterMerge: ResolvedValue<boolean>;
  deleteBranch: ResolvedValue<boolean>;
  mergeMethod: ResolvedValue<"merge" | "squash" | "rebase">;
  openPr: ResolvedValue<"off" | "draft" | "ready">;
  reviewBeforePush: ResolvedValue<boolean>;
  switches: {
    jobRoute: ResolvedValue<boolean>;
    sessionNames: ResolvedValue<boolean>;
    statusLine: ResolvedValue<boolean>;
    updateHold: ResolvedValue<boolean>;
  };
}

// ── The project's two files, as `src/project/init.ts` plans them ────────────────

/** One question's answer, as the form gave it. */
export interface ProjectInitAnswers {
  /** The branch a new worktree starts from when no prefix of `bases` matches. */
  base: string;
  /** The branch-name prefix to the base a worktree of such a branch starts from. */
  bases: Record<string, string>;
  /** Who makes this project's worktrees. */
  engine: "plugin" | "own";
  guards: {
    /** Refuse an edit in the main checkout itself. */
    guardMainFolder: boolean;
    /** Send a heavy command through the job queue. */
    jobRoute: boolean;
    /** Each session names itself after its task. */
    sessionNames: boolean;
  };
  /** The folder-name prefix of a worktree beside the repo. */
  prefix: string;
  /** The branches the git guard asks about before a push. */
  protectedBranches: string[];
  /** The command run inside a new worktree, in argv form; null: none. */
  setup: string[] | null;
  /** The policy written into the project's file; `{}` leaves the field out. */
  workflow: Record<string, unknown>;
}

/** The two files as they are now, and the answers: what `planProjectInit` takes. */
export interface ProjectInitInput {
  answers: ProjectInitAnswers;
  /** `.claude/cc-smart-dev-kit.json` as it is now, or null. */
  existing: null | string;
  /** `.claude/settings.json` as it is now, or null. */
  existingSettings: null | string;
  /** The repo root: `<root>/.claude/` holds both files. */
  root: string;
}

/** The two files as the answers would leave them (`planProjectInit`). */
export interface ProjectInitPlan {
  /** True when the project's file differs from the file now. */
  changed: boolean;
  /** The changes, one line each: `+ <key>: <value>`, `~ <key>: <old> -> <new>`, `- <key>`. */
  diff: string[];
  file: string;
  /** The lines added to `.claude/settings.json`. Empty for an engine of the project's own. */
  hookLines: string[];
  /** What to know, shown with the plan. */
  notes: string[];
  settingsChanged: boolean;
  settingsFile: string;
  /** What the settings file will hold (the engine's lines merged in). */
  settingsText: string;
  /** What the project's file will hold. */
  text: string;
}

/** One file `applyProjectInit` wrote. */
export interface ProjectInitWrite {
  /** The backup made before the write; null on a dry run, which writes nothing. */
  backup: null | string;
  /** True when the file was not there before. */
  created: boolean;
  file: string;
}

/** The defaults the form starts with: the repo's own facts, and the CLI's own answers. */
export interface ProjectInitDefaults {
  answers: ProjectInitAnswers;
  /** The repository's default branch (`origin/HEAD`), as the auto-merge rule reads it. */
  defaultBranch: string;
}

/**
 * Everything the portal calls in the workflow module, in one place. Each member is one real
 * function; a change in this interface is a change in that module's own signature.
 */
export interface WorkflowAdapter {
  applyProjectInit(
    plan: ProjectInitPlan,
    options: { dryRun?: boolean; stateDir: string },
  ): ProjectInitWrite[];
  /** May a pull request with this base be merged by itself? `autoMergeAllowed`. */
  autoMergeAllowed(
    resolved: ResolvedWorkflow,
    projectConfig: CcSmartDevKitConfig | null,
    prBase: string,
    defaultBranch: string,
  ): boolean;
  /** The project's two files, as the answers would leave them. Pure. */
  planProjectInit(input: ProjectInitInput): ProjectInitPlan;
  /** What the form starts with: the CLI's `detectFacts` and `defaultAnswers`. */
  projectInitDefaults(input: {
    env: Env;
    existing: null | string;
    root: string;
  }): ProjectInitDefaults;
  /** Every value, with where it came from. Throws when the person's own file is broken. */
  resolveWorkflow(paths: CliPaths, projectConfig: CcSmartDevKitConfig | null): ResolvedWorkflow;
  /** The repository's default branch: `origin/HEAD`, else `main` (`defaultBranchOf`). */
  repositoryDefaultBranch(root: string, env: Env): string;
  /** One value in the person's own defaults. Returns the line the CLI would print; throws on a bad value. */
  writePersonalSetting(paths: CliPaths, key: string, value: unknown): string;
  /** One value in the project's committed file. Returns the line; throws on a bad value. */
  writeProjectSetting(cwd: string, key: string, value: unknown): string;
}

/**
 * The workflow module is not part of this build: this branch does not hold `src/workflow/`
 * yet. Everything that needs it says so in one line — never a made-up value, and never a
 * second copy of the module written here for the waiting time. See the header: swapping the
 * bodies below for the real imports is the whole integration.
 */
const NOT_WIRED =
  "The workflow module is not wired into this build of the portal (src/portal/workflow-adapter.ts).";

function notWired(): never {
  throw new Error(NOT_WIRED);
}

/** The real adapter. **Integrator:** replace each body with the real import (see the header). */
export const workflowAdapter: WorkflowAdapter = {
  applyProjectInit: notWired,
  autoMergeAllowed: notWired,
  planProjectInit: notWired,
  projectInitDefaults: notWired,
  repositoryDefaultBranch: notWired,
  resolveWorkflow: notWired,
  writePersonalSetting: notWired,
  writeProjectSetting: notWired,
};
