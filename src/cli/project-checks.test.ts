/** `doctor`'s checks of the project in the folder it runs in (`project-checks.ts`). */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { deployBlockBody } from "../project/deploy-block";
import { BLOCK_BEGIN, BLOCK_END } from "../setup/managed-markdown";
import { createDeployTask } from "../tasks/deploy/files";
import { fakeGh } from "../testing/fake-gh";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir, withGitVersion } from "../testing/temp";
import type { Check } from "./check";
import { checkLine } from "./doctor";
import { cliPaths } from "./paths";
import { projectChecks, projectTaskChecks, renamedCommand } from "./project-checks";

const PLUGIN_HOOKS = join(import.meta.dir, "..", "..", "plugin", "hooks", "hooks.json");
const NOT_IGNORED =
  "project: .claude/worktrees/ is not git-ignored here, so Claude Code's own worktrees show up in git status: add \".claude/worktrees/\" to the repo's .gitignore and commit it";

/** The retired engine's three lines, as its old README had a project paste them: by hand. */
const ENGINE_HOOKS: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> = {
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
};

/** The doctor line for leftover engine lines in one settings file, written out by hand. */
const engineLine = (file: string, names: string[]) =>
  `✗ project: ${file} still runs ${names.map((name) => `cc-smart-dev-kit hook ${name}`).join(", ")}, retired with the plugin's worktree engine in 1.0.0, so ${names.length === 1 ? "it fails" : "each of them fails"} every time (Claude Code's own worktrees need no hook) Fix: cc-smart-dev-kit project init (it takes ${names.length === 1 ? "the line" : "those lines"} out)`;

/**
 * `gh` for `projectChecks`: GitHub Issues are on by default, so every call gets a fake and no
 * test can start the real `gh`.
 */
const fakeGhExec = () => fakeGh().exec;

/**
 * The default-on issues switch adds one `· issues:` line to a repository with no origin. The tests
 * that match whole reports are about the other lines, so they drop it; the issues line has its own
 * test at the end of this file.
 */
const notIssuesLine = (line: Check) =>
  !(line.text.startsWith("issues:") && line.ok && line.info === true);

async function check(repo: string, env = hookEnv(), hooksFile = PLUGIN_HOOKS) {
  return (await projectChecks(repo, env, cliPaths(env), hooksFile, fakeGhExec()))
    .filter(notIssuesLine)
    .map(checkLine);
}

/** The repo ignores `.claude/worktrees/`, where Claude Code makes its worktrees. */
function ignoreWorktrees(repo: string): void {
  writeFileSync(join(repo, ".gitignore"), ".claude/worktrees/\n");
}

/** The project's settings with some of the retired engine's lines, and any other hooks. */
function wireOnly(repo: string, events: string[], extra: Record<string, unknown> = {}): void {
  writeClaudeFile(repo, "settings.json", {
    hooks: { ...Object.fromEntries(events.map((event) => [event, ENGINE_HOOKS[event]])), ...extra },
  });
}

