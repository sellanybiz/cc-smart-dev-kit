import { describe, expect, it } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { agentDefinition } from "./agent-definition";

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function place() {
  const home = tempDir("agent-definitions");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  const checkout = join(home, "repo");
  mkdirSync(checkout, { recursive: true });
  return {
    paths,
    checkout,
    managedAgentsDir: join(home, "managed", ".claude", "agents"),
  };
}

const PINNED =
  "---\nname: checker\ndescription: Check.\nmodel: sonnet\neffort: high\n---\nRead only.\n";

describe("agent definitions", () => {
  it("matches frontmatter name, not filename, in project and user folders", () => {
    for (const scope of ["project", "user"]) {
      const p = place();
      const root = scope === "project" ? join(p.checkout, ".claude") : p.paths.claudeConfigDir;
      write(join(root, "agents", "other.md"), PINNED);
      expect(agentDefinition("checker", p)).toEqual({ model: "sonnet", effort: "high" });
      expect(agentDefinition("other", p)).toBeNull();
    }
  });

  it("a project definition wins as a whole, even when it leaves fields unset", () => {
    const p = place();
    write(join(p.paths.claudeConfigDir, "agents", "user.md"), PINNED);
    write(
      join(p.checkout, ".claude", "agents", "project.md"),
      "---\nname: checker\ndescription: Check.\nmodel: inherit\n---\n",
    );
    expect(agentDefinition("checker", p)).toEqual({ model: null, effort: null });
  });

  it("reads installed plugin agents, including manifest paths, by qualified name", () => {
    const p = place();
    const root = join(p.paths.home, "plugin");
    write(
      p.paths.installedPluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "probe-kit@example-market": [{ installPath: root, scope: "user" }],
        },
      }),
    );
    write(join(root, "agents", "default.md"), PINNED.replace("checker", "default-checker"));
    write(join(root, "custom", "check.md"), PINNED);
    write(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ agents: ["./custom/check.md"] }),
    );
    expect(agentDefinition("probe-kit:checker", p)).toEqual({ model: "sonnet", effort: "high" });
    expect(agentDefinition("probe-kit:default-checker", p)).toBeNull();
    expect(agentDefinition("checker", p)).toBeNull();
  });

  it("unseen SDK definitions and missing or malformed files supply nothing", () => {
    const p = place();
    write(join(p.checkout, ".claude", "agents", "bad.md"), "---\nname: [\n---\n");
    expect(agentDefinition("sdk-only", p)).toBeNull();
    expect(agentDefinition("bad", p)).toBeNull();
  });

  it("skips invalid local definitions and never lets a qualified name claim a local file", () => {
    for (const scope of ["project", "user"]) {
      for (const name of ["checker", "-checker", "probe:checker", "x".repeat(257)]) {
        const p = place();
        const root = scope === "project" ? join(p.checkout, ".claude") : p.paths.claudeConfigDir;
        const text = name === "checker" ? PINNED.replace("description: Check.\n", "") : PINNED;
        write(join(root, "agents", "bad.md"), text.replace("checker", name));
        expect(agentDefinition(name, p)).toBeNull();
      }
    }
  });

  it("nearest project and then managed definitions win as whole definitions", () => {
    const p = place();
    const cwd = join(p.checkout, "src", "nested");
    write(join(p.checkout, ".claude", "agents", "root.md"), PINNED);
    write(join(cwd, ".claude", "agents", "nested.md"), PINNED.replace("sonnet", "haiku"));
    expect(agentDefinition("checker", { ...p, cwd })).toEqual({ model: "haiku", effort: "high" });
    const managedAgentsDir = join(p.paths.home, "managed", ".claude", "agents");
    write(join(managedAgentsDir, "managed.md"), PINNED.replace("sonnet", "opus"));
    expect(agentDefinition("checker", { ...p, cwd, managedAgentsDir })).toEqual({
      model: "opus",
      effort: "high",
    });
  });

  it("follows symlinked files and directories without looping", () => {
    const p = place();
    const folder = join(p.checkout, ".claude", "agents");
    const source = join(p.paths.home, "source.md");
    write(source, PINNED);
    mkdirSync(folder, { recursive: true });
    symlinkSync(source, join(folder, "linked.md"));
    symlinkSync(folder, join(folder, "loop"), "dir");
    expect(agentDefinition("checker", p)).toEqual({ model: "sonnet", effort: "high" });
  });

  it("a symlinked cwd walks from its real folder; one outside the checkout still scans the root", () => {
    const p = place();
    write(join(p.paths.claudeConfigDir, "agents", "user.md"), PINNED.replace("sonnet", "opus"));
    write(join(p.checkout, ".claude", "agents", "root.md"), PINNED);
    const nested = join(p.checkout, "src", "nested");
    write(join(nested, ".claude", "agents", "nested.md"), PINNED.replace("sonnet", "haiku"));
    const link = join(p.paths.home, "link");
    symlinkSync(nested, link, "dir");
    expect(agentDefinition("checker", { ...p, cwd: link })).toEqual({
      model: "haiku",
      effort: "high",
    });
    const outside = join(p.paths.home, "elsewhere");
    mkdirSync(outside, { recursive: true });
    expect(agentDefinition("checker", { ...p, cwd: outside })).toEqual({
      model: "sonnet",
      effort: "high",
    });
  });

  it("a scan past the depth or entry cap refuses the whole lookup, never a partial answer", () => {
    const deep = place();
    write(join(deep.checkout, ".claude", "agents", "a.md"), PINNED);
    const tree = join(deep.paths.home, "deep");
    let at = tree;
    for (let level = 0; level < 9; level += 1) at = join(at, `d${level}`);
    mkdirSync(at, { recursive: true });
    symlinkSync(tree, join(deep.checkout, ".claude", "agents", "tree"), "dir");
    expect(agentDefinition("checker", deep)).toBeNull();

    const wide = place();
    write(join(wide.checkout, ".claude", "agents", "a.md"), PINNED);
    const many = join(wide.paths.home, "many");
    mkdirSync(many, { recursive: true });
    for (let index = 0; index < 2001; index += 1) writeFileSync(join(many, `${index}.txt`), "");
    symlinkSync(many, join(wide.checkout, ".claude", "agents", "many"), "dir");
    expect(agentDefinition("checker", wide)).toBeNull();

    // Just under both caps, the same definition is read.
    const fits = place();
    write(join(fits.checkout, ".claude", "agents", "a.md"), PINNED);
    let level8 = join(fits.paths.home, "fits");
    for (let level = 0; level < 7; level += 1) level8 = join(level8, `d${level}`);
    mkdirSync(level8, { recursive: true });
    symlinkSync(
      join(fits.paths.home, "fits"),
      join(fits.checkout, ".claude", "agents", "t"),
      "dir",
    );
    expect(agentDefinition("checker", fits)).toEqual({ model: "sonnet", effort: "high" });
  });

  it("fixed built-ins supply models, dynamic built-ins do not guess", () => {
    const p = place();
    expect(agentDefinition("claude-code-guide", p)).toEqual({ model: "haiku", effort: null });
    expect(agentDefinition("statusline-setup", p)).toEqual({ model: "sonnet", effort: null });
    for (const name of ["Explore", "Plan", "general-purpose", "web-fetch"]) {
      expect(agentDefinition(name, p)).toEqual({ model: null, effort: null });
    }
  });
});
