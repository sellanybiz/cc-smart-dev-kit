/** The claims signal: the phrases, the names a claim gives, and the diff lines that define them. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import {
  type AddedLine,
  type Claim,
  type ClaimsReport,
  claimedDefinitions,
  claimsLines,
  collectClaims,
  DEFINITION_FORMS,
  type Hit,
  parseAddedLines,
  parseClaims,
  secondHomes,
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

  test("a phrase inside a longer word is no claim", () => {
    const output = [
      "a.md\u00001\u0000Put the one placeholder in `render`.",
      "b.md\u00002\u0000Not everyone home for lunch knew `lunchTime`.",
      "c.md\u00003\u0000The One Place, for `clock`.",
    ].join("\n");
    expect(parseClaims(output)).toEqual([
      { file: "c.md", line: 3, phrase: "the one place", names: ["clock"] },
    ]);
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

  test("a path git quotes is read back: a quote, a backslash, a control character, UTF-8 bytes", () => {
    const diff = [
      '+++ "b/we\\"ird\\\\name.ts"',
      "@@ -0,0 +1 @@",
      "+const one = 1;",
      '+++ "b/tab\\there.ts"',
      "@@ -0,0 +1 @@",
      "+const two = 2;",
      '+++ "b/caf\\303\\251.ts"',
      "@@ -0,0 +1 @@",
      "+const three = 3;",
      "+++ b/sp ace.ts\t",
      "@@ -0,0 +1 @@",
      "+const four = 4;",
    ].join("\n");
    expect(parseAddedLines(diff).map((one) => one.file)).toEqual([
      'we"ird\\name.ts',
      "tab\there.ts",
      "café.ts",
      "sp ace.ts",
    ]);
  });

  test("an added line that starts with ++ is content, not a file header", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3 +3,2 @@",
      "--- old",
      "+++ counter;",
      "+const two = 2;",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { file: "src/a.ts", line: 3, text: "++ counter;" },
      { file: "src/a.ts", line: 4, text: "const two = 2;" },
    ]);
  });
});

describe("claimedDefinitions", () => {
  const forms: [string, string][] = [
    ["function", "export function formatPrice(cents: number) {"],
    ["async function", "async function formatPrice() {}"],
    ["const", "export const formatPrice = (cents) => cents;"],
    ["let", "let formatPrice;"],
    ["class", "class formatPrice {}"],
    ["type", "export type formatPrice = string;"],
    ["generic type", "type formatPrice<T> = T;"],
    ["Go type", "type formatPrice struct {"],
    ["interface", "interface formatPrice {}"],
    ["def", "def formatPrice(cents):"],
    ["fn", "pub fn formatPrice() {"],
    ["func", "func formatPrice() {"],
    ["assignment", "  formatPrice = (cents) => cents"],
  ];
  for (const [form, text] of forms) {
    test(`${form}: an added definition in another file than the claim's is found`, () => {
      expect(claimedDefinitions([PRICES_CLAIM], [added("src/cart.ts", text, 9)])).toEqual([
        {
          file: "src/cart.ts",
          line: 9,
          name: "formatPrice",
          claim: { file: "docs/prices.md", line: 3 },
        },
      ]);
    });
  }

  test("a definition in the claim's own file is not", () => {
    expect(
      claimedDefinitions(
        [{ ...PRICES_CLAIM, file: "src/prices.ts" }],
        [added("src/prices.ts", "function formatPrice() {}")],
      ),
    ).toEqual([]);
  });

  test("an indented const, let or var is a local variable, not a definition", () => {
    const lines = ["  const formatPrice = 1;", "\tlet formatPrice;", "    var formatPrice = 2;"];
    expect(
      claimedDefinitions(
        [PRICES_CLAIM],
        lines.map((text, at) => added("src/cart.ts", text, at + 1)),
      ),
    ).toEqual([]);
  });

  test("a loop's own variable is a local, even on an unindented line", () => {
    const lines = [
      "for (const formatPrice of prices) {",
      "for await (let formatPrice of stream) {",
      "for (var formatPrice = 0; formatPrice < 3; formatPrice++) {",
    ];
    expect(
      claimedDefinitions(
        [PRICES_CLAIM],
        lines.map((text) => added("src/cart.ts", text)),
      ),
    ).toEqual([]);
  });

  test("a re-export, a type-only import or re-export, a call and an import define nothing", () => {
    const lines = [
      'export { formatPrice } from "./prices";',
      'export { type formatPrice } from "./prices";',
      'export { total, type formatPrice } from "./prices";',
      "export type { formatPrice };",
      'import type formatPrice from "./prices";',
      'import { type formatPrice } from "./prices";',
      // Lines of an import or re-export wrapped one specifier a line.
      "  type formatPrice,",
      "  type formatPrice",
      "  type formatPrice as Price,",
      "const total = formatPrice(10);",
      'import { formatPrice } from "./prices";',
      "if (formatPrice == (1)) {}",
    ];
    expect(
      claimedDefinitions(
        [PRICES_CLAIM],
        lines.map((text) => added("src/cart.ts", text)),
      ),
    ).toEqual([]);
  });

  test("a wrapped type specifier is not read as a shorter name either", () => {
    const line = "  type GhExec,";
    expect(DEFINITION_FORMS.flatMap((form) => [...line.matchAll(form)].map((m) => m[1]))).toEqual(
      [],
    );
  });

  test("a prose file and a comment line define nothing", () => {
    const lines = [
      added("README.md", "function formatPrice() {}"),
      added("docs/notes.txt", "const formatPrice = 1;"),
      added("src/cart.ts", "// function formatPrice is gone"),
      added("src/cart.ts", " * const formatPrice was here"),
      added("src/cart.py", "# def formatPrice(cents):"),
      added("src/cart.sql", "-- function formatPrice"),
    ];
    expect(claimedDefinitions([PRICES_CLAIM], lines)).toEqual([]);
  });

  test("a name no claim gives to one home is not found", () => {
    expect(
      claimedDefinitions([PRICES_CLAIM], [added("src/cart.ts", "function other() {}")]),
    ).toEqual([]);
  });

  test("a line that defines two claimed names is found once for each", () => {
    const claims: Claim[] = [
      PRICES_CLAIM,
      { file: "docs/dates.md", line: 1, phrase: "one home for", names: ["formatDate"] },
    ];
    const found = claimedDefinitions(claims, [
      added("src/cart.ts", "const formatPrice = 1; function formatDate() {}", 4),
    ]);
    expect(found.map((one) => [one.name, one.claim.file]).sort()).toEqual([
      ["formatDate", "docs/dates.md"],
      ["formatPrice", "docs/prices.md"],
    ]);
  });

  test("a name claimed in two files names the claim in a file other than the definition's", () => {
    const claims: Claim[] = [
      { ...PRICES_CLAIM, file: "src/cart.ts", line: 1 },
      { ...PRICES_CLAIM, file: "docs/prices.md", line: 3 },
    ];
    const [found] = claimedDefinitions(claims, [added("src/cart.ts", "const formatPrice = 1;")]);
    expect(found?.claim).toEqual({ file: "docs/prices.md", line: 3 });
  });
});

describe("secondHomes", () => {
  const inCart: Hit = {
    file: "src/cart.ts",
    line: 2,
    name: "formatPrice",
    claim: { file: "docs/prices.md", line: 3 },
  };
  const defining = (...files: string[]) => new Map([["formatPrice", new Set(files)]]);

  test("an edit of the home's own line, or the first definition of a new home, is no hit", () => {
    expect(secondHomes([inCart], defining("src/cart.ts"))).toEqual([]);
  });

  test("a definition beside a home another file still holds is a hit", () => {
    expect(secondHomes([inCart], defining("src/cart.ts", "src/prices.ts"))).toEqual([inCart]);
  });

  test("a name the diff defines in two files is a hit in each", () => {
    const inShop: Hit = { ...inCart, file: "src/shop.ts", line: 7 };
    expect(secondHomes([inCart, inShop], defining("src/cart.ts", "src/shop.ts"))).toEqual([
      inCart,
      inShop,
    ]);
  });

  test("a name nothing defines at HEAD is no hit", () => {
    expect(secondHomes([inCart], new Map())).toEqual([]);
  });
});

/** A repository with a claim and its home on `main`, and a branch that defines the name again. */
function repoWithBranch(): string {
  const repo = tempDir("claims");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "docs"));
  mkdirSync(join(repo, "dist"));
  writeFileSync(
    join(repo, "docs/prices.md"),
    "# Prices\n\nA line.\nThe one home for prices is `formatPrice`, in src.ts.\n",
  );
  writeFileSync(join(repo, "src.ts"), "export function formatPrice() {}\n");
  writeFileSync(join(repo, "dist/bundle.js"), "// the one home for `skipped`\n");
  mkdirSync(join(repo, ".claude/plans/archive"), { recursive: true });
  mkdirSync(join(repo, ".claude/research"), { recursive: true });
  writeFileSync(join(repo, ".claude/plans/archive/old.md"), "The one home is `planExample`.\n");
  writeFileSync(join(repo, ".claude/research/notes.md"), "The one place for `researchExample`.\n");
  writeFileSync(join(repo, "CHANGELOG.md"), "- `formatPrice` is now the one home for prices.\n");
  writeFileSync(join(repo, ".gitattributes"), "generated/** linguist-generated=true\n");
  mkdirSync(join(repo, "generated"));
  writeFileSync(join(repo, "generated/api.ts"), "// the one home for `generatedExample`\n");
  // A claim written in a test is fixture text.
  writeFileSync(join(repo, "prices.test.ts"), 'const doc = "the one home for `testExample`";\n');
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "checkout", "-q", "-b", "feature");
  writeFileSync(join(repo, "cart.ts"), "const x = 1;\nexport const formatPrice = (n) => n;\n");
  writeFileSync(join(repo, "dist/other.js"), "function formatPrice() {}\n");
  writeFileSync(join(repo, "generated/prices.ts"), "function formatPrice() {}\n");
  // Test fixtures that define the claimed name: not a second home.
  writeFileSync(join(repo, "cart.test.ts"), "function formatPrice() {}\n");
  mkdirSync(join(repo, "src/__tests__"), { recursive: true });
  writeFileSync(join(repo, "src/__tests__/cart.ts"), "const formatPrice = () => 0;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "second");
  return repo;
}

