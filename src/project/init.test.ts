/** `project init`: the plan it makes, and the file `applyProjectInit` writes. */
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

function input(overrides: Partial<ProjectInitInput> = {}): ProjectInitInput {
  return {
    root: tempDir("project-init"),
    existing: null,
    existingSettings: null,
    defaultBranch: "main",
    answers: ANSWERS,
    ...overrides,
  };
}

function fileOf(root: string): string {
  return join(root, ".claude", "cc-smart-dev-kit.json");
}

describe("planProjectInit", () => {
  test("a fresh project: no prefix, so requires names 0.5.2, and the baseRef line", () => {
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
    expect(plan.settingsFile).toBe(join(root, ".claude", "settings.json"));
    expect(plan.settingsChanged).toBe(true);
    expect(plan.settingsAdds).toEqual(['worktree.baseRef: "head"']);
    expect(plan.settingsText).toBe(
      ["{", '  "worktree": {', '    "baseRef": "head"', "  }", "}", ""].join("\n"),
    );
  });

  test("the default branch as the base needs no settings line at all", () => {
    const plan = planProjectInit(input({ answers: { ...ANSWERS, base: "main" } }));
    expect(plan.settingsChanged).toBe(false);
    expect(plan.settingsAdds).toEqual([]);
    expect(plan.notes).toEqual([]);
  });

  test("no prefix needs at least 0.5.2; a kept prefix keeps the plugin's minor", () => {
    // A 0.5.0/0.5.1 plugin still requires `worktrees.prefix`: a file written without one
    // must ask for the version that made it optional, or every guard asks there. The file's
    // own range is an older minor's, written by hand: it must not depend on this plugin's.
    const noPrefix = planProjectInit(
      input({ existing: `{"requires": ">=0.5", "worktrees": {"base": "dev"}}\n` }),
    );
    expect(noPrefix.text).toContain(`"requires": "${NO_PREFIX_MINOR}"`);
    const withPrefix = planProjectInit(
      input({
        existing: `{"requires": ">=0.1", "worktrees": {"base": "dev", "prefix": "app-wt-"}}\n`,
      }),
    );
    expect(withPrefix.text).toContain(`"requires": "${THIS_MINOR}"`);
    // A file that already needs a newer plugin keeps its range, prefix or not.
    expect(planProjectInit(input({ existing: '{"requires": ">=0.6"}' })).text).toContain(
      '"requires": ">=0.6"',
    );
    expect(planProjectInit(input({ existing: '{"requires": ">=0.5.3"}' })).text).toContain(
      '"requires": ">=0.5.3"',
    );
    expect(
      planProjectInit(
        input({
          existing: '{"requires": ">=0.6", "worktrees": {"base": "dev", "prefix": "app-wt-"}}\n',
        }),
      ).text,
    ).toContain('"requires": ">=0.6"');
  });

  test("a file with the engine's fields, its answers unchanged and this minor's range: not rewritten", () => {
    // Its range is this plugin's own minor: an older one is raised to it (the test above), so a
    // hand-written ">=0.5" would stop being "unchanged" at every minor release.
    const root = tempDir("project-init");
    const existing = `${JSON.stringify(
      {
        requires: THIS_MINOR,
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
      },
      null,
      4,
    )}\n`;
    const settings = `${JSON.stringify({ worktree: { baseRef: "head" } }, null, 2)}\n`;
    const plan = planProjectInit(input({ root, existing, existingSettings: settings }));
    expect(plan.changed).toBe(false);
    expect(plan.diff).toEqual([]);
    expect(plan.settingsChanged).toBe(false);
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
    // The deprecated engine fields the file already has stay exactly as they are: the project
    // keeps working until the engine retires, and `doctor` names the move.
    expect(written.worktrees).toEqual({
      base: "dev",
      prefix: "app-wt-",
      setup: ["npm", "ci"],
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
    ]);
    expect(plan.notes).toEqual([
      BASE_REF_NOTE,
      "the project's file still sets worktrees.prefix, worktrees.setup, worktrees.engine: the worktree engine is deprecated and retires in the next minor version; `cc-smart-dev-kit doctor` names the steps to move",
    ]);
  });

  test("a field the answers leave out is taken out: no guard, no session names", () => {
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
          bases: {},
          protectedBranches: [],
          guards: { guardMainFolder: false, sessionNames: false, jobRoute: false },
        },
      }),
    );
    const written = JSON.parse(plan.text) as Record<string, unknown>;
    // What the answers manage goes; the deprecated fields stay as they were.
    expect(written.worktrees).toEqual({
      base: "dev",
      prefix: "app-wt-",
      setup: ["bun", "install"],
    });
    expect(written).not.toHaveProperty("sessionNames");
    expect(written).not.toHaveProperty("protectedBranches");
    expect(written).not.toHaveProperty("jobs");
    expect(plan.diff).toContain("- jobs.route: true");
    expect(plan.diff).toContain("- sessionNames: true");
    expect(plan.diff).toContain("- worktrees.guardMainFolder: true");
    expect(plan.notes).toEqual([
      BASE_REF_NOTE,
      "the project's file still sets worktrees.prefix, worktrees.setup: the worktree engine is deprecated and retires in the next minor version; `cc-smart-dev-kit doctor` names the steps to move",
    ]);
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
  test("it writes the file, with a backup", () => {
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
      { file: plan.settingsFile, created: true, backup: null },
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
        existing: '{"worktrees": {"base": "main", "prefix": "a-wt-"}}\n',
        existingSettings: readFileSync(join(root, ".claude", "settings.json"), "utf8"),
      }),
    );
    const writes = applyProjectInit(plan, { stateDir });
    expect(writes.map((write) => write.created)).toEqual([false]);
  });
});
