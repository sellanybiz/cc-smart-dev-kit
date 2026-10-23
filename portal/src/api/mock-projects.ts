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
  SettingsData,
} from "./types";
import type { ActionName, ActionResult } from "./wire";

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
  /** The mock's answer to a `project.*` action: a preview carries its plan, as the server's. */
  act: (action: ActionName, body: Record<string, unknown>) => ActionResult | null;
}

export function projectMocks(now: number, empty: boolean, settings: SettingsData): ProjectMocks {
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
          settings: mine ? settings : null,
          setup: { answers, error: null, planError: null },
        },
      ];
    }),
  );
  return {
    act: (action, body) => {
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
    projects: {
      note: empty ? "No Claude Code session record was found on this machine yet." : null,
      rows,
    },
  };
}