describe("shadcn lint restrictions", () => {
  const note =
    "· project: . uses shadcn/ui without a lint rule against raw HTML controls Fix: add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices";

  test("no components.json: nothing", async () => {
    expect(await check(makeRepo())).toEqual([]);
  });

  test("components.json without a linter config: an info line", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    expect(await check(repo)).toEqual([note]);
  });

  test.each(["biome.json", "biome.jsonc"])("%s with elements: nothing", async (file) => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(
      join(repo, file),
      JSON.stringify({
        linter: {
          rules: {
            correctness: {
              noRestrictedElements: {
                level: "error",
                options: { elements: { button: "Use Button" } },
              },
            },
          },
        },
      }),
    );
    expect(await check(repo)).toEqual([]);
  });

  test("a Biome rule without elements: the info line", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(
      join(repo, "biome.json"),
      '{"linter":{"rules":{"correctness":{"noRestrictedElements":"error"}}}}',
    );
    expect(await check(repo)).toEqual([note]);
  });

  test("JSONC comments and trailing commas preserve strings and override rules", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(
      join(repo, "biome.jsonc"),
      `{
        // The URL and comment-like text are strings, not comments.
        "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
        "overrides": [{ /* app code */
          "includes": ["**"],
          "linter": {"rules": {"correctness": {
            "noRestrictedElements": {"level": "error", "options": {
              "elements": {"button": "Use Button /* here */, } and \\"quotes\\"",},
            }},
          }}},
        },],
      }`,
    );
    expect(await check(repo)).toEqual([]);
  });

  test.each([
    ["eslint.config.js", "export default [{ rules: { 'react/forbid-elements': 'error' } }];"],
    [
      "eslint.config.mjs",
      "export default [{ rules: { 'no-restricted-syntax': ['error', { selector: 'JSXOpeningElement[name.name=button]' }] } }];",
    ],
    [".eslintrc.json", '{"rules":{"react/forbid-elements":"error"}}'],
  ])("%s with a restriction: nothing", async (file, text) => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(join(repo, file), text);
    expect(await check(repo)).toEqual([]);
  });

  test("an unrelated no-restricted-syntax rule still gets the note", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(
      join(repo, "eslint.config.ts"),
      "export default [{ rules: { 'no-restricted-syntax': ['error', 'WithStatement'] } }];",
    );
    expect(await check(repo)).toEqual([note]);
  });

  test("apps/*: only the shadcn workspace gets a line", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "package.json"), '{"workspaces":["apps/*"]}');
    mkdirSync(join(repo, "apps", "web"), { recursive: true });
    mkdirSync(join(repo, "apps", "api"), { recursive: true });
    writeFileSync(join(repo, "apps", "web", "components.json"), "{}");
    expect(await check(repo)).toEqual([
      "· project: apps/web uses shadcn/ui without a lint rule against raw HTML controls Fix: add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices",
    ]);
  });

  test("plain and glob entries check every shadcn folder once, including the root", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "package.json"), '{"workspaces":{"packages":["apps/web","apps/*"]}}');
    mkdirSync(join(repo, "apps", "web"), { recursive: true });
    mkdirSync(join(repo, "apps", "admin"), { recursive: true });
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(join(repo, "apps", "web", "components.json"), "{}");
    writeFileSync(join(repo, "apps", "admin", "components.json"), "{}");
    writeFileSync(
      join(repo, "apps", "admin", ".eslintrc"),
      '{"rules":{"react/forbid-elements":"error"}}',
    );
    expect(await check(repo)).toEqual([
      note,
      "· project: apps/web uses shadcn/ui without a lint rule against raw HTML controls Fix: add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices",
    ]);
  });

  test("the note is info-only and project files stay unchanged", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{ broken but its presence is enough }");
    writeFileSync(join(repo, "eslint.config.js"), "export default [];");
    const env = hookEnv();
    const lines = await projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS, fakeGhExec());
    expect(lines).toEqual([
      {
        ok: true,
        info: true,
        text: "project: . uses shadcn/ui without a lint rule against raw HTML controls",
        fix: "add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices",
      },
    ]);
    expect(readFileSync(join(repo, "components.json"), "utf8")).toBe(
      "{ broken but its presence is enough }",
    );
    expect(readFileSync(join(repo, "eslint.config.js"), "utf8")).toBe("export default [];");
  });

  test("broken Biome JSON: could not check, never a failure or a missing-rule claim", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(join(repo, "biome.json"), "{");
    expect(await check(repo)).toEqual([
      "· project: . uses shadcn/ui; could not check raw HTML control restrictions (biome.json could not be read or parsed)",
    ]);
  });

  test("broken package JSON: root checked, workspace scan is info-only", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(join(repo, "package.json"), "{");
    expect(await check(repo)).toEqual([
      "· project: could not check shadcn/ui workspaces from package.json",
      "· project: . uses shadcn/ui; could not check raw HTML control restrictions (package.json could not be read or parsed)",
    ]);
  });

  test.skipIf(process.getuid?.() === 0)(
    "an unreadable linter config cannot fail doctor",
    async () => {
      const repo = makeRepo();
      writeFileSync(join(repo, "components.json"), "{}");
      const config = join(repo, "eslint.config.js");
      writeFileSync(config, "export default [];");
      chmodSync(config, 0o000);
      try {
        expect(await check(repo)).toEqual([
          "· project: . uses shadcn/ui; could not check raw HTML control restrictions (eslint.config.js could not be read or parsed)",
        ]);
      } finally {
        chmodSync(config, 0o600);
      }
    },
  );

  test.each([
    ["off object", { level: "off", options: { elements: { button: "Use Button" } } }, true],
    ["off string", "off", true],
    ["empty elements", { level: "error", options: { elements: {} } }, true],
    ["disabled linter", { level: "error", options: { elements: { button: "Use Button" } } }, false],
  ])("fix round: Biome %s does not restrict controls", async (_name, rule, enabled) => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(
      join(repo, "biome.json"),
      JSON.stringify({
        linter: { enabled, rules: { correctness: { noRestrictedElements: rule } } },
      }),
    );
    expect(await check(repo)).toEqual([note]);
  });

  test.each(["apps/admin/**", "apps/admin/**/*"])(
    "fix round: scoped override %s covers admin only",
    async (includes) => {
      const repo = makeRepo();
      writeFileSync(join(repo, "package.json"), '{"workspaces":["apps/*"]}');
      for (const app of ["admin", "web"]) {
        mkdirSync(join(repo, "apps", app), { recursive: true });
        writeFileSync(join(repo, "apps", app, "components.json"), "{}");
      }
      writeFileSync(
        join(repo, "biome.json"),
        JSON.stringify({
          overrides: [
            {
              includes: [includes],
              linter: {
                rules: {
                  correctness: {
                    noRestrictedElements: {
                      level: "error",
                      options: { elements: { button: "Use Button" } },
                    },
                  },
                },
              },
            },
          ],
        }),
      );
      expect(await check(repo)).toEqual([
        "· project: apps/web uses shadcn/ui without a lint rule against raw HTML controls Fix: add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices",
      ]);
    },
  );

  test.each(["off", { level: "off" }])(
    "fix round: later override %j removes web coverage",
    async (off) => {
      const repo = makeRepo();
      writeFileSync(join(repo, "package.json"), '{"workspaces":["apps/*"]}');
      for (const app of ["admin", "web"]) {
        mkdirSync(join(repo, "apps", app), { recursive: true });
        writeFileSync(join(repo, "apps", app, "components.json"), "{}");
      }
      writeFileSync(
        join(repo, "biome.json"),
        JSON.stringify({
          linter: {
            rules: {
              correctness: {
                noRestrictedElements: {
                  level: "error",
                  options: { elements: { button: "Use Button" } },
                },
              },
            },
          },
          overrides: [
            {
              includes: ["apps/web/**"],
              linter: { rules: { correctness: { noRestrictedElements: off } } },
            },
          ],
        }),
      );
      expect(await check(repo)).toEqual([
        "· project: apps/web uses shadcn/ui without a lint rule against raw HTML controls Fix: add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices",
      ]);
    },
  );

  test.each([".", "apps/web"])("fix round: legacy eslintConfig at %s counts", async (folder) => {
    const repo = makeRepo();
    mkdirSync(join(repo, folder), { recursive: true });
    writeFileSync(join(repo, folder, "components.json"), "{}");
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({
        workspaces: ["apps/*"],
        ...(folder === "."
          ? { eslintConfig: { rules: { "react/forbid-elements": "error" } } }
          : {}),
      }),
    );
    if (folder !== ".")
      writeFileSync(
        join(repo, folder, "package.json"),
        '{"eslintConfig":{"rules":{"no-restricted-syntax":["error","JSXOpeningElement"]}}}',
      );
    expect(await check(repo)).toEqual([]);
  });

  test("fix round: package text outside eslintConfig is not a restriction", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(join(repo, "package.json"), '{"description":"react/forbid-elements"}');
    expect(await check(repo)).toEqual([note]);
  });

  test.skipIf(process.platform === "win32")(
    "fix round: workspace directory symlinks are followed and deduplicated",
    async () => {
      const repo = makeRepo();
      writeFileSync(join(repo, "package.json"), '{"workspaces":["apps/*","real/web"]}');
      mkdirSync(join(repo, "real", "web"), { recursive: true });
      writeFileSync(join(repo, "real", "web", "components.json"), "{}");
      mkdirSync(join(repo, "apps"));
      symlinkSync(join(repo, "real", "web"), join(repo, "apps", "web"));
      const outside = tempDir();
      writeFileSync(join(outside, "components.json"), "{}");
      symlinkSync(outside, join(repo, "apps", "outside"));
      symlinkSync(join(repo, "missing"), join(repo, "apps", "broken"));
      expect(await check(repo)).toEqual([
        "· project: apps/web uses shadcn/ui without a lint rule against raw HTML controls Fix: add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices",
      ]);
    },
  );

  test.each(["biome.json", "eslint.config.js", "package.json"])(
    "fix round: oversized %s is not read",
    async (file) => {
      const repo = makeRepo();
      writeFileSync(join(repo, "components.json"), "{}");
      writeFileSync(join(repo, file), " ".repeat(1_048_577));
      expect(await check(repo)).toEqual(
        file === "package.json"
          ? [
              "· project: could not check shadcn/ui workspaces from package.json",
              "· project: . uses shadcn/ui; could not check raw HTML control restrictions (package.json could not be read or parsed)",
            ]
          : [
              `· project: . uses shadcn/ui; could not check raw HTML control restrictions (${file} could not be read or parsed)`,
            ],
      );
    },
  );

  test
    .skipIf(process.platform === "win32")
    .each(["biome.json", "eslint.config.js", "package.json"])(
    "fix round: FIFO %s never blocks doctor",
    (file) => {
      const repo = makeRepo();
      writeFileSync(join(repo, "components.json"), "{}");
      expect(spawnSync("mkfifo", [join(repo, file)]).status).toBe(0);
      const guard = subprocessGuard();
      const env = hookEnv();
      const script = `import { projectChecks } from ${JSON.stringify(join(import.meta.dir, "project-checks.ts"))}; import { cliPaths } from ${JSON.stringify(join(import.meta.dir, "paths.ts"))}; console.log(JSON.stringify(await projectChecks(${JSON.stringify(repo)}, process.env, cliPaths(process.env), ${JSON.stringify(PLUGIN_HOOKS)})));`;
      const run = spawnSync(process.execPath, [...guard.args, "--eval", script], {
        timeout: 3000,
        env: { ...env, ...guard.env },
        encoding: "utf8",
      });
      expect(run.error?.message).toBeUndefined();
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout).map(checkLine)).toEqual(
        file === "package.json"
          ? [
              "· project: could not check shadcn/ui workspaces from package.json",
              "· project: . uses shadcn/ui; could not check raw HTML control restrictions (package.json could not be read or parsed)",
            ]
          : [
              `· project: . uses shadcn/ui; could not check raw HTML control restrictions (${file} could not be read or parsed)`,
            ],
      );
    },
  );

  test.each(["**", "**/*"])("fix round 2: root-wide %s enables a restriction", async (pattern) => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(
      join(repo, "biome.json"),
      JSON.stringify({
        overrides: [
          {
            includes: [pattern],
            linter: {
              rules: {
                correctness: {
                  noRestrictedElements: {
                    level: "error",
                    options: { elements: { button: "Use Button" } },
                  },
                },
              },
            },
          },
        ],
      }),
    );
    expect(await check(repo)).toEqual([]);
  });

  test.each(["**", "**/*"])("fix round 2: root-wide %s disables a restriction", async (pattern) => {
    const repo = makeRepo();
    writeFileSync(join(repo, "components.json"), "{}");
    writeFileSync(
      join(repo, "biome.json"),
      JSON.stringify({
        linter: {
          rules: {
            correctness: {
              noRestrictedElements: {
                level: "error",
                options: { elements: { button: "Use Button" } },
              },
            },
          },
        },
        overrides: [{ includes: [pattern], linter: { enabled: false } }],
      }),
    );
    expect(await check(repo)).toEqual([note]);
  });

  test.each(["!", "!!"])(
    "fix round 2: %s excludes admin without reversing web coverage",
    async (prefix) => {
      const repo = makeRepo();
      writeFileSync(join(repo, "package.json"), '{"workspaces":["apps/*"]}');
      for (const app of ["admin", "web"]) {
        mkdirSync(join(repo, "apps", app), { recursive: true });
        writeFileSync(join(repo, "apps", app, "components.json"), "{}");
      }
      writeFileSync(
        join(repo, "biome.json"),
        JSON.stringify({
          overrides: [
            {
              includes: ["**", `${prefix}apps/admin/**`],
              linter: {
                rules: {
                  correctness: {
                    noRestrictedElements: {
                      level: "error",
                      options: { elements: { button: "Use Button" } },
                    },
                  },
                },
              },
            },
          ],
        }),
      );
      expect(await check(repo)).toEqual([
        "· project: apps/admin uses shadcn/ui without a lint rule against raw HTML controls Fix: add a restriction using the lint recipe in /cc-smart-dev-kit:react-best-practices",
      ]);
    },
  );

  test.skipIf(process.platform === "win32").each(["replace", "grow"])(
    "fix round 2: config %s race is bounded",
    (race) => {
      const repo = makeRepo();
      writeFileSync(join(repo, "components.json"), "{}");
      const file = join(repo, "biome.json");
      writeFileSync(file, "{}");
      const guard = subprocessGuard();
      const env = hookEnv();
      // Run mocks in their own process: never replace filesystem methods used by other tests.
      const script = `
      import * as fs from 'node:fs';
      import {mock} from 'bun:test';
      import {spawnSync} from 'node:child_process';
      const {statSync, fstatSync, openSync, writeFileSync, unlinkSync} = fs;
      const target = ${JSON.stringify(file)};
      let changed = false;
      let targetFd;
      function change() {
        if (changed) return;
        changed = true;
        if (${JSON.stringify(race)} === 'replace') {
          unlinkSync(target);
          if (spawnSync('mkfifo', [target]).status !== 0) throw new Error('mkfifo failed');
        } else {
          writeFileSync(target, '{}'+ ' '.repeat(1048577));
        }
      }
      mock.module('node:fs', () => ({...fs,
        statSync: (...args) => {
          const result = statSync(...args);
          if (args[0] === target) change();
          return result;
        },
        openSync: (...args) => {
          if (args[0] === target && ${JSON.stringify(race)} === 'replace') change();
          const fd = openSync(...args);
          if (args[0] === target) targetFd = fd;
          return fd;
        },
        fstatSync: (...args) => {
          const result = fstatSync(...args);
          if (args[0] === targetFd && ${JSON.stringify(race)} === 'grow') change();
          return result;
        },
      }));
      const {projectChecks} = await import(${JSON.stringify(join(import.meta.dir, "project-checks.ts"))});
      const {cliPaths} = await import(${JSON.stringify(join(import.meta.dir, "paths.ts"))});
      const lines = await projectChecks(${JSON.stringify(repo)}, process.env, cliPaths(process.env), ${JSON.stringify(PLUGIN_HOOKS)});
      console.log(JSON.stringify({changed, lines}));
    `;
      const run = spawnSync(process.execPath, [...guard.args, "--eval", script], {
        timeout: 3000,
        env: { ...env, ...guard.env },
        encoding: "utf8",
      });
      expect(run.error?.message).toBeUndefined();
      expect(run.status).toBe(0);
      const result = JSON.parse(run.stdout);
      expect(result.changed).toBe(true);
      expect(result.lines.map(checkLine)).toEqual([
        "· project: . uses shadcn/ui; could not check raw HTML control restrictions (biome.json could not be read or parsed)",
      ]);
    },
  );

  test("plain workspace entries are deduplicated and root lint rules cover them", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "package.json"), '{"workspaces":["apps/web","apps/*"]}');
    mkdirSync(join(repo, "apps", "web"), { recursive: true });
    writeFileSync(join(repo, "apps", "web", "components.json"), "{}");
    writeFileSync(
      join(repo, "eslint.config.cjs"),
      "module.exports = [{ rules: { 'react/forbid-elements': 'error' } }];",
    );
    expect(await check(repo)).toEqual([]);
  });
});

