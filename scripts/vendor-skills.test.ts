import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_VERSIONS } from "../src/mcp/versions";
import { tempDir } from "../src/testing/temp";
import { checkBudget, copyWithoutSkills, userOnlySkills } from "./check-context-budget";
import { checkDocs, SKIPPED_FOLDERS } from "./check-docs";
import { readSourceFiles } from "./check-duplicates";
import {
  patchSkill,
  prepareSkill,
  serializeHashes,
  sha256,
  skillDestination,
  VENDORED_SKILLS,
  verifyIntegrity,
} from "./vendor-skills";

const root = join(import.meta.dir, "..");

/** The upstream shadcn SKILL.md head, as fetched, written by hand: the frontmatter and runner sentence. */
const UPSTREAM_SKILL_HEAD =
  "---\nname: example\nuser-invocable: false\nallowed-tools: Bash(npx shadcn@latest *), Bash(pnpm dlx shadcn@latest *), Bash(bunx --bun shadcn@latest *)\n---\n> **IMPORTANT:** Run all CLI commands using the project's package runner: `npx shadcn@latest`, `pnpm dlx shadcn@latest`, or `bunx --bun shadcn@latest` — based on the project. Examples below use `npx shadcn@latest` but substitute.";

function filesIn(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

describe("user-only budget (offline)", () => {
  test("the measured copy leaves out exactly the user-only skill folders", () => {
    const folder = tempDir("budget-copy");
    const plugin = join(folder, "plugin");
    for (const file of [
      "skills/open/SKILL.md",
      "skills/private/SKILL.md",
      "skills/private/references/a.md",
      "skills/private-two/SKILL.md",
      "agents/builder.md",
    ]) {
      mkdirSync(join(plugin, file, ".."), { recursive: true });
      writeFileSync(join(plugin, file), "x");
    }
    const copy = join(folder, "copy");
    copyWithoutSkills(plugin, copy, ["private"]);
    expect(filesIn(copy).sort()).toEqual([
      "agents/builder.md",
      "skills/open/SKILL.md",
      "skills/private-two/SKILL.md",
    ]);
    expect(checkBudget(1030, 1000, 2).lines[0]).toContain(
      "2 user-only skills left out: Claude never sees them",
    );
  });

  test("DMI is read from SKILL.md frontmatter, not prose or a vendor list", () => {
    const folder = tempDir("user-only");
    for (const [name, text] of Object.entries({
      private: "---\nname: private\ndisable-model-invocation: true\n---\n",
      open: "---\nname: open\ndisable-model-invocation: false\n---\n",
      prose: "---\nname: prose\n---\ndisable-model-invocation: true\n",
    })) {
      mkdirSync(join(folder, "plugin/skills", name), { recursive: true });
      writeFileSync(join(folder, "plugin/skills", name, "SKILL.md"), text);
    }
    expect(userOnlySkills(folder)).toEqual(["private"]);
  });
});

describe("vendored skills (offline)", () => {
  test("source paths reject traversal and native absolute forms before writes", () => {
    const skill = VENDORED_SKILLS[0];
    if (!skill) throw new Error("missing shadcn skill");
    const folder = tempDir("vendor-paths");
    for (const path of [
      "../escape.txt",
      "..\\..\\escape.txt",
      "/escape.txt",
      "C:escape.txt",
      "C:/escape.txt",
      "\\\\server\\share\\escape.txt",
    ]) {
      const upstream = new Map([[skill.upstreamPath + path, new TextEncoder().encode("bad")]]);
      expect(() => prepareSkill(skill, upstream, "2026-11-16")).toThrow("Unsafe path");
      expect(() => skillDestination(folder, path)).toThrow("Unsafe path");
      expect(readdirSync(folder)).toEqual([]);
    }
    expect(skillDestination(folder, "references/safe.md")).toBe(join(folder, "references/safe.md"));
  });

  test("serialized hashes exactly match the formatted block on disk", () => {
    const source = readFileSync(join(root, "scripts/vendor-skills.ts"), "utf8");
    const block = /\/\/ BEGIN GENERATED HASHES\n([\s\S]*?)\/\/ END GENERATED HASHES/.exec(
      source,
    )?.[1];
    if (block === undefined) throw new Error("missing generated hash block");
    const hashes = Object.fromEntries(
      VENDORED_SKILLS.map((skill) => [skill.folder.split("/").at(-1) ?? "", skill.sha256]),
    );
    expect(serializeHashes(hashes)).toBe(block);
    expect(checkDocs([{ path: "scripts/vendor-skills.ts", text: source }])).toEqual([]);
    expect(
      checkDocs([
        { path: "scripts/vendor-skills.ts", text: `${source}\n// ${"rules/"}missing.md` },
      ]),
    ).toHaveLength(1);
  });
  test("biome and docs exclusions match the vendor table", () => {
    const biome = JSON.parse(readFileSync(join(root, "biome.json"), "utf8"));
    expect(
      biome.files.includes.filter((path: string) => path.startsWith("!plugin/skills/")),
    ).toEqual(VENDORED_SKILLS.map((skill) => `!${skill.folder}`));
    expect(SKIPPED_FOLDERS.filter((path) => path.startsWith("plugin/skills/"))).toEqual(
      VENDORED_SKILLS.map((skill) => `${skill.folder}/`),
    );
    for (const skill of VENDORED_SKILLS) {
      expect(
        checkDocs([{ path: `${skill.folder}/broken.md`, text: "[broken](#missing)" }]),
      ).toEqual([]);
    }
  });

  test("the duplicate scanner leaves out every vendor folder, not neighboring skills", () => {
    const folder = tempDir("vendor-skips");
    for (const skill of [...VENDORED_SKILLS, { folder: "plugin/skills/shadcn-neighbor" }]) {
      mkdirSync(join(folder, skill.folder), { recursive: true });
      writeFileSync(join(folder, skill.folder, "SKILL.md"), "Upstream text");
    }
    expect(readSourceFiles(folder)).toEqual([
      { path: "plugin/skills/shadcn-neighbor/SKILL.md", text: "Upstream text" },
    ]);
  });

  test("every file matches the table, with no missing or extra files", () => {
    expect(VENDORED_SKILLS).toHaveLength(7);
    for (const skill of VENDORED_SKILLS) {
      const folder = join(root, skill.folder);
      expect(filesIn(folder)).toEqual(Object.keys(skill.sha256).sort());
      for (const [file, hash] of Object.entries(skill.sha256)) {
        expect(sha256(readFileSync(join(folder, file)))).toBe(hash);
      }
    }
  });

  test("unversioned shadcn runners are absent from every vendored file", () => {
    for (const skill of VENDORED_SKILLS)
      for (const file of filesIn(join(root, skill.folder))) {
        expect(readFileSync(join(root, skill.folder, file), "utf8")).not.toMatch(
          /\b(?:npx|bunx(?:\s+--bun)?|pnpm\s+dlx|yarn\s+dlx)\s+shadcn(?=[\s`])/,
        );
      }
  });

  test("unversioned runner patch preserves other packages and versioned commands", () => {
    const skill = VENDORED_SKILLS[0];
    if (!skill) throw new Error("missing shadcn skill");
    expect(
      patchSkill(
        skill,
        "fixture.md",
        "npx shadcn init\nbunx shadcn add\npnpm dlx shadcn add\nyarn dlx shadcn add button\nnpx tsc\nnpx other-package\nbunx shadcn@1.2.3 info",
      ).text,
    ).toBe(
      `bunx shadcn@${MCP_VERSIONS.shadcn} init\nbunx shadcn@${MCP_VERSIONS.shadcn} add\nbunx shadcn@${MCP_VERSIONS.shadcn} add\nbunx shadcn@${MCP_VERSIONS.shadcn} add button\nnpx tsc\nnpx other-package\nbunx shadcn@1.2.3 info`,
    );
  });

  test("the npm-runner-entry patch rejects a runner sentence or tools line that drifted", () => {
    const skill = VENDORED_SKILLS[0];
    if (!skill) throw new Error("missing shadcn skill");
    const cliSentence =
      "Always run commands using the project's package runner: `npx shadcn@latest`, `pnpm dlx shadcn@latest`, or `bunx --bun shadcn@latest`.";
    expect(patchSkill(skill, "cli.md", cliSentence).text).toBe(
      `Always run commands using the project's package runner: \`npx shadcn@${MCP_VERSIONS.shadcn}\`, \`pnpm dlx shadcn@${MCP_VERSIONS.shadcn}\`, or \`bunx --bun shadcn@${MCP_VERSIONS.shadcn}\`.`,
    );
    const drifted = cliSentence.replace("or `bunx --bun", "and `bunx --bun");
    expect(() => patchSkill(skill, "cli.md", drifted)).toThrow("npm-runner-entry");
    expect(() => patchSkill(skill, "SKILL.md", UPSTREAM_SKILL_HEAD)).not.toThrow();
    expect(() =>
      patchSkill(
        skill,
        "SKILL.md",
        UPSTREAM_SKILL_HEAD.replace("allowed-tools: Bash(npx", "allowed-tools: Bash(npm"),
      ),
    ).toThrow("npm-runner-entry");
    expect(() => patchSkill(skill, "SKILL.md", `${cliSentence}\n${cliSentence}`)).toThrow(
      "npm-runner-entry",
    );
  });

  test("exact secret and runner-wording patches reject upstream drift", () => {
    const skill = VENDORED_SKILLS.find((entry) =>
      entry.folder.endsWith("/shadcncraft-generate-code"),
    );
    if (!skill) throw new Error("missing generation skill");
    const secret = "**If the key is missing, stop and ask the user for it.**";
    const fixed = patchSkill(skill, "references/project-setup.md", secret);
    expect(fixed.text).toContain("never ask them to paste it into the conversation");
    expect(fixed.text).toContain("ignored env file");
    expect(() => patchSkill(skill, "references/project-setup.md", "upstream changed")).toThrow(
      "secret",
    );
    expect(
      patchSkill(skill, "references/component-mapping.md", "The commands above show `npx`").text,
    ).toBe(`The commands above show \`bunx shadcn@${MCP_VERSIONS.shadcn}\``);
    expect(() => patchSkill(skill, "references/component-mapping.md", "upstream changed")).toThrow(
      "wording",
    );
  });

  test("shipped generation guidance keeps keys local and runner wording consistent", () => {
    const folder = join(root, "plugin/skills/shadcncraft-generate-code/references");
    const setup = readFileSync(join(folder, "project-setup.md"), "utf8");
    expect(setup).toContain("never ask them to paste it into the conversation");
    expect(setup).not.toContain("stop and ask the user for it");
    expect(readFileSync(join(folder, "component-mapping.md"), "utf8")).toContain(
      `The commands above show \`bunx shadcn@${MCP_VERSIONS.shadcn}\``,
    );
  });

  test("the shipped shadcn guide lists npx once in each runner sentence and keeps one bunx for the context line", () => {
    const pin = MCP_VERSIONS.shadcn;
    const folder = join(root, "plugin/skills/shadcn");
    const skill = readFileSync(join(folder, "SKILL.md"), "utf8");
    const cli = readFileSync(join(folder, "cli.md"), "utf8");
    expect(skill).toContain(
      `allowed-tools: Bash(npx shadcn@${pin} *), Bash(pnpm dlx shadcn@${pin} *), Bash(bunx --bun shadcn@${pin} *), Bash(bunx shadcn@${pin} *)\n`,
    );
    for (const text of [skill, cli]) {
      const sentences = text.split("\n").filter((line) => line.includes("package runner:"));
      expect(sentences).toHaveLength(1);
      const [sentence = ""] = sentences;
      expect(sentence.split(`\`npx shadcn@${pin}\``)).toHaveLength(2);
      expect(sentence.split(`bunx shadcn@${pin}`).length - 1).toBeLessThanOrEqual(1);
    }
    expect(skill).toContain(`!\`bunx shadcn@${pin} info --json\``);
  });

  test("every shadcn package pin matches the MCP pin and latest is absent", () => {
    let pins = 0;
    for (const skill of VENDORED_SKILLS) {
      for (const file of filesIn(join(root, skill.folder))) {
        const text = readFileSync(join(root, skill.folder, file), "utf8");
        expect(text).not.toContain("shadcn@latest");
        for (const match of text.matchAll(/\bshadcn@([\w.-]+)/g)) {
          expect(match[1]).toBe(MCP_VERSIONS.shadcn);
          pins += 1;
        }
      }
    }
    expect(pins).toBeGreaterThan(0);
  });

  test("all seven skills are user-only, not hidden from the person", () => {
    for (const skill of VENDORED_SKILLS) {
      const text = readFileSync(join(root, skill.folder, "SKILL.md"), "utf8");
      const frontmatter = text.split("---")[1] ?? "";
      expect(frontmatter).toMatch(/^disable-model-invocation: true$/m);
      expect(frontmatter).not.toMatch(/^user-invocable: false$/m);
    }
  });

  test("every folder carries its MIT notice and provenance", () => {
    for (const skill of VENDORED_SKILLS) {
      const license = readFileSync(join(root, skill.folder, skill.source.licenseName), "utf8");
      expect(license).toContain("Permission is hereby granted, free of charge");
      const provenance = readFileSync(join(root, skill.folder, "VENDORED.md"), "utf8");
      expect(provenance).toContain(skill.source.url);
      expect(provenance).toContain(skill.source.ref);
      expect(provenance).toContain("2026-11-16");
      expect(provenance).toContain("Patches:");
      expect(provenance).toContain("## Upstream behaviour kept");
      for (const behaviour of skill.upstreamBehaviour) expect(provenance).toContain(behaviour);
    }
  });

  test("patches cover dynamic context, tools, metadata, DMI and MCP setup", () => {
    const skill = VENDORED_SKILLS[0];
    if (!skill) throw new Error("missing shadcn skill");
    const result = patchSkill(
      skill,
      "SKILL.md",
      `${UPSTREAM_SKILL_HEAD}\n!\`npx shadcn@latest info --json\`\nshadcn@latest`,
    );
    expect(result.text).toBe(
      `---\nname: example\nallowed-tools: Bash(npx shadcn@${MCP_VERSIONS.shadcn} *), Bash(pnpm dlx shadcn@${MCP_VERSIONS.shadcn} *), Bash(bunx --bun shadcn@${MCP_VERSIONS.shadcn} *), Bash(bunx shadcn@${MCP_VERSIONS.shadcn} *)\ndisable-model-invocation: true\n---\n> **IMPORTANT:** Run all CLI commands using the project's package runner: \`npx shadcn@${MCP_VERSIONS.shadcn}\`, \`pnpm dlx shadcn@${MCP_VERSIONS.shadcn}\`, or \`bunx --bun shadcn@${MCP_VERSIONS.shadcn}\` — based on the project. Examples below use \`bunx shadcn@${MCP_VERSIONS.shadcn}\` but substitute.\n!\`bunx shadcn@${MCP_VERSIONS.shadcn} info --json\`\nshadcn@${MCP_VERSIONS.shadcn}`,
    );
    expect(result.counts).toEqual({
      runner: 2,
      pin: 1,
      dmi: 1,
      mcp: 0,
      unversioned: 0,
      secret: 0,
      wording: 0,
    });
    const mcp = readFileSync(join(root, skill.folder, "mcp.md"), "utf8");
    expect(mcp).toContain("already registers the shadcn MCP server for every project");
    expect(mcp).not.toContain("shadcn mcp init");
    expect(mcp).not.toContain("| Claude Code |");
  });

  test("integrity is checked before reading the npm archive", () => {
    expect(() => verifyIntegrity(new TextEncoder().encode("abc"), "sha512-wrong")).toThrow(
      "integrity",
    );
    expect(() =>
      verifyIntegrity(
        new TextEncoder().encode("abc"),
        "sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==",
      ),
    ).not.toThrow();
  });
});
