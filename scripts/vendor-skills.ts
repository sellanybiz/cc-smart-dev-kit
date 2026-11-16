/** Pinned third-party skills. Run by hand to fetch, patch and refresh the file hashes. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { COMMAND } from "../src/build-info/names";
import { MCP_VERSIONS } from "../src/mcp/versions";

const SHADCN = {
  kind: "github",
  url: "https://github.com/shadcn-ui/ui",
  ref: "e62c9435fff729a175f38983dee73b2cb4f6a069",
  licensePath: "LICENSE.md",
  licenseName: "LICENSE.md",
} as const;
const CRAFT = {
  kind: "npm",
  url: "https://registry.npmjs.org/@shadcncraft/skills/-/skills-0.2.0.tgz",
  metadata: "https://registry.npmjs.org/@shadcncraft%2fskills/0.2.0",
  ref: "0.2.0",
  integrity:
    "sha512-Kp9uq0zjz8eiloYqj6YF5dwBRozYhe/Plw1AThY7JUN3u93K/AClhF3TtnOVauT2uxxxodvT22yHROpVhFUa1g==",
  licensePath: "package/LICENSE",
  licenseName: "LICENSE",
} as const;

// BEGIN GENERATED HASHES
const FILE_HASHES: Record<string, Record<string, string>> = {
  shadcn: {
    "assets/showcase/color-pair.tsx":
      "6028f0b677912216822fdaf76ae6b8863c429916ed4a9626b73f4de4506f8ee4",
    "assets/showcase/preview-states.css":
      "8d9e3cec24dd01b11c5ba12196d0376a131797d9ad247ea624e66eb8bbf61b0e",
    "assets/showcase/state-matrix.tsx":
      "07794119fe05ff735358b3f8ca30a8297617ab64dfb3901dce4d89fe5f443458",
    "cli.md": "ea3757ba5790d51dd4328a12e51db9fd7afbc993d6fd7aca17b9c8d9b4360b81",
    "customization.md": "fb51ff154a1d5fed9fc2748dad9ecfc72c523a76bad2c6c10ef8bb9968b161f8",
    "design-system-page.md": "c541d661af159548744be3e27f79e7da710ab83f9afd448a4346f7ff1531d328",
    "design-system.md": "487b0858b1a06152af5743a0ef2a04bd16b4431cf3fc89ef3ba35f0bfe93b37b",
    "LICENSE.md": "1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f",
    "mcp.md": "dccf6028d4b7a44d4634cca200f536af449aa9a9eb68715db105c22849dc161b",
    "registry.md": "1f627d62298e2972cea1f9b16d759f1081bd0e33fa064543ef0ceaeeaa858366",
    "rules/base-vs-radix.md": "db023e920617ecd770864dd5f24d127258d84edd053e7dad9dc4cdf1f761acdf",
    "rules/chat.md": "eeee304643ddcd66f74278bba65c65455ed78cb8d4f8cf156c8fa8b407e4da89",
    "rules/composition.md": "f282df828d83a91132a846ddb62eea149a7c7c94822e9ca88cfddf85af01aa41",
    "rules/forms.md": "29593e14381e34626f8e0e9c15c59f3394b92a0623af6a6ec94585400123853c",
    "rules/icons.md": "d4a58266648872d9ee07d0c2368843a1cb88b8253b7f528dd7bda9d68b6c2535",
    "rules/styling.md": "f88fbd72dff862805b786dc7d7e4c74c83030fc278c5b97c993e4e665001798c",
    "scripts/showcase-coverage.mjs":
      "fb593e0806414d23b51354a46881f0b2873afc226bda0926a22f83cbd60af2fa",
    "SKILL.md": "fb93457cd7bb9c9840ab567d1efb239d3cebcd2611164f74febd821f725b1c1b",
    "VENDORED.md": "1af9c6065061e6966d9a93724eb201b8d2fb45a8ad0d8370f9f40d1a4a99a960",
  },
  "migrate-radix-to-base": {
    "class-mapping.md": "c288738167c663c6188caf958cdac6d72061b0ce44d6bce14d9dc6d40b4e79f9",
    "consumer-props.md": "f6f62f7173b95350339e930eb6ff2c9496b4d5df3571deed78d5b0159f91b1d0",
    "disclosure.md": "f0962f90416ead3290f532b53a66b08a905d4a8fd6ea220b7df63521c9d993ce",
    "display-misc.md": "76dd486105df7f0412e8d526fbeec6fa485c866ff1bf781ddccdc4d87eace0c3",
    "form-controls.md": "66c69dd4077e3e8852a33348f7797bdb5e934192a0cc97ce8f1264ebd137b846",
    "LICENSE.md": "1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f",
    "menus.md": "44188b70c3221a7d18f782641dc7f1a954bc1fa6eb42b788a1935a6613f376d9",
    "overlays.md": "8d9fe2b05eb22a1664637b22e6112190de88a4368420d9cb36002adc108e8a03",
    "SKILL.md": "91dc250fee4269d1a2246801640056cd46881c2b0edd70f22a61ccb1e3499ec4",
    "universal-patterns.md": "c520a81a21c9abd1135b52ad1ecc3d4a127904bbf33199f8d26ae389679346ce",
    "VENDORED.md": "f19474970254408d0c250fc2787bfda500a8476f26d6755b0752b04679e146cd",
    "wrapper-shapes.md": "0bf31ea3e864a12bfa911f058ae135dc3f6f098cb0cc2aa5648b4a3d0bdd51cc",
  },
  "shadcncraft-generate-code": {
    LICENSE: "11cb754a314561b2b313686c66753f417dac707c600aaa5ad47cbf0973a38b7e",
    "references/component-mapping.md":
      "3cece01429808bf9d1088869dcab1d24a51d608df93ced98d560917b2c1e19f2",
    "references/figma-node-hints.json":
      "b78bdfbaf17585c77c4effa1254df913d17b1365a937de6ba816c6a3727ed7a4",
    "references/full-page-frames.md":
      "d68871c882df9b4b976aa8b99a1848bbeeec2c9c5255b3616d1c71c21cdd3ee9",
    "references/icon-handling.md":
      "1e71e969544c1148a30939359cb1062e9ba6788fe2a2f3ca73ecd90de8fe466a",
    "references/icon-name-map.json":
      "a1acc07e35fa3b238dca71e1cd975d17f9ece9553cba59864cf970216bdeb6a6",
    "references/layout-translation.md":
      "e13b14b7ed14bf0e592234797e3f11bd45d513a50e2603f6901efecd4db463f4",
    "references/output-conventions.md":
      "341151202ff7eb9208e2572fbfddd3bad51e1f9ae7541ecef321377b0c90b30c",
    "references/project-setup.md":
      "91082cc76121d9bbe09766f5a75dcefab1a7cfd9130cc775e098fafb59971a10",
    "references/registry-index.json":
      "5aed8c5471aa2e5c3f777b30b5d32d0fb1ad28794195392607e3098d8302415b",
    "references/token-discipline.md":
      "e7f3dd08434f3abb4c4aad02a916327a903c83a792c5e5afdca717b8341e88c1",
    "SKILL.md": "31ce0fcf1708466eaa2959da1f072ec441bc6ee60e0628f7f9bf7c66e1e2438c",
    "VENDORED.md": "0794e7dbc5b1939ff5ba7da78b96c4291848e489b13b62caf1f4ee0d8a60ffdc",
  },
  "shadcncraft-import-variables": {
    LICENSE: "11cb754a314561b2b313686c66753f417dac707c600aaa5ad47cbf0973a38b7e",
    "references/figma-collections.md":
      "7bc8342d50760c950cd17f673593d6c85024d2bfb460b6e973cb859ebed6d9d4",
    "references/managed-region.md":
      "02977941f539abbaeaeade97bf16caf91c9e8ce02d0737611ac270b143de7fed",
    "references/token-mapping.md":
      "2514941e40daa13af249f0013b0f4145f7d5b7cd46aad08af935a438b7b9e7df",
    "references/token-sources.md":
      "abe7a3e2c29d429dd13ace405bcdf73d2e083b67e0707512417aca5784813427",
    "SKILL.md": "1ef47a07dc2123659f90d26de7e32bdce3fa5728a39d122e868727627e4f225f",
    "VENDORED.md": "46010531dbb2841e00c09321ac4b8fc8aae5640d89080088b2bf103c46f4070c",
  },
  "shadcncraft-import-app": {
    LICENSE: "11cb754a314561b2b313686c66753f417dac707c600aaa5ad47cbf0973a38b7e",
    "references/kit-manifest.json":
      "5dda17ba3254f25cb8d65fa11299347641ee5dd49fe83773971d347ee69590d2",
    "references/plan-schema.md": "d0d1ae40abed8db011a4449137fc160b279cf118d9c6cc6670927fa14660a433",
    "references/scan-rules.md": "a30af109bd13afa8ff4de2048dc31d570e19549172f988a5ffa1b492c2f55b51",
    "SKILL.md": "41f9cbc7a1ea36ff7f70837bb26303dc8fcf708576665a8935cc9fca3b413cfe",
    "VENDORED.md": "122c40f7aea30b6e49f8ee8cf57dda1874e490eddbf16c348e7ba7d136f195b0",
  },
  "shadcncraft-import-block": {
    LICENSE: "11cb754a314561b2b313686c66753f417dac707c600aaa5ad47cbf0973a38b7e",
    "references/block-recipes.md":
      "2a069956a2df4d6e4b351eba96bfdde8df7a396b87d46d69e354731d112de00d",
    "SKILL.md": "6aeab1910acec739b8be5346297e7641ddd459dd4d2603e3cf2079c7fd19d779",
    "VENDORED.md": "ac782468710d45a1d63a6c1a94c5ed2c9f78f100d594ad7ca1b28b8135a06a80",
  },
  "shadcncraft-import-component": {
    LICENSE: "11cb754a314561b2b313686c66753f417dac707c600aaa5ad47cbf0973a38b7e",
    "references/component-recipes.md":
      "e7109970fa5866418b4fa480e8c8e8395e57bcf645335ae0fa0a5d8317b9e00d",
    "SKILL.md": "7ac3dbf4cc937152652704a7ce4f48df456fca490d360b456adba8fcc460f6e5",
    "VENDORED.md": "b598da8fbe1e8b40b3c4685dabac343eaa1535fc7146c0fd89b8d5a371bd8bd7",
  },
};
// END GENERATED HASHES

const PATCHES = ["bun-runner-and-pin", "pin-unversioned-runner", "user-only"] as const;
type Patch = (typeof PATCHES)[number] | "registered-mcp" | "local-license-key" | "runner-wording";
export interface VendoredSkill {
  folder: string;
  source: typeof SHADCN | typeof CRAFT;
  upstreamPath: string;
  leftOut: readonly string[];
  patches: readonly Patch[];
  sha256: Record<string, string>;
  upstreamBehaviour: readonly string[];
}

/** One home for sources, exclusions, patches and the hash of every shipped file. */
export const VENDORED_SKILLS: VendoredSkill[] = [
  {
    name: "shadcn",
    source: SHADCN,
    patches: [...PATCHES, "registered-mcp"] as const,
    leftOut: ["assets/shadcn-small.png", "assets/shadcn.png"],
  },
  { name: "migrate-radix-to-base", source: SHADCN, patches: PATCHES },
  {
    name: "shadcncraft-generate-code",
    source: CRAFT,
    patches: [...PATCHES, "local-license-key", "runner-wording"] as const,
  },
  { name: "shadcncraft-import-variables", source: CRAFT, patches: PATCHES },
  { name: "shadcncraft-import-app", source: CRAFT, patches: PATCHES },
  { name: "shadcncraft-import-block", source: CRAFT, patches: PATCHES },
  { name: "shadcncraft-import-component", source: CRAFT, patches: PATCHES },
].map(({ name, source, patches, leftOut }) => ({
  folder: `plugin/skills/${name}`,
  source,
  upstreamPath: `${source.kind === "npm" ? "package/" : ""}skills/${name}/`,
  leftOut: ["agents/", "evals/", ...(leftOut ?? [])],
  patches,
  sha256: FILE_HASHES[name] ?? {},
  upstreamBehaviour:
    name === "shadcn"
      ? ["Non-shadcn package runners (npx tsc and npm install) follow the project's own tooling."]
      : name === "migrate-radix-to-base"
        ? [
            "Migration uses one commit per component and writes its own .migration reports; the project's workflow and approval rules still apply.",
          ]
        : name.startsWith("shadcncraft-import-") && name !== "shadcncraft-import-variables"
          ? [
              "Upstream recommends particular models; the person's model choice and approval rules still apply.",
              "Import work keeps its own import-plan.json and build notes in the project.",
              "Upstream names shadcncraft-new-component, which 0.2.0 does not publish; those steps are unavailable.",
            ]
          : name === "shadcncraft-generate-code"
            ? [
                "Package runners and non-shadcn tooling follow the project's own conventions.",
                "Upstream names shadcncraft-compose-page, which 0.2.0 does not publish; those steps are unavailable.",
              ]
            : ["Package runners and non-shadcn tooling follow the project's own conventions."],
}));

