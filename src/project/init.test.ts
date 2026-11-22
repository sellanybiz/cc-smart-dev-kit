/** `project init`: the plan it makes, and the files `applyProjectInit` writes. */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { tempDir } from "../testing/temp";
import { parseCcSmartDevKitConfig } from "./config";
import {
  applyProjectInit,
  type ProjectInitAnswers,
  type ProjectInitInput,
  planProjectInit,
  raisedRequires,
  requiresFloor,
  requiresFor,
} from "./init";

/**
 * A range one minor above this build's: a file that already needs a newer plugin than this
 * one. From the built-in version, so it stays newer at every release.
 */
const NEXT_MINOR = `>=${VERSION.split(".")[0]}.${Number(VERSION.split(".")[1]) + 1}`;
/** The first plugin version that accepts `worktrees` without a prefix, written by hand. */
const NO_PREFIX_MINOR = ">=0.5.2";

const ANSWERS: ProjectInitAnswers = {
  base: "dev",
  bases: { "hotfix/": "main", "release/": "main" },
  protectedBranches: ["main", "dev"],
  guards: { guardMainFolder: true, sessionNames: true, jobRoute: false },
  workflow: {},
};

/** The base (`dev`) is not the repo's default branch, so the settings file gets this line. */
const BASE_REF_NOTE =
  'base dev is not the repo\'s default branch main: .claude/settings.json gets "worktree": {"baseRef": "head"}, so a new worktree starts from the branch the session is on';

/** The engine's lines as a project pasted them from the old README, written out by hand. */
const ENGINE_CREATE = '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create';
const ENGINE_REMOVE = '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-remove';
const ENGINE_STOP = '"$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop';

function input(overrides: Partial<ProjectInitInput> = {}): ProjectInitInput {
  return {
    root: tempDir("project-init"),
    existing: null,
    existingSettings: null,
    existingLocalSettings: null,
    defaultBranch: "main",
    answers: ANSWERS,
    ...overrides,
  };
}

function fileOf(root: string): string {
  return join(root, ".claude", "cc-smart-dev-kit.json");
}

test("init preserves retired raw alert keys when active workflow answers change", () => {
  const alerts = { events: ["finished"], sound: true, usagePercent: 91 };
  const plan = planProjectInit(
    input({
      existing: JSON.stringify({ workflow: { alerts } }),
      answers: { ...ANSWERS, workflow: { allowCommit: true, alerts: { usagePercent: 92 } } },
    }),
  );
  expect(JSON.parse(plan.text).workflow).toEqual({
    allowCommit: true,
    alerts: { events: ["finished"], sound: true, usagePercent: 92 },
  });
  const unset = planProjectInit(
    input({
      existing: JSON.stringify({ workflow: { alerts } }),
      answers: { ...ANSWERS, workflow: {} },
    }),
  );
  expect(JSON.parse(unset.text).workflow).toEqual({
    alerts: { events: ["finished"], sound: true },
  });
});

