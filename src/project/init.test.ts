/** `project init`: the plan it makes, and the two files `applyProjectInit` writes. */
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
import {
  applyProjectInit,
  type ProjectInitAnswers,
  type ProjectInitInput,
  planProjectInit,
  requiresFor,
} from "./init";

/** The minor this build's `requires` asks for, written by hand from the built-in version. */
const THIS_MINOR = `>=${VERSION.split(".").slice(0, 2).join(".")}`;

const ANSWERS: ProjectInitAnswers = {
  base: "dev",
  prefix: "app-wt-",
  setup: ["bun", "install"],
  bases: { "hotfix/": "main", "release/": "main" },
  protectedBranches: ["main", "dev"],
  guards: { guardMainFolder: true, sessionNames: true, jobRoute: false },
  engine: "plugin",
  workflow: {},
};

function input(overrides: Partial<ProjectInitInput> = {}): ProjectInitInput {
  return {
    root: tempDir("project-init"),
    existing: null,
    existingSettings: null,
    answers: ANSWERS,
    ...overrides,
  };
}

function fileOf(root: string): string {
  return join(root, ".claude", "cc-smart-dev-kit.json");
}

describe("planProjectInit", () => {
  test("a fresh project: the file, every change, and the engine's three lines", () => {
    const root = tempDir("project-init");
    const plan = planProjectInit(input({ root }));
    expect(plan.file).toBe(fileOf(root));
    expect(plan.changed).toBe(true);
    expect(plan.text).toBe(
      [
        "{",
        `  "requires": "${THIS_MINOR}",`,
        '  "worktrees": {',
        '    "base": "dev",',
        '    "prefix": "app-wt-",',
        '    "setup": [',
        '      "bun",',
        '      "install"',
        "    ],",
        '    "guardMainFolder": true,',
        '    "bases": {',
        '      "hotfix/": "main",',
        '      "release/": "main"',
        "    },",
        '    "engine": "plugin"',
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
      `+ requires: "${THIS_MINOR}"`,
      `+ sessionNames: true`,
      `+ worktrees.base: "dev"`,
      `+ worktrees.bases.hotfix/: "main"`,
      `+ worktrees.bases.release/: "main"`,
      `+ worktrees.engine: "plugin"`,
      `+ worktrees.guardMainFolder: true`,
      `+ worktrees.prefix: "app-wt-"`,
      `+ worktrees.setup: ["bun","install"]`,
    ]);
    expect(plan.settingsFile).toBe(join(root, ".claude", "settings.json"));
    expect(plan.settingsChanged).toBe(true);
    expect(plan.hookLines).toEqual([
      'WorktreeCreate: "$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create (timeout 600 s)',
      'WorktreeRemove: "$HOME/.local/bin/cc-smart-dev-kit" hook worktree-remove (timeout 60 s)',
      'SubagentStop: "$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop (timeout 60 s)',
    ]);
    expect(JSON.parse(plan.settingsText)).toEqual({
      hooks: {
        WorktreeCreate: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create',
                timeout: 600,
              },
            ],
          },
        ],
        WorktreeRemove: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-remove',
                timeout: 60,
              },
            ],
          },
        ],
        SubagentStop: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop',
                timeout: 60,
              },
            ],
          },
        ],
      },
    });
    expect(plan.notes).toEqual([]);
  });

  test("an existing file keeps every field, its indentation, and what the answers do not touch", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify(
      {
        requires: ">=0.1",
        worktrees: { base: "main", prefix: "app-wt-", setup: ["npm", "ci"], engine: "plugin" },
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
    expect(written.requires).toBe(THIS_MINOR);
    expect(written.worktrees).toEqual({
      base: "dev",
      prefix: "app-wt-",
      setup: ["bun", "install"],
      guardMainFolder: true,
      bases: { "hotfix/": "main", "release/": "main" },
      engine: "plugin",
    });
    // The file's own indentation stays.
    expect(plan.text.split("\n")[1]).toBe(`    "requires": "${THIS_MINOR}",`);
    expect(plan.diff).toEqual([
      `+ protectedBranches: ["main","dev"]`,
      `~ requires: ">=0.1" -> "${THIS_MINOR}"`,
      `+ sessionNames: true`,
      `~ worktrees.base: "main" -> "dev"`,
      `+ worktrees.bases.hotfix/: "main"`,
      `+ worktrees.bases.release/: "main"`,
      `+ worktrees.guardMainFolder: true`,
      `~ worktrees.setup: ["npm","ci"] -> ["bun","install"]`,
    ]);
  });

  test("a field the answers leave out is taken out: no setup, no guard", () => {
    const root = tempDir("project-init");
    const existing = `${JSON.stringify({
      worktrees: {
        base: "main",
        prefix: "app-wt-",
        setup: ["bun", "install"],
        guardMainFolder: true,
      },
      sessionNames: true,
      jobs: { route: true },
    })}\n`;
    const plan = planProjectInit(
      input({
        root,
        existing,
        answers: {
          ...ANSWERS,
          setup: null,
          bases: {},
          protectedBranches: [],
          guards: { guardMainFolder: false, sessionNames: false, jobRoute: false },
        },
      }),
    );
    const written = JSON.parse(plan.text) as Record<string, unknown>;
    expect(written.worktrees).toEqual({ base: "dev", prefix: "app-wt-", engine: "plugin" });
    expect(written).not.toHaveProperty("sessionNames");
    expect(written).not.toHaveProperty("protectedBranches");
    expect(written).not.toHaveProperty("jobs");
    expect(plan.diff).toContain("- jobs.route: true");
    expect(plan.diff).toContain("- sessionNames: true");
    expect(plan.diff).toContain("- worktrees.guardMainFolder: true");
    expect(plan.diff).toContain('- worktrees.setup: ["bun","install"]');
    expect(plan.notes).toEqual(["no setup command: a new worktree gets no dependencies installed"]);
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

  test("an engine of the project's own: no hook lines, and a note saying so", () => {
    const root = tempDir("project-init");
    const settings =
      '{\n  "hooks": { "WorktreeCreate": [{ "hooks": [{ "type": "command", "command": "./mine" }] }] }\n}\n';
    const plan = planProjectInit(
      input({ root, existingSettings: settings, answers: { ...ANSWERS, engine: "own" } }),
    );
    expect(plan.settingsChanged).toBe(false);
    expect(plan.hookLines).toEqual([]);
    // Nothing is written, so the settings file keeps its own text; the plan's copy is only shown.
    expect(JSON.parse(plan.settingsText)).toEqual(JSON.parse(settings));
    expect(plan.notes).toEqual([
      'engine "own": no cc-smart-dev-kit hook lines are added to .claude/settings.json — your own engine makes this project\'s worktrees; `cc-smart-dev-kit doctor` expects none',
    ]);
    expect((JSON.parse(plan.text) as { worktrees: { engine: string } }).worktrees.engine).toBe(
      "own",
    );
  });

  test("plugin, then an engine of the project's own: the plugin's lines are taken back out", () => {
    const root = tempDir("project-init");
    const settingsFile = join(root, ".claude", "settings.json");
    // What an earlier `project init` left behind: the engine's three lines, beside a hook the
    // project wired itself.
    const first = planProjectInit(input({ root }));
    const afterFirst = planProjectInit(
      input({ root, existingSettings: first.settingsText }),
    ).settingsText;
    const withTheirOwn = `${JSON.stringify(
      { ...JSON.parse(afterFirst), theirHook: { kept: true } },
      null,
      2,
    )}\n`;
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsFile, withTheirOwn);

    // The person switches to an engine of the project's own.
    const own = planProjectInit(
      input({ root, existingSettings: withTheirOwn, answers: { ...ANSWERS, engine: "own" } }),
    );
    // The command exactly as the file wires it, timeout and all: the same shape the added
    // lines are reported in.
    expect(own.removedLines).toEqual([
      'WorktreeCreate: "$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create (timeout 600 s)',
      'WorktreeRemove: "$HOME/.local/bin/cc-smart-dev-kit" hook worktree-remove (timeout 60 s)',
      'SubagentStop: "$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop (timeout 60 s)',
    ]);
    expect(own.hookLines).toEqual([]);
    expect(own.settingsChanged).toBe(true);
    // Their own key, and every hook the project wired for itself, are left exactly as they
    // were: only a group that is entirely ours goes.
    const written = JSON.parse(own.settingsText) as Record<string, unknown>;
    expect(written.theirHook).toEqual({ kept: true });
    expect(own.settingsText).not.toContain("cc-smart-dev-kit hook");
    expect(own.notes[0]).toContain("two engines answer each worktree request");

    // And back to the plugin's engine: the three lines are added again, in full.
    const back = planProjectInit(
      input({ root, existingSettings: own.settingsText, answers: { ...ANSWERS } }),
    );
    expect(back.hookLines.length).toBe(3);
    expect(back.removedLines).toEqual([]);
    expect(back.settingsChanged).toBe(true);
    expect(back.settingsText).toContain("hook worktree-create");
    expect(back.settingsText).toContain('"theirHook"');
  });

  test("a project's own hooks in the settings file stay, and ours is added after them", () => {
    const root = tempDir("project-init");
    const settings = `${JSON.stringify(
      {
        hooks: {
          WorktreeCreate: [{ hooks: [{ type: "command", command: "./make-worktree.sh" }] }],
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }],
        },
      },
      null,
      2,
    )}\n`;
    const plan = planProjectInit(input({ root, existingSettings: settings }));
    const merged = JSON.parse(plan.settingsText) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(merged.hooks.WorktreeCreate?.[0]?.hooks[0]?.command).toBe("./make-worktree.sh");
    expect(merged.hooks.WorktreeCreate?.[1]?.hooks[0]?.command).toBe(
      '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create',
    );
    expect(merged.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe("./guard.sh");
    expect(plan.hookLines).toHaveLength(3);
  });

  test("a project that already wires the engine adds nothing", () => {
    const root = tempDir("project-init");
    const first = planProjectInit(input({ root }));
    const plan = planProjectInit(
      input({ root, existing: first.text, existingSettings: first.settingsText }),
    );
    expect(plan.changed).toBe(false);
    expect(plan.diff).toEqual([]);
    expect(plan.settingsChanged).toBe(false);
  });

  test("an existing file that is not JSON throws, naming the file", () => {
    const root = tempDir("project-init");
    expect(() => planProjectInit(input({ root, existing: "{not json" }))).toThrow(
      `${fileOf(root)} is not valid JSON`,
    );
  });
});

describe("requiresFor", () => {
  test("the plugin's own minor", () => {
    expect(requiresFor("0.4.0")).toBe(">=0.4");
    expect(requiresFor("1.2.3")).toBe(">=1.2");
  });
});

describe("applyProjectInit", () => {
  test("it writes both files, with a backup of each", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    const plan = planProjectInit(input({ root }));
    const writes = applyProjectInit(plan, { stateDir });
    expect(writes.map((write) => write.file)).toEqual([plan.file, plan.settingsFile]);
    expect(writes.every((write) => write.created && write.backup !== null)).toBe(true);
    expect(readFileSync(plan.file, "utf8")).toBe(plan.text);
    expect(readFileSync(plan.settingsFile, "utf8")).toBe(plan.settingsText);
    for (const write of writes) {
      expect(existsSync(write.backup ?? "")).toBe(true);
    }
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
        existingSettings: readFileSync(plan.settingsFile, "utf8"),
      }),
    );
    expect(applyProjectInit(again, { stateDir })).toEqual([]);
  });

  test("a symlinked project file keeps its link: the target gets the change", () => {
    // A `.claude/settings.json` linked into a dotfiles repo is a person's own file: an atomic
    // write straight at the link would replace it with a plain file, and the link would be
    // gone (the managed writers follow the link; these two did not).
    const root = tempDir("project-init");
    const target = join(tempDir("dotfiles"), "settings.json");
    writeFileSync(target, "{}\n");
    mkdirSync(join(root, ".claude"), { recursive: true });
    const settingsFile = join(root, ".claude", "settings.json");
    symlinkSync(target, settingsFile);

    const plan = planProjectInit(input({ root, existingSettings: "{}\n" }));
    expect(plan.settingsChanged).toBe(true);
    const writes = applyProjectInit(plan, { stateDir: tempDir("project-init-state") });
    expect(writes.some((write) => write.file === settingsFile)).toBe(true);

    expect(lstatSync(settingsFile).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(plan.settingsText);
  });

  test("a dry run writes nothing", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    const plan = planProjectInit(input({ root }));
    const writes = applyProjectInit(plan, { stateDir, dryRun: true });
    expect(writes).toEqual([
      { file: plan.file, created: true, backup: null },
      { file: plan.settingsFile, created: true, backup: null },
    ]);
    expect(existsSync(plan.file)).toBe(false);
    expect(existsSync(plan.settingsFile)).toBe(false);
  });

  test("an existing file's own mode stays", () => {
    const root = tempDir("project-init");
    const stateDir = tempDir("project-init-state");
    const first = planProjectInit(input({ root }));
    applyProjectInit(first, { stateDir });
    writeFileSync(join(root, ".claude", "settings.json"), first.settingsText);
    const plan = planProjectInit(
      input({
        root,
        existing: '{"worktrees": {"base": "main", "prefix": "a-wt-"}}\n',
        existingSettings: first.settingsText,
      }),
    );
    const writes = applyProjectInit(plan, { stateDir });
    expect(writes.map((write) => write.created)).toEqual([false]);
  });
});
