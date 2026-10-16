import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  BATCH_SSH_COMMAND,
  canReadGitRemote,
  marketplaceInstallLocation,
  marketplaceSource,
  redactUrl,
  redactUrlsIn,
} from "./marketplace-access";

describe("redactUrl", () => {
  test.each([
    [
      "https://user:secret@git.example.com/org/repo.git",
      "https://***@git.example.com/org/repo.git",
    ],
    ["https://ghp_token123@github.com/org/repo.git", "https://***@github.com/org/repo.git"],
    [
      "https://example.com/marketplace.json?token=abc&x=1",
      "https://example.com/marketplace.json?***",
    ],
    ["https://u:p@example.com/m.json?sig=1", "https://***@example.com/m.json?***"],
    ["ssh://git:secret@git.example.com/org/repo.git", "ssh://git:***@git.example.com/org/repo.git"],
    ["ssh://git@git.example.com:2222/org/repo.git", "ssh://git@git.example.com:2222/org/repo.git"],
    ["https://example.com/mcp#access_token=abc", "https://example.com/mcp"],
    ["https://example.com/mcp?key=abc#token=def", "https://example.com/mcp?***"],
    [
      "git@github.com:example-org/cc-smart-dev-kit.git",
      "git@github.com:example-org/cc-smart-dev-kit.git",
    ],
    [
      "https://github.com/example-org/cc-smart-dev-kit.git",
      "https://github.com/example-org/cc-smart-dev-kit.git",
    ],
  ])("%s -> %s", (url, safe) => {
    expect(redactUrl(url)).toBe(safe);
  });

  test("redactUrlsIn hides every URL in a line of text, and keeps the rest", () => {
    expect(
      redactUrlsIn(
        "fatal: unable to access 'https://bot:tok@git.example.com/r.git/': The requested URL returned error: 403",
      ),
    ).toBe(
      "fatal: unable to access 'https://***@git.example.com/r.git/': The requested URL returned error: 403",
    );
  });
});

/**
 * A fake git first on PATH. It logs each call with the ssh command it got, answers
 * `config --get core.sshCommand` with `sshCommand` (when given), and fails ls-remote with
 * `stderr` (when given).
 */