describe("the retired review agent", () => {
  // Root reads a mode-000 file or folder all the same, so these two prove nothing as root.
  test.skipIf(process.getuid?.() === 0)(
    "skips unreadable Markdown and non-Markdown files",
    async () => {
      const repo = makeRepo();
      const folder = join(repo, ".claude", "skills");
      mkdirSync(folder, { recursive: true });
      const unreadable = join(folder, "private.md");
      writeFileSync(unreadable, "cc-smart-dev-kit:reviewer");
      writeFileSync(join(folder, "data.bin"), "cc-smart-dev-kit:reviewer");
      chmodSync(unreadable, 0o000);
      try {
        expect(await check(repo)).toEqual([]);
      } finally {
        chmodSync(unreadable, 0o600);
      }
    },
  );
  test.skipIf(process.getuid?.() === 0)(
    "a folder it cannot read never crashes doctor, and the other folders are still searched",
    async () => {
      const repo = makeRepo();
      for (const file of [
        "cc-smart-dev-kit/review.md",
        "agents/local.md",
        "skills/open/SKILL.md",
      ]) {
        const path = join(repo, ".claude", file);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "cc-smart-dev-kit:reviewer");
      }
      const locked = join(repo, ".claude", "agents");
      chmodSync(locked, 0o000);
      try {
        expect(await check(repo)).toEqual([
          "! project: .claude/cc-smart-dev-kit/review.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
          "! project: .claude/skills/open/SKILL.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
        ]);
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );
  test("fails with the base-list migration fix", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      workflow: { reviewAgents: ["cc-smart-dev-kit:reviewer"] },
    });
    expect(await check(repo)).toContain(
      "✗ project: .claude/cc-smart-dev-kit.json names the retired cc-smart-dev-kit:reviewer in workflow.reviewAgents Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer, then merge that change by hand or run cc-smart-dev-kit workflow review-done, because the merge guard judges with the base branch's list",
    );
  });
  test("warns for add-ons, agents and nested skills, not unrelated files", async () => {
    const repo = makeRepo();
    for (const file of [
      "cc-smart-dev-kit/review.md",
      "agents/local.md",
      "skills/local/SKILL.md",
      "unrelated.md",
    ]) {
      const path = join(repo, ".claude", file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "cc-smart-dev-kit:reviewer");
    }
    const lines = await check(repo);
    expect(lines.filter((line) => line.includes("mentions the retired"))).toEqual([
      "! project: .claude/agents/local.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/cc-smart-dev-kit/review.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/skills/local/SKILL.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
    ]);
  });
  test("warns for the project's memory files and nested rules, not files that do not mention it", async () => {
    const repo = makeRepo();
    for (const file of [
      "CLAUDE.md",
      "CLAUDE.local.md",
      ".claude/CLAUDE.md",
      ".claude/rules/review.local.md",
      ".claude/rules/deep/more.md",
    ]) {
      const path = join(repo, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "Review with cc-smart-dev-kit:reviewer.");
    }
    writeFileSync(join(repo, ".claude", "rules", "clean.md"), "cc-smart-dev-kit:senior-engineer");
    const lines = await check(repo);
    expect(lines.filter((line) => line.includes("mentions the retired"))).toEqual([
      "! project: .claude/CLAUDE.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/rules/deep/more.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/rules/review.local.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: CLAUDE.local.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: CLAUDE.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
    ]);
  });
  test("warns for commands, output styles and nested add-ons, at any depth", async () => {
    const repo = makeRepo();
    for (const file of [
      "commands/ship.md",
      "commands/team/merge.md",
      "output-styles/terse.md",
      "output-styles/team/plain.md",
      "cc-smart-dev-kit/review/extra.md",
      "commands/notes.txt",
    ]) {
      const path = join(repo, ".claude", file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "Review with cc-smart-dev-kit:reviewer.");
    }
    const lines = await check(repo);
    expect(lines.filter((line) => line.includes("mentions the retired"))).toEqual([
      "! project: .claude/cc-smart-dev-kit/review/extra.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/commands/ship.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/commands/team/merge.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/output-styles/team/plain.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
      "! project: .claude/output-styles/terse.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
    ]);
  });
  test("a root CLAUDE.md is searched in a project with no .claude folder", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "CLAUDE.md"), "cc-smart-dev-kit:reviewer");
    expect(await check(repo)).toEqual([
      "! project: CLAUDE.md mentions the retired cc-smart-dev-kit:reviewer Fix: replace the old id cc-smart-dev-kit:reviewer with the new one cc-smart-dev-kit:senior-engineer",
    ]);
  });
});

