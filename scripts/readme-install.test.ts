/**
 * README § Install, held as a contract (UX-1). A first run must not end with
 * `cc-smart-dev-kit setup`: that command is what setup creates. So the section leads with
 * the installer one-liner, and the by-hand first setup is one line that finds the newest
 * installed version by itself.
 *
 * The lines are read FROM `README.md`, never copied here: a doc line that drifts from what
 * runs is the bug this test exists for. The `sh` line is run in a temp HOME whose plugin
 * cache holds two versions, with a fake `bun` first on PATH that records its arguments, so
 * the test proves the newest version is picked — `0.10.0`, not `0.9.0`, which a plain text
 * sort would put last.
 *
 * The PowerShell line cannot run on Linux or macOS. Its proof on a real Windows machine is a
 * case in `scripts/install-windows-smoke.ps1`, which the Windows CI job runs under `pwsh` and
 * Windows PowerShell 5.1; here its shape is held (one line, the plugin's two flags, the
 * bundle path, `setup`).
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../src/testing/temp";

const README = join(import.meta.dir, "..", "README.md");
const BASH: string = Bun.which("bash") ?? "";
if (BASH === "") throw new Error("readme-install.test.ts needs bash");

interface CodeBlock {
  language: string;
  body: string;
}

/** Every fenced code block in a Markdown text, with the language its fence names. */
function codeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let language: string | null = null;
  let body: string[] = [];
  for (const line of markdown.split("\n")) {
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (language === null) {
      if (fence !== null) {
        language = fence[1] ?? "";
        body = [];
      }
      continue;
    }
    if (fence !== null) {
      blocks.push({ language, body: body.join("\n") });
      language = null;
      continue;
    }
    // A fence inside a numbered list is indented with the list's text: drop that indent, so
    // the body is the text a person copies.
    body.push(line.replace(/^ {1,3}/, ""));
  }
  return blocks;
}

/** One `## ` section of the README, from its heading to the next one. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`README.md has no "${heading}"`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

const INSTALL = section(readFileSync(README, "utf8"), "## Install");
const BLOCKS = codeBlocks(INSTALL);

/** The one-line `language` block in README § Install that holds this marker. */
function byHandLine(language: string, marker: string): string {
  const found = BLOCKS.filter(
    (block) => block.language === language && block.body.includes(marker),
  );
  if (found.length !== 1) {
    throw new Error(
      `README § Install must hold exactly one \`${language}\` block containing "${marker}": found ${found.length}`,
    );
  }
  const lines = (found[0]?.body ?? "").split("\n").filter((line) => line.trim() !== "");
  if (lines.length !== 1) {
    throw new Error(
      `the by-hand \`${language}\` setup must be ONE line to paste: found ${lines.length}`,
    );
  }
  return (lines[0] ?? "").trim();
}

describe("README § Install", () => {
  test("the installer one-liner is the first thing the section shows", () => {
    const first = BLOCKS[0];
    expect(first?.language).toBe("sh");
    expect(first?.body).toContain("gh api repos/<owner>/cc-smart-dev-kit/contents/install.sh");
    expect(first?.body).toContain("| bash -s -- <owner>/cc-smart-dev-kit");

    const windows = BLOCKS.find(
      (block) => block.language === "powershell" && block.body.includes("contents/install.ps1"),
    );
    expect(windows?.body).toContain(
      "powershell -NoProfile -ExecutionPolicy Bypass -File $f <owner>/cc-smart-dev-kit",
    );
  });

  test("the by-hand sh line finds the newest installed version and runs setup", () => {
    const line = byHandLine("sh", "plugins/cache");
    const home = join(tempDir("readme-install"), "home");
    const cache = join(home, ".claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit");
    for (const version of ["0.9.0", "0.10.0"]) {
      const dir = join(cache, version);
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(join(dir, "dist/cli.js"), 'await import("the plugin");\n');
      writeFileSync(join(dir, "bunfig.toml"), "");
    }

    // A fake `bun` first on PATH, recording every argument it is given. The line calls the
    // bare name, as a person's shell would.
    const fakeBin = join(home, "fake-bin");
    mkdirSync(fakeBin, { recursive: true });
    const log = join(home, "bun.log");
    writeFileSync(log, "");
    const bun = join(fakeBin, "bun");
    writeFileSync(bun, `#!/bin/sh\nprintf '%s\\n' "bun" "$@" >> ${JSON.stringify(log)}\n`);
    chmodSync(bun, 0o755);

    // The real tools the line itself uses, and nothing else of the host's PATH.
    const tools = ["ls", "sort", "tail"].map((tool) => {
      const real = Bun.which(tool);
      if (real === null) throw new Error(`readme-install.test.ts needs ${tool} on PATH`);
      return dirname(real);
    });
    const path = [fakeBin, ...new Set(tools)].join(":");

    const result = Bun.spawnSync([BASH, "-c", `${line} --dry-run`], {
      cwd: home,
      env: { HOME: home, PATH: path, FAKE_LOG: log },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({
      code: result.exitCode,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    }).toEqual({ code: 0, output: "" });

    const newest = join(cache, "0.10.0");
    expect(
      readFileSync(log, "utf8")
        .split("\n")
        .filter((entry) => entry !== ""),
    ).toEqual([
      "bun",
      "--no-env-file",
      `--config=${join(newest, "bunfig.toml")}`,
      join(newest, "dist/cli.js"),
      "setup",
      "--dry-run",
    ]);
  });

  test("the by-hand PowerShell line does the same on native Windows", () => {
    const line = byHandLine("powershell", "plugins\\cache");
    expect(line).toContain("$env:USERPROFILE");
    expect(line).toContain("Get-ChildItem $d -Directory");
    // By version number, never as text: "0.9.0" sorts after "0.10.0" as text.
    expect(line).toContain("[version]");
    expect(line).toContain("Select-Object -Last 1");
    expect(line).toContain("--no-env-file");
    expect(line).toContain('--config="$d\\$v\\bunfig.toml"');
    expect(line).toContain('"$d\\$v\\dist\\cli.js" setup');
  });
});
