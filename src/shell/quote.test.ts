/** Quoting a value as one word of a shell line (`quote.ts`): every expected text is written by hand. */
import { describe, expect, test } from "bun:test";
import { jobRunCommand } from "../hooks/job-route";
import { shellQuote, shellWord } from "./quote";

describe("shellQuote", () => {
  test("single quotes, each quote inside written as '\\''", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("")).toBe("''");
  });
});

describe("shellWord: bare only for letters, digits and _ . / -", () => {
  test("a plain word and a path stay as they are", () => {
    expect(shellWord("vitest")).toBe("vitest");
    expect(shellWord("./node_modules/.bin/vitest")).toBe("./node_modules/.bin/vitest");
    expect(shellWord("--noEmit")).toBe("--noEmit");
    expect(shellWord("a_b-1.ts")).toBe("a_b-1.ts");
  });

  test("any other character quotes the word: it may mean something to a shell", () => {
    expect(shellWord("--project=api")).toBe("'--project=api'");
    expect(shellWord("@scope/pkg")).toBe("'@scope/pkg'");
    expect(shellWord("a:b")).toBe("'a:b'");
    expect(shellWord("100%")).toBe("'100%'");
    expect(shellWord("a,b")).toBe("'a,b'");
    expect(shellWord("a b")).toBe("'a b'");
    expect(shellWord("$HOME")).toBe("'$HOME'");
    expect(shellWord("")).toBe("''");
  });

  test("the job queue's rewrite quotes through the same word", () => {
    expect(
      jobRunCommand("test:run", "bunx vitest run --project=api src/a.test.ts", "/bin/bash"),
    ).toBe(
      `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind test:run -- bunx vitest run '--project=api' src/a.test.ts`,
    );
  });
});
