/** The claims signal: the phrases, the names a claim gives, and the diff lines that define them. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import {
  type AddedLine,
  type Claim,
  type ClaimsReport,
  claimsLines,
  collectClaims,
  findHits,
  parseAddedLines,
  parseClaims,
} from "./claims";

const PRICES_CLAIM: Claim = {
  file: "docs/prices.md",
  line: 3,
  phrase: "the one home",
  names: ["formatPrice"],
};

function added(file: string, text: string, line = 1): AddedLine {
  return { file, line, text };
}

describe("parseClaims", () => {
  test("a grep record gives the file, the line, the phrase and the backticked names", () => {
    const output = [
      "docs/prices.md\u00003\u0000The one home for prices is `formatPrice` and `fmt()`; see `docs/x.md`.",
      "src/a.ts\u0000" + "12\u0000// the only place that reads the clock",
    ].join("\n");
    expect(parseClaims(output)).toEqual([
      { file: "docs/prices.md", line: 3, phrase: "the one home", names: ["formatPrice", "fmt"] },
      { file: "src/a.ts", line: 12, phrase: "the only place", names: [] },
    ]);
  });

  test("a name under three characters, a path and a word with a dot are not symbols", () => {
    const [claim] = parseClaims(
      "a.md\u00001\u0000The one home: `ab`, `src/a.ts`, `a.b`, `parseDate`",
    );
    expect(claim?.names).toEqual(["parseDate"]);
  });

  test("an empty output holds no claim", () => {
    expect(parseClaims("")).toEqual([]);
  });
});

describe("parseAddedLines", () => {
  test("each added line has its file and its line in the new file", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -4,0 +5,2 @@ context",
      "+const one = 1;",
      "+const two = 2;",
      "@@ -20 +22 @@",
      "-old",
      "+const three = 3;",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-removed",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { file: "src/a.ts", line: 5, text: "const one = 1;" },
      { file: "src/a.ts", line: 6, text: "const two = 2;" },
      { file: "src/a.ts", line: 22, text: "const three = 3;" },
    ]);
  });
});

describe("findHits", () => {
  const forms: [string, string][] = [
    ["function", "export function formatPrice(cents: number) {"],
    ["async function", "async function formatPrice() {}"],
    ["const", "export const formatPrice = (cents) => cents;"],
    ["let", "let formatPrice;"],
    ["class", "class formatPrice {}"],
    ["type", "export type formatPrice = string;"],
    ["interface", "interface formatPrice {}"],
    ["def", "def formatPrice(cents):"],
    ["fn", "pub fn formatPrice() {"],
    ["func", "func formatPrice() {"],
    ["assignment", "  formatPrice = (cents) => cents"],
  ];
  for (const [form, text] of forms) {
    test(`${form}: an added definition in another file is a hit`, () => {
      expect(findHits([PRICES_CLAIM], [added("src/cart.ts", text, 9)])).toEqual([
        {
          file: "src/cart.ts",
          line: 9,
          name: "formatPrice",
          claim: { file: "docs/prices.md", line: 3 },
        },
      ]);
    });
  }

  test("a definition in the claim's own file is no hit", () => {
    expect(
      findHits([PRICES_CLAIM], [added("docs/prices.md", "function formatPrice() {}")]),
    ).toEqual([]);
  });

  test("a re-export, a call and an import define nothing", () => {
    const lines = [
      'export { formatPrice } from "./prices";',
      "const total = formatPrice(10);",
      'import { formatPrice } from "./prices";',
      "if (formatPrice == (1)) {}",
    ];
    expect(
      findHits(
        [PRICES_CLAIM],
        lines.map((text) => added("src/cart.ts", text)),
      ),
    ).toEqual([]);
  });

  test("a name no claim gives to one home is no hit", () => {
    expect(findHits([PRICES_CLAIM], [added("src/cart.ts", "function other() {}")])).toEqual([]);
  });

  test("a line that defines two claimed names is one hit for each", () => {
    const claims: Claim[] = [
      PRICES_CLAIM,
      { file: "docs/dates.md", line: 1, phrase: "one home for", names: ["formatDate"] },
    ];
    const hits = findHits(claims, [
      added("src/cart.ts", "const formatPrice = 1; function formatDate() {}", 4),
    ]);
    expect(hits.map((hit) => [hit.name, hit.claim.file]).sort()).toEqual([
      ["formatDate", "docs/dates.md"],
      ["formatPrice", "docs/prices.md"],
    ]);
  });

  test("a name claimed in two files reports the claim in a file other than the definition's", () => {
    const claims: Claim[] = [
      { ...PRICES_CLAIM, file: "src/cart.ts", line: 1 },
      { ...PRICES_CLAIM, file: "docs/prices.md", line: 3 },
    ];
    const [hit] = findHits(claims, [added("src/cart.ts", "const formatPrice = 1;")]);
    expect(hit?.claim).toEqual({ file: "docs/prices.md", line: 3 });
  });
});

/** A repository with a claim on `main` and a branch that defines the claimed name again. */
function repoWithBranch(): string {
  const repo = tempDir("claims");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "docs"));
  mkdirSync(join(repo, "dist"));
  writeFileSync(
    join(repo, "docs/prices.md"),
    "# Prices\n\nA line.\nThe one home for prices is `formatPrice`, in src/prices.ts.\n",
  );
  writeFileSync(join(repo, "src.ts"), "export function formatPrice() {}\n");
  writeFileSync(join(repo, "dist/bundle.js"), "// the one home for `skipped`\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "checkout", "-q", "-b", "feature");
  writeFileSync(join(repo, "cart.ts"), "const x = 1;\nexport const formatPrice = (n) => n;\n");
  writeFileSync(join(repo, "dist/other.js"), "function formatPrice() {}\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "second");
  return repo;
}

describe("collectClaims", () => {
  test("finds the claims, skips build output, and finds the second definition in the diff", () => {
    const repo = repoWithBranch();
    expect(collectClaims(repo, cleanGitEnv(), { ref: "main" })).toEqual({
      claims: [
        {
          file: "docs/prices.md",
          line: 4,
          phrase: "the one home",
          names: ["formatPrice"],
        },
      ],
      hits: [
        {
          file: "cart.ts",
          line: 2,
          name: "formatPrice",
          claim: { file: "docs/prices.md", line: 4 },
        },
      ],
      diffWhy: null,
    });
  });

  test("with no base it lists the claims and says why no diff was read", () => {
    const repo = repoWithBranch();
    const report = collectClaims(repo, cleanGitEnv(), { why: "origin/HEAD is not set" });
    expect(report).toEqual({
      claims: [{ file: "docs/prices.md", line: 4, phrase: "the one home", names: ["formatPrice"] }],
      hits: [],
      diffWhy: "origin/HEAD is not set",
    });
  });

  test("a repository with no claim is an answer, not a failure", () => {
    const repo = tempDir("claims-none");
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "first");
    expect(collectClaims(repo, cleanGitEnv(), { ref: "HEAD" })).toEqual({
      claims: [],
      hits: [],
      diffWhy: null,
    });
  });

  test("a base git cannot diff against is said in the report, with the claims kept", () => {
    const repo = repoWithBranch();
    const report = collectClaims(repo, cleanGitEnv(), { ref: "no-such-ref" });
    expect(report).toMatchObject({ hits: [] });
    expect((report as ClaimsReport).claims).toHaveLength(1);
    expect((report as ClaimsReport).diffWhy).toStartWith("git diff no-such-ref...HEAD failed:");
  });

  test("a folder that is not a git repository is an error line", () => {
    const folder = tempDir("claims-not-git");
    const report = collectClaims(folder, cleanGitEnv(), { ref: "main" });
    expect(report).toEqual({ error: expect.stringContaining("git grep failed:") });
  });
});

