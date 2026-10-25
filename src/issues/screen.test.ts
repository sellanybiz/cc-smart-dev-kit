/**
 * The screen an issue's text passes (D67): what it refuses, where it says it is (line and column
 * in characters), and what it lets through. Expected values are written by hand.
 */
import { describe, expect, test } from "bun:test";
import { screenText } from "./screen";

const HOME = "/home/tester";

describe("what is refused", () => {
  test.each([
    ["a home path", `see ${HOME}/notes.txt`, "a home path"],
    ["a home path at the end of a sentence", `it is in ${HOME}.`, "a home path"],
    ["a home path in quotes", `path "${HOME}"`, "a home path"],
    ["an OpenAI-style key", "key sk-abcdefghijklmnopqrstuvwx here", "a key or token"],
    ["a Stripe key", "sk_live_abcdefghijklmnopqrstuvwx", "a key or token"],
    ["a GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "a key or token"],
    ["a fine-grained token", "github_pat_abcdefghijklmnopqrstuvwxyz", "a key or token"],
    ["an AWS key id", "AKIAABCDEFGHIJKLMNOP", "a key or token"],
    ["a GitLab token", "glpat-abcdefghijklmnopqrstuvwx", "a key or token"],
    ["an npm token", "npm_abcdefghijklmnopqrstuvwxyz0123456789", "a key or token"],
    ["a private key block", "-----BEGIN RSA PRIVATE KEY-----", "a key or token"],
    ["a PGP private key block", "-----BEGIN PGP PRIVATE KEY BLOCK-----", "a key or token"],
    ["a bearer credential", "Authorization: Bearer abcdefghijklmnop1234", "a key or token"],
    ["an assignment", "password=hunter2hunter2", "a key or token"],
    ["a json field", `{"api_key": "abcd1234efgh"}`, "a key or token"],
    ["a camel case name", "apiKey=abcd1234efgh", "a key or token"],
    ["a url with a password", "https://alice:hunter2@example.com/x", "a URL with credentials"],
    ["a url with a token", "https://ghp_x@example.com/x", "a URL with credentials"],
  ])("%s", (_name, text, kind) => {
    const hits = screenText(text, HOME);
    expect(hits.map((hit) => hit.kind as string)).toContain(kind);
  });

  test("line and column are 1-based and count characters, with CRLF and emoji", () => {
    expect(screenText(`one\r\ntwo ${HOME}`, HOME)[0]).toEqual({
      column: 5,
      kind: "a home path",
      line: 2,
    });
    // An emoji is one character, however many UTF-16 units it takes.
    expect(screenText(`😀 ${HOME}`, HOME)[0]).toEqual({ column: 3, kind: "a home path", line: 1 });
  });

  test("hits come first to last", () => {
    const text = `ghp_abcdefghijklmnopqrstuvwxyz0123456789\n${HOME}/x`;
    expect(screenText(text, HOME).map((hit) => [hit.line, hit.kind])).toEqual([
      [1, "a key or token"],
      [2, "a home path"],
    ]);
  });

  test("a Windows home is found in both slashes, in any case", () => {
    const home = "C:\\Users\\Tester";
    expect(screenText("in c:/users/tester/x", home)).toHaveLength(1);
    expect(screenText("in C:\\Users\\Tester\\x", home)).toHaveLength(1);
  });
});

describe("what passes", () => {
  test.each([
    "see ~/.config/x",
    "commit 4dfa940163c4b6f2d3a2f1c0e9b8a7d6c5b4a392",
    "/home/testerson/x",
    "/home/tester-two/x",
    "the key does not exist",
    "the token was refreshed",
    "monkey: bananas1234",
    "password=$PASSWORD",
    `token: \${TOKEN}`,
    "api_key=<your key>",
    "https://github.com/example-org/my-app/issues/5",
    "git@github.com:example-org/my-app.git",
    "ssh://git@example.com/x",
    "task-force-name-with-a-long-hyphenated-tail",
  ])("%s", (text) => {
    expect(screenText(text, HOME)).toEqual([]);
  });

  test("no home to name: only the other shapes are looked for", () => {
    expect(screenText(`${HOME}/x`, null)).toEqual([]);
    expect(screenText(`${HOME}/x`, "/")).toEqual([]);
  });
});
