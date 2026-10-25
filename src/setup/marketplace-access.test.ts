import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  BATCH_SSH_COMMAND,
  canReadGitRemote,
  gitFailureCause,
  githubRepoInUrl,
  marketplaceAccessAdvice,
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
 * `stderr` (when given) — line by line, so a multi-line failure arrives as several lines
 * (a shell's own `echo` would keep the `\\n` literally on some machines).
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
      options.stderr
        ? `printf '%s\\n' ${options.stderr
            .split("\n")
            .map((line) => JSON.stringify(line))
            .join(" ")} >&2; exit 128`
        : "exit 0",
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

  test("a failure: git's last line as the detail, with any URL in it redacted", () => {
    const { env } = fakeGit({
      stderr: "fatal: unable to access 'https://bot:tok@git.example.com/r.git/': 403",
    });
    expect(canReadGitRemote("https://bot:tok@git.example.com/r.git", env)).toEqual({
      detail: "fatal: unable to access 'https://***@git.example.com/r.git/': 403",
      ok: false,
      output: "fatal: unable to access 'https://***@git.example.com/r.git/': 403",
    });
  });

  test("everything git said, not only its last line: the cause is named above it", () => {
    // What a machine with no GitHub SSH key prints: the line that names the cause is the
    // FIRST one, and both the detail a line prints and the output a cause is judged from
    // carry no URL at all here.
    const { env } = fakeGit({
      stderr:
        "git@github.com: Permission denied (publickey).\n" +
        "fatal: Could not read from remote repository.",
    });
    expect(canReadGitRemote("git@github.com:example-org/cc-smart-dev-kit.git", env)).toEqual({
      detail: "fatal: Could not read from remote repository.",
      ok: false,
      output:
        "git@github.com: Permission denied (publickey).\n" +
        "fatal: Could not read from remote repository.",
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

describe("gitFailureCause", () => {
  // Both causes were seen live on 2026-10-17, while two team machines were moved: one had no
  // GitHub SSH key (the marketplace added fine over HTTPS), one was logged in with an account
  // that could not see the private repository (nothing could be added).
  test("ssh's own lines: the SSH connection to GitHub was refused", () => {
    expect(
      gitFailureCause(
        "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n",
      ),
    ).toBe("ssh-refused");
    expect(
      gitFailureCause(
        "Host key verification failed.\nfatal: Could not read from remote repository.\n",
      ),
    ).toBe("ssh-refused");
    // A blocked port 22 prints neither of ssh's own lines: only git's summary line.
    expect(
      gitFailureCause(
        "ssh: connect to host github.com port 22: Connection refused\nfatal: Could not read from remote repository.\n",
      ),
    ).toBe("ssh-refused");
  });

  test("a repository the account cannot see is not ssh, though git prints the same summary", () => {
    expect(
      gitFailureCause(
        "ERROR: Repository not found.\nfatal: Could not read from remote repository.\n",
      ),
    ).toBe("cannot-see");
    expect(
      gitFailureCause("Could not resolve to a Repository with the name 'example-org/tools'.\n"),
    ).toBe("cannot-see");
    expect(
      gitFailureCause(
        "remote: Repository not found.\nfatal: repository 'https://github.com/example-org/tools.git/' not found\n",
      ),
    ).toBe("cannot-see");
  });

  test("anything else: unknown, and the check keeps the words it always had", () => {
    expect(
      gitFailureCause(
        "fatal: unable to access 'https://github.com/example-org/tools.git/': The requested URL returned error: 403",
      ),
    ).toBe("unknown");
    expect(
      gitFailureCause(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      ),
    ).toBe("unknown");
    expect(gitFailureCause("")).toBe("unknown");
  });
});

describe("githubRepoInUrl", () => {
  test("the three forms Claude Code and git use, with and without .git", () => {
    expect(githubRepoInUrl("git@github.com:example-org/cc-smart-dev-kit.git")).toBe(
      "example-org/cc-smart-dev-kit",
    );
    expect(githubRepoInUrl("https://github.com/example-org/cc-smart-dev-kit.git")).toBe(
      "example-org/cc-smart-dev-kit",
    );
    expect(githubRepoInUrl("ssh://git@github.com/example-org/cc-smart-dev-kit")).toBe(
      "example-org/cc-smart-dev-kit",
    );
  });

  test("another host, a host that only looks like GitHub, or no repository: null", () => {
    expect(githubRepoInUrl("git@git.example.com:org/repo.git")).toBeNull();
    expect(githubRepoInUrl("https://github.example.com/org/repo.git")).toBeNull();
    expect(githubRepoInUrl("https://github.com/org")).toBeNull();
    expect(githubRepoInUrl("")).toBeNull();
  });
});

describe("marketplaceAccessAdvice", () => {
  test("SSH refused: the same marketplace, added over HTTPS", () => {
    expect(marketplaceAccessAdvice("ssh-refused", "example-org/cc-smart-dev-kit")).toBe(
      "SSH to GitHub was refused: add the marketplace over HTTPS instead. Run: " +
        "claude plugin marketplace add https://github.com/example-org/cc-smart-dev-kit.git",
    );
  });

  test("the account cannot read the repository: the owner, then the invitation", () => {
    expect(marketplaceAccessAdvice("cannot-see", "example-org/cc-smart-dev-kit")).toBe(
      "The GitHub account cannot read the repository: ask the repository's owner for read " +
        "access, then accept the invitation at " +
        "https://github.com/example-org/cc-smart-dev-kit/invitations.",
    );
  });

  test("no repository in the source: the fix says what it can", () => {
    expect(marketplaceAccessAdvice("ssh-refused", null)).toBe(
      "SSH to GitHub was refused: check your SSH key for that host, or add the marketplace " +
        "over an HTTPS URL.",
    );
    expect(marketplaceAccessAdvice("cannot-see", null)).toBe(
      "The GitHub account cannot read the repository: ask the repository's owner for read access.",
    );
  });

  test("unknown: nothing, so the caller keeps its own words", () => {
    expect(marketplaceAccessAdvice("unknown", "example-org/cc-smart-dev-kit")).toBe("");
  });
});

describe("githubRepoInUrl with user info (IX1-10)", () => {
  test("user info before the host is skipped, and never returned", () => {
    expect(githubRepoInUrl("https://alice@github.com/example-org/my-app")).toBe(
      "example-org/my-app",
    );
    expect(
      githubRepoInUrl("https://x-access-token:ghs_abcdef1234@github.com/example-org/my-app.git"),
    ).toBe("example-org/my-app");
    expect(githubRepoInUrl("ssh://deploy@github.com/example-org/my-app.git")).toBe(
      "example-org/my-app",
    );
    expect(githubRepoInUrl("https://user:p@ss@github.com/example-org/my-app.git")).toBe(
      "example-org/my-app",
    );
  });

  test("a different host that names github.com in its user info is null", () => {
    expect(githubRepoInUrl("https://github.com@evil.example.com/example-org/my-app")).toBeNull();
    expect(githubRepoInUrl("https://alice@github.example.com/o/r")).toBeNull();
    expect(githubRepoInUrl("https://alice@github.com/org")).toBeNull();
  });
});