describe("Claude Code's own worktrees, and the retired engine", () => {
  test("outside git: nothing to say", async () => {
    expect(await check(tempDir("nogit"))).toEqual([]);
  });

  test("a project that never opted in: nothing to say", async () => {
    expect(await check(makeRepo())).toEqual([]);
  });

  test("no git on PATH: one · line, not checked", async () => {
    const env = { ...hookEnv(), PATH: tempDir("empty-path") };
    expect(await check(makeRepo(), env)).toEqual(["· project: not checked, git is not on PATH"]);
  });

  test("worktrees set, no engine hook, the folder ignored: nothing to say", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test(".claude/worktrees/ not git-ignored: one ! line naming the .gitignore entry", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    expect(await check(repo)).toEqual([`! ${NOT_IGNORED}`]);
  });

  test("a base branch that is not the default, no baseRef: one ! line naming the line to add", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([
      '! project: worktrees.base is dev, not this repo\'s default branch main, and the project\'s settings do not set "worktree": {"baseRef": "head"}, so a new worktree is cut from the default branch instead: add "worktree": {"baseRef": "head"} to .claude/settings.json and commit it',
    ]);
  });

  test("a base branch that is not the default, with baseRef head: nothing to say", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    writeClaudeFile(repo, "settings.json", { worktree: { baseRef: "head" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test("a base branch that is not the default, baseRef head in settings.local.json: nothing", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    writeClaudeFile(repo, "settings.local.json", { worktree: { baseRef: "head" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test("the default branch as the base needs no baseRef line", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test("D20: a retired engine field: the parse line, naming the field and the fix", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", prefix: "app-wt-" },
    });
    expect(await check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktrees.prefix is no longer supported: remove it — Claude Code's own worktrees need none. \`cc-smart-dev-kit project init\` removes it (README § Worktrees). Fix: correct the file as this line says, or run: cc-smart-dev-kit project init`,
    ]);
  });

  test("D20: the engine's three lines: one ✗ line naming the file, the hooks and the fix", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    writeClaudeFile(repo, "settings.json", { hooks: ENGINE_HOOKS });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove", "subagent-stop"]),
    ]);
  });

  test("D20: engine lines in both settings files, beside other hooks: one ✗ line per file", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "./stop.sh" }] }],
        WorktreeRemove: ENGINE_HOOKS.WorktreeRemove,
      },
    });
    writeClaudeFile(repo, "settings.local.json", {
      hooks: {
        WorktreeCreate: [
          { hooks: [{ type: "command", command: "  cc-smart-dev-kit   hook  worktree-create " }] },
        ],
      },
    });
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-remove"]),
      engineLine(".claude/settings.local.json", ["worktree-create"]),
    ]);
  });

  test("a project Stop hook beside verify-gate: a warning only when the project sets checks.fast", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { checks: { fast: "bun run check" } });
    writeClaudeFile(repo, "settings.json", {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./stop.sh" }] }] },
    });
    expect(await check(repo)).toEqual([
      "! project: the plugin's verify-gate and the project's ./stop.sh (.claude/settings.json) both run on Stop, so both may answer. If that is the project's own copy of verify-gate, list \"verify-gate\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
    ]);
  });

  test("D20: engine lines with no cc-smart-dev-kit.json at all: still named, each fails", async () => {
    const repo = makeRepo();
    wireOnly(repo, ["WorktreeCreate", "WorktreeRemove"]);
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove"]),
    ]);
  });

  test("D20: a retired field and the engine's lines: both lines, so one project init run fixes both", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", engine: "plugin" },
    });
    writeClaudeFile(repo, "settings.json", { hooks: ENGINE_HOOKS });
    expect(await check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktrees.engine is no longer supported: remove it — Claude Code's own worktrees need none. \`cc-smart-dev-kit project init\` removes it (README § Worktrees). Fix: correct the file as this line says, or run: cc-smart-dev-kit project init`,
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove", "subagent-stop"]),
    ]);
  });

  test("D20: hook notify, and a program whose name only ends the same way, are not the engine", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        WorktreeCreate: [
          { hooks: [{ type: "command", command: "my-cc-smart-dev-kit hook worktree-create" }] },
        ],
        Notification: [{ hooks: [{ type: "command", command: "cc-smart-dev-kit hook notify" }] }],
      },
    });
    expect((await check(repo)).some((line) => line.includes("retired"))).toBe(false);
  });

  test("a broken cc-smart-dev-kit.json: ✗ naming the file and field", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktree: {} });
    expect(await check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktree: unknown field (a newer cc-smart-dev-kit may be needed) Fix: correct the file as this line says, or run: cc-smart-dev-kit project init`,
    ]);
  });
});

describe("a project that used the old anymodel name", () => {
  test("the old config file, the old add-ons folder and an old launcher in a hook: one ! each", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
    mkdirSync(join(repo, ".claude", "anymodel"), { recursive: true });
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/anymodel" hook session-name',
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
    expect(await check(repo)).toEqual([
      "! project: .claude/anymodel.json is the old name of .claude/cc-smart-dev-kit.json, which the plugin reads now: rename it (merge the two when both are there)",
      "! project: .claude/anymodel/ is the old name of .claude/cc-smart-dev-kit/, where a skill reads the project's own add-ons: rename the folder",
      '! project: the hook "$HOME/.local/bin/anymodel" hook session-name (.claude/settings.json) still runs the plugin\'s old "anymodel" launcher: change it to "$HOME/.local/bin/cc-smart-dev-kit" hook session-name',
    ]);
  });

  test("the new names: no warning; a hook that only says anymodel somewhere else is not one", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "./note-anymodel.sh" }] },
        ],
        ...ENGINE_HOOKS,
      },
    });
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove", "subagent-stop"]),
      "! project: the plugin's git-guard and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of git-guard, list \"git-guard\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
      "! project: the plugin's merge-guard and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of merge-guard, list \"merge-guard\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
      "! project: the plugin's job-route and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. The plugin's job-route cannot be switched off (it judges every launch): remove the project's copy, or keep it knowing both answer",
    ]);
  });

  test("a launcher path is the old name; a word that merely holds it is not", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
    const pluginRoot = "${CLAUDE_PLUGIN_ROOT}";
    expect(renamedCommand('"$HOME/.local/bin/anymodel-bun" x')).toBe(
      '"$HOME/.local/bin/cc-smart-dev-kit-bun.sh" x',
    );
    // The plugin folder's own shim, as a project copied it out of hooks.json: the file is
    // `cc-smart-dev-kit-bun.sh` now (the hooks are shell form).
    expect(renamedCommand(`"${pluginRoot}/bin/anymodel-bun" x`)).toBe(
      `"${pluginRoot}/bin/cc-smart-dev-kit-bun.sh" x`,
    );
    expect(renamedCommand("anymodel --version")).toBe("cc-smart-dev-kit --version");
    expect(renamedCommand("./note-anymodel.sh")).toBe("./note-anymodel.sh");
  });
});

describe("the project's own copies of plugin hooks (ownHooks)", () => {
  const OTHERS = {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] },
      { matcher: "Read", hooks: [{ type: "command", command: "./reads.sh" }] },
    ],
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "./hello.sh" }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "bun", args: ["p.ts"] }] }],
  };
  const both = (plugin: string, command: string, on: string) =>
    `! project: the plugin's ${plugin} and the project's ${command} (.claude/settings.json) both run on ${on}, so both may answer. If that is the project's own copy of ${plugin}, list "${plugin}" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed`;
  /** `job-route` is `alwaysOn` since 1.0.0: no project can switch it off, so the warning says so. */
  const bothJobRoute = (command: string, on: string) =>
    `! project: the plugin's job-route and the project's ${command} (.claude/settings.json) both run on ${on}, so both may answer. The plugin's job-route cannot be switched off (it judges every launch): remove the project's copy, or keep it knowing both answer`;

  test("a project hook next to a plugin hook it does not list: one ! warning each, not a failure", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], OTHERS);
    expect(await check(repo)).toEqual([
      both("git-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      bothJobRoute("./guard.sh", "PreToolUse (Bash)"),
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "bun p.ts", "UserPromptSubmit"),
    ]);
    const env = hookEnv();
    expect(
      (await projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS, fakeGhExec())).every(
        (l) => l.ok,
      ),
    ).toBe(true);
  });

  test("a listed hook: one · line, and no warning for its copy", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-guard", "session-name"] });
    wireOnly(repo, [], OTHERS);
    expect(await check(repo)).toEqual([
      "· project: the plugin's git-guard is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      "· project: the plugin's session-name is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      bothJobRoute("./guard.sh", "PreToolUse (Bash)"),
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
    ]);
  });

  test("a project hook on SessionStart: no warning for the machine-wide update-check", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ownHooks: ["session-name", "worktree-leftovers"],
    });
    wireOnly(repo, [], { SessionStart: OTHERS.SessionStart });
    expect(await check(repo)).toEqual([
      "· project: the plugin's session-name is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      "· project: the plugin's worktree-leftovers is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
    ]);
  });

  test("a project hook on the Agent event: no warning for the machine-wide agent-guard", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], {
      PreToolUse: [
        {
          matcher: "Agent|Task|Workflow",
          hooks: [{ type: "command", command: "./agent-guard.sh" }],
        },
      ],
    });
    // The machine-wide hooks (notify, update-check, agent-guard) answer about the machine,
    // not this project: a project hook beside one is not a second copy of a plugin piece.
    expect(await check(repo)).toEqual([]);
  });

  test("a listed hook with no project hook left on its event: ! nothing answers in its place", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["main-folder-guard"] });
    expect(await check(repo)).toEqual([
      "! project: .claude/cc-smart-dev-kit.json lists main-folder-guard in ownHooks, so the plugin's main-folder-guard is off here, but the project's settings wire no hook on PreToolUse (Edit, Write, NotebookEdit): nothing answers in its place. Take \"main-folder-guard\" out of ownHooks once the project's copy is gone",
    ]);
  });

  test("a retired hook name in ownHooks: one · line that it silences nothing and can go, never a warning", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["serena-root"] });
    expect(await check(repo)).toEqual([
      '· project: .claude/cc-smart-dev-kit.json lists serena-root in ownHooks, a plugin hook that is retired: it silences nothing. Take "serena-root" out of ownHooks',
    ]);
    const env = hookEnv();
    expect(
      (await projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS, fakeGhExec())).every(
        (l) => l.ok,
      ),
    ).toBe(true);
  });

  test("message-guard in ownHooks still parses and doctor names it as retired", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["message-guard"] });
    expect(await check(repo)).toEqual([
      '· project: .claude/cc-smart-dev-kit.json lists message-guard in ownHooks, a plugin hook that is retired: it silences nothing. Take "message-guard" out of ownHooks',
    ]);
  });

  test("a hook no project can switch off any more (job-route): one · line that it silences nothing, and a copy still warns", async () => {
    // A project file written before 1.0.0 may list it: the strict parse still accepts the name,
    // and the plugin's copy answers all the same (the frame skips the ownHooks step), so a
    // project's own copy beside it is still two answers.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["job-route"] });
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }],
      },
    });
    expect(await check(repo)).toEqual([
      '· project: .claude/cc-smart-dev-kit.json lists job-route in ownHooks, a plugin hook no project can switch off any more: it silences nothing. Take "job-route" out of ownHooks',
      both("git-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      bothJobRoute("./guard.sh", "PreToolUse (Bash)"),
    ]);
  });

  test("a project hook for every tool runs next to each plugin hook on that event, for all its tools", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], {
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "./log.sh" }] }],
    });
    // review-record runs on SubagentStop, not PostToolUse, so a PostToolUse "*" never meets it.
    expect(await check(repo)).toEqual([
      both("after-merge", "./log.sh", "PostToolUse (Bash, PowerShell)"),
    ]);
  });

  test("a project hook on SubagentStop is the engine's own line: no 'second copy' warning", async () => {
    // A project that wired the retired worktree engine has a SubagentStop line, and the
    // plugin's review-record shares that event: they are different pieces, so pairing them
    // would warn twice for one line. The engine's own ✗ line is what judges it.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        SubagentStop: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop',
              },
            ],
          },
        ],
      },
    });
    const lines = await check(repo);
    expect(lines.some((line) => line.includes("review-record"))).toBe(false);
    expect(lines.some((line) => line.includes("both may answer"))).toBe(false);
  });

  test("no cc-smart-dev-kit.json: the plugin hooks are silent, so nothing can answer twice", async () => {
    const repo = makeRepo();
    wireOnly(repo, [], OTHERS);
    expect(await check(repo)).toEqual([]);
  });

  test("the settings of $CLAUDE_PROJECT_DIR, when set, not the checkout's", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], OTHERS);
    const started = tempDir("project-dir");
    writeClaudeFile(started, "settings.json", {
      hooks: {
        PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./log.sh" }] }],
      },
    });
    const env = { ...hookEnv(), CLAUDE_PROJECT_DIR: started };
    expect(await check(repo, env)).toEqual([both("after-merge", "./log.sh", "PostToolUse (Bash)")]);
  });

  test("an unknown name in ownHooks: ✗ naming the field", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-gaurd"] });
    const lines = await check(repo);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ project: Invalid ${file}: ownHooks.0: `);
  });

  test("the plugin's hooks.json cannot be read: ✗", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    const missing = join(tempDir("plugin"), "hooks.json");
    const lines = await check(repo, hookEnv(), missing);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ cannot read the plugin's hooks (${missing}): `);
  });
});

