import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { installLauncher } from "./launcher";
import { applyManagedJson } from "./managed-json";
import { applyManagedMarkdown } from "./managed-markdown";
import { restore } from "./restore";
import { listBackups, readChanged, writeManagedFile } from "./write";

const AUTO_UPDATE = ["extraKnownMarketplaces", "cc-agentic", "autoUpdate"] as const;

const ORIGINAL_SETTINGS = `${JSON.stringify(
  {
    model: "opus",
    extraKnownMarketplaces: {
      "cc-agentic": { source: { source: "github", repo: "example-org/cc-agentic" } },
    },
  },
  null,
  2,
)}\n`;

function setup() {
  const dir = tempDir("restore");
  return { dir, stateDir: join(dir, "state") };
}

const read = (file: string) => readFileSync(file, "utf8");

describe("restore: removes what cc-agentic added, keeps the rest", () => {
  test("a key added by someone else after setup survives a restore", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    // Later, Claude Code adds a permission ("always allow").
    const later = JSON.parse(read(file));
    later.permissions = { allow: ["Bash(ls:*)"] };
    writeFileSync(file, `${JSON.stringify(later, null, 2)}\n`);
    const beforeRestore = read(file);

    const [result] = restore(stateDir);
    expect(result?.action).toBe("cleaned");
    expect(result?.details).toEqual(['extraKnownMarketplaces["cc-agentic"].autoUpdate']);
    expect(JSON.parse(read(file))).toEqual({
      model: "opus",
      extraKnownMarketplaces: {
        "cc-agentic": { source: { source: "github", repo: "example-org/cc-agentic" } },
      },
      permissions: { allow: ["Bash(ls:*)"] },
    });
    // The state just before the restore is kept as a backup.
    expect(read(result?.savedAs ?? "")).toBe(beforeRestore);
  });

  test("two setups, then one restore, give back the original file", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    applyManagedJson({ file, stateDir, set: [[["statusLine"], { type: "command" }]] });
    restore(stateDir);
    expect(read(file)).toBe(ORIGINAL_SETTINGS);
  });

  test("a whole file changed twice goes back to the state before the first change, with its mode", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "tool");
    writeFileSync(file, "the user's own\n");
    chmodSync(file, 0o640);
    writeManagedFile(file, "v1\n", { stateDir, kind: "whole-file", mode: 0o755 });
    writeManagedFile(file, "v2\n", { stateDir, kind: "whole-file", mode: 0o755 });
    const [result] = restore(stateDir);
    expect(result?.action).toBe("restored");
    expect(read(file)).toBe("the user's own\n");
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  test("the Markdown block is removed and the text around it is kept", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "CLAUDE.md");
    writeFileSync(file, "# Notes\n\nKeep this.\n");
    applyManagedMarkdown({ file, stateDir, body: "@cc/general.md" });
    // The user writes more after the block.
    writeFileSync(file, `${read(file)}\nWritten later by the user.\n`);
    const [result] = restore(stateDir);
    expect(result?.action).toBe("cleaned");
    expect(read(file)).toBe("# Notes\n\nKeep this.\n\nWritten later by the user.\n");
  });

  test("an appended block, removed again, leaves the file exactly as it was", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "CLAUDE.md");
    writeFileSync(file, "# Notes\n\nKeep this.\n");
    applyManagedMarkdown({ file, stateDir, body: "first" });
    applyManagedMarkdown({ file, stateDir, body: "second" });
    restore(stateDir);
    expect(read(file)).toBe("# Notes\n\nKeep this.\n");
  });

  test("the launcher that setup created is removed", () => {
    const { dir, stateDir } = setup();
    const binDir = join(dir, "bin");
    const { path } = installLauncher(binDir, { stateDir, bunPath: "/usr/bin/bun" });
    const [result] = restore(stateDir);
    expect(result?.action).toBe("removed");
    expect(existsSync(path)).toBe(false);
  });

  test("files cc-agentic created with only its own content are removed", () => {
    const { dir, stateDir } = setup();
    const json = join(dir, "new-settings.json");
    const markdown = join(dir, "NEW.md");
    applyManagedJson({ file: json, stateDir, set: [[["a"], 1]] });
    applyManagedMarkdown({ file: markdown, stateDir, body: "x" });
    expect(restore(stateDir).map((result) => result.action)).toEqual(["removed", "removed"]);
    expect(existsSync(json)).toBe(false);
    expect(existsSync(markdown)).toBe(false);
  });

  test("a file that is whole-file and has a block too goes back to its baseline", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "both.md");
    writeFileSync(file, "original\n");
    writeManagedFile(file, "ours\n", { stateDir, kind: "whole-file" });
    applyManagedMarkdown({ file, stateDir, body: "x" });
    expect(readChanged(stateDir)[file]?.kinds).toEqual(["whole-file", "markdown-block"]);
    restore(stateDir);
    expect(read(file)).toBe("original\n");
  });

  test("a second restore changes nothing", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    restore(stateDir);
    const mtime = statSync(file).mtimeMs;
    const backups = listBackups(file).length;
    expect(restore(stateDir)).toEqual([]);
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(listBackups(file)).toHaveLength(backups);
  });

  test("a missing baseline backup: the file is left alone and still tracked", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "tool");
    writeFileSync(file, "original\n");
    writeManagedFile(file, "ours\n", { stateDir, kind: "whole-file" });
    unlinkSync(listBackups(file)[0]?.path ?? "");
    const [result] = restore(stateDir);
    expect(result?.action).toBe("no-backup");
    expect(read(file)).toBe("ours\n");
    expect(Object.keys(readChanged(stateDir))).toEqual([file]);
  });

  test("nothing changed by cc-agentic: nothing to restore", () => {
    expect(restore(setup().stateDir)).toEqual([]);
  });
});

describe("backups of executables", () => {
  test("are never executable, and restore gives the mode back", () => {
    const { dir, stateDir } = setup();
    const binDir = join(dir, "bin");
    const tool = join(binDir, "tool");
    mkdirSync(binDir);
    writeFileSync(tool, "#!/bin/sh\necho old\n");
    chmodSync(tool, 0o755);
    writeManagedFile(tool, "#!/bin/sh\necho new\n", { stateDir, kind: "whole-file", mode: 0o755 });

    const backups = listBackups(tool);
    expect(backups).toHaveLength(1);
    const backup = backups[0]?.path ?? "";
    expect(backup).toEndWith(".mode-755");
    expect(statSync(backup).mode & 0o777).toBe(0o644);
    // Nothing in the bin folder is executable except the tool itself.
    const executables = readdirSync(binDir).filter(
      (name) => (statSync(join(binDir, name)).mode & 0o111) !== 0,
    );
    expect(executables).toEqual(["tool"]);

    const results = restore(stateDir);
    expect(results.find((result) => result.file === tool)?.action).toBe("restored");
    expect(read(tool)).toBe("#!/bin/sh\necho old\n");
    expect(statSync(tool).mode & 0o777).toBe(0o755);
    // The backup restore made of the state before it is not executable either.
    const savedAs = results.find((result) => result.file === tool)?.savedAs ?? "";
    expect(statSync(savedAs).mode & 0o111).toBe(0);
  });
});
