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
        '  "protectedBranches": [',
        '    "main",',
        '    "dev"',
        "  ],",
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
    expect(plan.localSettings.text).toBe('{\n  "env": {\n    "FOO": "1"\n  }\n}\n');
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
  });
});

describe("requiresFloor", () => {
  test("a file with no 1.0 field: the version that made `worktrees.prefix` optional", () => {
    expect(requiresFloor({ worktrees: { base: "main" } })).toEqual({
      floor: ">=0.5.2",
      version: "0.5.2",
    });
  });

  test("a file with a field that came with 1.0.0: the release that brought it", () => {
    // An older plugin reads the file strictly, does not know the field, and refuses the
    // whole file — so every guard in that project fails closed until it is updated.
    expect(requiresFloor({ workflow: { workers: { enabled: true } } })).toEqual({
      floor: ">=1.0",
      version: "1.0.0",
    });
    expect(requiresFloor({ workflow: { fixesAfterReview: { lines: 200 } } })).toEqual({
      floor: ">=1.0",
      version: "1.0.0",
    });
  });

  test("the plan asks for what its own fields need", () => {
    const root = tempDir("project-init");
    const plan = planProjectInit(
      input({ root, answers: { ...ANSWERS, workflow: { workers: { enabled: true } } } }),
    );
    expect(plan.text).toContain('"requires": ">=1.0"');
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