describe("a requires below what the file's fields need", () => {
  // `workflow.issues` came in 1.4.0. The old `crew` group is a leftover 2.0 loads and ignores:
  // it raises no floor, and the file still loads with no error.
  const LOW = {
    requires: ">=1.0",
    worktrees: { base: "main" },
    workflow: {
      crew: { enabled: true, handoffTokens: 300000 },
      issues: { foundLabel: "kit:found" },
    },
  };

  test("an issues group under >=1.0: one ! line naming the range, the floor and the fix", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", LOW);
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([
      '! project: .claude/cc-smart-dev-kit.json says requires ">=1.0", but its fields need ">=1.4": a teammate on an older plugin gets the whole file refused instead of "update" Fix: cc-smart-dev-kit project init (or any cc-smart-dev-kit workflow set … --project) raises it to ">=1.4"',
    ]);
  });

  test("a requires at or above the floor, a range read as a newer one, or none: nothing to say", async () => {
    const repo = makeRepo();
    ignoreWorktrees(repo);
    for (const requires of [">=1.4", ">=1.5", "^1.4 || >=2", undefined]) {
      writeClaudeFile(repo, "cc-smart-dev-kit.json", { ...LOW, requires });
      expect(await check(repo)).toEqual([]);
    }
  });

  test("a requires that stops below this plugin: one ✗ line, and project init is not the fix", async () => {
    const repo = makeRepo();
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: "<1" });
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    expect(await check(repo)).toEqual([
      `✗ project: ${file}: this project's requires <1 does not let in cc-smart-dev-kit ${VERSION}, which is newer; widen requires in that file Fix: do what this line says`,
    ]);
  });
});