describe("planProjectInit", () => {
  test("a fresh project: requires names 0.5.2, and the baseRef line", () => {
    const root = tempDir("project-init");
    const plan = planProjectInit(input({ root }));
    expect(plan.file).toBe(fileOf(root));
    expect(plan.changed).toBe(true);
    expect(plan.text).toBe(
      [
        "{",
        `  "requires": "${NO_PREFIX_MINOR}",`,
        '  "worktrees": {',
        '    "base": "dev",',
        '    "guardMainFolder": true,',
        '    "bases": {',
        '      "hotfix/": "main",',
        '      "release/": "main"',
        "    }",
        "  },",
        '  "protectedBranches": ["main", "dev"],',
        '  "sessionNames": true',
        "}",
        "",
      ].join("\n"),
    );
    expect(plan.diff).toEqual([
      `+ protectedBranches: ["main","dev"]`,
      `+ requires: "${NO_PREFIX_MINOR}"`,
      `+ sessionNames: true`,
      `+ worktrees.base: "dev"`,
      `+ worktrees.bases.hotfix/: "main"`,
      `+ worktrees.bases.release/: "main"`,
      `+ worktrees.guardMainFolder: true`,
    ]);
    expect(plan.notes).toEqual([BASE_REF_NOTE]);
    expect(plan.settings).toEqual({
      file: join(root, ".claude", "settings.json"),
      text: ["{", '  "worktree": {', '    "baseRef": "head"', "  }", "}", ""].join("\n"),
      changed: true,
      adds: ['worktree.baseRef: "head"'],
      removes: [],
      lines: ['+ worktree.baseRef: "head"'],
    });
    expect(plan.localSettings).toEqual({
      file: join(root, ".claude", "settings.local.json"),
      text: "{}\n",
      changed: false,
      adds: [],
      removes: [],
      lines: [],
    });
  });

  test("the default branch as the base needs no settings line at all", () => {
    const plan = planProjectInit(input({ answers: { ...ANSWERS, base: "main" } }));
    expect(plan.settings.changed).toBe(false);
    expect(plan.settings.adds).toEqual([]);
    expect(plan.notes).toEqual([]);
  });

  test("requires: at least 0.5.2, an older range raised, a newer one kept", () => {
    // A 0.5.0/0.5.1 plugin still requires `worktrees.prefix`: a file written without one must
    // ask for the version that made it optional, or every guard asks there.
    expect(
      planProjectInit(input({ existing: `{"requires": ">=0.5", "worktrees": {"base": "dev"}}\n` }))
        .text,
    ).toContain(`"requires": "${NO_PREFIX_MINOR}"`);
    expect(planProjectInit(input({ existing: '{"requires": ">=0.6"}' })).text).toContain(
      '"requires": ">=0.6"',
    );
    expect(planProjectInit(input({ existing: '{"requires": ">=0.5.3"}' })).text).toContain(
      '"requires": ">=0.5.3"',
    );
    expect(
      planProjectInit(
        input({
          existing: `{"requires": "${NEXT_MINOR}", "worktrees": {"base": "dev", "prefix": "app-wt-"}}\n`,
        }),
      ).text,
    ).toContain(`"requires": "${NEXT_MINOR}"`);
  });

  test("a file whose answers are unchanged: not rewritten", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify(
      {
        requires: ">=0.6",
        worktrees: {
          base: "dev",
          guardMainFolder: true,
          bases: { "hotfix/": "main", "release/": "main" },
        },
        protectedBranches: ["main", "dev"],
        sessionNames: true,
      },
      null,
      4,
    )}\n`;
    const settings = `${JSON.stringify({ worktree: { baseRef: "head" } }, null, 2)}\n`;
    const plan = planProjectInit(input({ root, existing, existingSettings: settings }));
    expect(plan.changed).toBe(false);
    expect(plan.diff).toEqual([]);
    expect(plan.settings.changed).toBe(false);
    expect(plan.settings.text).toBe(settings);
  });

  test("an existing file keeps every field, its indentation, and what the answers do not touch", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify(
      {
        requires: ">=0.1",
        worktrees: { base: "main" },
        autoMode: ["In my-app: never touch production."],
        ownHooks: ["git-guard"],
        instructions: true,
      },
      null,
      4,
    )}\n`;
    const plan = planProjectInit(input({ root, existing }));
    const written = JSON.parse(plan.text) as Record<string, unknown>;
    expect(written.autoMode).toEqual(["In my-app: never touch production."]);
    expect(written.ownHooks).toEqual(["git-guard"]);
    expect(written.instructions).toBe(true);
    expect(written.requires).toBe(NO_PREFIX_MINOR);
    expect(written.worktrees).toEqual({
      base: "dev",
      guardMainFolder: true,
      bases: { "hotfix/": "main", "release/": "main" },
    });
    // The file's own indentation stays.
    expect(plan.text.split("\n")[1]).toBe(`    "requires": "${NO_PREFIX_MINOR}",`);
    expect(plan.diff).toEqual([
      `+ protectedBranches: ["main","dev"]`,
      `~ requires: ">=0.1" -> "${NO_PREFIX_MINOR}"`,
      `+ sessionNames: true`,
      `~ worktrees.base: "main" -> "dev"`,
      `+ worktrees.bases.hotfix/: "main"`,
      `+ worktrees.bases.release/: "main"`,
      `+ worktrees.guardMainFolder: true`,
    ]);
    expect(plan.notes).toEqual([BASE_REF_NOTE]);
  });

  test("a field the answers leave out is taken out: no guard, no session names", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify({
      worktrees: { base: "main", guardMainFolder: true },
      sessionNames: true,
      jobs: { route: true },
    })}\n`;
    const plan = planProjectInit(
      input({
        root,
        existing,
        answers: {
          ...ANSWERS,
          bases: {},
          protectedBranches: [],
          guards: { guardMainFolder: false, sessionNames: false, jobRoute: false },
        },
      }),
    );
    const written = JSON.parse(plan.text) as Record<string, unknown>;
    expect(written.worktrees).toEqual({ base: "dev" });
    expect(written).not.toHaveProperty("sessionNames");
    expect(written).not.toHaveProperty("protectedBranches");
    expect(written).not.toHaveProperty("jobs");
    expect(plan.diff).toContain("- jobs.route: true");
    expect(plan.diff).toContain("- sessionNames: true");
    expect(plan.diff).toContain("- worktrees.guardMainFolder: true");
  });

  test("the job queue is a project field, and the other kinds stay", () => {
    const root = tempDir("project-init");
    const plan = planProjectInit(
      input({
        root,
        existing: `${JSON.stringify({ jobs: { kinds: { e2e: { gb: 4 } } } })}\n`,
        answers: { ...ANSWERS, guards: { ...ANSWERS.guards, jobRoute: true } },
      }),
    );
    expect((JSON.parse(plan.text) as { jobs: unknown }).jobs).toEqual({
      kinds: { e2e: { gb: 4 } },
      route: true,
    });
  });

  test("a project that is already set up adds nothing", () => {
    const root = tempDir("project-init");
    const first = planProjectInit(input({ root }));
    const plan = planProjectInit(
      input({ root, existing: first.text, existingSettings: first.settings.text }),
    );
    expect(plan.changed).toBe(false);
    expect(plan.diff).toEqual([]);
    expect(plan.settings.changed).toBe(false);
  });

  test("an existing file that is not JSON throws, naming the file", () => {
    const root = tempDir("project-init");
    expect(() => planProjectInit(input({ root, existing: "{not json" }))).toThrow(
      `${fileOf(root)} is not valid JSON`,
    );
  });

  test("a settings file that is not JSON throws, naming it: the local one too", () => {
    const root = tempDir("project-init");
    expect(() => planProjectInit(input({ root, existingLocalSettings: "{not json" }))).toThrow(
      `${join(root, ".claude", "settings.local.json")} is not valid JSON`,
    );
  });
});

describe("D20: the retired worktree engine is taken out", () => {
  test("D20: a file with only worktrees.prefix: the field goes, base is written, and the file loads", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify({ worktrees: { prefix: "app-wt-" } }, null, 2)}\n`;
    const plan = planProjectInit(input({ root, existing }));
    expect(plan.diff).toContain('- worktrees.prefix: "app-wt-"');
    expect(JSON.parse(plan.text).worktrees).toEqual({
      base: "dev",
      guardMainFolder: true,
      bases: { "hotfix/": "main", "release/": "main" },
    });
    expect(plan.notes).toEqual([
      BASE_REF_NOTE,
      "the plugin's worktree engine was retired in 1.0.0: worktrees.prefix goes, because Claude Code's own worktrees need none",
    ]);
    expect(() => parseCcSmartDevKitConfig(plan.text, plan.file)).not.toThrow();
  });

  test("D20: all three fields go, each as a - line, and every other field stays", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify({
      requires: ">=0.6",
      worktrees: {
        base: "dev",
        prefix: "app-wt-",
        setup: ["bun", "install"],
        guardMainFolder: true,
        bases: { "hotfix/": "main", "release/": "main" },
        engine: "plugin",
      },
      protectedBranches: ["main", "dev"],
      sessionNames: true,
      ownHooks: ["git-guard"],
    })}\n`;
    const plan = planProjectInit(input({ root, existing }));
    expect(plan.diff).toEqual([
      '- worktrees.engine: "plugin"',
      '- worktrees.prefix: "app-wt-"',
      '- worktrees.setup: ["bun","install"]',
    ]);
    expect(JSON.parse(plan.text)).toEqual({
      requires: ">=0.6",
      worktrees: {
        base: "dev",
        guardMainFolder: true,
        bases: { "hotfix/": "main", "release/": "main" },
      },
      protectedBranches: ["main", "dev"],
      sessionNames: true,
      ownHooks: ["git-guard"],
    });
    expect(plan.notes).toContain(
      "the plugin's worktree engine was retired in 1.0.0: worktrees.prefix, worktrees.setup, worktrees.engine go, because Claude Code's own worktrees need none",
    );
    expect(() => parseCcSmartDevKitConfig(plan.text, plan.file)).not.toThrow();
  });

  test("D20: the engine's lines go from both settings files; every other hook in the same list stays", () => {
    const root = tempDir("project-init");
    const settings = `${JSON.stringify(
      {
        permissions: { allow: ["Bash(ls:*)"] },
        hooks: {
          WorktreeCreate: [{ hooks: [{ type: "command", command: ENGINE_CREATE, timeout: 600 }] }],
          SubagentStop: [
            {
              hooks: [
                { type: "command", command: "./log-stop.sh" },
                { type: "command", command: ENGINE_STOP, timeout: 60 },
              ],
            },
          ],
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./g.sh" }] }],
        },
      },
      null,
      2,
    )}\n`;
    const local = `${JSON.stringify({
      hooks: {
        WorktreeRemove: [{ hooks: [{ type: "command", command: ENGINE_REMOVE, timeout: 60 }] }],
      },
      env: { FOO: "1" },
    })}\n`;
    const plan = planProjectInit(
      input({ root, existingSettings: settings, existingLocalSettings: local }),
    );
    expect(plan.settings.lines).toEqual([
      `- hooks.WorktreeCreate: ${ENGINE_CREATE}`,
      `- hooks.SubagentStop: ${ENGINE_STOP}`,
      '+ worktree.baseRef: "head"',
    ]);
    expect(JSON.parse(plan.settings.text)).toEqual({
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: {
        SubagentStop: [{ hooks: [{ type: "command", command: "./log-stop.sh" }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./g.sh" }] }],
      },
      worktree: { baseRef: "head" },
    });
    expect(plan.localSettings.changed).toBe(true);
    expect(plan.localSettings.lines).toEqual([`- hooks.WorktreeRemove: ${ENGINE_REMOVE}`]);
    // The `hooks` object held nothing else, so it goes with its last line.
    // The file was one line, and stays one line: the layout is the file's own.
    expect(plan.localSettings.text).toBe('{"env":{"FOO":"1"}}\n');
    expect(plan.notes).toContain(
      "the plugin's worktree engine was retired in 1.0.0: its hook lines go, because Claude Code's own worktrees need none",
    );
  });

  test("D20: an engine line with extra spaces, quotes, the bare name or the exec form is still one", () => {
    const settings = `${JSON.stringify({
      hooks: {
        WorktreeCreate: [
          {
            hooks: [
              {
                type: "command",
                command: '   "$HOME/.local/bin/cc-smart-dev-kit"   hook    worktree-create  ',
              },
            ],
          },
          { hooks: [{ type: "command", command: "cc-smart-dev-kit hook 'worktree-remove'" }] },
          {
            hooks: [
              { type: "command", command: "cc-smart-dev-kit", args: ["hook", "subagent-stop"] },
            ],
          },
          { hooks: [{ type: "command", command: "my-cc-smart-dev-kit hook worktree-create" }] },
          { hooks: [{ type: "command", command: "cc-smart-dev-kit hook notify" }] },
        ],
      },
    })}\n`;
    const plan = planProjectInit(
      input({ existingSettings: settings, answers: { ...ANSWERS, base: "main" } }),
    );
    expect(plan.settings.removes).toEqual([
      'hooks.WorktreeCreate:    "$HOME/.local/bin/cc-smart-dev-kit"   hook    worktree-create  ',
      "hooks.WorktreeCreate: cc-smart-dev-kit hook 'worktree-remove'",
      "hooks.WorktreeCreate: cc-smart-dev-kit hook subagent-stop",
    ]);
    // Another program whose name ends the same way, and the notifier, are not the engine.
    expect(JSON.parse(plan.settings.text)).toEqual({
      hooks: {
        WorktreeCreate: [
          { hooks: [{ type: "command", command: "my-cc-smart-dev-kit hook worktree-create" }] },
          { hooks: [{ type: "command", command: "cc-smart-dev-kit hook notify" }] },
        ],
      },
    });
  });

  test("D20: settings with no engine line are left exactly as they are, text and all", () => {
    const settings = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"./s.sh"}]}]}}';
    const plan = planProjectInit(
      input({
        existingSettings: settings,
        existingLocalSettings: settings,
        answers: { ...ANSWERS, base: "main" },
      }),
    );
    expect(plan.settings).toMatchObject({ changed: false, text: settings, lines: [] });
    expect(plan.localSettings).toMatchObject({ changed: false, text: settings, lines: [] });
  });
});

describe("requiresFor", () => {
  test("the plugin's own minor", () => {
    expect(requiresFor("0.4.0")).toBe(">=0.4");
    expect(requiresFor("1.2.3")).toBe(">=1.2");
  });
});

describe("raisedRequires", () => {
  // The floor is the plugin that made `worktrees.prefix` optional (0.5.2): a file without
  // that field is refused by every older plugin, so it asks for 0.5.2 or newer.
  const FLOOR = ">=0.5.2";
  const VERSION = "0.5.2";

  test("a file with no range gets the floor", () => {
    expect(raisedRequires(undefined, FLOOR, VERSION)).toBe(FLOOR);
    expect(raisedRequires(null, FLOOR, VERSION)).toBe(FLOOR);
  });

  test("a file that asks for an older plugin gets the floor", () => {
    expect(raisedRequires(">=0.1", FLOOR, VERSION)).toBe(FLOOR);
    expect(raisedRequires(">=0.5", FLOOR, VERSION)).toBe(FLOOR);
  });

  test("a file that asks for the floor or newer keeps its own range", () => {
    expect(raisedRequires(">=0.5.2", FLOOR, VERSION)).toBe(">=0.5.2");
    expect(raisedRequires(">=0.6", FLOOR, VERSION)).toBe(">=0.6");
    expect(raisedRequires(">=1.0", FLOOR, VERSION)).toBe(">=1.0");
  });

  test("a range in another shape gets the floor", () => {
    // A floor cannot be read out of "^0.5", and a range that asks for less than the floor
    // would leave the file unreadable by the plugin that runs now: the floor asks for a
    // plugin that reads the file.
    expect(raisedRequires("^0.5", FLOOR, VERSION)).toBe(FLOOR);
    expect(raisedRequires("<2", FLOOR, VERSION)).toBe(FLOOR);
    expect(raisedRequires("not a range", FLOOR, VERSION)).toBe(FLOOR);
  });

  test("a caret, tilde, exact or bounded range that already starts at the floor keeps its own shape", () => {
    // `workflow set --project` runs this on every write that needs a newer plugin: replacing
    // "~1.1.0" with ">=1.0" would lower what the project asks for.
    for (const range of ["~1.1.0", "^1.1", "1.1.0", "1.1", "=1.1.0", ">=1.1 <2", "^1.1 || ^2"]) {
      expect(raisedRequires(range, ">=1.0", "1.0.0")).toBe(range);
    }
    expect(raisedRequires("^0.9 || ^1.1", ">=1.0", "1.0.0")).toBe(">=1.0");
  });
});

describe("requiresFloor", () => {
  test("a file with no 1.0 field: the version that made `worktrees.prefix` optional", () => {
    expect(requiresFloor({ worktrees: { base: "main" } })).toEqual({
      floor: ">=0.5.2",
      version: "0.5.2",
    });
  });

  test("`worktrees.autoClean` came with 1.0.0 too (D48): a file that sets it needs >=1.0", () => {
    expect(requiresFloor({ worktrees: { base: "main", autoClean: false } })).toEqual({
      floor: ">=1.0",
      version: "1.0.0",
    });
  });

  test("an ownHooks name the 0.5.2 plugin already took leaves the floor where it is", () => {
    // Includes the retired and the unswitchable names: every plugin since 0.3.0 accepts them.
    expect(
      requiresFloor({ ownHooks: ["git-guard", "fable-session", "serena-root", "job-route"] }),
    ).toEqual({ floor: ">=0.5.2", version: "0.5.2" });
    expect(requiresFloor({ ownHooks: [] })).toEqual({ floor: ">=0.5.2", version: "0.5.2" });
  });

  test("an ownHooks that is not a list changes no floor", () => {
    expect(requiresFloor({ ownHooks: "tier-view" })).toEqual({
      floor: ">=0.5.2",
      version: "0.5.2",
    });
  });

  test("workflow.plans asks for 4.8, and plans.mergeFiles for 5.2 on its own: a cap alone keeps 4.8", () => {
    expect(requiresFloor({ workflow: { plans: { maxPhases: 5 } } })).toEqual({
      floor: ">=4.8",
      version: "4.8.0",
    });
    expect(requiresFloor({ workflow: { plans: {} } })).toEqual({
      floor: ">=4.8",
      version: "4.8.0",
    });
    expect(requiresFloor({ workflow: { plans: { maxPhases: 5, mergeFiles: ["a/"] } } })).toEqual({
      floor: ">=5.2",
      version: "5.2.0",
    });
    expect(requiresFloor({ workflow: { plans: { mergeFiles: [] } } })).toEqual({
      floor: ">=5.2",
      version: "5.2.0",
    });
  });

  test("plans.appendOnly asks for 6.3 on its own, beside a cap or a merge list", () => {
    expect(requiresFloor({ workflow: { plans: { appendOnly: ["db/migrations/"] } } })).toEqual({
      floor: ">=6.3",
      version: "6.3.0",
    });
    expect(
      requiresFloor({ workflow: { plans: { maxPhases: 5, mergeFiles: ["a/"], appendOnly: [] } } }),
    ).toEqual({ floor: ">=6.3", version: "6.3.0" });
  });

  test("allowCommit, allowPush and allowMerge ask for 6.1.0; the old names ask for nothing more", () => {
    for (const key of ["allowCommit", "allowPush", "allowMerge"]) {
      expect(requiresFloor({ workflow: { [key]: true } })).toEqual({
        floor: ">=6.1",
        version: "6.1.0",
      });
    }
    for (const key of ["autoCommit", "autoPush", "autoMerge", "openPr"]) {
      expect(requiresFloor({ workflow: { [key]: true } }).version).toBe("0.5.2");
    }
  });

  test("the plan keeps an ownHooks name of a later release, and asks for that release", () => {
    const root = tempDir("project-init");
    const existing = JSON.stringify(
      { requires: ">=1.0", worktrees: { base: "dev" }, ownHooks: ["tier-view"] },
      null,
      2,
    );
    const plan = planProjectInit(input({ root, existing }));
    expect(plan.text).toContain('"requires": ">=1.3"');
    expect(plan.text).toContain('"tier-view"');
  });

  test("the plan writes the fast check, under checks.fast, and asks for >=1.1", () => {
    const root = tempDir("project-init");
    const plan = planProjectInit(
      input({ root, answers: { ...ANSWERS, checks: { fast: "bun run typecheck && bun test" } } }),
    );
    expect(plan.text).toContain('"checks": {');
    expect(plan.text).toContain('"fast": "bun run typecheck && bun test"');
    expect(plan.text).toContain('"requires": ">=1.1"');
    expect(plan.diff).toContain('+ checks.fast: "bun run typecheck && bun test"');
    // The file the plugin that brought the field reads: valid, and not one word of it lost.
    expect(() => parseCcSmartDevKitConfig(plan.text, plan.file, "1.1.0")).not.toThrow();
  });

  test("JW1: an existing file keeps its own layout where the answers change nothing", () => {
    const root = tempDir("project-init");
    const existing = [
      "{",
      `  "requires": "${NO_PREFIX_MINOR}",`,
      '  "worktrees": { "base": "dev", "guardMainFolder": true, "bases": { "hotfix/": "main", "release/": "main" } },',
      '  "protectedBranches": ["main", "dev"],',
      '  "sessionNames": true,',
      '  "autoMode": ["one rule"]',
      "}",
      "",
    ].join("\n");
    const plan = planProjectInit(input({ root, existing, answers: ANSWERS }));
    // `autoMode` is not an answer of `project init`, so it stays exactly as it was.
    expect(plan.text).toBe(existing);
    const moved = planProjectInit(
      input({ root, existing, answers: { ...ANSWERS, protectedBranches: ["main"] } }),
    );
    expect(moved.text).toBe(existing.replace('["main", "dev"]', '["main"]'));
  });

  test("the fast check: `null` takes the field out; no answer at all leaves the file's own", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify({ checks: { fast: "bun run check" }, worktrees: { base: "dev" } })}\n`;
    // The portal's form does not show the field: `undefined` must not remove what a person wrote.
    const kept = planProjectInit(input({ root, existing, answers: ANSWERS }));
    expect(JSON.parse(kept.text)).toMatchObject({
      checks: { fast: "bun run check" },
      requires: ">=1.1",
    });
    const removed = planProjectInit(
      input({ root, existing, answers: { ...ANSWERS, checks: null } }),
    );
    expect(removed.text).not.toContain('"checks"');
    expect(removed.diff).toContain('- checks.fast: "bun run check"');
  });

  test("deploy commands: written under tasks.deployCommands, and requires rises to the guard's release", () => {
    const root = tempDir("project-init");
    const plan = planProjectInit(
      input({
        root,
        answers: { ...ANSWERS, deployCommands: { prod: ["vercel --prod", { script: "ship" }] } },
      }),
    );
    expect(JSON.parse(plan.text)).toMatchObject({
      requires: ">=5.3",
      tasks: { deployCommands: { prod: ["vercel --prod", { script: "ship" }] } },
    });
    expect(plan.diff).toContain('+ tasks.deployCommands.prod: ["vercel --prod",{"script":"ship"}]');
  });

  test("deploy commands: no list takes the field out, and a tasks object it empties; undefined leaves the file's own", () => {
    const root = tempDir("project-init");
    const own = { prod: ["vercel --prod"] };
    const existing = `${JSON.stringify({ requires: ">=5.3", tasks: { deployCommands: own }, worktrees: { base: "dev" } })}\n`;
    const kept = planProjectInit(input({ root, existing, answers: ANSWERS }));
    expect(JSON.parse(kept.text).tasks).toEqual({ deployCommands: own });
    for (const none of [{}, { prod: [] }]) {
      const removed = planProjectInit(
        input({ root, existing, answers: { ...ANSWERS, deployCommands: none } }),
      );
      expect(JSON.parse(removed.text)).not.toHaveProperty("tasks");
      expect(removed.diff).toContain('- tasks.deployCommands.prod: ["vercel --prod"]');
    }
    // Another tasks field stays when only the commands go.
    const withStale = `${JSON.stringify({ tasks: { staleDays: 7, deployCommands: own }, worktrees: { base: "dev" } })}\n`;
    const trimmed = planProjectInit(
      input({ root, existing: withStale, answers: { ...ANSWERS, deployCommands: {} } }),
    );
    expect(JSON.parse(trimmed.text).tasks).toEqual({ staleDays: 7 });
  });

  test("deploy commands: no answer and none in the file leaves tasks out", () => {
    const plan = planProjectInit(input({ answers: { ...ANSWERS, deployCommands: {} } }));
    expect(JSON.parse(plan.text)).not.toHaveProperty("tasks");
  });

  test("deploy commands: an environment outside tasks.envs is refused, naming the field", () => {
    const existing = `${JSON.stringify({ tasks: { envs: ["prod"] }, worktrees: { base: "dev" } })}\n`;
    expect(() =>
      planProjectInit(
        input({ existing, answers: { ...ANSWERS, deployCommands: { staging: ["x --stage"] } } }),
      ),
    ).toThrow("tasks.envs");
  });
});

