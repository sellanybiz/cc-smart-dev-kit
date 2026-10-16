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
  copyDifferences,
  forgetInstructionsState,
  type InstructionsPaths,
  installInstructions,
  instructionsBlockBody,
  instructionsNeedRefresh,
  instructionsOptedOut,
  listInstructionFiles,
  optOutFile,
  readVersionStamp,
  refreshInstructionsCopy,
  removeInstructions,
  setInstructionsOptOut,
  versionStampFile,
} from "./instructions";
import { restore } from "./restore";
import { listBackups, readChanged } from "./write";

/** The plugin versions the tests stamp the copy with. */
const V1 = "1.0.0";
const V2 = "1.1.0";

const BLOCK = [
  "<!-- cc-smart-dev-kit:begin -->",
  "<!-- Written by cc-smart-dev-kit setup. `cc-smart-dev-kit setup --no-instructions` takes it out. -->",
  "@~/.claude/cc-smart-dev-kit/instructions/core.md",
  "<!-- cc-smart-dev-kit:end -->",
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
  const stateDir = join(configDir, "cc-smart-dev-kit");
  const paths: InstructionsPaths = {
    source,
    target: join(stateDir, "instructions"),
    claudeMd: join(configDir, "CLAUDE.md"),
    stateDir,
    importPath: "~/.claude/cc-smart-dev-kit/instructions/core.md",
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
    const result = installInstructions(paths, false, V1);
    expect(lines(result, dir)).toEqual([
      "+ home/.claude/cc-smart-dev-kit/instructions/core.md: created",
      "+ home/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
      "+ home/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block",
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
    const result = installInstructions(paths, false, V1);
    expect(result.at(-1)?.what).toBe("cc-smart-dev-kit block added");
    expect(read(paths.claudeMd)).toBe(`# Mine\n\nAlways answer in French.\n\n${BLOCK}\n`);
  });

  test("a second run changes nothing: no line, no new backup", () => {
    const { stateDir, paths } = setup();
    installInstructions(paths, false, V1);
    expect(installInstructions(paths, false, V1)).toEqual([]);
    expect(listBackups(stateDir, join(paths.target, "core.md"))).toHaveLength(1);
    expect(listBackups(stateDir, paths.claudeMd)).toHaveLength(1);
  });

  test("a new plugin version refreshes a changed file and drops one it no longer ships", () => {
    const { dir, source, paths } = setup();
    installInstructions(paths, false, V1);
    writeFileSync(join(source, "core.md"), "# Core, version two\n");
    // The plugin no longer ships the opt-in file.
    rmSync(join(source, "optin"), { recursive: true });
    const result = installInstructions(paths, false, V1);
    expect(lines(result, dir)).toEqual([
      "~ home/.claude/cc-smart-dev-kit/instructions/core.md: updated",
      "- home/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: removed (the plugin no longer ships it)",
    ]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core, version two\n");
    expect(existsSync(join(paths.target, "optin"))).toBe(false);
  });

  test("a file someone edited in the copy is put back", () => {
    const { dir, paths } = setup();
    installInstructions(paths, false, V1);
    writeFileSync(join(paths.target, "core.md"), "# Edited by hand\n");
    expect(lines(installInstructions(paths, false, V1), dir)).toEqual([
      "~ home/.claude/cc-smart-dev-kit/instructions/core.md: updated",
    ]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core\n");
  });

  test("a block with another import (an older setup) is updated in place", () => {
    const { paths } = setup();
    writeFileSync(
      paths.claudeMd,
      "Mine\n\n<!-- cc-smart-dev-kit:begin -->\n@~/old/path.md\n<!-- cc-smart-dev-kit:end -->\n\nAfter\n",
    );
    const result = installInstructions(paths, false, V1);
    expect(result.at(-1)?.what).toBe("cc-smart-dev-kit block updated");
    expect(read(paths.claudeMd)).toBe(`Mine\n\n${BLOCK}\n\nAfter\n`);
  });

  test("dry run: the same lines, and nothing is written at all", () => {
    const { dir, stateDir, paths } = setup();
    writeFileSync(paths.claudeMd, "Mine\n");
    const result = installInstructions(paths, true, V1);
    expect(lines(result, dir)).toEqual([
      "+ home/.claude/cc-smart-dev-kit/instructions/core.md: created",
      "+ home/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
      "~ home/.claude/CLAUDE.md: cc-smart-dev-kit block added",
    ]);
    expect(existsSync(stateDir)).toBe(false);
    expect(read(paths.claudeMd)).toBe("Mine\n");
  });
});

describe("removeInstructions", () => {
  test("takes out the block and the copy; the user's text stays", () => {
    const { dir, stateDir, paths } = setup();
    writeFileSync(paths.claudeMd, "# Mine\n");
    installInstructions(paths, false, V1);
    const result = removeInstructions(paths, false);
    expect(lines(result, dir)).toEqual([
      "~ home/.claude/CLAUDE.md: cc-smart-dev-kit block removed",
      "- home/.claude/cc-smart-dev-kit/instructions/core.md: removed",
      "- home/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: removed",
    ]);
    expect(read(paths.claudeMd)).toBe("# Mine\n");
    expect(existsSync(paths.target)).toBe(false);
    expect(readdirSync(stateDir).sort()).toEqual(["backups", "changed.json"]);
    expect(readChanged(stateDir)).toEqual({});
  });

  test("a CLAUDE.md that setup created, with only the block, is removed", () => {
    const { dir, paths } = setup();
    installInstructions(paths, false, V1);
    const result = removeInstructions(paths, false);
    expect(lines(result, dir)[0]).toBe("- home/.claude/CLAUDE.md: removed");
    expect(existsSync(paths.claudeMd)).toBe(false);
  });

  test("dry run: the same lines, and nothing changes", () => {
    const { dir, paths } = setup();
    installInstructions(paths, false, V1);
    const before = read(paths.claudeMd);
    expect(lines(removeInstructions(paths, true), dir)).toEqual([
      "- home/.claude/CLAUDE.md: removed",
      "- home/.claude/cc-smart-dev-kit/instructions/core.md: removed",
      "- home/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: removed",
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
      "~ home/.claude/CLAUDE.md: cc-smart-dev-kit block removed",
    ]);
    expect(read(paths.claudeMd)).toBe("# Mine\n");
  });
});

describe("restore takes the instructions out too", () => {
  test("the copy is removed with its folders; the block goes; the user's text stays", () => {
    const { stateDir, paths } = setup();
    writeFileSync(paths.claudeMd, "# Mine\n");
    installInstructions(paths, false, V1);
    restore(stateDir);
    expect(read(paths.claudeMd)).toBe("# Mine\n");
    expect(existsSync(paths.target)).toBe(false);
    expect(existsSync(stateDir)).toBe(true);
  });
});

describe("instructionsBlockBody", () => {
  test("a comment that says how to take it out, then the import line", () => {
    expect(instructionsBlockBody("/abs/core.md")).toBe(
      "<!-- Written by cc-smart-dev-kit setup. `cc-smart-dev-kit setup --no-instructions` takes it out. -->\n@/abs/core.md",
    );
  });
});

describe("the version stamp", () => {
  test("setup stamps the copy with its version; a dry run writes no stamp", () => {
    const { stateDir, paths } = setup();
    installInstructions(paths, true, V1);
    expect(existsSync(versionStampFile(stateDir))).toBe(false);
    installInstructions(paths, false, V1);
    expect(read(versionStampFile(stateDir))).toBe("1.0.0\n");
    expect(readVersionStamp(stateDir)).toBe("1.0.0");
    // A newer version restamps, even when no file of the copy changed.
    expect(installInstructions(paths, false, V2)).toEqual([]);
    expect(readVersionStamp(stateDir)).toBe("1.1.0");
  });

  test("taking the instructions out removes the stamp too", () => {
    const { stateDir, paths } = setup();
    installInstructions(paths, false, V1);
    removeInstructions(paths, false);
    expect(existsSync(versionStampFile(stateDir))).toBe(false);
  });
});

describe("instructionsNeedRefresh", () => {
  test("only an installed copy, not opted out, whose stamp names another version", () => {
    const { stateDir, paths } = setup();
    expect(instructionsNeedRefresh(paths, V2)).toBe(false); // never installed
    installInstructions(paths, false, V1);
    expect(instructionsNeedRefresh(paths, V1)).toBe(false);
    expect(instructionsNeedRefresh(paths, V2)).toBe(true);
    rmSync(versionStampFile(stateDir));
    expect(instructionsNeedRefresh(paths, V1)).toBe(true); // an older setup wrote no stamp
    setInstructionsOptOut(stateDir, true, false);
    expect(instructionsNeedRefresh(paths, V2)).toBe(false);
  });
});

describe("refreshInstructionsCopy", () => {
  test("brings the copy to the new version and touches nothing else, not even the block", async () => {
    const { dir, source, stateDir, paths } = setup();
    installInstructions(paths, false, V1);
    // The person took the block out by hand: the refresh must not put it back.
    writeFileSync(paths.claudeMd, "# Mine\n");
    writeFileSync(join(source, "core.md"), "# Core, version two\n");
    const result = await refreshInstructionsCopy(paths, V2);
    expect(lines(result, dir)).toEqual([
      "~ home/.claude/cc-smart-dev-kit/instructions/core.md: updated",
    ]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core, version two\n");
    expect(read(paths.claudeMd)).toBe("# Mine\n");
    expect(readVersionStamp(stateDir)).toBe("1.1.0");
    expect(existsSync(join(stateDir, "lock"))).toBe(false);
    expect(await refreshInstructionsCopy(paths, V2)).toEqual([]);
  });

  test("never installed: nothing at all, not even a state folder", async () => {
    const { stateDir, paths } = setup();
    expect(await refreshInstructionsCopy(paths, V2)).toEqual([]);
    expect(existsSync(stateDir)).toBe(false);
  });

  test("the stored opt-out wins: nothing is written", async () => {
    const { source, stateDir, paths } = setup();
    installInstructions(paths, false, V1);
    setInstructionsOptOut(stateDir, true, false);
    writeFileSync(join(source, "core.md"), "# Core, version two\n");
    expect(await refreshInstructionsCopy(paths, V2)).toEqual([]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core\n");
    expect(readVersionStamp(stateDir)).toBe("1.0.0");
  });

  test("dry run: the lines, and nothing written", async () => {
    const { dir, source, stateDir, paths } = setup();
    installInstructions(paths, false, V1);
    writeFileSync(join(source, "core.md"), "# Core, version two\n");
    const result = await refreshInstructionsCopy(paths, V2, { dryRun: true });
    expect(lines(result, dir)).toEqual([
      "~ home/.claude/cc-smart-dev-kit/instructions/core.md: updated",
    ]);
    expect(read(join(paths.target, "core.md"))).toBe("# Core\n");
    expect(readVersionStamp(stateDir)).toBe("1.0.0");
  });
});

describe("setInstructionsOptOut and forgetInstructionsState", () => {
  test("stores the choice once, clears it once; a dry run writes nothing", () => {
    const { dir, stateDir } = setup();
    const show = (line: ReturnType<typeof setInstructionsOptOut>) =>
      line === null ? null : lines([line], dir)[0];
    expect(show(setInstructionsOptOut(stateDir, true, true))).toBe(
      "+ home/.claude/cc-smart-dev-kit/no-instructions: setup leaves the instructions out from now on (`cc-smart-dev-kit setup --instructions` brings them back)",
    );
    expect(existsSync(stateDir)).toBe(false);
    setInstructionsOptOut(stateDir, true, false);
    expect(instructionsOptedOut(stateDir)).toBe(true);
    expect(setInstructionsOptOut(stateDir, true, false)).toBeNull();
    expect(show(setInstructionsOptOut(stateDir, false, false))).toBe(
      "- home/.claude/cc-smart-dev-kit/no-instructions: removed: setup installs the instructions again",
    );
    expect(instructionsOptedOut(stateDir)).toBe(false);
    expect(setInstructionsOptOut(stateDir, false, false)).toBeNull();
  });

  test("forget removes the choice and the stamp, and says whether a choice was there", () => {
    const { stateDir, paths } = setup();
    installInstructions(paths, false, V1);
    expect(forgetInstructionsState(stateDir)).toBeNull();
    expect(existsSync(versionStampFile(stateDir))).toBe(false);
    setInstructionsOptOut(stateDir, true, false);
    expect(forgetInstructionsState(stateDir)).toBe(optOutFile(stateDir));
    expect(instructionsOptedOut(stateDir)).toBe(false);
  });
});

describe("copyDifferences", () => {
  test("empty when the copy matches; names each missing, changed or dropped file", () => {
    const { source, paths } = setup();
    installInstructions(paths, false, V1);
    expect(copyDifferences(paths)).toEqual([]);
    writeFileSync(join(paths.target, "core.md"), "# Edited\n");
    rmSync(join(paths.target, "optin", "worktrees.md"));
    expect(copyDifferences(paths)).toEqual(["core.md differs", "optin/worktrees.md is missing"]);
    installInstructions(paths, false, V1);
    // A newer plugin dropped the opt-in file; the old copy of it is still there.
    rmSync(join(source, "optin"), { recursive: true });
    expect(copyDifferences(paths)).toEqual(["optin/worktrees.md is not shipped any more"]);
  });
});
