/**
 * A folder cc-smart-dev-kit owns whole (the portal's export): the write, the swap, the record,
 * the dry run, and the restore. Every expected value is written by hand.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
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
  OWNED_FOLDER_MARK,
  ownedFoldersFile,
  readOwnedFolders,
  removeManagedFolder,
  writeManagedFiles,
  writeManagedFolder,
} from "./managed-folder";
import { restore } from "./restore";

/** A source folder: `a.html` and `_next/static/x.js`. */
function source(): string {
  const folder = tempDir("managed-folder-source");
  mkdirSync(join(folder, "_next", "static"), { recursive: true });
  writeFileSync(join(folder, "a.html"), "<html>one</html>\n");
  writeFileSync(join(folder, "_next", "static", "x.js"), "// one\n");
  return folder;
}

describe("a managed folder", () => {
  test("it is written whole, recorded, and the same bytes write nothing", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    expect(writeManagedFolder(target, from, { stateDir })).toEqual({
      files: 2,
      outcome: "created",
    });
    expect(readFileSync(join(target, "a.html"), "utf8")).toBe("<html>one</html>\n");
    expect(readFileSync(join(target, "_next", "static", "x.js"), "utf8")).toBe("// one\n");
    expect(readOwnedFolders(stateDir)).toEqual([target]);
    expect(writeManagedFolder(target, from, { stateDir })).toEqual({
      files: 2,
      outcome: "unchanged",
    });
    expect(readOwnedFolders(stateDir)).toEqual([target]);
  });

  test("a changed source replaces the folder, and a file gone from it is gone", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    writeManagedFolder(target, from, { stateDir });
    writeFileSync(join(from, "a.html"), "<html>two</html>\n");
    writeFileSync(join(from, "b.txt"), "new\n");
    expect(writeManagedFolder(target, from, { stateDir })).toEqual({
      files: 3,
      outcome: "updated",
    });
    expect(readFileSync(join(target, "a.html"), "utf8")).toBe("<html>two</html>\n");
    expect(readFileSync(join(target, "b.txt"), "utf8")).toBe("new\n");
  });

  test("a dry run writes nothing at all: no folder, no record, no state folder", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    expect(writeManagedFolder(target, from, { dryRun: true, stateDir })).toEqual({
      files: 2,
      outcome: "created",
    });
    expect(existsSync(target)).toBe(false);
    expect(existsSync(ownedFoldersFile(stateDir))).toBe(false);
  });

  test("restore removes the folder whole, with no backup", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    writeManagedFolder(target, from, { stateDir });
    const results = restore(stateDir);
    expect(results).toEqual([{ action: "removed", details: [], file: target }]);
    expect(existsSync(target)).toBe(false);
    expect(readOwnedFolders(stateDir)).toEqual([]);
    // A second restore changes nothing: the record is gone.
    expect(restore(stateDir)).toEqual([]);
  });

  test("removing a folder that is not there is not an error, and forgets its record", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    writeManagedFolder(target, from, { stateDir });
    expect(removeManagedFolder(target, stateDir)).toBe(true);
    expect(removeManagedFolder(target, stateDir)).toBe(false);
    expect(readOwnedFolders(stateDir)).toEqual([]);
  });

  test("the folder carries the mark that says cc-smart-dev-kit made it", () => {
    const stateDir = tempDir("managed-folder-state");
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    writeManagedFolder(target, source(), { stateDir });
    expect(readdirSync(target).sort()).toEqual([OWNED_FOLDER_MARK, "_next", "a.html"]);
  });

  test("a folder at the path that cc-smart-dev-kit did not make is never replaced", () => {
    const stateDir = tempDir("managed-folder-state");
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    mkdirSync(target);
    writeFileSync(join(target, "mine.txt"), "the person's\n");
    expect(() => writeManagedFolder(target, source(), { stateDir })).toThrow(
      `${target} is not a folder cc-smart-dev-kit made (it has no ${OWNED_FOLDER_MARK}): move it away, then run this again`,
    );
    expect(readdirSync(target)).toEqual(["mine.txt"]);
    expect(readOwnedFolders(stateDir)).toEqual([]);
  });

  test("a record that names a folder without the mark removes nothing: restore drops the record only", () => {
    const stateDir = tempDir("managed-folder-state");
    const theirs = tempDir("managed-folder-theirs");
    writeFileSync(join(theirs, "keep.txt"), "keep\n");
    // A broken or edited record naming a folder cc-smart-dev-kit never made.
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(ownedFoldersFile(stateDir), `${JSON.stringify({ folders: [theirs] })}\n`);
    expect(restore(stateDir)).toEqual([]);
    expect(readFileSync(join(theirs, "keep.txt"), "utf8")).toBe("keep\n");
    expect(readOwnedFolders(stateDir)).toEqual([]);
  });
});

