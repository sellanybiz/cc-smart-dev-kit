import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
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
  return { paths, checkout: join(home, "repo") };
}

const PINNED = "---\nname: checker\nmodel: sonnet\neffort: high\n---\nRead only.\n";

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
      "---\nname: checker\nmodel: inherit\n---\n",
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

  it("fixed built-ins supply models, dynamic built-ins do not guess", () => {
    const p = place();
    expect(agentDefinition("claude-code-guide", p)).toEqual({ model: "haiku", effort: null });
    expect(agentDefinition("statusline-setup", p)).toEqual({ model: "sonnet", effort: null });
    for (const name of ["Explore", "Plan", "general-purpose", "web-fetch"]) {
      expect(agentDefinition(name, p)).toEqual({ model: null, effort: null });
    }
  });
});
