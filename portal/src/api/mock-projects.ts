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
  ProjectGatewayAnswer,
  ProjectGatewayDecision,
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
  bases: { "feature/": "release-1.1.0", "release/": "main" },
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
  /** Each project's Gateway card (GP4b), by project id. */
  gatewayPages: Record<string, ProjectGatewayAnswer>;
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
  { key: "reviewAgents", source: "default", value: ["cc-smart-dev-kit:senior-engineer"] },
  { key: "fixesAfterReview.lines", source: "default", value: 200 },
  { key: "fixesAfterReview.files", source: "default", value: 10 },
  { key: "fixesAfterReview.percent", source: "default", value: 20 },
  { key: "clearWorktreeAfterMerge", source: "personal", value: true },
  { key: "issues.enabled", source: "default", value: false },
  { key: "issues.allowPublic", source: "default", value: false },
  { key: "issues.foundLabel", source: "default", value: "kit:found" },
  { key: "issues.fixedLabel", source: "default", value: "fixed-unreleased" },
  { key: "issues.readyLabel", source: "default", value: "kit:ready" },
  { key: "alerts.usagePercent", source: "default", value: 85 },
  { key: "switches.sessionNames", source: "project", value: true },
  { key: "switches.jobRoute", source: "project", value: true },
];

/** The machine's chains in the mock (the Slots page's own), as a profile's view reads them. */
const MACHINE_CHAINS: Record<string, null | string[]> = {
  "cc-smart-dev-kit-fable": null,
  "cc-smart-dev-kit-judge": null,
  "cc-smart-dev-kit-opus": ["claude-opus-5-5", "omniroute:glm-5.3", "omniroute:deepseek-v4.1"],
  "cc-smart-dev-kit-scout": ["omniroute:glm-5.3-flash", "omniroute:minimax-m3", "claude-haiku-5-5"],
  "cc-smart-dev-kit-worker": ["omniroute:deepseek-v4.1-flash", "claude-sonnet-5-5"],
};

/** One decision, in the command's own words. */
function decision(
  state: ProjectGatewayDecision["state"],
  source: ProjectGatewayDecision["source"],
  words: string,
  from: string,
  profile: null | string = null,
): ProjectGatewayDecision {
  return { from, profile, source, state, words };
}

const ROUTER = "http://127.0.0.1:20100";

/** A file where the command writes every state. */
const NOTHING_REFUSED = { default: null, off: null, on: null };

/** The command's refusal of on in a team file, in its planner's words. */
const TEAM_ON =
  "a team file never points teammates at one person's local router: on each teammate's machine, 127.0.0.1 is their own computer, so their sessions would fail or reach whatever listens on that port. Set this project's state for yourself (no --team), or put off or default in the team file.";

/** Every state refused, as the planner refuses a folder outside git. */
const NOT_GIT_WORDS = `${ROOT.replace("/code", "/somewhere")} is not in a git project: a project's gateway state lives in its .claude/ folder, beside the checkout. Run this inside a git project.`;
const NOT_GIT = { default: NOT_GIT_WORDS, off: NOT_GIT_WORDS, on: NOT_GIT_WORDS };
const MACHINE_FILE = "~/.claude/settings.json";

/**
 * Each project's Gateway card (GP4b), by id: the current project on with its profile, one that
 * follows the machine, one off in its team file with a personal file git tracks, and an added
 * folder that is no git project and whose settings cannot be read.
 */
