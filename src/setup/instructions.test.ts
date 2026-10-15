import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  type InstructionsPaths,
  installInstructions,
  instructionsBlockBody,
  listInstructionFiles,
  removeInstructions,
} from "./instructions";
import { restore } from "./restore";
import { listBackups, readChanged } from "./write";

const BLOCK = [
  "<!-- anymodel:begin -->",
  "<!-- Written by anymodel setup. `anymodel setup --no-instructions` takes it out. -->",
  "@~/.claude/anymodel/instructions/core.md",
  "<!-- anymodel:end -->",
].join("\n");

/** A plugin source folder with an always-on file and one opt-in file, and an empty config folder. */
function setup() {
  const dir = tempDir("instructions");
  const source = join(dir, "plugin", "instructions");
  mkdirSync(join(source, "optin"), { recursive: true });
  writeFileSync(join(source, "core.md"), "# Core\n");
  writeFileSync(join(source, "optin", "worktrees.md"), "# Worktrees\n");
  writeFileSync(join(source, "notes.txt"), "not an instruction\n");
  const configDir = join(dir, "home", ".claude");
  mkdirSync(configDir, { recursive: true });
  const stateDir = join(configDir, "anymodel");
  const paths: InstructionsPaths = {
    source,
    target: join(stateDir, "instructions"),
    claudeMd: join(configDir, "CLAUDE.md"),
    stateDir,
    importPath: "~/.claude/anymodel/instructions/core.md",
  };
  return { dir, source, stateDir, paths };
}

const read = (file: string) => readFileSync(file, "utf8");
const lines = (result: { mark: string; file: string; what: string }[], root: string) =>
  result.map((line) => `${line.mark} ${line.file.slice(root.length + 1)}: ${line.what}`);

describe("listInstructionFiles", () => {
  test("every .md file below the folder, relative, sorted; other files are skipped", () => {
    const { source } = setup();
    expect(listInstructionFiles(source)).toEqual(["core.md", "optin/worktrees.md"]);
  });

  test("a missing folder, or one without core.md, fails with a clear message", () => {
    const { dir, source } = setup();
    expect(() => listInstructionFiles(join(dir, "nowhere"))).toThrow(
      "The plugin's instructions folder is missing",
    );
    writeFileSync(join(source, "core.md"), "");
    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(join(other, "a.md"), "# A\n");
    expect(() => listInstructionFiles(other)).toThrow("has no core.md");
  });
});