export function isVendored(path: string): boolean {
  return VENDORED_SKILLS.some((skill) => path.startsWith(`${skill.folder}/`));
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyIntegrity(bytes: Uint8Array, integrity: string): void {
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== integrity) throw new Error(`npm archive integrity mismatch: ${actual}`);
}

export interface PatchCounts {
  runner: number;
  pin: number;
  dmi: number;
  mcp: number;
  unversioned: number;
  secret: number;
  wording: number;
}

/** Text-only patches; binary assets pass through unchanged in prepareSkill. */
export function patchSkill(
  skill: VendoredSkill,
  path: string,
  input: string,
): {
  text: string;
  counts: PatchCounts;
} {
  const counts: PatchCounts = {
    runner: 0,
    pin: 0,
    dmi: 0,
    mcp: 0,
    unversioned: 0,
    secret: 0,
    wording: 0,
  };
  let text = input;
  if (skill.patches.includes("bun-runner-and-pin")) {
    text = text
      .replaceAll("npx shadcn@latest", () => {
        counts.runner += 1;
        return `bunx shadcn@${MCP_VERSIONS.shadcn}`;
      })
      .replaceAll("shadcn@latest", () => {
        counts.pin += 1;
        return `shadcn@${MCP_VERSIONS.shadcn}`;
      });
  }
  if (skill.patches.includes("pin-unversioned-runner")) {
    text = text.replace(/\b(?:npx|bunx(?:\s+--bun)?|pnpm\s+dlx)\s+shadcn(?=[\s`])/g, () => {
      counts.unversioned += 1;
      return `bunx shadcn@${MCP_VERSIONS.shadcn}`;
    });
  }
  if (path === "references/project-setup.md" && skill.patches.includes("local-license-key")) {
    const instruction = "**If the key is missing, stop and ask the user for it.**";
    if (text.split(instruction).length !== 2)
      throw new Error(`${path}: secret instruction changed; inspect the patch`);
    text = text.replace(
      instruction,
      "**If the key is missing, stop and tell the person to set SHADCNCRAFT_LICENSE_KEY themselves in their own environment or the project's ignored env file; never ask them to paste it into the conversation.**",
    );
    counts.secret += 1;
  }
  if (path === "references/component-mapping.md" && skill.patches.includes("runner-wording")) {
    const instruction = "The commands above show `npx`";
    if (text.split(instruction).length !== 2)
      throw new Error(`${path}: runner wording changed; inspect the patch`);
    text = text.replace(
      instruction,
      `The commands above show \`bunx shadcn@${MCP_VERSIONS.shadcn}\``,
    );
    counts.wording += 1;
  }
  if (path === "SKILL.md" && skill.patches.includes("user-only")) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!frontmatter) throw new Error(`${skill.folder}: missing frontmatter`);
    const body = (frontmatter[1] ?? "")
      .replace(/^user-invocable:\s*false\r?\n?/gm, "")
      .replace(/^disable-model-invocation:.*\r?\n?/gm, "")
      .trimEnd();
    text = text.replace(frontmatter[0], `---\n${body}\ndisable-model-invocation: true\n---`);
    counts.dmi += 1;
  }
  if (
    skill.patches.includes("registered-mcp") &&
    /shadcn(?:@[^\s`]+)? mcp init|\.mcp\.json/.test(text)
  ) {
    const note = `The ${COMMAND} plugin already registers the shadcn MCP server for every project; do not run MCP init or add a project MCP config.`;
    // Keep other editors' upstream setup, but remove instructions that override our registration.
    text = text
      .replace(/^.*shadcn(?:@[^\s`]+)? mcp init.*\r?\n/gm, "")
      .replace(/^\| Claude Code \|.*\r?\n/gm, "");
    text = text.replace("## Setup", `## Setup\n\n${note}`);
    if (!text.includes(note)) throw new Error(`${path}: MCP setup changed; inspect the patch`);
    counts.mcp += 1;
  }
  return { text, counts };
}

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** List at the pinned commit, then read raw blobs; never execute upstream code. */
async function githubFiles(): Promise<Map<string, Uint8Array>> {
  const response = await get(
    `https://api.github.com/repos/shadcn-ui/ui/git/trees/${SHADCN.ref}?recursive=1`,
  );
  const tree = z
    .object({
      truncated: z.boolean(),
      tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string() })),
    })
    .parse(await response.json());
  if (tree.truncated) throw new Error("GitHub returned a truncated file tree");
  const files = new Map<string, Uint8Array>();
  for (const entry of tree.tree) {
    const selected = VENDORED_SKILLS.some(
      (skill) =>
        skill.source === SHADCN &&
        entry.path.startsWith(skill.upstreamPath) &&
        !skill.leftOut.some((path) => entry.path.startsWith(skill.upstreamPath + path)),
    );
    if (entry.path !== SHADCN.licensePath && !selected) continue;
    if (entry.type === "tree") continue;
    if (entry.type !== "blob" || entry.mode === "120000")
      throw new Error(`Not a regular file: ${entry.path}`);
    const file = await get(
      `https://raw.githubusercontent.com/shadcn-ui/ui/${SHADCN.ref}/${entry.path}`,
    );
    files.set(entry.path, new Uint8Array(await file.arrayBuffer()));
  }
  return files;
}