function gatewayPagesFor(rows: ProjectListRow[]): Record<string, ProjectGatewayAnswer> {
  const machineOn = decision(
    "on",
    "machine",
    `on → ${ROUTER}`,
    `the machine's settings ${MACHINE_FILE}`,
  );
  const pages: Record<string, ProjectGatewayAnswer> = {};
  for (const project of rows) {
    const personal = `${project.path.replace("/home/user", "~")}/.claude/settings.local.json`;
    const team = `${project.path.replace("/home/user", "~")}/.claude/settings.json`;
    const files = (personalHolds: string, teamHolds: string): ProjectGatewayAnswer["files"] => [
      { holds: personalHolds, kind: "personal", path: personal, problem: false },
      { holds: teamHolds, kind: "team", path: team, problem: false },
      { holds: `on → ${ROUTER}`, kind: "machine", path: MACHINE_FILE, problem: false },
    ];
    const base = {
      configured: true,
      notes: [],
      personalTracked: false,
      refusals: { personal: NOTHING_REFUSED, team: { ...NOTHING_REFUSED, on: TEAM_ON } },
      profile: null,
      profiles: ["cheap", "night-shift"],
      writable: true,
    };
    if (project.current) {
      const on = decision(
        "on",
        "personal",
        `on → ${ROUTER}/p/cheap  (profile cheap)`,
        `the personal file ${personal} (never committed)`,
        "cheap",
      );
      pages[project.id] = {
        ...base,
        choice: on,
        effective: on,
        files: files(`on → ${ROUTER}/p/cheap  (profile cheap)`, "sets nothing"),
        profile: {
          exists: true,
          name: "cheap",
          slots: [
            {
              fallback: true,
              key: "cc-smart-dev-kit-scout",
              machine: MACHINE_CHAINS["cc-smart-dev-kit-scout"] ?? null,
              name: "scout",
              own: ["omniroute:glm-5.3-flash"],
            },
            {
              fallback: true,
              key: "cc-smart-dev-kit-worker",
              machine: MACHINE_CHAINS["cc-smart-dev-kit-worker"] ?? null,
              name: "worker",
              own: null,
            },
            {
              fallback: true,
              key: "cc-smart-dev-kit-judge",
              machine: null,
              name: "judge",
              own: null,
            },
            {
              fallback: false,
              key: "cc-smart-dev-kit-fable",
              machine: null,
              name: "fable",
              own: null,
            },
            {
              fallback: false,
              key: "cc-smart-dev-kit-opus",
              machine: MACHINE_CHAINS["cc-smart-dev-kit-opus"] ?? null,
              name: "opus",
              own: "claude",
            },
          ],
        },
      };
    } else if (project.setUp) {
      pages[project.id] = {
        ...base,
        choice: decision(
          "default",
          "none",
          "default: no file of this project sets a gateway address, so the machine's settings decide",
          "nothing in this project",
        ),
        effective: machineOn,
        files: files("sets nothing", "sets nothing"),
      };
    } else if (project.source === "sessions") {
      const off = decision(
        "off",
        "team",
        "off → https://api.anthropic.com",
        `the team file ${team} (committed with the project)`,
      );
      pages[project.id] = {
        ...base,
        choice: off,
        effective: off,
        files: files("sets nothing", "off → https://api.anthropic.com"),
        notes: [
          {
            text: "Git tracks this project's personal file (.claude/settings.local.json), so a router address written there would be committed with it: on is refused until it is untracked (git rm --cached -- .claude/settings.local.json).",
            tone: "warn",
          },
        ],
        personalTracked: true,
        refusals: {
          personal: {
            ...NOTHING_REFUSED,
            on: `${project.path}/.claude/settings.local.json is committed in this project (git tracks it), so a router address written here would be committed with it. Untrack it first: git rm --cached -- .claude/settings.local.json`,
          },
          team: { ...NOTHING_REFUSED, on: TEAM_ON },
        },
      };
    } else {
      const unknown = decision(
        "unknown",
        "team",
        "unknown: a settings file in the way cannot be read",
        `the team file ${team} (committed with the project)`,
      );
      pages[project.id] = {
        ...base,
        choice: unknown,
        effective: unknown,
        files: [
          {
            holds: `cannot be read (${team} is not valid JSON: Unexpected token n at line 1)`,
            kind: "team",
            path: team,
            problem: true,
          },
          { holds: `on → ${ROUTER}`, kind: "machine", path: MACHINE_FILE, problem: false },
        ],
        notes: [
          {
            text: "This folder is not in a git project: it has no personal file, so its state cannot be set here.",
            tone: "info",
          },
          {
            text: "A settings file this project's sessions read cannot be read, so its gateway state is unknown: fix the file by hand, or move it aside.",
            tone: "bad",
          },
        ],
        personalTracked: null,
        refusals: { personal: NOT_GIT, team: NOT_GIT },
        writable: false,
      };
    }
  }
  return pages;
}

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
                  branch: "feature/B2-search",
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
        if (!page.settings.some((one) => one.key === setting)) {
          return {
            lines: [`"${setting}" is not a setting the project's file can hold.`],
            ok: false,
          };
        }
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
      if (action === "project.gateway.set") {
        if (body.state === "on" && body.profile === "night-shift") {
          // One refusal, so the card's refused state is seen in mock data too.
          return {
            lines: [
              "the router does not answer on 127.0.0.1:20100 (connection refused); every Claude request in this project would fail. Run cc-smart-dev-kit gateway setup first.",
            ],
            ok: false,
          };
        }
        return {
          lines: [
            `~ .claude/${body.team === true ? "settings.json" : "settings.local.json"}: env.ANTHROPIC_BASE_URL (mock)`,
            "Mock data: nothing was written. The real portal runs gateway project.",
          ],
          ok: true,
        };
      }
      if (action === "project.gateway.profile") {
        return {
          lines: [
            `${String(body.profile)}: ${String(body.slot)} changed (mock)`,
            "The router uses it from its next request: it reads the config again within about a second.",
          ],
          ok: true,
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
    gatewayPages: gatewayPagesFor(rows),
    projectPages,
    workflowPages,
    projects: {
      note: empty ? "No Claude Code session record was found on this machine yet." : null,
      rows,
    },
  };
}