describe("claimsLines", () => {
  const rest = "kit workflow claims --json";

  test("the claims, then what the diff re-defines", () => {
    const report: ClaimsReport = {
      claims: [PRICES_CLAIM, { file: "src/a.ts", line: 12, phrase: "the only place", names: [] }],
      hits: [
        {
          file: "cart.ts",
          line: 2,
          name: "formatPrice",
          claim: { file: "docs/prices.md", line: 3 },
        },
      ],
      diffWhy: null,
    };
    expect(claimsLines(report, rest)).toEqual([
      "Claims (2):",
      "  docs/prices.md:3 — the one home — names: formatPrice",
      "  src/a.ts:12 — the only place — names: none",
      "Re-defined in this diff (1):",
      "  cart.ts:2 defines formatPrice, which docs/prices.md:3 calls its one home",
    ]);
  });

  test("no diff: the reason replaces the second list", () => {
    expect(claimsLines({ claims: [], hits: [], diffWhy: "this folder has no base" }, rest)).toEqual(
      ["Claims (0):", "No diff was read: this folder has no base"],
    );
  });

  test("a long list stops at the usual cap and says how to read the rest", () => {
    const claims = Array.from({ length: 10 }, (_, index) => ({
      ...PRICES_CLAIM,
      line: index + 1,
    }));
    const lines = claimsLines({ claims, hits: [], diffWhy: null }, rest);
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("Claims (10):");
    expect(lines[8]).toBe("  docs/prices.md:8 — the one home — names: formatPrice");
    expect(lines[9]).toBe(`+2 more: ${rest}`);
    expect(lines[10]).toBe("Re-defined in this diff (0):");
  });
});