/** A repository with one commit on `main`, then a `feature` branch: its own files, committed. */
function branchOf(main: Record<string, string>, feature: Record<string, string | null>): string {
  const repo = tempDir("claims-branch");
  git(repo, "init", "-q", "-b", "main");
  const write = (files: Record<string, string | null>) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) {
        git(repo, "rm", "-q", path);
        continue;
      }
      mkdirSync(join(repo, path, ".."), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    git(repo, "add", ".");
  };
  write(main);
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "checkout", "-q", "-b", "feature");
  write(feature);
  git(repo, "commit", "-q", "-m", "second");
  return repo;
}

const CLAIM_DOC = "The one home for prices is `formatPrice`.\n";

describe("collectClaims", () => {
  test("finds the claims, skips build output, generated files, a changelog, plans, research and test fixtures, and finds the second definition in the diff", () => {
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

  test("an edit of the home's own definition is no hit", () => {
    const repo = branchOf(
      { "README.md": CLAIM_DOC, "src/prices.ts": "export function formatPrice() {}\n" },
      { "src/prices.ts": "export function formatPrice(cents: number) {}\n" },
    );
    expect(collectClaims(repo, cleanGitEnv(), { ref: "main" })).toMatchObject({
      hits: [],
      diffWhy: null,
    });
  });

  test("an edit of a claimed type's home, with a wrapped type import of it at HEAD, is no hit", () => {
    const repo = branchOf(
      {
        "README.md": "The one home for prices is `PriceShape`.\n",
        "src/prices.ts": "export type PriceShape = number;\n",
        "src/cart.ts": 'import {\n  total,\n  type PriceShape,\n} from "./prices";\n',
      },
      { "src/prices.ts": "export type PriceShape = bigint;\n" },
    );
    expect(collectClaims(repo, cleanGitEnv(), { ref: "main" })).toMatchObject({
      claims: [{ file: "README.md", names: ["PriceShape"] }],
      hits: [],
      diffWhy: null,
    });
  });

  test("the first definition of a new home, written with its claim, is no hit", () => {
    const repo = branchOf(
      { "README.md": "# App\n" },
      { "README.md": CLAIM_DOC, "src/prices.ts": "export function formatPrice() {}\n" },
    );
    expect(collectClaims(repo, cleanGitEnv(), { ref: "main" })).toMatchObject({
      claims: [{ file: "README.md", names: ["formatPrice"] }],
      hits: [],
    });
  });

  test("a home moved to another file is no hit", () => {
    const repo = branchOf(
      { "README.md": CLAIM_DOC, "src/old.ts": "export function formatPrice() {}\n" },
      { "src/old.ts": null, "src/new.ts": "export function formatPrice() {}\n" },
    );
    expect(collectClaims(repo, cleanGitEnv(), { ref: "main" })).toMatchObject({ hits: [] });
  });

  test("a name the diff defines in two new files is a hit in each", () => {
    const repo = branchOf(
      { "README.md": CLAIM_DOC },
      {
        "src/a.ts": "export function formatPrice() {}\n",
        "src/b.ts": "export const formatPrice = (n) => n;\n",
      },
    );
    const report = collectClaims(repo, cleanGitEnv(), { ref: "main" }) as ClaimsReport;
    expect(report.hits.map((hit) => hit.file)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("a second definition in a file whose path git quotes is a hit, with its real path", () => {
    const repo = branchOf(
      { "README.md": CLAIM_DOC, "src/prices.ts": "export function formatPrice() {}\n" },
      { 'src/we"ird.ts': "export function formatPrice() {}\n" },
    );
    const report = collectClaims(repo, cleanGitEnv(), { ref: "main" }) as ClaimsReport;
    expect(report.hits.map((hit) => hit.file)).toEqual(['src/we"ird.ts']);
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

  test("a long claims list stops at the usual cap and says how to read the rest", () => {
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

  test("the hits are never cut", () => {
    const hits = Array.from({ length: 10 }, (_, index) => ({
      file: "cart.ts",
      line: index + 1,
      name: "formatPrice",
      claim: { file: "docs/prices.md", line: 3 },
    }));
    const lines = claimsLines({ claims: [], hits, diffWhy: null }, rest);
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe(
      "  cart.ts:10 defines formatPrice, which docs/prices.md:3 calls its one home",
    );
  });
});
