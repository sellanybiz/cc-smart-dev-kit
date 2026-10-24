/**
 * The Projects tab and a project's page, in mock data (B8). Every name is a placeholder
 * (`my-app`, `/home/user/code`). The set of rows covers each state the pages draw: the
 * current project, set up, with its files not committed yet and branches the merge guard
 * allows, refuses and ran late on; a set-up one; one not set up; and an added folder git
 * could not count.
 */

import type {
  ProjectData,
  ProjectInitAnswers,
  ProjectInitPlan,
  ProjectList,
  ProjectListRow,
} from "./types";
import type {
  ActionName,
  ActionResult,
  ProjectWorkflowAnswer,
  ProjectWorkflowSetting,
} from "./wire";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ROOT = "/home/user/code";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const SET_ANSWERS: ProjectInitAnswers = {
  base: "main",
  bases: { "crew/": "release-1.1.0", "release/": "main" },
  guards: { guardMainFolder: true, jobRoute: true, sessionNames: true },
  protectedBranches: ["main", "release-1.1.0"],
};

const DEFAULT_ANSWERS: ProjectInitAnswers = {
  base: "main",
  bases: {},
  guards: { guardMainFolder: true, jobRoute: true, sessionNames: true },
  protectedBranches: ["main"],
};

/** The plan `project init` would write for a project at `root` with `answers`. */
function planFor(root: string, answers: ProjectInitAnswers): ProjectInitPlan {
  const text = `${JSON.stringify(
    {
      base: answers.base,
      bases: answers.bases,
      protectedBranches: answers.protectedBranches,
      guards: answers.guards,
    },
    null,
    2,
  )}\n`;
  const line = '+ "worktree": { "baseRef": "head" }';
  return {
    changed: true,
    diff: text.split("\n").map((one) => `+ ${one}`),
    file: `${root}/.claude/cc-smart-dev-kit.json`,
    localSettings: {
      adds: [],
      changed: false,
      file: `${root}/.claude/settings.local.json`,
      lines: [],
      removes: [],
      text: "",
    },
    notes: ["Nothing is committed: commit both files with the project."],
    settings: {
      adds: [line],
      changed: true,
      file: `${root}/.claude/settings.json`,
      lines: [line],
      removes: [],
      text: '{\n  "worktree": { "baseRef": "head" }\n}\n',
    },
    text,
  };
}

export interface ProjectMocks {
  projects: ProjectList;
  projectPages: Record<string, ProjectData>;
  /** Each project's workflow settings, for the Workflow card (D57), by project id. */
  workflowPages: Record<string, ProjectWorkflowAnswer>;
  /** The mock's answer to a `project.*` action: a preview carries its plan, as the server's. */
  act: (action: ActionName, body: Record<string, unknown>) => ActionResult | null;
}

/**
 * One project's workflow settings, every key with its value and where it came from — the
 * shape `/api/projects/<id>/workflow` answers (D57). The values are placeholders: the card
 * only draws them, and a value the project's own file sets is marked `project`.
 */
const WORKFLOW_SETTINGS: ProjectWorkflowSetting[] = [
  { key: "autoCommit", source: "project", value: true },
  { key: "autoPush", source: "project", value: true },
  { key: "openPr", source: "project", value: "draft" },
  { key: "autoMerge", source: "personal", value: true },
  { key: "mergeMethod", source: "default", value: "merge" },
  { key: "deleteBranch", source: "default", value: false },
  { key: "reviewBeforePush", source: "default", value: true },
  { key: "reviewAgents", source: "default", value: ["cc-smart-dev-kit:reviewer"] },
  { key: "fixesAfterReview.lines", source: "default", value: 200 },
  { key: "fixesAfterReview.files", source: "default", value: 10 },
  { key: "fixesAfterReview.percent", source: "default", value: 20 },
  { key: "clearWorktreeAfterMerge", source: "personal", value: true },
  {
    key: "alerts.events",
    source: "default",
    value: ["needs-you", "question", "finished", "failed"],
  },
  { key: "alerts.sound", source: "default", value: false },
  { key: "alerts.usagePercent", source: "default", value: 85 },
  { key: "crew.enabled", source: "personal", value: true },
  { key: "crew.keep", source: "default", value: [] },
  { key: "crew.idleStopMinutes", source: "default", value: 10 },
  { key: "crew.max", source: "default", value: 24 },
  { key: "crew.maxOpus", source: "default", value: null },
  { key: "crew.memoryGb", source: "default", value: 2 },
  { key: "crew.perLead", source: "default", value: 4 },
  { key: "crew.perLeadOpus", source: "default", value: 2 },
  { key: "crew.usagePercent", source: "default", value: 85 },
  { key: "crew.quietMinutes", source: "default", value: 20 },
  { key: "crew.handoffPercent", source: "default", value: 70 },
  { key: "crew.softHours", source: "default", value: 2 },
  { key: "crew.maxHours", source: "default", value: 4 },
  { key: "crew.tag", source: "project", value: "my-app" },
  { key: "switches.statusLine", source: "personal", value: true },
  { key: "switches.sessionNames", source: "project", value: true },
  { key: "switches.jobRoute", source: "project", value: true },
  { key: "switches.updateHold", source: "default", value: false },
];

