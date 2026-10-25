/**
 * The screen an issue's text passes (D67): what it refuses, where it says it is (line and column
 * in characters), and what it lets through. Expected values are written by hand.
 */
import { describe, expect, test } from "bun:test";
import { redactText, screenText } from "./screen";

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
    "monkey: banana",
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

describe("redactText: nothing of a secret is left behind", () => {
  const redact = (text: string) => redactText(text, "/home/tester");

  test("a private key goes from its BEGIN line to its END line", () => {
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcd/+==\n-----END RSA PRIVATE KEY-----";
    expect(redact(`before\n${key}\nafter`)).toBe("before\n[redacted: a key or token]\nafter");
  });

  test("a private key with no END line goes to the end of the text", () => {
    expect(redact("x\n-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234")).toBe(
      "x\n[redacted: a key or token]",
    );
  });

  test("a value longer than the pattern's length cap is redacted whole", () => {
    expect(redact(`password=${"a".repeat(300)} and more`)).toBe(
      "[redacted: a key or token] and more",
    );
    expect(redact(`Authorization: Bearer ${"b".repeat(700)} end`)).toBe(
      "Authorization: [redacted: a key or token] end",
    );
  });

  test("a token shape longer than its cap is redacted whole", () => {
    expect(redact(`ghp_${"c".repeat(400)}!`)).toBe("[redacted: a key or token]");
  });

  test("a JWT after token= is redacted whole, not cut where the shorter match ends", () => {
    const jwt = `eyJ${"a".repeat(300)}.eyJ${"b".repeat(300)}.${"c".repeat(300)}`;
    expect(redact(`token=${jwt} done`)).toBe("[redacted: a key or token] done");
  });

  test("overlapping matches become one marker", () => {
    expect(redact(`key=ghp_${"d".repeat(40)} next`)).toBe("[redacted: a key or token] next");
  });

  test("text with nothing to hide is returned as it is", () => {
    expect(redact("a commit a1b2c3d4e5f6 and ~/path")).toBe("a commit a1b2c3d4e5f6 and ~/path");
  });
});

describe("IX1-5: a secret name with letters before it", () => {
  test.each([
    "?apikey=abcdef0123456789",
    "APIKEY=abcdef0123456789",
    "OPENAI_APIKEY: abcdef0123456789",
    "PGPASSWORD=hunter2hunter2",
    "GITHUBTOKEN=abcdefgh12345678",
    "accesstoken: abcdefgh12345678",
    `{"clientsecret": "abcdefgh12345678"}`,
    "export DBPASSWORD='hunter2hunter2'",
  ])("%s is refused", (text) => {
    expect(screenText(text, HOME).map((hit) => hit.kind as string)).toContain("a key or token");
  });

  test.each([
    "the key does not exist",
    "monkey: banana",
    "monkey: $VALUE",
    "turkey=***",
    "PGPASSWORD=$PGPASSWORD",
    "APIKEY=short",
    "keyboard=abcdefghijkl",
    "a token or a key: see the docs",
  ])("%s passes", (text) => {
    expect(screenText(text, HOME)).toEqual([]);
  });

  test("a name with letters before it is redacted too", () => {
    expect(redactText("run PGPASSWORD=hunter2hunter2 psql", HOME)).toBe(
      "run PG[redacted: a key or token] psql",
    );
  });
});