describe("applyProjectInit", () => {
  test("it writes the file, with a backup", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    const plan = planProjectInit(input({ root }));
    const writes = applyProjectInit(plan, { stateDir });
    expect(writes.map((write) => write.file)).toEqual([plan.file, plan.settings.file]);
    expect(writes.every((write) => write.created && write.backup !== null)).toBe(true);
    expect(readFileSync(plan.file, "utf8")).toBe(plan.text);
    expect(readFileSync(plan.settings.file, "utf8")).toBe(plan.settings.text);
    for (const write of writes) {
      expect(existsSync(write.backup ?? "")).toBe(true);
    }
  });

  test("D20: the local settings file is written too when an engine line goes, with a backup", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    mkdirSync(join(root, ".claude"), { recursive: true });
    const local = join(root, ".claude", "settings.local.json");
    const before = `${JSON.stringify({
      hooks: { WorktreeRemove: [{ hooks: [{ type: "command", command: ENGINE_REMOVE }] }] },
    })}\n`;
    writeFileSync(local, before);
    const plan = planProjectInit(
      input({ root, existingLocalSettings: before, answers: { ...ANSWERS, base: "main" } }),
    );
    const writes = applyProjectInit(plan, { stateDir });
    expect(writes.map((write) => [write.file, write.created])).toEqual([
      [plan.file, true],
      [local, false],
    ]);
    expect(readFileSync(local, "utf8")).toBe("{}\n");
    const backup = writes[1]?.backup ?? "";
    expect(readFileSync(backup, "utf8")).toBe(before);
  });

  test("a file that is already what the plan says is not written", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    const plan = planProjectInit(input({ root }));
    applyProjectInit(plan, { stateDir });
    const again = planProjectInit(
      input({
        root,
        existing: readFileSync(plan.file, "utf8"),
        existingSettings: readFileSync(plan.settings.file, "utf8"),
      }),
    );
    expect(applyProjectInit(again, { stateDir })).toEqual([]);
  });

  test("a symlinked project file keeps its link: the target gets the change", () => {
    // A `.claude/cc-smart-dev-kit.json` linked into a dotfiles repo is a person's own file: an
    // atomic write straight at the link would replace it with a plain file, and the link would
    // be gone (the managed writers follow the link; this one did too little at first).
    const root = tempDir("project-init");
    const target = join(tempDir("dotfiles"), "cc-smart-dev-kit.json");
    writeFileSync(target, "{}\n");
    mkdirSync(join(root, ".claude"), { recursive: true });
    const file = fileOf(root);
    symlinkSync(target, file);

    const plan = planProjectInit(input({ root, existing: "{}\n" }));
    expect(plan.changed).toBe(true);
    const writes = applyProjectInit(plan, { stateDir: tempDir("project-init-state") });
    expect(writes.some((write) => write.file === file)).toBe(true);

    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(plan.text);
  });

  test("a dry run writes nothing", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    const plan = planProjectInit(input({ root }));
    const writes = applyProjectInit(plan, { stateDir, dryRun: true });
    expect(writes).toEqual([
      { file: plan.file, created: true, backup: null },
      { file: plan.settings.file, created: true, backup: null },
    ]);
    expect(existsSync(plan.file)).toBe(false);
  });

  test("an existing file's own mode stays", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    const first = planProjectInit(input({ root }));
    applyProjectInit(first, { stateDir });
    const plan = planProjectInit(
      input({
        root,
        existing: '{"worktrees": {"base": "main"}}\n',
        existingSettings: readFileSync(join(root, ".claude", "settings.json"), "utf8"),
      }),
    );
    const writes = applyProjectInit(plan, { stateDir });
    expect(writes.map((write) => write.created)).toEqual([false]);
  });
});