describe("D17: a git too old to measure fixes after a review", () => {
  test("D17: git older than 2.40 in a project: one ! line saying fixes need an exact re-review", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    expect(await check(repo, withGitVersion(hookEnv(), "2.39.2"))).toEqual([
      "! project: git 2.39.2 is older than 2.40, so fixes made after a review cannot be measured here: each fix then needs a review of the exact new head (update git)",
    ]);
  });

  test("D17: git 2.40 or newer, or a project that never opted in: nothing to say", async () => {
    const repo = makeRepo();
    expect(await check(repo, withGitVersion(hookEnv(), "2.39.2"))).toEqual([]);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    expect(await check(repo, withGitVersion(hookEnv(), "2.40.0"))).toEqual([]);
  });
});

describe("the heavy-job queue counts jobs: size fields in jobs.kinds", () => {
  const SIZED = {
    jobs: {
      kinds: {
        e2e: {
          filesGb: 2,
          gb: 6,
          match: [{ script: "e2e" }],
          workers: { flag: "--workers", gbEach: 1 },
        },
        tsc: { gb: 8, match: [{ tool: "tsc" }] },
      },
      route: true,
    },
  };

  test("says once, for the whole file, which kinds still size a job and how to set the real limit", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SIZED);
    ignoreWorktrees(repo);
    const lines = await check(repo);
    expect(lines).toHaveLength(1);
    // The file is named relative to the project on POSIX, and by its full path on Windows
    // (`shown`, the same for every project line): the rest is the same everywhere.
    expect(lines[0]).toStartWith("· project: ");
    expect(lines[0]).toEndWith(
      "cc-smart-dev-kit.json sets size fields in jobs.kinds (e2e: gb, filesGb, workers; tsc: gb) that the job queue ignores: it counts jobs now, not gigabytes Fix: remove them from jobs.kinds: the queue runs one full heavy job per machine at a time, whatever a kind says",
    );
  });

  test("is information, never a warning or a failure", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SIZED);
    ignoreWorktrees(repo);
    const lines = (
      await projectChecks(repo, hookEnv(), cliPaths(hookEnv()), PLUGIN_HOOKS, fakeGhExec())
    ).filter(notIssuesLine);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ info: true, ok: true });
  });

  test("a kind that sets none of them, or no kinds at all: nothing to say", async () => {
    const repo = makeRepo();
    ignoreWorktrees(repo);
    for (const jobs of [
      {},
      { route: true },
      {
        kinds: { e2e: { about: "Browser tests.", match: [{ script: "e2e" }], printOnly: ["-h"] } },
      },
    ]) {
      writeClaudeFile(repo, "cc-smart-dev-kit.json", { jobs });
      expect(await check(repo)).toEqual([]);
    }
  });
});

