import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { applyManagedEntries, ownedEntries } from "./managed-entries";
import { applyManagedJson, ForeignKeyError } from "./managed-json";
import { restore } from "./restore";
import { listBackups, readChanged } from "./write";

const PATH = ["autoMode", "environment"] as const;
const ANCHOR = "$defaults";

/** `null` content: no file at all. */
function setup(content: unknown = { model: "opus" }) {
  const dir = tempDir("entries");
  const file = join(dir, "settings.json");
  const stateDir = join(dir, "state");
  if (content !== null) writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  const apply = (source: string, entries: string[], extra: { dryRun?: boolean } = {}) =>
    applyManagedEntries({ file, stateDir, path: PATH, source, entries, anchor: ANCHOR, ...extra });
  return { dir, file, stateDir, apply };
}

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("applyManagedEntries", () => {
  test("no list yet: creates it with the anchor first, then the entries, all owned", () => {
    const { file, stateDir, apply } = setup();
    const result = apply("/repo/a", ["In a: one.", "In a: two."]);
    expect(result.added).toEqual(["$defaults", "In a: one.", "In a: two."]);
    expect(read(file)).toEqual({
      model: "opus",
      autoMode: { environment: ["$defaults", "In a: one.", "In a: two."] },
    });
    expect(ownedEntries(stateDir, file)).toEqual({
      '["autoMode","environment"]': [
        { entry: "$defaults", source: "" },
        { entry: "In a: one.", source: "/repo/a" },
        { entry: "In a: two.", source: "/repo/a" },
      ],
    });
    expect(readChanged(stateDir)[file]?.kinds).toEqual(["json-entries"]);
  });

  test("a list of the person's: ours go at its end, theirs keep their order, no anchor added", () => {
    const { file, apply } = setup({
      autoMode: { environment: ["Mine: first.", "$defaults", "Mine: last."], allow: ["x"] },
    });
    apply("/repo/a", ["In a: one."]);
    expect(read(file).autoMode).toEqual({
      environment: ["Mine: first.", "$defaults", "Mine: last.", "In a: one."],
      allow: ["x"],
    });
  });

  test("an entry already there, written by someone else, is left alone and not owned", () => {
    const { file, stateDir, apply } = setup({ autoMode: { environment: ["In a: one."] } });
    const result = apply("/repo/a", ["In a: one."]);
    expect(result.skipped).toEqual(["In a: one."]);
    expect(result.written).toBe(false);
    expect(existsSync(join(stateDir, "owned-entries.json"))).toBe(false);
    restore(stateDir);
    expect(read(file).autoMode.environment).toEqual(["In a: one."]);
  });

  test("the same entries again: no write, no backup", () => {
    const { file, stateDir, apply } = setup();
    apply("/repo/a", ["In a: one."]);
    const backups = listBackups(stateDir, file).length;
    const text = readFileSync(file, "utf8");
    const again = apply("/repo/a", ["In a: one."]);
    expect(again.written).toBe(false);
    expect(again.added).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(listBackups(stateDir, file).length).toBe(backups);
  });

  test("an entry the project dropped is taken out; the others stay", () => {
    const { file, apply } = setup({ autoMode: { environment: ["$defaults", "Mine."] } });
    apply("/repo/a", ["In a: one.", "In a: two."]);
    const result = apply("/repo/a", ["In a: two."]);
    expect(result.removed).toEqual(["In a: one."]);
    expect(read(file).autoMode.environment).toEqual(["$defaults", "Mine.", "In a: two."]);
  });

  test("two projects: each owns its own; one dropping a shared entry keeps it for the other", () => {
    const { file, apply } = setup();
    apply("/repo/a", ["Shared.", "In a."]);
    apply("/repo/b", ["Shared.", "In b."]);
    expect(read(file).autoMode.environment).toEqual(["$defaults", "Shared.", "In a.", "In b."]);
    apply("/repo/a", []);
    expect(read(file).autoMode.environment).toEqual(["$defaults", "Shared.", "In b."]);
    apply("/repo/b", []);
    // Nothing but our anchor left: the list goes, and the empty autoMode with it.
    expect(read(file)).toEqual({ model: "opus" });
  });

  test("the anchor stays while an entry of the person's is in the list", () => {
    const { file, apply } = setup();
    apply("/repo/a", ["In a."]);
    const settings = read(file);
    settings.autoMode.environment.push("Mine, added later.");
    writeFileSync(file, JSON.stringify(settings, null, 2));
    apply("/repo/a", []);
    expect(read(file).autoMode.environment).toEqual(["$defaults", "Mine, added later."]);
  });

  test("an entry the person took out by hand is not put back as theirs; ownership is dropped", () => {
    const { file, stateDir, apply } = setup();
    apply("/repo/a", ["In a."]);
    const settings = read(file);
    settings.autoMode.environment = ["$defaults"];
    writeFileSync(file, JSON.stringify(settings, null, 2));
    // Still wanted: it is added again (the project asks for it), owned again.
    const result = apply("/repo/a", ["In a."]);
    expect(result.added).toEqual(["In a."]);
    expect(read(file).autoMode.environment).toEqual(["$defaults", "In a."]);
    expect(ownedEntries(stateDir, file)['["autoMode","environment"]']).toContainEqual({
      entry: "In a.",
      source: "/repo/a",
    });
  });

  test("dry run: reports the change, writes nothing at all", () => {
    const { file, dir, stateDir, apply } = setup();
    const before = readFileSync(file, "utf8");
    const result = apply("/repo/a", ["In a."], { dryRun: true });
    expect(result.added).toEqual(["$defaults", "In a."]);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(stateDir)).toBe(false);
    expect(existsSync(join(dir, "state"))).toBe(false);
  });

  test("a value that is not a list of strings: ForeignKeyError, nothing written", () => {
    const { file, stateDir, apply } = setup({ autoMode: { environment: "one string" } });
    const before = readFileSync(file, "utf8");
    expect(() => apply("/repo/a", ["In a."])).toThrow(ForeignKeyError);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(stateDir)).toBe(false);
  });

  test("another program writes the file in between: tried again, its change kept", () => {
    const { file, stateDir } = setup();
    let writes = 0;
    applyManagedEntries({
      file,
      stateDir,
      path: PATH,
      source: "/repo/a",
      entries: ["In a."],
      anchor: ANCHOR,
      onBeforeWrite: () => {
        if (writes++ === 0) writeFileSync(file, JSON.stringify({ model: "opus", theme: "dark" }));
      },
    });
    expect(read(file)).toEqual({
      model: "opus",
      theme: "dark",
      autoMode: { environment: ["$defaults", "In a."] },
    });
  });
});