describe("the checks field's schema and messages", () => {
  const file = ".claude/cc-smart-dev-kit.json";

  test("a fast check is one command, and a file that sets it reads", () => {
    expect(
      parseCcSmartDevKitConfig(
        JSON.stringify({ checks: { fast: "bun run typecheck && bun test src/changed" } }),
        file,
        "1.1.0",
      ).checks,
    ).toEqual({ fast: "bun run typecheck && bun test src/changed" });
  });

  test("`checks` is an object with `fast` in it: an empty one, a blank command and an unknown key are refused", () => {
    const refused = (checks: unknown): string => {
      try {
        parseCcSmartDevKitConfig(JSON.stringify({ checks }), file, "1.1.0");
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    expect(refused({})).toContain("checks.fast:");
    expect(refused({ fast: "   " })).toContain("checks.fast:");
    expect(refused({ fast: "bun run check", full: "bun run check" })).toContain(
      "checks.full: unknown field (a newer cc-smart-dev-kit may be needed)",
    );
    expect(refused("bun run check")).toContain("checks:");
  });

  test("an older plugin hears update the plugin, not unknown field", () => {
    expect(() =>
      parseCcSmartDevKitConfig(
        JSON.stringify({ requires: ">=1.1", checks: { fast: "bun run check" } }),
        file,
        "1.0.1",
      ),
    ).toThrow("this project needs cc-smart-dev-kit >=1.1; you have 1.0.1");
  });
});

describe("the deploy tasks floor and the ignored task fields", () => {
  const withTasks = (tasks: Record<string, unknown>) =>
    JSON.stringify({ requires: ">=1.10", worktrees: { base: "dev" }, tasks }, null, 2);

  test("the ignored task fields are deleted, each as a - line, and a note says why", () => {
    const plan = planProjectInit(
      input({
        existing: withTasks({
          dir: "work",
          releaseBranch: "main",
          legacyFolders: ["notes/old"],
        }),
      }),
    );
    expect(JSON.parse(plan.text).tasks).toEqual({ dir: "work" });
    expect(plan.diff).toContain('- tasks.releaseBranch: "main"');
    expect(plan.diff).toContain('- tasks.legacyFolders: ["notes/old"]');
    expect(plan.notes).toContain(
      "tasks.releaseBranch, tasks.legacyFolders are read by nothing since 5.0.0, so they go",
    );
  });

  test("a tasks object the removal empties goes too; one the project wrote empty stays", () => {
    const emptied = planProjectInit(input({ existing: withTasks({ releaseBranch: "main" }) }));
    expect(JSON.parse(emptied.text)).not.toHaveProperty("tasks");
    expect(emptied.diff).toContain('- tasks.releaseBranch: "main"');
    const own = planProjectInit(input({ existing: withTasks({}) }));
    expect(JSON.parse(own.text).tasks).toEqual({});
  });

  test("a file with no ignored field gets no note and no tasks change", () => {
    const plan = planProjectInit(input({ existing: withTasks({ staleDays: 10 }) }));
    expect(JSON.parse(plan.text).tasks).toEqual({ staleDays: 10 });
    expect(plan.notes.join("\n")).not.toContain("read by nothing");
  });

  test("requires is raised to >=5.0 when a prod or staging folder exists under tasks.dir", () => {
    for (const env of ["prod", "staging"]) {
      const root = tempDir("project-init");
      mkdirSync(join(root, ".claude", "tasks", env), { recursive: true });
      const plan = planProjectInit(input({ root, existing: '{"requires": ">=1.10"}' }));
      expect(JSON.parse(plan.text).requires).toBe(">=5.0");
    }
    const root = tempDir("project-init");
    mkdirSync(join(root, "ops", "prod"), { recursive: true });
    const plan = planProjectInit(
      input({ root, existing: '{"requires": ">=1.10", "tasks": {"dir": "ops"}}' }),
    );
    expect(JSON.parse(plan.text).requires).toBe(">=5.0");
  });

  test("no deploy folder and no block: requires stays where it is", () => {
    const root = tempDir("project-init");
    mkdirSync(join(root, ".claude", "tasks"), { recursive: true });
    const plan = planProjectInit(input({ root, existing: null }));
    expect(JSON.parse(plan.text).requires).toBe(NO_PREFIX_MINOR);
  });

  test("the deploy block raises requires, and a newer range is never lowered", () => {
    const raised = planProjectInit(input({ existing: '{"requires": ">=1.10"}' }), {
      deployBlock: true,
    });
    expect(JSON.parse(raised.text).requires).toBe(">=5.0");
    expect(raised.diff).toContain('~ requires: ">=1.10" -> ">=5.0"');
    const kept = planProjectInit(input({ existing: '{"requires": ">=5.2"}' }), {
      deployBlock: true,
    });
    expect(JSON.parse(kept.text).requires).toBe(">=5.2");
  });

  test("a tasks.dir that leaves the checkout is refused by the schema, not read as a folder", () => {
    expect(() => planProjectInit(input({ existing: withTasks({ dir: "../elsewhere" }) }))).toThrow(
      "tasks.dir",
    );
  });

  test("requiresFloor: deployTasks asks for 5.0.0, and the option alone changes nothing else", () => {
    expect(requiresFloor({}, { deployTasks: true })).toEqual({ floor: ">=5.0", version: "5.0.0" });
    expect(requiresFloor({})).toEqual({ floor: ">=0.5.2", version: "0.5.2" });
  });
});