/** Read verified archive entries in memory: no extraction, path traversal or script execution. */
async function npmFiles(): Promise<Map<string, Uint8Array>> {
  const metadata = z
    .object({ dist: z.object({ integrity: z.string(), tarball: z.string() }) })
    .parse(await (await get(CRAFT.metadata)).json());
  if (metadata.dist.integrity !== CRAFT.integrity || metadata.dist.tarball !== CRAFT.url) {
    throw new Error("npm registry metadata no longer matches the pinned source");
  }
  const bytes = new Uint8Array(await (await get(CRAFT.url)).arrayBuffer());
  verifyIntegrity(bytes, CRAFT.integrity);
  const files = new Map<string, Uint8Array>();
  for (const [path, file] of await new Bun.Archive(bytes).files()) {
    files.set(path, new Uint8Array(await file.arrayBuffer()));
  }
  return files;
}

function prepareSkill(
  skill: VendoredSkill,
  upstream: Map<string, Uint8Array>,
  date: string,
): {
  files: Map<string, Uint8Array>;
  counts: PatchCounts;
} {
  const files = new Map<string, Uint8Array>();
  const counts: PatchCounts = {
    runner: 0,
    pin: 0,
    dmi: 0,
    mcp: 0,
    unversioned: 0,
    secret: 0,
    wording: 0,
  };
  for (const [path, bytes] of upstream) {
    if (!path.startsWith(skill.upstreamPath)) continue;
    const local = path.slice(skill.upstreamPath.length);
    if (skill.leftOut.some((part) => local.startsWith(part))) continue;
    if (local.split("/").some((part) => part === ".." || part === ""))
      throw new Error(`Unsafe path: ${path}`);
    if (bytes.includes(0)) files.set(local, bytes);
    else {
      const patched = patchSkill(
        skill,
        local,
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      for (const key of Object.keys(counts) as (keyof PatchCounts)[])
        counts[key] += patched.counts[key];
      files.set(local, new TextEncoder().encode(patched.text));
    }
  }
  if (!files.has("SKILL.md")) throw new Error(`${skill.folder}: upstream skill is missing`);
  const license = upstream.get(skill.source.licensePath);
  if (!license) throw new Error(`${skill.folder}: upstream license is missing`);
  files.set(skill.source.licenseName, license);
  const provenance = [
    "# Vendored skill",
    "",
    `Source: ${skill.source.url}`,
    `Ref: ${skill.source.ref}`,
    ...(skill.source.kind === "npm" ? [`Integrity: ${skill.source.integrity}`] : []),
    `Upstream path: ${skill.upstreamPath}`,
    `Date: ${date}`,
    "",
    `Left out: ${skill.leftOut.join(", ")}`,
    `Patches: ${skill.patches.join(", ")}.`,
    `The shadcn CLI pin comes from MCP_VERSIONS.shadcn in src/mcp/versions.ts (${MCP_VERSIONS.shadcn}).`,
    `Patch counts: ${JSON.stringify(counts)}.`,
    "",
    "## Upstream behaviour kept",
    "",
    ...skill.upstreamBehaviour.map((behaviour) => `- ${behaviour}`),
    "",
    "Re-vendor with bun scripts/vendor-skills.ts. Do not edit these files by hand.",
    "",
  ].join("\n");
  files.set("VENDORED.md", new TextEncoder().encode(provenance));
  return { files, counts };
}

/** Use the project's installed formatter so regenerated metadata has no formatting diff. */
export function serializeHashes(hashes: Record<string, Record<string, string>>): string {
  const source = `const FILE_HASHES: Record<string, Record<string, string>> = ${JSON.stringify(hashes, null, 2)};\n`;
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome")),
      "format",
      "--stdin-file-path=scripts/vendor-skills.ts",
    ],
    { cwd: join(import.meta.dir, ".."), input: source, encoding: "utf8" },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Cannot format vendor hashes: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

async function main(): Promise<void> {
  const root = join(import.meta.dir, "..");
  const [github, npm] = await Promise.all([githubFiles(), npmFiles()]);
  // Fixed source date makes a second run byte-for-byte identical; move it with a source update.
  const prepared = VENDORED_SKILLS.map((skill) => ({
    skill,
    ...prepareSkill(skill, skill.source.kind === "github" ? github : npm, "2026-11-16"),
  }));
  const hashes: Record<string, Record<string, string>> = {};
  for (const { skill, files, counts } of prepared) {
    const folder = join(root, skill.folder);
    rmSync(folder, { recursive: true, force: true });
    const entries: Record<string, string> = {};
    for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), bytes);
      entries[path] = sha256(bytes);
    }
    hashes[skill.folder.split("/").at(-1) ?? ""] = entries;
    console.log(`${skill.folder}: ${files.size} files; patches ${JSON.stringify(counts)}`);
  }
  const script = join(import.meta.dir, "vendor-skills.ts");
  writeFileSync(
    script,
    readFileSync(script, "utf8").replace(
      /\/\/ BEGIN GENERATED HASHES\n[\s\S]*?\/\/ END GENERATED HASHES/,
      `// BEGIN GENERATED HASHES\n${serializeHashes(hashes)}// END GENERATED HASHES`,
    ),
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`vendor-skills: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