describe("restore of owned entries", () => {
  test("takes out every owned entry of every project, keeps the rest", () => {
    const { file, stateDir, apply } = setup({
      autoMode: { environment: ["$defaults", "Mine."], allow: ["$defaults"] },
    });
    apply("/repo/a", ["In a."]);
    apply("/repo/b", ["In b."]);
    const results = restore(stateDir);
    expect(results).toEqual([
      expect.objectContaining({
        file,
        action: "cleaned",
        details: ['the entry "In a."', 'the entry "In b."'],
      }),
    ]);
    expect(read(file).autoMode).toEqual({
      environment: ["$defaults", "Mine."],
      allow: ["$defaults"],
    });
    expect(restore(stateDir)).toEqual([]);
  });

  test("a list cc-smart-dev-kit created goes whole, with the anchor and the empty autoMode", () => {
    const { file, stateDir, apply } = setup();
    apply("/repo/a", ["In a.", "In a, two."]);
    restore(stateDir);
    expect(read(file)).toEqual({ model: "opus" });
  });

  test("the anchor stays when the person added an entry since; it is no longer claimed", () => {
    const { file, stateDir, apply } = setup();
    apply("/repo/a", ["In a."]);
    const settings = read(file);
    settings.autoMode.environment.push("Mine.");
    writeFileSync(file, JSON.stringify(settings, null, 2));
    restore(stateDir);
    expect(read(file).autoMode.environment).toEqual(["$defaults", "Mine."]);
    expect(ownedEntries(stateDir, file)).toEqual({});
  });

  test("a file that also has owned keys: both kinds are taken out", () => {
    const { file, stateDir, apply } = setup();
    applyManagedJson({
      file,
      stateDir,
      set: [[["extraKnownMarketplaces", "m", "autoUpdate"], true]],
    });
    apply("/repo/a", ["In a."]);
    expect(readChanged(stateDir)[file]?.kinds).toEqual(["json-keys", "json-entries"]);
    restore(stateDir);
    expect(read(file)).toEqual({ model: "opus", extraKnownMarketplaces: { m: {} } });
  });
});
