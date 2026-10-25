/** The workflow writers keep the layout of the file they change (JW1). */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo } from "../testing/hooks";
import { personalWorkflowFile } from "./resolve";
import { writePersonalSetting, writeProjectSetting } from "./write";

/** A project file exactly as this repo's Biome prints it. */
const BIOME_PROJECT = `{
  "requires": ">=1.0",
  "worktrees": {
    "base": "main",
    "bases": {
      "hotfix/": "main",
      "release/": "main"
    }
  },
  "protectedBranches": ["main"],
  "sessionNames": false,
  "workflow": {
    "reviewBeforePush": true,
    "crew": {
      "enabled": true
    }
  }
}
`;

/** What Biome (the repo's own settings) says the text should be: the text itself when clean. */
function biomeFormat(text: string): string {
  const run = Bun.spawnSync(
    [
      "node_modules/.bin/biome",
      "format",
      "--indent-style=space",
      "--indent-width=2",
      "--line-width=100",
      "--stdin-file-path=cc-smart-dev-kit.json",
    ],
    { stdin: new TextEncoder().encode(text), stdout: "pipe", stderr: "pipe" },
  );
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString();
}

function projectWith(text: string): {
  repo: string;
  file: string;
  env: ReturnType<typeof hookEnv>;
} {
  const env = hookEnv();
  const repo = makeRepo();
  const file = join(repo, ".claude", "cc-smart-dev-kit.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { repo, file, env };
}

describe("workflow set / unset --project", () => {
  test("a set leaves every line it does not touch byte for byte, and Biome has nothing to change", () => {
    const { repo, file, env } = projectWith(BIOME_PROJECT);
    expect(biomeFormat(BIOME_PROJECT)).toBe(BIOME_PROJECT);
    writeProjectSetting(repo, "autoCommit", true, env);
    const written = readFileSync(file, "utf8");
    expect(written).toBe(
      BIOME_PROJECT.replace(
        '      "enabled": true\n    }\n',
        '      "enabled": true\n    },\n    "autoCommit": true\n',
      ),
    );
    expect(biomeFormat(written)).toBe(written);
  });

  test("an unset removes only that key's line and the comma it leaves", () => {
    const { repo, file, env } = projectWith(BIOME_PROJECT);
    writeProjectSetting(repo, "reviewBeforePush", undefined, env);
    expect(readFileSync(file, "utf8")).toBe(
      BIOME_PROJECT.replace('    "reviewBeforePush": true,\n', ""),
    );
    // The last key of an object: the comma before it goes.
    writeProjectSetting(repo, "crew.enabled", undefined, env);
    const written = readFileSync(file, "utf8");
    expect(written).toBe(`{
  "requires": ">=1.0",
  "worktrees": {
    "base": "main",
    "bases": {
      "hotfix/": "main",
      "release/": "main"
    }
  },
  "protectedBranches": ["main"],
  "sessionNames": false
}
`);
    expect(biomeFormat(written)).toBe(written);
  });

  test("a new array value prints on one line", () => {
    const { repo, file, env } = projectWith(BIOME_PROJECT);
    writeProjectSetting(repo, "alerts.events", ["needs-you", "question"], env);
    const written = readFileSync(file, "utf8");
    expect(written).toContain(`    "alerts": {\n      "events": ["needs-you", "question"]\n    }`);
    expect(biomeFormat(written)).toBe(written);
  });

  test("a file indented with four spaces, and one with tabs, keep their indent and their lines", () => {
    const four = `{\n    "protectedBranches": ["main"],\n    "worktrees": { "base": "main" }\n}\n`;
    const a = projectWith(four);
    writeProjectSetting(a.repo, "autoCommit", true, a.env);
    expect(readFileSync(a.file, "utf8")).toBe(
      `{\n    "protectedBranches": ["main"],\n    "worktrees": { "base": "main" },\n    "workflow": {\n        "autoCommit": true\n    }\n}\n`,
    );
    const tabs = `{\n\t"protectedBranches": ["main"],\n\t"worktrees": {\n\t\t"base": "main"\n\t}\n}\n`;
    const b = projectWith(tabs);
    writeProjectSetting(b.repo, "autoCommit", true, b.env);
    expect(readFileSync(b.file, "utf8")).toBe(
      `{\n\t"protectedBranches": ["main"],\n\t"worktrees": {\n\t\t"base": "main"\n\t},\n\t"workflow": {\n\t\t"autoCommit": true\n\t}\n}\n`,
    );
  });

  test("a key added to an empty object", () => {
    const { repo, file, env } = projectWith("{}\n");
    writeProjectSetting(repo, "autoCommit", true, env);
    expect(readFileSync(file, "utf8")).toBe(`{\n  "workflow": {\n    "autoCommit": true\n  }\n}\n`);
  });

  test("a file that is not valid JSON is refused, and left as it was", () => {
    const { repo, file, env } = projectWith('{ "worktrees": { "base": "main" ,, }\n');
    expect(() => writeProjectSetting(repo, "autoCommit", true, env)).toThrow("not valid JSON");
    expect(readFileSync(file, "utf8")).toBe('{ "worktrees": { "base": "main" ,, }\n');
  });
});

describe("workflow set / unset (the person's own file)", () => {
  test("a set and an unset keep the file's lines; a new file is printed as Biome prints it", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const file = personalWorkflowFile(paths);
    writePersonalSetting(paths, "alerts.events", ["needs-you"]);
    expect(readFileSync(file, "utf8")).toBe(
      `{\n  "alerts": {\n    "events": ["needs-you"]\n  }\n}\n`,
    );
    writeFileSync(file, `{\n  "alerts": { "events": ["needs-you"] },\n  "openPr": "draft"\n}\n`);
    writePersonalSetting(paths, "autoCommit", true);
    expect(readFileSync(file, "utf8")).toBe(
      `{\n  "alerts": { "events": ["needs-you"] },\n  "openPr": "draft",\n  "autoCommit": true\n}\n`,
    );
    writePersonalSetting(paths, "openPr", undefined);
    expect(readFileSync(file, "utf8")).toBe(
      `{\n  "alerts": { "events": ["needs-you"] },\n  "autoCommit": true\n}\n`,
    );
  });
});