describe("installInstructions", () => {
  test("copies every file and adds the block to a new CLAUDE.md", () => {
    const { dir, paths } = setup();
    const result = installInstructions(paths, false);
    expect(lines(result, dir)).toEqual([
      "+ home/.claude/anymodel/instructions/core.md: created",
      "+ home/.claude/anymodel/instructions/optin/worktrees.md: created",
      "+ home/.claude/CLAUDE.md: created, with the anymodel block",
    ]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core\n");
    expect(read(join(paths.target, "optin", "worktrees.md"))).toBe("# Worktrees\n");
    expect(existsSync(join(paths.target, "notes.txt"))).toBe(false);
    expect(statSync(join(paths.target, "core.md")).mode & 0o777).toBe(0o644);
    expect(read(paths.claudeMd)).toBe(`${BLOCK}\n`);
  });

  test("the user's own text in CLAUDE.md is kept, and the block goes after it", () => {
    const { paths } = setup();
    writeFileSync(paths.claudeMd, "# Mine\n\nAlways answer in French.\n");
    const result = installInstructions(paths, false);
    expect(result.at(-1)?.what).toBe("anymodel block added");
    expect(read(paths.claudeMd)).toBe(`# Mine\n\nAlways answer in French.\n\n${BLOCK}\n`);
  });

  test("a second run changes nothing: no line, no new backup", () => {
    const { stateDir, paths } = setup();
    installInstructions(paths, false);
    expect(installInstructions(paths, false)).toEqual([]);
    expect(listBackups(stateDir, join(paths.target, "core.md"))).toHaveLength(1);
    expect(listBackups(stateDir, paths.claudeMd)).toHaveLength(1);
  });

  test("a new plugin version refreshes a changed file and drops one it no longer ships", () => {
    const { dir, source, paths } = setup();
    installInstructions(paths, false);
    writeFileSync(join(source, "core.md"), "# Core, version two\n");
    // The plugin no longer ships the opt-in file.
    rmSync(join(source, "optin"), { recursive: true });
    const result = installInstructions(paths, false);
    expect(lines(result, dir)).toEqual([
      "~ home/.claude/anymodel/instructions/core.md: updated",
      "- home/.claude/anymodel/instructions/optin/worktrees.md: removed (the plugin no longer ships it)",
    ]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core, version two\n");
    expect(existsSync(join(paths.target, "optin"))).toBe(false);
  });

  test("a file someone edited in the copy is put back", () => {
    const { dir, paths } = setup();
    installInstructions(paths, false);
    writeFileSync(join(paths.target, "core.md"), "# Edited by hand\n");
    expect(lines(installInstructions(paths, false), dir)).toEqual([
      "~ home/.claude/anymodel/instructions/core.md: updated",
    ]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core\n");
  });

  test("a block with another import (an older setup) is updated in place", () => {
    const { paths } = setup();
    writeFileSync(
      paths.claudeMd,
      "Mine\n\n<!-- anymodel:begin -->\n@~/old/path.md\n<!-- anymodel:end -->\n\nAfter\n",
    );
    const result = installInstructions(paths, false);
    expect(result.at(-1)?.what).toBe("anymodel block updated");
    expect(read(paths.claudeMd)).toBe(`Mine\n\n${BLOCK}\n\nAfter\n`);
  });

  test("dry run: the same lines, and nothing is written at all", () => {
    const { dir, stateDir, paths } = setup();
    writeFileSync(paths.claudeMd, "Mine\n");
    const result = installInstructions(paths, true);
    expect(lines(result, dir)).toEqual([
      "+ home/.claude/anymodel/instructions/core.md: created",
      "+ home/.claude/anymodel/instructions/optin/worktrees.md: created",
      "~ home/.claude/CLAUDE.md: anymodel block added",
    ]);
    expect(existsSync(stateDir)).toBe(false);
    expect(read(paths.claudeMd)).toBe("Mine\n");
  });
});

describe("removeInstructions", () => {
  test("takes out the block and the copy; the user's text stays", () => {
    const { dir, stateDir, paths } = setup();
    writeFileSync(paths.claudeMd, "# Mine\n");
    installInstructions(paths, false);
    const result = removeInstructions(paths, false);
    expect(lines(result, dir)).toEqual([
      "~ home/.claude/CLAUDE.md: anymodel block removed",
      "- home/.claude/anymodel/instructions/core.md: removed",
      "- home/.claude/anymodel/instructions/optin/worktrees.md: removed",
    ]);
    expect(read(paths.claudeMd)).toBe("# Mine\n");
    expect(existsSync(paths.target)).toBe(false);
    expect(readdirSync(stateDir).sort()).toEqual(["backups", "changed.json"]);
    expect(readChanged(stateDir)).toEqual({});
  });

  test("a CLAUDE.md that setup created, with only the block, is removed", () => {
    const { dir, paths } = setup();
    installInstructions(paths, false);
    const result = removeInstructions(paths, false);
    expect(lines(result, dir)[0]).toBe("- home/.claude/CLAUDE.md: removed");
    expect(existsSync(paths.claudeMd)).toBe(false);
  });

  test("dry run: the same lines, and nothing changes", () => {
    const { dir, paths } = setup();
    installInstructions(paths, false);
    const before = read(paths.claudeMd);
    expect(lines(removeInstructions(paths, true), dir)).toEqual([
      "- home/.claude/CLAUDE.md: removed",
      "- home/.claude/anymodel/instructions/core.md: removed",
      "- home/.claude/anymodel/instructions/optin/worktrees.md: removed",
    ]);
    expect(read(paths.claudeMd)).toBe(before);
    expect(existsSync(join(paths.target, "core.md"))).toBe(true);
  });

  test("nothing installed: nothing to do", () => {
    const { paths } = setup();
    writeFileSync(paths.claudeMd, "# Mine\n");
    expect(removeInstructions(paths, false)).toEqual([]);
    expect(read(paths.claudeMd)).toBe("# Mine\n");
  });

  test("a block with no record (the state folder was cleared) is still taken out", () => {
    const { dir, paths } = setup();
    writeFileSync(paths.claudeMd, `# Mine\n\n${BLOCK}\n`);
    expect(lines(removeInstructions(paths, false), dir)).toEqual([
      "~ home/.claude/CLAUDE.md: anymodel block removed",
    ]);
    expect(read(paths.claudeMd)).toBe("# Mine\n");
  });
});

describe("restore takes the instructions out too", () => {
  test("the copy is removed with its folders; the block goes; the user's text stays", () => {
    const { stateDir, paths } = setup();
    writeFileSync(paths.claudeMd, "# Mine\n");
    installInstructions(paths, false);
    restore(stateDir);
    expect(read(paths.claudeMd)).toBe("# Mine\n");
    expect(existsSync(paths.target)).toBe(false);
    expect(existsSync(stateDir)).toBe(true);
  });
});

describe("instructionsBlockBody", () => {
  test("a comment that says how to take it out, then the import line", () => {
    expect(instructionsBlockBody("/abs/core.md")).toBe(
      "<!-- Written by anymodel setup. `anymodel setup --no-instructions` takes it out. -->\n@/abs/core.md",
    );
  });
});