describe("a managed folder's file mode", () => {
  /** The mode bits of `file`, as a plain number. */
  const modeOf = (file: string) => statSync(file).mode & 0o777;

  test("without the option every file is 0644; the mode of a file that drifted is not looked at", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "portal-ui");
    writeManagedFolder(target, from, { stateDir });
    expect(modeOf(join(target, "a.html"))).toBe(0o644);
    chmodSync(join(target, "a.html"), 0o600);
    expect(writeManagedFolder(target, from, { stateDir }).outcome).toBe("unchanged");
  });

  test("with fileMode every file but the mark has it, and a file with another mode is rewritten", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "hooks");
    expect(writeManagedFolder(target, from, { stateDir, fileMode: 0o755 }).outcome).toBe("created");
    expect(modeOf(join(target, "a.html"))).toBe(0o755);
    expect(modeOf(join(target, "_next", "static", "x.js"))).toBe(0o755);
    expect(modeOf(join(target, OWNED_FOLDER_MARK))).toBe(0o644);
    expect(writeManagedFolder(target, from, { stateDir, fileMode: 0o755 }).outcome).toBe(
      "unchanged",
    );
    chmodSync(join(target, "a.html"), 0o644);
    expect(writeManagedFolder(target, from, { stateDir, fileMode: 0o755 }).outcome).toBe("updated");
    expect(modeOf(join(target, "a.html"))).toBe(0o755);
  });

  test("a dry run with a wrong mode says updated and changes nothing", () => {
    const stateDir = tempDir("managed-folder-state");
    const from = source();
    const target = join(tempDir("managed-folder-target"), "hooks");
    writeManagedFolder(target, from, { stateDir, fileMode: 0o755 });
    chmodSync(join(target, "a.html"), 0o644);
    expect(
      writeManagedFolder(target, from, { stateDir, fileMode: 0o755, dryRun: true }).outcome,
    ).toBe("updated");
    expect(modeOf(join(target, "a.html"))).toBe(0o644);
  });
});

describe("a managed folder written from memory", () => {
  const files = (one: string) =>
    new Map([
      ["a", `${one}\n`],
      ["b", `${one}\n`],
    ]);
  const options = (stateDir: string) => ({ stateDir, fileMode: 0o755 });

  test("is created, recorded, unchanged the second time, and rewritten in place", () => {
    const stateDir = tempDir("managed-folder-state");
    const target = join(tempDir("managed-folder-target"), "hooks");
    expect(writeManagedFiles(target, files("one"), options(stateDir))).toEqual({
      files: 2,
      outcome: "created",
    });
    expect(readFileSync(join(target, "a"), "utf8")).toBe("one\n");
    expect(statSync(join(target, "a")).mode & 0o777).toBe(0o755);
    expect(readOwnedFolders(stateDir)).toEqual([target]);
    expect(writeManagedFiles(target, files("one"), options(stateDir)).outcome).toBe("unchanged");
    // A changed text, a missing file and a file that does not belong.
    const inode = statSync(target).ino;
    writeFileSync(join(target, "stray"), "x");
    rmSync(join(target, "b"));
    expect(writeManagedFiles(target, files("two"), options(stateDir))).toEqual({
      files: 2,
      outcome: "updated",
    });
    expect(statSync(target).ino).toBe(inode);
    expect(readdirSync(target).sort()).toEqual([OWNED_FOLDER_MARK, "a", "b"]);
    expect(readFileSync(join(target, "b"), "utf8")).toBe("two\n");
  });

  test("a dry run writes nothing at all, and a folder that is not ours is never rewritten", () => {
    const stateDir = tempDir("managed-folder-state");
    const target = join(tempDir("managed-folder-target"), "hooks");
    writeManagedFiles(target, files("one"), { ...options(stateDir), dryRun: true });
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(stateDir)).toEqual([]);
    mkdirSync(target);
    writeFileSync(join(target, "mine.txt"), "the person's\n");
    expect(() => writeManagedFiles(target, files("one"), options(stateDir))).toThrow(
      `${target} is not a folder cc-smart-dev-kit made (it has no ${OWNED_FOLDER_MARK}): move it away, then run this again`,
    );
    expect(readdirSync(target)).toEqual(["mine.txt"]);
  });

  test("restore removes it whole", () => {
    const stateDir = tempDir("managed-folder-state");
    const target = join(tempDir("managed-folder-target"), "hooks");
    writeManagedFiles(target, files("one"), options(stateDir));
    expect(removeManagedFolder(target, stateDir)).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(readOwnedFolders(stateDir)).toEqual([]);
  });
});
