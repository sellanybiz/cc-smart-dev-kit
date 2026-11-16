/** Pinned third-party skills. Run by hand to fetch, patch and refresh the file hashes. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
const FILE_HASHES: Record<string, Record<string, string>> = {};
// END GENERATED HASHES

const PATCHES = ["bun-runner-and-pin", "user-only"] as const;
type Patch = (typeof PATCHES)[number] | "registered-mcp";
export interface VendoredSkill {
  folder: string;
  source: typeof SHADCN | typeof CRAFT;
  upstreamPath: string;
  leftOut: readonly string[];
  patches: readonly Patch[];
  sha256: Record<string, string>;
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
  { name: "shadcncraft-generate-code", source: CRAFT, patches: PATCHES },
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
  const counts: PatchCounts = { runner: 0, pin: 0, dmi: 0, mcp: 0 };
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
  const counts: PatchCounts = { runner: 0, pin: 0, dmi: 0, mcp: 0 };
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
    "Re-vendor with bun scripts/vendor-skills.ts. Do not edit these files by hand.",
    "",
  ].join("\n");
  files.set("VENDORED.md", new TextEncoder().encode(provenance));
  return { files, counts };
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
      `// BEGIN GENERATED HASHES\nconst FILE_HASHES: Record<string, Record<string, string>> = ${JSON.stringify(hashes, null, 2)};\n// END GENERATED HASHES`,
    ),
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`vendor-skills: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
