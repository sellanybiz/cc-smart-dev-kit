/**
 * `setup` and Remote Control's auto-connect: `remoteControlAtStartup: true` in the user's
 * settings, a managed key that is written only while it is absent (the owner's default, D66).
 * Run in this process with a fake machine (`src/testing/fake-machine.ts`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { applyManagedJson, ForeignKeyError } from "../setup/managed-json";
import {
  planRemoteControl,
  REMOTE_CONTROL_KEY,
  REMOTE_CONTROL_VALUE,
} from "../setup/remote-control";
import { restore } from "../setup/restore";
import { capturePrinted, changeLines, printed, world } from "../testing/fake-machine";

capturePrinted();

const KEY = "remoteControlAtStartup";
const LINE = "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true";

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/** Merges keys into the settings file the way a person editing it would. */
function withSettings(w: ReturnType<typeof world>, extra: Record<string, unknown>): void {
  writeFileSync(
    w.paths.settingsFile,
    JSON.stringify({ ...readJson(w.paths.settingsFile), ...extra }, null, 2),
  );
}

describe("setup and Remote Control's auto-connect", () => {
  test("absent: written as true with its line; a second run changes nothing; restore removes it", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    expect(printed).toContain(LINE);
    expect(readJson(w.paths.settingsFile)[KEY]).toBe(true);
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(changeLines()).toEqual([]);
    expect(printed.join("\n")).not.toContain(KEY);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile)[KEY]).toBeUndefined();
  });

  test("--dry-run: the line is shown and nothing is written", async () => {
    const w = world();
    const before = readFileSync(w.paths.settingsFile, "utf8");
    expect(await w.setup({ dryRun: true })).toBe(0);
    expect(printed).toContain(LINE);
    expect(readFileSync(w.paths.settingsFile, "utf8")).toBe(before);
  });

  test.each([true, false])(
    "the person's own %p is theirs: untouched, unnamed, kept by restore",
    async (value) => {
      const w = world();
      withSettings(w, { [KEY]: value });
      expect(await w.setup()).toBe(0);
      expect(readJson(w.paths.settingsFile)[KEY]).toBe(value);
      expect(printed.join("\n")).not.toContain(KEY);
      restore(w.paths.stateDir);
      expect(readJson(w.paths.settingsFile)[KEY]).toBe(value);
    },
  );

  test("a value the person changed since setup is kept by restore; setup lets go of its claim once", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    withSettings(w, { [KEY]: false });
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile)[KEY]).toBe(false);
    expect(printed).toContain(
      "  · ~/.claude/settings.json: remoteControlAtStartup: changed since cc-smart-dev-kit set it; left alone",
    );
    // The claim is gone: the next run says nothing, and restore keeps the person's value.
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(printed.join("\n")).not.toContain(KEY);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile)[KEY]).toBe(false);
  });

  test("a key the person deleted is not put back, and a true they write later is theirs for restore", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    const settings = readJson(w.paths.settingsFile);
    delete settings[KEY];
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile)[KEY]).toBeUndefined();
    expect(printed).toContain(
      "  · ~/.claude/settings.json: remoteControlAtStartup: not in the file any more (removed since cc-smart-dev-kit set it); left alone",
    );
    // The person writes true themselves, and setup runs again: restore must not remove it.
    withSettings(w, { [KEY]: true });
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(printed.join("\n")).not.toContain(KEY);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile)[KEY]).toBe(true);
  });

  test("a key the person deleted stays out on the third run and after: setup remembers it let go", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    const settings = readJson(w.paths.settingsFile);
    delete settings[KEY];
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0); // run 2: the claim goes
    printed.length = 0;
    const before = readFileSync(w.paths.settingsFile, "utf8");
    expect(await w.setup()).toBe(0); // run 3: the key stays out
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile)[KEY]).toBeUndefined();
    expect(readFileSync(w.paths.settingsFile, "utf8")).toBe(before);
    expect(printed.join("\n")).not.toContain(KEY);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile)[KEY]).toBeUndefined();
  });

  test("a value the person changed and then deleted is not put back either", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    withSettings(w, { [KEY]: false });
    expect(await w.setup()).toBe(0); // the claim goes
    const settings = readJson(w.paths.settingsFile);
    delete settings[KEY];
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile)[KEY]).toBeUndefined();
  });

  test("--dry-run on the run that lets go writes no record", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    const settings = readJson(w.paths.settingsFile);
    delete settings[KEY];
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup({ dryRun: true })).toBe(0);
    expect(await w.setup()).toBe(0); // the real run 2 still lets go, once
    expect(printed).toContain(
      "  · ~/.claude/settings.json: remoteControlAtStartup: not in the file any more (removed since cc-smart-dev-kit set it); left alone",
    );
  });

  test("a plan made from a file that changes before the write never overwrites the person's value", async () => {
    // `planRemoteControl` reads outside `applyManagedJson`'s retry. When another program (Claude
    // Code writes this file too) adds the key between the two, the plan says "set" from a stale
    // file — and the write, which reads the file again, refuses: the person's value stays, and
    // setup stops with a ForeignKeyError that the next run does not repeat.
    const w = world();
    const paths = { settingsFile: w.paths.settingsFile, stateDir: w.paths.stateDir };
    expect(planRemoteControl(paths)).toBe("set");
    withSettings(w, { [KEY]: false });
    expect(() =>
      applyManagedJson({
        file: paths.settingsFile,
        stateDir: paths.stateDir,
        set: [[REMOTE_CONTROL_KEY, REMOTE_CONTROL_VALUE]],
      }),
    ).toThrow(ForeignKeyError);
    expect(readJson(w.paths.settingsFile)[KEY]).toBe(false);
    expect(planRemoteControl(paths)).toBe("leave");
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile)[KEY]).toBe(false);
  });

  test("a settings file with other keys and its own layout changes only by the key", async () => {
    const w = world();
    // Tabs, keys of the person's own in their own order (the world's enabled plugins stay), a
    // final newline.
    const seeded = JSON.stringify(readJson(w.paths.settingsFile), null, "\t").slice(2, -2);
    writeFileSync(
      w.paths.settingsFile,
      `{\n\t"zeta": 1,\n\t"alpha": { "b": [1, 2] },\n${seeded}\n}\n`,
    );
    expect(await w.setup()).toBe(0);
    const text = readFileSync(w.paths.settingsFile, "utf8");
    // The tab indent, the person's key order and the final newline stay.
    expect(text).toStartWith('{\n\t"zeta": 1,\n\t"alpha": {\n\t\t"b": [');
    expect(text).toEndWith("\t}\n}\n");
    expect(Object.keys(readJson(w.paths.settingsFile)).slice(0, 3)).toEqual([
      "zeta",
      "alpha",
      "enabledPlugins",
    ]);
    expect(readJson(w.paths.settingsFile)).toMatchObject({
      alpha: { b: [1, 2] },
      [KEY]: true,
      zeta: 1,
    });
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile)[KEY]).toBeUndefined();
    expect(readJson(w.paths.settingsFile).zeta).toBe(1);
  });
});