describe("GitHub Issues are on by default: doctor stays quiet", () => {
  test("a project with a config and no GitHub origin: one · line, never a failure", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const gh = fakeGh();
    const lines = (await projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS, gh.exec)).filter(
      (line) => line.text.startsWith("issues:"),
    );
    expect(lines.map(checkLine)).toEqual([
      "· issues: this project has no `origin` remote, so it has no repository of its own to file in; follow-ups go in the summary instead",
    ]);
    expect(gh.calls).toEqual([]);
  });
});

describe("deploy tasks in doctor's project group", () => {
  const FIX = "run `cc-smart-dev-kit task check`";
  const NOW = new Date("2026-11-17T14:45:03Z");

  /** A repo with a config (so `requires` is judged), the worktrees folder ignored, and a tasks folder. */
  function project(config: unknown = {}) {
    const repo = makeRepo();
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
    return { repo, dir: join(repo, ".claude", "tasks") };
  }
  const made = (dir: string, env: "prod" | "staging", title: string) =>
    createDeployTask(dir, { title, env, deploy: "before", type: "blocking" }, { now: NOW });
  const taskLines = async (repo: string) =>
    (await projectTaskChecks(repo, hookEnv())).map(checkLine);

  test("a clean tasks folder: one line that there are no findings", async () => {
    const { repo, dir } = project();
    made(dir, "prod", "Run the migration");
    expect(await taskLines(repo)).toEqual(["✓ deploy tasks: no findings"]);
  });

  test("no tasks folder at all: nothing to say", async () => {
    const { repo } = project();
    expect(await taskLines(repo)).toEqual([]);
  });

  test("one ✗ line for each kind of finding, with the task check fix", async () => {
    const { repo, dir } = project();
    const task = made(dir, "prod", "Run the migration");
    writeFileSync(join(dir, "prod", "prod-20260101-000000-broken.md"), "not a task");
    copyFileSync(task.file, join(dir, "prod", `${task.id}-twin.md`));
    expect(await taskLines(repo)).toEqual([
      `✗ deploy tasks: 1 broken-file Fix: ${FIX}`,
      `✗ deploy tasks: 1 duplicate-id Fix: ${FIX}`,
      `✗ deploy tasks: 1 duplicate-title Fix: ${FIX}`,
    ]);
  });

  test("old files: a ! line that names the count and says to recreate or delete them, never a ✗", async () => {
    const { repo, dir } = project();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "T-abcd-old.md"), "an old task");
    writeFileSync(join(dir, "T-efgh-old.md"), "an old task");
    expect(await taskLines(repo)).toEqual([
      "! deploy tasks: 2 old task files are not read since 5.0.0 Fix: recreate each as a deploy task, or delete it (`cc-smart-dev-kit task check` names them)",
    ]);
    rmSync(join(dir, "T-efgh-old.md"));
    expect(await taskLines(repo)).toEqual([
      "! deploy tasks: 1 old task file is not read since 5.0.0 Fix: recreate it as a deploy task, or delete it (`cc-smart-dev-kit task check` names it)",
    ]);
  });

  test("old files beside a real finding: both lines, and no 'no findings'", async () => {
    const { repo, dir } = project();
    mkdirSync(join(dir, "prod"), { recursive: true });
    writeFileSync(join(dir, "prod", "prod-20260101-000000-broken.md"), "not a task");
    writeFileSync(join(dir, "T-abcd-old.md"), "an old task");
    expect((await taskLines(repo)).map((line) => line.slice(0, 1))).toEqual(["✗", "!"]);
  });

  test("the whole report: each ignored tasks field gets a ! line and the fix project init", async () => {
    const { repo } = project({ tasks: { releaseBranch: "release", legacyFolders: ["notes"] } });
    expect(await check(repo)).toEqual([
      "! project: .claude/cc-smart-dev-kit.json sets tasks.releaseBranch, no longer read since 5.0.0: remove it Fix: cc-smart-dev-kit project init removes it",
      "! project: .claude/cc-smart-dev-kit.json sets tasks.legacyFolders, no longer read since 5.0.0: remove it Fix: cc-smart-dev-kit project init removes it",
    ]);
  });

  test("a tasks group without the ignored fields says nothing about them", async () => {
    const { repo } = project({ tasks: { staleDays: 7, envs: ["prod"] } });
    expect(await check(repo)).toEqual([]);
  });

  test("deploy folders and a requires below 5.0: a ! line whose fix is project init alone", async () => {
    const { repo, dir } = project({ requires: ">=1.0" });
    mkdirSync(join(dir, "prod"), { recursive: true });
    expect(await check(repo)).toEqual([
      '! project: .claude/cc-smart-dev-kit.json says requires ">=1.0", but its fields and its deploy task folders need ">=5.0": a teammate on an older plugin gets the whole file refused instead of "update" Fix: cc-smart-dev-kit project init raises it to ">=5.0"',
      "✓ deploy tasks: no findings",
    ]);
  });

  test("deploy folders with no requires, or a requires below 5.0 and no folders: nothing on requires", async () => {
    const { repo, dir } = project();
    mkdirSync(join(dir, "staging"), { recursive: true });
    expect(await check(repo)).toEqual(["✓ deploy tasks: no findings"]);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    expect(await check(repo)).toEqual(["✓ deploy tasks: no findings"]);
    rmSync(dir, { recursive: true });
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=1.0" });
    expect(await check(repo)).toEqual([]);
  });
});

