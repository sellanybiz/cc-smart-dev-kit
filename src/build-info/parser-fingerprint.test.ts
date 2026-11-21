import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildEntry } from "../../scripts/build-entry";
import { checkedKey } from "../hooks/checked-config";
import { tempDir } from "../testing/temp";
import { fingerprintOf } from "./parser-fingerprint";

const HERE = import.meta.dir;

/** A small tree: `entry.ts` imports `schema.ts` and `shared/words.ts`; `unrelated.ts` is not reached. */
function tree(schema = 'export const FIELD = "a";\n'): string {
  const root = tempDir("fingerprint-tree");
  mkdirSync(join(root, "shared"));
  writeFileSync(
    join(root, "entry.ts"),
    'import { FIELD } from "./schema";\nimport { WORDS } from "./shared/words";\nexport const both = FIELD + WORDS;\n',
  );
  writeFileSync(join(root, "schema.ts"), schema);
  writeFileSync(join(root, "shared", "words.ts"), 'export const WORDS = "w";\n');
  writeFileSync(join(root, "unrelated.ts"), 'export const OTHER = "x";\n');
  return root;
}

describe("fingerprintOf", () => {
  test("a one-character change in a module the entry reaches changes the hash", () => {
    const root = tree();
    const before = fingerprintOf(join(root, "entry.ts"), root);
    writeFileSync(join(root, "shared", "words.ts"), 'export const WORDS = "v";\n');
    expect(fingerprintOf(join(root, "entry.ts"), root)).not.toBe(before);
  });

  test("a change in a module it does not reach leaves the hash alone", () => {
    const root = tree();
    const before = fingerprintOf(join(root, "entry.ts"), root);
    writeFileSync(join(root, "unrelated.ts"), 'export const OTHER = "y";\n');
    expect(fingerprintOf(join(root, "entry.ts"), root)).toBe(before);
  });

  test("the same tree in another folder gives the same hash, and another fact another hash", () => {
    const one = tree();
    const two = tree();
    expect(fingerprintOf(join(one, "entry.ts"), one)).toBe(
      fingerprintOf(join(two, "entry.ts"), two),
    );
    expect(fingerprintOf(join(one, "entry.ts"), one, ["zod 1"])).not.toBe(
      fingerprintOf(join(one, "entry.ts"), one, ["zod 2"]),
    );
  });
});

describe("a sibling built from another schema at the same version", () => {
  /** Builds a sibling from `root` with the real macro and build options; returns its fingerprint. */
  async function builtFingerprint(root: string): Promise<string> {
    const macro = join(root, "fingerprint-macro.ts");
    writeFileSync(
      macro,
      `import { fingerprintOf } from ${JSON.stringify(join(HERE, "parser-fingerprint"))};\n` +
        `export const fingerprint = (): string => fingerprintOf(${JSON.stringify(join(root, "entry.ts"))}, ${JSON.stringify(root)});\n`,
    );
    const sibling = join(root, "sibling.ts");
    writeFileSync(
      sibling,
      `import { fingerprint } from "./fingerprint-macro" with { type: "macro" };\nexport const FINGERPRINT: string = fingerprint();\n`,
    );
    const out = tempDir("fingerprint-out");
    await buildEntry(sibling, out);
    return ((await import(join(out, "sibling.js"))) as { FINGERPRINT: string }).FINGERPRINT;
  }

  test("gets another fingerprint, so its cache key never meets the first one's entry", async () => {
    const first = await builtFingerprint(tree('export const FIELD = "a";\n'));
    const second = await builtFingerprint(tree('export const FIELD = "b";\n'));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    const bytes = Buffer.from("{}");
    expect(checkedKey(second, "project", bytes)).not.toBe(checkedKey(first, "project", bytes));
  });
});