export function projectMocks(now: number, empty: boolean): ProjectMocks {
  const rows: ProjectListRow[] = empty
    ? []
    : [
        {
          current: true,
          id: "a1f04c2e",
          lastUsed: iso(now - MINUTE),
          name: "my-app",
          path: `${ROOT}/my-app`,
          setUp: true,
          source: "sessions",
          uncommitted: true,
          worktrees: 5,
        },
        {
          current: false,
          id: "5d2e9b10",
          lastUsed: iso(now - 6 * MINUTE),
          name: "docs-site",
          path: `${ROOT}/docs-site`,
          setUp: true,
          source: "sessions",
          uncommitted: false,
          worktrees: 1,
        },
        {
          current: false,
          id: "b7c13e88",
          lastUsed: iso(now - 2 * HOUR),
          name: "api-service",
          path: `${ROOT}/api-service`,
          setUp: false,
          source: "sessions",
          uncommitted: null,
          worktrees: 0,
        },
        {
          current: false,
          id: "e0a6f7d3",
          lastUsed: null,
          name: "a-very-long-project-name-that-keeps-going-for-the-phone",
          path: "/home/user/somewhere/deep/inside/a-very-long-project-name-that-keeps-going-for-the-phone",
          setUp: false,
          source: "added",
          uncommitted: null,
          worktrees: null,
        },
      ];
  const checkedAt = iso(now - 20_000);
  const projectPages: Record<string, ProjectData> = Object.fromEntries(
    rows.map((project): [string, ProjectData] => {
      const answers = project.setUp ? SET_ANSWERS : DEFAULT_ANSWERS;
      const mine = project.current;
      return [
        project.id,
        {
          answers: project.setUp ? SET_ANSWERS : null,
          branches: mine
            ? [
                {
                  base: "main",
                  branch: "feature/login-page",
                  draft: false,
                  kind: "pr",
                  number: 42,
                  title: "Add the login page",
                  verdict: {
                    kind: "allowed",
                    label: "allowed",
                    reason: "Reviewed at abc1234; 12 lines since, under the limit.",
                    tone: "ok",
                  },
                },
                {
                  base: "release-1.1.0",
                  branch: "crew/B2-search",
                  draft: true,
                  kind: "pr",
                  number: 43,
                  title: "Search over every saved session",
                  verdict: {
                    kind: "refused",
                    label: "refused",
                    reason: "No review is recorded on this branch yet.",
                    tone: "warn",
                  },
                },
                {
                  base: "release-1.1.0",
                  branch: "crew/B3-export",
                  draft: false,
                  kind: "crew",
                  number: null,
                  title: null,
                  verdict: {
                    kind: "late",
                    label: "ran late",
                    reason: "reading the review record took longer than the guard waits",
                    tone: "warn",
                  },
                },
              ]
            : [],
          branchesNote:
            project.source === "added"
              ? "gh is not installed: the pull requests could not be read."
              : null,
          checkedAt,
          project,
          setup: { answers, error: null, planError: null },
        },
      ];
    }),
  );
  const workflowPages: Record<string, ProjectWorkflowAnswer> = Object.fromEntries(
    rows.map((project): [string, ProjectWorkflowAnswer] => {
      if (!project.setUp) {
        return [
          project.id,
          {
            base: null,
            gh: "in",
            note: `${project.path} has no .claude/cc-smart-dev-kit.json yet: set it up with \`cc-smart-dev-kit project init\` there.`,
            settings: [],
          },
        ];
      }
      return [
        project.id,
        {
          base: "main",
          // The current project can open a pull request; the other set-up one shows the card
          // without a gh that can read its repository.
          gh: project.current ? "in" : "out",
          note: null,
          settings: WORKFLOW_SETTINGS,
        },
      ];
    }),
  );
  return {
    act: (action, body) => {
      if (action === "project.workflow.propose") {
        const page = typeof body.project === "string" ? workflowPages[body.project] : undefined;
        if (page === undefined) return { lines: ["Mock data: no such project."], ok: false };
        if (page.note !== null) return { lines: [page.note], ok: false };
        const setting = typeof body.setting === "string" ? body.setting : "";
        if (setting === "deleteBranch") {
          // One refusal, so the card's refused state is seen in mock data too.
          return {
            lines: [
              "gh pr create failed: HTTP 403 (mock). Check that gh is logged in (`gh auth login`) and that your account may open a pull request on this repository, then try again; the branch and its worktree were taken back.",
            ],
            ok: false,
          };
        }
        return {
          lines: [
            `+ ${setting} in .claude/cc-smart-dev-kit.json`,
            "+ worktree-workflow-mock (mock), cut from origin/main and pushed",
            "+ pull request into main: https://github.com/example-org/my-app/pull/44",
          ],
          ok: true,
          url: "https://github.com/example-org/my-app/pull/44",
        };
      }
      if (action === "project.preview") {
        const page = typeof body.project === "string" ? projectPages[body.project] : undefined;
        if (page === undefined) return { lines: ["Mock data: no such project."], ok: false };
        return {
          filesHash: "mock-hash",
          lines: ["1 line, added inside the existing file. Nothing else there changes."],
          ok: true,
          preview: planFor(page.project.path, page.setup.answers ?? DEFAULT_ANSWERS),
        };
      }
      if (action === "project.add") {
        const folder = typeof body.folder === "string" ? body.folder.trim() : "";
        if (folder === "") return { lines: ["Type the folder's path first."], ok: false };
        return {
          lines: [`Mock data: ${folder} was not added. The real portal adds it.`],
          ok: true,
        };
      }
      return null;
    },
    projectPages,
    workflowPages,
    projects: {
      note: empty ? "No Claude Code session record was found on this machine yet." : null,
      rows,
    },
  };
}
