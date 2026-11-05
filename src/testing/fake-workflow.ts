/**
 * The workflow module for a test: every value the Settings page reads, the project's two
 * files, and a record of every call made — so a test proves what the portal *asked for*, not
 * what a real module then did with it.
 *
 * Nothing here is the real module: a test that needs `writePersonalSetting`'s own validation,
 * or `planProjectInit`'s own text, runs the real code (`src/workflow/workflow.test.ts`).
 * This fake proves the portal's side of the seam — that a value reaches the write, that the
 * preview *is* the plan, and that a write happens once.
 */

import type {
  ProjectInitDefaults,
  ProjectInitInput,
  ProjectInitPlan,
  ProjectInitWrite,
  ResolvedValue,
  ResolvedWorkflow,
  WorkflowAdapter,
  WorkflowSource,
} from "../portal/workflow-adapter";
import type { CcSmartDevKitConfig } from "../project/config";

/** Every value as the built-in defaults hold it: nothing is committed or merged by itself. */
export function defaultResolved(): ResolvedWorkflow {
  const at = <T>(value: T, source: WorkflowSource = "default"): ResolvedValue<T> => ({
    source,
    value,
  });
  return {
    alerts: {
      events: at(["needs-you", "question", "finished", "failed"]),
      sound: at(false),
      usagePercent: at(85),
    },
    autoCommit: at(false),
    autoMerge: at(false),
    autoPush: at(false),
    clearWorktreeAfterMerge: at(false),
    deleteBranch: at(false),
    fixesAfterReview: { files: at(10), lines: at(200), percent: at(20) },
    issues: {
      allowPublic: at(false),
      enabled: at(false),
      fixedLabel: at("fixed-unreleased"),
      foundLabel: at("kit:found"),
      readyLabel: at("kit:ready"),
    },
    mergeMethod: at("merge"),
    openPr: at("off"),
    reviewBeforePush: at(true),
    reviewAgents: at(["cc-smart-dev-kit:senior-engineer"]),
    switches: {
      jobRoute: at(false),
      leadHint: at(true),
      sessionNames: at(false),
      statusLine: at(false),
      updateHold: at(false),
    },
  };
}

/** What a test may set on the fake; everything else is the safe default. */
export interface FakeWorkflowOptions {
  /** `autoMergeAllowed`'s answer, and the calls it was asked about. */
  autoMerge?: boolean;
  /** The repository's default branch, from `repositoryDefaultBranch`. */
  defaultBranch?: string;
  /** The answers a fresh form starts with; the built-in ones are a plain, real-looking set. */
  defaults?: Partial<ProjectInitDefaults>;
  /** The values the Settings page reads, over `defaultResolved()`. */
  resolved?: Partial<Omit<ResolvedWorkflow, "alerts" | "switches">> & {
    alerts?: Partial<ResolvedWorkflow["alerts"]>;
    switches?: Partial<ResolvedWorkflow["switches"]>;
  };
  /** True: every call throws, as a build with no workflow module does. */
  unwired?: boolean;
}

/** Every call the portal made, in order, with its arguments. */
export interface FakeWorkflowCalls {
  applyProjectInit: { options: { dryRun?: boolean; stateDir: string }; plan: ProjectInitPlan }[];
  autoMergeAllowed: { defaultBranch: string; prBase: string }[];
  planProjectInit: ProjectInitInput[];
  projectInitDefaults: { root: string }[];
  resolveWorkflow: { projectConfig: CcSmartDevKitConfig | null }[];
  writePersonalSetting: { key: string; value: unknown }[];
  writeProjectSetting: {
    cwd: string;
    env: Record<string, string | undefined>;
    key: string;
    value: unknown;
  }[];
}

export interface FakeWorkflow extends WorkflowAdapter {
  calls: FakeWorkflowCalls;
  /** What `applyProjectInit` wrote, as file → text (a dry run writes nothing here). */
  written: Map<string, string>;
}

/** The form's own first answers, as a real project's would look; a test may override them. */
export function fakeDefaults(): ProjectInitDefaults {
  return {
    answers: {
      base: "integration",
      bases: { "hotfix/": "main", "release/": "main" },
      guards: { guardMainFolder: true, jobRoute: false, sessionNames: true },
      protectedBranches: ["main", "integration"],
      workflow: {},
    },
    defaultBranch: "main",
  };
}

