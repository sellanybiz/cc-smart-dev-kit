/**
 * Finding the script a Workflow call runs when it names no inline `script`
 * (`agent-guard-workflows.ts`): by `scriptPath`, by a saved workflow's bare name, by a plugin's
 * `<plugin>:<name>` — and reading `meta` the way Claude Code does (a pure literal, the first
 * statement).
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  scriptAtPath,
  scriptByName,
  WORKFLOW_SCRIPT_MAX_BYTES,
  type WorkflowPlace,
  workflowMetaName,
} from "./agent-guard-workflows";

/** A workflow file whose `meta.name` is `name`, with one line of body. */
function workflowFile(name: string, body = "return 1;"): string {
  return `export const meta = { name: "${name}", description: "A probe." };\n${body}\n`;
}

/** A home with a config folder, and a git repo inside it with a `src` folder: the session's cwd. */
function world(): WorkflowPlace & { repo: string } {
  const home = tempDir("wf-home");
  const repo = join(home, "code", "my-app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  const claudeConfigDir = join(home, ".claude");
  mkdirSync(claudeConfigDir, { recursive: true });
  return {
    claudeConfigDir,
    cwd: join(repo, "src"),
    home,
    installedPluginsFile: join(claudeConfigDir, "plugins", "installed_plugins.json"),
    pluginRoot: null,
    repo,
  };
}

function put(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("G2: meta, read the way Claude Code reads it", () => {
  it("G2: a pure literal as the first statement gives the name", () => {
    expect(workflowMetaName(workflowFile("probe"))).toBe("probe");
    expect(
      workflowMetaName(
        [
          "// A comment first is fine.",
          "/* So is a block. */",
          "export const meta = {",
          "  'name': `audit-run`,",
          "  description: 'Checks',",
          "  phases: [{ title: 'Read', detail: \"one\" }, -1, 2.5, true, null,],",
          "};",
          "return 1;",
        ].join("\n"),
      ),
    ).toBe("audit-run");
  });

  it("G2: anything but a pure literal, or meta not first: no name", () => {
    const bad = [
      "const x = 1;\nexport const meta = { name: 'a', description: 'b' };",
      "export const meta = { name: n, description: 'b' };",
      `export const meta = { name: \`a\${1}\`, description: 'b' };`,
      "export const meta = { [k]: 'a', name: 'a', description: 'b' };",
      "export const meta = { ...base, name: 'a', description: 'b' };",
      "export const meta = { name, description: 'b' };",
      "export const meta = { name: 'a', description: 'b', run() {} };",
      "export const meta = { name: '', description: 'b' };",
      "export const meta = { name: 'a' };",
      "export const meta = { name: 'a', description: 'b', list: [1,,2] };",
      "export const meta = { name: 'a', description: 'b', __proto__: {} };",
      "export const meta = { name: 'a' + 'b', description: 'b' };",
      "export const meta = { name: 'a', description: 'b'",
    ];
    for (const script of bad) expect(workflowMetaName(script)).toBeNull();
  });
});

describe("G2: a script by `scriptPath`", () => {
  it("G2: an absolute path, or one relative to the cwd, is read", () => {
    const place = world();
    const file = join(place.repo, "flows", "probe.js");
    put(file, workflowFile("probe", "await agent('x', {});"));
    expect(scriptAtPath(file, place.cwd)).toEqual({
      file,
      script: workflowFile("probe", "await agent('x', {});"),
    });
    expect(scriptAtPath("../flows/probe.js", place.cwd)).toEqual({
      file,
      script: workflowFile("probe", "await agent('x', {});"),
    });
  });

  it("G2: a Windows line end is read as Claude Code reads it, one \\n", () => {
    const place = world();
    const file = join(place.repo, "probe.js");
    put(file, "export const meta = { name: 'p', description: 'd' };\r\nreturn 1;\r\n");
    expect(scriptAtPath(file, place.cwd)).toEqual({
      file,
      script: "export const meta = { name: 'p', description: 'd' };\nreturn 1;\n",
    });
  });

  it("G2: a missing file, a folder, a file over the size limit: unreadable, saying why", () => {
    const place = world();
    const missing = join(place.repo, "nope.js");
    expect(scriptAtPath(missing, place.cwd)).toEqual({
      unreadable: `The workflow script \`${missing}\` does not exist.`,
    });
    expect(scriptAtPath(place.repo, place.cwd)).toEqual({
      unreadable: `The workflow script \`${place.repo}\` is not a file.`,
    });
    const big = join(place.repo, "big.js");
    put(big, `${workflowFile("big")}${"x".repeat(WORKFLOW_SCRIPT_MAX_BYTES)}`);
    expect(scriptAtPath(big, place.cwd)).toEqual({
      unreadable: `The workflow script \`${big}\` is larger than the 524288 bytes Claude Code runs.`,
    });
  });
});

describe("G2: a saved workflow by its bare name", () => {
  it("G2: the project's `.claude/workflows/`, matched by meta.name, not by the file name", () => {
    const place = world();
    const file = join(place.repo, ".claude", "workflows", "any-file-name.js");
    put(file, workflowFile("probe"));
    put(join(place.repo, ".claude", "workflows", "other.js"), workflowFile("other"));
    // Not a workflow: another extension, or meta that is not a pure literal.
    put(join(place.repo, ".claude", "workflows", "probe.mjs"), workflowFile("probe"));
    put(
      join(place.repo, ".claude", "workflows", "broken.js"),
      "export const meta = { name: n, description: 'd' };",
    );
    expect(scriptByName("probe", place)).toEqual({ file, script: workflowFile("probe") });
  });

  it("G2: found in the user folder only", () => {
    const place = world();
    const file = join(place.claudeConfigDir, "workflows", "probe.js");
    put(file, workflowFile("probe"));
    expect(scriptByName("probe", place)).toEqual({ file, script: workflowFile("probe") });
  });

  it("G2: the nearest folder wins: the cwd's over the repo root's, the project's over the user's", () => {
    const place = world();
    put(join(place.claudeConfigDir, "workflows", "probe.js"), workflowFile("probe", "// user"));
    put(join(place.repo, ".claude", "workflows", "probe.js"), workflowFile("probe", "// root"));
    expect(scriptByName("probe", place)).toEqual({
      file: join(place.repo, ".claude", "workflows", "probe.js"),
      script: workflowFile("probe", "// root"),
    });
    put(join(place.cwd, ".claude", "workflows", "probe.js"), workflowFile("probe", "// near"));
    expect(scriptByName("probe", place)).toEqual({
      file: join(place.cwd, ".claude", "workflows", "probe.js"),
      script: workflowFile("probe", "// near"),
    });
  });

  it("G2: the walk stops at the repo root: a folder above it is not read", () => {
    const place = world();
    put(join(place.home, "code", ".claude", "workflows", "probe.js"), workflowFile("probe"));
    expect(scriptByName("probe", place)).toEqual({
      unreadable:
        "The workflow `probe` has no file the guard can find: a built-in workflow (its script is inside Claude Code), or a saved one the guard cannot read.",
    });
  });

  it("G2: two files in one folder claim one name: unreadable, naming both", () => {
    const place = world();
    const a = join(place.repo, ".claude", "workflows", "a.js");
    const b = join(place.repo, ".claude", "workflows", "b.js");
    put(a, workflowFile("probe", "// one"));
    put(b, workflowFile("probe", "// two"));
    expect(scriptByName("probe", place)).toEqual({
      unreadable: `Two files claim the workflow name \`probe\`: \`${a}\` and \`${b}\`. Claude Code runs one of them, and which one depends on the order the folder lists them, so the guard cannot tell. Give each workflow its own \`meta.name\`.`,
    });
    // The same text twice (a copy, a link) is one script: no doubt which runs.
    put(b, workflowFile("probe", "// one"));
    expect(scriptByName("probe", place)).toEqual({
      file: a,
      script: workflowFile("probe", "// one"),
    });
  });

  it("G2: an input with no cwd reads no project folder, and no relative path", () => {
    const place = world();
    // The hook's own working folder (a temp one here) is not the session's: nothing in it is read.
    const hookFolder = tempDir("wf-hook-cwd");
    put(join(hookFolder, ".claude", "workflows", "never-here.js"), workflowFile("never-here"));
    const before = process.cwd();
    process.chdir(hookFolder);
    try {
      expect(scriptByName("never-here", { ...place, cwd: "" })).toEqual({
        unreadable:
          "The workflow `never-here` has no file the guard can find: a built-in workflow (its script is inside Claude Code), or a saved one the guard cannot read.",
      });
      expect(scriptAtPath(".claude/workflows/never-here.js", "")).toEqual({
        unreadable:
          "The workflow script `.claude/workflows/never-here.js` is a relative path, and the hook input names no folder it is relative to.",
      });
    } finally {
      process.chdir(before);
    }
    // The user folder is still read.
    put(join(place.claudeConfigDir, "workflows", "probe.js"), workflowFile("probe"));
    expect(scriptByName("probe", { ...place, cwd: "" })).toEqual({
      file: join(place.claudeConfigDir, "workflows", "probe.js"),
      script: workflowFile("probe"),
    });
  });

  it("G2: a built-in name, or one with no file: unreadable", () => {
    const place = world();
    expect(scriptByName("deep-research", place)).toEqual({
      unreadable:
        "The workflow `deep-research` has no file the guard can find: a built-in workflow (its script is inside Claude Code), or a saved one the guard cannot read.",
    });
  });
});

describe("G2: a plugin's workflow, `<plugin>:<name>`", () => {
  /** A plugin folder holding `workflows/<file>` with `meta.name` `name`. */
  function plugin(root: string, name: string, body = "return 1;"): void {
    put(join(root, "workflows", `${name}.js`), workflowFile(name, body));
  }

  function installed(place: WorkflowPlace, plugins: Record<string, unknown[]>): void {
    put(place.installedPluginsFile, JSON.stringify({ plugins, version: 2 }));
  }

  it("G2: from the plugin's installed folder, found in installed_plugins.json", () => {
    const place = world();
    const root = join(
      place.claudeConfigDir,
      "plugins",
      "cache",
      "example-market",
      "probe-kit",
      "1.0.0",
    );
    plugin(root, "audit-run");
    installed(place, {
      "probe-kit@example-market": [{ installPath: root, scope: "user", version: "1.0.0" }],
    });
    expect(scriptByName("probe-kit:audit-run", place)).toEqual({
      file: join(root, "workflows", "audit-run.js"),
      script: workflowFile("audit-run"),
    });
  });

  it("G2: a project install for this folder wins over the user one", () => {
    const place = world();
    const user = join(place.home, "p", "user");
    const project = join(place.home, "p", "project");
    const elsewhere = join(place.home, "p", "elsewhere");
    plugin(user, "audit-run", "// user");
    plugin(project, "audit-run", "// project");
    plugin(elsewhere, "audit-run", "// elsewhere");
    installed(place, {
      "probe-kit@example-market": [
        { installPath: user, scope: "user" },
        { installPath: elsewhere, projectPath: join(place.home, "other"), scope: "project" },
        { installPath: project, projectPath: place.repo, scope: "project" },
      ],
    });
    expect(scriptByName("probe-kit:audit-run", place)).toEqual({
      file: join(project, "workflows", "audit-run.js"),
      script: workflowFile("audit-run", "// project"),
    });
  });

  it("G2: the manifest's `workflows` paths replace the default folder", () => {
    const place = world();
    const root = join(place.home, "p", "kit");
    plugin(root, "audit-run", "// default folder, not loaded");
    put(join(root, "flows", "x.js"), workflowFile("audit-run", "// listed folder"));
    put(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "probe-kit", workflows: ["./flows"] }),
    );
    installed(place, { "probe-kit@example-market": [{ installPath: root, scope: "user" }] });
    expect(scriptByName("probe-kit:audit-run", place)).toEqual({
      file: join(root, "flows", "x.js"),
      script: workflowFile("audit-run", "// listed folder"),
    });
    // One `.js` file named on its own.
    put(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ workflows: "./one.js" }));
    put(join(root, "one.js"), workflowFile("audit-run", "// one file"));
    expect(scriptByName("probe-kit:audit-run", place)).toEqual({
      file: join(root, "one.js"),
      script: workflowFile("audit-run", "// one file"),
    });
  });

  it("G2: this plugin's own workflow comes from CLAUDE_PLUGIN_ROOT", () => {
    const place = world();
    const root = join(place.home, "dev", "plugin");
    plugin(root, "audit-run");
    expect(scriptByName("cc-smart-dev-kit:audit-run", { ...place, pluginRoot: root })).toEqual({
      file: join(root, "workflows", "audit-run.js"),
      script: workflowFile("audit-run"),
    });
  });

  it("G2: no installed folder, or no workflow of that name in it: unreadable", () => {
    const place = world();
    expect(scriptByName("probe-kit:audit-run", place)).toEqual({
      unreadable:
        "The workflow `probe-kit:audit-run` belongs to the plugin `probe-kit`, and Claude Code's installed_plugins.json names no installed folder for it.",
    });
    const root = join(place.home, "p", "kit");
    plugin(root, "other");
    installed(place, { "probe-kit@example-market": [{ installPath: root, scope: "user" }] });
    expect(scriptByName("probe-kit:audit-run", place)).toEqual({
      unreadable: `The workflow \`probe-kit:audit-run\`: the plugin's folder \`${root}\` holds no workflow named \`audit-run\`.`,
    });
  });
});