describe("IX1-6: a home in every spelling it takes", () => {
  const kinds = (text: string, home: string) => screenText(text, home).map((hit) => hit.kind);

  test.each([
    "in C:\\Users\\Tester\\Code\\app",
    "in C:/Users/Tester/Code/app",
    "in /c/Users/Tester/Code/app",
    "in /C/users/tester/Code/app",
    "in /mnt/c/Users/Tester/Code/app",
    "in /mnt/C/Users/Tester/Code/app",
  ])("a drive-letter home: %s", (text) => {
    expect(kinds(text, "C:\\Users\\Tester")).toEqual(["a home path"]);
  });

  test.each([
    "in /c/Users/Tester/Code/app",
    "in C:\\Users\\Tester\\Code\\app",
    "in C:/Users/Tester/Code/app",
    "in c:\\users\\tester\\x",
    "in /mnt/c/Users/Tester/x",
  ])("an MSYS home: %s", (text) => {
    expect(kinds(text, "/c/Users/Tester")).toEqual(["a home path"]);
  });

  test("a WSL home is found in the Windows and the Git Bash forms", () => {
    expect(kinds("in C:\\Users\\Tester\\x", "/mnt/c/Users/Tester")).toEqual(["a home path"]);
    expect(kinds("in /c/Users/Tester/x", "/mnt/c/Users/Tester")).toEqual(["a home path"]);
  });

  test("another user, another drive and a longer name are no hit", () => {
    expect(kinds("in /c/Users/Testers/x", "C:\\Users\\Tester")).toEqual([]);
    expect(kinds("in /d/Users/Tester/x", "C:\\Users\\Tester")).toEqual([]);
    expect(kinds("in /mnt/d/Users/Tester/x", "C:\\Users\\Tester")).toEqual([]);
    expect(kinds("in /c/Users/Other/x", "/c/Users/Tester")).toEqual([]);
  });

  test("a Linux home keeps its one spelling", () => {
    expect(kinds("in /home/tester/x", "/home/tester")).toEqual(["a home path"]);
    expect(kinds("in C:\\Users\\Tester\\x", "/home/tester")).toEqual([]);
  });

  test("redactText hides every spelling too", () => {
    expect(redactText("a /c/Users/Tester/x b", "C:\\Users\\Tester")).toBe(
      "a [redacted: a home path]/x b",
    );
  });
});

describe("IX1-9: token shapes of more services", () => {
  // Built here from parts, never a real key.
  const filler = "abcdefghijklmnopqrstuvwxyz0123456789";
  test.each([
    ["Tavily", `tvly-${filler}`],
    ["Tavily dev", `tvly-dev-${filler}`],
    ["Groq", `gsk_${filler}`],
    ["Groq after a name", `GROQ=gsk_${filler}`],
    ["a Stripe restricted live key", `rk_live_${filler}`],
    ["a Stripe restricted test key", `rk_test_${filler}`],
    ["a Slack webhook", `https://hooks.slack.com/services/T0000000/B0000000/${filler}`],
    ["a Discord webhook", `https://discord.com/api/webhooks/123456789012345678/${filler}`],
    [
      "an old Discord webhook host",
      `https://discordapp.com/api/webhooks/123456789012345678/${filler}`,
    ],
    [
      "a versioned Discord webhook",
      `https://discord.com/api/v10/webhooks/123456789012345678/${filler}`,
    ],
  ])("%s is refused", (_name, text) => {
    expect(screenText(`see ${text} here`, HOME).map((hit) => hit.kind as string)).toContain(
      "a key or token",
    );
  });

  test("a webhook is redacted whole", () => {
    expect(
      redactText(`x https://hooks.slack.com/services/T0000000/B0000000/${filler} y`, HOME),
    ).toBe("x [redacted: a key or token] y");
  });

  test.each([
    "tvly-",
    "tvly-short",
    "the gsk_ prefix",
    "rk_live_short",
    "https://hooks.slack.com/",
    "https://discord.com/api/users/123",
    "https://discord.com/channels/123/456",
  ])("%s passes", (text) => {
    expect(screenText(text, HOME)).toEqual([]);
  });
});

describe("IX1 review: edges of the screen", () => {
  test("a `~` path that looks like a Git Bash home is fine", () => {
    expect(screenText("see ~/c/Users/Tester/x", HOME)).toEqual([]);
    expect(screenText("see ~/c/Users/Tester/x", "C:\\Users\\Tester")).toEqual([]);
  });

  test.each([
    "https://hooks.slack.com/workflows/T0000000/A0000000/abcdefghijklmnop",
    "https://hooks.slack.com/triggers/T0000000/1234567890/abcdefghijklmnop",
  ])("%s is a webhook", (text) => {
    expect(screenText(text, HOME).map((hit) => hit.kind as string)).toContain("a key or token");
  });
});