/** One plan, made from the input alone, so a test can compare the two exactly. */
function fakePlan(input: ProjectInitInput): ProjectInitPlan {
  const file = `${input.root}/.claude/cc-smart-dev-kit.json`;
  const settingsFile = `${input.root}/.claude/settings.json`;
  const text = `${JSON.stringify(input.answers, null, 2)}\n`;
  // A base branch other than the repo's default gets Claude Code's `baseRef: "head"`.
  const hasHead = (input.existingSettings ?? "").includes('"baseRef": "head"');
  const settingsAdds =
    input.answers.base !== input.defaultBranch && !hasHead ? ['worktree.baseRef: "head"'] : [];
  const settingsText =
    settingsAdds.length > 0
      ? `{\n  "worktree": {\n    "baseRef": "head"\n  }\n}\n`
      : `${input.existingSettings ?? "{}\n"}`;
  return {
    changed: text !== input.existing,
    diff: [`+ worktrees.base: ${JSON.stringify(input.answers.base)}`],
    file,
    // The personal settings file changes only for an engine line, which no fake plan has.
    localSettings: {
      adds: [],
      changed: false,
      file: `${input.root}/.claude/settings.local.json`,
      lines: [],
      removes: [],
      text: input.existingLocalSettings ?? "{}\n",
    },
    notes: [],
    settings: {
      adds: settingsAdds,
      changed: settingsAdds.length > 0,
      file: settingsFile,
      lines: settingsAdds.map((line) => `+ ${line}`),
      removes: [],
      text: settingsText,
    },
    text,
  };
}

/** A workflow module a test drives: every call recorded, nothing written outside `written`. */
export function fakeWorkflow(options: FakeWorkflowOptions = {}): FakeWorkflow {
  const base = defaultResolved();
  const defaults = fakeDefaults();
  const calls: FakeWorkflowCalls = {
    applyProjectInit: [],
    autoMergeAllowed: [],
    planProjectInit: [],
    projectInitDefaults: [],
    resolveWorkflow: [],
    writePersonalSetting: [],
    writeProjectSetting: [],
  };
  const written = new Map<string, string>();
  const unwired = (): never => {
    throw new Error("the workflow module is not wired into this test");
  };
  const resolved: ResolvedWorkflow = {
    ...base,
    ...options.resolved,
    alerts: { ...base.alerts, ...options.resolved?.alerts },
    switches: { ...base.switches, ...options.resolved?.switches },
  };
  return {
    calls,
    written,
    applyProjectInit(plan, opts): ProjectInitWrite[] {
      calls.applyProjectInit.push({ options: opts, plan });
      if (opts.dryRun === true) return [];
      const wanted: Array<[string, string]> = [];
      if (plan.changed) wanted.push([plan.file, plan.text]);
      for (const settings of [plan.settings, plan.localSettings]) {
        if (settings.changed) wanted.push([settings.file, settings.text]);
      }
      return wanted.map(([file, text]) => {
        written.set(file, text);
        return { backup: null, created: true, file };
      });
    },
    autoMergeAllowed(_resolved, _projectConfig, prBase, defaultBranch): boolean {
      calls.autoMergeAllowed.push({ defaultBranch, prBase });
      return options.unwired === true ? unwired() : options.autoMerge === true;
    },
    planProjectInit(input): ProjectInitPlan {
      calls.planProjectInit.push(input);
      return options.unwired === true ? unwired() : fakePlan(input);
    },
    // D16's clash warning in the plan: the fake has no person's file, so nothing is assumed.
    personalWorkflowOrDefault: () => ({}),
    projectInitDefaults(input): ProjectInitDefaults {
      calls.projectInitDefaults.push({ root: input.root });
      if (options.unwired === true) unwired();
      return {
        answers: { ...defaults.answers, ...options.defaults?.answers },
        defaultBranch: options.defaults?.defaultBranch ?? defaults.defaultBranch,
      };
    },
    repositoryDefaultBranch(): string {
      return options.defaultBranch ?? defaults.defaultBranch;
    },
    resolveWorkflow(_paths, projectConfig): ResolvedWorkflow {
      calls.resolveWorkflow.push({ projectConfig });
      return options.unwired === true ? unwired() : resolved;
    },
    writePersonalSetting(_paths, key, value): string {
      calls.writePersonalSetting.push({ key, value });
      if (options.unwired === true) unwired();
      // The real writer's own rule: `sessionNames` lives in the project's file (`jobRoute` has a
      // machine-wide default in the person's own).
      if (key === "switches.sessionNames") {
        throw new Error(
          `${key} is the project's setting: run it with --project inside the project`,
        );
      }
      return `~ your own defaults: ${key} = ${String(value)}`;
    },
    writeProjectSetting(cwd, key, value, env = {}): string {
      calls.writeProjectSetting.push({ cwd, env, key, value });
      if (options.unwired === true) unwired();
      if (
        key === "switches.statusLine" ||
        key === "switches.updateHold" ||
        key === "switches.leadHint"
      ) {
        throw new Error(`${key} is your own setting, not the project's`);
      }
      return `~ ${cwd}/.claude/cc-smart-dev-kit.json: ${key} = ${String(value)}`;
    },
  };
}