describe("the deploy-skill block in doctor", () => {
  const OLD = `${BLOCK_BEGIN}\n## Deploy tasks\nold text\n${BLOCK_END}\n`;
  const CURRENT = `${BLOCK_BEGIN}\n${deployBlockBody()}\n${BLOCK_END}\n`;

  function skill(repo: string, folder: string, text: string): void {
    mkdirSync(join(repo, ".claude", "skills", folder), { recursive: true });
    writeFileSync(join(repo, ".claude", "skills", folder, "SKILL.md"), text);
  }
  function project() {
    const repo = makeRepo();
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    return repo;
  }

  test("a block whose text is old: a ! line with the fix project init", async () => {
    const repo = project();
    skill(repo, "deploy", `# Deploy\n${OLD}`);
    expect(await check(repo)).toEqual([
      "! project: the deploy-skill block in .claude/skills/deploy/SKILL.md is out of date (the block's text is out of date) Fix: cc-smart-dev-kit project init rewrites it",
    ]);
  });

  test("broken markers: a ! line whose fix is by hand, since init will not write the file", async () => {
    const repo = project();
    skill(repo, "deploy", `${BLOCK_BEGIN}\n## Deploy tasks\nhalf\n${BLOCK_BEGIN}\n`);
    const [line] = await check(repo);
    expect(line).toStartWith(
      "! project: the deploy-skill block in .claude/skills/deploy/SKILL.md is out of date (",
    );
    expect(line).toContain("Fix: correct that file by hand");
    expect(line).not.toContain("project init");
  });

  test("a current block, or no block at all: nothing to say", async () => {
    const repo = project();
    skill(repo, "deploy", `# Deploy\n${CURRENT}`);
    skill(repo, "deploy-other", "no block here");
    expect(await check(repo)).toEqual([]);
  });

  test("a skills folder linked out of the checkout, in a project with deploy folders: one · line, no failure", async () => {
    const repo = project();
    const outside = tempDir("skills-outside");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    symlinkSync(outside, join(repo, ".claude", "skills"));
    expect(await check(repo)).toEqual([]);
    mkdirSync(join(repo, ".claude", "tasks", "prod"), { recursive: true });
    expect(await check(repo)).toEqual([
      "✓ deploy tasks: no findings",
      "· project: .claude/skills is a link outside this checkout: not searched, so the deploy-skill block there is not checked",
    ]);
  });
});