function fakeGit(options: { sshCommand?: string; stderr?: string } = {}) {
  const dir = tempDir("fake-git");
  const log = join(dir, "calls.log");
  writeFileSync(
    join(dir, "git"),
    [
      "#!/bin/sh",
      `echo "$* | prompt=$GIT_TERMINAL_PROMPT | ssh=$GIT_SSH_COMMAND" >> ${JSON.stringify(log)}`,
      'if [ "$1" = config ]; then',
      options.sshCommand ? `  echo ${JSON.stringify(options.sshCommand)}; exit 0` : "  exit 1",
      "fi",
      options.stderr ? `echo ${JSON.stringify(options.stderr)} >&2; exit 128` : "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(dir, "git"), 0o755);
  const env = { PATH: `${dir}:${process.env.PATH ?? ""}` };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { env, calls };
}

describe("canReadGitRemote", () => {
  const url = "git@git.example.com:org/repo.git";

  test("no ssh command of the user's own: BatchMode is added, and git never prompts", () => {
    const { env, calls } = fakeGit();
    expect(canReadGitRemote(url, env)).toEqual({ ok: true, detail: "" });
    expect(calls()).toEqual([
      "config --get core.sshCommand | prompt=0 | ssh=",
      `ls-remote ${url} HEAD | prompt=0 | ssh=${BATCH_SSH_COMMAND}`,
    ]);
  });

  test("core.sshCommand set: GIT_SSH_COMMAND is left unset, so git uses the user's command", () => {
    const { env, calls } = fakeGit({ sshCommand: "ssh -i ~/.ssh/deploy_key" });
    expect(canReadGitRemote(url, env).ok).toBe(true);
    expect(calls().at(-1)).toBe(`ls-remote ${url} HEAD | prompt=0 | ssh=`);
  });

  test.each([
    ["GIT_SSH_COMMAND", "ssh -i /home/user/.ssh/key"],
    ["GIT_SSH", "/usr/local/bin/my-ssh"],
  ])("%s set: kept as it is, and git config is not even asked", (name, value) => {
    const { env, calls } = fakeGit();
    expect(canReadGitRemote(url, { ...env, [name]: value }).ok).toBe(true);
    const ssh = name === "GIT_SSH_COMMAND" ? value : "";
    expect(calls()).toEqual([`ls-remote ${url} HEAD | prompt=0 | ssh=${ssh}`]);
  });

  test("a failure: git's last line, with any URL in it redacted", () => {
    const { env } = fakeGit({
      stderr: "fatal: unable to access 'https://bot:tok@git.example.com/r.git/': 403",
    });
    expect(canReadGitRemote("https://bot:tok@git.example.com/r.git", env)).toEqual({
      ok: false,
      detail: "fatal: unable to access 'https://***@git.example.com/r.git/': 403",
    });
  });
});

describe("marketplaceInstallLocation", () => {
  test("reads installLocation; null when it is missing or the file is not there", () => {
    const file = known({
      mkt: { source: { source: "github", repo: "example-org/tools" }, installLocation: "/m/mkt" },
      bare: { source: { source: "github", repo: "example-org/tools" } },
    });
    expect(marketplaceInstallLocation(file, "mkt")).toBe("/m/mkt");
    expect(marketplaceInstallLocation(file, "bare")).toBeNull();
    expect(marketplaceInstallLocation(join(tempDir("known"), "none.json"), "mkt")).toBeNull();
  });
});

function known(content: unknown): string {
  const file = join(tempDir("known"), "known_marketplaces.json");
  writeFileSync(file, JSON.stringify(content));
  return file;
}

describe("marketplaceSource", () => {
  test("github: SSH first, then HTTPS", () => {
    const file = known({ mkt: { source: { source: "github", repo: "example-org/tools" } } });
    expect(marketplaceSource(file, "mkt", {})).toEqual({
      kind: "git",
      urls: ["git@github.com:example-org/tools.git", "https://github.com/example-org/tools.git"],
    });
  });

  test("github with CLAUDE_CODE_PLUGIN_PREFER_HTTPS: HTTPS first", () => {
    const file = known({ mkt: { source: { source: "github", repo: "example-org/tools" } } });
    expect(marketplaceSource(file, "mkt", { CLAUDE_CODE_PLUGIN_PREFER_HTTPS: "1" })).toEqual({
      kind: "git",
      urls: ["https://github.com/example-org/tools.git", "git@github.com:example-org/tools.git"],
    });
  });

  test("git: the URL as it is, on any host", () => {
    const file = known({
      mkt: { source: { source: "git", url: "ssh://git@git.example.com/team/tools.git" } },
    });
    expect(marketplaceSource(file, "mkt", {})).toEqual({
      kind: "git",
      urls: ["ssh://git@git.example.com/team/tools.git"],
    });
  });

  test("url and directory sources", () => {
    const file = known({
      web: { source: { source: "url", url: "https://example.com/marketplace.json" } },
      dir: { source: { source: "directory", path: "/opt/marketplace" } },
    });
    expect(marketplaceSource(file, "web", {})).toEqual({
      kind: "http",
      url: "https://example.com/marketplace.json",
    });
    expect(marketplaceSource(file, "dir", {})).toEqual({ kind: "local", path: "/opt/marketplace" });
  });

  test("an unknown source type is named", () => {
    const file = known({ mkt: { source: { source: "npm", package: "x" } } });
    expect(marketplaceSource(file, "mkt", {})).toEqual({ kind: "unknown", type: "npm" });
  });

  test("not in the file, or no file: missing", () => {
    expect(marketplaceSource(known({}), "mkt", {})).toEqual({ kind: "missing" });
    expect(marketplaceSource(join(tempDir("known"), "none.json"), "mkt", {})).toEqual({
      kind: "missing",
    });
  });
});
