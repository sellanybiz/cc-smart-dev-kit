/**
 * What counts as a major step, the notes that say why, and the lines that tell the person
 * (D33). Plain values only: the background check and `update` are tested in `update.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { tempDir } from "../testing/temp";
import {
  isNewMajor,
  MAJOR_NOTES_PATH,
  majorHeldDetail,
  majorInstallLine,
  majorNotesBetween,
  majorReadyLine,
  readMajorNotes,
} from "./major";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("D33: isNewMajor", () => {
  test("D33: a patch or a minor is no major step; the first number growing is", () => {
    expect(isNewMajor("0.6.0", "0.6.1")).toBe(false);
    expect(isNewMajor("0.6.0", "0.7.0")).toBe(false);
    expect(isNewMajor("1.0.0", "1.1.0")).toBe(false);
    expect(isNewMajor("1.4.2", "1.4.2")).toBe(false);
    expect(isNewMajor("0.6.0", "1.0.0")).toBe(true);
    expect(isNewMajor("0.6.0", "1.1.0")).toBe(true);
    expect(isNewMajor("0.6.0", "2.0.0")).toBe(true);
    expect(isNewMajor("1.9.9", "2.0.0-rc.1")).toBe(true);
    expect(isNewMajor("1.0.0-rc.1", "1.0.0")).toBe(false);
  });

  test("D33: a version that cannot be read is no major step (the update goes as before)", () => {
    expect(isNewMajor(null, "2.0.0")).toBe(false);
    expect(isNewMajor("0.6.0", null)).toBe(false);
    expect(isNewMajor("not a version", "2.0.0")).toBe(false);
    expect(isNewMajor("0.6.0", "garbage")).toBe(false);
  });
});

describe("D33: the notes of a major", () => {
  const TABLE = JSON.stringify({
    "1.0.0": "it refuses old project fields",
    "2.0.0": "it needs a newer Bun",
    "3.0.0": "a third",
  });

  test("D33: the notes of every major crossed, oldest first; none for a minor step", () => {
    expect(majorNotesBetween(TABLE, "0.6.0", "1.0.0")).toEqual(["it refuses old project fields"]);
    expect(majorNotesBetween(TABLE, "0.6.0", "1.1.0")).toEqual(["it refuses old project fields"]);
    expect(majorNotesBetween(TABLE, "0.6.0", "2.0.0")).toEqual([
      "it refuses old project fields",
      "it needs a newer Bun",
    ]);
    expect(majorNotesBetween(TABLE, "1.2.0", "2.0.0-rc.1")).toEqual(["it needs a newer Bun"]);
    expect(majorNotesBetween(TABLE, "1.0.0", "1.1.0")).toEqual([]);
  });

  test("D33: a file that is not a table, or a note that is not one short plain line, gives nothing", () => {
    expect(majorNotesBetween("not json", "0.6.0", "1.0.0")).toEqual([]);
    expect(majorNotesBetween("[]", "0.6.0", "1.0.0")).toEqual([]);
    expect(
      majorNotesBetween(
        JSON.stringify({ "1.0.0": "two\nlines", "1.x": "not a version" }),
        "0.6.0",
        "1.0.0",
      ),
    ).toEqual([]);
    expect(
      majorNotesBetween(JSON.stringify({ "1.0.0": "x".repeat(121) }), "0.6.0", "1.0.0"),
    ).toEqual([]);
    expect(majorNotesBetween(JSON.stringify({ "1.0.0": 7 }), "0.6.0", "1.0.0")).toEqual([]);
  });

  test("D33: read from a marketplace copy at MAJOR_NOTES_PATH; none without the file", () => {
    const copy = tempDir("copy");
    expect(readMajorNotes(copy, "0.6.0", "1.0.0")).toEqual([]);
    expect(readMajorNotes(null, "0.6.0", "1.0.0")).toEqual([]);
    mkdirSync(join(copy, "src", "update"), { recursive: true });
    writeFileSync(join(copy, "src", "update", "major-notes.json"), TABLE);
    expect(readMajorNotes(copy, "0.6.0", "1.0.0")).toEqual(["it refuses old project fields"]);
  });

  test("D33: this repo's notes file is where every installed version reads it, and names this major", () => {
    // Moving the file would leave every installed version without the why: never move it.
    const file = join(REPO_ROOT, MAJOR_NOTES_PATH);
    expect(existsSync(file)).toBe(true);
    const table = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    expect(table["1.0.0"]).toBe("it refuses old project fields");
    // Each key is a major's first version; the major this build belongs to has its note.
    for (const version of Object.keys(table)) expect(version).toMatch(/^[1-9]\d*\.0\.0$/);
    const major = VERSION.split(".")[0];
    if (major !== "0") expect(Object.keys(table)).toContain(`${major}.0.0`);
  });
});

describe("D33: the lines", () => {
  test("D33: the session start's line, the record's detail and update's line, with and without a why", () => {
    expect(majorReadyLine("1.0.0", ["it refuses old project fields"])).toBe(
      "cc-smart-dev-kit 1.0.0 is ready: it is a major version (it refuses old project fields). Read What's new, then run `cc-smart-dev-kit update`.",
    );
    expect(majorReadyLine("2.0.0", [])).toBe(
      "cc-smart-dev-kit 2.0.0 is ready: it is a major version. Read What's new, then run `cc-smart-dev-kit update`.",
    );
    expect(majorHeldDetail("2.0.0", ["a", "b"])).toBe(
      "2.0.0 is a major version (a; b): it waits for `cc-smart-dev-kit update`",
    );
    expect(majorInstallLine("1.0.0", [])).toBe(
      "cc-smart-dev-kit 1.0.0 is a major version: installing it.",
    );
  });
});
