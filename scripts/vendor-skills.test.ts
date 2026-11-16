import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_VERSIONS } from "../src/mcp/versions";
import { tempDir } from "../src/testing/temp";
import {
  checkBudget,
  parseComponentCosts,
  subtractUserOnlySkills,
  userOnlySkills,
} from "./check-context-budget";
import { checkDocs, SKIPPED_FOLDERS } from "./check-docs";
import { readSourceFiles } from "./check-duplicates";
import {
  patchSkill,
  serializeHashes,
  sha256,
  VENDORED_SKILLS,
  verifyIntegrity,
} from "./vendor-skills";

const root = join(import.meta.dir, "..");

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

const output = `Source: example@inline
Projected token cost
  Always-on: ~1,200 tok
Per-component (rounded)
  component always-on on-invoke
  open ~100 ~2.5k
  private ~150 ~2.5k
  tiny < 20 ~1k
  large ~1.2k ~3k

  On-invoke cost is paid each time a skill or agent fires.
`;

describe("user-only budget (offline)", () => {
  test("reads per-component always-on costs, conservatively counting < 20 as 20", () => {
    expect([...parseComponentCosts(output)]).toEqual([
      ["open", 100],
      ["private", 150],
      ["tiny", 20],
      ["large", 1200],
    ]);
    expect(() => parseComponentCosts("Always-on: ~100 tok")).toThrow("Per-component");
    expect(() => parseComponentCosts(output.replace("~150", "unknown"))).toThrow("component row");
  });

  test("subtracts only user-only skills, and fails closed for missing or impossible rows", () => {
    expect(subtractUserOnlySkills(1200, parseComponentCosts(output), ["private", "tiny"])).toBe(
      1030,
    );
    expect(subtractUserOnlySkills(1200, parseComponentCosts(output), [])).toBe(1200);
    expect(() => subtractUserOnlySkills(1200, parseComponentCosts(output), ["missing"])).toThrow(
      "missing",
    );
    expect(() => subtractUserOnlySkills(100, parseComponentCosts(output), ["private"])).toThrow(
      "exceeds",
    );
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
          /\b(?:npx|bunx(?:\s+--bun)?|pnpm\s+dlx)\s+shadcn(?=[\s`])/,
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
        "npx shadcn init\nbunx shadcn add\npnpm dlx shadcn add\nnpx tsc\nnpx other-package\nbunx shadcn@1.2.3 info",
      ).text,
    ).toBe(
      `bunx shadcn@${MCP_VERSIONS.shadcn} init\nbunx shadcn@${MCP_VERSIONS.shadcn} add\nbunx shadcn@${MCP_VERSIONS.shadcn} add\nnpx tsc\nnpx other-package\nbunx shadcn@1.2.3 info`,
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
      "---\nname: example\nuser-invocable: false\nallowed-tools: Bash(npx shadcn@latest *)\n---\n!`npx shadcn@latest info --json`\nshadcn@latest",
    );
    expect(result.text).toBe(
      `---\nname: example\nallowed-tools: Bash(bunx shadcn@${MCP_VERSIONS.shadcn} *)\ndisable-model-invocation: true\n---\n!\`bunx shadcn@${MCP_VERSIONS.shadcn} info --json\`\nshadcn@${MCP_VERSIONS.shadcn}`,
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
